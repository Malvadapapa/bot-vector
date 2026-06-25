import { AIProvider } from './providers/ai-provider.interface.js';
import { KnowledgeContextService } from './knowledge-context.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { RagQueryService } from './rag/rag-query.service.js';
import { UserModerationService } from '../moderation/user-moderation.service.js';
import { logTuiProcessTrace } from '../../shared/config/tui-shared.js';
import { PrivateChatWorkflowService } from '../../application/admin/private-chat-workflow.service.js';
import { getSettings } from '../../shared/config/settings.js';
import { AcademicGuardrail } from './academic-guardrail.js';

/**
 * Resultado enriquecido de una consulta a la IA.
 * Expone los contextos RAG y DB para que el router pueda guardarlos
 * en el AmbiguityStateService sin requerir una segunda búsqueda.
 */
export interface AIQueryResult {
  /** Texto de respuesta generado por el LLM. */
  response: string;
  /** Contexto RAG inyectado en el prompt (vacío si no hubo RAG relevante). */
  ragContext: string;
  /** Contexto de base de datos inyectado en el prompt (vacío si no hubo). */
  dbContext: string;
}

export class AIQueryService {
  private static readonly RESPONSE_TIMEOUT_MS = 45_000;
  private static readonly TOPIC_CLASSIFICATION_TIMEOUT_MS = 8_000;

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

    const impersonation = PrivateChatWorkflowService.getImpersonation(userId);
    const isRealAdmin = isAdmin || impersonation.isActive;
    const effectiveIsAdmin = impersonation.isActive ? false : isAdmin;
    const customLimit = impersonation.isActive ? impersonation.maxQuestions ?? undefined : undefined;

    // 0) Compruebo bloqueo a través del servicio de moderación (envía notificación privada si corresponde)
    const evalResult = await this.userModerationService.evaluate(userId, prompt, isRealAdmin, nowResolved);
    const isFeriaMode = process.env.FERIA_MODE === 'true' && process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true';
    if (evalResult.blocked && !isFeriaMode) {
      logTuiProcessTrace(`Acceso denegado: El usuario ${userId} se encuentra suspendido por moderación.`);
      return '[MODERATION::BAN] Estás temporalmente restringido de usar la IA.';
    }

    // 0.1) Comprobar intento de prompt leakage (divulgación de instrucciones de sistema)
    if (this.isPromptLeakageAttempt(prompt)) {
      logTuiProcessTrace(`Intento de Prompt Leakage bloqueado para el usuario ${userId}. Prompt: "${prompt}"`);
      return '¡Hola! Como asistente virtual del ISPC, estoy para ayudarte con consultas sobre materias, horarios, exámenes y temas académicos del instituto. No puedo compartir mis reglas de comportamiento ni configuraciones internas. ¿En qué te puedo ayudar hoy con respecto al ISPC?';
    }

    // 0.2) Comprobar límite de preguntas diario (cláusula guarda)
    const isExhausted = impersonation.isActive
      ? await this.rateLimitService.isQuotaExhausted(userId, nowResolved, effectiveIsAdmin, customLimit)
      : await this.rateLimitService.isQuotaExhausted(userId, nowResolved, effectiveIsAdmin);
    if (isExhausted) {
      logTuiProcessTrace(`Acceso denegado por cuota (cláusula guarda): El usuario ${userId} no tiene preguntas disponibles.`);
      const decision = impersonation.isActive
        ? await this.rateLimitService.checkAndConsume(userId, nowResolved, effectiveIsAdmin, customLimit)
        : await this.rateLimitService.checkAndConsume(userId, nowResolved, effectiveIsAdmin);
      const prefix = decision.newly_pending ? '[QUOTA_BLOCKED::NEW]' : '[QUOTA_BLOCKED::PENDING]';
      return `${prefix} ${decision.message}`;
    }

    // 0.3) Modo Feria: omitir filtros de intención, validaciones académicas y clasificación
    if (isFeriaMode) {
      const feriaLog = `[Gateway] [Modo Feria] Filtros de intención suspendidos. Procesando consulta directamente.`;
      console.log(feriaLog);
      logTuiProcessTrace(feriaLog);
      return (await this.generateAnswer(userId, prompt, nowResolved, effectiveIsAdmin, groupId, customLimit)).response;
    }

    if (!effectiveIsAdmin && this.isAcademicScheduleOrLinkQuery(prompt)) {
      logTuiProcessTrace(`Validando comisión de cursado para el usuario ${userId} en grupo ${groupId}...`);
      const validation = await this.knowledgeContextService.validateUserCommission(userId, groupId);
      if (!validation.valid) {
        logTuiProcessTrace(`Comisión inválida/inexistente. Bloqueando consulta de agenda.`);
        if (validation.reason === 'incomplete_profile') {
          return '⚠️ Para poder consultar agendas, clases o enlaces de cursado, primero tenés que completar tu registro. Por favor, escribime por privado para registrarte.';
        }
        return '⚠️ Para poder brindarte información sobre horarios, clases, aulas o enlaces de cursado, necesito saber a qué comisión pertenecés. Por favor, registrá tu comisión en el bot escribiendo \'hola\' en el chat privado.';
      }
      logTuiProcessTrace(`Comisión válida detectada.`);
    }

