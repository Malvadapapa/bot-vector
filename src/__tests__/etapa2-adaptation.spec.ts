import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { OnboardingTokenRepository } from '../features/onboarding/onboarding-token.repository.js';
import { YearLifecycleService } from '../features/academic-calendar/year-lifecycle.service.js';
import { SchedulerService } from '../scheduler/scheduler-service.js';

// Helper para crear base de datos en memoria para pruebas del repositorio
function createInMemoryDb(): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function runSql(db: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe('Etapa 2 — OnboardingTokenRepository', () => {
  let db: sqlite3.Database;
  let repo: OnboardingTokenRepository;

  beforeEach(async () => {
    db = await createInMemoryDb();
    // Habilitar claves foráneas
    await runSql(db, 'PRAGMA foreign_keys = ON;');
    
    // Crear tablas necesarias
    await runSql(
      db,
      `CREATE TABLE whatsapp_groups (
        group_id TEXT PRIMARY KEY,
        display_name TEXT,
        is_active INTEGER DEFAULT 1
      )`
    );

    await runSql(
      db,
      `CREATE TABLE onboarding_tokens (
        token TEXT PRIMARY KEY,
        group_id TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(group_id) REFERENCES whatsapp_groups(group_id) ON DELETE CASCADE
      )`
    );

    repo = new OnboardingTokenRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('debería registrar y validar un token de onboarding activo', async () => {
    // Registrar grupo
    await runSql(db, "INSERT INTO whatsapp_groups (group_id, display_name) VALUES ('g1@g.us', 'Grupo Test')");

    const expiresAt = new Date(Date.now() + 20 * 60 * 1000); // +20 min
    await repo.createToken('g1@g.us', 'test-token-123', expiresAt);

    const validatedGroupId = await repo.validateToken('test-token-123', new Date());
    expect(validatedGroupId).toBe('g1@g.us');
  });

  it('debería fallar la validación si el token ha expirado', async () => {
    await runSql(db, "INSERT INTO whatsapp_groups (group_id, display_name) VALUES ('g2@g.us', 'Grupo Test 2')");

    const expiresAt = new Date(Date.now() - 10 * 60 * 1000); // -10 min (expirado)
    await repo.createToken('g2@g.us', 'test-token-expired', expiresAt);

    const validatedGroupId = await repo.validateToken('test-token-expired', new Date());
    expect(validatedGroupId).toBeNull(); // Expirado
  });
});

describe('Etapa 2 — YearLifecycleService', () => {
  let mockGroupRepo: any;
  let mockGateway: any;
  let mockDedupRepo: any;
  let service: YearLifecycleService;

  beforeEach(() => {
    mockGroupRepo = {
      getAllActiveGroupsWithEntryYear: vi.fn().mockResolvedValue([
        { group_id: 'g1@g.us', display_name: 'Camada 2024', entry_year: 2024 },
        { group_id: 'g2@g.us', display_name: 'Grupo General', entry_year: null },
      ]),
    };
    mockGateway = {
      sendTextMessage: vi.fn().mockResolvedValue(undefined),
    };
    mockDedupRepo = {
      markIfNew: vi.fn().mockResolvedValue(true), // Por defecto acepta todos los envíos
    };

    service = new YearLifecycleService(mockGroupRepo, mockGateway, mockDedupRepo);
  });

  it('debería enviar mensaje de receso de invierno en Julio', async () => {
    const winterDate = new Date('2026-07-15T10:00:00-03:00'); // Julio 15
    await service.checkAndSendLifecycleMessages(winterDate);

    expect(mockGateway.sendTextMessage).toHaveBeenCalledTimes(2);
    expect(mockGateway.sendTextMessage).toHaveBeenCalledWith(
      'g1@g.us',
      expect.stringContaining('receso de invierno')
    );
  });

  it('debería enviar mensaje de fin de año en Diciembre', async () => {
    const endOfYearDate = new Date('2026-12-15T10:00:00-03:00'); // Diciembre 15
    await service.checkAndSendLifecycleMessages(endOfYearDate);

    expect(mockGateway.sendTextMessage).toHaveBeenCalledWith(
      'g1@g.us',
      expect.stringContaining('Cierre de ciclo lectivo')
    );
  });

  it('debería enviar mensaje de egresados solo a cohortes que egresan', async () => {
    const graduationDate = new Date('2026-12-20T10:00:00-03:00'); // Diciembre 20
    // g1 es cohorte 2024, en el año 2026 cumple 2 o más años de diferencia, por lo que egresa.
    // g2 no tiene cohorte (entry_year es null), por lo que no egresa.
    await service.checkAndSendLifecycleMessages(graduationDate);

    // g1 recibe saludo de fin de año + saludo de egresados. g2 solo recibe saludo de fin de año.
    // Busquemos las llamadas al gateway para ver si g1 recibió felicitaciones de egresados
    const graduationCalls = mockGateway.sendTextMessage.mock.calls.filter(
      (call: any) => call[0] === 'g1@g.us' && call[1].includes('EGRESADOS')
    );
    expect(graduationCalls.length).toBe(1);

    const g2GraduationCalls = mockGateway.sendTextMessage.mock.calls.filter(
      (call: any) => call[0] === 'g2@g.us' && call[1].includes('EGRESADOS')
    );
    expect(g2GraduationCalls.length).toBe(0); // g2 no egresa
  });
});

describe('Etapa 2 — ABP Alert Daemon (SchedulerService)', () => {
  let mockGroupRepo: any;
  let mockGateway: any;
  let mockDedupRepo: any;
  let mockExamRepo: any;
  let scheduler: SchedulerService;
  let db: sqlite3.Database;

  beforeEach(async () => {
    db = await createInMemoryDb();

    // Crear tablas necesarias simuladas para obtener admins en checkABPWarnings
    await runSql(db, 'CREATE TABLE IF NOT EXISTS group_admins (user_id TEXT, group_id TEXT)');
    await runSql(db, 'CREATE TABLE IF NOT EXISTS admin_users (user_id TEXT, is_super_admin INTEGER)');
    await runSql(db, "INSERT INTO admin_users (user_id, is_super_admin) VALUES ('sa@s.whatsapp.net', 1)");

    mockGroupRepo = {
      getAllActiveIds: vi.fn().mockResolvedValue(['g1@g.us']),
      findByGroupId: vi.fn().mockResolvedValue({ group_id: 'g1@g.us', display_name: 'Grupo 1' }),
      db,
    };
    mockGateway = {
      sendTextMessage: vi.fn().mockResolvedValue(undefined),
    };
    mockDedupRepo = {
      markIfNew: vi.fn().mockResolvedValue(true),
    };
    mockExamRepo = {
      listWithIds: vi.fn(),
    };

    scheduler = new SchedulerService(
      mockGroupRepo,
      mockGateway,
      {} as any, // rateLimitService
      {} as any, // reminderRepository
      {} as any, // confirmationRepository
      { log: vi.fn() } as any, // schedulerRunRepository
      {} as any, // dynamicMessageService
      {} as any, // classNotificationService
      {} as any, // userProfileRepository
      mockDedupRepo,
      mockExamRepo,
      {} as any // ragPipelineService
    );
  });

  afterEach(() => {
    db.close();
  });

  it('debería gatillar alerta ABP si hay >=3 evidencias y 0 Defensa ABP', async () => {
    // Configurar 3 evidencias en el mock
    mockExamRepo.listWithIds.mockResolvedValue([
      { id: 1, exam: { subject: 'Matemática', exam_type: 'Evidencia' } },
      { id: 2, exam: { subject: 'Matemática', exam_type: 'Evidencia' } },
      { id: 3, exam: { subject: 'Matemática', exam_type: 'Evidencia' } },
    ]);

    await scheduler.checkABPWarnings();

    // Debería enviarse la alerta al superadmin de fallback
    expect(mockGateway.sendTextMessage).toHaveBeenCalledWith(
      'sa@s.whatsapp.net',
      expect.stringContaining('Alerta ABP de Grupo: Grupo 1'),
      undefined,
      true
    );
  });

  it('NO debería gatillar alerta ABP si ya tiene programada la defensa ABP', async () => {
    // Configurar 3 evidencias y 1 defensa ABP
    mockExamRepo.listWithIds.mockResolvedValue([
      { id: 1, exam: { subject: 'Matemática', exam_type: 'Evidencia' } },
      { id: 2, exam: { subject: 'Matemática', exam_type: 'Evidencia' } },
      { id: 3, exam: { subject: 'Matemática', exam_type: 'Evidencia' } },
      { id: 4, exam: { subject: 'Matemática', exam_type: 'ABP' } },
    ]);

    await scheduler.checkABPWarnings();

    // No debe alertar
    expect(mockGateway.sendTextMessage).not.toHaveBeenCalled();
  });
});
