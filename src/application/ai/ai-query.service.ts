import { AIProvider } from '../../infrastructure/integrations/ai/ai-provider.interface.js';
import { KnowledgeContextService } from './knowledge-context.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { RagQueryService } from '../../rag/rag-query.service.js';
import { UserModerationRepository } from '../../infrastructure/persistence/db/repositories.js';

export class AIQueryService {
  // 25 segundos — los modelos gratuitos pueden ser lentos, 8s era insuficiente.
  private static readonly RESPONSE_TIMEOUT_MS = 25_000;
  private static readonly TOPIC_CLASSIFICATION_TIMEOUT_MS = 8_000;

  // Palabras clave que indican contenido académico del ISPC
  private static readonly ACADEMIC_KEYWORDS = [
    'ispc', 'materia', 'clase', 'examen', 'parcial', 'final', 'cursada', 'nota',
    'inscripcion', 'profesor', 'profe', 'correlativa', 'programacion', 'algoritmo',
    'estructura de datos', 'bases de datos', 'software', 'desarrollo', 'horario',
    'campus', 'aula', 'aviso', 'regularidad', 'aprobado', 'libre', 'recursada',
    'práctica', 'ciencia de datos', 'interfaz', 'gestion de proyectos', 'correlatividad',
    'reglamento', 'regimen', 'régimen', 'académico', 'academico', 'carrera',
  ];

  // Patrones de saludos (NO son infracciones)
  private static readonly GREETING_PATTERNS: RegExp[] = [
    /^\s*(hola|hi|hey|buenos|buenas|buen|buena|saludos|ola|olá)\s*$/i,
    /^\s*(hola|hi|hey)\s+[a-záéíóúñ]+\s*$/i,
    /^\s*(buenos\s+días|buenos\s+noches|buenas\s+tardes|buenas\s+noches)\s*$/i,
    /^\s*(¿cómo|como)\s+(estás|estas|va)\s*\??\s*$/i,
    /^\s*te saludo\s*$/i,
  ];

  private static readonly INFRACTION_THRESHOLD = 5;

  constructor(
    private aiProvider: AIProvider,
    private rateLimitService: RateLimitService,
    private knowledgeContextService: KnowledgeContextService,
    private moderationRepository: UserModerationRepository,
    private ragQueryService?: RagQueryService,
  ) {}

  public async answer(userId: string, prompt: string, now?: Date, isAdmin = false): Promise<string> {
    // Los admins pueden preguntar cualquier cosa y no generan sanciones.
    if (isAdmin) {
      return this.generateAnswer(userId, prompt, now, true);
    }

    // Los saludos simples no se consideran off-topic.
    const isGreeting = this.isGreetingPrompt(prompt);
    let isOffTopic = false;

    try {
      if (!isGreeting) {
        isOffTopic = await this.classifyOffTopicWithAI(userId, prompt);
      }

      // Si es off-topic, incrementar infracción
      if (isOffTopic) {
        const state = await this.moderationRepository.getOrCreate(userId);
        state.warning_count += 1;
        state.last_offense_at = now || new Date();

        // Si alcanza 5 infracciones, banear por 24 horas
        if (state.warning_count >= AIQueryService.INFRACTION_THRESHOLD) {
          state.temp_ban_until = new Date((now || new Date()).getTime() + 24 * 60 * 60 * 1000);
          console.log(`[IA] Usuario ${userId} baneado por acumular ${state.warning_count} infracciones`);
        }

        await this.moderationRepository.save(state);

        return '[OFF_TOPIC_DETECTED]';
      }

      return this.generateAnswer(userId, prompt, now, false);
    } catch (err: any) {
      const hint = err?.message?.includes('timeout')
        ? 'La respuesta tardó demasiado.'
        : 'No pude generar una respuesta en este momento.';
      console.error(`[IA] Error en answer para ${userId} con proveedor ${this.aiProvider.getModelName()}: ${err?.message}`);
      return hint;
    }
  }

