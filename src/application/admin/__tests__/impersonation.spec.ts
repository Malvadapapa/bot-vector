import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import { run } from '../../../shared/db/db-utils.js';
import { PrivateChatWorkflowService } from '../private-chat-workflow.service.js';
import { RateLimitRepository } from '../../../features/ai/rate-limit.repository.js';
import { RateLimitService } from '../../../features/ai/rate-limit.service.js';

describe('Modo Simulación Alumno (Impersonation) - Pruebas', () => {
  let db: sqlite3.Database;
  let rateLimitRepo: RateLimitRepository;
  let rateLimitService: RateLimitService;

  beforeEach(async () => {
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
    await new Promise<void>((resolve) => db.close(() => resolve()));
    vi.restoreAllMocks();
    // Clean up static maps
    PrivateChatWorkflowService.impersonations.clear();
  });

  it('debería inicializar y manipular el estado de simulación para un administrador', () => {
    const userId = 'admin-jid';
    const imp = PrivateChatWorkflowService.getImpersonation(userId);
    
    expect(imp.isActive).toBe(false);
    expect(imp.commissionId).toBeNull();
    expect(imp.maxQuestions).toBeNull();

    imp.isActive = true;
    imp.commissionId = 123;
    imp.maxQuestions = 5;

    const retrieved = PrivateChatWorkflowService.getImpersonation(userId);
    expect(retrieved.isActive).toBe(true);
    expect(retrieved.commissionId).toBe(123);
    expect(retrieved.maxQuestions).toBe(5);
  });

  it('debería reiniciar la cuota diaria del usuario a 0 en la base de datos', async () => {
    const userId = 'user-jid';
    const now = new Date();
    const localDate = new Date(now.toISOString().slice(0, 10));

    await rateLimitRepo.save({
      user_id: userId,
      question_count: 5,
      last_reset_date: localDate,
      bonus_questions_remaining: 1,
      approval_pending: true,
      approval_requested_at: now,
      approval_expires_at: now,
    });

    const before = await rateLimitRepo.get(userId);
    expect(before?.question_count).toBe(5);
    expect(before?.bonus_questions_remaining).toBe(1);
    expect(before?.approval_pending).toBe(true);

    await rateLimitService.resetUserQuota(userId);

    const after = await rateLimitRepo.get(userId);
    expect(after?.question_count).toBe(0);
    expect(after?.bonus_questions_remaining).toBe(0);
    expect(after?.approval_pending).toBe(false);
    expect(after?.approval_requested_at).toBeNull();
  });

  it('debería aplicar el límite diario personalizado (customDailyLimit) en isQuotaExhausted y checkAndConsume', async () => {
    const userId = 'user-jid';
    const now = new Date();

    // Si limitamos a 1 consulta diaria y consume 1
    const decision1 = await rateLimitService.checkAndConsume(userId, now, false, 1);
    expect(decision1.allowed).toBe(true);
    expect(decision1.remaining_after_request).toBe(0);

    // La segunda consulta debería estar bloqueada
    const isExhausted = await rateLimitService.isQuotaExhausted(userId, now, false, 1);
    expect(isExhausted).toBe(true);

    const decision2 = await rateLimitService.checkAndConsume(userId, now, false, 1);
    expect(decision2.allowed).toBe(false);
    expect(decision2.approval_pending).toBe(true);
  });
});
