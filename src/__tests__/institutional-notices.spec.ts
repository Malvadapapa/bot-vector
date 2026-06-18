import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { InstitutionalEmailMonitor } from '../features/notifications/integrations/institutional-email-monitor.js';
import { EmailService, OutboundEmailService } from '../features/notifications/integrations/email.service.js';
import { ManagedTeacherRepository, GroupRepository } from '../infrastructure/persistence/db/repositories.js';
import { InstitutionalNoticeRepository } from '../features/notifications/notifications.repository.js';
import { InstitutionalNotice, ManagedTeacher, WhatsAppGroup } from '../domain/models.js';

const { mockImapFlowConstructor } = vi.hoisted(() => {
  return {
    mockImapFlowConstructor: vi.fn(),
  };
});

vi.mock('imapflow', () => {
  return {
    ImapFlow: class {
      constructor(config: any) {
        mockImapFlowConstructor(config);
      }
      connect() {
        return Promise.reject(new Error('Mock connect failure'));
      }
      logout() {
        return Promise.resolve();
      }
      getMailboxLock() {
        return Promise.resolve({ release: () => {} });
      }
      search() {
        return Promise.resolve([]);
      }
      fetch() {
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                return { done: true, value: undefined };
              }
            };
          }
        };
      }
      usable = true;
      idle() {
        this.usable = false;
        return Promise.resolve();
      }
      on(event: string, handler: Function) {
        // Mock method
      }
    }
  };
});

let consoleErrorSpy: any;
let consoleLogSpy: any;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy?.mockRestore();
  consoleLogSpy?.mockRestore();
});

// ============================================================================
// 1. OutboundEmailService Tests
// ============================================================================

describe('OutboundEmailService', () => {
  let service: OutboundEmailService;
  let mockTransporter: any;

  beforeEach(() => {
    // Mock nodemailer's createTransport
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'test@example.com',
      SMTP_PASS: 'password',
      SMTP_FROM: 'noreply@example.com',
    };

    service = new OutboundEmailService();
    mockTransporter = {
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-id' }),
    };
    service['transporter'] = mockTransporter;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should send email with correct parameters', async () => {
    const to = 'profesor@example.com';
    const subject = 'Test Subject';
    const body = 'Test body content';

    await service.send(to, subject, body);

    expect(mockTransporter.sendMail).toHaveBeenCalledWith({
      from: 'noreply@example.com',
      to,
      subject,
      text: body,
    });
  });

  it('should throw error for missing recipient', async () => {
    await expect(service.send('', 'Subject', 'Body')).rejects.toThrow('Falta el destinatario');
  });

  it('should handle SMTP errors gracefully', async () => {
    mockTransporter.sendMail.mockRejectedValueOnce(new Error('SMTP error'));

    await expect(service.send('test@example.com', 'Subject', 'Body')).rejects.toThrow('SMTP error');
  });

  it('should use SMTP_FROM env variable', async () => {
    process.env.SMTP_FROM = 'custom@example.com';
    const newService = new OutboundEmailService();
    newService['transporter'] = mockTransporter;

    await newService.send('recipient@example.com', 'Subject', 'Body');

    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'custom@example.com',
      })
    );
  });

  it('should fallback to SMTP_USER if SMTP_FROM not set', async () => {
    delete process.env.SMTP_FROM;
    process.env.SMTP_USER = 'fallback@example.com';
    const newService = new OutboundEmailService();
    newService['transporter'] = mockTransporter;

    await newService.send('recipient@example.com', 'Subject', 'Body');

    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'fallback@example.com',
      })
    );
  });
});

// ============================================================================
// 2. InstitutionalEmailMonitor - Field Parsing Tests
// ============================================================================

