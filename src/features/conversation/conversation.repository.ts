import sqlite3 from 'sqlite3';
import { run, get } from '../../shared/db/db-utils.js';
import { PendingConfirmation } from './conversation.models.js';

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
