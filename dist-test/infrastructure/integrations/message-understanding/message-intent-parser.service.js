"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageIntentParserService = void 0;
const COMMAND_PREFIX = '!';
const REMINDER_KEYWORDS = [
    'recordatorio',
    'recordarme',
    'recuerdame',
    'examen',
    'parcial',
    'final',
    'entrega',
    'inscripcion',
    'cumpleanos',
    'cumpleaños',
];
const MONTHS = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
};
class MessageIntentParserService {
    parseMessage(rawText, referenceDt) {
        const normalized = this.normalizeText(rawText);
        if (normalized.startsWith(COMMAND_PREFIX)) {
            return {
                intent: 'command',
                normalized_text: normalized,
                keywords: [],
                probable_date: null,
                confidence: 1,
                requires_clarification: false,
                clarification_reason: null,
            };
        }
        const keywords = this.extractKeywords(normalized);
        const probableDate = this.extractProbableDate(normalized, referenceDt);
        if (keywords.length > 0 && !probableDate) {
            return {
                intent: 'create_reminder',
                normalized_text: normalized,
                keywords,
                probable_date: null,
                confidence: 0.55,
                requires_clarification: true,
                clarification_reason: 'No pude detectar una fecha clara para el recordatorio.',
            };
        }
        if (keywords.length > 0 && probableDate) {
            return {
                intent: 'create_reminder',
                normalized_text: normalized,
                keywords,
                probable_date: probableDate,
                confidence: 0.9,
                requires_clarification: false,
                clarification_reason: null,
            };
        }
        return {
            intent: 'ai_query',
            normalized_text: normalized,
            keywords: [],
            probable_date: null,
            confidence: 0.7,
            requires_clarification: false,
            clarification_reason: null,
        };
    }
    extractKeywords(text) {
        return REMINDER_KEYWORDS.filter((k) => text.includes(k));
    }
    extractProbableDate(text, referenceDt) {
        const now = referenceDt ?? new Date();
        const dm = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
        if (dm) {
            const day = Number(dm[1]);
            const month = Number(dm[2]);
            const year = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : now.getFullYear();
            const dt = new Date(year, month - 1, day);
            if (!Number.isNaN(dt.getTime()))
                return dt;
        }
        const byMonthName = text.match(/\b(\d{1,2})\s+de\s+([a-záéíóúñ]+)\b/);
        if (byMonthName) {
            const day = Number(byMonthName[1]);
            const monthName = byMonthName[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const month = MONTHS[monthName];
            if (month) {
                let year = now.getFullYear();
                let dt = new Date(year, month - 1, day);
                if (dt < now)
                    dt = new Date(year + 1, month - 1, day);
                return dt;
            }
        }
        return null;
    }
    normalizeText(rawText) {
        return rawText.trim().toLowerCase().replace(/\s+/g, ' ');
    }
}
exports.MessageIntentParserService = MessageIntentParserService;
