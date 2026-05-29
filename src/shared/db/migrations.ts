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
