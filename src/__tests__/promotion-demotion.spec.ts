import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrivateChatWorkflowService } from '../application/admin/private-chat-workflow.service.js';

describe('PrivateChatWorkflowService - promotion/demotion flows', () => {
  let svc: any;
  let userProfileRepo: any;
  let adminRepo: any;
  let groupRepo: any;

  beforeEach(() => {
    userProfileRepo = {
      listAll: vi.fn(async () => [{ user_id: 'u1', name: 'Alice' }, { user_id: 'u2', name: 'Bob' }]),
      get: vi.fn(async () => ({ name: 'SuperAdmin', birthday_day_month: '01/01', email: 'admin@ispc.edu.ar', user_commission_id: 1 })),
      upsert: vi.fn(async () => null),
    };

    adminRepo = {
      get: vi.fn(async () => ({ is_super_admin: true })),
      isAuthenticated: vi.fn(async () => true),
      isRegistered: vi.fn(async () => true),
      register: vi.fn(async () => null),
      setAuthenticated: vi.fn(async () => null),
      assignGroupAdmin: vi.fn(async () => null),
      removeGroupAdmin: vi.fn(async () => null),
      listGroupAdmins: vi.fn(async (gid: string) => [{ user_id: 'u1' }]),
    };

    groupRepo = {
      findByGroupId: vi.fn(async (gid: string) => ({ group_id: gid, display_name: 'G', entry_year: 2024, is_active: true })),
      updateEntryYear: vi.fn(async () => null),
      setActive: vi.fn(async () => null),
    };

    // construct service with minimal dependencies; cast as any to avoid full interface
    svc = new PrivateChatWorkflowService(
      userProfileRepo,
      adminRepo,
      {} as any, // adminCodeRepository
      {} as any, // noticesRepository
      {} as any, // examsRepository
      {} as any, // managedClassRepository
      {} as any, // managedTeacherRepository
      {} as any, // moderationRepository
      {} as any, // dynamicMessageService
      'secret',
      undefined,
      undefined,
      undefined,
      groupRepo,
      undefined,
      undefined,
    );
  });

  it('promotes a selected user to group admin using paginated selection', async () => {
    const adminId = 'admin1';
    // open admin-grupos
    await svc.handlePrivateMessage(adminId, '!admin-grupos');
    // enter super admin menu option 2 (select group)
    await svc.handlePrivateMessage(adminId, '2');
    // provide group id
    const menu = await svc.handlePrivateMessage(adminId, 'group1');
    expect(menu).toContain('Administrando grupo: group1');

    // choose promote option
    const promotePage = await svc.handlePrivateMessage(adminId, '5');
    expect(promotePage).toContain('Seleccioná el número del usuario');

    // select first user on page
    const res = await svc.handlePrivateMessage(adminId, '1');
    expect(res).toContain('promovido a Admin de Grupo');
    expect(adminRepo.assignGroupAdmin).toHaveBeenCalledWith('u1', 'group1');
  });

  it('demotes an existing group admin', async () => {
    const adminId = 'admin1';
    await svc.handlePrivateMessage(adminId, '!admin-grupos');
    await svc.handlePrivateMessage(adminId, '2');
    const menu = await svc.handlePrivateMessage(adminId, 'group1');
    expect(menu).toContain('Administrando grupo: group1');

    // choose demote option
    const listAdmins = await svc.handlePrivateMessage(adminId, '6');
    expect(listAdmins).toContain('Elegí el número del Admin de Grupo a quitar');

    const res = await svc.handlePrivateMessage(adminId, '1');
    expect(res).toContain('removido como Admin de Grupo');
    expect(adminRepo.removeGroupAdmin).toHaveBeenCalledWith('u1', 'group1');
  });
});
