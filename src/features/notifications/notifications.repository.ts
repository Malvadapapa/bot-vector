import sqlite3 from 'sqlite3';
import { InstitutionalNotice } from './notifications.models.js';
import { run, get, all } from '../../shared/db/db-utils.js';

export class InstitutionalNoticeRepository {
  constructor(private db: sqlite3.Database) {}

  async createIfNew(notice: InstitutionalNotice): Promise<boolean> {
    try {
      await run(
        this.db,
        `INSERT INTO institutional_notices(title, body, start_date, end_date, event_time, source_email, unique_hash, frecuencia, grupo_selector)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          notice.title,
          notice.body,
          notice.start_date ? notice.start_date.toISOString().slice(0, 10) : null,
          notice.end_date ? notice.end_date.toISOString().slice(0, 10) : null,
          notice.event_time ?? null,
          notice.source_email ?? null,
          notice.unique_hash,
          notice.frecuencia ?? 'unica',
          notice.grupo_selector ?? 'todos',
        ]
      );
      return true;
    } catch {
      return false;
    }
  }

  async getByUniqueHash(uniqueHash: string): Promise<InstitutionalNotice | null> {
    const row = await get<any>(this.db, 'SELECT * FROM institutional_notices WHERE unique_hash = ? LIMIT 1', [uniqueHash]);
    if (!row) return null;
    return rowToNotice(row);
  }

  async getByUniqueHashWithId(uniqueHash: string): Promise<{ id: number; notice: InstitutionalNotice } | null> {
    const row = await get<any>(this.db, 'SELECT * FROM institutional_notices WHERE unique_hash = ? LIMIT 1', [uniqueHash]);
    if (!row) return null;
    return { id: Number(row.id), notice: rowToNotice(row) };
  }

  async markConfirmed(id: number): Promise<void> {
    await run(this.db, 'UPDATE institutional_notices SET confirmed_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
  }

  async markPublished(id: number): Promise<void> {
    await run(this.db, 'UPDATE institutional_notices SET published_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
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
    grupo_selector: row.grupo_selector ? String(row.grupo_selector) : undefined,
    frecuencia: row.frecuencia ? String(row.frecuencia) : undefined,
    published_at: row.published_at ? new Date(String(row.published_at)) : undefined,
    confirmed_at: row.confirmed_at ? new Date(String(row.confirmed_at)) : undefined,
  };
}

export class InboundEmailRejectionRepository {
  constructor(private db: sqlite3.Database) {}

  async markIfNew(fingerprint: string, sender: string, subject: string): Promise<boolean> {
    try {
      await run(
        this.db,
        `INSERT INTO inbound_email_rejections(fingerprint, sender, subject) VALUES (?, ?, ?)`,
        [fingerprint, sender, subject || null]
      );
      return true;
    } catch {
      return false;
    }
  }

  async exists(fingerprint: string): Promise<boolean> {
    const row = await get<any>(
      this.db,
      'SELECT id FROM inbound_email_rejections WHERE fingerprint = ? LIMIT 1',
      [fingerprint]
    );
    return !!row;
  }
}

