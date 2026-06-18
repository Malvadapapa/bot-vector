import { AcademicCalendarService } from '../academic-calendar/academic-calendar.service.js';
import { AIQueryService, AIQueryResult } from '../ai/ai-query.service.js';
import { ConversationStateService } from '../conversation/conversation-state.service.js';
import { OptionsStateService } from '../conversation/options-state.service.js';
import { AmbiguityStateService } from '../conversation/ambiguity-state.service.js';
import { MessageIntentParserService } from './message-intent-parser.service.js';
import { DailyGreetingRepository } from './messages.repository.js';
import { getSettings } from '../../shared/config/settings.js';
import { formatLocalDateOnly } from '../../shared/db/db-utils.js';

/**
 * Resultado de enrutamiento de un mensaje.
 * - `reply`: texto a enviar al usuario.
 * - `clarifyContext`: presente solo cuando el LLM emitió [CLARIFY_QUESTION];
 *   contiene los contextos RAG y DB para persistir en AmbiguityStateService.
 */
export interface RouteResult {
  reply: string;
  clarifyContext?: {
    ragContext: string;
    dbContext: string;
    originalPrompt: string;
    clarifyingQuestion: string;
  };
}

export class MessageRouter {
  private static BOT_MENTION_ALIASES = ['@vectorito', '@Vectorito'];

  private static HELLO_JOKES = [
    'Chiste nerd: mi compu y yo tenemos una relación estable... se cuelga, pero vuelve.',
    'Chiste corto: iba a contar un chiste de SQL, pero era muy selectivo.',
    'Chistecito: debuggear es como ser detective en una peli de crimen donde vos mismo sos el culpable.',
    'Chiste express: prometí código limpio y terminé barriendo warnings abajo de la alfombra.',
    'Chiste relámpago: quise ordenar mi vida como un array, pero me faltó el método sort.',
  ];

  private static HELLO_FOLLOWUP_POLITE = [
    'Ya te saludé hoy 😊 Contame, ¿qué necesitás y te ayudo?',
    '¡Seguimos en línea! Decime qué necesitás y lo vemos juntos 🙌',
    'Acá estoy para ayudarte. ¿Qué querés resolver ahora?',
  ];

  private static HELLO_TOO_MANY = [
    'Hola. Decime en qué puedo ayudarte hoy 🙂',
    'Acá sigo a tu disposición. ¿Qué consulta tenés? 🙂',
    'Hola de nuevo. ¿Qué necesitás consultar? 🙂',
  ];

  private static EMPTY_PROMPTS = [
    'Hola. Probá con !menu, !hoy, !semana, !avisos o !noticias.',
    'Hola. Decime cómo te puedo ayudar. Podés usar !menu, !hoy, !semana, !avisos o !noticias.',
    'Hola. Estoy activo por acá. Podés usar !menu, !hoy, !semana, !avisos o !noticias.',
  ];

  constructor(
    private messageIntentParserService: MessageIntentParserService,
    private calendarService: AcademicCalendarService,
    private conversationService: ConversationStateService,
    private aiQueryService: AIQueryService,
    private dailyGreetingRepository: DailyGreetingRepository,
    private optionsStateService: OptionsStateService = new OptionsStateService(),
    private ambiguityStateService: AmbiguityStateService = new AmbiguityStateService(),
  ) {}

  private helloAttemptsByUserDay = new Map<string, number>();

  public hasActiveMenuState(userId: string): boolean {
    return this.calendarService.hasActiveMenuState(userId);
  }

