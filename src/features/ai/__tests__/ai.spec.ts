import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import { run } from '../../../shared/db/db-utils.js';
import { RateLimitRepository } from '../rate-limit.repository.js';
import { RateLimitService } from '../rate-limit.service.js';

describe('Slice de Inteligencia Artificial (Rate Limiting) - Pruebas', () => {
  let db: sqlite3.Database;
  let rateLimitRepo: RateLimitRepository;
  let rateLimitService: RateLimitService;

  beforeEach(async () => {
    // 1. Setup in-memory database
    db = new sqlite3.Database(':memory:');
    await run(db, `
      CREATE TABLE IF NOT EXISTS rate_limit (
        user_id TEXT PRIMARY KEY,
        question_count INTEGER NOT NULL DEFAULT 0,
        last_reset_date TEXT NOT NULL,
        bonus_questions_remaining INTEGER NOT NULL DEFAULT 0,
        approval_pending INTEGER NOT NULL DEFAULT 0,
        approval_requested_at TEXT,
        approval_expires_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    rateLimitRepo = new RateLimitRepository(db);
    rateLimitService = new RateLimitService(rateLimitRepo);
  });

  afterEach(async () => {
    // Clean up DB
    await new Promise<void>((resolve) => db.close(() => resolve()));
    vi.restoreAllMocks();
  });

  describe('RateLimitRepository', () => {
    it('debería retornar null para un usuario inexistente', async () => {
      const record = await rateLimitRepo.get('nonexistent');
      expect(record).toBeNull();
    });

    it('debería guardar y recuperar el límite de un usuario', async () => {
      const now = new Date();
      const record = {
        user_id: 'userA',
        question_count: 1,
        last_reset_date: new Date(now.toISOString().slice(0, 10)),
        bonus_questions_remaining: 2,
        approval_pending: true,
        approval_requested_at: now,
        approval_expires_at: new Date(now.getTime() + 3600000),
      };

      await rateLimitRepo.save(record);

      const retrieved = await rateLimitRepo.get('userA');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.user_id).toBe('userA');
      expect(retrieved?.question_count).toBe(1);
      expect(retrieved?.bonus_questions_remaining).toBe(2);
      expect(retrieved?.approval_pending).toBe(true);
      expect(retrieved?.last_reset_date.toISOString().slice(0, 10)).toBe(now.toISOString().slice(0, 10));
    });

    it('debería resetear todas las cuotas', async () => {
      const now = new Date();
      const record = {
        user_id: 'userA',
        question_count: 5,
        last_reset_date: new Date(now.getTime() - 86400000),
        bonus_questions_remaining: 0,
        approval_pending: true,
        approval_requested_at: now,
        approval_expires_at: now,
      };

      await rateLimitRepo.save(record);
      await rateLimitRepo.resetAll(now);

      const retrieved = await rateLimitRepo.get('userA');
      expect(retrieved?.question_count).toBe(0);
      expect(retrieved?.bonus_questions_remaining).toBe(0);
      expect(retrieved?.approval_pending).toBe(false);
      expect(retrieved?.approval_requested_at).toBeNull();
    });

    it('debería obtener la solicitud de aprobación pendiente más antigua', async () => {
      const now = new Date();
      const past1 = new Date(now.getTime() - 2000);
      const past2 = new Date(now.getTime() - 1000);

      await rateLimitRepo.save({
        user_id: 'user_newest',
        question_count: 2,
        last_reset_date: now,
        bonus_questions_remaining: 0,
        approval_pending: true,
        approval_requested_at: past2,
        approval_expires_at: new Date(now.getTime() + 10000),
      });

      await rateLimitRepo.save({
        user_id: 'user_oldest',
        question_count: 2,
        last_reset_date: now,
        bonus_questions_remaining: 0,
        approval_pending: true,
        approval_requested_at: past1,
        approval_expires_at: new Date(now.getTime() + 10000),
      });

      const oldest = await rateLimitRepo.getOldestPendingApproval(now);
      expect(oldest).not.toBeNull();
      expect(oldest?.user_id).toBe('user_oldest');
    });
  });

  describe('RateLimitService', () => {
    it('debería permitir solicitudes ilimitadas para administradores', async () => {
      const dec1 = await rateLimitService.checkAndConsume('adminUser', new Date(), true);
      expect(dec1.allowed).toBe(true);
      expect(dec1.remaining_after_request).toBeGreaterThan(1000);

      const dec2 = await rateLimitService.checkAndConsume('adminUser', new Date(), true);
      expect(dec2.allowed).toBe(true);
    });

    it('debería consumir cuotas diarias y luego bloquear pidiendo aprobación de admin', async () => {
      const now = new Date();
      
      // Primera pregunta
      const dec1 = await rateLimitService.checkAndConsume('userRegular', now, false);
      expect(dec1.allowed).toBe(true);
      expect(dec1.remaining_after_request).toBe(1);
      expect(dec1.quota_message).toContain('1');

      // Segunda pregunta (tope diario de 2)
      const dec2 = await rateLimitService.checkAndConsume('userRegular', now, false);
      expect(dec2.allowed).toBe(true);
      expect(dec2.remaining_after_request).toBe(0);
      expect(dec2.quota_message).toBeTruthy();

      // Tercera pregunta (bloqueada, inicia petición de aprobación)
      const dec3 = await rateLimitService.checkAndConsume('userRegular', now, false);
      expect(dec3.allowed).toBe(false);
      expect(dec3.approval_pending).toBe(true);

      const record = await rateLimitRepo.get('userRegular');
      expect(record?.approval_pending).toBe(true);
    });

    it('debería consumir preguntas extra una vez aprobadas por admin', async () => {
      const now = new Date();
      await rateLimitService.checkAndConsume('userX', now, false); // 1
      await rateLimitService.checkAndConsume('userX', now, false); // 2
      await rateLimitService.checkAndConsume('userX', now, false); // 3 (bloqueado, approval_pending = true)

      // Admin aprueba
      const approvalResult = await rateLimitService.approveNextPendingRequest(now);
      expect(approvalResult).not.toBeNull();
      expect(approvalResult?.userId).toBe('userX');
      expect(approvalResult?.extraQuestionsGranted).toBe(2);

      // Ahora debería dejar hacer 2 preguntas más
      const decExtra1 = await rateLimitService.checkAndConsume('userX', now, false);
      expect(decExtra1.allowed).toBe(true);
      expect(decExtra1.quota_message).toBeTruthy();

      const decExtra2 = await rateLimitService.checkAndConsume('userX', now, false);
      expect(decExtra2.allowed).toBe(true);

      // La tercera vuelve a bloquearse
      const decBlockedAgain = await rateLimitService.checkAndConsume('userX', now, false);
      expect(decBlockedAgain.allowed).toBe(false);
    });

    it('debería retornar los mensajes precisos para todos los estados de cuota y bloquear correctamente', async () => {
      const now = new Date();
      const userId = 'userPrecision';

      // 1. Primera pregunta (Quedan preguntas diarias)
      const dec1 = await rateLimitService.checkAndConsume(userId, now, false);
      expect(dec1.allowed).toBe(true);
      expect(dec1.quota_message).toBe('Por recursos limitados hoy te puedo responder hasta 2 preguntas. Te quedan 1.');

      // 2. Segunda pregunta (Se agotan las preguntas diarias)
      const dec2 = await rateLimitService.checkAndConsume(userId, now, false);
      expect(dec2.allowed).toBe(true);
      expect(dec2.quota_message).toBe('Llegaste al tope diario de 2 preguntas. Si necesitás seguir, tu próxima consulta registrará automáticamente un pedido de aprobación para obtener preguntas extra.');

      // 3. Tercera pregunta (Bloqueado - Primera solicitud de aprobación)
      const dec3 = await rateLimitService.checkAndConsume(userId, now, false);
      expect(dec3.allowed).toBe(false);
      expect(dec3.message).toBe('Te quedaste sin preguntas por hoy. Ya registré tu solicitud de aprobación para que un administrador te habilite 2 preguntas extra.');
      expect(dec3.newly_pending).toBe(true);

      // 4. Cuarta pregunta (Bloqueado - Ya pendiente)
      const dec4 = await rateLimitService.checkAndConsume(userId, now, false);
      expect(dec4.allowed).toBe(false);
      expect(dec4.message).toBe('Tu solicitud de aprobación sigue pendiente. Por favor, esperá a que un administrador la apruebe para poder continuar.');
      expect(dec4.newly_pending).toBe(false);

      // Admin aprueba
      await rateLimitService.approveNextPendingRequest(now);

      // 5. Quinta pregunta (Primer bonus - Quedan preguntas extra)
      const dec5 = await rateLimitService.checkAndConsume(userId, now, false);
      expect(dec5.allowed).toBe(true);
      expect(dec5.quota_message).toBe('Tenés aprobación de admin: te quedan 1 preguntas extra hoy.');

      // 6. Sexta pregunta (Segundo bonus - Se agotan las preguntas extra)
      const dec6 = await rateLimitService.checkAndConsume(userId, now, false);
      expect(dec6.allowed).toBe(true);
      expect(dec6.quota_message).toBe('Consumiste tu última pregunta extra aprobada por el administrador. Si volvés a consultar, se registrará una nueva solicitud de aprobación.');

      // 7. Séptima pregunta (Bloqueado - Nueva solicitud tras consumir extras)
      const dec7 = await rateLimitService.checkAndConsume(userId, now, false);
      expect(dec7.allowed).toBe(false);
      expect(dec7.message).toBe('Consumiste todas tus preguntas extra. Ya registré una nueva solicitud de aprobación para que un administrador te habilite otras 2 preguntas.');
      expect(dec7.newly_pending).toBe(true);
    });

    it('debería procesar de forma atómica y ordenada múltiples llamadas concurrentes', async () => {
      const now = new Date();
      const userId = 'userConcurrent';

      // Disparamos 4 llamadas concurrentes (sabiendo que el límite diario es 2)
      const promises = [
        rateLimitService.checkAndConsume(userId, now, false),
        rateLimitService.checkAndConsume(userId, now, false),
        rateLimitService.checkAndConsume(userId, now, false),
        rateLimitService.checkAndConsume(userId, now, false),
      ];

      const results = await Promise.all(promises);

      // El orden de resolución debe ser el orden de llamada, por lo que:
      // Las primeras dos deben estar permitidas, las últimas dos bloqueadas
      expect(results[0].allowed).toBe(true);
      expect(results[1].allowed).toBe(true);
      expect(results[2].allowed).toBe(false);
      expect(results[3].allowed).toBe(false);

      // La tercera debe ser newly_pending = true
      expect(results[2].newly_pending).toBe(true);
      // La cuarta debe ser newly_pending = false
      expect(results[3].newly_pending).toBe(false);
    });
  });
});
