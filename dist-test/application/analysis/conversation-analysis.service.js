"use strict";
/**
 * Servicio de análisis de patrones de conversación
 * Detecta comportamientos sospechosos, ciclos de infracciones, etc.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationAnalysisService = void 0;
class ConversationAnalysisService {
    constructor() {
        this.patterns = new Map();
        this.ANALYSIS_WINDOW = 24 * 60 * 60 * 1000; // 24 horas
        this.INACTIVITY_THRESHOLD = 30 * 60 * 1000; // 30 minutos
    }
    /**
     * Registra un mensaje para análisis
     */
    recordMessage(userId, message, hasInfraction = false, now = new Date()) {
        let pattern = this.patterns.get(userId);
        if (!pattern) {
            pattern = {
                userId,
                messageCount: 0,
                averageLength: 0,
                infractions: 0,
                lastMessageTime: now,
                isActive: true,
                suspicionScore: 0,
            };
            this.patterns.set(userId, pattern);
        }
        // Actualizar estadísticas
        pattern.messageCount++;
        pattern.averageLength = (pattern.averageLength * (pattern.messageCount - 1) + message.length) / pattern.messageCount;
        pattern.lastMessageTime = now;
        pattern.isActive = true;
        if (hasInfraction) {
            pattern.infractions++;
        }
        // Calcular puntuación de sospecha
        pattern.suspicionScore = this.calculateSuspicionScore(pattern);
        return pattern;
    }
    /**
     * Calcula puntuación de sospecha para un usuario
     */
    calculateSuspicionScore(pattern) {
        let score = 0;
        // Puntuación por infracciones (máximo 50)
        score += Math.min(pattern.infractions * 15, 50);
        // Puntuación por frecuencia de mensajes (máximo 30)
        if (pattern.messageCount > 50) {
            score += 30;
        }
        else if (pattern.messageCount > 20) {
            score += 15;
        }
        // Puntuación por longitud promedio (muy cortos o muy largos son sospechosos)
        if (pattern.averageLength < 5 || pattern.averageLength > 500) {
            score += 20;
        }
        return Math.min(score, 100);
    }
    /**
     * Obtiene usuarios con alta sospecha
     */
    getSuspiciousUsers(threshold = 70) {
        return Array.from(this.patterns.values()).filter(p => p.suspicionScore >= threshold);
    }
    /**
     * Detecta si un usuario está en un ciclo de infracciones
     */
    isInInfractionCycle(userId, infractionThreshold = 3) {
        const pattern = this.patterns.get(userId);
        if (!pattern)
            return false;
        return pattern.infractions >= infractionThreshold && pattern.messageCount > 10;
    }
    /**
     * Limpia patrones inactivos
     */
    cleanupInactivePatterns(now = new Date()) {
        for (const [userId, pattern] of this.patterns.entries()) {
            if (now.getTime() - pattern.lastMessageTime.getTime() > this.ANALYSIS_WINDOW) {
                this.patterns.delete(userId);
            }
        }
    }
    /**
     * Genera reporte de conversación
     */
    generateConversationReport(userId) {
        const pattern = this.patterns.get(userId);
        if (!pattern) {
            return `No hay datos de conversación para ${userId}`;
        }
        const riskLevel = pattern.suspicionScore >= 70 ? '🔴 Alto' : pattern.suspicionScore >= 40 ? '🟡 Medio' : '🟢 Bajo';
        return `📊 *Análisis de Conversación*\n\nUsuario: ${userId}\n\n📈 Estadísticas:\n• Mensajes: ${pattern.messageCount}\n• Promedio por mensaje: ${pattern.averageLength.toFixed(1)} caracteres\n• Infracciones: ${pattern.infractions}\n• Puntuación de sospecha: ${pattern.suspicionScore}/100\n• Riesgo: ${riskLevel}`;
    }
    /**
     * Obtiene el patrón de un usuario
     */
    getPattern(userId) {
        return this.patterns.get(userId);
    }
    /**
     * Calcula estadísticas generales
     */
    getGeneralStats() {
        const patterns = Array.from(this.patterns.values());
        const totalMessages = patterns.reduce((sum, p) => sum + p.messageCount, 0);
        const totalInfractions = patterns.reduce((sum, p) => sum + p.infractions, 0);
        const highRiskUsers = patterns.filter(p => p.suspicionScore >= 70).length;
        return {
            totalUsers: patterns.length,
            totalMessages,
            averageInfractions: patterns.length > 0 ? totalInfractions / patterns.length : 0,
            highRiskUsers,
        };
    }
}
exports.ConversationAnalysisService = ConversationAnalysisService;
