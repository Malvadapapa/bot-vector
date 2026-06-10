import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrivateChatWorkflowService } from '../application/admin/private-chat-workflow.service.js';

describe('PrivateChatWorkflowService - explicit registration command', () => {
  let svc: any;
  let userProfileRepo: any;
  let adminRepo: any;
  let adminCodeRepo: any;
  let groupRepo: any;
  let groupContextRepo: any;
  let groupMembershipRepository: any;

  beforeEach(() => {
    userProfileRepo = {
      get: vi.fn(async () => null),
      upsert: vi.fn(async () => null),
    };

    adminRepo = {
      isAuthenticated: vi.fn(async () => false),
      isRegistered: vi.fn(async () => false),
    };

    adminCodeRepo = {
      consumeIfValid: vi.fn(async () => false),
    };

    groupRepo = {
      findByGroupId: vi.fn(async (groupId: string) => ({ group_id: groupId, display_name: 'Grupo Uno' })),
    };

    groupContextRepo = {
      getByGroupId: vi.fn(async () => ({ id: 1 })),
      listCommissionsForGroupContext: vi.fn(async () => [
        { id: 1, name: 'Comisión A' },
        { id: 2, name: 'Comisión B' },
      ]),
    };

    groupMembershipRepository = {
      getMembership: vi.fn(async () => ({ user_id: 'user1@s.whatsapp.net', role: 'student', is_active: true, commission_id: null })),
      listByUser: vi.fn(async () => [{ group_id: 'g1@g.us', role: 'student', is_active: true }]),
    };

    svc = new PrivateChatWorkflowService(
      userProfileRepo,
      adminRepo,
      adminCodeRepo,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      'secret',
      groupContextRepo,
      undefined,
      undefined,
      groupRepo,
      groupMembershipRepository,
      undefined,
    );
  });

  it('starts onboarding only with !registrarse and not with a generic hola greeting', async () => {
    const greetResponse = await svc.handlePrivateMessage('user1@s.whatsapp.net', 'hola');
    expect(greetResponse).toContain('!registrarse');
    expect(greetResponse).not.toContain('¿Arrancamos?');

    const registrationResponse = await svc.handlePrivateMessage('user1@s.whatsapp.net', '!registrarse');
    expect(registrationResponse).toContain('¿Arrancamos?');
  });

  it('warns missing commission in group once and ignores subsequent attempts within 48h', async () => {
    const warning1 = await svc.getGroupCommissionMissingWarning('user1@s.whatsapp.net', 'g1@g.us', 1);
    expect(warning1).toContain('completar tu comisión');

    const warning2 = await svc.getGroupCommissionMissingWarning('user1@s.whatsapp.net', 'g1@g.us', 1000);
    expect(warning2).toBe('');

    const warningLater = await svc.getGroupCommissionMissingWarning('user1@s.whatsapp.net', 'g1@g.us', 48 * 60 * 60 * 1000 + 2);
    expect(warningLater).toContain('completar tu comisión');
  });
});