describe('InstitutionalEmailMonitor - parseStructuredFields', () => {
  let monitor: InstitutionalEmailMonitor;
  let mockEmailService: any;
  let mockNoticeRepo: any;
  let mockReminderRepo: any;

  beforeEach(() => {
    mockEmailService = {
      fetchUnreadInstitutionEmails: vi.fn().mockResolvedValue([]),
    };
    mockNoticeRepo = {
      getByUniqueHashWithId: vi.fn(),
    };
    mockReminderRepo = {
      create: vi.fn(),
    };

    monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      vi.fn(),
    );
  });

  it('should parse structured fields from email body', () => {
    const body = `nombre: Test Notice
inicia: 15/06/2026
termina: 20/06/2026
hora: 14:30
cuerpo: Test body content
frecuencia: unica
grupo: todos`;

    const fields = monitor['parseStructuredFields'](body);

    expect(fields.nombre).toBe('Test Notice');
    expect(fields.inicia).toBe('15/06/2026');
    expect(fields.termina).toBe('20/06/2026');
    expect(fields.hora).toBe('14:30');
    expect(fields.cuerpo).toBe('Test body content');
    expect(fields.frecuencia).toBe('unica');
    expect(fields.grupo).toBe('todos');
  });

  it('should handle case-insensitive field names', () => {
    const body = `NOMBRE: Test
INICIA: 15/06/2026
Termina: 20/06/2026`;

    const fields = monitor['parseStructuredFields'](body);

    expect(fields.nombre).toBe('Test');
    expect(fields.inicia).toBe('15/06/2026');
    expect(fields.termina).toBe('20/06/2026');
  });

  it('should trim whitespace from field values', () => {
    const body = `nombre:  Test with spaces  
inicia:   15/06/2026   `;

    const fields = monitor['parseStructuredFields'](body);

    expect(fields.nombre).toContain('Test with spaces');
  });

  it('should ignore non-structured lines', () => {
    const body = `Some random text
nombre: Test Notice
More random text
inicia: 15/06/2026`;

    const fields = monitor['parseStructuredFields'](body);

    expect(fields.nombre).toBe('Test Notice');
    expect(fields.inicia).toBe('15/06/2026');
    expect(Object.keys(fields).length).toBe(2);
  });

  it('should parse fields with markdown bold or decorator characters', () => {
    const body = `**nombre**: Test Notice
*inicia*: 15/06/2026
__termina__: 20/06/2026
_cuerpo_: Real body text`;

    const fields = monitor['parseStructuredFields'](body);

    expect(fields.nombre).toBe('Test Notice');
    expect(fields.inicia).toBe('15/06/2026');
    expect(fields.termina).toBe('20/06/2026');
    expect(fields.cuerpo).toBe('Real body text');
  });

  it('should parse multiline cuerpo fields and ignore quoted reply content', () => {
    const body = `nombre: Test Notice
cuerpo: ¡Buenas tardes!

Esta es una línea adicional de mi aviso.
Y otra más.

El jue, 11 jun 2026 a las 8:17, <bot.vectoritotsds@gmail.com> escribió:
> cuerpo: [Escribe aquí el cuerpo del aviso]`;

    const fields = monitor['parseStructuredFields'](body);

    expect(fields.nombre).toBe('Test Notice');
    expect(fields.cuerpo).toBe('¡Buenas tardes!\n\nEsta es una línea adicional de mi aviso.\nY otra más.');
  });

  it('should parse fields from Gmail forwarded messages with bot email in headers', () => {
    const body = `---------- Forwarded message ---------
From: Natalia Agustina MORAN <natalia.moran@example.com>
Date: Thu, Jun 11, 2026 at 8:21 AM
Subject: Inscripciones abiertas a los Coloquios de junio 2026
To: <bot.vectoritotsds@gmail.com>

nombre: Natalia Agustina MORAN
inicia: 11/06/2026
frecuencia: unica
grupo: 2024
cuerpo: ¡Buenas tardes!

Ya se encuentran abiertas las inscripciones.`;

    const fields = monitor['parseStructuredFields'](body);

    expect(fields.nombre).toBe('Natalia Agustina MORAN');
    expect(fields.inicia).toBe('11/06/2026');
    expect(fields.frecuencia).toBe('unica');
    expect(fields.grupo).toBe('2024');
    expect(fields.cuerpo).toContain('¡Buenas tardes!');
    expect(fields.cuerpo).toContain('Ya se encuentran abiertas las inscripciones.');
  });

  it('should stop parsing at quoted blocks starting with >', () => {
    const body = `nombre: Test
cuerpo: Body text

> This is a quoted reply
> cuerpo: old value`;

    const fields = monitor['parseStructuredFields'](body);

    expect(fields.nombre).toBe('Test');
    expect(fields.cuerpo).toBe('Body text');
  });
});

// ============================================================================
// 3. InstitutionalEmailMonitor - Date Parsing Tests
// ============================================================================

describe('InstitutionalEmailMonitor - parseDate', () => {
  let monitor: InstitutionalEmailMonitor;
  let mockEmailService: any;
  let mockNoticeRepo: any;
  let mockReminderRepo: any;

  beforeEach(() => {
    mockEmailService = {
      fetchUnreadInstitutionEmails: vi.fn().mockResolvedValue([]),
    };
    mockNoticeRepo = {
      getByUniqueHashWithId: vi.fn(),
    };
    mockReminderRepo = {
      create: vi.fn(),
    };

    monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      vi.fn(),
    );
  });

  it('should parse DD/MM/YYYY format dates', () => {
    const date = monitor['parseDate']('15/06/2026');
    expect(date).toBeInstanceOf(Date);
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(5); // 0-indexed
    expect(date?.getDate()).toBe(15);
  });

  it('should return undefined for invalid dates', () => {
    expect(monitor['parseDate']('invalid')).toBeUndefined();
    expect(monitor['parseDate']('')).toBeUndefined();
  });

  it('should handle single-digit days/months with leading zeros', () => {
    const date = monitor['parseDate']('01/01/2026');
    expect(date?.getDate()).toBe(1);
    expect(date?.getMonth()).toBe(0);
  });

  it('should return undefined for null/undefined input', () => {
    expect(monitor['parseDate'](undefined as any)).toBeUndefined();
    expect(monitor['parseDate'](null as any)).toBeUndefined();
  });
});

// ============================================================================
// 4. InstitutionalEmailMonitor - Hash Generation Tests
// ============================================================================