  private async generateAnswer(userId: string, prompt: string, now: Date | undefined, isAdmin: boolean): Promise<string> {
    // 1. Contexto dinámico de BD (exámenes, avisos, clases, perfil)
    const dbContext = await this.knowledgeContextService.buildContext(userId);

    // 2. Contexto RAG — búsqueda semántica en los PDFs indexados
    let ragContext: string | null = null;
    let contextStrategy: 'rag' | 'file_api' = 'file_api';
    let isWeakRag = false;

    if (this.ragQueryService) {
      const ragResults = await this.ragQueryService.search(prompt, 3);
      ragContext = this.ragQueryService.formatContext(ragResults);

      if (ragContext) {
        contextStrategy = 'rag';
        isWeakRag = ragResults.some((r) => r.weak);
      }
    }

    if (contextStrategy === 'rag') {
      console.log(`[IA] Estrategia de contexto: RAG local (chunks inyectados) ${isWeakRag ? '[DÉBIL]' : ''}`);
    } else {
      console.log('[IA] Estrategia de contexto: Ninguna (o File API de Gemini fallback)');
    }

    // 3. Construir el prompt enriquecido
    const currentDateTime = now || new Date();
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const dayName = days[currentDateTime.getDay()];
    const dateContext = `[Sistema] Fecha y hora actual: ${currentDateTime.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} (${dayName}). Usá este dato si el usuario pregunta por "hoy", "mañana" o eventos cercanos.`;

    let warningContext = '';
    if (isWeakRag) {
      warningContext = '[Sistema] Los resultados de búsqueda documental (RAG) tienen baja relevancia. Úsalos solo si aportan algo útil; en caso contrario, confiá en tu propio criterio o indica que no encontraste información precisa en los reglamentos.';
    }

    const mergedPrompt = [
      dateContext,
      warningContext,
      ragContext || '',
      dbContext ? `Contexto relevante:\n${dbContext}` : '',
      prompt,
    ].filter(Boolean).join('\n\n');

    const aiText = await this.withTimeout(
      this.aiProvider.generateContent(userId, mergedPrompt),
      AIQueryService.RESPONSE_TIMEOUT_MS,
    );

    const normalizedAiText = String(aiText || '').trim();
    if (!normalizedAiText) {
      return 'No pude generar una respuesta en este momento.';
    }

    // ✅ Consumir cuota SOLO si la respuesta es válida
    const decision = await this.rateLimitService.checkAndConsume(userId, now, isAdmin);
    if (!decision.allowed) {
      console.warn(`[IA] Usuario ${userId} alcanzó límite de cuota después de generar respuesta`);
      return `${normalizedAiText}\n\n${decision.message}`;
    }

    // Cuántas preguntas quedan (solo para usuarios comunes)
    const quotaSuffix = !isAdmin && decision.quota_message ? `\n\n${decision.quota_message}` : '';
    const responseBody = `${normalizedAiText}${quotaSuffix}`;

    return responseBody;
  }

  private async classifyOffTopicWithAI(userId: string, prompt: string): Promise<boolean> {
    const classifierPrompt = [
      '[Sistema] Determiná si la consulta del usuario es académica para el ISPC.',
      'Respondé exactamente con una sola palabra: ON_TOPIC o OFF_TOPIC.',
      'Reglas:',
      '- ON_TOPIC: materias, clases, exámenes, profesores, horarios, trámites, calificaciones o cualquier tema académico del ISPC.',
      '- OFF_TOPIC: chistes, recetas, películas, política, deportes, vida personal o cualquier tema no académico.',
      '- Los saludos simples o chistes cortos como hola, buenos días, ¿cómo estás? NO son off-topic.',
      'No agregues explicación, ni puntuación, ni texto extra.',
      `Consulta: ${prompt}`,
    ].join('\n');

    try {
      const result = await this.withTimeout(
        this.aiProvider.generateContent(userId, classifierPrompt),
        AIQueryService.TOPIC_CLASSIFICATION_TIMEOUT_MS,
      );

      const normalized = String(result || '').trim().toUpperCase();
      if (normalized.startsWith('OFF_TOPIC')) {
        return true;
      }
      if (normalized.startsWith('ON_TOPIC')) {
        return false;
      }

      console.warn(`[IA] Clasificador devolvió respuesta ambigua para ${userId}: ${normalized}`);
      return this.isOffTopicPrompt(prompt);
    } catch (err: any) {
      console.warn(`[IA] Falló la clasificación off-topic para ${userId}: ${err?.message}`);
      return this.isOffTopicPrompt(prompt);
    }
  }

  private isGreetingPrompt(prompt: string): boolean {
    const lower = prompt.toLowerCase().trim();
    return AIQueryService.GREETING_PATTERNS.some((pattern) => pattern.test(lower));
  }

  private isOffTopicPrompt(prompt: string): boolean {
    const lower = prompt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Si contiene alguna palabra académica del ISPC, no es off-topic
    return !AIQueryService.ACADEMIC_KEYWORDS.some((kw) => lower.includes(kw));
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