    if (effectiveIsAdmin) {
      const adminLog = `[RAG-Pipeline] [Paso 1] Usuario es administrador. Omitiendo clasificación de intención.`;
      console.log(adminLog);
      logTuiProcessTrace(adminLog);
      return (await this.generateAnswer(userId, prompt, nowResolved, effectiveIsAdmin, groupId, customLimit)).response;
    }

    // 1) Clasificar (heurística simple)
    const cls = await this.classifyPromptQualityAndTopic(prompt);
    const intentLog = `[RAG-Pipeline] [Paso 1] Clasificación de intención para prompt: "${prompt}" -> Estado: ${cls.status.toUpperCase()}${cls.reason ? ` (Razón: ${cls.reason})` : ''}`;
    console.log(intentLog);
    logTuiProcessTrace(intentLog);

    if (cls.status === 'ok') {
      return (await this.generateAnswer(userId, prompt, nowResolved, effectiveIsAdmin, groupId, customLimit)).response;
    }

    if (cls.status === 'unclear') {
      logTuiProcessTrace(`Consulta de ${userId} marcada como poco clara ("unclear").`);
      return this.generateClarifyingQuestion(prompt);
    }

    // 2) Off-topic -> delegar escalado a UserModerationService
    if (isRealAdmin) {
      logTuiProcessTrace(`Consulta de ${userId} clasificada como OFF-TOPIC, pero omitida por ser Administrador real.`);
      return 'Esta es una consulta clasificada como OFF-TOPIC por el guardrail, pero no se aplica sanción por ser Administrador.';
    }
    logTuiProcessTrace(`Consulta de ${userId} clasificada como OFF-TOPIC.`);
    const action = await this.userModerationService.handleInfraction(userId, undefined, cls.reason || 'offtopic', nowResolved);
    logTuiProcessTrace(`Acción de moderación aplicada para ${userId}: ${action.action} (Mensaje: ${action.message})`);
    if (action.action === 'warn-private') return `[MODERATION::WARN_PRIVATE] ${action.message}`;
    if (action.action === 'warn-public-restrict') return `[MODERATION::WARN_PUBLIC] ${action.message}`;
    if (action.action === 'ban') return `[MODERATION::BAN] ${action.message}`;