describe('InstitutionalEmailMonitor - unique hash generation', () => {
  let monitor: InstitutionalEmailMonitor;
  let mockEmailService: any;
  let mockNoticeRepo: any;
  let mockReminderRepo: any;

  beforeEach(() => {
    mockEmailService = {
      fetchUnreadInstitutionEmails: vi.fn().mockResolvedValue([]),
    };
    mockNoticeRepo = {
      getByUniqueHashWithId: vi.fn(),
    };
    mockReminderRepo = {
      create: vi.fn(),
    };

    monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      vi.fn(),
    );
  });

  it('should generate consistent hash for same notice', () => {
    const email1 = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ninicia: 15/06/2026\ntermina: 20/06/2026\nhora: 14:30\ncuerpo: Body',
    } as any;

    const notice1 = monitor['parseNoticeFromEmail'](email1);
    const notice2 = monitor['parseNoticeFromEmail'](email1);

    expect(notice1?.uniqueHash).toBe(notice2?.uniqueHash);
  });

  it('should generate different hash for different notices', () => {
    const email1 = {
      subject: '!aviso: Test 1',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test 1\ncuerpo: Body 1',
    } as any;

    const email2 = {
      subject: '!aviso: Test 2',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test 2\ncuerpo: Body 2',
    } as any;

    const notice1 = monitor['parseNoticeFromEmail'](email1);
    const notice2 = monitor['parseNoticeFromEmail'](email2);

    expect(notice1?.uniqueHash).not.toBe(notice2?.uniqueHash);
  });

  it('should generate SHA256 format hash', () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'cuerpo: Body',
    } as any;

    const notice = monitor['parseNoticeFromEmail'](email);
    expect(notice?.uniqueHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ============================================================================
// 5. InstitutionalEmailMonitor - Sender Validation Tests
// ============================================================================

describe('InstitutionalEmailMonitor - sender validation', () => {
  let monitor: InstitutionalEmailMonitor;
  let mockEmailService: any;
  let mockNoticeRepo: any;
  let mockReminderRepo: any;
  let mockManagedTeacherRepo: any;
  let mockOutboundEmailService: any;

  beforeEach(() => {
    mockEmailService = {
      fetchUnreadInstitutionEmails: vi.fn(),
    };
    mockNoticeRepo = {
      getByUniqueHashWithId: vi.fn().mockResolvedValue(null),
      createIfNew: vi.fn().mockResolvedValue(true),
      markPublished: vi.fn(),
      markConfirmed: vi.fn(),
      deleteById: vi.fn(),
    };
    mockReminderRepo = {
      create: vi.fn(),
    };
    mockManagedTeacherRepo = {
      getByEmail: vi.fn(),
    };
    mockOutboundEmailService = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      vi.fn().mockResolvedValue(undefined),
      undefined,
      mockManagedTeacherRepo,
      undefined,
      mockOutboundEmailService,
    );
  });

  it('should reject email from unauthorized sender', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'unknown@example.com' },
      text: 'nombre: Test\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockManagedTeacherRepo.getByEmail.mockResolvedValueOnce(null);

    const processed = await monitor.pollOnce();

    expect(processed).toBe(0);
    expect(mockOutboundEmailService.send).toHaveBeenCalledWith(
      'unknown@example.com',
      'Correo no autorizado',
      expect.stringContaining('no está asociado a un profesor registrado')
    );
  });

  it('should accept email from authorized sender', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockManagedTeacherRepo.getByEmail.mockResolvedValueOnce({
      email: 'profesor@example.com',
      name: 'Prof Test',
    } as ManagedTeacher);

    const processed = await monitor.pollOnce();

    expect(processed).toBe(1);
    expect(mockNoticeRepo.createIfNew).toHaveBeenCalled();
  });

  it('should handle email addresses in angle brackets', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'Prof Test <profesor@example.com>' },
      text: 'nombre: Test\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockManagedTeacherRepo.getByEmail.mockResolvedValueOnce({
      email: 'profesor@example.com',
    } as ManagedTeacher);

    const processed = await monitor.pollOnce();

    expect(processed).toBe(1);
    expect(mockManagedTeacherRepo.getByEmail).toHaveBeenCalledWith('profesor@example.com');
  });

  it('should handle email validation case-insensitively', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'PROFESOR@EXAMPLE.COM' },
      text: 'nombre: Test\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockManagedTeacherRepo.getByEmail.mockResolvedValueOnce({
      email: 'profesor@example.com',
    } as ManagedTeacher);

    await monitor.pollOnce();

    expect(mockManagedTeacherRepo.getByEmail).toHaveBeenCalledWith('profesor@example.com');
  });
});

// ============================================================================
// 6. InstitutionalEmailMonitor - Duplicate Prevention Tests
// ============================================================================

describe('InstitutionalEmailMonitor - duplicate prevention', () => {
  let monitor: InstitutionalEmailMonitor;
  let mockEmailService: any;
  let mockNoticeRepo: any;
  let mockReminderRepo: any;
  let mockOutboundEmailService: any;

  beforeEach(() => {
    mockEmailService = {
      fetchUnreadInstitutionEmails: vi.fn(),
    };
    mockNoticeRepo = {
      getByUniqueHashWithId: vi.fn(),
      createIfNew: vi.fn().mockResolvedValue(true),
      markPublished: vi.fn(),
      markConfirmed: vi.fn(),
    };
    mockReminderRepo = {
      create: vi.fn(),
    };
    mockOutboundEmailService = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      vi.fn().mockResolvedValue(undefined),
      undefined,
      undefined,
      undefined,
      mockOutboundEmailService,
    );
  });

  it('should ignore duplicate notice that is already confirmed', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId.mockResolvedValueOnce({
      id: 1,
      notice: {
        title: 'Test',
        body: 'Body',
        confirmed_at: new Date(),
      } as InstitutionalNotice,
    });

    const processed = await monitor.pollOnce();

    expect(processed).toBe(0);
    expect(mockOutboundEmailService.send).not.toHaveBeenCalled();
  });

  it('should retry confirmation for unconfirmed duplicate', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId.mockResolvedValueOnce({
      id: 1,
      notice: {
        title: 'Test',
        body: 'Body',
        source_email: 'profesor@example.com',
        confirmed_at: null,
      } as InstitutionalNotice,
    });

    const processed = await monitor.pollOnce();

    expect(processed).toBe(0);
    expect(mockOutboundEmailService.send).toHaveBeenCalledWith(
      'profesor@example.com',
      expect.stringContaining('reintento'),
      expect.any(String)
    );
    expect(mockNoticeRepo.markConfirmed).toHaveBeenCalledWith(1);
  });
});

// ============================================================================
// 7. InstitutionalEmailMonitor - Temporal Validation Tests
// ============================================================================

