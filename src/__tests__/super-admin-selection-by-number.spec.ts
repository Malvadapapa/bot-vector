import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrivateChatWorkflowService } from '../application/admin/private-chat-workflow.service.js';

describe('Super-admin selection by number', () => {
  let svc: any;
  let userProfileRepo: any;
  let adminRepo: any;
  let adminCodeRepo: any;
  let groupRepo: any;

  beforeEach(() => {
    userProfileRepo = {
      get: vi.fn(async () => ({ name: 'SuperAdminUser', birthday_day_month: '01/01', email: 'sa@ispc.edu.ar', user_commission_id: 1 })),
      upsert: vi.fn(async () => null),
    };

    adminRepo = {
      get: vi.fn(async () => ({ is_super_admin: true, is_authenticated: true })),
      isAuthenticated: vi.fn(async () => true),
      isSuperAdmin: vi.fn(async () => true),
      isRegistered: vi.fn(async () => true),
    };

    adminCodeRepo = { consumeIfValid: vi.fn(async () => true) };

    const groups = [
      { group_id: 'g1@g.us', display_name: 'Grupo Uno', entry_year: 2024, is_active: true },
      { group_id: 'g2@g.us', display_name: 'Grupo Dos', entry_year: null, is_active: true },
    ];
    groupRepo = {
      findAll: vi.fn(async () => groups),
      findByGroupId: vi.fn(async (gid: string) => groups.find((g) => g.group_id === gid) || null),
      updateEntryYear: vi.fn(async () => null),
      updateDisplayName: vi.fn(async (gid: string, name: string) => {
        const g = groups.find((gr) => gr.group_id === gid);
        if (g) g.display_name = name;
      }),
    };

    const mockClassRepo = {
      getDistinctCommissionCounts: vi.fn(async () => [1]),
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

  it('lists groups and allows selecting by number', async () => {
    // open menu
    await svc.handlePrivateMessage('sa1', 'menu');
    // list groups
    const listRes = await svc.handlePrivateMessage('sa1', '1');
    expect(listRes).toContain('Cohorte 2024:');
    expect(listRes).toContain('General:');
    // select first group by number
    const manageRes = await svc.handlePrivateMessage('sa1', '1');
    expect(manageRes).toContain('Grupo Uno');
    expect(manageRes).toContain('Cohorte: 2024');
    expect(manageRes).toContain('g1@g.us');
  });

  it('when selecting a group without cohort prompts registration flow', async () => {
    await svc.handlePrivateMessage('sa1', 'menu');
    const listRes = await svc.handlePrivateMessage('sa1', '1');
    expect(listRes).toContain('Grupo Dos');
    // select second group by number (which has null entry_year)
    const managePrompt = await svc.handlePrivateMessage('sa1', '2');
    // Since group 2 has null entry_year, service should prompt for registering cohort now or making it general
    expect(managePrompt).toContain('no tiene cohorte registrada. Qué querés hacer?');
  });

  it('allows super-admin to edit group display name / support name manually', async () => {
    await svc.handlePrivateMessage('sa1', 'menu');
    await svc.handlePrivateMessage('sa1', '1'); // list groups
    const manageRes = await svc.handlePrivateMessage('sa1', '1'); // select first group
    expect(manageRes).toContain('Grupo Uno');

    // Select option 8 (editar display_name)
    const prompt = await svc.handlePrivateMessage('sa1', '8');
    expect(prompt).toContain('nuevo nombre de apoyo');

    // Enter new custom name
    const updateRes = await svc.handlePrivateMessage('sa1', 'Mi Grupo Personalizado');
    expect(updateRes).toContain('actualizado a "Mi Grupo Personalizado"');
    expect(updateRes).toContain('Mi Grupo Personalizado');
  });
});
