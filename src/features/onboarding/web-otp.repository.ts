import sqlite3 from 'sqlite3';
import { run, get } from '../../shared/db/db-utils.js';

export interface WebOtpSession {
  email: string;
  code: string;
  user_id: string | null;
  expires_at: string;
  created_at?: string;
}

export class WebOtpRepository {
  constructor(private db: sqlite3.Database) {}

  async createOtp(email: string, code: string, userId: string | null, expiresAt: Date): Promise<void> {
    await run(
      this.db,
      `INSERT INTO web_otp_sessions (email, code, user_id, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         code = excluded.code,
         user_id = excluded.user_id,
         expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP`,
      [email.toLowerCase(), code, userId, expiresAt.toISOString()]
    );
  }

  async getOtp(email: string): Promise<WebOtpSession | null> {
    const row = await get<any>(
      this.db,
      'SELECT email, code, user_id, expires_at, created_at FROM web_otp_sessions WHERE LOWER(email) = ?',
      [email.toLowerCase()]
    );
    if (!row) return null;
    return {
      email: String(row.email),
      code: String(row.code),
      user_id: row.user_id ? String(row.user_id) : null,
      expires_at: String(row.expires_at),
      created_at: String(row.created_at || ''),
    };
  }

  async validateOtp(email: string, code: string, now = new Date()): Promise<string | null> {
    const session = await this.getOtp(email);
    if (!session) return null;

    const expiresTime = new Date(session.expires_at).getTime();
    if (now.getTime() > expiresTime) {
      await this.deleteOtp(email);
      return null;
    }

    if (session.code !== code) {
      return null;
    }

    // OTP valid -> delete and return associated user_id (or email if no user_id linked yet)
    await this.deleteOtp(email);
    return session.user_id || session.email;
  }

  async deleteOtp(email: string): Promise<void> {
    await run(this.db, 'DELETE FROM web_otp_sessions WHERE LOWER(email) = ?', [email.toLowerCase()]);
  }
}