describe('InstitutionalEmailMonitor - temporal validation', () => {
  let monitor: InstitutionalEmailMonitor;
  let mockEmailService: any;
  let mockNoticeRepo: any;
  let mockReminderRepo: any;
  let mockOutboundEmailService: any;

  beforeEach(() => {
    mockEmailService = {
      fetchUnreadInstitutionEmails: vi.fn(),
    };
    mockNoticeRepo = {
      getByUniqueHashWithId: vi.fn().mockResolvedValue(null),
    };
    mockReminderRepo = {
      create: vi.fn(),
    };
    mockOutboundEmailService = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      vi.fn().mockResolvedValue(undefined),
      undefined,
      undefined,
      undefined,
      mockOutboundEmailService,
    );
  });

  it('should reject notice with expired end_date', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${String(yesterday.getDate()).padStart(2, '0')}/${String(yesterday.getMonth() + 1).padStart(2, '0')}/${yesterday.getFullYear()}`;

    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: `nombre: Test\ntermina: ${yesterdayStr}\ncuerpo: Body`,
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);

    const processed = await monitor.pollOnce();

    expect(processed).toBe(0);
    expect(mockOutboundEmailService.send).toHaveBeenCalledWith(
      'profesor@example.com',
      expect.stringContaining('Error'),
      expect.stringContaining('expirada')
    );
  });

  it('should reject notice with invalid date range (start > end)', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ninicia: 20/06/2030\ntermina: 15/06/2030\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);

    const processed = await monitor.pollOnce();

    expect(processed).toBe(0);
    expect(mockOutboundEmailService.send).toHaveBeenCalledWith(
      'profesor@example.com',
      expect.stringContaining('Error'),
      expect.stringContaining('inconsistente')
    );
  });

  it('should accept notice with future end_date', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${String(tomorrow.getDate()).padStart(2, '0')}/${String(tomorrow.getMonth() + 1).padStart(2, '0')}/${tomorrow.getFullYear()}`;

    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: `nombre: Test\ntermina: ${tomorrowStr}\ncuerpo: Body`,
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.createIfNew = vi.fn().mockResolvedValue(true);
    mockNoticeRepo.markPublished = vi.fn();
    mockNoticeRepo.markConfirmed = vi.fn();
    mockNoticeRepo.getByUniqueHashWithId.mockResolvedValueOnce(null);

    const processed = await monitor.pollOnce();

    expect(processed).toBe(1);
    expect(mockNoticeRepo.createIfNew).toHaveBeenCalled();
  });
});

// ============================================================================
// 8. InstitutionalEmailMonitor - Group Resolution Tests
// ============================================================================

describe('InstitutionalEmailMonitor - group resolution', () => {
  let monitor: InstitutionalEmailMonitor;
  let mockEmailService: any;
  let mockNoticeRepo: any;
  let mockReminderRepo: any;
  let mockGroupRepo: any;
  let mockPublishCallback: any;

  beforeEach(() => {
    mockEmailService = {
      fetchUnreadInstitutionEmails: vi.fn(),
    };
    mockNoticeRepo = {
      getByUniqueHashWithId: vi.fn(),
      createIfNew: vi.fn().mockResolvedValue(true),
      markPublished: vi.fn(),
      markConfirmed: vi.fn(),
      markSent: vi.fn(),
      deleteById: vi.fn(),
    };
    mockReminderRepo = {
      create: vi.fn(),
    };
    mockGroupRepo = {
      getAllActiveGroupsWithEntryYear: vi.fn().mockResolvedValue([
        { group_id: 'group1', display_name: 'Group 1', entry_year: null },
        { group_id: 'group2', display_name: 'Group 2', entry_year: 2025 },
        { group_id: 'group3', display_name: 'Group 3', entry_year: 2026 },
      ]),
    };
    mockPublishCallback = vi.fn().mockResolvedValue(undefined);

    monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      mockPublishCallback,
      undefined,
      undefined,
      mockGroupRepo,
      undefined,
    );
  });

  it('should resolve "todos" to all groups', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ngrupo: todos\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({
        id: 1,
        notice: { title: 'Test' } as InstitutionalNotice,
      }); // get id after insert

    await monitor.pollOnce();

    expect(mockPublishCallback).toHaveBeenCalledTimes(3);
    expect(mockPublishCallback).toHaveBeenCalledWith(expect.any(String), 'group1');
    expect(mockPublishCallback).toHaveBeenCalledWith(expect.any(String), 'group2');
    expect(mockPublishCallback).toHaveBeenCalledWith(expect.any(String), 'group3');
  });

  it('should resolve "general" to groups with entry_year=null', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ngrupo: general\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({
        id: 1,
        notice: { title: 'Test' } as InstitutionalNotice,
      }); // get id after insert

    await monitor.pollOnce();

    expect(mockPublishCallback).toHaveBeenCalledTimes(1);
    expect(mockPublishCallback).toHaveBeenCalledWith(expect.any(String), 'group1');
  });

  it('should resolve "camada:2025" to specific cohort groups', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ngrupo: camada:2025\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({
        id: 1,
        notice: { title: 'Test' } as InstitutionalNotice,
      }); // get id after insert

    await monitor.pollOnce();

    expect(mockPublishCallback).toHaveBeenCalledTimes(1);
    expect(mockPublishCallback).toHaveBeenCalledWith(expect.any(String), 'group2');
  });

  it('should resolve "camada:2025,2026" to multiple cohort groups', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ngrupo: camada:2025,2026\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({
        id: 1,
        notice: { title: 'Test' } as InstitutionalNotice,
      }); // get id after insert

    await monitor.pollOnce();

    expect(mockPublishCallback).toHaveBeenCalledTimes(2);
    expect(mockPublishCallback).toHaveBeenCalledWith(expect.any(String), 'group2');
    expect(mockPublishCallback).toHaveBeenCalledWith(expect.any(String), 'group3');
  });

  it('should reject notice with non-existent cohort', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ngrupo: camada:2050\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    const mockOutboundEmailService = { send: vi.fn().mockResolvedValue(undefined) };
    monitor['outboundEmailService'] = mockOutboundEmailService;

    const processed = await monitor.pollOnce();

    expect(processed).toBe(0);
    expect(mockPublishCallback).not.toHaveBeenCalled();
    expect(mockOutboundEmailService.send).toHaveBeenCalledWith(
      'profesor@example.com',
      expect.stringContaining('Error'),
      expect.stringContaining('2050')
    );
  });

  it('should reject notice with invalid group selector', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ngrupo: invalid_selector\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    const mockOutboundEmailService = { send: vi.fn().mockResolvedValue(undefined) };
    monitor['outboundEmailService'] = mockOutboundEmailService;

    const processed = await monitor.pollOnce();

    expect(processed).toBe(0);
    expect(mockPublishCallback).not.toHaveBeenCalled();
  });

  it('should default to "todos" if grupo not specified', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({
        id: 1,
        notice: { title: 'Test', grupo_selector: 'todos' } as InstitutionalNotice,
      }); // get id after insert

    await monitor.pollOnce();

    expect(mockPublishCallback).toHaveBeenCalledTimes(3);
  });
});

