import sqlite3 from 'sqlite3';
import { run, get, all } from '../../shared/db/db-utils.js';
import { UserModerationState, BannedUserView } from './moderation.models.js';

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
