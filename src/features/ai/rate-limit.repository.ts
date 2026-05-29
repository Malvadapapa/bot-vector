import sqlite3 from 'sqlite3';
import { run, get } from '../../shared/db/db-utils.js';
import { RateLimitRecord } from './ai.models.js';

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
