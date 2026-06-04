import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { TeacherMenuService } from '../features/academic-calendar/teacher-menu.service.js';
import { AcademicCalendarService } from '../features/academic-calendar/academic-calendar.service.js';

describe('Class edit menu and validations', () => {
  let db: sqlite3.Database;
  let reposModule: any;
  let workflowModule: any;
  let svc: any;

  beforeAll(async () => {
    db = new sqlite3.Database(':memory:');
    const baseDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationsModule = await import(path.join(baseDir, '..', 'infrastructure', 'persistence', 'db', 'migrations.ts'));
    reposModule = await import(path.join(baseDir, '..', 'infrastructure', 'persistence', 'db', 'repositories.ts'));
    workflowModule = await import(path.join(baseDir, '..', 'application', 'admin', 'private-chat-workflow.service.ts'));

    const { applyMigrations } = migrationsModule as any;
    await applyMigrations(db);

    const { UserProfileRepository, AdminRepository, AdminVerificationCodeRepository, ManagedClassRepository, ClassCommissionScheduleRepository, CommissionRepository, ManagedTeacherRepository } = reposModule as any;
    const { PrivateChatWorkflowService } = workflowModule as any;

    const userProfileRepo = new UserProfileRepository(db);
    const adminRepo = new AdminRepository(db);
    const adminCodeRepo = new AdminVerificationCodeRepository(db);
    const classRepo = new ManagedClassRepository(db);
    const classCommissionScheduleRepo = new ClassCommissionScheduleRepository(db);
    const commissionRepo = new CommissionRepository(db);
    const managedTeacherRepo = new ManagedTeacherRepository(db);

    svc = new PrivateChatWorkflowService(
      userProfileRepo,
      adminRepo,
      adminCodeRepo,
      undefined,
      undefined,
      classRepo,
      managedTeacherRepo,
      undefined,
      undefined,
      'pass',
      undefined,
      commissionRepo,
      undefined,
      undefined,
      undefined,
      classCommissionScheduleRepo
    );

    await userProfileRepo.upsert('admin4@s.whatsapp.net', 'Admin', '01/01', 'admin4@ispc.edu.ar', 1);
    await adminRepo.register('admin4@s.whatsapp.net');
    await new Promise<void>((resolve, reject) => db.run(`UPDATE admin_users SET is_super_admin = 1 WHERE user_id = ?`, ['admin4@s.whatsapp.net'], (e) => (e ? reject(e) : resolve())));

    // create a class to edit
    await classRepo.create({ subject: 'ToEdit', schedule_day: 'Lunes', schedule_time: '09:00', meet_link: 'https://old', notifications_enabled: true, commission_count: 1 });
  });

  afterAll(() => db.close());

  it('edits subject, schedule and link with validations', async () => {
    (svc as any).pendingAdminState.set('admin4@s.whatsapp.net', 'submenu_class_notices');
    const prompt = await svc.handlePrivateMessage('admin4@s.whatsapp.net', '5');
    expect(prompt).toMatch(/Elegí la materia a editar/);

    const choose = await svc.handlePrivateMessage('admin4@s.whatsapp.net', '1');
    expect(choose).toMatch(/Qué querés editar/);

    const chooseName = await svc.handlePrivateMessage('admin4@s.whatsapp.net', '1');
    expect(chooseName).toMatch(/Escribí el nuevo nombre/);

    const resName = await svc.handlePrivateMessage('admin4@s.whatsapp.net', 'EditedName');
    expect(resName).toMatch(/Materia actualizada/);

    // edit time
    (svc as any).pendingAdminState.set('admin4@s.whatsapp.net', 'submenu_class_notices');
    await svc.handlePrivateMessage('admin4@s.whatsapp.net', '5');
    await svc.handlePrivateMessage('admin4@s.whatsapp.net', '1');
    await svc.handlePrivateMessage('admin4@s.whatsapp.net', '2');
    const resTime = await svc.handlePrivateMessage('admin4@s.whatsapp.net', 'Martes 10:30');
    expect(resTime).toMatch(/Horario actualizado/);

    // edit link
    (svc as any).pendingAdminState.set('admin4@s.whatsapp.net', 'submenu_class_notices');
    await svc.handlePrivateMessage('admin4@s.whatsapp.net', '5');
    await svc.handlePrivateMessage('admin4@s.whatsapp.net', '1');
    await svc.handlePrivateMessage('admin4@s.whatsapp.net', '3');
    const resLink = await svc.handlePrivateMessage('admin4@s.whatsapp.net', 'https://new.link');
    expect(resLink).toMatch(/Enlace actualizado/);

    const { ManagedClassRepository } = reposModule as any;
    const classRepo = new ManagedClassRepository(db);
    const classes = await classRepo.listAll();
    const c = classes.find((x: any) => x.subject === 'EditedName');
    expect(c).toBeDefined();
    expect(c.schedule_day.toLowerCase()).toBe('martes');
    expect(c.schedule_time).toBe('10:30');
    expect(c.meet_link).toBe('https://new.link');
  });

  it('allows superadmin to edit Google Meet link by subject and commission', async () => {
    const { ClassCommissionScheduleRepository, CommissionRepository, ManagedClassRepository } = reposModule as any;
    const classRepo = new ManagedClassRepository(db);
    const commissionRepo = new CommissionRepository(db);
    const scheduleRepo = new ClassCommissionScheduleRepository(db);

    // Create a commission and schedule
    const commissionId = await commissionRepo.createOrGet('Comisión A', 2026, 'Noche');
    const classId = await classRepo.create({
      subject: 'Quimica',
      schedule_day: 'Miércoles',
      schedule_time: '19:00',
      meet_link: 'http://meet.old/123',
      notifications_enabled: true,
      commission_count: 2,
    });
    
    // Add schedule
    await new Promise<void>((resolve, reject) => {
      db.run(
        `INSERT INTO class_commission_schedule (managed_class_id, commission_id, schedule_day, schedule_time, meet_link) VALUES (?, ?, ?, ?, ?)`,
        [classId, commissionId, 'Miércoles', '19:00', 'http://meet.old/123'],
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Enter option 6 in submenu
    (svc as any).pendingAdminState.set('admin4@s.whatsapp.net', 'submenu_class_notices');
    const selectClassPrompt = await svc.handlePrivateMessage('admin4@s.whatsapp.net', '6');
    expect(selectClassPrompt).toContain('Elegí la materia para editar su enlace de Meet');

    // Select class index (Quimica is index 2 because ToEdit/EditedName is index 1)
    const classes = await classRepo.listAll();
    const qIdx = classes.findIndex((c: any) => c.subject === 'Quimica') + 1;
    
    const selectCommPrompt = await svc.handlePrivateMessage('admin4@s.whatsapp.net', String(qIdx));
    expect(selectCommPrompt).toContain('Seleccioná la comisión de la que querés editar el enlace');
    expect(selectCommPrompt).toContain('Comisión A');

    // Select commission index (1)
    const newLinkPrompt = await svc.handlePrivateMessage('admin4@s.whatsapp.net', '1');
    expect(newLinkPrompt).toContain('Pasame el nuevo enlace (debe comenzar con http)');

    // Enter new link
    const finalResp = await svc.handlePrivateMessage('admin4@s.whatsapp.net', 'http://meet.new/xyz');
    expect(finalResp).toContain('Enlace de Meet de la comisión actualizado correctamente');

    // Verify in db
    const schedules = await scheduleRepo.listByManagedClass(classId);
    expect(schedules.length).toBe(1);
    expect(schedules[0].meet_link).toBe('http://meet.new/xyz');
  });

  it('allows user to look up teacher email interactively by subject and commission', async () => {
    const { ManagedTeacherRepository, CommissionRepository, ManagedClassRepository } = reposModule as any;
    const teacherRepo = new ManagedTeacherRepository(db);
    const commissionRepo = new CommissionRepository(db);
    const classRepo = new ManagedClassRepository(db);

    const comIdA = await commissionRepo.createOrGet('Comisión A', 2026, 'Noche');
    const comIdB = await commissionRepo.createOrGet('Comisión B', 2026, 'Noche');

    // Create teachers
    await teacherRepo.create({
      name: 'Profe A',
      email: 'profe.a@ispc.edu.ar',
      subject: 'Matematica',
      commission_id: comIdA,
      group_id: 'group123',
    });

    await teacherRepo.create({
      name: 'Profe B',
      email: 'profe.b@ispc.edu.ar',
      subject: 'Matematica',
      commission_id: comIdB,
      group_id: 'group123',
    });

    const teacherMenuService = new TeacherMenuService(teacherRepo, commissionRepo);
    const academicCalendarService = new AcademicCalendarService(
      { getNews: vi.fn(async () => 'mock news') } as any,
      {} as any,
      classRepo,
      teacherRepo,
      { get: vi.fn(async () => ({ name: 'User' })) } as any,
      undefined,
      commissionRepo,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      teacherMenuService
    );

    // Start flow by sending option 2 in contacto_ispc
    // Setup state
    academicCalendarService['menuStateByUser'].set('user123', 'contacto_ispc');
    
    const respStart = await academicCalendarService.handleMenuInput('user123', '2', 'group123');
    expect(respStart).toContain('Directorio de Profesores');
    expect(respStart).toContain('1 - Matematica');

    // Select subject 1 (Matematica)
    const respSelectSub = await academicCalendarService.handleMenuInput('user123', '1', 'group123');
    expect(respSelectSub).toContain('Seleccioná la comisión');
    expect(respSelectSub).toContain('Comisión A');
    expect(respSelectSub).toContain('Comisión B');

    // Select commission 1 (Comisión A)
    const respSelectComm = await academicCalendarService.handleMenuInput('user123', '1', 'group123');
    expect(respSelectComm).toContain('Información del Profesor');
    expect(respSelectComm).toContain('Matematica');
    expect(respSelectComm).toContain('Comisión A');
    expect(respSelectComm).toContain('Profe A');
    expect(respSelectComm).toContain('profe.a@ispc.edu.ar');
    expect(teacherMenuService.isInFlow('user123')).toBe(false); // Cleaned state
  });
});