// ============================================================================
// 9. InstitutionalEmailMonitor - Atomic Publication Tests
// ============================================================================

describe('InstitutionalEmailMonitor - atomic publication', () => {
  let monitor: InstitutionalEmailMonitor;
  let mockEmailService: any;
  let mockNoticeRepo: any;
  let mockReminderRepo: any;
  let mockPublishCallback: any;

  beforeEach(() => {
    mockEmailService = {
      fetchUnreadInstitutionEmails: vi.fn(),
    };
    mockNoticeRepo = {
      getByUniqueHashWithId: vi.fn(),
      createIfNew: vi.fn().mockResolvedValue(true),
      markPublished: vi.fn(),
      markConfirmed: vi.fn(),
      markSent: vi.fn(),
      deleteById: vi.fn(),
    };
    mockReminderRepo = {
      create: vi.fn(),
    };
    mockPublishCallback = vi.fn();

    monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      mockPublishCallback,
    );
  });

  it('should rollback notice if publication fails', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({ id: 1, notice: { title: 'Test' } as InstitutionalNotice }); // get id after insert
    mockPublishCallback.mockRejectedValueOnce(new Error('WhatsApp API error'));

    const processed = await monitor.pollOnce();

    expect(processed).toBe(0);
    expect(mockNoticeRepo.deleteById).toHaveBeenCalledWith(1);
    expect(mockNoticeRepo.markSent).not.toHaveBeenCalled();
  });

  it('should not rollback if publication succeeds', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({ id: 1, notice: { title: 'Test' } as InstitutionalNotice }); // get id after insert
    mockPublishCallback.mockResolvedValueOnce(undefined);

    const processed = await monitor.pollOnce();

    expect(processed).toBe(1);
    expect(mockNoticeRepo.markSent).toHaveBeenCalledWith(1);
    expect(mockNoticeRepo.deleteById).not.toHaveBeenCalled();
  });

  it('should mark published for each group publication', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    const mockGroupRepo = {
      getAllActiveGroupsWithEntryYear: vi.fn().mockResolvedValue([
        { group_id: 'group1', entry_year: null },
        { group_id: 'group2', entry_year: 2025 },
      ]),
    };

    monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      mockPublishCallback,
      undefined,
      undefined,
      mockGroupRepo,
    );

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({ id: 1, notice: { title: 'Test', grupo_selector: 'todos' } as InstitutionalNotice }); // get id after insert
    mockPublishCallback.mockResolvedValue(undefined);

    const processed = await monitor.pollOnce();

    expect(processed).toBe(1);
    expect(mockNoticeRepo.markSent).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// 10. InstitutionalEmailMonitor - Confirmation Email Tests
// ============================================================================

describe('InstitutionalEmailMonitor - confirmation email', () => {
  let monitor: InstitutionalEmailMonitor;
  let mockEmailService: any;
  let mockNoticeRepo: any;
  let mockReminderRepo: any;
  let mockOutboundEmailService: any;

  beforeEach(() => {
    mockEmailService = {
      fetchUnreadInstitutionEmails: vi.fn(),
    };
    mockNoticeRepo = {
      getByUniqueHashWithId: vi.fn(),
      createIfNew: vi.fn().mockResolvedValue(true),
      markPublished: vi.fn(),
      markConfirmed: vi.fn(),
      markSent: vi.fn(),
      deleteById: vi.fn(),
    };
    mockReminderRepo = {
      create: vi.fn(),
    };
    mockOutboundEmailService = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      vi.fn().mockResolvedValue(undefined),
      undefined,
      undefined,
      undefined,
      mockOutboundEmailService,
    );
  });

  it('should send confirmation email after successful publication', async () => {
    const email = {
      subject: '!aviso: Test Notice',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ninicia: 15/06/2026\ntermina: 20/06/2026\nhora: 14:30\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({
        id: 1,
        notice: {
          title: 'Test',
          source_email: 'profesor@example.com',
          start_date: new Date('2026-06-15'),
          end_date: new Date('2026-06-20'),
          event_time: '14:30',
        } as InstitutionalNotice,
      }); // get id after insert

    const processed = await monitor.pollOnce();

    expect(processed).toBe(1);
    expect(mockOutboundEmailService.send).toHaveBeenCalledWith(
      'profesor@example.com',
      'Confirmación de aviso institucional recibido',
      expect.stringContaining('Test')
    );
    expect(mockNoticeRepo.markConfirmed).toHaveBeenCalledWith(1);
  });

  it('should include notice details in confirmation email', async () => {
    const email = {
      subject: '!aviso: Examen Final',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Examen Final Matemática\ninicia: 15/06/2026\ntermina: 20/06/2026\nhora: 14:30\ncuerpo: Las inscripciones abren el 15 de junio.',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({
        id: 1,
        notice: {
          title: 'Examen Final Matemática',
          source_email: 'profesor@example.com',
          start_date: new Date('2026-06-15'),
          end_date: new Date('2026-06-20'),
          event_time: '14:30',
          grupo_selector: 'todos',
        } as InstitutionalNotice,
      }); // get id after insert

    await monitor.pollOnce();

    expect(mockOutboundEmailService.send).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.stringContaining('Examen Final Matemática')
    );
  });

  it('should handle confirmation email failure gracefully', async () => {
    const email = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({
        id: 1,
        notice: { title: 'Test', source_email: 'profesor@example.com' } as InstitutionalNotice,
      }); // get id after insert
    mockOutboundEmailService.send.mockRejectedValueOnce(new Error('SMTP error'));

    const processed = await monitor.pollOnce();

    // Should still count as processed even if email fails
    expect(processed).toBe(1);
  });
});

