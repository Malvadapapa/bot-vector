import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { vi } from 'vitest';

describe('Fase 6 E2E - !config-grupo flow', () => {
  let db: sqlite3.Database;
  let userProfileRepo: any;
  let adminRepo: any;
  let adminCodeRepo: any;
  let noticeRepo: any;
  let examRepo: any;
  let classRepo: any;
  let teacherRepo: any;
  let moderationRepo: any;
  let groupContextRepo: any;
  let commissionRepo: any;
  let svc: any;

  beforeAll(async () => {
    db = new sqlite3.Database(':memory:');
    // Dynamic imports to avoid ESM resolver issues in the test runner
    const baseDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationsModule = await import(path.join(baseDir, '..', 'shared', 'db', 'migrations.ts'));
    const reposModule = await import(path.join(baseDir, '..', 'infrastructure', 'persistence', 'db', 'repositories.ts'));
    const moderationModule = await import(path.join(baseDir, '..', 'features', 'moderation', 'moderation.repository.ts'));
    const workflowModule = await import(path.join(baseDir, '..', 'application', 'admin', 'private-chat-workflow.service.ts'));

    const { applyMigrations } = migrationsModule as any;
    const { UserModerationRepository } = moderationModule as any;
    const {
      UserProfileRepository,
      AdminRepository,
      AdminVerificationCodeRepository,
      InstitutionalNoticeRepository,
      ManagedExamRepository,
      ManagedClassRepository,
      ManagedTeacherRepository,
      GroupContextRepository,
      CommissionRepository,
    } = reposModule as any;

    const { PrivateChatWorkflowService } = workflowModule as any;

    await applyMigrations(db);

    userProfileRepo = new UserProfileRepository(db);
    adminRepo = new AdminRepository(db);
    adminCodeRepo = new AdminVerificationCodeRepository(db);
    noticeRepo = new InstitutionalNoticeRepository(db);
    examRepo = new ManagedExamRepository(db);
    classRepo = new ManagedClassRepository(db);
    teacherRepo = new ManagedTeacherRepository(db);
    moderationRepo = new UserModerationRepository(db);
    groupContextRepo = new GroupContextRepository(db);
    commissionRepo = new CommissionRepository(db);
    const { ClassCommissionScheduleRepository, GroupRepository } = reposModule as any;
    const classCommissionScheduleRepo = new ClassCommissionScheduleRepository(db);
    const groupRepo = new GroupRepository(db);

    // Register group first to satisfy foreign key constraint of group_context
    await groupRepo.register('12345-67890@g.us', 'Test Group');

    // Ensure admin has a minimal profile to avoid profile completion flow
    await userProfileRepo.upsert('admin1@s.whatsapp.net', 'Admin', '01/01', 'admin@ispc.edu.ar', 1);

    svc = new PrivateChatWorkflowService(
      userProfileRepo,
      adminRepo,
      adminCodeRepo,
      noticeRepo,
      examRepo,
      classRepo,
      teacherRepo,
      moderationRepo,
      {} as any,
      'test-pass',
      groupContextRepo,
      commissionRepo,
      undefined,
      undefined,
      undefined,
      classCommissionScheduleRepo,
    );

    // Prepare admin user
    await adminRepo.register('admin1@s.whatsapp.net');
  });

  afterAll(() => {
    db.close();
  });

  test('admin can configure group context end-to-end', async () => {
    const starter = await svc.startGroupContextConfiguration('admin1@s.whatsapp.net', '12345-67890@g.us');
    expect(starter).toMatch(/Configuración del grupo/);
    expect(starter).toMatch(/Grupo ID: 12345-67890@g.us/);

    // send year
    const step2 = await svc.handlePrivateMessage('admin1@s.whatsapp.net', '2026');
    expect(step2).toMatch(/¿Cuántas comisiones/);

    // send commission count (1)
    const step3 = await svc.handlePrivateMessage('admin1@s.whatsapp.net', '1');
    expect(step3).toMatch(/Registradas 1 comisiones/);

    const ctx = await groupContextRepo.getByGroupId('12345-67890@g.us');
    expect(ctx).not.toBeNull();
    expect(ctx!.year).toBe(2026);
    // commission should exist
    expect(ctx!.commission_id).toBeGreaterThan(0);

    const comm = await commissionRepo.getById(ctx!.commission_id!);
    expect(comm).not.toBeNull();
    expect(comm!.name).toBe('1');
  });

  // timeout handled in vitest.config.ts
});
