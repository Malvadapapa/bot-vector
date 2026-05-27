"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettings = getSettings;
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function getSettings() {
    return {
        timezone: process.env.TIMEZONE || 'America/Argentina/Cordoba',
        sqlitePath: process.env.SQLITE_PATH || path_1.default.join(process.cwd(), 'data', 'chatbot.db'),
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
