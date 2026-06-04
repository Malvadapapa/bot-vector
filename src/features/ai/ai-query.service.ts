import { AIProvider } from './providers/ai-provider.interface.js';
import { KnowledgeContextService } from './knowledge-context.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { RagQueryService } from './rag/rag-query.service.js';
import { UserModerationService } from '../moderation/user-moderation.service.js';

export class AIQueryService {
  private static readonly RESPONSE_TIMEOUT_MS = 25_000;
  private static readonly TOPIC_CLASSIFICATION_TIMEOUT_MS = 8_000;

  private static readonly ACADEMIC_KEYWORDS = [
    'ispc', 'materia', 'clase', 'examen', 'parcial', 'final', 'cursada', 'nota',
    'inscripcion', 'profesor', 'profe', 'correlativa', 'programacion', 'algoritmo',
    'estructura de datos', 'bases de datos', 'software', 'desarrollo', 'horario',
    'campus', 'aula', 'aviso', 'regularidad', 'aprobado', 'libre', 'recursada',
    'práctica', 'ciencia de datos', 'interfaz', 'gestion de proyectos', 'correlatividad',
    'reglamento', 'regimen', 'régimen', 'académico', 'academico', 'carrera',
  ];

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
    private userModerationService: UserModerationService,
    private ragQueryService?: RagQueryService,
  ) {}

  public async answer(userId: string, prompt: string, now: Date | undefined = undefined, isAdmin = false, groupId?: string): Promise<string> {
    const nowResolved = now || new Date();

    // 0) Compruebo bloqueo a través del servicio de moderación (envía notificación privada si corresponde)
    const evalResult = await this.userModerationService.evaluate(userId, prompt, isAdmin, nowResolved);
    if (evalResult.blocked) {
      return '[MODERATION::BAN] Estás temporalmente restringido de usar la IA.';
    }

    if (isAdmin) {
      return await this.generateAnswer(userId, prompt, nowResolved, isAdmin, groupId);
    }

    // 1) Clasificar (heurística simple)
    const cls = await this.classifyPromptQualityAndTopic(prompt);

    if (cls.status === 'ok') {
      return await this.generateAnswer(userId, prompt, nowResolved, isAdmin, groupId);
    }

    if (cls.status === 'unclear') {
      return this.generateClarifyingQuestion(prompt);
    }

    // 2) Off-topic -> delegar escalado a UserModerationService
    const action = await this.userModerationService.handleInfraction(userId, undefined, cls.reason || 'offtopic', nowResolved);
    if (action.action === 'warn-private') return `[MODERATION::WARN_PRIVATE] ${action.message}`;
    if (action.action === 'warn-public-restrict') return `[MODERATION::WARN_PUBLIC] ${action.message}`;
    if (action.action === 'ban') return `[MODERATION::BAN] ${action.message}`;

    return 'No pude procesar tu pedido.';
  }

  private async generateAnswer(userId: string, prompt: string, now: Date | undefined = undefined, isAdmin: boolean, groupId?: string): Promise<string> {
    // 1. Contexto dinámico de BD (exámenes, avisos, clases, perfil)
    const dbContext = await this.knowledgeContextService.buildContext(userId, groupId);

    // 2. Contexto RAG — búsqueda semántica en los PDFs indexados
    let ragContext: string | null = null;
    let isWeakRag = false;

    if (this.ragQueryService) {
      const ragResults = await this.ragQueryService.search(prompt, 3, groupId);
      ragContext = this.ragQueryService.formatContext(ragResults);

      if (ragContext) {
        isWeakRag = ragResults.some((r) => r.weak);
      }
    }

    if (ragContext) {
      console.log(`[IA] Estrategia de contexto: RAG local (chunks inyectados) ${isWeakRag ? '[DÉBIL]' : ''}`);
    } else {
      console.log('[IA] Estrategia de contexto: contexto interno sin RAG relevante');
    }

    // 3. Construir el prompt enriquecido
    const currentDateTime = now || new Date();
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const dayName = days[currentDateTime.getDay()];
    const dateContext = `[Sistema] Fecha y hora actual: ${currentDateTime.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} (${dayName}). Usá este dato si el usuario pregunta por "hoy", "mañana" o eventos cercanos.`;

    let warningContext = '';
    if (isWeakRag) {
      warningContext = '[Sistema] Los resultados de búsqueda documental (RAG) tienen baja relevancia. Úsalos solo si aportan algo útil; en caso contrario, indicá que no encontraste información precisa en la documentación.';
    }

    const systemInstructions = [
      '[INSTRUCCIÓN DE CONTROL DEL SISTEMA - OBLIGATORIA]',
      'Si la consulta del usuario requiere buscar información específica sobre materias, horarios de clase, agenda, exámenes o profesores, y el "Contexto relevante" provisto de la base de datos indica de forma explícita que dicha información NO está cargada (por ejemplo, "No hay materias ni horarios cargados", "No hay exámenes próximos cargados...", o "No hay profesores cargados..."),',
      'debés iniciar obligatoriamente tu respuesta con la etiqueta literal: `[ABSENT_DATA::<tipo>]` (donde <tipo> es uno de los siguientes: clases, examenes o profesores) y luego explicar de forma sintética qué información se intentó buscar pero no está disponible.',
      'Ejemplo: `[ABSENT_DATA::clases]` para agenda/horarios, `[ABSENT_DATA::examenes]` para exámenes, `[ABSENT_DATA::profesores]` para profesores.',
      'Si la información solicitada sí está cargada y presente en el contexto, respondé normalmente sin anteponer ninguna etiqueta.'
    ].join('\n');

    const mergedPrompt = [
      dateContext,
      warningContext,
      systemInstructions,
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

  // retorna { status: 'ok'|'unclear'|'offtopic', topic?: string, reason?: string }
  private async classifyPromptQualityAndTopic(prompt: string): Promise<{status:string, topic?:string, reason?:string}> {
    const text = prompt.trim().toLowerCase();
    if (text.length < 5) return { status: 'unclear', reason: 'muy corto' };
    // heurística: si menciona palabras clave del ISPC -> ok
    const isRelated = /materia|profesor|horario|inscripción|examen|práctica|aula|ispc|coordinación/.test(text);
    if (isRelated) return { status: 'ok', topic: 'ispc' };
    // si contiene palabras sensibles (política, sexual, porn, crimen, etc) => off-topic
    if (/porno|sexual|bomb|atentad|crimen|ilícit|drogas|suicid/i.test(prompt)) {
      return { status: 'offtopic', reason: 'contenido inapropiado' };
    }
    // fallback: pedir aclaración
    return { status: 'unclear', reason: 'no está claro si es sobre ISPC' };
  }

  private generateClarifyingQuestion(prompt: string): string {
    return `Perdón, no entendí bien tu pregunta: ¿podés dar más detalles o decir exactamente qué necesitas sobre el ISPC?`;
  }
}
