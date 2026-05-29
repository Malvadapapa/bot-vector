import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

describe('Interactive exam creation E2E', () => {
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

    await userProfileRepo.upsert('admin3@s.whatsapp.net', 'Admin', '01/01', 'admin3@ispc.edu.ar', 1);
    await adminRepo.register('admin3@s.whatsapp.net');
    await new Promise<void>((resolve, reject) => db.run(`UPDATE admin_users SET is_super_admin = 1 WHERE user_id = ?`, ['admin3@s.whatsapp.net'], (e) => (e ? reject(e) : resolve())));

    // ensure there's at least one managed class
    await classRepo.create({ subject: 'Demo', schedule_day: 'Lunes', schedule_time: '08:00', meet_link: '', notifications_enabled: 1, commission_count: 1 });
  });

  afterAll(() => db.close());

  it('completes interactive exam creation and stores global exam', async () => {
    // enter exams submenu
    (svc as any).pendingAdminState.set('admin3@s.whatsapp.net', 'submenu_exams');
    const s1 = await svc.handlePrivateMessage('admin3@s.whatsapp.net', '1');
    expect(s1).toMatch(/Cuál es la materia|¿El aviso de examen/);

    // trigger subject source prompt
    // trigger subject selection prompt (handleExamStep1)
    const s2 = await svc.handlePrivateMessage('admin3@s.whatsapp.net', 'ok');
    expect(s2).toMatch(/1 - Materia en curso|2 - Otra materia/);

    const s3 = await svc.handlePrivateMessage('admin3@s.whatsapp.net', '2'); // otra materia
    expect(s3).toMatch(/Escribime el nombre de la otra materia/);

    const s4 = await svc.handlePrivateMessage('admin3@s.whatsapp.net', 'Historia');
    expect(s4).toMatch(/Elegí número|Elegí la materia|Elegí número/);

    const s5 = await svc.handlePrivateMessage('admin3@s.whatsapp.net', '0'); // global
    expect(s5).toMatch(/Fecha del examen/);


    const s6 = await svc.handlePrivateMessage('admin3@s.whatsapp.net', '20/06');
    expect(s6).toMatch(/Cómo se rinde/);

    const s7 = await svc.handlePrivateMessage('admin3@s.whatsapp.net', '1');
    expect(s7).toMatch(/Hora del examen/);

    const s8 = await svc.handlePrivateMessage('admin3@s.whatsapp.net', '11:00');
    expect(s8).toMatch(/Tipo de examen/);

    const s9 = await svc.handlePrivateMessage('admin3@s.whatsapp.net', 'parcial');
    expect(s9).toMatch(/Último paso/);

    const s10 = await svc.handlePrivateMessage('admin3@s.whatsapp.net', 'Observaciones E2E');
    expect(s10).toMatch(/Examen cargado correctamente/);

    // verify created in repo
    const { ManagedExamRepository } = reposModule as any;
    const examRepo = new ManagedExamRepository(db);
    const exams = await examRepo.listWithIds(50);
    const created = exams.map((e: any) => e.exam).find((ex: any) => ex.subject === 'Historia');
    expect(created).toBeDefined();
    expect(created.exam_commission_id === undefined || created.exam_commission_id === null).toBeTruthy();
    expect(created.created_by).toBe('admin3@s.whatsapp.net');
  });
});
