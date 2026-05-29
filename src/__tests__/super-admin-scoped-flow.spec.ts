import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrivateChatWorkflowService } from '../application/admin/private-chat-workflow.service.js';
import { AcademicCalendarService } from '../features/academic-calendar/academic-calendar.service.js';
import { MessageRouter } from '../features/messages/message-router.service.js';

describe('Super-Admin and Admin Role / Menu Separation Spec', () => {
  let svc: any;
  let userProfileRepo: any;
  let adminRepo: any;
  let adminCodeRepo: any;
  let groupRepo: any;

  beforeEach(() => {
    userProfileRepo = {
      listAll: vi.fn(async () => [{ user_id: 'u1', name: 'Alice' }]),
      get: vi.fn(async () => ({ name: 'SuperAdminUser', birthday_day_month: '01/01', email: 'sa@ispc.edu.ar', user_commission_id: 1 })),
      upsert: vi.fn(async () => null),
    };

    adminRepo = {
      get: vi.fn(async () => ({ is_super_admin: true, is_authenticated: true })),
      isAuthenticated: vi.fn(async () => true),
      isSuperAdmin: vi.fn(async () => true),
      isGlobalAdmin: vi.fn(async () => false),
      isRegistered: vi.fn(async () => true),
      register: vi.fn(async () => null),
      setAuthenticated: vi.fn(async () => null),
      setSuperAdmin: vi.fn(async () => null),
      assignGroupAdmin: vi.fn(async () => null),
      removeGroupAdmin: vi.fn(async () => null),
      listGroupAdmins: vi.fn(async () => []),
      isGroupAdmin: vi.fn(async () => false),
    };

    adminCodeRepo = {
      consumeIfValid: vi.fn(async () => true),
    };

    groupRepo = {
      findAll: vi.fn(async () => [
        { group_id: 'g1@g.us', display_name: 'Grupo Activo A', entry_year: 2024, is_active: true },
        { group_id: 'g2@g.us', display_name: 'Grupo Activo B', entry_year: 2024, is_active: true }
      ]),
      findByGroupId: vi.fn(async (gid: string) => ({ group_id: gid, display_name: 'Grupo Seleccionado', entry_year: 2024, is_active: true })),
      updateEntryYear: vi.fn(async () => null),
      setActive: vi.fn(async () => null),
    };

    const mockClassRepo = {
      getDistinctCommissionCounts: vi.fn(async () => [1, 2]),
      listAll: vi.fn(async () => []),
    };

    svc = new PrivateChatWorkflowService(
      userProfileRepo,
      adminRepo,
      adminCodeRepo,
      {} as any,
      {} as any,
      mockClassRepo as any,
      {} as any,
      {} as any,
      {} as any,
      'secret',
      undefined,
      undefined,
      undefined,
      groupRepo,
      undefined,
      undefined,
    );
  });

  it('superadmin receives only superadmin menu in private on menu / 0', async () => {
    // When superadmin types menu, they get Super-Admin menu
    const saMenu = await svc.handlePrivateMessage('sa1', 'menu');
    expect(saMenu).toContain('Menú Super-Admin:');
    expect(saMenu).toContain('1 - Listar grupos registrados');
    expect(saMenu).toContain('2 - Seleccionar grupo para administrar');
    expect(saMenu).not.toContain('Panel admin (');
  });

  it('global admin (is_authenticated=1, is_super_admin=0) receives normal admin menu and not superadmin options', async () => {
    // Mock user as global admin, not superadmin
    adminRepo.isSuperAdmin = vi.fn(async () => false);
    adminRepo.isGlobalAdmin = vi.fn(async () => true);
    userProfileRepo.get = vi.fn(async () => ({ name: 'GlobalAdminUser', birthday_day_month: '02/02', email: 'ga@ispc.edu.ar', user_commission_id: 1 }));

    const adminMenu = await svc.handlePrivateMessage('ga1', 'menu');
    expect(adminMenu).toContain('Panel admin (GlobalAdminUser):');
    expect(adminMenu).toContain('1 - Configurar avisos de clase');
    expect(adminMenu).not.toContain('Menú Super-Admin:');
  });

  it('superadmin can list active groups, select one, enter scoped admin menu, and return safely', async () => {
    // 1. Enter superadmin menu
    await svc.handlePrivateMessage('sa1', 'menu');

    // 2. Select option 1 to list groups
    const listRes = await svc.handlePrivateMessage('sa1', '1');
    expect(listRes).toContain('Grupo Activo A');
    expect(listRes).toContain('Grupo Activo B');
    // 3. Select option 'seleccionar' to select a group to manage by JID
    await svc.handlePrivateMessage('sa1', 'seleccionar');
    // 4. Enter the JID of the group
    const manageRes = await svc.handlePrivateMessage('sa1', 'g1@g.us');
    expect(manageRes).toContain('Grupo Seleccionado');
    expect(manageRes).toContain('Cohorte: 2024');
    expect(manageRes).toContain('g1@g.us');
    expect(manageRes).toContain('7 - Ir al menú de Admin de este Grupo');

    // 5. Choose option 7 to enter scoped admin menu
    const scopedMenu = await svc.handlePrivateMessage('sa1', '7');
    expect(scopedMenu).toContain('Panel admin del Grupo (');
    expect(scopedMenu).toContain('1 - Configurar avisos de clase');
    expect(scopedMenu).toContain('0 - Volver al menú de gestión de grupo');

    // 6. Enter a submenu (option 1: Class Notices Submenu)
    const classSubmenu = await svc.handlePrivateMessage('sa1', '1');
    expect(classSubmenu).toContain('Configurar avisos de clase');
    expect(classSubmenu).toContain('2 - Cargar materia');

    // 7. Exit class submenu by typing 0 or menu -> should return back to scoped admin menu
    const backToScoped = await svc.handlePrivateMessage('sa1', '0');
    expect(backToScoped).toContain('Panel admin del Grupo (');

    // 8. Exit scoped admin menu by typing 0 -> should return to group management menu
    const backToMgmt = await svc.handlePrivateMessage('sa1', '0');
    expect(backToMgmt).toContain('Grupo Seleccionado');
    expect(backToMgmt).toContain('Cohorte: 2024');
    expect(backToMgmt).toContain('g1@g.us');

    // 9. Exit group management menu by typing 0 -> should return to superadmin main menu
    const backToSaMain = await svc.handlePrivateMessage('sa1', '0');
    expect(backToSaMain).toContain('Menú Super-Admin:');
  });

  it('verifies that !config-grupo requires isGroupAdmin or isSuperAdmin in groups', async () => {
    const calendarSvc = new AcademicCalendarService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    // Normal user: isGroupAdmin = false, isSuperAdmin = false
    const denied = await calendarSvc.handleCommand('user1', '!config-grupo', new Date(), false, 'g1@g.us', false, false);
    expect(denied).toBe('🔒 Solo administradores pueden ejecutar este comando.');

    // Group admin: isGroupAdmin = true, isSuperAdmin = false
    const allowedGroupAdmin = await calendarSvc.handleCommand('user1', '!config-grupo', new Date(), false, 'g1@g.us', true, false);
    expect(allowedGroupAdmin).toBe('config-grupo:g1@g.us');

    // SuperAdmin: isGroupAdmin = false, isSuperAdmin = true (even if not group admin!)
    const allowedSuperAdmin = await calendarSvc.handleCommand('sa1', '!config-grupo', new Date(), false, 'g1@g.us', false, true);
    expect(allowedSuperAdmin).toBe('config-grupo:g1@g.us');
  });
});
