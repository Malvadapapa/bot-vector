import sqlite3 from 'sqlite3';
import {
  Reminder,
  ReminderCreateInput,
  ManagedExam,
  ManagedClass,
  ManagedClassCreateInput,
  ManagedTeacher,
  ManagedTeacherCreateInput,
  Commission,
  GroupContext,
  CohortConfig,
  ClassCommissionSchedule,
} from './academic-calendar.models.js';
import { run, get, all, formatLocalDateOnly, formatLocalTime } from '../../shared/db/db-utils.js';

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

export class ManagedExamRepository {
  constructor(private db: sqlite3.Database) {}

  async create(exam: ManagedExam): Promise<number> {
    const result = await run(
      this.db,
      `INSERT INTO managed_exams(
         subject, exam_date, exam_time, exam_type, observations, created_by,
         tipo_disponibilidad, hora_inicio, hora_fin, frecuencia_avisos, ultimo_aviso_enviado, exam_commission_id, group_id,
         exam_date_end, aviso_inicio_only, aviso_fin_pre_deadline, created_by_name, created_by_role
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        exam.group_id ?? null,
        exam.exam_date_end ? formatLocalDateOnly(exam.exam_date_end) : null,
        exam.aviso_inicio_only ?? 0,
        exam.aviso_fin_pre_deadline ?? 0,
        exam.created_by_name ?? null,
        exam.created_by_role ?? null,
      ]
    );
    return result.lastID;
  }

  async listUpcoming(fromDate: Date, limit = 50, groupId?: string): Promise<ManagedExam[]> {
    const params: unknown[] = [formatLocalDateOnly(fromDate)];
    let filter = '';
    if (groupId) {
      filter = 'AND group_id = ?';
      params.push(groupId);
    }
    params.push(limit);

    const rows = await all<any>(
      this.db,
      `SELECT * FROM managed_exams WHERE exam_date >= ? ${filter} ORDER BY exam_date ASC LIMIT ?`,
      params
    );
    return rows.map(rowToExam).filter((exam) => getExamDateTime(exam).getTime() >= fromDate.getTime());
  }

  async listWithIds(limit = 50, groupId?: string): Promise<Array<{ id: number; exam: ManagedExam }>> {
    const params: unknown[] = [];
    let filter = '';
    if (groupId) {
      filter = 'WHERE group_id = ?';
      params.push(groupId);
    }
    params.push(limit);

    const rows = await all<any>(
      this.db,
      `SELECT * FROM managed_exams ${filter} ORDER BY exam_date ASC, id ASC LIMIT ?`,
      params
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
    if (data.exam_date_end !== undefined) {
      updates.push('exam_date_end = ?');
      values.push(data.exam_date_end ? formatLocalDateOnly(data.exam_date_end) : null);
    }
    if (data.aviso_inicio_only !== undefined) {
      updates.push('aviso_inicio_only = ?');
      values.push(data.aviso_inicio_only);
    }
    if (data.aviso_fin_pre_deadline !== undefined) {
      updates.push('aviso_fin_pre_deadline = ?');
      values.push(data.aviso_fin_pre_deadline);
    }
    if (data.created_by_name !== undefined) {
      updates.push('created_by_name = ?');
      values.push(data.created_by_name);
    }
    if (data.created_by_role !== undefined) {
      updates.push('created_by_role = ?');
      values.push(data.created_by_role);
    }
    if (data.exam_commission_id !== undefined) {
      updates.push('exam_commission_id = ?');
      values.push(data.exam_commission_id);
    }

    if (updates.length === 0) return;

    values.push(id);
    await run(
      this.db,
      `UPDATE managed_exams SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
  }

  async deleteAllByGroupId(groupId: string): Promise<number> {
    const result = await run(this.db, 'DELETE FROM managed_exams WHERE group_id = ?', [groupId]);
    return result.changes;
  }
}

export class ManagedClassRepository {
  constructor(private db: sqlite3.Database) {}

