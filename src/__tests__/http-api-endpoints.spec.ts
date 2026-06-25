import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import sqlite3 from 'sqlite3';
import { HttpServer, JwtUtils } from '../interfaces/http/http-server.js';
import { OnboardingTokenRepository } from '../features/onboarding/onboarding-token.repository.js';
import { WebOtpRepository } from '../features/onboarding/web-otp.repository.js';
import {
  GroupRepository,
  GroupContextRepository,
  CommissionRepository,
  ManagedClassRepository,
  ClassCommissionScheduleRepository,
  ManagedExamRepository,
  InstitutionalNoticeRepository,
  AdminRepository,
  UserProfileRepository,
  ManagedTeacherRepository,
  AuthorizedEmailRepository
} from '../infrastructure/persistence/db/repositories.js';
import { OutboundEmailService } from '../features/notifications/integrations/email.service.js';
import { VectoritoWhatsAppGateway } from '../interfaces/whatsapp/vectorito-whatsapp-gateway.js';

describe('HTTP REST API Endpoints', () => {
  let db: sqlite3.Database;
  let server: HttpServer;
  
  // Repositories
  let onboardingTokenRepo: OnboardingTokenRepository;
  let webOtpRepo: WebOtpRepository;
  let groupRepo: GroupRepository;
  let groupContextRepo: GroupContextRepository;
  let commissionRepo: CommissionRepository;
  let managedClassRepo: ManagedClassRepository;
  let classCommissionScheduleRepo: ClassCommissionScheduleRepository;
  let managedExamRepo: ManagedExamRepository;
  let noticeRepo: InstitutionalNoticeRepository;
  let adminRepo: AdminRepository;
  let userProfileRepo: UserProfileRepository;
  let teacherRepo: ManagedTeacherRepository;
  let authorizedEmailRepo: AuthorizedEmailRepository;
  
  // Mocks
  let mockEmailService: any;
  let mockGateway: any;

  const testPort = 3199;
  const baseUrl = `http://localhost:${testPort}`;

  beforeEach(async () => {
    db = new sqlite3.Database(':memory:');
    
    // Create tables
    await new Promise<void>((resolve, reject) => {
      db.serialize(() => {
        db.run(`
          CREATE TABLE IF NOT EXISTS user_profiles (
            user_id TEXT PRIMARY KEY,
            email TEXT,
            name TEXT
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS admin_users (
            user_id TEXT PRIMARY KEY,
            is_authenticated INTEGER,
            is_super_admin INTEGER,
            updated_at TEXT
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS managed_teachers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT,
            subject TEXT,
            group_id TEXT,
            commission_id INTEGER,
            commission_label TEXT,
            phone TEXT,
            notify_email INTEGER DEFAULT 1,
            notify_whatsapp INTEGER DEFAULT 1,
            meet_link TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS authorized_emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            description TEXT
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS web_otp_sessions (
            email TEXT PRIMARY KEY,
            code TEXT,
            user_id TEXT,
            expires_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS whatsapp_groups (
            group_id TEXT PRIMARY KEY,
            display_name TEXT
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS group_context (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT UNIQUE,
            year INTEGER,
            commission_id INTEGER,
            label TEXT,
            configured_by TEXT
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS academic_subjects (
            id TEXT PRIMARY KEY,
            name TEXT,
            year INTEGER
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS commissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            year INTEGER,
            shift TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(name, year, shift)
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS managed_classes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT,
            schedule_day TEXT,
            schedule_time TEXT,
            meet_link TEXT,
            notifications_enabled INTEGER,
            commission_count INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            group_id TEXT
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS class_commission_schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            managed_class_id INTEGER NOT NULL,
            commission_id INTEGER NOT NULL,
            schedule_day TEXT NOT NULL,
            schedule_time TEXT NOT NULL,
            meet_link TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(managed_class_id) REFERENCES managed_classes(id) ON DELETE CASCADE,
            FOREIGN KEY(commission_id) REFERENCES commissions(id) ON DELETE CASCADE
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS group_context_commissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_context_id INTEGER NOT NULL,
            commission_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(group_context_id, commission_id),
            FOREIGN KEY(group_context_id) REFERENCES group_context(id) ON DELETE CASCADE,
            FOREIGN KEY(commission_id) REFERENCES commissions(id) ON DELETE CASCADE
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS managed_exams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT,
            exam_date TEXT,
            exam_time TEXT,
            exam_type TEXT,
            observations TEXT,
            created_by TEXT,
            tipo_disponibilidad TEXT,
            hora_inicio TEXT,
            hora_fin TEXT,
            frecuencia_avisos TEXT,
            ultimo_aviso_enviado TEXT,
            exam_commission_id INTEGER,
            group_id TEXT
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS institutional_notices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            body TEXT,
            start_date TEXT,
            end_date TEXT,
            event_time TEXT,
            source_email TEXT,
            unique_hash TEXT UNIQUE,
            frecuencia TEXT,
            grupo_selector TEXT,
            confirmed_at TEXT,
            published_at TEXT,
            last_sent_at TEXT
          )
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    // Instantiate Repositories
    onboardingTokenRepo = new OnboardingTokenRepository(db);
    webOtpRepo = new WebOtpRepository(db);
    groupRepo = new GroupRepository(db);
    groupContextRepo = new GroupContextRepository(db);
    commissionRepo = new CommissionRepository(db);
    managedClassRepo = new ManagedClassRepository(db);
    classCommissionScheduleRepo = new ClassCommissionScheduleRepository(db);
    managedExamRepo = new ManagedExamRepository(db);
    noticeRepo = new InstitutionalNoticeRepository(db);
    adminRepo = new AdminRepository(db);
    userProfileRepo = new UserProfileRepository(db);
    teacherRepo = new ManagedTeacherRepository(db);
    authorizedEmailRepo = new AuthorizedEmailRepository(db);

    mockEmailService = {
      send: vi.fn().mockResolvedValue(undefined)
    };

    mockGateway = {
      sendTextMessage: vi.fn().mockResolvedValue(undefined)
    };

    server = new HttpServer(
      onboardingTokenRepo,
      webOtpRepo,
      groupRepo,
      groupContextRepo,
      commissionRepo,
      managedClassRepo,
      classCommissionScheduleRepo,
      managedExamRepo,
      noticeRepo,
      adminRepo,
      userProfileRepo,
      teacherRepo,
      authorizedEmailRepo,
      mockEmailService as any,
      mockGateway as any,
      db,
      testPort
    );

    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    await new Promise<void>((resolve) => db.close(() => resolve()));
  });

  const request = (method: string, path: string, body?: any, token?: string): Promise<{ status: number; data: any }> => {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const req = http.request(`${baseUrl}${path}`, {
        method,
        headers
      }, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode || 0,
              data: JSON.parse(rawData)
            });
          } catch {
            resolve({
              status: res.statusCode || 0,
              data: rawData
            });
          }
        });
      });

      req.on('error', reject);
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  };

  it('should sign and verify JWT tokens correctly', () => {
    const payload = { email: 'test@example.com', role: 'professor' };
    const token = JwtUtils.sign(payload);
    expect(token).toBeDefined();

    const verified = JwtUtils.verify(token);
    expect(verified).toBeDefined();
    expect(verified.email).toBe('test@example.com');
    expect(verified.role).toBe('professor');
  });

  it('should reject requests with invalid JWT tokens', async () => {
    const res = await request('GET', '/api/groups', null, 'invalid-token');
    expect(res.status).toBe(401);
  });

  it('should handle OTP creation and validation flow', async () => {
    // Seed teacher
    await teacherRepo.create({
      name: 'Dr. John',
      email: 'john@example.com',
      subject: 'Math',
      group_id: 'group1'
    });

    // Request OTP
    const otpRes = await request('POST', '/api/auth/send-otp', { email: 'john@example.com' });
    expect(otpRes.status).toBe(200);
    expect(otpRes.data.success).toBe(true);
    expect(otpRes.data.method).toBe('email');
    expect(otpRes.data.debugCode).toBeDefined();

    const debugCode = otpRes.data.debugCode;

    // Verify OTP
    const verifyRes = await request('POST', '/api/auth/verify-otp', {
      email: 'john@example.com',
      code: debugCode
    });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.data.success).toBe(true);
    expect(verifyRes.data.token).toBeDefined();
    expect(verifyRes.data.user.role).toBe('professor');
  });

  it('should support class CRUD endpoints', async () => {
    const token = JwtUtils.sign({ email: 'super@ispc.com', role: 'super_admin' });

    // Preseed subject
    await new Promise<void>((resolve, reject) => {
      db.run(`INSERT INTO academic_subjects(id, name, year) VALUES ('sub-1', 'Matemática I', 1)`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Create Class
    const createRes = await request('POST', '/api/classes', {
      subjectId: 'sub-1',
      dayOfWeek: 1, // Lunes
      startTime: '08:30',
      meetLink: 'https://meet.google.com/abc',
      groupId: 'group-1'
    }, token);

    expect(createRes.status).toBe(201);
    expect(createRes.data.success).toBe(true);
    const classId = createRes.data.data.id;

    // List Classes
    const listRes = await request('GET', '/api/classes?groupId=group-1', null, token);
    expect(listRes.status).toBe(200);
    expect(listRes.data.length).toBe(1);
    expect(listRes.data[0].subjectName).toBe('Matemática I');

    // Update Class
    const updateRes = await request('PUT', `/api/classes/sub-1/${classId}`, {
      meetLink: 'https://meet.google.com/new',
      dayOfWeek: 2,
      startTime: '09:00'
    }, token);
    expect(updateRes.status).toBe(200);

    // Delete Class
    const deleteRes = await request('DELETE', `/api/classes/sub-1/${classId}`, null, token);
    expect(deleteRes.status).toBe(200);
  });
});
