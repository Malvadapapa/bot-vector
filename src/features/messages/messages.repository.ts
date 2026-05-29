import sqlite3 from 'sqlite3';
import { run, get } from '../../shared/db/db-utils.js';

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
