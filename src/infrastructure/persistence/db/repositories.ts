import sqlite3 from 'sqlite3';
import {
  AdminUser,
  BannedUserView,
  InstitutionalNotice,
  ManagedExam,
  ManagedClass,
  ManagedClassCreateInput,
  ManagedTeacher,
  ManagedTeacherCreateInput,
  PendingConfirmation,
  RateLimitRecord,
  Reminder,
  ReminderCreateInput,
  UserModerationState,
  UserProfile,
  ClassCommissionSchedule,
  WhatsAppGroup,
  Commission,
  GroupContext,
  CohortConfig,
} from '../../../domain/models.js';

function run(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params as any[], function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID ?? 0, changes: this.changes ?? 0 });
    });
  });
}

function get<T = any>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params as any[], (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
}

function all<T = any>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params as any[], (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

export class ReminderRepository {
  constructor(private db: sqlite3.Database) {}

  async create(reminder: ReminderCreateInput): Promise<number> {
    const result = await run(
      this.db,
      `INSERT INTO reminders (
        user_id, event_type, description, event_date, status, source, group_id, notify_7d_sent, notify_3d_sent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reminder.user_id,
        reminder.event_type,
        reminder.description,
        formatLocalDateOnly(reminder.event_date),
        reminder.status ?? 'pending',
        reminder.source ?? 'whatsapp',
        reminder.group_id ?? null,
        reminder.notify_7d_sent ? 1 : 0,
        reminder.notify_3d_sent ? 1 : 0,
      ]
    );
    return result.lastID;
  }

  async listDueForNotification(today: Date): Promise<Reminder[]> {
    const rows = await all<any>(
      this.db,
      `SELECT * FROM reminders WHERE status='pending'`
    );

    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    return rows
      .map(rowToReminder)
      .filter((r) => {
        const eventDate = new Date(r.event_date.getFullYear(), r.event_date.getMonth(), r.event_date.getDate());
        const delta = Math.round((eventDate.getTime() - todayOnly.getTime()) / (1000 * 60 * 60 * 24));
        const needs7d = delta === 7 && !r.notify_7d_sent;
        const needs3d = delta === 3 && !r.notify_3d_sent;
        return needs7d || needs3d;
      });
  }

  async listActive(): Promise<Reminder[]> {
    const rows = await all<any>(this.db, `SELECT * FROM reminders WHERE status='pending' ORDER BY event_date ASC, id ASC`);
    return rows.map(rowToReminder).filter((r) => getReminderEndOfDay(r).getTime() >= Date.now());
  }

  async markNotified(reminderId: number, daysBefore: 7 | 3): Promise<void> {
    const column = daysBefore === 7 ? 'notify_7d_sent' : 'notify_3d_sent';
    await run(this.db, `UPDATE reminders SET ${column}=1, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [reminderId]);
  }

  async listByDateRange(startDate: Date, endDate: Date): Promise<Reminder[]> {
    const rows = await all<any>(
      this.db,
      `SELECT * FROM reminders WHERE status='pending' AND event_date >= ? AND event_date <= ? ORDER BY event_date ASC, id ASC`,
      [formatLocalDateOnly(startDate), formatLocalDateOnly(endDate)]
    );
    return rows.map(rowToReminder);
  }

  async listRegisteredExams(userId?: string): Promise<Reminder[]> {
    const params: unknown[] = ['pending'];
    const userFilter = userId ? 'AND user_id = ?' : '';
    if (userId) params.push(userId);

    const rows = await all<any>(
      this.db,
      `SELECT * FROM reminders
       WHERE status = ?
       ${userFilter}
       AND (
         lower(event_type) IN ('examen', 'parcial', 'final')
         OR lower(description) LIKE '%examen%'
         OR lower(description) LIKE '%parcial%'
         OR lower(description) LIKE '%final%'
       )
       ORDER BY event_date ASC, id ASC`,
      params
    );
    return rows.map(rowToReminder);
  }

  async delete(reminderId: number): Promise<void> {
    await run(this.db, 'DELETE FROM reminders WHERE id = ?', [reminderId]);
  }
}

export class RateLimitRepository {
  constructor(private db: sqlite3.Database) {}

  async get(userId: string): Promise<RateLimitRecord | null> {
    const row = await get<any>(this.db, 'SELECT * FROM rate_limit WHERE user_id = ?', [userId]);
    if (!row) return null;
    return {
      user_id: String(row.user_id),
      question_count: Number(row.question_count),
      last_reset_date: new Date(String(row.last_reset_date)),
      bonus_questions_remaining: Number(row.bonus_questions_remaining ?? 0),
      approval_pending: Number(row.approval_pending ?? 0) === 1,
      approval_requested_at: row.approval_requested_at ? new Date(String(row.approval_requested_at)) : null,
      approval_expires_at: row.approval_expires_at ? new Date(String(row.approval_expires_at)) : null,
    };
  }

  async save(record: RateLimitRecord): Promise<void> {
    await run(
      this.db,
      `INSERT INTO rate_limit(
         user_id, question_count, last_reset_date, bonus_questions_remaining,
         approval_pending, approval_requested_at, approval_expires_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         question_count=excluded.question_count,
         last_reset_date=excluded.last_reset_date,
         bonus_questions_remaining=excluded.bonus_questions_remaining,
         approval_pending=excluded.approval_pending,
         approval_requested_at=excluded.approval_requested_at,
         approval_expires_at=excluded.approval_expires_at,
         updated_at=CURRENT_TIMESTAMP`,
      [
        record.user_id,
        record.question_count,
        record.last_reset_date.toISOString().slice(0, 10),
        record.bonus_questions_remaining,
        record.approval_pending ? 1 : 0,
        record.approval_requested_at ? record.approval_requested_at.toISOString() : null,
        record.approval_expires_at ? record.approval_expires_at.toISOString() : null,
      ]
    );
  }

  async resetAll(resetDate: Date): Promise<void> {
    await run(
      this.db,
      `UPDATE rate_limit
       SET question_count=0,
           last_reset_date=?,
           bonus_questions_remaining=0,
           approval_pending=0,
           approval_requested_at=NULL,
           approval_expires_at=NULL,
           updated_at=CURRENT_TIMESTAMP`,
      [resetDate.toISOString().slice(0, 10)]
    );
  }

  async getOldestPendingApproval(now: Date): Promise<RateLimitRecord | null> {
    const row = await get<any>(
      this.db,
      `SELECT * FROM rate_limit
       WHERE approval_pending = 1
         AND (approval_expires_at IS NULL OR approval_expires_at > ?)
       ORDER BY approval_requested_at ASC, updated_at ASC
       LIMIT 1`,
      [now.toISOString()]
    );

    if (!row) return null;

    return {
      user_id: String(row.user_id),
      question_count: Number(row.question_count),
      last_reset_date: new Date(String(row.last_reset_date)),
      bonus_questions_remaining: Number(row.bonus_questions_remaining ?? 0),
      approval_pending: Number(row.approval_pending ?? 0) === 1,
      approval_requested_at: row.approval_requested_at ? new Date(String(row.approval_requested_at)) : null,
      approval_expires_at: row.approval_expires_at ? new Date(String(row.approval_expires_at)) : null,
    };
  }
}

export class ConfirmationRepository {
  constructor(private db: sqlite3.Database) {}

  async save(userId: string, state: string, intent: string, payload: object, expiresAt: Date): Promise<void> {
    await run(
      this.db,
      `INSERT INTO confirmaciones(user_id, state, intent, pending_payload_json, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         state=excluded.state,
         intent=excluded.intent,
         pending_payload_json=excluded.pending_payload_json,
         expires_at=excluded.expires_at,
         updated_at=CURRENT_TIMESTAMP`,
      [userId, state, intent, JSON.stringify(payload), expiresAt.toISOString()]
    );
  }

  async get(userId: string): Promise<PendingConfirmation | null> {
    const row = await get<any>(this.db, 'SELECT * FROM confirmaciones WHERE user_id = ?', [userId]);
    if (!row) return null;
    return {
      user_id: String(row.user_id),
      state: String(row.state),
      intent: String(row.intent),
      pending_payload_json: String(row.pending_payload_json),
      expires_at: new Date(String(row.expires_at)),
    };
  }

  async delete(userId: string): Promise<void> {
    await run(this.db, 'DELETE FROM confirmaciones WHERE user_id = ?', [userId]);
  }

  async deleteExpired(nowUtc: Date): Promise<number> {
    const result = await run(this.db, 'DELETE FROM confirmaciones WHERE expires_at < ?', [nowUtc.toISOString()]);
    return result.changes;
  }
}

export class InstitutionalNoticeRepository {
  constructor(private db: sqlite3.Database) {}

  async createIfNew(notice: InstitutionalNotice): Promise<boolean> {
    try {
      await run(
        this.db,
        `INSERT INTO institutional_notices(title, body, start_date, end_date, event_time, source_email, unique_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          notice.title,
          notice.body,
          notice.start_date ? notice.start_date.toISOString().slice(0, 10) : null,
          notice.end_date ? notice.end_date.toISOString().slice(0, 10) : null,
          notice.event_time ?? null,
          notice.source_email ?? null,
          notice.unique_hash,
        ]
      );
      return true;
    } catch {
      return false;
    }
  }

  async listRecent(limit = 5): Promise<InstitutionalNotice[]> {
    const rows = await all<any>(
      this.db,
      'SELECT * FROM institutional_notices ORDER BY created_at DESC, id DESC LIMIT ?',
      [limit]
    );
    return rows.map(rowToNotice);
  }

  async listWithIds(limit = 50): Promise<Array<{ id: number; notice: InstitutionalNotice }>> {
    const rows = await all<any>(
      this.db,
      'SELECT * FROM institutional_notices ORDER BY created_at DESC, id DESC LIMIT ?',
      [limit]
    );
    return rows.map((row) => ({ id: Number(row.id), notice: rowToNotice(row) }));
  }

  async getById(id: number): Promise<InstitutionalNotice | null> {
    const row = await get<any>(this.db, 'SELECT * FROM institutional_notices WHERE id = ?', [id]);
    if (!row) return null;
    return rowToNotice(row);
  }

  async deleteById(id: number): Promise<boolean> {
    const result = await run(this.db, 'DELETE FROM institutional_notices WHERE id = ?', [id]);
    return result.changes > 0;
  }

  async updateById(id: number, data: Partial<InstitutionalNotice>): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.title !== undefined) {
      fields.push('title = ?');
      values.push(data.title);
    }

    if (data.body !== undefined) {
      fields.push('body = ?');
      values.push(data.body);
    }

    if (data.start_date !== undefined) {
      fields.push('start_date = ?');
      values.push(data.start_date ? data.start_date.toISOString().slice(0, 10) : null);
    }

    if (data.end_date !== undefined) {
      fields.push('end_date = ?');
      values.push(data.end_date ? data.end_date.toISOString().slice(0, 10) : null);
    }

    if (!fields.length) return false;

    values.push(id);
    const sql = `UPDATE institutional_notices SET ${fields.join(', ')} WHERE id = ?`;
    const result = await run(this.db, sql, values);
    return result.changes > 0;
  }
}

export class ManagedExamRepository {
  constructor(private db: sqlite3.Database) {}

  async create(exam: ManagedExam): Promise<number> {
    const result = await run(
      this.db,
      `INSERT INTO managed_exams(
         subject, exam_date, exam_time, exam_type, observations, created_by,
         tipo_disponibilidad, hora_inicio, hora_fin, frecuencia_avisos, ultimo_aviso_enviado, exam_commission_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        exam.subject,
        formatLocalDateOnly(exam.exam_date),
        exam.exam_time,
        exam.exam_type,
        exam.observations,
        exam.created_by,
        exam.tipoDisponibilidad ?? 'hora-especifica',
        exam.horaInicio ?? null,
        exam.horaFin ?? null,
        exam.frecuenciaAvisos ?? '7d,3d,1d,20m',
        exam.ultimoAvisoEnviado ? exam.ultimoAvisoEnviado.toISOString() : null,
        exam.exam_commission_id ?? null,
      ]
    );
    return result.lastID;
  }

  async listUpcoming(fromDate: Date, limit = 50): Promise<ManagedExam[]> {
    const rows = await all<any>(
      this.db,
      `SELECT * FROM managed_exams WHERE exam_date >= ? ORDER BY exam_date ASC LIMIT ?`,
      [formatLocalDateOnly(fromDate), limit]
    );
    return rows.map(rowToExam).filter((exam) => getExamDateTime(exam).getTime() >= fromDate.getTime());
  }

  async listWithIds(limit = 50): Promise<Array<{ id: number; exam: ManagedExam }>> {
    const rows = await all<any>(
      this.db,
      `SELECT * FROM managed_exams ORDER BY exam_date ASC, id ASC LIMIT ?`,
      [limit]
    );
    return rows.map((row) => ({ id: Number(row.id), exam: rowToExam(row) }));
  }

  async getById(id: number): Promise<ManagedExam | null> {
    const row = await get<any>(this.db, 'SELECT * FROM managed_exams WHERE id = ?', [id]);
    return row ? rowToExam(row) : null;
  }

  async deleteById(id: number): Promise<boolean> {
    const result = await run(this.db, 'DELETE FROM managed_exams WHERE id = ?', [id]);
    return result.changes > 0;
  }

  async deleteExpired(untilDate: Date): Promise<number> {
    const dateStr = formatLocalDateOnly(untilDate);
    const timeStr = formatLocalTime(untilDate);
    const result = await run(
      this.db,
      `DELETE FROM managed_exams WHERE datetime(exam_date || ' ' || exam_time) < datetime(?)`,
      [`${dateStr} ${timeStr}`]
    );
    return result.changes;
  }

  async update(id: number, data: Partial<ManagedExam>): Promise<void> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.subject !== undefined) {
      updates.push('subject = ?');
      values.push(data.subject);
    }
    if (data.exam_date !== undefined) {
      updates.push('exam_date = ?');
      values.push(formatLocalDateOnly(data.exam_date));
    }
    if (data.exam_time !== undefined) {
      updates.push('exam_time = ?');
      values.push(data.exam_time);
    }
    if (data.exam_type !== undefined) {
      updates.push('exam_type = ?');
      values.push(data.exam_type);
    }
    if (data.observations !== undefined) {
      updates.push('observations = ?');
      values.push(data.observations);
    }
    if (data.tipoDisponibilidad !== undefined) {
      updates.push('tipo_disponibilidad = ?');
      values.push(data.tipoDisponibilidad);
    }
    if (data.horaInicio !== undefined) {
      updates.push('hora_inicio = ?');
      values.push(data.horaInicio);
    }
    if (data.horaFin !== undefined) {
      updates.push('hora_fin = ?');
      values.push(data.horaFin);
    }
    if (data.frecuenciaAvisos !== undefined) {
      updates.push('frecuencia_avisos = ?');
      values.push(data.frecuenciaAvisos);
    }
    if (data.ultimoAvisoEnviado !== undefined) {
      updates.push('ultimo_aviso_enviado = ?');
      values.push(data.ultimoAvisoEnviado ? data.ultimoAvisoEnviado.toISOString() : null);
    }

    if (updates.length === 0) return;

    values.push(id);
    await run(
      this.db,
      `UPDATE managed_exams SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
  }
}

export class UserProfileRepository {
  constructor(private db: sqlite3.Database) {}

  async upsert(userId: string, name: string, birthdayDayMonth: string, email = '', userCommissionId?: number): Promise<void> {
    await run(
      this.db,
      `INSERT INTO user_profiles(user_id, name, birthday_day_month, email, user_commission_id, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         name=excluded.name,
         birthday_day_month=excluded.birthday_day_month,
         email=excluded.email,
         user_commission_id=excluded.user_commission_id,
         updated_at=CURRENT_TIMESTAMP`,
      [userId, name, birthdayDayMonth, email, userCommissionId ?? null]
    );
  }

  async get(userId: string): Promise<UserProfile | null> {
    const row = await get<any>(this.db, 'SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
    if (!row) return null;
    return {
      user_id: String(row.user_id),
      name: String(row.name),
      birthday_day_month: String(row.birthday_day_month),
      email: String(row.email || ''),
      user_commission_id: row.user_commission_id ? Number(row.user_commission_id) : undefined,
    };
  }

  async listUsersWithBirthday(dayMonth: string): Promise<UserProfile[]> {
    const rows = await all<any>(this.db, 'SELECT * FROM user_profiles WHERE birthday_day_month = ?', [dayMonth]);
    return rows.map((row) => ({
      user_id: String(row.user_id),
      name: String(row.name),
      birthday_day_month: String(row.birthday_day_month),
      email: String(row.email || ''),
      user_commission_id: row.user_commission_id ? Number(row.user_commission_id) : undefined,
    }));
  }

  async countTotal(): Promise<number> {
    const row = await get<any>(this.db, 'SELECT COUNT(*) as count FROM user_profiles');
    return Number(row?.count ?? 0);
  }

  async listAll(): Promise<UserProfile[]> {
    const rows = await all<any>(this.db, 'SELECT * FROM user_profiles ORDER BY user_id');
    return rows.map((row) => ({
      user_id: String(row.user_id),
      name: String(row.name),
      birthday_day_month: String(row.birthday_day_month),
      email: String(row.email || ''),
      user_commission_id: row.user_commission_id ? Number(row.user_commission_id) : undefined,
    }));
  }
}

export class AdminRepository {
  constructor(private db: sqlite3.Database) {}

  async register(userId: string): Promise<void> {
    await run(
      this.db,
      `INSERT INTO admin_users(user_id, is_authenticated, updated_at)
       VALUES (?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET is_authenticated=1, updated_at=CURRENT_TIMESTAMP`,
      [userId]
    );
  }

  async isRegistered(userId: string): Promise<boolean> {
    const row = await get<any>(this.db, 'SELECT user_id FROM admin_users WHERE user_id = ?', [userId]);
    if (row) return true;
    // Fallback: buscar por número de teléfono sin sufijo (resuelve JID @lid vs @s.whatsapp.net)
    const phone = userId.split('@')[0]?.split(':')[0] || '';
    if (!phone) return false;
    const allRows = await all<any>(this.db, 'SELECT user_id FROM admin_users');
    return allRows.some((r) => String(r.user_id).split('@')[0]?.split(':')[0] === phone);
  }

  async setAuthenticated(userId: string, value: boolean): Promise<void> {
    await run(this.db, 'UPDATE admin_users SET is_authenticated = ?, updated_at=CURRENT_TIMESTAMP WHERE user_id = ?', [
      value ? 1 : 0,
      userId,
    ]);
  }

  async setSuperAdmin(userId: string, value: boolean): Promise<void> {
    await run(this.db, 'UPDATE admin_users SET is_super_admin = ?, updated_at=CURRENT_TIMESTAMP WHERE user_id = ?', [
      value ? 1 : 0,
      userId,
    ]);
  }

  async isAuthenticated(userId: string): Promise<boolean> {
    const row = await get<any>(this.db, 'SELECT is_authenticated FROM admin_users WHERE user_id = ?', [userId]);
    if (row) return Number(row.is_authenticated) === 1;
    // Fallback por número
    const phone = userId.split('@')[0]?.split(':')[0] || '';
    if (!phone) return false;
    const allRows = await all<any>(this.db, 'SELECT user_id, is_authenticated FROM admin_users');
    const match = allRows.find((r) => String(r.user_id).split('@')[0]?.split(':')[0] === phone);
    return !!match && Number(match.is_authenticated) === 1;
  }

  async isGlobalAdmin(userId: string): Promise<boolean> {
    const isAuth = await this.isAuthenticated(userId);
    const isSuper = await this.isSuperAdmin(userId);
    return isAuth && !isSuper;
  }

  async get(userId: string): Promise<AdminUser | null> {
    const row = await get<any>(this.db, 'SELECT * FROM admin_users WHERE user_id = ?', [userId]);
    if (!row) return null;
    return {
      user_id: String(row.user_id),
      is_authenticated: Number(row.is_authenticated) === 1,
      is_super_admin: Number(row.is_super_admin ?? 0) === 1,
    };
  }

  async isSuperAdmin(userId: string): Promise<boolean> {
    const row = await get<any>(this.db, 'SELECT is_super_admin FROM admin_users WHERE user_id = ?', [userId]);
    if (row) return Number(row.is_super_admin) === 1;
    const phone = userId.split('@')[0]?.split(':')[0] || '';
    if (!phone) return false;
    const allRows = await all<any>(this.db, 'SELECT user_id, is_super_admin FROM admin_users');
    const match = allRows.find((r) => String(r.user_id).split('@')[0]?.split(':')[0] === phone);
    return !!match && Number(match.is_super_admin) === 1;
  }

  async listAllAdminIds(): Promise<string[]> {
    const rows = await all<any>(this.db, 'SELECT user_id FROM admin_users WHERE is_authenticated = 1');
    return rows.map((r) => String(r.user_id));
  }

  async listSuperAdminIds(): Promise<string[]> {
    const rows = await all<any>(this.db, 'SELECT user_id FROM admin_users WHERE is_super_admin = 1');
    return rows.map((r) => String(r.user_id));
  }

  async listGroupAdmins(groupId: string): Promise<Array<{ user_id: string }>> {
    const rows = await all<any>(this.db, 'SELECT user_id FROM group_admins WHERE group_id = ? ORDER BY created_at ASC', [groupId]);
    return rows.map((r) => ({ user_id: String(r.user_id) }));
  }

  async assignGroupAdmin(userId: string, groupId: string): Promise<void> {
    await run(this.db, 'INSERT OR IGNORE INTO group_admins(user_id, group_id) VALUES (?, ?)', [userId, groupId]);
  }

  async removeGroupAdmin(userId: string, groupId: string): Promise<void> {
    await run(this.db, 'DELETE FROM group_admins WHERE user_id = ? AND group_id = ?', [userId, groupId]);
  }

  async isGroupAdmin(userId: string, groupId: string): Promise<boolean> {
    const row = await get<any>(this.db, 'SELECT 1 FROM group_admins WHERE user_id = ? AND group_id = ? LIMIT 1', [userId, groupId]);
    if (row) return true;
    // Fallback by phone number without jid suffix
    const phone = userId.split('@')[0]?.split(':')[0] || '';
    if (!phone) return false;
    const rows = await all<any>(this.db, 'SELECT user_id FROM group_admins WHERE group_id = ?', [groupId]);
    return rows.some((r) => String(r.user_id).split('@')[0]?.split(':')[0] === phone);
  }

  /**
   * Returns 'super' if the user is a super admin,
   * 'global' if the user is a global authenticated admin,
   * 'group' if the user is a group admin for the provided groupId,
   * or null otherwise.
   */
  async getAdminLevel(userId: string, groupId?: string): Promise<'super' | 'global' | 'group' | null> {
    if (await this.isSuperAdmin(userId)) return 'super';
    if (await this.isAuthenticated(userId)) return 'global';
    if (groupId && (await this.isGroupAdmin(userId, groupId))) return 'group';
    return null;
  }
}

export class AdminVerificationCodeRepository {
  constructor(private db: sqlite3.Database) {}

  async addCode(code: string): Promise<void> {
    await run(this.db, 'INSERT OR IGNORE INTO admin_verification_codes(code) VALUES (?)', [code]);
  }

  async listAvailableCodes(limit = 10): Promise<string[]> {
    const rows = await all<any>(
      this.db,
      'SELECT code FROM admin_verification_codes WHERE consumed_by IS NULL ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rows.map((row) => String(row.code));
  }

  async consumeIfValid(code: string, consumedBy: string): Promise<boolean> {
    const row = await get<any>(
      this.db,
      'SELECT code FROM admin_verification_codes WHERE code = ? AND consumed_by IS NULL',
      [code]
    );
    if (!row) return false;

    await run(
      this.db,
      'UPDATE admin_verification_codes SET consumed_by = ?, consumed_at = CURRENT_TIMESTAMP WHERE code = ?',
      [consumedBy, code]
    );
    return true;
  }
}

export class UserModerationRepository {
  constructor(private db: sqlite3.Database) {}

  async getOrCreate(userId: string): Promise<UserModerationState> {
    const existing = await this.getByUser(userId);
    if (existing) return existing;

    await run(
      this.db,
      'INSERT OR IGNORE INTO user_moderation_state(user_id, updated_at) VALUES (?, CURRENT_TIMESTAMP)',
      [userId]
    );

    return (await this.getByUser(userId)) || {
      user_id: userId,
      warning_count: 0,
      suspension_count_week: 0,
      first_week_suspension_at: null,
      temp_ban_until: null,
      week_ban_until: null,
      last_offense_at: null,
    };
  }

  async save(state: UserModerationState): Promise<void> {
    await run(
      this.db,
      `INSERT INTO user_moderation_state(
         user_id, warning_count, suspension_count_week, first_week_suspension_at,
         temp_ban_until, week_ban_until, last_offense_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         warning_count=excluded.warning_count,
         suspension_count_week=excluded.suspension_count_week,
         first_week_suspension_at=excluded.first_week_suspension_at,
         temp_ban_until=excluded.temp_ban_until,
         week_ban_until=excluded.week_ban_until,
         last_offense_at=excluded.last_offense_at,
         updated_at=CURRENT_TIMESTAMP`,
      [
        state.user_id,
        state.warning_count,
        state.suspension_count_week,
        state.first_week_suspension_at ? state.first_week_suspension_at.toISOString() : null,
        state.temp_ban_until ? state.temp_ban_until.toISOString() : null,
        state.week_ban_until ? state.week_ban_until.toISOString() : null,
        state.last_offense_at ? state.last_offense_at.toISOString() : null,
      ]
    );
  }

  async listCurrentlyBanned(now: Date, limit = 50): Promise<BannedUserView[]> {
    const rows = await all<any>(
      this.db,
      `SELECT m.id, m.user_id, p.name, m.temp_ban_until, m.week_ban_until
       FROM user_moderation_state m
       LEFT JOIN user_profiles p ON p.user_id = m.user_id
       WHERE (m.temp_ban_until IS NOT NULL AND m.temp_ban_until > ?)
          OR (m.week_ban_until IS NOT NULL AND m.week_ban_until > ?)
       ORDER BY COALESCE(m.week_ban_until, m.temp_ban_until) DESC
       LIMIT ?`,
      [now.toISOString(), now.toISOString(), limit]
    );

    return rows.map((row) => {
      const week = row.week_ban_until ? new Date(String(row.week_ban_until)) : null;
      const temp = row.temp_ban_until ? new Date(String(row.temp_ban_until)) : null;
      const banType = week && week > now ? 'week' : 'temp';
      const bannedUntil = banType === 'week' && week ? week : (temp || now);
      const userId = String(row.user_id);
      const phone = userId.split('@')[0] || userId;

      return {
        id: Number(row.id),
        user_id: userId,
        name: row.name ? String(row.name) : undefined,
        phone,
        ban_type: banType,
        banned_until: bannedUntil,
      } as BannedUserView;
    });
  }

  async unblockById(id: number): Promise<boolean> {
    const result = await run(
      this.db,
      `UPDATE user_moderation_state
       SET warning_count = 0,
           suspension_count_week = 0,
           first_week_suspension_at = NULL,
           temp_ban_until = NULL,
           week_ban_until = NULL,
           last_offense_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id]
    );
    return result.changes > 0;
  }

  private async getByUser(userId: string): Promise<UserModerationState | null> {
    const row = await get<any>(this.db, 'SELECT * FROM user_moderation_state WHERE user_id = ?', [userId]);
    if (!row) return null;
    return {
      id: Number(row.id),
      user_id: String(row.user_id),
      warning_count: Number(row.warning_count ?? 0),
      suspension_count_week: Number(row.suspension_count_week ?? 0),
      first_week_suspension_at: row.first_week_suspension_at ? new Date(String(row.first_week_suspension_at)) : null,
      temp_ban_until: row.temp_ban_until ? new Date(String(row.temp_ban_until)) : null,
      week_ban_until: row.week_ban_until ? new Date(String(row.week_ban_until)) : null,
      last_offense_at: row.last_offense_at ? new Date(String(row.last_offense_at)) : null,
    };
  }
}

export class SchedulerRunRepository {
  constructor(private db: sqlite3.Database) {}

  async log(jobName: string, status: 'ok' | 'error', message: string): Promise<void> {
    await run(this.db, 'INSERT INTO scheduler_runs(job_name, status, message) VALUES (?, ?, ?)', [jobName, status, message]);
  }
}

export class DailyGreetingRepository {
  constructor(private db: sqlite3.Database) {}

  async hasGreeted(userId: string, date: Date): Promise<boolean> {
    const keyDate = date.toISOString().slice(0, 10);
    const row = await get<any>(
      this.db,
      'SELECT user_id FROM user_daily_greetings WHERE user_id = ? AND greeting_date = ? LIMIT 1',
      [userId, keyDate]
    );
    return !!row;
  }

  async markGreeted(userId: string, date: Date): Promise<void> {
    const keyDate = date.toISOString().slice(0, 10);
    await run(
      this.db,
      'INSERT OR IGNORE INTO user_daily_greetings(user_id, greeting_date) VALUES (?, ?)',
      [userId, keyDate]
    );
  }
}

export class OutboxDedupRepository {
  constructor(private db: sqlite3.Database) {}

  async markIfNew(messageKey: string): Promise<boolean> {
    const result = await run(
      this.db,
      'INSERT OR IGNORE INTO outbox_dedup(message_key) VALUES (?)',
      [messageKey]
    );
    return result.changes > 0;
  }

  async deleteOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await run(this.db, 'DELETE FROM outbox_dedup WHERE created_at < ?', [cutoff]);
    return result.changes;
  }
}

// PHASE 3: Group Memberships
export class GroupMembershipRepository {
  constructor(private db: sqlite3.Database) {}

  async addMembership(groupId: string, userId: string, role: string = 'member'): Promise<number> {
    const result = await run(
      this.db,
      `INSERT INTO group_memberships(group_id, user_id, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, group_id) DO UPDATE SET role = excluded.role, is_active = 1, updated_at = CURRENT_TIMESTAMP`,
      [groupId, userId, role]
    );
    return result.lastID;
  }

  async removeMembership(groupId: string, userId: string): Promise<boolean> {
    const result = await run(this.db, 'DELETE FROM group_memberships WHERE group_id = ? AND user_id = ?', [groupId, userId]);
    return result.changes > 0;
  }

  async listByGroup(groupId: string): Promise<Array<{ user_id: string; role: string; is_active: boolean }>> {
    const rows = await all<any>(this.db, 'SELECT user_id, role, is_active FROM group_memberships WHERE group_id = ? ORDER BY created_at ASC', [groupId]);
    return rows.map((r) => ({ user_id: String(r.user_id), role: String(r.role), is_active: Number(r.is_active) === 1 }));
  }

  async listByUser(userId: string): Promise<Array<{ group_id: string; role: string; is_active: boolean }>> {
    const rows = await all<any>(this.db, 'SELECT group_id, role, is_active FROM group_memberships WHERE user_id = ? ORDER BY created_at ASC', [userId]);
    return rows.map((r) => ({ group_id: String(r.group_id), role: String(r.role), is_active: Number(r.is_active) === 1 }));
  }

  async getMembership(groupId: string, userId: string): Promise<{ user_id: string; role: string; is_active: boolean } | null> {
    const row = await get<any>(this.db, 'SELECT user_id, role, is_active FROM group_memberships WHERE group_id = ? AND user_id = ? LIMIT 1', [groupId, userId]);
    if (!row) return null;
    return { user_id: String(row.user_id), role: String(row.role), is_active: Number(row.is_active) === 1 };
  }

  async setRole(groupId: string, userId: string, role: string): Promise<void> {
    await run(this.db, 'UPDATE group_memberships SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ? AND user_id = ?', [role, groupId, userId]);
  }

  async isMember(groupId: string, userId: string): Promise<boolean> {
    const row = await get<any>(this.db, 'SELECT 1 FROM group_memberships WHERE group_id = ? AND user_id = ? AND is_active = 1 LIMIT 1', [groupId, userId]);
    return !!row;
  }
}

// Cohort-level configuration repository
export class CohortConfigRepository {
  constructor(private db: sqlite3.Database) {}

  async getByYear(entryYear: number): Promise<CohortConfig | null> {
    const row = await get<any>(this.db, 'SELECT * FROM cohort_configs WHERE entry_year = ? LIMIT 1', [entryYear]);
    if (!row) return null;
    return {
      id: Number(row.id),
      entry_year: Number(row.entry_year),
      configs_json: String(row.configs_json),
      created_at: row.created_at ? new Date(String(row.created_at)) : undefined,
      updated_at: row.updated_at ? new Date(String(row.updated_at)) : undefined,
    } as CohortConfig;
  }

  async upsertByYear(entryYear: number, configsJson: string): Promise<void> {
    await run(
      this.db,
      `INSERT INTO cohort_configs(entry_year, configs_json, created_at, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(entry_year) DO UPDATE SET configs_json=excluded.configs_json, updated_at=CURRENT_TIMESTAMP`,
      [entryYear, configsJson]
    );
  }

  async deleteByYear(entryYear: number): Promise<boolean> {
    const result = await run(this.db, 'DELETE FROM cohort_configs WHERE entry_year = ?', [entryYear]);
    return result.changes > 0;
  }

  async listAll(): Promise<CohortConfig[]> {
    const rows = await all<any>(this.db, 'SELECT * FROM cohort_configs ORDER BY entry_year ASC');
    return rows.map((r) => ({
      id: Number(r.id),
      entry_year: Number(r.entry_year),
      configs_json: String(r.configs_json),
      created_at: r.created_at ? new Date(String(r.created_at)) : undefined,
      updated_at: r.updated_at ? new Date(String(r.updated_at)) : undefined,
    } as CohortConfig));
  }
}

function rowToReminder(row: any): Reminder {
  const [year, month, day] = String(row.event_date).split('-').map(Number);
  return {
    id: Number(row.id),
    user_id: String(row.user_id),
    event_type: String(row.event_type),
    description: String(row.description),
    event_date: new Date(year, month - 1, day),
    status: String(row.status),
    source: String(row.source),
    group_id: row.group_id ? String(row.group_id) : undefined,
    notify_7d_sent: Number(row.notify_7d_sent) === 1,
    notify_3d_sent: Number(row.notify_3d_sent) === 1,
  };
}

function rowToNotice(row: any): InstitutionalNotice {
  const parseLocalDate = (value: any): Date | undefined => {
    if (!value) return undefined;
    const [year, month, day] = String(value).split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  return {
    title: String(row.title),
    body: String(row.body),
    start_date: parseLocalDate(row.start_date),
    end_date: parseLocalDate(row.end_date),
    event_time: row.event_time ? String(row.event_time) : undefined,
    source_email: row.source_email ? String(row.source_email) : undefined,
    unique_hash: String(row.unique_hash),
  };
}

function rowToExam(row: any): ManagedExam {
  const dateStr = String(row.exam_date);
  const [year, month, day] = dateStr.split('-').map(Number);
  const exam_date = new Date(year, month - 1, day);
  const ultimoAvisoEnviado = row.ultimo_aviso_enviado ? new Date(String(row.ultimo_aviso_enviado)) : undefined;
  
  return {
    id: Number(row.id),
    subject: String(row.subject),
    exam_date,
    exam_time: String(row.exam_time),
    exam_type: String(row.exam_type),
    observations: String(row.observations),
    created_by: String(row.created_by),
    tipoDisponibilidad: row.tipo_disponibilidad ? String(row.tipo_disponibilidad) as ManagedExam['tipoDisponibilidad'] : 'hora-especifica',
    horaInicio: row.hora_inicio ? String(row.hora_inicio) : undefined,
    horaFin: row.hora_fin ? String(row.hora_fin) : undefined,
    frecuenciaAvisos: row.frecuencia_avisos ? String(row.frecuencia_avisos) : '7d,3d,1d,20m',
    exam_commission_id: row.exam_commission_id ? Number(row.exam_commission_id) : undefined,
    ultimoAvisoEnviado,
  };
}

function formatLocalDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function getReminderDateTime(reminder: Reminder): Date {
  return new Date(reminder.event_date.getFullYear(), reminder.event_date.getMonth(), reminder.event_date.getDate());
}

function getReminderEndOfDay(reminder: Reminder): Date {
  return new Date(
    reminder.event_date.getFullYear(),
    reminder.event_date.getMonth(),
    reminder.event_date.getDate(),
    23,
    59,
    59,
    999,
  );
}

function getExamDateTime(exam: ManagedExam): Date {
  const [hours, minutes] = String(exam.exam_time || '00:00').split(':').map(Number);
  return new Date(exam.exam_date.getFullYear(), exam.exam_date.getMonth(), exam.exam_date.getDate(), hours || 0, minutes || 0, 0, 0);
}

export class ManagedClassRepository {
  constructor(private db: sqlite3.Database) {}

  async create(classData: ManagedClassCreateInput): Promise<number> {
    const result = await run(
      this.db,
      `INSERT INTO managed_classes(subject, schedule_day, schedule_time, meet_link, notifications_enabled, commission_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        classData.subject,
        classData.schedule_day,
        classData.schedule_time,
        classData.meet_link,
        classData.notifications_enabled ? 1 : 0,
        classData.commission_count ?? 1,
      ]
    );
    return result.lastID;
  }

  async listAll(): Promise<ManagedClass[]> {
    const rows = await all<any>(this.db, `SELECT * FROM managed_classes ORDER BY schedule_day, schedule_time`);
    return rows.map(rowToManagedClass);
  }

  async listWithIds(): Promise<Array<{ id: number; managedClass: ManagedClass }>> {
    const rows = await all<any>(this.db, `SELECT * FROM managed_classes ORDER BY schedule_day, schedule_time`);
    return rows.map((row) => ({ id: Number(row.id), managedClass: rowToManagedClass(row) }));
  }

  async getById(id: number): Promise<ManagedClass | null> {
    const row = await get<any>(this.db, `SELECT * FROM managed_classes WHERE id = ?`, [id]);
    return row ? rowToManagedClass(row) : null;
  }

  async listByDay(day: string): Promise<ManagedClass[]> {
    const rows = await all<any>(
      this.db,
      `SELECT * FROM managed_classes WHERE lower(schedule_day) = lower(?) AND notifications_enabled = 1 ORDER BY schedule_time`,
      [day]
    );
    return rows.map(rowToManagedClass);
  }

  async setNotificationsEnabled(id: number, enabled: boolean): Promise<void> {
    await run(
      this.db,
      `UPDATE managed_classes SET notifications_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [enabled ? 1 : 0, id]
    );
  }

  async updateSubject(id: number, newSubject: string): Promise<void> {
    await run(this.db, `UPDATE managed_classes SET subject = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
      newSubject,
      id,
    ]);
  }

  async updateSchedule(id: number, newDay: string, newTime: string): Promise<void> {
    await run(
      this.db,
      `UPDATE managed_classes SET schedule_day = ?, schedule_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [newDay, newTime, id]
    );
  }

  async updateMeetLink(id: number, meetLink: string): Promise<void> {
    await run(
      this.db,
      `UPDATE managed_classes SET meet_link = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [meetLink, id]
    );
  }

  async delete(id: number): Promise<boolean> {
    const result = await run(this.db, `DELETE FROM managed_classes WHERE id = ?`, [id]);
    return result.changes > 0;
  }

  async getDistinctCommissionCounts(): Promise<number[]> {
    const rows = await all<any>(
      this.db,
      'SELECT DISTINCT commission_count FROM managed_classes WHERE commission_count > 0 ORDER BY commission_count'
    );
    return rows.map((r) => Number(r.commission_count)).filter((n) => n > 0);
  }
}

export class ClassNotificationRepository {
  constructor(private db: sqlite3.Database) {}

  async recordNotificationSent(managedClassId: number, minutesBefore: number): Promise<number> {
    const result = await run(
      this.db,
      `INSERT INTO class_notifications(managed_class_id, notification_sent_at, minutes_before)
       VALUES (?, CURRENT_TIMESTAMP, ?)`,
      [managedClassId, minutesBefore]
    );
    return result.lastID;
  }

  async getLastNotificationBefore(managedClassId: number, minutesBefore: number): Promise<Date | null> {
    const row = await get<any>(
      this.db,
      `SELECT notification_sent_at FROM class_notifications 
       WHERE managed_class_id = ? AND minutes_before = ? 
       ORDER BY notification_sent_at DESC LIMIT 1`,
      [managedClassId, minutesBefore]
    );
    return row ? new Date(String(row.notification_sent_at)) : null;
  }
}

function rowToManagedClass(row: any): ManagedClass {
  return {
    id: Number(row.id),
    subject: String(row.subject),
    schedule_day: String(row.schedule_day),
    schedule_time: String(row.schedule_time),
    meet_link: String(row.meet_link),
    notifications_enabled: Number(row.notifications_enabled) === 1,
    commission_count: Number(row.commission_count ?? 1),
    created_at: row.created_at ? new Date(String(row.created_at)) : undefined,
    updated_at: row.updated_at ? new Date(String(row.updated_at)) : undefined,
  };
}

  export class ManagedTeacherRepository {
    constructor(private db: sqlite3.Database) {}

    async create(teacher: ManagedTeacherCreateInput): Promise<number> {
      const result = await run(
        this.db,
        `INSERT INTO managed_teachers(name, email, subject) VALUES (?, ?, ?)`,
        [teacher.name, teacher.email, teacher.subject ?? null]
      );
      return result.lastID;
    }

    async listAll(): Promise<ManagedTeacher[]> {
      const rows = await all<any>(
        this.db,
        `SELECT * FROM managed_teachers ORDER BY subject ASC, name ASC`
      );
      return rows.map(rowToTeacher);
    }

    async listWithIds(limit: number = 50): Promise<Array<{ id: number; teacher: ManagedTeacher }>> {
      const rows = await all<any>(
        this.db,
        `SELECT * FROM managed_teachers ORDER BY subject ASC, name ASC LIMIT ?`,
        [limit]
      );
      return rows.map((row) => ({ id: Number(row.id), teacher: rowToTeacher(row) }));
    }

    async delete(teacherId: number): Promise<void> {
      await run(this.db, `DELETE FROM managed_teachers WHERE id = ?`, [teacherId]);
    }

    async getById(teacherId: number): Promise<ManagedTeacher | null> {
      const row = await get<any>(this.db, `SELECT * FROM managed_teachers WHERE id = ?`, [teacherId]);
      return row ? rowToTeacher(row) : null;
    }

    async update(teacherId: number, teacher: Partial<ManagedTeacherCreateInput>): Promise<void> {
      const updates: string[] = [];
      const params: unknown[] = [];
      if (teacher.name !== undefined) {
        updates.push('name = ?');
        params.push(teacher.name);
      }
      if (teacher.email !== undefined) {
        updates.push('email = ?');
        params.push(teacher.email);
      }
      if (teacher.subject !== undefined) {
        updates.push('subject = ?');
        params.push(teacher.subject);
      }
      if (updates.length === 0) return;
      params.push(teacherId);
      await run(
        this.db,
        `UPDATE managed_teachers SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        params
      );
    }
  }

  // PHASE 1: Multi-tenant Groups Repository
  export class GroupRepository {
    constructor(private db: sqlite3.Database) {}

    /**
     * Register a new WhatsApp group or update if already exists
     */
    async register(groupId: string, displayName?: string, addedBy?: string): Promise<number> {
      const result = await run(
        this.db,
        `INSERT INTO whatsapp_groups(group_id, display_name, is_active, added_by, updated_at)
         VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(group_id) DO UPDATE SET is_active=1, updated_at=CURRENT_TIMESTAMP`,
        [groupId, displayName ?? null, addedBy ?? null]
      );
      // Para conflictos, traer el id existente
      const existing = await get<any>(this.db, 'SELECT id FROM whatsapp_groups WHERE group_id = ?', [groupId]);
      return existing ? Number(existing.id) : result.lastID;
    }

    /**
     * Get a group by its ID
     */
    async findById(id: number): Promise<WhatsAppGroup | null> {
      const row = await get<any>(this.db, 'SELECT * FROM whatsapp_groups WHERE id = ?', [id]);
      return row ? rowToWhatsAppGroup(row) : null;
    }

    /**
     * Find a group by its WhatsApp JID
     */
    async findByGroupId(groupId: string): Promise<WhatsAppGroup | null> {
      const row = await get<any>(this.db, 'SELECT * FROM whatsapp_groups WHERE group_id = ?', [groupId]);
      return row ? rowToWhatsAppGroup(row) : null;
    }

    /**
     * Get all registered groups (active and inactive)
     */
    async findAll(): Promise<WhatsAppGroup[]> {
      const rows = await all<any>(this.db, 'SELECT * FROM whatsapp_groups ORDER BY created_at DESC');
      return rows.map(rowToWhatsAppGroup);
    }

    /**
     * Get all active group IDs for gateway allowlist
     */
    async getAllActiveIds(): Promise<string[]> {
      const rows = await all<any>(this.db, 'SELECT group_id FROM whatsapp_groups WHERE is_active = 1 ORDER BY created_at ASC');
      return rows.map((r) => String(r.group_id));
    }

    /**
     * Activate or deactivate a group
     */
    async setActive(groupId: string, isActive: boolean): Promise<void> {
      await run(this.db, 'UPDATE whatsapp_groups SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?', [
        isActive ? 1 : 0,
        groupId,
      ]);
    }

    /**
     * Update the entry_year for a whatsapp group. Use null for general groups.
     */
    async updateEntryYear(groupId: string, entryYear: number | null): Promise<void> {
      await run(this.db, 'UPDATE whatsapp_groups SET entry_year = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?', [
        entryYear === null ? null : entryYear,
        groupId,
      ]);
    }

    /**
     * Delete a group (hard delete - use setActive(false) to soft delete instead)
     */
    async delete(groupId: string): Promise<boolean> {
      const result = await run(this.db, 'DELETE FROM whatsapp_groups WHERE group_id = ?', [groupId]);
      return result.changes > 0;
    }

    /**
     * Check if a group is registered and active
     */
    async isActive(groupId: string): Promise<boolean> {
      const row = await get<any>(this.db, 'SELECT is_active FROM whatsapp_groups WHERE group_id = ?', [groupId]);
      return !!row && Number(row.is_active) === 1;
    }

    /**
     * Get count of active groups
     */
    async getActiveCount(): Promise<number> {
      const row = await get<any>(this.db, 'SELECT COUNT(*) as count FROM whatsapp_groups WHERE is_active = 1');
      return Number(row?.count ?? 0);
    }
  }

  // PHASE 2: Commissions Repository
  export class CommissionRepository {
    constructor(private db: sqlite3.Database) {}

    /**
     * Create or get a commission
     */
    async createOrGet(name: string, year?: number, shift?: string): Promise<number> {
      // Try to find existing
      let row = await get<any>(
        this.db,
        'SELECT id FROM commissions WHERE name = ? AND year IS ? AND shift IS ?',
        [name, year ?? null, shift ?? null]
      );
      if (row) return Number(row.id);

      // Create new
      const result = await run(
        this.db,
        'INSERT INTO commissions(name, year, shift) VALUES (?, ?, ?)',
        [name, year ?? null, shift ?? null]
      );
      return result.lastID;
    }

    /**
     * Get commission by ID
     */
    async getById(id: number): Promise<Commission | null> {
      const row = await get<any>(this.db, 'SELECT * FROM commissions WHERE id = ?', [id]);
      return row ? rowToCommission(row) : null;
    }

    /**
     * List all commissions for a given year
     */
    async listByYear(year: number): Promise<Commission[]> {
      const rows = await all<any>(
        this.db,
        'SELECT * FROM commissions WHERE year = ? ORDER BY shift, name',
        [year]
      );
      return rows.map(rowToCommission);
    }

    /**
     * List all commissions
     */
    async findAll(): Promise<Commission[]> {
      const rows = await all<any>(this.db, 'SELECT * FROM commissions ORDER BY year DESC, shift, name');
      return rows.map(rowToCommission);
    }

    /**
     * Delete a commission
     */
    async delete(id: number): Promise<boolean> {
      const result = await run(this.db, 'DELETE FROM commissions WHERE id = ?', [id]);
      return result.changes > 0;
    }

    /**
     * Get distinct years
     */
    async getDistinctYears(): Promise<number[]> {
      const rows = await all<any>(this.db, 'SELECT DISTINCT year FROM commissions WHERE year IS NOT NULL ORDER BY year DESC');
      return rows.map((r) => Number(r.year));
    }
  }

  // PHASE 2: Group Context Repository
  export class GroupContextRepository {
    constructor(private db: sqlite3.Database) {}

    /**
     * Create or update group context
     */
    async upsert(
      groupId: string,
      year: number,
      commissionId?: number | null,
      label?: string,
      configuredBy?: string
    ): Promise<number> {
      const existing = await get<any>(this.db, 'SELECT id FROM group_context WHERE group_id = ?', [groupId]);

      if (existing) {
        // Update
        await run(
          this.db,
          `UPDATE group_context SET year = ?, commission_id = ?, label = ?, configured_by = ?, updated_at = CURRENT_TIMESTAMP
           WHERE group_id = ?`,
          [year, commissionId ?? null, label ?? null, configuredBy ?? null, groupId]
        );
        return Number(existing.id);
      } else {
        // Create
        const result = await run(
          this.db,
          `INSERT INTO group_context(group_id, year, commission_id, label, configured_by)
           VALUES (?, ?, ?, ?, ?)`,
          [groupId, year, commissionId ?? null, label ?? null, configuredBy ?? null]
        );
        return result.lastID;
      }
    }

    /**
     * Get context by group ID
     */
    async getByGroupId(groupId: string): Promise<GroupContext | null> {
      const row = await get<any>(this.db, 'SELECT * FROM group_context WHERE group_id = ?', [groupId]);
      return row ? rowToGroupContext(row) : null;
    }

    /**
     * Get all contexts
     */
    async findAll(): Promise<GroupContext[]> {
      const rows = await all<any>(this.db, 'SELECT * FROM group_context ORDER BY created_at DESC');
      return rows.map(rowToGroupContext);
    }

    /**
     * Get contexts by commission
     */
    async getByCommissionId(commissionId: number): Promise<GroupContext[]> {
      const rows = await all<any>(this.db, 'SELECT * FROM group_context WHERE commission_id = ?', [commissionId]);
      return rows.map(rowToGroupContext);
    }

    /**
     * Get contexts by year
     */
    async getByYear(year: number): Promise<GroupContext[]> {
      const rows = await all<any>(this.db, 'SELECT * FROM group_context WHERE year = ?', [year]);
      return rows.map(rowToGroupContext);
    }

    /**
     * Set commissions for a group context (replaces existing mappings)
     */
    async setCommissionsForGroupContext(groupContextId: number, commissionIds: number[]): Promise<void> {
      // remove old mappings
      await run(this.db, 'DELETE FROM group_context_commissions WHERE group_context_id = ?', [groupContextId]);

      if (!commissionIds || commissionIds.length === 0) return;

      // insert new mappings
      for (const cid of commissionIds) {
        await run(
          this.db,
          'INSERT OR IGNORE INTO group_context_commissions(group_context_id, commission_id) VALUES (?, ?)',
          [groupContextId, cid]
        );
      }
    }

    /**
     * List commissions mapped to a group context
     */
    async listCommissionsForGroupContext(groupContextId: number): Promise<Commission[]> {
      const rows = await all<any>(
        this.db,
        `SELECT c.* FROM commissions c
         JOIN group_context_commissions gcc ON gcc.commission_id = c.id
         WHERE gcc.group_context_id = ?
         ORDER BY c.name`,
        [groupContextId]
      );
      return rows.map(rowToCommission);
    }

    /**
     * Remove commissions for a group context. If commissionIds omitted, remove all.
     */
    async removeCommissionsForGroupContext(groupContextId: number, commissionIds?: number[]): Promise<void> {
      if (!commissionIds || commissionIds.length === 0) {
        await run(this.db, 'DELETE FROM group_context_commissions WHERE group_context_id = ?', [groupContextId]);
        return;
      }

      const placeholders = commissionIds.map(() => '?').join(',');
      const params: unknown[] = [groupContextId, ...commissionIds];
      await run(this.db, `DELETE FROM group_context_commissions WHERE group_context_id = ? AND commission_id IN (${placeholders})`, params);
    }

    /**
     * Delete context
     */
    async delete(groupId: string): Promise<boolean> {
      const result = await run(this.db, 'DELETE FROM group_context WHERE group_id = ?', [groupId]);
      return result.changes > 0;
    }
  }

  // PHASE 3: ClassCommissionSchedule Repository
  export class ClassCommissionScheduleRepository {
    constructor(private db: sqlite3.Database) {}

    async create(entry: {
      managed_class_id: number;
      commission_id: number;
      schedule_day: string;
      schedule_time: string;
      meet_link?: string | null;
    }): Promise<number> {
      const result = await run(
        this.db,
        `INSERT INTO class_commission_schedule(managed_class_id, commission_id, schedule_day, schedule_time, meet_link)
         VALUES (?, ?, ?, ?, ?)`,
        [entry.managed_class_id, entry.commission_id, entry.schedule_day, entry.schedule_time, entry.meet_link ?? null]
      );
      return result.lastID;
    }

    async listByCommissionAndDay(commissionId: number, day: string): Promise<ClassCommissionSchedule[]> {
      const rows = await all<any>(
        this.db,
        `SELECT * FROM class_commission_schedule WHERE commission_id = ? AND lower(schedule_day) = lower(?) ORDER BY schedule_time`,
        [commissionId, day]
      );
      return rows.map(rowToClassCommissionSchedule);
    }

    async listByDay(day: string): Promise<ClassCommissionSchedule[]> {
      const rows = await all<any>(
        this.db,
        `SELECT * FROM class_commission_schedule WHERE lower(schedule_day) = lower(?) ORDER BY schedule_time`,
        [day]
      );
      return rows.map(rowToClassCommissionSchedule);
    }

    async listByManagedClass(managedClassId: number): Promise<ClassCommissionSchedule[]> {
      const rows = await all<any>(
        this.db,
        `SELECT * FROM class_commission_schedule WHERE managed_class_id = ? ORDER BY schedule_day, schedule_time`,
        [managedClassId]
      );
      return rows.map(rowToClassCommissionSchedule);
    }

    async delete(id: number): Promise<boolean> {
      const result = await run(this.db, 'DELETE FROM class_commission_schedule WHERE id = ?', [id]);
      return result.changes > 0;
    }
  }

  function rowToClassCommissionSchedule(row: any): ClassCommissionSchedule {
    return {
      id: Number(row.id),
      managed_class_id: Number(row.managed_class_id),
      commission_id: Number(row.commission_id),
      schedule_day: String(row.schedule_day),
      schedule_time: String(row.schedule_time),
      meet_link: row.meet_link ? String(row.meet_link) : undefined,
      created_at: row.created_at ? new Date(String(row.created_at)) : undefined,
      updated_at: row.updated_at ? new Date(String(row.updated_at)) : undefined,
    };
  }

  function rowToCommission(row: any): Commission {
    return {
      id: Number(row.id),
      name: String(row.name),
      year: row.year ? Number(row.year) : undefined,
      shift: row.shift ? String(row.shift) : undefined,
      created_at: row.created_at ? new Date(String(row.created_at)) : undefined,
      updated_at: row.updated_at ? new Date(String(row.updated_at)) : undefined,
    };
  }

  function rowToGroupContext(row: any): GroupContext {
    return {
      id: Number(row.id),
      group_id: String(row.group_id),
      year: Number(row.year),
      commission_id: row.commission_id ? Number(row.commission_id) : null,
      label: row.label ? String(row.label) : undefined,
      configured_by: row.configured_by ? String(row.configured_by) : undefined,
      created_at: row.created_at ? new Date(String(row.created_at)) : undefined,
      updated_at: row.updated_at ? new Date(String(row.updated_at)) : undefined,
    };
  }

  function rowToWhatsAppGroup(row: any): WhatsAppGroup {
    return {
      id: Number(row.id),
      group_id: String(row.group_id),
      display_name: row.display_name ? String(row.display_name) : undefined,
      is_active: Number(row.is_active) === 1,
      added_by: row.added_by ? String(row.added_by) : undefined,
      entry_year: row.entry_year !== undefined && row.entry_year !== null ? Number(row.entry_year) : null,
      created_at: row.created_at ? new Date(String(row.created_at)) : undefined,
      updated_at: row.updated_at ? new Date(String(row.updated_at)) : undefined,
    };
  }

  function rowToTeacher(row: any): ManagedTeacher {
    return {
      id: Number(row.id),
      name: String(row.name),
      email: String(row.email),
      subject: row.subject ? String(row.subject) : undefined,
      created_at: row.created_at ? new Date(String(row.created_at)) : undefined,
      updated_at: row.updated_at ? new Date(String(row.updated_at)) : undefined,
    };
  }