  public async route(
    userId: string,
    text: string,
    now?: Date,
    allowAI = true,
    isGlobalAdmin = false,
    isGroupAdmin = false,
    forceAI = false,
    groupId?: string,
    isSuperAdmin = false,
  ): Promise<RouteResult | null> {
    const routedText = this.normalizeInvocation(text);
    if (!routedText) {
      return { reply: this.pickOne(MessageRouter.EMPTY_PROMPTS) };
    }

    const normalized = routedText.trim().toLowerCase();
    const isCommand = normalized.startsWith('!');
    const isAdmin = isGlobalAdmin || isSuperAdmin;

    // Si el mensaje llega por arroba, forzamos IA (excepto comandos explícitos).
    if (forceAI && !isCommand) {
      // En grupos con mención: verificar opciones pendientes primero
      if (groupId && this.optionsStateService.hasPendingOptions(userId)) {
        const selected = this.optionsStateService.getSelectedOption(userId, normalized);
        if (selected) {
          const reply = await this.aiQueryService.answerSelectedOption(userId, selected.selectedOption, selected.originalPrompt, isAdmin, groupId);
          return { reply };
        }
        // Si no es un número válido, limpiar opciones y procesar normalmente
        this.optionsStateService.clear(userId);
      }
      return this.handleGroupAIResponse(userId, routedText, now, isAdmin, groupId);
    }

    if (normalized === '!hola') {
      return { reply: await this.handleHello(userId, now) };
    }

    const menuResponse = await this.calendarService.handleMenuInput(userId, routedText, groupId);
    if (menuResponse !== null) {
      // Si el usuario entra al menú estático, limpiar opciones de IA pendientes
      this.optionsStateService.clear(userId);
      return { reply: menuResponse };
    }

    const parsed = this.messageIntentParserService.parseMessage(routedText, now);

    if (parsed.intent === 'command') {
      const reply = await this.calendarService.handleCommand(userId, parsed.normalized_text, now, isAdmin, groupId, isGroupAdmin, isSuperAdmin);
      return reply !== null ? { reply } : null;
    }

    const stateAction = await this.conversationService.processMessage(userId, parsed.normalized_text, parsed, now);
    if (stateAction.action_type !== 'none') {
      return stateAction.response_text !== null ? { reply: stateAction.response_text } : null;
    }

    // En grupos: verificar si hay opciones de IA pendientes y el usuario respondió con un número
    if (groupId && this.optionsStateService.hasPendingOptions(userId)) {
      const selected = this.optionsStateService.getSelectedOption(userId, normalized);
      if (selected) {
        const reply = await this.aiQueryService.answerSelectedOption(userId, selected.selectedOption, selected.originalPrompt, isAdmin, groupId);
        return { reply };
      }
      // Si envió texto libre (no un número), limpiar opciones y continuar con IA
      this.optionsStateService.clear(userId);
    }

    if (!allowAI) return null;
    // En grupos: manejar respuesta con posible [OPTIONS_MENU] o [CLARIFY_QUESTION]
    if (groupId) {
      return this.handleGroupAIResponse(userId, routedText, now, isAdmin, groupId);
    }
    // Privado: flujo simple sin freno de ambigüedad
    const reply = await this.aiQueryService.answer(userId, routedText, now, isAdmin, groupId);
    return { reply };
  }

  private normalizeInvocation(text: string): string {
    const cleaned = text.trim();
    const lowered = cleaned.toLowerCase();

    for (const alias of MessageRouter.BOT_MENTION_ALIASES) {
      if (lowered.startsWith(alias)) {
        return cleaned.slice(alias.length).trim().replace(/^[,:;\-\s]+/, '');
      }
    }

    return cleaned;
  }

  private async handleHello(userId: string, now?: Date): Promise<string> {
    const localNow = now ?? new Date();
    const dayKey = `${userId}:${formatLocalDateOnly(localNow)}`;
    const attempts = (this.helloAttemptsByUserDay.get(dayKey) || 0) + 1;
    this.helloAttemptsByUserDay.set(dayKey, attempts);

    const alreadyGreeted = await this.dailyGreetingRepository.hasGreeted(userId, localNow);

    if (alreadyGreeted) {
      if (attempts > 3) {
        return this.pickOne(MessageRouter.HELLO_TOO_MANY);
      }
      return this.pickOne(MessageRouter.HELLO_FOLLOWUP_POLITE);
    }

    await this.dailyGreetingRepository.markGreeted(userId, localNow);
    const greeting = this.pickGreetingByHour(localNow);
    
    const rand = Math.random();
    if (rand < 0.3) {
      // 30% chiste
      return `${greeting} 😄 ${this.pickOne(MessageRouter.HELLO_JOKES)}`;
    } else if (rand < 0.6) {
      // 30% sugerencia de ejemplos
      const examples = [
        'Podés preguntarme sobre correlativas de las materias, horarios de cursada o las últimas noticias del ISPC.',
        '¿En qué te ayudo? Podés escribirme !menu para ver todas las opciones o preguntarme por los exámenes.',
        'Recordá que podés usar comandos rápidos como !hoy, !avisos o directamente hacerme una consulta académica.',
      ];
      return `${greeting} ${this.pickOne(examples)}`;
    }
    
    // 40% saludo simple
    return greeting;
  }