// ============================================================================
// 11. Integration Tests - Full Workflow
// ============================================================================

describe('InstitutionalEmailMonitor - full workflow integration', () => {
  let monitor: InstitutionalEmailMonitor;
  let mockEmailService: any;
  let mockNoticeRepo: any;
  let mockReminderRepo: any;
  let mockManagedTeacherRepo: any;
  let mockGroupRepo: any;
  let mockPublishCallback: any;
  let mockOutboundEmailService: any;

  beforeEach(() => {
    mockEmailService = {
      fetchUnreadInstitutionEmails: vi.fn(),
    };
    mockNoticeRepo = {
      getByUniqueHashWithId: vi.fn(),
      createIfNew: vi.fn().mockResolvedValue(true),
      markPublished: vi.fn(),
      markConfirmed: vi.fn(),
      markSent: vi.fn(),
      deleteById: vi.fn(),
    };
    mockReminderRepo = {
      create: vi.fn(),
    };
    mockManagedTeacherRepo = {
      getByEmail: vi.fn().mockResolvedValue({
        email: 'profesor@example.com',
        name: 'Prof Test',
      } as ManagedTeacher),
    };
    mockGroupRepo = {
      getAllActiveGroupsWithEntryYear: vi.fn().mockResolvedValue([
        { group_id: 'group1', display_name: 'Group 1', entry_year: null },
        { group_id: 'group2', display_name: 'Group 2', entry_year: 2025 },
      ]),
    };
    mockPublishCallback = vi.fn().mockResolvedValue(undefined);
    mockOutboundEmailService = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      mockPublishCallback,
      undefined,
      mockManagedTeacherRepo,
      mockGroupRepo,
      mockOutboundEmailService,
    );
  });

  it('should complete full workflow: validate -> resolve -> publish -> confirm', async () => {
    const email = {
      subject: '!aviso: Examen Final',
      from: { text: 'profesor@example.com' },
      text: `nombre: Examen Final Matemática
inicia: 15/06/2026
termina: 20/06/2026
hora: 14:30
grupo: camada:2025
cuerpo: Las inscripciones abren el 15 de junio.
frecuencia: unica`,
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({
        id: 1,
        notice: {
          title: 'Examen Final Matemática',
          source_email: 'profesor@example.com',
          start_date: new Date('2026-06-15'),
          end_date: new Date('2026-06-20'),
          event_time: '14:30',
          grupo_selector: 'camada:2025',
          frecuencia: 'unica',
        } as InstitutionalNotice,
      }); // get id after insert

    const processed = await monitor.pollOnce();

    expect(processed).toBe(1);

    // Validation
    expect(mockManagedTeacherRepo.getByEmail).toHaveBeenCalledWith('profesor@example.com');

    // Duplicate check
    expect(mockNoticeRepo.getByUniqueHashWithId).toHaveBeenCalled();

    // Insertion
    expect(mockNoticeRepo.createIfNew).toHaveBeenCalled();

    // Group resolution (only group2 with entry_year 2025)
    expect(mockPublishCallback).toHaveBeenCalledTimes(1);
    expect(mockPublishCallback).toHaveBeenCalledWith(expect.any(String), 'group2');

    // Publishing
    expect(mockNoticeRepo.markSent).toHaveBeenCalledWith(1);

    // Reminder creation
    expect(mockReminderRepo.create).toHaveBeenCalled();

    // Confirmation
    expect(mockOutboundEmailService.send).toHaveBeenCalledWith(
      'profesor@example.com',
      expect.stringContaining('Confirmación'),
      expect.stringContaining('Examen Final Matemática')
    );
    expect(mockNoticeRepo.markConfirmed).toHaveBeenCalledWith(1);
  });

  it('should process multiple emails in single poll', async () => {
    const email1 = {
      subject: '!aviso: Email 1',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test 1\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body 1',
    } as any;

    const email2 = {
      subject: '!aviso: Email 2',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test 2\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body 2',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email1, email2]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // email1 duplicate check
      .mockResolvedValueOnce({ id: 1, notice: { title: 'Test 1' } as InstitutionalNotice }) // email1 get id
      .mockResolvedValueOnce(null) // email2 duplicate check
      .mockResolvedValueOnce({ id: 2, notice: { title: 'Test 2' } as InstitutionalNotice }); // email2 get id

    const processed = await monitor.pollOnce();

    expect(processed).toBe(2);
    expect(mockNoticeRepo.createIfNew).toHaveBeenCalledTimes(2);
  });

  it('should skip non-aviso emails', async () => {
    const avisoEmail = {
      subject: '!aviso: Test',
      from: { text: 'profesor@example.com' },
      text: 'nombre: Test\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Body',
    } as any;

    const nonAvisoEmail = {
      subject: 'Regular email',
      from: { text: 'professor@example.com' },
      text: 'This is not an aviso',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([nonAvisoEmail, avisoEmail]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null) // aviso duplicate check
      .mockResolvedValueOnce({
        id: 1,
        notice: { title: 'Test', source_email: 'profesor@example.com' } as InstitutionalNotice,
      }); // aviso get id

    const processed = await monitor.pollOnce();

    expect(processed).toBe(1);
    expect(mockNoticeRepo.createIfNew).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// 12. Improved Institutional Email Notices & TLS Config Tests
// ============================================================================

import fs from 'fs';

describe('Improved Institutional Email Notices & TLS Config', () => {
  let mockEmailService: any;
  let mockNoticeRepo: any;
  let mockReminderRepo: any;
  let mockManagedTeacherRepo: any;
  let mockOutboundEmailService: any;
  let mockRejectionRepo: any;
  let originalEnv: any;

  beforeEach(() => {
    originalEnv = { ...process.env };
    
    mockEmailService = {
      fetchUnreadInstitutionEmails: vi.fn(),
    };
    mockNoticeRepo = {
      getByUniqueHashWithId: vi.fn(),
      createIfNew: vi.fn().mockResolvedValue(true),
      markPublished: vi.fn(),
      markConfirmed: vi.fn(),
      markSent: vi.fn(),
      deleteById: vi.fn(),
    };
    mockReminderRepo = {
      create: vi.fn(),
    };
    mockManagedTeacherRepo = {
      getByEmail: vi.fn(),
    };
    mockOutboundEmailService = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    // Mock InboundEmailRejectionRepository
    const storedRejections = new Set<string>();
    mockRejectionRepo = {
      exists: vi.fn(async (fp) => storedRejections.has(fp)),
      markIfNew: vi.fn(async (fp, sender, subject) => {
        if (storedRejections.has(fp)) return false;
        storedRejections.add(fp);
        return true;
      }),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should authorize superadmin and process/publish notice', async () => {
    process.env.SUPERADMIN_EMAILS = 'superadmin@ispc.edu.ar, otheradmin@ispc.edu.ar';
    const email = {
      subject: '!aviso: Superadmin Notice',
      from: { text: 'superadmin@ispc.edu.ar' },
      text: 'nombre: Super Notice\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Content',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 10, notice: { title: 'Super Notice' } as any });

    const monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      vi.fn().mockResolvedValue(undefined),
      undefined,
      mockManagedTeacherRepo,
      undefined,
      mockOutboundEmailService,
      mockRejectionRepo
    );

    const processed = await monitor.pollOnce();

    expect(processed).toBe(1);
    expect(mockManagedTeacherRepo.getByEmail).not.toHaveBeenCalled(); // Skipped because it is superadmin
    expect(mockNoticeRepo.createIfNew).toHaveBeenCalled();
  });

  it('should authorize normal teacher and process/publish notice', async () => {
    process.env.SUPERADMIN_EMAILS = 'superadmin@ispc.edu.ar';
    const email = {
      subject: '!aviso: Teacher Notice',
      from: { text: 'teacher@ispc.edu.ar' },
      text: 'nombre: Teacher Notice\ninicia: 15/06/2026\ntermina: 20/06/2026\ncuerpo: Content',
    } as any;

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 11, notice: { title: 'Teacher Notice' } as any });
    mockManagedTeacherRepo.getByEmail.mockResolvedValueOnce({ email: 'teacher@ispc.edu.ar', name: 'Prof' });

    const monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      vi.fn().mockResolvedValue(undefined),
      undefined,
      mockManagedTeacherRepo,
      undefined,
      mockOutboundEmailService,
      mockRejectionRepo
    );

    const processed = await monitor.pollOnce();

    expect(processed).toBe(1);
    expect(mockManagedTeacherRepo.getByEmail).toHaveBeenCalledWith('teacher@ispc.edu.ar');
    expect(mockNoticeRepo.createIfNew).toHaveBeenCalled();
  });

  it('should reject unauthorized sender and send rejection email only once', async () => {
    process.env.SUPERADMIN_EMAILS = 'superadmin@ispc.edu.ar';
    const email = {
      messageId: '<msg-id-123@ispc.edu.ar>',
      subject: '!aviso: Spammer Notice',
      from: { text: 'spammer@example.com' },
      text: 'cuerpo: Buy cheap pills',
    } as any;

    mockManagedTeacherRepo.getByEmail.mockResolvedValueOnce(null);

    const monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      vi.fn().mockResolvedValue(undefined),
      undefined,
      mockManagedTeacherRepo,
      undefined,
      mockOutboundEmailService,
      mockRejectionRepo
    );

    // First Poll
    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    const processed1 = await monitor.pollOnce();
    expect(processed1).toBe(0);
    expect(mockOutboundEmailService.send).toHaveBeenCalledTimes(1);
    expect(mockRejectionRepo.markIfNew).toHaveBeenCalledWith('<msg-id-123@ispc.edu.ar>', 'spammer@example.com', '!aviso: Spammer Notice');

    // Reset mocks for second poll (simulate cron running again)
    mockOutboundEmailService.send.mockClear();
    mockManagedTeacherRepo.getByEmail.mockResolvedValueOnce(null);

    // Second Poll
    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    const processed2 = await monitor.pollOnce();
    expect(processed2).toBe(0);
    expect(mockOutboundEmailService.send).not.toHaveBeenCalled(); // Deduplicated!
  });

  it('should generate deduplication fingerprint by fallback hash if Message-ID is missing', async () => {
    const email = {
      subject: '!aviso: Fallback Spammer',
      from: { text: 'spammer2@example.com' },
      date: new Date('2026-05-30T12:00:00Z'),
      text: 'cuerpo: Text content without message id',
    } as any;

    mockManagedTeacherRepo.getByEmail.mockResolvedValueOnce(null);

    const monitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      vi.fn().mockResolvedValue(undefined),
      undefined,
      mockManagedTeacherRepo,
      undefined,
      mockOutboundEmailService,
      mockRejectionRepo
    );

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    await monitor.pollOnce();

    expect(mockRejectionRepo.markIfNew).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/), // SHA-256 fingerprint hash
      'spammer2@example.com',
      '!aviso: Fallback Spammer'
    );
  });

  it('should parse TLS configuration environments and instantiate client with correct options', async () => {
    process.env.IMAP_USER = 'test@example.com';
    process.env.IMAP_PASSWORD = 'password';
    process.env.IMAP_TLS_REJECT_UNAUTHORIZED = 'false';
    process.env.IMAP_TLS_SERVERNAME = 'custom.imap.server';
    process.env.IMAP_TLS_CA_PATH = '';

    const service = new EmailService();
    const fsSpy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => Buffer.from('mock-ca-cert'));
    process.env.IMAP_TLS_CA_PATH = '/path/to/ca.pem';

    mockImapFlowConstructor.mockClear();

    try {
      await service.fetchUnreadInstitutionEmails();
      expect(fsSpy).toHaveBeenCalledWith('/path/to/ca.pem');
      expect(mockImapFlowConstructor).toHaveBeenCalled();
      const passedConfig = mockImapFlowConstructor.mock.calls[0][0];
      expect(passedConfig.tls).toEqual({
        rejectUnauthorized: false,
        servername: 'custom.imap.server',
        ca: expect.any(Buffer),
      });
    } finally {
      fsSpy.mockRestore();
    }
  });

  it('should reject email with placeholder content and reply with clear explanation', async () => {
    const email = {
      subject: '!aviso: Test Placeholder',
      from: { text: 'profesor@example.com' },
      text: 'grupo: general\ncuerpo: [Mensaje/Cuerpo del aviso] (obligatorio)',
    } as any;

    const mockRejectionRepo = {
      exists: vi.fn().mockResolvedValue(false),
      markIfNew: vi.fn().mockResolvedValue(true),
    };

    const localMonitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      vi.fn(),
      undefined,
      undefined, // no teacher repository -> defaults to authorized
      undefined,
      mockOutboundEmailService,
      mockRejectionRepo as any
    );

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    await localMonitor.pollOnce();

    expect(mockOutboundEmailService.send).toHaveBeenCalledWith(
      'profesor@example.com',
      'Formato de aviso institucional inválido o incompleto',
      expect.stringContaining('❌ No has completado el campo obligatorio "cuerpo"'),
      expect.any(String)
    );
  });

  it('should resolve group selector by number correctly', async () => {
    const email = {
      subject: '!aviso: Test Number Option',
      from: { text: 'profesor@example.com' },
      text: 'grupo: 2\ncuerpo: Mensaje de aviso real',
    } as any;

    const mockGroupRepo = {
      getAllActiveGroupsWithEntryYear: vi.fn().mockResolvedValue([
        { group_id: 'group1', display_name: 'Group 1', entry_year: null },
        { group_id: 'group2', display_name: 'Group 2', entry_year: 2025 },
      ]),
    };

    const mockPublishCallback = vi.fn().mockResolvedValue(undefined);

    const localMonitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      mockPublishCallback,
      undefined,
      undefined, // no teacher repository -> defaults to authorized
      mockGroupRepo as any,
      mockOutboundEmailService
    );

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 1, notice: { title: 'Test Number Option' } as any });

    await localMonitor.pollOnce();

    // Number 2 maps to the 2nd individual group (group2)
    expect(mockPublishCallback).toHaveBeenCalledTimes(1);
    expect(mockPublishCallback).toHaveBeenCalledWith(expect.any(String), 'group2');
  });

  it('should resolve group selector by letter for cohort correctly', async () => {
    const email = {
      subject: '!aviso: Test Letter Option',
      from: { text: 'profesor@example.com' },
      text: 'grupo: A\ncuerpo: Mensaje para la camada',
    } as any;

    const mockGroupRepo = {
      getAllActiveGroupsWithEntryYear: vi.fn().mockResolvedValue([
        { group_id: 'group1', display_name: 'Group 1', entry_year: null },
        { group_id: 'group2', display_name: 'Group 2', entry_year: 2025 },
        { group_id: 'group3', display_name: 'Group 3', entry_year: 2025 },
      ]),
    };

    const mockPublishCallback = vi.fn().mockResolvedValue(undefined);

    const localMonitor = new InstitutionalEmailMonitor(
      mockEmailService,
      mockNoticeRepo,
      mockReminderRepo,
      mockPublishCallback,
      undefined,
      undefined,
      mockGroupRepo as any,
      mockOutboundEmailService
    );

    mockEmailService.fetchUnreadInstitutionEmails.mockResolvedValueOnce([email]);
    mockNoticeRepo.getByUniqueHashWithId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 1, notice: { title: 'Test Letter Option' } as any });

    await localMonitor.pollOnce();

    // Letter A maps to the first cohort (2025), which has group2 and group3
    expect(mockPublishCallback).toHaveBeenCalledTimes(2);
    expect(mockPublishCallback).toHaveBeenCalledWith(expect.any(String), 'group2');
    expect(mockPublishCallback).toHaveBeenCalledWith(expect.any(String), 'group3');
  });
});
