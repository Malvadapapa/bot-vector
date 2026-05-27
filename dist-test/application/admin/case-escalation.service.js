"use strict";
/**
 * Servicio de escalado de casos para moderadores y admins
 * Gestiona situaciones complejas que requieren revisión manual
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseEscalationService = exports.EscalationLevel = void 0;
var EscalationLevel;
(function (EscalationLevel) {
    EscalationLevel["LOW"] = "low";
    EscalationLevel["MEDIUM"] = "medium";
    EscalationLevel["HIGH"] = "high";
    EscalationLevel["CRITICAL"] = "critical";
})(EscalationLevel || (exports.EscalationLevel = EscalationLevel = {}));
class CaseEscalationService {
    constructor() {
        this.cases = new Map();
        this.caseCounter = 0;
    }
    /**
     * Crea un nuevo caso escalado
     */
    createCase(userId, reason, description, level = EscalationLevel.MEDIUM, username) {
        const caseId = `CASE-${++this.caseCounter}`;
        const escalatedCase = {
            id: caseId,
            userId,
            username,
            level,
            reason,
            description,
            createdAt: new Date(),
            status: 'open',
            notes: [],
        };
        this.cases.set(caseId, escalatedCase);
        console.log(`[CaseEscalation] Nuevo caso: ${caseId} - ${reason}`);
        return escalatedCase;
    }
    /**
     * Agrega nota a un caso
     */
    addNote(caseId, note, author) {
        const caseData = this.cases.get(caseId);
        if (!caseData) {
            return false;
        }
        caseData.notes.push(`[${new Date().toLocaleTimeString('es-AR')}] ${author || 'Admin'}: ${note}`);
        return true;
    }
    /**
     * Asigna un caso a un admin
     */
    assignCase(caseId, adminName) {
        const caseData = this.cases.get(caseId);
        if (!caseData) {
            return false;
        }
        caseData.assignedAdmin = adminName;
        caseData.status = 'reviewing';
        return true;
    }
    /**
     * Resuelve un caso
     */
    resolveCase(caseId, action) {
        const caseData = this.cases.get(caseId);
        if (!caseData) {
            return false;
        }
        caseData.status = 'resolved';
        caseData.actionTaken = action;
        return true;
    }
    /**
     * Obtiene casos abiertos
     */
    getOpenCases() {
        return Array.from(this.cases.values()).filter(c => c.status === 'open');
    }
    /**
     * Obtiene casos por usuario
     */
    getCasesByUser(userId) {
        return Array.from(this.cases.values()).filter(c => c.userId === userId);
    }
    /**
     * Obtiene casos por nivel
     */
    getCasesByLevel(level) {
        return Array.from(this.cases.values()).filter(c => c.level === level);
    }
    /**
     * Formatea caso para mostrar en chat
     */
    formatCaseForChat(caseData) {
        const lines = [`📋 *Caso: ${caseData.id}*\n`];
        lines.push(`Usuario: ${caseData.username || caseData.userId}`);
        lines.push(`Nivel: ${this.getLevelEmoji(caseData.level)} ${caseData.level}`);
        lines.push(`Estado: ${caseData.status}`);
        lines.push(`Razón: ${caseData.reason}\n`);
        lines.push(`Descripción: ${caseData.description}\n`);
        if (caseData.assignedAdmin) {
            lines.push(`Asignado a: ${caseData.assignedAdmin}`);
        }
        if (caseData.notes.length > 0) {
            lines.push(`\n📝 Notas:`);
            for (const note of caseData.notes.slice(-5)) {
                lines.push(`  ${note}`);
            }
        }
        if (caseData.actionTaken) {
            lines.push(`\n✅ Acción: ${caseData.actionTaken}`);
        }
        return lines.join('\n');
    }
    /**
     * Obtiene resumen de casos abiertos
     */
    getSummary() {
        const allCases = Array.from(this.cases.values());
        const openCases = allCases.filter(c => c.status === 'open');
        const reviewing = allCases.filter(c => c.status === 'reviewing');
        const critical = allCases.filter(c => c.level === EscalationLevel.CRITICAL && c.status !== 'resolved');
        const lines = ['📊 *Resumen de Casos*\n'];
        lines.push(`Total: ${allCases.length}`);
        lines.push(`Abiertos: ${openCases.length} 🟢`);
        lines.push(`En revisión: ${reviewing.length} 🟡`);
        lines.push(`Críticos: ${critical.length} 🔴`);
        return lines.join('\n');
    }
    getLevelEmoji(level) {
        switch (level) {
            case EscalationLevel.LOW:
                return '🟢';
            case EscalationLevel.MEDIUM:
                return '🟡';
            case EscalationLevel.HIGH:
                return '🟠';
            case EscalationLevel.CRITICAL:
                return '🔴';
        }
    }
    /**
     * Obtiene un caso por ID
     */
    getCase(caseId) {
        return this.cases.get(caseId);
    }
}
exports.CaseEscalationService = CaseEscalationService;
