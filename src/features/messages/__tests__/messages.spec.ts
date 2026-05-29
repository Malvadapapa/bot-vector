import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import { run } from '../../../shared/db/db-utils.js';
import { DailyGreetingRepository, OutboxDedupRepository } from '../messages.repository.js';
import { MessageIntentParserService } from '../message-intent-parser.service.js';
import { DynamicMessageService } from '../dynamic-message.service.js';
import { MessageRouter } from '../message-router.service.js';

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
  });
});
