import sqlite3 from 'sqlite3';
import { run, get } from '../../shared/db/db-utils.js';

export interface OnboardingToken {
  token: string;
  group_id: string;
  expires_at: string;
  created_at?: string;
}

export class OnboardingTokenRepository {
  constructor(private db: sqlite3.Database) {}

  async createToken(groupId: string, token: string, expiresAt: Date): Promise<void> {
    // Si ya existe un token para este grupo, lo pisamos con el nuevo token (ON CONFLICT DO UPDATE)
    await run(
      this.db,
      `INSERT INTO onboarding_tokens (token, group_id, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(group_id) DO UPDATE SET
         token = excluded.token,
         expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP`,
      [token, groupId, expiresAt.toISOString()]
    );
  }

  async getByToken(token: string): Promise<OnboardingToken | null> {
    const row = await get<any>(
      this.db,
      'SELECT token, group_id, expires_at, created_at FROM onboarding_tokens WHERE token = ?',
      [token]
    );
    if (!row) return null;
    return {
      token: String(row.token),
      group_id: String(row.group_id),
      expires_at: String(row.expires_at),
      created_at: String(row.created_at || ''),
    };
  }

  async validateToken(token: string, now = new Date()): Promise<string | null> {
    const tokenData = await this.getByToken(token);
    if (!tokenData) return null;

    const expiresTime = new Date(tokenData.expires_at).getTime();
    if (now.getTime() > expiresTime) {
      await this.deleteToken(token);
      return null;
    }

    return tokenData.group_id;
  }

  async deleteToken(token: string): Promise<void> {
    await run(this.db, 'DELETE FROM onboarding_tokens WHERE token = ?', [token]);
  }

  async deleteExpiredTokens(now = new Date()): Promise<number> {
    const result = await run(
      this.db,
      'DELETE FROM onboarding_tokens WHERE datetime(expires_at) < datetime(?)',
      [now.toISOString()]
    );
    return result.changes;
  }
}
