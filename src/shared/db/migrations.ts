import sqlite3 from 'sqlite3';

interface Migration {
  version: number;
  description: string;
  sql: string[];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema with reminders, rate limits and confirmations',
    sql: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        description TEXT NOT NULL,
        event_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        source TEXT NOT NULL DEFAULT 'whatsapp',
        group_id TEXT,
        notify_7d_sent INTEGER NOT NULL DEFAULT 0,
        notify_3d_sent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_reminders_event_date ON reminders(event_date)`,
      `CREATE INDEX IF NOT EXISTS idx_reminders_user_status ON reminders(user_id, status)`,
      `CREATE TABLE IF NOT EXISTS rate_limit (
        user_id TEXT PRIMARY KEY,
        question_count INTEGER NOT NULL DEFAULT 0,
        last_reset_date TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS confirmaciones (
        user_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        intent TEXT NOT NULL,
        pending_payload_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS institutional_notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        event_time TEXT,
        source_email TEXT,
        unique_hash TEXT NOT NULL UNIQUE,
        published_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS scheduler_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_name TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        ran_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS outbox_dedup (
        message_key TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
  },
  {
    version: 2,
    description: 'Admin workflow tables for users, auth and managed exams',
    sql: [
      `CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        birthday_day_month TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS admin_users (
        user_id TEXT PRIMARY KEY,
        is_authenticated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS admin_verification_codes (
        code TEXT PRIMARY KEY,
        consumed_by TEXT,
        consumed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS managed_exams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        exam_date TEXT NOT NULL,
        exam_time TEXT NOT NULL,
        exam_type TEXT NOT NULL,
        observations TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
  },
  {
    version: 3,
    description: 'Managed classes and notifications for class reminders',
    sql: [
      `CREATE TABLE IF NOT EXISTS managed_classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        schedule_day TEXT NOT NULL,
        schedule_time TEXT NOT NULL,
        meet_link TEXT NOT NULL,
        notifications_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS class_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        managed_class_id INTEGER NOT NULL,
        notification_sent_at TEXT NOT NULL,
        minutes_before INTEGER NOT NULL DEFAULT 10,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(managed_class_id) REFERENCES managed_classes(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_class_notifications_class_id ON class_notifications(managed_class_id)`,
    ],
  },
  {
    version: 4,
    description: 'Managed teachers directory',
    sql: [
      `CREATE TABLE IF NOT EXISTS managed_teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_managed_teachers_email ON managed_teachers(email)`,
    ],
  },
  {
    version: 5,
    description: 'AI quotas, approvals and user email support',
    sql: [
      `ALTER TABLE user_profiles ADD COLUMN email TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE rate_limit ADD COLUMN bonus_questions_remaining INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE rate_limit ADD COLUMN approval_pending INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE rate_limit ADD COLUMN approval_requested_at TEXT`,
      `ALTER TABLE rate_limit ADD COLUMN approval_expires_at TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_rate_limit_approval_pending ON rate_limit(approval_pending, approval_requested_at)`,
    ],
  },
  {
    version: 6,
    description: 'Persisted hello greetings and sent-event dedup cache',
    sql: [
      `CREATE TABLE IF NOT EXISTS user_daily_greetings (
        user_id TEXT NOT NULL,
        greeting_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, greeting_date)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_daily_greetings_date ON user_daily_greetings(greeting_date)`,
      `CREATE INDEX IF NOT EXISTS idx_outbox_dedup_created_at ON outbox_dedup(created_at)`,
    ],
  },
  {
    version: 7,
    description: 'Repair legacy user_profiles schema columns',
    sql: [
      `ALTER TABLE user_profiles ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`,
      `ALTER TABLE user_profiles ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`,
      `ALTER TABLE user_profiles ADD COLUMN email TEXT NOT NULL DEFAULT ''`,
    ],
  },
  {
    version: 8,
    description: 'User moderation warnings and ban states',
    sql: [
      `CREATE TABLE IF NOT EXISTS user_moderation_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL UNIQUE,
        warning_count INTEGER NOT NULL DEFAULT 0,
        suspension_count_week INTEGER NOT NULL DEFAULT 0,
        first_week_suspension_at TEXT,
        temp_ban_until TEXT,
        week_ban_until TEXT,
        last_offense_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_moderation_user_id ON user_moderation_state(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_moderation_bans ON user_moderation_state(temp_ban_until, week_ban_until)`,
    ],
  },
  {
    version: 9,
    description: 'Flexible exam scheduling fields and notification frequency',
    sql: [
      `ALTER TABLE managed_exams ADD COLUMN tipo_disponibilidad TEXT NOT NULL DEFAULT 'hora-especifica'`,
      `ALTER TABLE managed_exams ADD COLUMN hora_inicio TEXT`,
      `ALTER TABLE managed_exams ADD COLUMN hora_fin TEXT`,
      `ALTER TABLE managed_exams ADD COLUMN frecuencia_avisos TEXT NOT NULL DEFAULT '7d,3d,1d,20m'`,
      `ALTER TABLE managed_exams ADD COLUMN ultimo_aviso_enviado TEXT`,
    ],
  },
  {
    version: 10,
    description: 'Managed classes commission count',
    sql: [
      `ALTER TABLE managed_classes ADD COLUMN commission_count INTEGER NOT NULL DEFAULT 1`,
    ],
  },
  {
    version: 11,
    description: 'Add user commission selection',
    sql: [
      `ALTER TABLE user_profiles ADD COLUMN user_commission_id INTEGER DEFAULT NULL`,
    ],
  },
  {
    version: 12,
    description: 'Add exam commission assignment',
    sql: [
      `ALTER TABLE managed_exams ADD COLUMN exam_commission_id INTEGER DEFAULT NULL`,
    ],
  },
  {
    version: 13,
    description: 'Backfill user commission defaults',
    sql: [
      `UPDATE user_profiles SET user_commission_id = 1 WHERE user_commission_id IS NULL`,
    ],
  },
  {
    version: 14,
    description: 'Multi-tenant groups: whatsapp_groups table',
    sql: [
      `CREATE TABLE IF NOT EXISTS whatsapp_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL UNIQUE,
        display_name TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        added_by TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_group_id ON whatsapp_groups(group_id)`,
      `CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_is_active ON whatsapp_groups(is_active)`,
    ],
  },
  {
    version: 15,
    description: 'Academic commissions (comisiones) for filtering',
    sql: [
      `CREATE TABLE IF NOT EXISTS commissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        year INTEGER,
        shift TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(name, year, shift)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_commissions_year ON commissions(year)`,
      `CREATE INDEX IF NOT EXISTS idx_commissions_name ON commissions(name)`,
    ],
  },
  {
    version: 16,
    description: 'Multi-tenant group contexts (año y comisión)',
    sql: [
      `CREATE TABLE IF NOT EXISTS group_context (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL UNIQUE,
        year INTEGER NOT NULL,
        commission_id INTEGER,
        label TEXT,
        configured_by TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(group_id) REFERENCES whatsapp_groups(group_id) ON DELETE CASCADE,
        FOREIGN KEY(commission_id) REFERENCES commissions(id) ON DELETE SET NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_group_context_group_id ON group_context(group_id)`,
      `CREATE INDEX IF NOT EXISTS idx_group_context_year ON group_context(year)`,
      `CREATE INDEX IF NOT EXISTS idx_group_context_commission_id ON group_context(commission_id)`,
    ],
  },
  {
    version: 17,
    description: 'Class commission schedule: horarios por comisión para cada clase',
    sql: [
      `CREATE TABLE IF NOT EXISTS class_commission_schedule (
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_class_commission_schedule_managed_class_id ON class_commission_schedule(managed_class_id)`,
      `CREATE INDEX IF NOT EXISTS idx_class_commission_schedule_commission_id ON class_commission_schedule(commission_id)`,
      `CREATE INDEX IF NOT EXISTS idx_class_commission_schedule_day ON class_commission_schedule(schedule_day)`,
    ],
  },
  {
    version: 18,
    description: 'Group admin assignments: group_admins table for per-group admins',
    sql: [
      `CREATE TABLE IF NOT EXISTS group_admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, group_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_group_admins_user_id ON group_admins(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_group_admins_group_id ON group_admins(group_id)`,
    ],
  },
  {
    version: 19,
    description: 'Add entry_year to whatsapp_groups for cohort identification',
    sql: [
      `ALTER TABLE whatsapp_groups ADD COLUMN entry_year INTEGER`,
    ],
  },
  {
    version: 20,
    description: 'Add is_super_admin flag to admin_users',
    sql: [
      `ALTER TABLE admin_users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: 21,
    description: 'Group memberships table for operational membership and roles',
    sql: [
      `CREATE TABLE IF NOT EXISTS group_memberships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, group_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_group_memberships_group_id ON group_memberships(group_id)`,
      `CREATE INDEX IF NOT EXISTS idx_group_memberships_user_id ON group_memberships(user_id)`,
    ],
  },
  {
    version: 22,
    description: 'Cohort (entry_year) level configuration storage',
    sql: [
      `CREATE TABLE IF NOT EXISTS cohort_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_year INTEGER NOT NULL UNIQUE,
        configs_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_cohort_configs_entry_year ON cohort_configs(entry_year)`,
    ],
  },
  {
    version: 23,
    description: 'Move group_context commission into group_context_commissions table and backfill',
    sql: [
      `CREATE TABLE IF NOT EXISTS group_context_commissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_context_id INTEGER NOT NULL,
        commission_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_context_id, commission_id),
        FOREIGN KEY(group_context_id) REFERENCES group_context(id) ON DELETE CASCADE,
        FOREIGN KEY(commission_id) REFERENCES commissions(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_group_context_commissions_group_context_id ON group_context_commissions(group_context_id)`,
      `CREATE INDEX IF NOT EXISTS idx_group_context_commissions_commission_id ON group_context_commissions(commission_id)`,
      `INSERT INTO group_context_commissions(group_context_id, commission_id, created_at)
        SELECT id, commission_id, CURRENT_TIMESTAMP
        FROM group_context
        WHERE commission_id IS NOT NULL`
    ],
  },
  {
    version: 24,
    description: 'Add frecuencia, grupo_selector and confirmed_at to institutional_notices',
    sql: [
      `ALTER TABLE institutional_notices ADD COLUMN frecuencia TEXT NOT NULL DEFAULT 'unica'`,
      `ALTER TABLE institutional_notices ADD COLUMN grupo_selector TEXT NOT NULL DEFAULT 'todos'`,
      `ALTER TABLE institutional_notices ADD COLUMN confirmed_at TEXT`,
    ],
  },
  {
    version: 25,
    description: 'Create inbound_email_rejections table for email rejection deduplication',
    sql: [
      `CREATE TABLE IF NOT EXISTS inbound_email_rejections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        sender TEXT NOT NULL,
        subject TEXT,
        rejected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_inbound_email_rejections_fingerprint ON inbound_email_rejections(fingerprint)`
    ]
  },
  {
    version: 26,
    description: 'Add published_at to institutional_notices if missing',
    sql: [
      `ALTER TABLE institutional_notices ADD COLUMN published_at TEXT`
    ]
  },
  {
    version: 27,
    description: 'Add commission_id to group_memberships for per-group commission scoping',
    sql: [
      `ALTER TABLE group_memberships ADD COLUMN commission_id INTEGER DEFAULT NULL`
    ]
  },
  {
    version: 28,
    description: 'Add group_id to exams, classes and teachers for logical scoping and backfill',
    sql: [
      `ALTER TABLE managed_exams ADD COLUMN group_id TEXT`,
      `ALTER TABLE managed_classes ADD COLUMN group_id TEXT`,
      `ALTER TABLE managed_teachers ADD COLUMN group_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_managed_exams_group_id ON managed_exams(group_id)`,
      `CREATE INDEX IF NOT EXISTS idx_managed_classes_group_id ON managed_classes(group_id)`,
      `CREATE INDEX IF NOT EXISTS idx_managed_teachers_group_id ON managed_teachers(group_id)`,
      `UPDATE managed_classes
       SET group_id = (
         SELECT gc.group_id
         FROM class_commission_schedule ccs
         JOIN group_context_commissions gcc ON ccs.commission_id = gcc.commission_id
         JOIN group_context gc ON gcc.group_context_id = gc.id
         WHERE ccs.managed_class_id = managed_classes.id
         LIMIT 1
       )
       WHERE group_id IS NULL`,
      `UPDATE managed_classes
       SET group_id = (SELECT group_id FROM group_context LIMIT 1)
       WHERE group_id IS NULL`,
      `UPDATE managed_exams
       SET group_id = (
         SELECT gc.group_id
         FROM group_context_commissions gcc
         JOIN group_context gc ON gcc.group_context_id = gc.id
         WHERE gcc.commission_id = managed_exams.exam_commission_id
         LIMIT 1
       )
       WHERE group_id IS NULL`,
      `UPDATE managed_exams
       SET group_id = (SELECT group_id FROM group_context LIMIT 1)
       WHERE group_id IS NULL`,
      `UPDATE managed_teachers
       SET group_id = (
         SELECT c.group_id
         FROM managed_classes c
         WHERE c.subject = managed_teachers.subject AND c.group_id IS NOT NULL
         LIMIT 1
       )
       WHERE group_id IS NULL`,
      `UPDATE managed_teachers
       SET group_id = (SELECT group_id FROM group_context LIMIT 1)
       WHERE group_id IS NULL`
    ]
  },
  {
    version: 29,
    description: 'Add commission_id to managed_teachers',
    sql: [
      `ALTER TABLE managed_teachers ADD COLUMN commission_id INTEGER REFERENCES commissions(id) ON DELETE SET NULL`,
      `CREATE INDEX IF NOT EXISTS idx_managed_teachers_commission_id ON managed_teachers(commission_id)`
    ]
  },
  {
    version: 30,
    description: 'Create authorized_emails table and add last_sent_at to institutional_notices',
    sql: [
      `CREATE TABLE IF NOT EXISTS authorized_emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_authorized_emails_email ON authorized_emails(email)`,
      `ALTER TABLE institutional_notices ADD COLUMN last_sent_at TEXT`
    ]
  },
  {
    version: 31,
    description: 'Create onboarding_tokens table for group onboarding and setup',
    sql: [
      `CREATE TABLE IF NOT EXISTS onboarding_tokens (
        token TEXT PRIMARY KEY,
        group_id TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(group_id) REFERENCES whatsapp_groups(group_id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_onboarding_tokens_token ON onboarding_tokens(token)`
    ]
  },
  {
    version: 32,
    description: 'Create and seed academic_subjects table',
    sql: [
      `CREATE TABLE IF NOT EXISTS academic_subjects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        year INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS web_otp_sessions (
        email TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        user_id TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-1-1', 'Elementos de Matemática y Lógica', 1)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-1-2', 'Sistemas y Organizaciones', 1)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-1-3', 'Programación I', 1)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-1-4', 'Base de Datos', 1)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-1-5', 'Inglés I', 1)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-1-6', 'Competencias Comunicacionales I', 1)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-1-7', 'Ética y Deontología Profesional', 1)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-1-8', 'Arquitectura de las Computadoras', 1)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-1-9', 'Competencias Comunicacionales II', 1)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-1-10', 'Aproximación al Mundo del Trabajo', 1)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-2-1', 'Inglés II', 2)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-2-2', 'Estadística y Probabilidad Aplicadas', 2)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-2-3', 'Modelado y Arquitectura de Software', 2)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-2-4', 'Programación II', 2)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-2-5', 'Práctica Profesionalizante I', 2)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-2-6', 'Sistemas Operativos', 2)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-2-7', 'Redes', 2)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-3-1', 'Interfaz de Usuario', 3)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-3-2', 'Ingeniería de Software', 3)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-3-3', 'Programación III', 3)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-3-4', 'Práctica Profesionalizante II', 3)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-3-5', 'Gestión de Proyectos', 3)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-3-6', 'Ciencia de Datos', 3)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-3-7', 'Verificación y Validación de Programas', 3)`,
      `INSERT OR IGNORE INTO academic_subjects(id, name, year) VALUES ('sub-3-8', 'Desarrollo de Inteligencia Artificial', 3)`
    ]
  },
  {
    version: 33,
    description: 'Create web panel sessions, teacher messages and replies, academic calendar events, pending onboarding, and managed exams new columns',
    sql: [
      `CREATE TABLE IF NOT EXISTS web_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        user_role TEXT NOT NULL,
        otp_code TEXT,
        otp_expires_at TEXT,
        otp_consumed INTEGER NOT NULL DEFAULT 0,
        jwt_token TEXT,
        user_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS teacher_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        content TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_name TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS teacher_message_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_message_id INTEGER NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_phone TEXT,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_from_student INTEGER NOT NULL DEFAULT 1,
        read_by_professor INTEGER NOT NULL DEFAULT 0,
        email_sent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(teacher_message_id) REFERENCES teacher_messages(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS academic_calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        event_name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        academic_year INTEGER NOT NULL,
        confirmed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS pending_group_onboarding (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL UNIQUE,
        super_admin_id TEXT NOT NULL,
        step TEXT NOT NULL,
        selected_type TEXT,
        selected_year INTEGER,
        onboarding_token TEXT,
        onboarding_completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `ALTER TABLE managed_exams ADD COLUMN exam_date_end TEXT`,
      `ALTER TABLE managed_exams ADD COLUMN aviso_inicio_only INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE managed_exams ADD COLUMN aviso_fin_pre_deadline INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE managed_exams ADD COLUMN created_by_name TEXT`,
      `ALTER TABLE managed_exams ADD COLUMN created_by_role TEXT`
    ]
  },
  {
    version: 34,
    description: 'Remove legacy academic subjects that are not in the official degree plan',
    sql: [
      `DELETE FROM academic_subjects WHERE id IN ('sub-3-9', 'sub-3-10', 'sub-3-11')`
    ]
  },
  {
    version: 35,
    description: 'Create notice_replies table for institutional notices',
    sql: [
      `CREATE TABLE IF NOT EXISTS notice_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notice_id INTEGER NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_phone TEXT,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_from_student INTEGER NOT NULL DEFAULT 1,
        read_by_professor INTEGER NOT NULL DEFAULT 0,
        email_sent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(notice_id) REFERENCES institutional_notices(id) ON DELETE CASCADE
      )`
    ]
  },
  {
    version: 36,
    description: 'Add teacher phone and notification settings and replies whatsapp tracking',
    sql: [
      `ALTER TABLE managed_teachers ADD COLUMN phone TEXT`,
      `ALTER TABLE managed_teachers ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE managed_teachers ADD COLUMN notify_whatsapp INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE teacher_message_replies ADD COLUMN whatsapp_sent INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE notice_replies ADD COLUMN whatsapp_sent INTEGER NOT NULL DEFAULT 0`
    ]
  },
  {
    version: 37,
    description: 'Add commission_label to managed_teachers for global commissions mapping',
    sql: [
      `ALTER TABLE managed_teachers ADD COLUMN commission_label TEXT DEFAULT NULL`
    ]
  },
  {
    version: 38,
    description: 'Add meet_link to managed_teachers',
    sql: [
      `ALTER TABLE managed_teachers ADD COLUMN meet_link TEXT DEFAULT NULL`
    ]
  },
  {
    version: 39,
    description: 'Create year_commission_configs table and seed defaults',
    sql: [
      `CREATE TABLE IF NOT EXISTS year_commission_configs (
        year INTEGER PRIMARY KEY,
        commission_count INTEGER NOT NULL DEFAULT 1
      )`,
      `INSERT OR IGNORE INTO year_commission_configs (year, commission_count) VALUES (1, 1)`,
      `INSERT OR IGNORE INTO year_commission_configs (year, commission_count) VALUES (2, 1)`,
      `INSERT OR IGNORE INTO year_commission_configs (year, commission_count) VALUES (3, 1)`
    ]
  },
  {
    version: 40,
    description: 'Create phone_otp_sessions table and setup teacher phone synchronization triggers',
    sql: [
      `CREATE TABLE IF NOT EXISTS phone_otp_sessions (
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(email, phone)
      )`,
      `CREATE TRIGGER IF NOT EXISTS trg_sync_teacher_phone_on_profile_insert
       AFTER INSERT ON user_profiles
       FOR EACH ROW
       BEGIN
         UPDATE managed_teachers
         SET phone = NEW.user_id
         WHERE LOWER(email) = LOWER(NEW.email);
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_sync_teacher_phone_on_profile_update
       AFTER UPDATE OF email ON user_profiles
       FOR EACH ROW
       BEGIN
         UPDATE managed_teachers
         SET phone = NEW.user_id
         WHERE LOWER(email) = LOWER(NEW.email);
       END`
    ]
  }
];

function isIgnorableMigrationError(err: unknown): boolean {
  const msg = ((err as any)?.message || '').toLowerCase();
  return msg.includes('duplicate column name');
}

function run(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<sqlite3.RunResult> {
  return new Promise((resolve, reject) => {
    db.run(sql, params as any[], function (err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function all<T = any>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params as any[], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows as T[]);
    });
  });
}

export async function applyMigrations(db: sqlite3.Database): Promise<void> {
  await run(db, 'PRAGMA foreign_keys = ON;');
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );

  const rows = await all<{ version: number }>(db, 'SELECT version FROM schema_migrations ORDER BY version ASC');
  const appliedVersions = new Set(rows.map((row) => Number(row.version)));

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    for (const statement of migration.sql) {
      try {
        await run(db, statement);
      } catch (err) {
        if (!isIgnorableMigrationError(err)) {
          throw err;
        }
      }
    }

    await run(db, 'INSERT INTO schema_migrations(version, description) VALUES (?, ?)', [
      migration.version,
      migration.description,
    ]);
  }
}
