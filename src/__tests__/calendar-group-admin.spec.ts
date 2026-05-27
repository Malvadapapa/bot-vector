import { describe, it, expect } from 'vitest';
import { AcademicCalendarService } from '../application/calendar/academic-calendar.service.js';

describe('AcademicCalendarService - group admin permissions', () => {
  it('rejects !config-grupo unless the sender is a group admin', async () => {
    const service = new AcademicCalendarService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const denied = await service.handleCommand('user1', '!config-grupo', new Date(), true, 'group-1', false);
    expect(denied).toBe('🔒 Solo administradores pueden ejecutar este comando.');

    const allowed = await service.handleCommand('user1', '!config-grupo', new Date(), false, 'group-1', true);
    expect(allowed).toBe('config-grupo:group-1');
  });
});