  private pickGreetingByHour(now: Date): string {
    const tz = getSettings().timezone || 'America/Argentina/Cordoba';
    const parts = new Intl.DateTimeFormat('es-AR', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false
    }).formatToParts(now);
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? now.getHours());
    
    if (hour >= 5 && hour < 12) return this.pickOne(['Hola, buen día.', 'Buen día, ¿cómo va?', 'Hola, muy buen día.']);
    if (hour >= 12 && hour < 20) return this.pickOne(['Hola, buenas tardes.', 'Buenas tardes, ¿todo bien?', 'Hola, muy buenas tardes.']);
    return this.pickOne(['Hola, buenas noches.', 'Buenas noches, ¿cómo andás?', 'Hola, muy buenas noches.']);
  }

  private pickOne(options: string[]): string {
    return options[Math.floor(Math.random() * options.length)];
  }

  /**
   * Envuelve la llamada a la IA y detecta si la respuesta contiene
   * [OPTIONS_MENU] o [CLARIFY_QUESTION].
   *
   * - [OPTIONS_MENU]: guarda las opciones en OptionsStateService y formatea emojis.
   * - [CLARIFY_QUESTION]: empaqueta ragContext/dbContext en clarifyContext para que
   *   el gateway los persista en AmbiguityStateService.
   *
   * Solo se usa en contexto de grupo.
   */
  private async handleGroupAIResponse(
    userId: string,
    prompt: string,
    now?: Date,
    isAdmin = false,
    groupId?: string,
  ): Promise<RouteResult> {
    const result = await this.aiQueryService.answerEnriched(userId, prompt, now, isAdmin, groupId);
    const { response, ragContext, dbContext } = result;

    if (!groupId) return { reply: response };

    // — Caso 1: Pregunta aclaratoria del Freno de Ambigüedad
    if (AIQueryService.hasClarifyQuestion(response)) {
      const question = AIQueryService.parseClarifyQuestion(response);
      if (question) {
        return {
          reply: question,
          clarifyContext: {
            ragContext,
            dbContext,
            originalPrompt: prompt,
            clarifyingQuestion: question,
          },
        };
      }
    }

    // — Caso 2: Menú de opciones
    const parsedMenu = AIQueryService.parseOptionsMenu(response);
    if (parsedMenu && parsedMenu.options.length > 0) {
      this.optionsStateService.saveOptions(userId, prompt, parsedMenu.options);
      return { reply: AIQueryService.formatOptionsForWhatsApp(parsedMenu.intro, parsedMenu.options) };
    }

    // — Caso 3: Respuesta directa
    return { reply: response };
  }

  /**
   * Heurística estricta para detectar si el mensaje del usuario es una pregunta nueva
   * y no una respuesta a la pregunta aclaratoria del bot.
   *
   * Retorna true (cambio de tema) SOLO si:
   * 1. El mensaje contiene frases explícitas de cancelación, O
   * 2. El mensaje contiene signos de interrogación Y es suficientemente largo (> 25 chars).
   *
   * En cualquier otro caso (incluyendo respuestas cortas o ambiguas) asume que el
   * usuario está respondiendo la pregunta aclaratoria.
   */
  public static seemsTopicChange(userResponse: string, _clarifyingQuestion: string): boolean {
    const text = userResponse.trim();

    // Regla 1: frases explícitas de cancelación
    const CANCEL_PATTERNS = [
      /\bolvidalo\b/i,
      /\bcancelar\b/i,
      /\bolvida(te|lo)?\b/i,
      /\botra\s+(?:cosa|pregunta|consulta)\b/i,
      /\bcambiando\s+de\s+tema\b/i,
      /\bno\s+importa\b/i,
      /\bdejalo\b/i,
    ];
    if (CANCEL_PATTERNS.some(p => p.test(text))) return true;

    // Regla 2: pregunta nueva (interrogación + longitud suficiente)
    const hasQuestion = text.includes('?') || text.includes('¿');
    if (hasQuestion && text.length > 25) return true;

    return false;
  }
}
