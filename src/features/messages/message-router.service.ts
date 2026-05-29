import { AcademicCalendarService } from '../academic-calendar/academic-calendar.service.js';
import { AIQueryService } from '../ai/ai-query.service.js';
import { ConversationStateService } from '../conversation/conversation-state.service.js';
import { MessageIntentParserService } from './message-intent-parser.service.js';
import { DailyGreetingRepository } from './messages.repository.js';

export class MessageRouter {
  private static BOT_MENTION_ALIASES = ['@cabezon', '@cabezón'];

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
    'Si seguís saludando así te saco del grupo... mentira 😄 ¿qué necesitás?',
    'Un saludo más y te baneo del grupo... es chiste 😅 Decime en qué te ayudo.',
    'Te voy a expulsar por exceso de hola... nah, broma 😄 Contame qué necesitás.',
  ];

  private static EMPTY_PROMPTS = [
    'Estoy por acá, che. Probá con !menu, !hoy, !semana, !avisos o !noticias.',
    'Acá ando, chango. Tirame !menu, !hoy, !semana, !avisos o !noticias.',
    'Todo bien por acá, máquina. Podés usar !menu, !hoy, !semana, !avisos o !noticias.',
  ];

  constructor(
    private messageIntentParserService: MessageIntentParserService,
    private calendarService: AcademicCalendarService,
    private conversationService: ConversationStateService,
    private aiQueryService: AIQueryService,
    private dailyGreetingRepository: DailyGreetingRepository,
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
  ): Promise<string | null> {
    const routedText = this.normalizeInvocation(text);
    if (!routedText) {
      return this.pickOne(MessageRouter.EMPTY_PROMPTS);
    }

    const normalized = routedText.trim().toLowerCase();
    const isCommand = normalized.startsWith('!');
    const isAdmin = isGlobalAdmin || isSuperAdmin;

    // Si el mensaje llega por arroba, forzamos IA (excepto comandos explícitos).
    if (forceAI && !isCommand) {
      return this.aiQueryService.answer(userId, routedText, now, isAdmin);
    }

    if (normalized === '!hola') {
      return this.handleHello(userId, now);
    }

    const menuResponse = await this.calendarService.handleMenuInput(userId, routedText, groupId);
    if (menuResponse !== null) {
      return menuResponse;
    }

    const parsed = this.messageIntentParserService.parseMessage(routedText, now);

    if (parsed.intent === 'command') {
      return this.calendarService.handleCommand(userId, parsed.normalized_text, now, isAdmin, groupId, isGroupAdmin, isSuperAdmin);
    }

    const stateAction = await this.conversationService.processMessage(userId, parsed.normalized_text, parsed, now);
    if (stateAction.action_type !== 'none') {
      return stateAction.response_text;
    }

    if (!allowAI) return null;
    return this.aiQueryService.answer(userId, routedText, now, isAdmin);
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
    const dayKey = `${userId}:${localNow.toISOString().slice(0, 10)}`;
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
    const hour = now.getHours();
    if (hour >= 5 && hour < 12) return this.pickOne(['Hola, buen día.', 'Buen día, ¿cómo va?', 'Hola, muy buen día.']);
    if (hour >= 12 && hour < 20) return this.pickOne(['Hola, buenas tardes.', 'Buenas tardes, ¿todo bien?', 'Hola, muy buenas tardes.']);
    return this.pickOne(['Hola, buenas noches.', 'Buenas noches, ¿cómo andás?', 'Hola, muy buenas noches.']);
  }

  private pickOne(options: string[]): string {
    return options[Math.floor(Math.random() * options.length)];
  }
}