    return 'No pude procesar tu pedido.';
  }

  private async generateAnswer(userId: string, prompt: string, now: Date | undefined = undefined, isAdmin: boolean, groupId?: string, customDailyLimit?: number): Promise<AIQueryResult> {
    const currentDateTime = now || new Date();

    // ✅ Consumir cuota al inicio para evitar condiciones de carrera y llamadas innecesarias a la API de la IA
    const decision = customDailyLimit !== undefined
      ? await this.rateLimitService.checkAndConsume(userId, currentDateTime, isAdmin, customDailyLimit)
      : await this.rateLimitService.checkAndConsume(userId, currentDateTime, isAdmin);
    if (!decision.allowed) {
      logTuiProcessTrace(`Acceso denegado por cuota: El usuario ${userId} superó su límite diario de consultas.`);
      const prefix = decision.newly_pending ? '[QUOTA_BLOCKED::NEW]' : '[QUOTA_BLOCKED::PENDING]';
      return { response: `${prefix} ${decision.message}`, ragContext: '', dbContext: '' };
    }

    logTuiProcessTrace(`Cuota consumida para ${userId}. Restantes: ${decision.remaining_after_request === Number.MAX_SAFE_INTEGER ? 'ilimitadas (admin)' : decision.remaining_after_request}`);

    // 1. Contexto dinámico de BD (exámenes, avisos, clases, perfil)
    logTuiProcessTrace(`Recuperando contexto relevante de base de datos...`);
    const dbContext = await this.knowledgeContextService.buildContext(userId, groupId, currentDateTime);

    // 2. Contexto RAG — búsqueda semántica en los PDFs indexados
    let ragContext: string | null = null;
    let isWeakRag = false;

    if (this.ragQueryService) {
      logTuiProcessTrace(`Iniciando búsqueda semántica RAG para: "${prompt}"`);
      const ragResults = await this.ragQueryService.search(prompt, 5, groupId);
      ragContext = this.ragQueryService.formatContext(ragResults);

      if (ragContext) {
        isWeakRag = ragResults.some((r) => r.weak);
      }
    }

    if (ragContext) {
      const msg = `Estrategia de contexto: RAG local (chunks inyectados) ${isWeakRag ? '[DÉBIL]' : ''}`;
      console.log(`[IA] ${msg}`);
      logTuiProcessTrace(msg);
      const step5Msg = `[RAG-Pipeline] [Paso 5] Contexto RAG inyectado exitosamente (${isWeakRag ? 'DÉBIL' : 'FUERTE'}).`;
      console.log(step5Msg);
      logTuiProcessTrace(step5Msg);
    } else {
      const msg = 'Estrategia de contexto: contexto interno sin RAG relevante';
      console.log(`[IA] ${msg}`);
      logTuiProcessTrace(msg);
      const step5Msg = '[RAG-Pipeline] [Paso 5] Ningún contexto RAG relevante inyectado en el prompt.';
      console.log(step5Msg);
      logTuiProcessTrace(step5Msg);
    }

    // 3. Construir el prompt enriquecido
    const tz = getSettings().timezone || 'America/Argentina/Cordoba';
    const formattedDate = currentDateTime.toLocaleString('es-AR', { timeZone: tz });
    const dayNameRaw = currentDateTime.toLocaleDateString('es-AR', { timeZone: tz, weekday: 'long' });
    const dayName = dayNameRaw.charAt(0).toUpperCase() + dayNameRaw.slice(1);
    const dateContext = `[Sistema] Fecha y hora actual: ${formattedDate} (${dayName}). Usá este dato si el usuario pregunta por "hoy", "mañana" o eventos cercanos.`;

    let warningContext = '';
    if (isWeakRag) {
      warningContext = '[Sistema] ADVERTENCIA CRÍTICA: Los fragmentos de búsqueda (RAG) adjuntos tienen muy baja relevancia para la consulta del usuario (coincidencias débiles). NO uses los enlaces (como Google Meet, Drive, etc.) ni la información provista en estos fragmentos a menos que respondan con absoluta certeza a lo que el usuario preguntó. Si el usuario pide recomendaciones de estudio, tutoriales o recursos de práctica/ejercitación, ignorá por completo los fragmentos institucionales y respondé de forma general con tu conocimiento.';
    }

    const systemInstructions = [
      '[INSTRUCCIÓN DE CONTROL DEL SISTEMA - OBLIGATORIA]',
      'Si la consulta del usuario requiere buscar información específica sobre materias, horarios de clase, agenda, exámenes o profesores, y el "Contexto relevante" provisto de la base de datos indica de forma explícita que dicha información NO está cargada (por ejemplo, "No hay materias ni horarios cargados", "No hay exámenes próximos cargados...", o "No hay profesores cargados..."),',
      'debés iniciar obligatoriamente tu respuesta con la etiqueta literal: `[ABSENT_DATA::<tipo>]` (donde <tipo> es uno de los siguientes: clases, examenes o profesores) y luego explicar de forma sintética qué información se intentó buscar pero no está disponible.',
      'Ejemplo: `[ABSENT_DATA::clases]` para agenda/horarios, `[ABSENT_DATA::examenes]` para exámenes, `[ABSENT_DATA::profesores]` para profesores.',
      'Si la información solicitada sí está cargada y presente en el contexto, respondé normalmente sin anteponer ninguna etiqueta.',
      '',
      '[FRENO DE AMBIGÜEDAD UNIVERSAL - REGLA CRÍTICA]',
      'Si el contexto recuperado (fragmentos RAG) presenta MÚLTIPLES ESCENARIOS, CONDICIONES, REGULACIONES O CAMINOS',
      'diferentes para responder según el perfil, carrera, año, cohorte o condición del estudiante (ejemplos:',
      '"si sos alumno regular aplica X, si sos libre aplica Y", "si estás en primer año haces esto, si estás en',
      'segundo año aquello", "si es equivalencias es tal trámite, si es reconocimiento de saberes es este otro",',
      '"si es inactividad de tutoría son 14 días, si es baja definitiva son 60 días"), ESTÁ ESTRICTAMENTE PROHIBIDO',
      'asumir un escenario o listar toda la información de golpe. En cambio, DEBES:',
      '1. Iniciar tu respuesta EXACTAMENTE con la etiqueta `[CLARIFY_QUESTION]` en la primera línea. Está TERMINANTEMENTE PROHIBIDO anteponer cualquier saludo, introducción, explicación, mención del nombre del usuario, texto o espacio antes de dicha etiqueta. Esta prohibición anula cualquier otra instrucción del sistema sobre dirigirse al usuario por su nombre o saludarlo.',
      '2. Escribir UNA SOLA pregunta aclaratoria breve y directa para que el usuario defina su situación.',
      '3. NO dar ningún contenido de respuesta. Solo la etiqueta y la pregunta.',
      'Ejemplo correcto:',
      '[CLARIFY_QUESTION]',
      '¿Estás cursando como alumno *regular* o vas a rendir como *libre*?',
      '',
      'REGLAS de uso de [CLARIFY_QUESTION]:',
      '- Usalo SOLO cuando el RAG tenga caminos condicionales o regulaciones múltiples según la condición del alumno.',
      '- NO lo usés para preguntas simples con respuesta única y de hecho simple (ej. un email de contacto).',
      '- NO lo usés junto con [OPTIONS_MENU] en la misma respuesta.',
      '- Usalo incluso si tenés toda la información en el RAG, siempre que dicha información dependa de definir primero la situación, perfil o condición del alumno. Solo respondé directamente si el usuario ya especificó de forma explícita a qué condición o trámite se refiere en su pregunta (ej: "cómo rindo libre" o "cómo pido equivalencias").',
      '- Caso Exámenes Finales: Si te preguntan de forma genérica sobre rendir finales, exámenes finales o fechas, y el RAG contiene regulaciones para alumnos regulares y libres, DEBES disparar [CLARIFY_QUESTION] preguntando si el alumno es regular o libre.',
      '- Caso Cursado/Calendario: Si te preguntan de forma genérica sobre cursado, fechas de inicio o modalidades de cursado, y el RAG contiene plazos distintos para ingresantes (primer año) y avanzados (segundo/tercer año), DEBES disparar [CLARIFY_QUESTION] preguntando si es ingresante o avanzado.',
      '- Caso Inscripción: Si te preguntan de forma genérica sobre inscripción o cómo inscribirte, y el RAG contiene plazos y procedimientos distintos para cursar materias (ingresantes vs avanzados) o para rendir exámenes finales, DEBES disparar [CLARIFY_QUESTION] preguntando si se refiere a la inscripción para cursar materias o para rendir exámenes finales.',
      '- Caso Calificaciones/Notas: Si te preguntan de forma genérica sobre ver notas, calificaciones o rendimiento, y el RAG contiene regulaciones para notas de cursada/parciales en Moodle y notas de exámenes finales en SIU Guaraní, DEBES disparar [CLARIFY_QUESTION] preguntando si se refiere a notas de cursada/parciales o a exámenes finales.',
      '- Caso Trámites Académicos/Equivalencias: Si te preguntan sobre acreditar o certificar materias de otra institución o universidad de forma general, y el RAG contiene diferencias entre el trámite de Equivalencias (materias aprobadas en otra institución) y Reconocimiento de Saberes (experiencia laboral o capacitaciones), DEBES disparar [CLARIFY_QUESTION] preguntando si se refiere a Equivalencias o a Reconocimiento de Saberes.',
      '- Caso Aprobación de Cursado: Si te preguntan de forma genérica con qué nota o calificación se aprueba el cursado o las materias, y el RAG contiene notas mínimas distintas para materias comunes (nota 4) y para proyectos integradores ABP o reconocimiento de saberes (nota 7), DEBES disparar [CLARIFY_QUESTION] preguntando si se refiere a materias comunes o al proyecto integrador ABP/reconocimiento de saberes.',
      '- Caso Certificado de Salud (CUS): Si te preguntan de forma genérica sobre cuándo o cómo presentar el Certificado Único de Salud (CUS), y el RAG contiene plazos distintos para ingresantes (inscripción inicial) y avanzados (renovación anual antes del último día hábil de junio), DEBES disparar [CLARIFY_QUESTION] preguntando si es ingresante o alumno avanzado.',
      '- Caso Correlatividades: Si te preguntan de forma genérica sobre las materias correlativas o cómo te afectan, y el RAG contiene regulaciones para cursado (regularidad requerida) y para exámenes finales (inhabilitación si adeudas correlativas previas), DEBES disparar [CLARIFY_QUESTION] preguntando si se refiere al impacto de las correlativas en el cursado o en los exámenes finales.',
      '',
      '[MENÚ DE OPCIONES DINÁMICO - INSTRUCCIÓN OBLIGATORIA]',
      'Si la consulta del usuario es amplia, ambigua o tiene múltiples respuestas posibles (por ejemplo "qué trámites puedo hacer?", "qué materias hay?", "cómo me contacto?"), debés presentar un menú de opciones numerado en lugar de responder directamente.',
      'Para activar este menú, iniciá tu respuesta EXACTAMENTE con la etiqueta `[OPTIONS_MENU]` en la primera línea, seguida de una breve introducción y luego las opciones numeradas.',
      'Formato obligatorio:',
      '[OPTIONS_MENU]',
      'Breve introducción explicativa.',
      '1. Opción uno',
      '2. Opción dos',
      '3. Opción tres',
      '',
      'Reglas del menú de opciones:',
      '- Máximo 5 opciones, EXCEPTO cuando la consulta es específicamente sobre materias/asignaturas del plan de estudios (en ese caso podés listar todas las necesarias).',
      '- Cada opción debe ser concisa (una frase corta que identifique el tema).',
      '- NO uses emojis numéricos (1️⃣), usá números simples seguidos de punto (1., 2., etc.).',
      '- NO respondas con [OPTIONS_MENU] si la pregunta tiene una respuesta única y directa (por ejemplo "cuándo es el próximo examen de Programación" tiene una sola respuesta).',
      '- NO uses [OPTIONS_MENU] para saludos, preguntas simples o consultas directas.',
      '',
      '[REGLAS ADICIONALES DE RAG Y CONTEXTO ACADÉMICO]',
      '- La sección "MATERIAS ACTIVAS (HORARIOS DE CURSADA)" representa el cronograma general del grupo de WhatsApp. NO asumas que el estudiante está cursando individualmente todas esas materias; es posible que deba recursar alguna correlativa anterior.',
      '- Si el estudiante consulta sobre recursar una materia o quedar libre, explicá detalladamente las condiciones (p. ej., rendir libre dentro de las siguientes dos mesas examinadoras, rematricularse, etc.) basándote exclusivamente en el contexto RAG.',
      '- Si en el contexto RAG con alta relevancia se proveen enlaces específicos (de Google Drive, documentos, etc.) o correos de soporte técnico oficiales (como soporte.guarani@ispc.edu.ar), menciónalos explícitamente. NO menciones enlaces de fragmentos RAG con baja relevancia (marcados como débiles) a menos que respondan exactamente a lo solicitado. Evitá asociar enlaces de clases virtuales (Meet) o trámites de SIU Guaraní a consultas sobre contenidos de estudio, práctica o recursos de aprendizaje.',
      '- Si el usuario consulta sobre recursos, material adicional o plataformas para estudiar o practicar contenidos de cualquier materia de la tecnicatura (por ejemplo Programación, Base de Datos, Redes, etc.), debés sugerirle plataformas populares de aprendizaje y ejercitación (como YouTube, LeetCode, HackerRank, freeCodeCamp, Coursera, GitHub, W3Schools, etc., adaptadas al área de la materia consultada) e indicar amablemente que no dispones de apuntes específicos locales dentro de los archivos institucionales.',
      '- NO delegues ni recomiendes comunicarse con la Coordinadora (Tatiana Manzanelli) a menos que el contexto RAG lo indique específicamente para ese trámite. Si la consulta se puede resolver con la información del RAG o de soporte de SIU Guaraní, brindá esa respuesta directa.'
    ].join('\n');


    const mergedPrompt = [
      dateContext,
      warningContext,
      systemInstructions,
      ragContext || '',
      dbContext ? `Contexto relevante:\n${dbContext}` : '',
      prompt,
    ].filter(Boolean).join('\n\n');

    logTuiProcessTrace(`Invocando API del modelo de IA (${this.aiProvider.constructor.name})...`);
    const aiText = await this.withTimeout(
      this.aiProvider.generateContent(userId, mergedPrompt, prompt),
      AIQueryService.RESPONSE_TIMEOUT_MS,
    );
    logTuiProcessTrace(`Respuesta del modelo recibida con éxito. Modelo: ${this.aiProvider.getModelName()}`);

    const normalizedAiText = String(aiText || '').trim();
    if (!normalizedAiText) {
      return {
        response: 'No pude generar una respuesta en este momento.',
        ragContext: ragContext ?? '',
        dbContext: dbContext ?? '',
      };
    }

    // Cuántas preguntas quedan (solo para usuarios comunes).
    // EXCEPCIÓN: no agregar sufijo de cuota si el LLM hizo una pregunta aclaratoria,
    // ya que esa interacción no debe contar como una respuesta "consumida" visiblemente.
    const isClarifyQuestion = AIQueryService.hasClarifyQuestion(normalizedAiText);
    const quotaSuffix = !isAdmin && !isClarifyQuestion && decision.quota_message
      ? `\n\n${decision.quota_message}`
      : '';
    const responseBody = `${normalizedAiText}${quotaSuffix}`;

    return {
      response: responseBody,
      ragContext: ragContext ?? '',
      dbContext: dbContext ?? '',
    };
  }

  /**
   * Genera una respuesta detallada para una opción seleccionada del menú dinámico.
   * NO consume cuota — la cuota ya fue consumida en la consulta original.
   */
  public async answerSelectedOption(
    userId: string,
    selectedOption: string,
    originalPrompt: string,
    isAdmin = false,
    groupId?: string,
  ): Promise<string> {
    logTuiProcessTrace(`[Opciones] Usuario ${userId} seleccionó: "${selectedOption}" (consulta original: "${originalPrompt}")`);

    // Construir contexto de BD y RAG (igual que generateAnswer pero sin consumir cuota)
    const currentDateTime = new Date();
    logTuiProcessTrace(`Recuperando contexto para respuesta de opción seleccionada...`);
    const dbContext = await this.knowledgeContextService.buildContext(userId, groupId, currentDateTime);

    let ragContext: string | null = null;
    if (this.ragQueryService) {
      const ragResults = await this.ragQueryService.search(`${originalPrompt} ${selectedOption}`, 5, groupId);
      ragContext = this.ragQueryService.formatContext(ragResults);
    }

    const tz = getSettings().timezone || 'America/Argentina/Cordoba';
    const formattedDate = currentDateTime.toLocaleString('es-AR', { timeZone: tz });
    const dayNameRaw = currentDateTime.toLocaleDateString('es-AR', { timeZone: tz, weekday: 'long' });
    const dayName = dayNameRaw.charAt(0).toUpperCase() + dayNameRaw.slice(1);
    const dateContext = `[Sistema] Fecha y hora actual: ${formattedDate} (${dayName}).`;

    const focusedPrompt = [
      dateContext,
      '[INSTRUCCIÓN DE CONTEXTO]',
      `El usuario previamente preguntó: "${originalPrompt}"`,
      `Se le mostraron varias opciones y eligió: "${selectedOption}".`,
      'Brindá una respuesta COMPLETA, DETALLADA y EXHAUSTIVA sobre ese tema específico.',
      'Usá toda la información disponible del contexto RAG y de la base de datos.',
      'Si hay enlaces, correos o fechas relevantes, mencionálos.',
      'NO vuelvas a mostrar un menú de opciones. Respondé directamente con la información detallada.',
      ragContext || '',
      dbContext ? `Contexto relevante:\n${dbContext}` : '',
      `Consulta del usuario: Detallame sobre "${selectedOption}"`,
    ].filter(Boolean).join('\n\n');

    logTuiProcessTrace(`Invocando API del modelo de IA para opción seleccionada...`);
    const aiText = await this.withTimeout(
      this.aiProvider.generateContent(userId, focusedPrompt, `${originalPrompt} - ${selectedOption}`),
      AIQueryService.RESPONSE_TIMEOUT_MS,
    );
    logTuiProcessTrace(`Respuesta detallada recibida con éxito.`);

    const normalizedAiText = String(aiText || '').trim();
    if (!normalizedAiText) {
      return 'No pude generar una respuesta detallada en este momento.';
    }

    return normalizedAiText;
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
      return await this.isOffTopicPrompt(prompt);
    } catch (err: any) {
      console.warn(`[IA] Falló la clasificación off-topic para ${userId}: ${err?.message}`);
      return await this.isOffTopicPrompt(prompt);
    }
  }

  private isGreetingPrompt(prompt: string): boolean {
    const lower = prompt.toLowerCase().trim();
    return AIQueryService.GREETING_PATTERNS.some((pattern) => pattern.test(lower));
  }

  private async isOffTopicPrompt(prompt: string): Promise<boolean> {
    try {
      const guardrail = AcademicGuardrail.getInstance();
      const result = await guardrail.validatePrompt(prompt);
      return !result.isValid;
    } catch {
      return false; // Fail-open
    }
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

    // 1) Interceptar Saludos
    if (this.isGreetingPrompt(prompt)) {
      return { status: 'ok', topic: 'greeting' };
    }

    // 2) Whitelist para frases de navegación, cancelación y saludos comunes
    const NAVIGATION_WHITELIST = /^\s*(olvidalo|cancelar|olvida|olvidate|otra cosa|cambiando de tema|no importa|dejalo|gracias|chau|adios|hasta luego|hola|buen dia|buenas tardes|buenas noches)\s*$/i;
    if (NAVIGATION_WHITELIST.test(text)) {
      return { status: 'ok', topic: 'navigation' };
    }

    // 3) Whitelist de palabras clave académicas de alta confianza para evitar falsos negativos en frases cortas
    const ACADEMIC_KEYWORDS = /\b(inscribir|inscripcion|inscribirme|inscribo|cursar|cursado|examen|examenes|final|finales|materia|materias|equivalencia|equivalencias|cus|siu|guarani|moodle|aula|aulas)\b/i;
    if (ACADEMIC_KEYWORDS.test(text)) {
      return { status: 'ok', topic: 'academic_whitelist' };
    }

    if (text.length < 5) return { status: 'unclear', reason: 'muy corto' };

    // si contiene palabras sensibles (política, sexual, porn, crimen, etc) => off-topic
    if (/porno|sexual|bomb|atentad|crimen|ilícit|drogas|suicid/i.test(prompt)) {
      return { status: 'offtopic', reason: 'contenido inapropiado' };
    }

    try {
      const guardrail = AcademicGuardrail.getInstance();
      const result = await guardrail.validatePrompt(prompt);

      if (result.isValid) {
        return { status: 'ok', topic: 'ispc' };
      }

      // Si la similitud es extremadamente baja (ej. < 0.30), la clasificamos como off-topic
      if (result.similarity < 0.30) {
        return { status: 'offtopic', reason: `fuera de lugar (Similitud: ${result.similarity.toFixed(4)})` };
      }

      // Si está en el rango medio (0.30 - 0.42), la marcamos como unclear para aclaración
      return { status: 'unclear', reason: `no está claro si es sobre ISPC (Similitud: ${result.similarity.toFixed(4)})` };
    } catch (error) {
      // Fallback Fail-Open: ante error técnico de transformers, dejamos pasar la consulta
      console.error('[Guardrail Error] Error al validar consulta con AcademicGuardrail:', error);
      return { status: 'ok', topic: 'ispc' };
    }
  }

  private generateClarifyingQuestion(prompt: string): string {
    return `Perdón, no entendí bien tu pregunta: ¿podés dar más detalles o decir exactamente qué necesitas sobre el ISPC?`;
  }

  private isPromptLeakageAttempt(prompt: string): boolean {
    const normalized = prompt
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
      .trim();

    const leakagePatterns = [
      // Petición directa de reglas/instrucciones del bot/creador/sistema
      /(reglas|instrucciones|directivas|configuracion|prompt)s?\s+(que\s+te|de\s+tu|del\s+bot|de\s+la\s+ia|del\s+modelo|de\s+vector|internas|propias|de\s+comportamiento|de\s+funcionamiento|de\s+sistema|del\s+sistema)/i,
      // Petición con posesivos: tus reglas, tus instrucciones, tu configuración, tu prompt, etc.
      /(tus|tu|tuyas|tuyos)\s+(reglas|instrucciones|directivas|configuracion|prompt|directiva)s?/i,
      // Directivas del creador / de Cristian Vargas
      /(reglas|instrucciones|directivas|configuracion|prompt)s?\s+.*(creador|creo|diseno|cristian|vargas)/i,
      // Revelar reglas
      /revelar\s+(reglas|instrucciones|directivas|prompt|configuracion)s?/i,
      /reveles\s+(reglas|instrucciones|directivas|prompt|configuracion)s?/i,
      /divulgar\s+(reglas|instrucciones|directivas|prompt|configuracion)s?/i,
      /mostrar\s+(reglas|instrucciones|directivas|prompt|configuracion)s?/i,
      // Términos técnicos de prompt injection / leakage
      /system\s+prompt/i,
      /prompt\s+de\s+sistema/i,
      /instrucciones\s+de\s+sistema/i,
      /reglas\s+de\s+sistema/i,
      /directivas\s+de\s+sistema/i,
      /system\s+instruction/i,
      /instrucciones\s+del\s+sistema/i,
      /directivas\s+del\s+sistema/i,
      /reglas\s+del\s+sistema/i,
    ];

    return leakagePatterns.some((pattern) => pattern.test(normalized));
  }

  private isAcademicScheduleOrLinkQuery(prompt: string): boolean {
    const lower = prompt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const scheduleKeywords = [
      'agenda', 'horario', 'clase', 'materia', 'aula', 'enlace', 'link', 'meet',
      'cursar', 'cursado', 'cronograma', 'calendario', 'semana', 'hoy', 'mañana',
      'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo',
      'examen', 'examenes', 'parcial', 'final'
    ];
    return scheduleKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Verifica si la respuesta del LLM contiene el tag [OPTIONS_MENU].
   */
  public static hasOptionsMenu(response: string): boolean {
    return response.trimStart().startsWith('[OPTIONS_MENU]');
  }

  /**
   * Parsea las opciones de una respuesta del LLM que contiene [OPTIONS_MENU].
   * Retorna el texto introductorio y la lista de opciones extraídas.
   */
  public static parseOptionsMenu(response: string): { intro: string; options: string[] } | null {
    if (!AIQueryService.hasOptionsMenu(response)) return null;

    const withoutTag = response.replace(/^\s*\[OPTIONS_MENU\]\s*/i, '').trim();
    const lines = withoutTag.split('\n').map(l => l.trim()).filter(Boolean);

    const intro: string[] = [];
    const options: string[] = [];

    for (const line of lines) {
      // Detectar líneas que empiezan con "N." o "N)" donde N es un número
      const optionMatch = line.match(/^\d+[.)]\s*(.+)$/);
      if (optionMatch) {
        options.push(optionMatch[1].trim());
      } else if (options.length === 0) {
        // Todo lo que esté antes de la primera opción es la intro
        intro.push(line);
      }
      // Ignorar texto después de las opciones
    }

    if (options.length === 0) return null;

    return {
      intro: intro.join('\n'),
      options,
    };
  }

  /**
   * Formatea las opciones con emojis numéricos para WhatsApp.
   */
  public static formatOptionsForWhatsApp(intro: string, options: string[]): string {
    const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const formatted = options.map((opt, i) => `${NUMBER_EMOJIS[i] || `${i + 1}.`} ${opt}`).join('\n');
    return `${intro}\n\n${formatted}\n\nRespondé con el número para ver más detalles.`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FRENO DE AMBIGÜEDAD — métodos públicos
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Verifica si la respuesta del LLM contiene el tag [CLARIFY_QUESTION].
   */
  public static hasClarifyQuestion(response: string): boolean {
    return response.trimStart().startsWith('[CLARIFY_QUESTION]');
  }

  /**
   * Extrae la pregunta aclaratoria de una respuesta con [CLARIFY_QUESTION].
   * Retorna solo el texto de la pregunta, sin el tag.
   */
  public static parseClarifyQuestion(response: string): string | null {
    if (!AIQueryService.hasClarifyQuestion(response)) return null;
    const question = response.replace(/^\s*\[CLARIFY_QUESTION\]\s*/i, '').trim();
    return question || null;
  }

  /**
   * Genera la respuesta completa después de que el usuario resolvió la ambigüedad.
   * Reutiliza los contextos RAG y DB guardados en AmbiguityStateService.
   * NO consume cuota — la cuota ya fue consumida en la consulta original.
   */
  public async answerWithAmbiguityResolved(
    userId: string,
    clarification: string,
    originalPrompt: string,
    savedRagContext: string,
    savedDbContext: string,
    isAdmin = false,
  ): Promise<string> {
    logTuiProcessTrace(`[Ambiguity] Resolviendo para ${userId}: "${clarification}" (original: "${originalPrompt}")`);

    const tz = getSettings().timezone || 'America/Argentina/Cordoba';
    const now = new Date();
    const formattedDate = now.toLocaleString('es-AR', { timeZone: tz });
    const dayNameRaw = now.toLocaleDateString('es-AR', { timeZone: tz, weekday: 'long' });
    const dayName = dayNameRaw.charAt(0).toUpperCase() + dayNameRaw.slice(1);

    const resolvedPrompt = [
      `[Sistema] Fecha y hora actual: ${formattedDate} (${dayName}).`,
      '[INSTRUCCIÓN DE RESOLUCIÓN DE AMBIGÜEDAD]',
      `El usuario originalmente consultó: "${originalPrompt}"`,
      `Para aclarar, el bot le hizo una pregunta, y el usuario respondió: "${clarification}"`,
      'Con esta aclaración, ahora SÍ podés dar la respuesta COMPLETA, DETALLADA y ESPECÍFICA.',
      'Aplicá ÚNICAMENTE el escenario que corresponde a lo que el usuario acaba de confirmar.',
      'NO uses [CLARIFY_QUESTION] ni [OPTIONS_MENU] en esta respuesta. Respondé directamente.',
      'Si la respuesta del usuario sigue siendo ambigua, reformulá una pregunta aclaratoria',
      'más específica dentro del cuerpo del mensaje, sin usar ningún tag especial.',
      savedRagContext || '',
      savedDbContext ? `Contexto relevante:\n${savedDbContext}` : '',
      `Consulta original: "${originalPrompt}" — Aclaración del usuario: "${clarification}"`,
    ].filter(Boolean).join('\n\n');

    logTuiProcessTrace(`[Ambiguity] Invocando API del LLM para resolución...`);
    const aiText = await this.withTimeout(
      this.aiProvider.generateContent(userId, resolvedPrompt, originalPrompt),
      AIQueryService.RESPONSE_TIMEOUT_MS,
    );
    logTuiProcessTrace(`[Ambiguity] Respuesta de resolución recibida.`);

    return String(aiText || '').trim() || 'No pude generar una respuesta en este momento.';
  }

  /**
   * Genera una respuesta enriquecida exponiendo ragContext y dbContext.
   * Usado por el router para poder guardar los contextos en AmbiguityStateService
   * cuando el LLM emite [CLARIFY_QUESTION].
   * Solo aplica para usuarios en grupos (flujo IA con RAG).
   */
  public async answerEnriched(
    userId: string,
    prompt: string,
    now?: Date,
    isAdmin = false,
    groupId?: string,
  ): Promise<AIQueryResult> {
    const nowResolved = now || new Date();

    const impersonation = PrivateChatWorkflowService.getImpersonation(userId);
    const isRealAdmin = isAdmin || impersonation.isActive;
    const effectiveIsAdmin = impersonation.isActive ? false : isAdmin;
    const customLimit = impersonation.isActive ? impersonation.maxQuestions ?? undefined : undefined;

     // Chequeos previos — si alguno falla, retornamos el string de error envuelto en AIQueryResult
     const evalResult = await this.userModerationService.evaluate(userId, prompt, isRealAdmin, nowResolved);
     const isFeriaMode = process.env.FERIA_MODE === 'true' && process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true';
     if (evalResult.blocked && !isFeriaMode) {
       return { response: '[MODERATION::BAN] Estás temporalmente restringido de usar la IA.', ragContext: '', dbContext: '' };
     }
     if (this.isPromptLeakageAttempt(prompt)) {
       return { response: '¡Hola! Como asistente virtual del ISPC, estoy para ayudarte con consultas sobre materias, horarios, exámenes y temas académicos del instituto. No puedo compartir mis reglas de comportamiento ni configuraciones internas. ¿En qué te puedo ayudar hoy con respecto al ISPC?', ragContext: '', dbContext: '' };
     }
 
     const isExhausted = customLimit !== undefined
       ? await this.rateLimitService.isQuotaExhausted(userId, nowResolved, effectiveIsAdmin, customLimit)
       : await this.rateLimitService.isQuotaExhausted(userId, nowResolved, effectiveIsAdmin);
     if (isExhausted) {
       const decision = customLimit !== undefined
         ? await this.rateLimitService.checkAndConsume(userId, nowResolved, effectiveIsAdmin, customLimit)
         : await this.rateLimitService.checkAndConsume(userId, nowResolved, effectiveIsAdmin);
       const prefix = decision.newly_pending ? '[QUOTA_BLOCKED::NEW]' : '[QUOTA_BLOCKED::PENDING]';
       return { response: `${prefix} ${decision.message}`, ragContext: '', dbContext: '' };
     }
 
     if (isFeriaMode) {
       const feriaLog = `[Gateway] [Modo Feria] Filtros de intención suspendidos en consulta enriquecida. Procesando directamente.`;
       console.log(feriaLog);
       logTuiProcessTrace(feriaLog);
       return this.generateAnswer(userId, prompt, nowResolved, effectiveIsAdmin, groupId, customLimit);
     }
 
     const cls = await this.classifyPromptQualityAndTopic(prompt);
    if (cls.status === 'unclear') {
      return { response: this.generateClarifyingQuestion(prompt), ragContext: '', dbContext: '' };
    }
    if (cls.status === 'offtopic') {
      if (isRealAdmin) {
        return { response: 'Esta es una consulta clasificada como OFF-TOPIC por el guardrail, pero no se aplica sanción por ser Administrador.', ragContext: '', dbContext: '' };
      }
      const action = await this.userModerationService.handleInfraction(userId, undefined, cls.reason || 'offtopic', nowResolved);
      if (action.action === 'warn-private') return { response: `[MODERATION::WARN_PRIVATE] ${action.message}`, ragContext: '', dbContext: '' };
      if (action.action === 'warn-public-restrict') return { response: `[MODERATION::WARN_PUBLIC] ${action.message}`, ragContext: '', dbContext: '' };
      if (action.action === 'ban') return { response: `[MODERATION::BAN] ${action.message}`, ragContext: '', dbContext: '' };
      return { response: 'No pude procesar tu pedido.', ragContext: '', dbContext: '' };
    }

    return this.generateAnswer(userId, prompt, nowResolved, effectiveIsAdmin, groupId, customLimit);
  }
}