  async create(classData: ManagedClassCreateInput): Promise<number> {
    const result = await run(
      this.db,
      `INSERT INTO managed_classes(subject, schedule_day, schedule_time, meet_link, notifications_enabled, commission_count, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        classData.subject,
        classData.schedule_day,
        classData.schedule_time,
        classData.meet_link,
        classData.notifications_enabled ? 1 : 0,
        classData.commission_count ?? 1,
        classData.group_id ?? null,
      ]
    );
    return result.lastID;
  }

  async listAll(groupId?: string): Promise<ManagedClass[]> {
    const params: unknown[] = [];
    let filter = '';
    if (groupId) {
      filter = 'WHERE group_id = ?';
      params.push(groupId);
    }
    const rows = await all<any>(this.db, `SELECT * FROM managed_classes ${filter} ORDER BY schedule_day, schedule_time`, params);
    return rows.map(rowToManagedClass);
  }

  async listWithIds(groupId?: string): Promise<Array<{ id: number; managedClass: ManagedClass }>> {
    const params: unknown[] = [];
    let filter = '';
    if (groupId) {
      filter = 'WHERE group_id = ?';
      params.push(groupId);
    }
    const rows = await all<any>(this.db, `SELECT * FROM managed_classes ${filter} ORDER BY schedule_day, schedule_time`, params);
    return rows.map((row) => ({ id: Number(row.id), managedClass: rowToManagedClass(row) }));
  }

  async getById(id: number): Promise<ManagedClass | null> {
    const row = await get<any>(this.db, `SELECT * FROM managed_classes WHERE id = ?`, [id]);
    return row ? rowToManagedClass(row) : null;
  }

  async listByDay(day: string, groupId?: string): Promise<ManagedClass[]> {
    const params: unknown[] = [day];
    let filter = '';
    if (groupId) {
      filter = 'AND group_id = ?';
      params.push(groupId);
    }
    const rows = await all<any>(
      this.db,
      `SELECT * FROM managed_classes WHERE lower(schedule_day) = lower(?) AND notifications_enabled = 1 ${filter} ORDER BY schedule_time`,
      params
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
    await run(this.db, 'DELETE FROM class_commission_schedule WHERE managed_class_id = ?', [id]);
    const result = await run(this.db, `DELETE FROM managed_classes WHERE id = ?`, [id]);
    return result.changes > 0;
  }

  async deleteAllByGroupId(groupId: string): Promise<number> {
    await run(this.db, 'DELETE FROM class_commission_schedule WHERE managed_class_id IN (SELECT id FROM managed_classes WHERE group_id = ?)', [groupId]);
    const result = await run(this.db, 'DELETE FROM managed_classes WHERE group_id = ?', [groupId]);
    return result.changes;
  }

  async getDistinctCommissionCounts(): Promise<number[]> {
    const rows = await all<any>(
      this.db,
      'SELECT DISTINCT commission_count FROM managed_classes WHERE commission_count > 0 ORDER BY commission_count'
    );
    return rows.map((r) => Number(r.commission_count)).filter((n) => n > 0);
  }
}

export class ManagedTeacherRepository {
  constructor(private db: sqlite3.Database) {}

  async create(teacher: ManagedTeacherCreateInput): Promise<number> {
    const result = await run(
      this.db,
      `INSERT INTO managed_teachers(name, email, subject, group_id, commission_id) VALUES (?, ?, ?, ?, ?)`,
      [teacher.name, teacher.email, teacher.subject ?? null, teacher.group_id ?? null, teacher.commission_id ?? null]
    );
    return result.lastID;
  }

  async listAll(groupId?: string): Promise<ManagedTeacher[]> {
    const params: unknown[] = [];
    let filter = '';
    if (groupId) {
      filter = 'WHERE group_id = ?';
      params.push(groupId);
    }
    const rows = await all<any>(
      this.db,
      `SELECT * FROM managed_teachers ${filter} ORDER BY subject ASC, name ASC`,
      params
    );
    return rows.map(rowToTeacher);
  }

  async listWithIds(limit: number = 50, groupId?: string): Promise<Array<{ id: number; teacher: ManagedTeacher }>> {
    const params: unknown[] = [];
    let filter = '';
    if (groupId) {
      filter = 'WHERE group_id = ?';
      params.push(groupId);
    }
    params.push(limit);
    const rows = await all<any>(
      this.db,
      `SELECT * FROM managed_teachers ${filter} ORDER BY subject ASC, name ASC LIMIT ?`,
      params
    );
    return rows.map((row) => ({ id: Number(row.id), teacher: rowToTeacher(row) }));
  }

  async delete(teacherId: number): Promise<void> {
    await run(this.db, `DELETE FROM managed_teachers WHERE id = ?`, [teacherId]);
  }

  async deleteAllByGroupId(groupId: string): Promise<number> {
    const result = await run(this.db, 'DELETE FROM managed_teachers WHERE group_id = ?', [groupId]);
    return result.changes;
  }

  async getById(teacherId: number): Promise<ManagedTeacher | null> {
    const row = await get<any>(this.db, `SELECT * FROM managed_teachers WHERE id = ?`, [teacherId]);
    return row ? rowToTeacher(row) : null;
  }

  async getByEmail(email: string): Promise<ManagedTeacher | null> {
    const row = await get<any>(this.db, `SELECT * FROM managed_teachers WHERE REPLACE(LOWER(email), '.', '') = REPLACE(LOWER(?), '.', '') LIMIT 1`, [email]);
    return row ? rowToTeacher(row) : null;
  }

  async updatePhone(email: string, phone: string): Promise<void> {
    await run(
      this.db,
      `UPDATE managed_teachers SET phone = ?, updated_at = CURRENT_TIMESTAMP WHERE REPLACE(LOWER(email), '.', '') = REPLACE(LOWER(?), '.', '')`,
      [phone, email]
    );
  }

  async listByEmail(email: string): Promise<ManagedTeacher[]> {
    const rows = await all<any>(this.db, `SELECT * FROM managed_teachers WHERE REPLACE(LOWER(email), '.', '') = REPLACE(LOWER(?), '.', '')`, [email]);
    return rows.map(rowToTeacher);
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

export class CommissionRepository {
  constructor(private db: sqlite3.Database) {}

  async createOrGet(name: string, year?: number, shift?: string): Promise<number> {
    let row = await get<any>(
      this.db,
      'SELECT id FROM commissions WHERE name = ? AND year IS ? AND shift IS ?',
      [name, year ?? null, shift ?? null]
    );
    if (row) return Number(row.id);

    const result = await run(
      this.db,
      'INSERT INTO commissions(name, year, shift) VALUES (?, ?, ?)',
      [name, year ?? null, shift ?? null]
    );
    return result.lastID;
  }

  async getById(id: number): Promise<Commission | null> {
    const row = await get<any>(this.db, 'SELECT * FROM commissions WHERE id = ?', [id]);
    return row ? rowToCommission(row) : null;
  }

  async listByYear(year: number): Promise<Commission[]> {
    const rows = await all<any>(
      this.db,
      'SELECT * FROM commissions WHERE year = ? ORDER BY shift, name',
      [year]
    );
    return rows.map(rowToCommission);
  }

  async findAll(): Promise<Commission[]> {
    const rows = await all<any>(this.db, 'SELECT * FROM commissions ORDER BY year DESC, shift, name');
    return rows.map(rowToCommission);
  }

  async delete(id: number): Promise<boolean> {
    const result = await run(this.db, 'DELETE FROM commissions WHERE id = ?', [id]);
    return result.changes > 0;
  }

  async getDistinctYears(): Promise<number[]> {
    const rows = await all<any>(this.db, 'SELECT DISTINCT year FROM commissions WHERE year IS NOT NULL ORDER BY year DESC');
    return rows.map((r) => Number(r.year));
  }
}

export class GroupContextRepository {
  constructor(private db: sqlite3.Database) {}

  async upsert(
    groupId: string,
    year: number,
    commissionId?: number | null,
    label?: string,
    configuredBy?: string
  ): Promise<number> {
    const existing = await get<any>(this.db, 'SELECT id FROM group_context WHERE group_id = ?', [groupId]);

    if (existing) {
      await run(
        this.db,
        `UPDATE group_context SET year = ?, commission_id = ?, label = ?, configured_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE group_id = ?`,
        [year, commissionId ?? null, label ?? null, configuredBy ?? null, groupId]
      );
      return Number(existing.id);
    } else {
      const result = await run(
        this.db,
        `INSERT INTO group_context(group_id, year, commission_id, label, configured_by)
         VALUES (?, ?, ?, ?, ?)`,
        [groupId, year, commissionId ?? null, label ?? null, configuredBy ?? null]
      );
      return result.lastID;
    }
  }

  async getByGroupId(groupId: string): Promise<GroupContext | null> {
    const row = await get<any>(this.db, 'SELECT * FROM group_context WHERE group_id = ?', [groupId]);
    return row ? rowToGroupContext(row) : null;
  }

  async findAll(): Promise<GroupContext[]> {
    const rows = await all<any>(this.db, 'SELECT * FROM group_context ORDER BY created_at DESC');
    return rows.map(rowToGroupContext);
  }

  async getByCommissionId(commissionId: number): Promise<GroupContext[]> {
    const rows = await all<any>(this.db, 'SELECT * FROM group_context WHERE commission_id = ?', [commissionId]);
    return rows.map(rowToGroupContext);
  }

  async getByYear(year: number): Promise<GroupContext[]> {
    const rows = await all<any>(this.db, 'SELECT * FROM group_context WHERE year = ?', [year]);
    return rows.map(rowToGroupContext);
  }

  async setCommissionsForGroupContext(groupContextId: number, commissionIds: number[]): Promise<void> {
    await run(this.db, 'DELETE FROM group_context_commissions WHERE group_context_id = ?', [groupContextId]);

    if (!commissionIds || commissionIds.length === 0) return;

    for (const cid of commissionIds) {
      await run(
        this.db,
        'INSERT OR IGNORE INTO group_context_commissions(group_context_id, commission_id) VALUES (?, ?)',
        [groupContextId, cid]
      );
    }
  }

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

  async removeCommissionsForGroupContext(groupContextId: number, commissionIds?: number[]): Promise<void> {
    if (!commissionIds || commissionIds.length === 0) {
      await run(this.db, 'DELETE FROM group_context_commissions WHERE group_context_id = ?', [groupContextId]);
      return;
    }

    const placeholders = commissionIds.map(() => '?').join(',');
    const params: unknown[] = [groupContextId, ...commissionIds];
    await run(this.db, `DELETE FROM group_context_commissions WHERE group_context_id = ? AND commission_id IN (${placeholders})`, params);
  }

  async delete(groupId: string): Promise<boolean> {
    const result = await run(this.db, 'DELETE FROM group_context WHERE group_id = ?', [groupId]);
    return result.changes > 0;
  }
}

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

  async updateMeetLink(id: number, meetLink: string | null): Promise<boolean> {
    const result = await run(
      this.db,
      'UPDATE class_commission_schedule SET meet_link = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [meetLink, id]
    );
    return result.changes > 0;
  }
}

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
    group_id: row.group_id ? String(row.group_id) : undefined,
    exam_date_end: row.exam_date_end ? new Date(String(row.exam_date_end)) : undefined,
    aviso_inicio_only: row.aviso_inicio_only !== undefined ? Number(row.aviso_inicio_only) : 0,
    aviso_fin_pre_deadline: row.aviso_fin_pre_deadline !== undefined ? Number(row.aviso_fin_pre_deadline) : 0,
    created_by_name: row.created_by_name ? String(row.created_by_name) : undefined,
    created_by_role: row.created_by_role ? String(row.created_by_role) : undefined,
  };
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
    group_id: row.group_id ? String(row.group_id) : undefined,
  };
}

function rowToTeacher(row: any): ManagedTeacher {
  return {
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    subject: row.subject ? String(row.subject) : undefined,
    commission_id: row.commission_id ? Number(row.commission_id) : undefined,
    created_at: row.created_at ? new Date(String(row.created_at)) : undefined,
    updated_at: row.updated_at ? new Date(String(row.updated_at)) : undefined,
    group_id: row.group_id ? String(row.group_id) : undefined,
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
