import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

describe('Multi-commission config and unified exam flows', () => {
  let db: sqlite3.Database;
  let reposModule: any;
  let workflowModule: any;
  let svc: any;

  beforeAll(async () => {
    db = new sqlite3.Database(':memory:');
    const baseDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationsModule = await import(path.join(baseDir, '..', 'shared', 'db', 'migrations.ts'));
    reposModule = await import(path.join(baseDir, '..', 'infrastructure', 'persistence', 'db', 'repositories.ts'));
    const moderationModule = await import(path.join(baseDir, '..', 'features', 'moderation', 'moderation.repository.ts'));
    workflowModule = await import(path.join(baseDir, '..', 'application', 'admin', 'private-chat-workflow.service.ts'));

    const { applyMigrations } = migrationsModule as any;
    await applyMigrations(db);

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
      ClassCommissionScheduleRepository,
    } = reposModule as any;

    const { PrivateChatWorkflowService } = workflowModule as any;

    const userProfileRepo = new UserProfileRepository(db);
    const adminRepo = new AdminRepository(db);
    const adminCodeRepo = new AdminVerificationCodeRepository(db);
    const noticeRepo = new InstitutionalNoticeRepository(db);
    const examRepo = new ManagedExamRepository(db);
    const classRepo = new ManagedClassRepository(db);
    const teacherRepo = new ManagedTeacherRepository(db);
    const moderationRepo = new UserModerationRepository(db);
    const groupContextRepo = new GroupContextRepository(db);
    const commissionRepo = new CommissionRepository(db);
    const classCommissionScheduleRepo = new ClassCommissionScheduleRepository(db);

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
      'pass',
      groupContextRepo,
      commissionRepo,
      undefined,
      undefined,
      undefined,
      classCommissionScheduleRepo,
    );

    await userProfileRepo.upsert('admin2@s.whatsapp.net', 'Admin', '01/01', 'admin@ispc.edu.ar', 1);
    await adminRepo.register('admin2@s.whatsapp.net');
    // make super admin
    await new Promise<void>((resolve, reject) => db.run(`UPDATE admin_users SET is_super_admin = 1 WHERE user_id = ?`, ['admin2@s.whatsapp.net'], (e) => (e ? reject(e) : resolve())));
  });

  afterAll(() => db.close());

  it('configures 2 commissions and creates schedules per commission', async () => {
    const start = await svc.startGroupContextConfiguration('admin2@s.whatsapp.net', 'g1@g.us');
    expect(start).toMatch(/Configuración del grupo/);

    const step2 = await svc.handlePrivateMessage('admin2@s.whatsapp.net', '2026');
    expect(step2).toMatch(/¿Cuántas comisiones/);

    const step3 = await svc.handlePrivateMessage('admin2@s.whatsapp.net', '2');
    expect(step3).toMatch(/Registradas 2 comisiones/);

    const step4 = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'Matemáticas,Física');
    expect(step4).toMatch(/Ingresá día y hora/);

    // subj1 comm1 schedule
    const r1 = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'Lunes 08:30|https://a1');
    expect(r1).toMatch(/profesor/);
    // subj1 comm1 teacher
    const r1_t = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'skip');
    expect(r1_t).toMatch(/comisión/);
    // subj1 comm2 schedule
    const r2 = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'Lunes 09:30|https://a2');
    expect(r2).toMatch(/profesor/);
    // subj1 comm2 teacher
    const r2_t = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'skip');
    expect(r2_t).toMatch(/Ahora ingresá/);
    // subj2 comm1 schedule
    const r3 = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'Martes 08:30|https://b1');
    expect(r3).toMatch(/profesor/);
    // subj2 comm1 teacher
    const r3_t = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'skip');
    expect(r3_t).toMatch(/comisión/);
    // subj2 comm2 schedule
    const r4 = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'Martes 09:30|https://b2');
    expect(r4).toMatch(/profesor/);
    // subj2 comm2 teacher
    const r4_t = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'skip');
    expect(r4_t).toMatch(/Emails de la cohorte/);
    // cohort emails
    const r5 = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'skip');
    expect(r5).toMatch(/Configuración completada/);

    // verify schedules: list by day
    const { ClassCommissionScheduleRepository } = reposModule as any;
    const repo = new ClassCommissionScheduleRepository(db);
    const lunes = await repo.listByDay('Lunes');
    const martes = await repo.listByDay('Martes');
    // expect 2 schedules on Lunes and 2 on Martes
    expect(lunes.length).toBeGreaterThanOrEqual(2);
    expect(martes.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts schedule input with a space-separated link and persists the class', async () => {
    const start = await svc.startGroupContextConfiguration('admin2@s.whatsapp.net', 'g2@g.us');
    expect(start).toMatch(/Configuración del grupo/);

    await svc.handlePrivateMessage('admin2@s.whatsapp.net', '2027');
    await svc.handlePrivateMessage('admin2@s.whatsapp.net', '1');
    await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'Química Analítica');

    const result = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'Miércoles 10:15 https://meet.example.com/quimica');
    expect(result).toMatch(/profesor/);

    const result_t = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'skip');
    expect(result_t).toMatch(/Emails de la cohorte/);

    const result_e = await svc.handlePrivateMessage('admin2@s.whatsapp.net', 'skip');
    expect(result_e).toMatch(/Configuración completada/);

    const { ManagedClassRepository, ClassCommissionScheduleRepository } = reposModule as any;
    const classRepo = new ManagedClassRepository(db);
    const scheduleRepo = new ClassCommissionScheduleRepository(db);

    const classes = await classRepo.listAll();
    const created = classes.find((entry: any) => entry.subject === 'Química Analítica');
    expect(created).toBeDefined();

    const schedules = await scheduleRepo.listByManagedClass(created.id);
    expect(schedules.length).toBeGreaterThanOrEqual(1);
    expect(schedules[0].schedule_day.toLowerCase()).toContain('miér');
    expect(schedules[0].meet_link).toContain('https://meet.example.com/quimica');
  });

  it('creates a unified exam (exam_commission_id = NULL) and stores single row', async () => {
    const { ManagedClassRepository, ManagedExamRepository } = reposModule as any;
    const classRepo = new ManagedClassRepository(db);
    const examRepo = new ManagedExamRepository(db);

    const managedClassId = await classRepo.create({ subject: 'Historia', schedule_day: 'Lunes', schedule_time: '10:00', meet_link: '', notifications_enabled: 1, commission_count: 2 });

    // start exams submenu
    // Create a unified exam directly via repository and assert stored with no commission
    const examDate = new Date();
    await examRepo.create({ subject: 'Historia', exam_commission_id: null, exam_date: examDate, exam_time: '10:00', exam_type: 'parcial', observations: 'Prueba', created_by: 'admin2@s.whatsapp.net' });
    const exams = await examRepo.listWithIds(50);
    const created = exams.map((e: any) => e.exam).filter((ex: any) => ex.subject === 'Historia');
    expect(created.length).toBeGreaterThanOrEqual(1);
    expect(created.some((ex: any) => ex.exam_commission_id === undefined || ex.exam_commission_id === null)).toBeTruthy();
  });
});
