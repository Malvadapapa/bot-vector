import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import { run } from '../../../shared/db/db-utils.js';
import { DailyGreetingRepository, OutboxDedupRepository } from '../messages.repository.js';
import { MessageIntentParserService } from '../message-intent-parser.service.js';
import { DynamicMessageService } from '../dynamic-message.service.js';
import { MessageRouter } from '../message-router.service.js';
import { OptionsStateService } from '../../conversation/options-state.service.js';


describe('Slice de Mensajes - Pruebas Unitarias', () => {
  let db: sqlite3.Database;
  let dailyGreetingRepo: DailyGreetingRepository;
  let outboxDedupRepo: OutboxDedupRepository;

  beforeEach(async () => {
    db = new sqlite3.Database(':memory:');

    await run(db, `
      CREATE TABLE IF NOT EXISTS user_daily_greetings (
        user_id TEXT NOT NULL,
        greeting_date TEXT NOT NULL,
        PRIMARY KEY (user_id, greeting_date)
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS outbox_dedup (
        message_key TEXT PRIMARY KEY,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    dailyGreetingRepo = new DailyGreetingRepository(db);
    outboxDedupRepo = new OutboxDedupRepository(db);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => db.close(() => resolve()));
    vi.restoreAllMocks();
  });

  describe('DailyGreetingRepository', () => {
    it('debería registrar y verificar saludos diarios del usuario', async () => {
      const today = new Date();
      const user = 'user123';

      const alreadyGreetedBefore = await dailyGreetingRepo.hasGreeted(user, today);
      expect(alreadyGreetedBefore).toBe(false);

      await dailyGreetingRepo.markGreeted(user, today);

      const alreadyGreetedAfter = await dailyGreetingRepo.hasGreeted(user, today);
      expect(alreadyGreetedAfter).toBe(true);
    });
  });

  describe('OutboxDedupRepository', () => {
    it('debería permitir registrar clave de mensaje nueva y evitar duplicados', async () => {
      const key = 'msg_unique_hash_1';

      const isNew = await outboxDedupRepo.markIfNew(key);
      expect(isNew).toBe(true);

      const isNewAgain = await outboxDedupRepo.markIfNew(key);
      expect(isNewAgain).toBe(false);
    });
  });

  describe('MessageIntentParserService', () => {
    it('debería parsear comandos que comienzan con !', () => {
      const parser = new MessageIntentParserService();
      const res = parser.parseMessage('!ayuda');

      expect(res.intent).toBe('command');
      expect(res.normalized_text).toBe('!ayuda');
    });

    it('debería detectar intención de crear recordatorio cuando hay palabras clave y fechas', () => {
      const parser = new MessageIntentParserService();
      const res = parser.parseMessage('recordarme del examen el 15/06/2026');

      expect(res.intent).toBe('create_reminder');
      expect(res.probable_date).toBeInstanceOf(Date);
      expect(res.probable_date?.getDate()).toBe(15);
      expect(res.probable_date?.getMonth()).toBe(5); // 0-indexed, so 5 is June
    });
  });

  describe('MessageRouter', () => {
    it('debería enrutar !hola a un saludo', async () => {
      const mockIntentParser = {
        parseMessage: vi.fn(),
      } as any;
      const mockCalendarService = {
        hasActiveMenuState: vi.fn().mockReturnValue(false),
        handleMenuInput: vi.fn().mockResolvedValue(null),
      } as any;
      const mockConversationService = {} as any;
      const mockAIQueryService = {} as any;

      const router = new MessageRouter(
        mockIntentParser,
        mockCalendarService,
        mockConversationService,
        mockAIQueryService,
        dailyGreetingRepo
      );

      const response = await router.route('userA', '!hola', new Date());
      expect(response).not.toBeNull();
      expect(response).toBeTruthy();
    });

    it('debería pasar groupId al flujo de IA cuando el mensaje no es comando', async () => {
      const mockIntentParser = {
        parseMessage: vi.fn().mockReturnValue({ intent: 'none', normalized_text: 'consulta normal' }),
      } as any;

      const mockCalendarService = {
        hasActiveMenuState: vi.fn().mockReturnValue(false),
        handleMenuInput: vi.fn().mockResolvedValue(null),
      } as any;

      const mockConversationService = {
        processMessage: vi.fn().mockResolvedValue({ action_type: 'none', response_text: '' }),
      } as any;

      const mockAIQueryService = {
        answer: vi.fn().mockResolvedValue('respuesta ia'),
      } as any;

      const router = new MessageRouter(
        mockIntentParser,
        mockCalendarService,
        mockConversationService,
        mockAIQueryService,
        dailyGreetingRepo
      );

      const result = await router.route(
        'userA',
        'consulta normal',
        new Date('2026-06-04T12:00:00Z'),
        true,
        false,
        false,
        false,
        'groupA@g.us',
        false,
      );

      expect(result).toBe('respuesta ia');
      expect(mockAIQueryService.answer).toHaveBeenCalledWith(
        'userA',
        'consulta normal',
        expect.any(Date),
        false,
        'groupA@g.us',
      );
    });

    it('debería procesar flujo de opciones cuando la IA retorna [OPTIONS_MENU] en grupos', async () => {
      const mockIntentParser = {
        parseMessage: vi.fn().mockReturnValue({ intent: 'none', normalized_text: 'que tramites' }),
      } as any;

      const mockCalendarService = {
        hasActiveMenuState: vi.fn().mockReturnValue(false),
        handleMenuInput: vi.fn().mockResolvedValue(null),
      } as any;

      const mockConversationService = {
        processMessage: vi.fn().mockResolvedValue({ action_type: 'none', response_text: '' }),
      } as any;

      const mockAIQueryService = {
        answer: vi.fn().mockResolvedValue('[OPTIONS_MENU]\nElige un trámite:\n1. Equivalencias\n2. Regularidad'),
        answerSelectedOption: vi.fn().mockResolvedValue('Detalle de Equivalencias'),
      } as any;

      const optionsStateService = new OptionsStateService();

      const router = new MessageRouter(
        mockIntentParser,
        mockCalendarService,
        mockConversationService,
        mockAIQueryService,
        dailyGreetingRepo,
        optionsStateService
      );

      // 1. Enviar consulta amplia en grupo -> Debe detectar el menú y guardar opciones
      const step1Result = await router.route(
        'userA',
        'que tramites',
        new Date(),
        true,
        false,
        false,
        false,
        'groupA@g.us',
        false,
      );

      expect(step1Result).toContain('Elige un trámite:');
      expect(step1Result).toContain('1️⃣ Equivalencias');
      expect(step1Result).toContain('2️⃣ Regularidad');
      expect(optionsStateService.hasPendingOptions('userA')).toBe(true);

      // 2. Enviar número válido '1' -> Debe llamar a answerSelectedOption
      const step2Result = await router.route(
        'userA',
        '1',
        new Date(),
        true,
        false,
        false,
        false,
        'groupA@g.us',
        false,
      );

      expect(step2Result).toBe('Detalle de Equivalencias');
      expect(mockAIQueryService.answerSelectedOption).toHaveBeenCalledWith(
        'userA',
        'Equivalencias',
        'que tramites',
        false,
        'groupA@g.us'
      );
      expect(optionsStateService.hasPendingOptions('userA')).toBe(false);
    });

    it('debería limpiar opciones pendientes si se recibe un input no numérico', async () => {
      const mockIntentParser = {
        parseMessage: vi.fn().mockReturnValue({ intent: 'none', normalized_text: 'otra cosa' }),
      } as any;

      const mockCalendarService = {
        hasActiveMenuState: vi.fn().mockReturnValue(false),
        handleMenuInput: vi.fn().mockResolvedValue(null),
      } as any;

      const mockConversationService = {
        processMessage: vi.fn().mockResolvedValue({ action_type: 'none', response_text: '' }),
      } as any;

      const mockAIQueryService = {
        answer: vi.fn().mockResolvedValue('respuesta nueva'),
      } as any;

      const optionsStateService = new OptionsStateService();
      optionsStateService.saveOptions('userA', 'que tramites', ['Equivalencias', 'Regularidad']);

      const router = new MessageRouter(
        mockIntentParser,
        mockCalendarService,
        mockConversationService,
        mockAIQueryService,
        dailyGreetingRepo,
        optionsStateService
      );

      const result = await router.route(
        'userA',
        'otra cosa',
        new Date(),
        true,
        false,
        false,
        false,
        'groupA@g.us',
        false,
      );

      expect(result).toBe('respuesta nueva');
      expect(optionsStateService.hasPendingOptions('userA')).toBe(false);
    });

    it('no debería activar opciones de menú si se está en privado (sin groupId)', async () => {
      const mockIntentParser = {
        parseMessage: vi.fn().mockReturnValue({ intent: 'none', normalized_text: 'que tramites' }),
      } as any;

      const mockCalendarService = {
        hasActiveMenuState: vi.fn().mockReturnValue(false),
        handleMenuInput: vi.fn().mockResolvedValue(null),
      } as any;

      const mockConversationService = {
        processMessage: vi.fn().mockResolvedValue({ action_type: 'none', response_text: '' }),
      } as any;

      const mockAIQueryService = {
        answer: vi.fn().mockResolvedValue('[OPTIONS_MENU]\nIntro:\n1. Opcion A'),
      } as any;

      const optionsStateService = new OptionsStateService();

      const router = new MessageRouter(
        mockIntentParser,
        mockCalendarService,
        mockConversationService,
        mockAIQueryService,
        dailyGreetingRepo,
        optionsStateService
      );

      const result = await router.route(
        'userA',
        'que tramites',
        new Date(),
        true,
        false,
        false,
        false,
        undefined, // privado
        false,
      );

      // En privado no debe formatear con emojis ni guardar en el servicio
      expect(result).toBe('[OPTIONS_MENU]\nIntro:\n1. Opcion A');
      expect(optionsStateService.hasPendingOptions('userA')).toBe(false);
    });
  });
});

