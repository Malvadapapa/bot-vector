"use strict";
/**
 * Servicio de detección de infracciones para moderación automática
 * Detecta infracciones según las reglas configuradas
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InfractionDetector = void 0;
class InfractionDetector {
    constructor() {
        this.OFFENSIVE_WORDS = [
            'boludo', 'idiota', 'estúpido', 'imbécil', 'pelotudo',
            'negro', 'indio', 'puto', 'puta', 'concha', 'boludo',
            'qlo', 'ctm', 'maricón', 'gay', 'lesbiana', // palabras discriminatorias
        ];
        this.AI_MANIPULATION_PATTERNS = [
            /ignora\s+tus\s+instrucciones/gi,
            /olvida\s+tus\s+reglas/gi,
            /salta\s+protecciones/gi,
            /bypass\s+rules/gi,
            /admin\s+override/gi,
        ];
        this.SQL_INJECTION_PATTERNS = [
            /select\s+\*/gi,
            /insert\s+into/gi,
            /drop\s+table/gi,
            /union\s+select/gi,
            /--\s*$/gm,
            /'\s*or\s*'1'='1/gi,
        ];
        this.AUTOMATION_PATTERNS = [
            /bot\s+script/gi,
            /automation\s+tool/gi,
            /auto\s+sender/gi,
        ];
        this.messagesByUser = new Map();
        this.privateMessagesByUser = new Map();
        this.recentQueriesByUser = new Map();
    }
    /**
     * Verifica si un mensaje contiene infracciones
     */
    detectInfraction(userId, username, message, messageType = 'group') {
        const lowerMessage = message.toLowerCase();
        const now = new Date();
        // Detectar lenguaje ofensivo
        const offensiveWord = this._detectOffensiveLanguage(lowerMessage);
        if (offensiveWord) {
            return {
                userId,
                username,
                type: 'lenguaje-ofensivo',
                severity: 'grave',
                description: `Lenguaje inapropiado detectado: "${offensiveWord}"`,
                timestamp: now,
            };
        }
        // Detectar manipulación de IA
        if (this._detectAIManipulation(lowerMessage)) {
            return {
                userId,
                username,
                type: 'manipulacion-ia',
                severity: 'grave',
                description: 'Intento de manipular instrucciones del bot detectado',
                timestamp: now,
            };
        }
        // Detectar inyección de código
        if (this._detectCodeInjection(lowerMessage)) {
            return {
                userId,
                username,
                type: 'inyeccion',
                severity: 'grave',
                description: 'Intento de inyección de código detectado',
                timestamp: now,
            };
        }
        // Detectar spam en grupo
        if (messageType === 'group') {
            const spamResult = this._detectSpam(userId, message, now);
            if (spamResult)
                return spamResult;
        }
        // Detectar privados excesivos
        if (messageType === 'private') {
            const privateResult = this._detectPrivateSpam(userId, username, now);
            if (privateResult)
                return privateResult;
        }
        // Detectar preguntas repetidas
        const repetitionResult = this._detectRepetition(userId, username, lowerMessage, now);
        if (repetitionResult)
            return repetitionResult;
        // Detectar automatización
        if (this._detectAutomation(lowerMessage)) {
            return {
                userId,
                username,
                type: 'automatizacion',
                severity: 'grave',
                description: 'Posible automatización detectada (script/bot interno)',
                timestamp: now,
            };
        }
        return null;
    }
    _detectOffensiveLanguage(message) {
        for (const word of this.OFFENSIVE_WORDS) {
            if (message.includes(word)) {
                return word;
            }
        }
        return null;
    }
    _detectAIManipulation(message) {
        return this.AI_MANIPULATION_PATTERNS.some(pattern => pattern.test(message));
    }
    _detectCodeInjection(message) {
        return this.SQL_INJECTION_PATTERNS.some(pattern => pattern.test(message));
    }
    _detectSpam(userId, message, now) {
        const messageLength = message.trim().length;
        // Si el mensaje es muy corto y sin sentido (solo caracteres repetidos)
        if (messageLength < 10 && /^(.)\1{4,}$/.test(message)) {
            const existing = this.messagesByUser.get(userId);
            if (existing && now.getTime() - existing.timestamp.getTime() < 300000) { // 5 minutos
                existing.count++;
                if (existing.count >= 3) {
                    return {
                        userId,
                        username: '',
                        type: 'spam',
                        severity: 'leve',
                        description: `Spam detectado: ${existing.count} mensajes sin sentido en 5 minutos`,
                        timestamp: now,
                    };
                }
            }
            else {
                this.messagesByUser.set(userId, { timestamp: now, count: 1 });
            }
        }
        return null;
    }
    _detectPrivateSpam(userId, username, now) {
        const privateMessages = this.privateMessagesByUser.get(userId) || { timestamps: [] };
        // Limpiar timestamps antiguos (> 1 hora)
        privateMessages.timestamps = privateMessages.timestamps.filter(ts => now.getTime() - ts.getTime() < 3600000 // 1 hora
        );
        privateMessages.timestamps.push(now);
        this.privateMessagesByUser.set(userId, privateMessages);
        // Si hay más de 5 mensajes privados en 1 hora
        if (privateMessages.timestamps.length > 5) {
            return {
                userId,
                username,
                type: 'privados-excesivos',
                severity: 'moderada',
                description: `Demasiados mensajes privados: ${privateMessages.timestamps.length} en 1 hora`,
                timestamp: now,
            };
        }
        return null;
    }
    _detectRepetition(userId, username, message, now) {
        const recentQueries = this.recentQueriesByUser.get(userId) || [];
        // Limpiar queries antiguas (> 1 día)
        const filteredQueries = recentQueries.filter((q, idx) => {
            const age = idx; // Simplificado
            return age < 10; // Mantener últimas 10
        });
        // Si el mensaje es muy similar a alguno reciente (sin contexto nuevo)
        const isSimilar = filteredQueries.some(q => this._calculateSimilarity(q, message) > 0.85);
        if (isSimilar && filteredQueries.length >= 2) {
            return {
                userId,
                username,
                type: 'preguntas-repetidas',
                severity: 'leve',
                description: 'Pregunta repetida detectada sin contexto nuevo',
                timestamp: now,
            };
        }
        filteredQueries.push(message);
        this.recentQueriesByUser.set(userId, filteredQueries);
        return null;
    }
    _detectAutomation(message) {
        return this.AUTOMATION_PATTERNS.some(pattern => pattern.test(message));
    }
    _calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        if (longer.length === 0)
            return 1.0;
        const editDistance = this._getEditDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }
    _getEditDistance(s1, s2) {
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) {
                    costs[j] = j;
                }
                else if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
            if (i > 0)
                costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    }
    /**
     * Limpia el historial de mensajes (para evitar memory leaks)
     */
    clearOldHistories() {
        const now = new Date();
        const oneHourAgo = now.getTime() - 3600000;
        // Limpiar messagesByUser
        const messagesToDelete = [];
        for (const [userId, data] of this.messagesByUser.entries()) {
            if (data.timestamp.getTime() < oneHourAgo) {
                messagesToDelete.push(userId);
            }
        }
        messagesToDelete.forEach(userId => this.messagesByUser.delete(userId));
        // Limpiar privateMessagesByUser
        const privateToDelete = [];
        for (const [userId, data] of this.privateMessagesByUser.entries()) {
            const hasRecentMessages = data.timestamps.some(ts => ts.getTime() > oneHourAgo);
            if (!hasRecentMessages) {
                privateToDelete.push(userId);
            }
        }
        privateToDelete.forEach(userId => this.privateMessagesByUser.delete(userId));
    }
}
exports.InfractionDetector = InfractionDetector;
