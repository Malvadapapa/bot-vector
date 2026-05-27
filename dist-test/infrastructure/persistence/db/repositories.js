"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClassCommissionScheduleRepository = exports.GroupContextRepository = exports.CommissionRepository = exports.GroupRepository = exports.ManagedTeacherRepository = exports.ClassNotificationRepository = exports.ManagedClassRepository = exports.GroupMembershipRepository = exports.OutboxDedupRepository = exports.DailyGreetingRepository = exports.SchedulerRunRepository = exports.UserModerationRepository = exports.AdminVerificationCodeRepository = exports.AdminRepository = exports.UserProfileRepository = exports.ManagedExamRepository = exports.InstitutionalNoticeRepository = exports.ConfirmationRepository = exports.RateLimitRepository = exports.ReminderRepository = void 0;
function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err)
                reject(err);
            else
                resolve({ lastID: this.lastID ?? 0, changes: this.changes ?? 0 });
        });
    });
}
function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err)
                reject(err);
            else
                resolve(row);
        });
    });
}
function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err)
                reject(err);
            else
                resolve(rows);
        });
    });
}
class ReminderRepository {
    constructor(db) {
        this.db = db;
    }
    async create(reminder) {
        const result = await run(this.db, `INSERT INTO reminders (
        user_id, event_type, description, event_date, status, source, group_id, notify_7d_sent, notify_3d_sent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            reminder.user_id,
            reminder.event_type,
            reminder.description,
            formatLocalDateOnly(reminder.event_date),
            reminder.status ?? 'pending',
            reminder.source ?? 'whatsapp',
            reminder.group_id ?? null,
            reminder.notify_7d_sent ? 1 : 0,
            reminder.notify_3d_sent ? 1 : 0,
        ]);
        return result.lastID;
    }
    async listDueForNotification(today) {
        const rows = await all(this.db, `SELECT * FROM reminders WHERE status='pending'`);
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
    async listActive() {
        const rows = await all(this.db, `SELECT * FROM reminders WHERE status='pending' ORDER BY event_date ASC, id ASC`);
        return rows.map(rowToReminder).filter((r) => getReminderEndOfDay(r).getTime() >= Date.now());
    }
    async markNotified(reminderId, daysBefore) {
        const column = daysBefore === 7 ? 'notify_7d_sent' : 'notify_3d_sent';
        await run(this.db, `UPDATE reminders SET ${column}=1, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [reminderId]);
    }
    async listByDateRange(startDate, endDate) {
        const rows = await all(this.db, `SELECT * FROM reminders WHERE status='pending' AND event_date >= ? AND event_date <= ? ORDER BY event_date ASC, id ASC`, [formatLocalDateOnly(startDate), formatLocalDateOnly(endDate)]);
        return rows.map(rowToReminder);
    }
    async listRegisteredExams(userId) {
        const params = ['pending'];
        const userFilter = userId ? 'AND user_id = ?' : '';
        if (userId)
            params.push(userId);
        const rows = await all(this.db, `SELECT * FROM reminders
       WHERE status = ?
       ${userFilter}
       AND (
         lower(event_type) IN ('examen', 'parcial', 'final')
         OR lower(description) LIKE '%examen%'
         OR lower(description) LIKE '%parcial%'
         OR lower(description) LIKE '%final%'
       )
       ORDER BY event_date ASC, id ASC`, params);
        return rows.map(rowToReminder);
    }
    async delete(reminderId) {
        await run(this.db, 'DELETE FROM reminders WHERE id = ?', [reminderId]);
    }
}
exports.ReminderRepository = ReminderRepository;
class RateLimitRepository {
    constructor(db) {
        this.db = db;
    }
    async get(userId) {
        const row = await get(this.db, 'SELECT * FROM rate_limit WHERE user_id = ?', [userId]);
        if (!row)
            return null;
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
    async save(record) {
        await run(this.db, `INSERT INTO rate_limit(
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
         updated_at=CURRENT_TIMESTAMP`, [
            record.user_id,
            record.question_count,
            record.last_reset_date.toISOString().slice(0, 10),
            record.bonus_questions_remaining,
            record.approval_pending ? 1 : 0,
            record.approval_requested_at ? record.approval_requested_at.toISOString() : null,
            record.approval_expires_at ? record.approval_expires_at.toISOString() : null,
        ]);
    }
    async resetAll(resetDate) {
        await run(this.db, `UPDATE rate_limit
       SET question_count=0,
           last_reset_date=?,
           bonus_questions_remaining=0,
           approval_pending=0,
           approval_requested_at=NULL,
           approval_expires_at=NULL,
           updated_at=CURRENT_TIMESTAMP`, [resetDate.toISOString().slice(0, 10)]);
    }
    async getOldestPendingApproval(now) {
        const row = await get(this.db, `SELECT * FROM rate_limit
       WHERE approval_pending = 1
         AND (approval_expires_at IS NULL OR approval_expires_at > ?)
       ORDER BY approval_requested_at ASC, updated_at ASC
       LIMIT 1`, [now.toISOString()]);
        if (!row)
            return null;
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
exports.RateLimitRepository = RateLimitRepository;
class ConfirmationRepository {
    constructor(db) {
        this.db = db;
    }
    async save(userId, state, intent, payload, expiresAt) {
        await run(this.db, `INSERT INTO confirmaciones(user_id, state, intent, pending_payload_json, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         state=excluded.state,
         intent=excluded.intent,
         pending_payload_json=excluded.pending_payload_json,
         expires_at=excluded.expires_at,
         updated_at=CURRENT_TIMESTAMP`, [userId, state, intent, JSON.stringify(payload), expiresAt.toISOString()]);
    }
    async get(userId) {
        const row = await get(this.db, 'SELECT * FROM confirmaciones WHERE user_id = ?', [userId]);
        if (!row)
            return null;
        return {
            user_id: String(row.user_id),
            state: String(row.state),
            intent: String(row.intent),
            pending_payload_json: String(row.pending_payload_json),
            expires_at: new Date(String(row.expires_at)),
        };
    }
    async delete(userId) {
        await run(this.db, 'DELETE FROM confirmaciones WHERE user_id = ?', [userId]);
    }
    async deleteExpired(nowUtc) {
        const result = await run(this.db, 'DELETE FROM confirmaciones WHERE expires_at < ?', [nowUtc.toISOString()]);
        return result.changes;
    }
}
exports.ConfirmationRepository = ConfirmationRepository;
class InstitutionalNoticeRepository {
    constructor(db) {
        this.db = db;
    }
    async createIfNew(notice) {
        try {
            await run(this.db, `INSERT INTO institutional_notices(title, body, start_date, end_date, event_time, source_email, unique_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, [
                notice.title,
                notice.body,
                notice.start_date ? notice.start_date.toISOString().slice(0, 10) : null,
                notice.end_date ? notice.end_date.toISOString().slice(0, 10) : null,
                notice.event_time ?? null,
                notice.source_email ?? null,
                notice.unique_hash,
            ]);
            return true;
        }
        catch {
            return false;
        }
    }
    async listRecent(limit = 5) {
        const rows = await all(this.db, 'SELECT * FROM institutional_notices ORDER BY created_at DESC, id DESC LIMIT ?', [limit]);
        return rows.map(rowToNotice);
    }
    async listWithIds(limit = 50) {
        const rows = await all(this.db, 'SELECT * FROM institutional_notices ORDER BY created_at DESC, id DESC LIMIT ?', [limit]);
        return rows.map((row) => ({ id: Number(row.id), notice: rowToNotice(row) }));
    }
    async getById(id) {
        const row = await get(this.db, 'SELECT * FROM institutional_notices WHERE id = ?', [id]);
        if (!row)
            return null;
        return rowToNotice(row);
    }
    async deleteById(id) {
        const result = await run(this.db, 'DELETE FROM institutional_notices WHERE id = ?', [id]);
        return result.changes > 0;
    }
    async updateById(id, data) {
        const fields = [];
        const values = [];
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
        if (!fields.length)
            return false;
        values.push(id);
        const sql = `UPDATE institutional_notices SET ${fields.join(', ')} WHERE id = ?`;
        const result = await run(this.db, sql, values);
        return result.changes > 0;
    }
}
exports.InstitutionalNoticeRepository = InstitutionalNoticeRepository;
class ManagedExamRepository {
    constructor(db) {
        this.db = db;
    }
    async create(exam) {
        const result = await run(this.db, `INSERT INTO managed_exams(
         subject, exam_date, exam_time, exam_type, observations, created_by,
         tipo_disponibilidad, hora_inicio, hora_fin, frecuencia_avisos, ultimo_aviso_enviado, exam_commission_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
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
        ]);
        return result.lastID;
    }
    async listUpcoming(fromDate, limit = 50) {
        const rows = await all(this.db, `SELECT * FROM managed_exams WHERE exam_date >= ? ORDER BY exam_date ASC LIMIT ?`, [formatLocalDateOnly(fromDate), limit]);
        return rows.map(rowToExam).filter((exam) => getExamDateTime(exam).getTime() >= fromDate.getTime());
    }
    async listWithIds(limit = 50) {
        const rows = await all(this.db, `SELECT * FROM managed_exams ORDER BY exam_date ASC, id ASC LIMIT ?`, [limit]);
        return rows.map((row) => ({ id: Number(row.id), exam: rowToExam(row) }));
    }
    async getById(id) {
        const row = await get(this.db, 'SELECT * FROM managed_exams WHERE id = ?', [id]);
        return row ? rowToExam(row) : null;
    }
    async deleteById(id) {
        const result = await run(this.db, 'DELETE FROM managed_exams WHERE id = ?', [id]);
        return result.changes > 0;
    }
    async deleteExpired(untilDate) {
        const dateStr = formatLocalDateOnly(untilDate);
        const timeStr = formatLocalTime(untilDate);
        const result = await run(this.db, `DELETE FROM managed_exams WHERE datetime(exam_date || ' ' || exam_time) < datetime(?)`, [`${dateStr} ${timeStr}`]);
        return result.changes;
    }
    async update(id, data) {
        const updates = [];
        const values = [];
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
        if (updates.length === 0)
            return;
        values.push(id);
        await run(this.db, `UPDATE managed_exams SET ${updates.join(', ')} WHERE id = ?`, values);
    }
}
exports.ManagedExamRepository = ManagedExamRepository;
class UserProfileRepository {
    constructor(db) {
        this.db = db;
    }
    async upsert(userId, name, birthdayDayMonth, email = '', userCommissionId) {
        await run(this.db, `INSERT INTO user_profiles(user_id, name, birthday_day_month, email, user_commission_id, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         name=excluded.name,
         birthday_day_month=excluded.birthday_day_month,
         email=excluded.email,
         user_commission_id=excluded.user_commission_id,
         updated_at=CURRENT_TIMESTAMP`, [userId, name, birthdayDayMonth, email, userCommissionId ?? null]);
    }
    async get(userId) {
        const row = await get(this.db, 'SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
        if (!row)
            return null;
        return {
            user_id: String(row.user_id),
            name: String(row.name),
            birthday_day_month: String(row.birthday_day_month),
            email: String(row.email || ''),
            user_commission_id: row.user_commission_id ? Number(row.user_commission_id) : undefined,
        };
    }
    async listUsersWithBirthday(dayMonth) {
        const rows = await all(this.db, 'SELECT * FROM user_profiles WHERE birthday_day_month = ?', [dayMonth]);
        return rows.map((row) => ({
            user_id: String(row.user_id),
            name: String(row.name),
            birthday_day_month: String(row.birthday_day_month),
            email: String(row.email || ''),
            user_commission_id: row.user_commission_id ? Number(row.user_commission_id) : undefined,
        }));
    }
    async countTotal() {
        const row = await get(this.db, 'SELECT COUNT(*) as count FROM user_profiles');
        return Number(row?.count ?? 0);
    }
    async listAll() {
        const rows = await all(this.db, 'SELECT * FROM user_profiles ORDER BY user_id');
        return rows.map((row) => ({
            user_id: String(row.user_id),
            name: String(row.name),
            birthday_day_month: String(row.birthday_day_month),
            email: String(row.email || ''),
            user_commission_id: row.user_commission_id ? Number(row.user_commission_id) : undefined,
        }));
    }
}
exports.UserProfileRepository = UserProfileRepository;
class AdminRepository {
    constructor(db) {
        this.db = db;
    }
    async register(userId) {
        await run(this.db, `INSERT INTO admin_users(user_id, is_authenticated, updated_at)
       VALUES (?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET is_authenticated=1, updated_at=CURRENT_TIMESTAMP`, [userId]);
    }
    async isRegistered(userId) {
        const row = await get(this.db, 'SELECT user_id FROM admin_users WHERE user_id = ?', [userId]);
        if (row)
            return true;
        // Fallback: buscar por número de teléfono sin sufijo (resuelve JID @lid vs @s.whatsapp.net)
        const phone = userId.split('@')[0]?.split(':')[0] || '';
        if (!phone)
            return false;
        const allRows = await all(this.db, 'SELECT user_id FROM admin_users');
        return allRows.some((r) => String(r.user_id).split('@')[0]?.split(':')[0] === phone);
    }
    async setAuthenticated(userId, value) {
        await run(this.db, 'UPDATE admin_users SET is_authenticated = ?, updated_at=CURRENT_TIMESTAMP WHERE user_id = ?', [
            value ? 1 : 0,
            userId,
        ]);
    }
    async isAuthenticated(userId) {
        const row = await get(this.db, 'SELECT is_authenticated FROM admin_users WHERE user_id = ?', [userId]);
        if (row)
            return Number(row.is_authenticated) === 1;
        // Fallback por número
        const phone = userId.split('@')[0]?.split(':')[0] || '';
        if (!phone)
            return false;
        const allRows = await all(this.db, 'SELECT user_id, is_authenticated FROM admin_users');
        const match = allRows.find((r) => String(r.user_id).split('@')[0]?.split(':')[0] === phone);
        return !!match && Number(match.is_authenticated) === 1;
    }
    async get(userId) {
        const row = await get(this.db, 'SELECT * FROM admin_users WHERE user_id = ?', [userId]);
        if (!row)
            return null;
        return {
            user_id: String(row.user_id),
            is_authenticated: Number(row.is_authenticated) === 1,
            is_super_admin: Number(row.is_super_admin ?? 0) === 1,
        };
    }
    async listAllAdminIds() {
        const rows = await all(this.db, 'SELECT user_id FROM admin_users WHERE is_authenticated = 1');
        return rows.map((r) => String(r.user_id));
    }
    async listSuperAdminIds() {
        const rows = await all(this.db, 'SELECT user_id FROM admin_users WHERE is_super_admin = 1');
        return rows.map((r) => String(r.user_id));
    }
    async assignGroupAdmin(userId, groupId) {
        await run(this.db, 'INSERT OR IGNORE INTO group_admins(user_id, group_id) VALUES (?, ?)', [userId, groupId]);
    }
    async removeGroupAdmin(userId, groupId) {
        await run(this.db, 'DELETE FROM group_admins WHERE user_id = ? AND group_id = ?', [userId, groupId]);
    }
    async isGroupAdmin(userId, groupId) {
        const row = await get(this.db, 'SELECT 1 FROM group_admins WHERE user_id = ? AND group_id = ? LIMIT 1', [userId, groupId]);
        if (row)
            return true;
        // Fallback by phone number without jid suffix
        const phone = userId.split('@')[0]?.split(':')[0] || '';
        if (!phone)
            return false;
        const rows = await all(this.db, 'SELECT user_id FROM group_admins WHERE group_id = ?', [groupId]);
        return rows.some((r) => String(r.user_id).split('@')[0]?.split(':')[0] === phone);
    }
    /**
     * Returns 'global' if the user is a global authenticated admin,
     * 'group' if the user is a group admin for the provided groupId,
     * or null otherwise.
     */
    async getAdminLevel(userId, groupId) {
        if (await this.isAuthenticated(userId))
            return 'global';
        if (groupId && (await this.isGroupAdmin(userId, groupId)))
            return 'group';
        return null;
    }
}
exports.AdminRepository = AdminRepository;
class AdminVerificationCodeRepository {
    constructor(db) {
        this.db = db;
    }
    async addCode(code) {
        await run(this.db, 'INSERT OR IGNORE INTO admin_verification_codes(code) VALUES (?)', [code]);
    }
    async listAvailableCodes(limit = 10) {
        const rows = await all(this.db, 'SELECT code FROM admin_verification_codes WHERE consumed_by IS NULL ORDER BY created_at DESC LIMIT ?', [limit]);
        return rows.map((row) => String(row.code));
    }
    async consumeIfValid(code, consumedBy) {
        const row = await get(this.db, 'SELECT code FROM admin_verification_codes WHERE code = ? AND consumed_by IS NULL', [code]);
        if (!row)
            return false;
        await run(this.db, 'UPDATE admin_verification_codes SET consumed_by = ?, consumed_at = CURRENT_TIMESTAMP WHERE code = ?', [consumedBy, code]);
        return true;
    }
}
exports.AdminVerificationCodeRepository = AdminVerificationCodeRepository;
class UserModerationRepository {
    constructor(db) {
        this.db = db;
    }
    async getOrCreate(userId) {
        const existing = await this.getByUser(userId);
        if (existing)
            return existing;
        await run(this.db, 'INSERT OR IGNORE INTO user_moderation_state(user_id, updated_at) VALUES (?, CURRENT_TIMESTAMP)', [userId]);
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
    async save(state) {
        await run(this.db, `INSERT INTO user_moderation_state(
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
         updated_at=CURRENT_TIMESTAMP`, [
            state.user_id,
            state.warning_count,
            state.suspension_count_week,
            state.first_week_suspension_at ? state.first_week_suspension_at.toISOString() : null,
            state.temp_ban_until ? state.temp_ban_until.toISOString() : null,
            state.week_ban_until ? state.week_ban_until.toISOString() : null,
            state.last_offense_at ? state.last_offense_at.toISOString() : null,
        ]);
    }
    async listCurrentlyBanned(now, limit = 50) {
        const rows = await all(this.db, `SELECT m.id, m.user_id, p.name, m.temp_ban_until, m.week_ban_until
       FROM user_moderation_state m
       LEFT JOIN user_profiles p ON p.user_id = m.user_id
       WHERE (m.temp_ban_until IS NOT NULL AND m.temp_ban_until > ?)
          OR (m.week_ban_until IS NOT NULL AND m.week_ban_until > ?)
       ORDER BY COALESCE(m.week_ban_until, m.temp_ban_until) DESC
       LIMIT ?`, [now.toISOString(), now.toISOString(), limit]);
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
            };
        });
    }
    async unblockById(id) {
        const result = await run(this.db, `UPDATE user_moderation_state
       SET warning_count = 0,
           suspension_count_week = 0,
           first_week_suspension_at = NULL,
           temp_ban_until = NULL,
           week_ban_until = NULL,
           last_offense_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [id]);
        return result.changes > 0;
    }
    async getByUser(userId) {
        const row = await get(this.db, 'SELECT * FROM user_moderation_state WHERE user_id = ?', [userId]);
        if (!row)
            return null;
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
exports.UserModerationRepository = UserModerationRepository;
class SchedulerRunRepository {
    constructor(db) {
        this.db = db;
    }
    async log(jobName, status, message) {
        await run(this.db, 'INSERT INTO scheduler_runs(job_name, status, message) VALUES (?, ?, ?)', [jobName, status, message]);
    }
}
exports.SchedulerRunRepository = SchedulerRunRepository;
class DailyGreetingRepository {
    constructor(db) {
        this.db = db;
    }
    async hasGreeted(userId, date) {
        const keyDate = date.toISOString().slice(0, 10);
        const row = await get(this.db, 'SELECT user_id FROM user_daily_greetings WHERE user_id = ? AND greeting_date = ? LIMIT 1', [userId, keyDate]);
        return !!row;
    }
    async markGreeted(userId, date) {
        const keyDate = date.toISOString().slice(0, 10);
        await run(this.db, 'INSERT OR IGNORE INTO user_daily_greetings(user_id, greeting_date) VALUES (?, ?)', [userId, keyDate]);
    }
}
exports.DailyGreetingRepository = DailyGreetingRepository;
class OutboxDedupRepository {
    constructor(db) {
        this.db = db;
    }
    async markIfNew(messageKey) {
        const result = await run(this.db, 'INSERT OR IGNORE INTO outbox_dedup(message_key) VALUES (?)', [messageKey]);
        return result.changes > 0;
    }
    async deleteOlderThan(days) {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const result = await run(this.db, 'DELETE FROM outbox_dedup WHERE created_at < ?', [cutoff]);
        return result.changes;
    }
}
exports.OutboxDedupRepository = OutboxDedupRepository;
// PHASE 3: Group Memberships
class GroupMembershipRepository {
    constructor(db) {
        this.db = db;
    }
    async addMembership(groupId, userId, role = 'member') {
        const result = await run(this.db, `INSERT INTO group_memberships(group_id, user_id, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, group_id) DO UPDATE SET role = excluded.role, is_active = 1, updated_at = CURRENT_TIMESTAMP`, [groupId, userId, role]);
        return result.lastID;
    }
    async removeMembership(groupId, userId) {
        const result = await run(this.db, 'DELETE FROM group_memberships WHERE group_id = ? AND user_id = ?', [groupId, userId]);
        return result.changes > 0;
    }
    async listByGroup(groupId) {
        const rows = await all(this.db, 'SELECT user_id, role, is_active FROM group_memberships WHERE group_id = ? ORDER BY created_at ASC', [groupId]);
        return rows.map((r) => ({ user_id: String(r.user_id), role: String(r.role), is_active: Number(r.is_active) === 1 }));
    }
    async listByUser(userId) {
        const rows = await all(this.db, 'SELECT group_id, role, is_active FROM group_memberships WHERE user_id = ? ORDER BY created_at ASC', [userId]);
        return rows.map((r) => ({ group_id: String(r.group_id), role: String(r.role), is_active: Number(r.is_active) === 1 }));
    }
    async getMembership(groupId, userId) {
        const row = await get(this.db, 'SELECT user_id, role, is_active FROM group_memberships WHERE group_id = ? AND user_id = ? LIMIT 1', [groupId, userId]);
        if (!row)
            return null;
        return { user_id: String(row.user_id), role: String(row.role), is_active: Number(row.is_active) === 1 };
    }
    async setRole(groupId, userId, role) {
        await run(this.db, 'UPDATE group_memberships SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ? AND user_id = ?', [role, groupId, userId]);
    }
    async isMember(groupId, userId) {
        const row = await get(this.db, 'SELECT 1 FROM group_memberships WHERE group_id = ? AND user_id = ? AND is_active = 1 LIMIT 1', [groupId, userId]);
        return !!row;
    }
}
exports.GroupMembershipRepository = GroupMembershipRepository;
function rowToReminder(row) {
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
function rowToNotice(row) {
    const parseLocalDate = (value) => {
        if (!value)
            return undefined;
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
function rowToExam(row) {
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
        tipoDisponibilidad: row.tipo_disponibilidad ? String(row.tipo_disponibilidad) : 'hora-especifica',
        horaInicio: row.hora_inicio ? String(row.hora_inicio) : undefined,
        horaFin: row.hora_fin ? String(row.hora_fin) : undefined,
        frecuenciaAvisos: row.frecuencia_avisos ? String(row.frecuencia_avisos) : '7d,3d,1d,20m',
        exam_commission_id: row.exam_commission_id ? Number(row.exam_commission_id) : undefined,
        ultimoAvisoEnviado,
    };
}
function formatLocalDateOnly(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function formatLocalTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}
function getReminderDateTime(reminder) {
    return new Date(reminder.event_date.getFullYear(), reminder.event_date.getMonth(), reminder.event_date.getDate());
}
function getReminderEndOfDay(reminder) {
    return new Date(reminder.event_date.getFullYear(), reminder.event_date.getMonth(), reminder.event_date.getDate(), 23, 59, 59, 999);
}
function getExamDateTime(exam) {
    const [hours, minutes] = String(exam.exam_time || '00:00').split(':').map(Number);
    return new Date(exam.exam_date.getFullYear(), exam.exam_date.getMonth(), exam.exam_date.getDate(), hours || 0, minutes || 0, 0, 0);
}
class ManagedClassRepository {
    constructor(db) {
        this.db = db;
    }
    async create(classData) {
        const result = await run(this.db, `INSERT INTO managed_classes(subject, schedule_day, schedule_time, meet_link, notifications_enabled, commission_count)
       VALUES (?, ?, ?, ?, ?, ?)`, [
            classData.subject,
            classData.schedule_day,
            classData.schedule_time,
            classData.meet_link,
            classData.notifications_enabled ? 1 : 0,
            classData.commission_count ?? 1,
        ]);
        return result.lastID;
    }
    async listAll() {
        const rows = await all(this.db, `SELECT * FROM managed_classes ORDER BY schedule_day, schedule_time`);
        return rows.map(rowToManagedClass);
    }
    async listWithIds() {
        const rows = await all(this.db, `SELECT * FROM managed_classes ORDER BY schedule_day, schedule_time`);
        return rows.map((row) => ({ id: Number(row.id), managedClass: rowToManagedClass(row) }));
    }
    async getById(id) {
        const row = await get(this.db, `SELECT * FROM managed_classes WHERE id = ?`, [id]);
        return row ? rowToManagedClass(row) : null;
    }
    async listByDay(day) {
        const rows = await all(this.db, `SELECT * FROM managed_classes WHERE lower(schedule_day) = lower(?) AND notifications_enabled = 1 ORDER BY schedule_time`, [day]);
        return rows.map(rowToManagedClass);
    }
    async setNotificationsEnabled(id, enabled) {
        await run(this.db, `UPDATE managed_classes SET notifications_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [enabled ? 1 : 0, id]);
    }
    async updateSubject(id, newSubject) {
        await run(this.db, `UPDATE managed_classes SET subject = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
            newSubject,
            id,
        ]);
    }
    async delete(id) {
        const result = await run(this.db, `DELETE FROM managed_classes WHERE id = ?`, [id]);
        return result.changes > 0;
    }
    async getDistinctCommissionCounts() {
        const rows = await all(this.db, 'SELECT DISTINCT commission_count FROM managed_classes WHERE commission_count > 0 ORDER BY commission_count');
        return rows.map((r) => Number(r.commission_count)).filter((n) => n > 0);
    }
}
exports.ManagedClassRepository = ManagedClassRepository;
class ClassNotificationRepository {
    constructor(db) {
        this.db = db;
    }
    async recordNotificationSent(managedClassId, minutesBefore) {
        const result = await run(this.db, `INSERT INTO class_notifications(managed_class_id, notification_sent_at, minutes_before)
       VALUES (?, CURRENT_TIMESTAMP, ?)`, [managedClassId, minutesBefore]);
        return result.lastID;
    }
    async getLastNotificationBefore(managedClassId, minutesBefore) {
        const row = await get(this.db, `SELECT notification_sent_at FROM class_notifications 
       WHERE managed_class_id = ? AND minutes_before = ? 
       ORDER BY notification_sent_at DESC LIMIT 1`, [managedClassId, minutesBefore]);
        return row ? new Date(String(row.notification_sent_at)) : null;
    }
}
exports.ClassNotificationRepository = ClassNotificationRepository;
function rowToManagedClass(row) {
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
class ManagedTeacherRepository {
    constructor(db) {
        this.db = db;
    }
    async create(teacher) {
        const result = await run(this.db, `INSERT INTO managed_teachers(name, email, subject) VALUES (?, ?, ?)`, [teacher.name, teacher.email, teacher.subject ?? null]);
        return result.lastID;
    }
    async listAll() {
        const rows = await all(this.db, `SELECT * FROM managed_teachers ORDER BY subject ASC, name ASC`);
        return rows.map(rowToTeacher);
    }
    async listWithIds(limit = 50) {
        const rows = await all(this.db, `SELECT * FROM managed_teachers ORDER BY subject ASC, name ASC LIMIT ?`, [limit]);
        return rows.map((row) => ({ id: Number(row.id), teacher: rowToTeacher(row) }));
    }
    async delete(teacherId) {
        await run(this.db, `DELETE FROM managed_teachers WHERE id = ?`, [teacherId]);
    }
    async getById(teacherId) {
        const row = await get(this.db, `SELECT * FROM managed_teachers WHERE id = ?`, [teacherId]);
        return row ? rowToTeacher(row) : null;
    }
    async update(teacherId, teacher) {
        const updates = [];
        const params = [];
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
        if (updates.length === 0)
            return;
        params.push(teacherId);
        await run(this.db, `UPDATE managed_teachers SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    }
}
exports.ManagedTeacherRepository = ManagedTeacherRepository;
// PHASE 1: Multi-tenant Groups Repository
class GroupRepository {
    constructor(db) {
        this.db = db;
    }
    /**
     * Register a new WhatsApp group or update if already exists
     */
    async register(groupId, displayName, addedBy) {
        const result = await run(this.db, `INSERT INTO whatsapp_groups(group_id, display_name, is_active, added_by, updated_at)
         VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(group_id) DO UPDATE SET is_active=1, updated_at=CURRENT_TIMESTAMP`, [groupId, displayName ?? null, addedBy ?? null]);
        // Para conflictos, traer el id existente
        const existing = await get(this.db, 'SELECT id FROM whatsapp_groups WHERE group_id = ?', [groupId]);
        return existing ? Number(existing.id) : result.lastID;
    }
    /**
     * Get a group by its ID
     */
    async findById(id) {
        const row = await get(this.db, 'SELECT * FROM whatsapp_groups WHERE id = ?', [id]);
        return row ? rowToWhatsAppGroup(row) : null;
    }
    /**
     * Find a group by its WhatsApp JID
     */
    async findByGroupId(groupId) {
        const row = await get(this.db, 'SELECT * FROM whatsapp_groups WHERE group_id = ?', [groupId]);
        return row ? rowToWhatsAppGroup(row) : null;
    }
    /**
     * Get all registered groups (active and inactive)
     */
    async findAll() {
        const rows = await all(this.db, 'SELECT * FROM whatsapp_groups ORDER BY created_at DESC');
        return rows.map(rowToWhatsAppGroup);
    }
    /**
     * Get all active group IDs for gateway allowlist
     */
    async getAllActiveIds() {
        const rows = await all(this.db, 'SELECT group_id FROM whatsapp_groups WHERE is_active = 1 ORDER BY created_at ASC');
        return rows.map((r) => String(r.group_id));
    }
    /**
     * Activate or deactivate a group
     */
    async setActive(groupId, isActive) {
        await run(this.db, 'UPDATE whatsapp_groups SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?', [
            isActive ? 1 : 0,
            groupId,
        ]);
    }
    /**
     * Update the entry_year for a whatsapp group. Use null for general groups.
     */
    async updateEntryYear(groupId, entryYear) {
        await run(this.db, 'UPDATE whatsapp_groups SET entry_year = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?', [
            entryYear === null ? null : entryYear,
            groupId,
        ]);
    }
    /**
     * Delete a group (hard delete - use setActive(false) to soft delete instead)
     */
    async delete(groupId) {
        const result = await run(this.db, 'DELETE FROM whatsapp_groups WHERE group_id = ?', [groupId]);
        return result.changes > 0;
    }
    /**
     * Check if a group is registered and active
     */
    async isActive(groupId) {
        const row = await get(this.db, 'SELECT is_active FROM whatsapp_groups WHERE group_id = ?', [groupId]);
        return !!row && Number(row.is_active) === 1;
    }
    /**
     * Get count of active groups
     */
    async getActiveCount() {
        const row = await get(this.db, 'SELECT COUNT(*) as count FROM whatsapp_groups WHERE is_active = 1');
        return Number(row?.count ?? 0);
    }
}
exports.GroupRepository = GroupRepository;
// PHASE 2: Commissions Repository
class CommissionRepository {
    constructor(db) {
        this.db = db;
    }
    /**
     * Create or get a commission
     */
    async createOrGet(name, year, shift) {
        // Try to find existing
        let row = await get(this.db, 'SELECT id FROM commissions WHERE name = ? AND year IS ? AND shift IS ?', [name, year ?? null, shift ?? null]);
        if (row)
            return Number(row.id);
        // Create new
        const result = await run(this.db, 'INSERT INTO commissions(name, year, shift) VALUES (?, ?, ?)', [name, year ?? null, shift ?? null]);
        return result.lastID;
    }
    /**
     * Get commission by ID
     */
    async getById(id) {
        const row = await get(this.db, 'SELECT * FROM commissions WHERE id = ?', [id]);
        return row ? rowToCommission(row) : null;
    }
    /**
     * List all commissions for a given year
     */
    async listByYear(year) {
        const rows = await all(this.db, 'SELECT * FROM commissions WHERE year = ? ORDER BY shift, name', [year]);
        return rows.map(rowToCommission);
    }
    /**
     * List all commissions
     */
    async findAll() {
        const rows = await all(this.db, 'SELECT * FROM commissions ORDER BY year DESC, shift, name');
        return rows.map(rowToCommission);
    }
    /**
     * Delete a commission
     */
    async delete(id) {
        const result = await run(this.db, 'DELETE FROM commissions WHERE id = ?', [id]);
        return result.changes > 0;
    }
    /**
     * Get distinct years
     */
    async getDistinctYears() {
        const rows = await all(this.db, 'SELECT DISTINCT year FROM commissions WHERE year IS NOT NULL ORDER BY year DESC');
        return rows.map((r) => Number(r.year));
    }
}
exports.CommissionRepository = CommissionRepository;
// PHASE 2: Group Context Repository
class GroupContextRepository {
    constructor(db) {
        this.db = db;
    }
    /**
     * Create or update group context
     */
    async upsert(groupId, year, commissionId, label, configuredBy) {
        const existing = await get(this.db, 'SELECT id FROM group_context WHERE group_id = ?', [groupId]);
        if (existing) {
            // Update
            await run(this.db, `UPDATE group_context SET year = ?, commission_id = ?, label = ?, configured_by = ?, updated_at = CURRENT_TIMESTAMP
           WHERE group_id = ?`, [year, commissionId ?? null, label ?? null, configuredBy ?? null, groupId]);
            return Number(existing.id);
        }
        else {
            // Create
            const result = await run(this.db, `INSERT INTO group_context(group_id, year, commission_id, label, configured_by)
           VALUES (?, ?, ?, ?, ?)`, [groupId, year, commissionId ?? null, label ?? null, configuredBy ?? null]);
            return result.lastID;
        }
    }
    /**
     * Get context by group ID
     */
    async getByGroupId(groupId) {
        const row = await get(this.db, 'SELECT * FROM group_context WHERE group_id = ?', [groupId]);
        return row ? rowToGroupContext(row) : null;
    }
    /**
     * Get all contexts
     */
    async findAll() {
        const rows = await all(this.db, 'SELECT * FROM group_context ORDER BY created_at DESC');
        return rows.map(rowToGroupContext);
    }
    /**
     * Get contexts by commission
     */
    async getByCommissionId(commissionId) {
        const rows = await all(this.db, 'SELECT * FROM group_context WHERE commission_id = ?', [commissionId]);
        return rows.map(rowToGroupContext);
    }
    /**
     * Get contexts by year
     */
    async getByYear(year) {
        const rows = await all(this.db, 'SELECT * FROM group_context WHERE year = ?', [year]);
        return rows.map(rowToGroupContext);
    }
    /**
     * Delete context
     */
    async delete(groupId) {
        const result = await run(this.db, 'DELETE FROM group_context WHERE group_id = ?', [groupId]);
        return result.changes > 0;
    }
}
exports.GroupContextRepository = GroupContextRepository;
// PHASE 3: ClassCommissionSchedule Repository
class ClassCommissionScheduleRepository {
    constructor(db) {
        this.db = db;
    }
    async create(entry) {
        const result = await run(this.db, `INSERT INTO class_commission_schedule(managed_class_id, commission_id, schedule_day, schedule_time, meet_link)
         VALUES (?, ?, ?, ?, ?)`, [entry.managed_class_id, entry.commission_id, entry.schedule_day, entry.schedule_time, entry.meet_link ?? null]);
        return result.lastID;
    }
    async listByCommissionAndDay(commissionId, day) {
        const rows = await all(this.db, `SELECT * FROM class_commission_schedule WHERE commission_id = ? AND lower(schedule_day) = lower(?) ORDER BY schedule_time`, [commissionId, day]);
        return rows.map(rowToClassCommissionSchedule);
    }
    async listByDay(day) {
        const rows = await all(this.db, `SELECT * FROM class_commission_schedule WHERE lower(schedule_day) = lower(?) ORDER BY schedule_time`, [day]);
        return rows.map(rowToClassCommissionSchedule);
    }
    async listByManagedClass(managedClassId) {
        const rows = await all(this.db, `SELECT * FROM class_commission_schedule WHERE managed_class_id = ? ORDER BY schedule_day, schedule_time`, [managedClassId]);
        return rows.map(rowToClassCommissionSchedule);
    }
    async delete(id) {
        const result = await run(this.db, 'DELETE FROM class_commission_schedule WHERE id = ?', [id]);
        return result.changes > 0;
    }
}
exports.ClassCommissionScheduleRepository = ClassCommissionScheduleRepository;
function rowToClassCommissionSchedule(row) {
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
function rowToCommission(row) {
    return {
        id: Number(row.id),
        name: String(row.name),
        year: row.year ? Number(row.year) : undefined,
        shift: row.shift ? String(row.shift) : undefined,
        created_at: row.created_at ? new Date(String(row.created_at)) : undefined,
        updated_at: row.updated_at ? new Date(String(row.updated_at)) : undefined,
    };
}
function rowToGroupContext(row) {
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
function rowToWhatsAppGroup(row) {
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
function rowToTeacher(row) {
    return {
        id: Number(row.id),
        name: String(row.name),
        email: String(row.email),
        subject: row.subject ? String(row.subject) : undefined,
        created_at: row.created_at ? new Date(String(row.created_at)) : undefined,
        updated_at: row.updated_at ? new Date(String(row.updated_at)) : undefined,
    };
}
