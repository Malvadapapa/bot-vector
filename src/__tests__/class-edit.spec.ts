import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

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

    const { UserProfileRepository, AdminRepository, AdminVerificationCodeRepository, ManagedClassRepository } = reposModule as any;
    const { PrivateChatWorkflowService } = workflowModule as any;

    const userProfileRepo = new UserProfileRepository(db);
    const adminRepo = new AdminRepository(db);
    const adminCodeRepo = new AdminVerificationCodeRepository(db);
    const classRepo = new ManagedClassRepository(db);

    svc = new PrivateChatWorkflowService(userProfileRepo, adminRepo, adminCodeRepo, undefined, undefined, classRepo, undefined, undefined, undefined, 'pass', undefined, undefined, undefined, undefined, undefined);

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
});
