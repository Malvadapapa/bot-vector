import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface Settings {
  timezone: string;
  sqlitePath: string;
  adminPassword: string;
  adminSeedCodes: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string;
  imapFolder: string;
  geminiApiKey: string;
  geminiModel: string;
  rateLimitResetHour: number;
  rateLimitResetMinute: number;
}

export function getSettings(): Settings {
  return {
    timezone: process.env.TIMEZONE || 'America/Argentina/Cordoba',
    sqlitePath: process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'chatbot.db'),
    adminPassword: process.env.ADMIN_PASSWORD || '',
    adminSeedCodes: process.env.ADMIN_SEED_CODES || '',
    imapHost: process.env.IMAP_HOST || process.env.IMAP_SERVER || '',

    imapPort: Number(process.env.IMAP_PORT || 993),
    imapUser: process.env.IMAP_USER || process.env.EMAIL_USER || '',
    imapPassword: process.env.IMAP_PASSWORD || process.env.EMAIL_PASS || '',
    imapFolder: process.env.IMAP_FOLDER || 'INBOX',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    rateLimitResetHour: Number(process.env.RATE_LIMIT_RESET_HOUR || 0),
    rateLimitResetMinute: Number(process.env.RATE_LIMIT_RESET_MINUTE || 0),
  };
}
