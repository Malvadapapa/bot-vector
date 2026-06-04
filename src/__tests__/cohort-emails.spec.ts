import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrivateChatWorkflowService } from '../application/admin/private-chat-workflow.service.js';

describe('PrivateChatWorkflowService - cohort emails', () => {
  let svc: any;
  let cohortRepo: any;
  let adminRepo: any;
  let userProfileRepo: any;

  beforeEach(() => {
    // simple in-memory store for cohort configs
    const store: Record<number, any> = {};
    cohortRepo = {
      listAll: vi.fn(async () => Object.keys(store).map((k) => ({ entry_year: Number(k), configs_json: JSON.stringify(store[Number(k)]) }))),
      getByYear: vi.fn(async (y: number) => {
        const v = store[y];
        return v ? { entry_year: y, configs_json: JSON.stringify(v) } : null;
      }),
      upsertByYear: vi.fn(async (y: number, json: string) => { store[y] = JSON.parse(json); return { entry_year: y, configs_json: json }; }),
      deleteByYear: vi.fn(async (y: number) => { delete store[y]; return true; }),
    };

    adminRepo = {
      get: vi.fn(async () => ({ is_super_admin: true })),
      isAuthenticated: vi.fn(async () => true),
    };

    userProfileRepo = {
      get: vi.fn(async () => ({ name: 'SuperAdmin', birthday_day_month: '01/01', email: 'admin@ispc.edu.ar', user_commission_id: 1 })),
    };

    svc = new PrivateChatWorkflowService(
      userProfileRepo,
      adminRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      'secret',
      undefined,
      undefined,
      cohortRepo,
      undefined,
      undefined,
      undefined,
    );
  });

  it('creates a cohort and adds an email, then lists it', async () => {
    const adminId = 'admin1';
    await svc.handlePrivateMessage(adminId, '!admin-grupos');
    await svc.handlePrivateMessage(adminId, '2'); // cohort menu (was 5)
    await svc.handlePrivateMessage(adminId, '2'); // create/edit cohort
    const resYear = await svc.handlePrivateMessage(adminId, '2024');
    expect(resYear).toContain('Cohorte 2024 seleccionada');

    // enter manage emails
    await svc.handlePrivateMessage(adminId, '1');
    await svc.handlePrivateMessage(adminId, '2'); // add
    const addRes = await svc.handlePrivateMessage(adminId, 'contacto|soporte@ispc.edu.ar');
    expect(addRes).toContain('Email soporte@ispc.edu.ar agregado a la cohorte 2024');

    // list emails
    await svc.handlePrivateMessage(adminId, '1');
    const list = await svc.handlePrivateMessage(adminId, '1');
    expect(list).toContain('contacto | soporte@ispc.edu.ar');
  });
});
