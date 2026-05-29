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
  });
});
