import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import { run } from '../../../shared/db/db-utils.js';
import { InstitutionalNoticeRepository, ClassNotificationRepository } from '../notifications.repository.js';
import { ClassNotificationService } from '../class-notification.service.js';
import { ExamNotificationService } from '../exam-notification.service.ts';
import { ScheduledReminderService } from '../scheduled-reminder.service.js';
import { SmartNotificationService } from '../smart-notification.service.js';
import { InstitutionalEmailMonitor } from '../integrations/institutional-email-monitor.js';
import { EmailService, OutboundEmailService } from '../integrations/email.service.js';
import { ManagedClass, ManagedExam } from '../../../domain/models.js';

describe('Slice de Notificaciones - Pruebas Unitarias', () => {
  let db: sqlite3.Database;
  let noticeRepo: InstitutionalNoticeRepository;
  let classNotifRepo: ClassNotificationRepository;

  beforeEach(async () => {
    db = new sqlite3.Database(':memory:');
    
    // Create schemas
    await run(db, `
      CREATE TABLE IF NOT EXISTS institutional_notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        body TEXT,
        start_date TEXT,
        end_date TEXT,
        event_time TEXT,
        source_email TEXT,
        unique_hash TEXT UNIQUE,
        frecuencia TEXT DEFAULT 'unica',
        grupo_selector TEXT DEFAULT 'todos',
        published_at TEXT,
        confirmed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(db, `
      CREATE TABLE IF NOT EXISTS class_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        managed_class_id INTEGER,
        notification_sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
        minutes_before INTEGER
      )
    `);

    noticeRepo = new InstitutionalNoticeRepository(db);
    classNotifRepo = new ClassNotificationRepository(db);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => db.close(() => resolve()));
    vi.restoreAllMocks();
  });

  describe('InstitutionalNoticeRepository', () => {
    it('debería insertar y consultar un aviso institucional por hash único', async () => {
      const notice = {
        title: 'Mi Aviso',
        body: 'Cuerpo de aviso',
        unique_hash: 'hash123',
      };

      const inserted = await noticeRepo.createIfNew(notice);
      expect(inserted).toBe(true);

      const retrieved = await noticeRepo.getByUniqueHash('hash123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.title).toBe('Mi Aviso');
    });

    it('no debería duplicar avisos con el mismo hash', async () => {
      const notice = {
        title: 'Mi Aviso',
        body: 'Cuerpo de aviso',
        unique_hash: 'hash123',
      };

      await noticeRepo.createIfNew(notice);
      const insertedAgain = await noticeRepo.createIfNew(notice);
      expect(insertedAgain).toBe(false);
    });

    it('debería poder actualizar y marcar avisos como confirmados/publicados', async () => {
      const notice = {
        title: 'Aviso Test',
        body: 'Test',
        unique_hash: 'hashtest',
      };

      await noticeRepo.createIfNew(notice);
      const retrieved = await noticeRepo.getByUniqueHashWithId('hashtest');
      expect(retrieved).not.toBeNull();

      const id = retrieved!.id;
      await noticeRepo.markConfirmed(id);
      await noticeRepo.markPublished(id);

      const updated = await noticeRepo.getById(id);
      expect(updated?.confirmed_at).toBeInstanceOf(Date);
      expect(updated?.published_at).toBeInstanceOf(Date);
    });
  });

  describe('ClassNotificationRepository', () => {
    it('debería guardar y recuperar la última notificación enviada', async () => {
      const classId = 12;
      const minBefore = 10;

      const lastBefore = await classNotifRepo.getLastNotificationBefore(classId, minBefore);
      expect(lastBefore).toBeNull();

      await classNotifRepo.recordNotificationSent(classId, minBefore);

      const lastAfter = await classNotifRepo.getLastNotificationBefore(classId, minBefore);
      expect(lastAfter).toBeInstanceOf(Date);
    });
  });

  describe('ClassNotificationService', () => {
    it('debería calcular las clases para notificar', async () => {
      const mockClasses: ManagedClass[] = [
        {
          id: 1,
          subject: 'Matemática I',
          schedule_day: 'lunes',
          schedule_time: '18:00',
          meet_link: 'http://meet.com/math1',
          notifications_enabled: true,
          commission_count: 2,
        },
      ];

      const mockClassRepo = {
        listByDay: vi.fn().mockResolvedValue(mockClasses),
      } as any;

      const service = new ClassNotificationService(mockClassRepo, classNotifRepo);

      // 10 minutos antes de la clase (17:50)
      const now = new Date();
      now.setHours(17, 50, 0, 0);

      const classesToNotify = await service.getClassesToNotifyNow(now);
      expect(classesToNotify.length).toBe(1);
      expect(classesToNotify[0].subject).toBe('Matemática I');

      // Generar mensaje
      const message = service.buildNotificationMessage(classesToNotify[0]);
      expect(message).toContain('Matemática I');
      expect(message).toContain('http://meet.com/math1');
    });
  });

  describe('ExamNotificationService', () => {
    it('debería dar formato a los avisos de examen según disponibilidad', () => {
      const service = new ExamNotificationService({} as any, {} as any, []);

      const examSimple = {
        subject: 'Historia',
        exam_type: 'parcial',
        exam_time: '10:00',
        tipoDisponibilidad: 'hora-especifica',
      };

      const msg = service.formatNotificationMessage(examSimple, { value: 1, unit: 'd' });
      expect(msg).toContain('Quedan 1 día para el parcial de Historia');
    });
  });

  describe('ScheduledReminderService', () => {
    it('debería poder programar y listar recordatorios de examen', () => {
      const service = new ScheduledReminderService();
      
      const reminders = service.createRemindersForExam(
        1,
        'Parcial Programación',
        '2026-06-15',
        '18:00',
        'simple'
      );

      expect(reminders.length).toBeGreaterThan(0);
      expect(reminders[0].examName).toBe('Parcial Programación');
    });
  });

  describe('SmartNotificationService', () => {
    it('debería calcular la antelación de carga', () => {
      const service = new SmartNotificationService();
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
      const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
      
      const res = service.detectAnticipationNotification(tomorrowStr, '18:00');
      expect(res.isAnticipated).toBe(true);
      expect(res.hoursUntilStart).toBeLessThan(48);
      expect(res.hoursUntilStart).toBeGreaterThan(0);
    });
  });
});
