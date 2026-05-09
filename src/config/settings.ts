import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface Settings {
  timezone: string;
  sqlitePath: string;
  adminPassword: string;
  adminSeedCodes: string;
  /** Lista de hasta N grupos autorizados (máximo 2 por defecto). */
  whatsappGroupIds: string[];
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

function parseGroupIds(): string[] {
  // Opción 1: lista separada por coma en WHATSAPP_GROUP_IDS
  const multiEnv = process.env.WHATSAPP_GROUP_IDS || '';
  if (multiEnv.trim()) {
    return multiEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  // Opción 2: dos variables individuales como fallback
  const ids: string[] = [];
  const g1 = process.env.WHATSAPP_GROUP_ID || process.env.GROUP_ID || '';
  const g2 = process.env.WHATSAPP_GROUP_ID_2 || '';
  if (g1.trim()) ids.push(g1.trim());
  if (g2.trim()) ids.push(g2.trim());
  return ids;
}

export function getSettings(): Settings {
  return {
    timezone: process.env.TIMEZONE || 'America/Argentina/Cordoba',
    sqlitePath: process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'chatbot.db'),
    adminPassword: process.env.ADMIN_PASSWORD || '',
    adminSeedCodes: process.env.ADMIN_SEED_CODES || '',
    whatsappGroupIds: parseGroupIds(),
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
