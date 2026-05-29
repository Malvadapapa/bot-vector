/**
 * Servicio de coordinación integral del sistema
 * Integra todos los servicios de administración, análisis y notificaciones
 */

import { ConversationAnalysisService, ConversationPattern } from '../analysis/conversation-analysis.service.js';
import { CaseEscalationService, EscalatedCase, EscalationLevel } from '../admin/case-escalation.service.js';
import { ScheduledReminderService, ScheduledReminder } from '../../features/notifications/scheduled-reminder.service.js';
import { DashboardPanelService } from '../admin/dashboard-panel.service.js';
import { BanWarningSystem } from '../../features/moderation/ban-warning-system.js';

export class SystemCoordinatorService {
  constructor(
    private conversationAnalysis: ConversationAnalysisService,
    private caseEscalation: CaseEscalationService,
    private scheduledReminders: ScheduledReminderService,
    private dashboardPanel: DashboardPanelService,
    private banSystem?: BanWarningSystem,
  ) {}

  /**
   * Genera reporte completo de un usuario
   */
  async generateUserFullReport(userId: string, username?: string): Promise<string> {
    const lines = [`📊 *Reporte Completo: ${username || userId}*\n`];

    // Análisis de conversación
    const pattern = this.conversationAnalysis.getPattern(userId);
    if (pattern) {
      lines.push(`📈 *Actividad:*`);
      lines.push(`  Mensajes: ${pattern.messageCount}`);
      lines.push(`  Promedio: ${pattern.averageLength.toFixed(1)} caracteres`);
      lines.push(`  Infracciones: ${pattern.infractions}`);
      lines.push(`  Sospecha: ${pattern.suspicionScore}/100\n`);
    }

    // Estado de moderación
    if (this.banSystem) {
      const isBanned = this.banSystem.isBanned(userId);
      const infractions = this.banSystem.getUserInfractions(userId);
      const warnings = this.banSystem.getWarningCount(userId);

      lines.push(`🚫 *Moderación:*`);
      lines.push(`  Estado: ${isBanned ? '❌ Baneado' : '✅ Activo'}`);
      lines.push(`  Infracciones: ${infractions.length}`);
      lines.push(`  Advertencias: ${warnings}/3\n`);
    }

    // Casos escalados
    const cases = this.caseEscalation.getCasesByUser(userId);
    if (cases.length > 0) {
      lines.push(`📋 *Casos Escalados: ${cases.length}*`);
      for (const caseData of cases.slice(-3)) {
        lines.push(`  • ${caseData.id}: ${caseData.reason} (${caseData.status})`);
      }
      lines.push('');
    }

    // Recordatorios
    const reminders = this.scheduledReminders.getUpcomingReminders(userId);
    if (reminders.length > 0) {
      lines.push(`🔔 *Recordatorios Próximos: ${reminders.length}*`);
      for (const reminder of reminders.slice(0, 3)) {
        lines.push(`  • ${reminder.examName} - ${reminder.type}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Genera resumen ejecutivo del sistema
   */
  async getSystemExecutiveSummary(): Promise<string> {
    const lines = ['📊 *Resumen Ejecutivo del Sistema*\n'];

    // Estadísticas generales
    const stats = this.conversationAnalysis.getGeneralStats();
    lines.push(`👥 Usuarios Monitoreados: ${stats.totalUsers}`);
    lines.push(`💬 Mensajes Totales: ${stats.totalMessages}`);
    lines.push(`🔴 Alto Riesgo: ${stats.highRiskUsers}`);
    lines.push(`⚠️ Promedio Infracciones: ${stats.averageInfractions.toFixed(2)}\n`);

    // Casos abiertos
    const openCases = this.caseEscalation.getOpenCases();
    const criticalCases = this.caseEscalation.getCasesByLevel(EscalationLevel.CRITICAL);
    lines.push(`📋 Casos Abiertos: ${openCases.length}`);
    lines.push(`🔴 Críticos: ${criticalCases.length}\n`);

    // Recordatorios
    const reminderStats = this.scheduledReminders.getStats();
    lines.push(`🔔 Recordatorios: ${reminderStats.total}`);
    lines.push(`📤 Enviados: ${reminderStats.sent}`);
    lines.push(`⏳ Pendientes: ${reminderStats.pending}\n`);

    // Alertas
    const suspiciousUsers = this.conversationAnalysis.getSuspiciousUsers(80);
    if (suspiciousUsers.length > 0) {
      lines.push(`⚠️ *ALERTAS*`);
      lines.push(`🔴 Usuarios muy sospechosos: ${suspiciousUsers.length}`);
      for (const user of suspiciousUsers.slice(0, 3)) {
        lines.push(`  • ${user.userId}: ${user.suspicionScore}/100 sospecha`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Crea caso escalado basado en análisis automático
   */
  createAutoEscalatedCase(userId: string, username?: string): EscalatedCase | null {
    const pattern = this.conversationAnalysis.getPattern(userId);

    if (!pattern) {
      return null;
    }

    // Determinar nivel de escalado
    let level = EscalationLevel.LOW;
    let reason = '';

    if (pattern.suspicionScore >= 90) {
      level = EscalationLevel.CRITICAL;
      reason = 'Puntuación de sospecha crítica';
    } else if (pattern.suspicionScore >= 75 && this.conversationAnalysis.isInInfractionCycle(userId)) {
      level = EscalationLevel.HIGH;
      reason = 'Ciclo de infracciones detectado';
    } else if (pattern.suspicionScore >= 60) {
      level = EscalationLevel.MEDIUM;
      reason = 'Comportamiento sospechoso';
    } else if (pattern.infractions > 0) {
      level = EscalationLevel.LOW;
      reason = 'Infracción registrada';
    } else {
      return null;
    }

    return this.caseEscalation.createCase(
      userId,
      reason,
      `Análisis automático detectó: ${pattern.messageCount} mensajes, ${pattern.infractions} infracciones, ${pattern.suspicionScore}/100 sospecha`,
      level,
      username,
    );
  }

  /**
   * Obtiene usuarios que necesitan revisión manual
   */
  getUsersNeedingReview(): Array<{ userId: string; reason: string; severity: string }> {
    const review = [];

    // Usuarios muy sospechosos
    const suspicious = this.conversationAnalysis.getSuspiciousUsers(75);
    for (const user of suspicious) {
      review.push({
        userId: user.userId,
        reason: 'Alto nivel de sospecha',
        severity: 'high',
      });
    }

    // Casos críticos abiertos
    const criticalCases = this.caseEscalation.getCasesByLevel(EscalationLevel.CRITICAL);
    for (const caseData of criticalCases) {
      if (caseData.status === 'open') {
        review.push({
          userId: caseData.userId,
          reason: `Caso crítico: ${caseData.reason}`,
          severity: 'critical',
        });
      }
    }

    return review;
  }

  /**
   * Limpia datos antiguos del sistema
   */
  async cleanupOldData(): Promise<{ cleaned: number; description: string }> {
    // Limpiar análisis inactivos
    this.conversationAnalysis.cleanupInactivePatterns();

    // Limpiar recordatorios antiguos
    const remindersCleaned = this.scheduledReminders.cleanupOldReminders(30);

    return {
      cleaned: remindersCleaned,
      description: `Limpieza completada: ${remindersCleaned} recordatorios antiguos removidos`,
    };
  }

  /**
   * Formatea acción recomendada para administrador
   */
  formatRecommendedAction(userId: string, analysis: ConversationPattern): string {
    const lines = [`💡 *Acción Recomendada para ${userId}*\n`];

    if (analysis.suspicionScore >= 90) {
      lines.push(`🔴 CRÍTICO: Considerar ban temporal o permanente`);
      lines.push(`Razón: Puntuación de sospecha ${analysis.suspicionScore}/100`);
    } else if (analysis.suspicionScore >= 75) {
      lines.push(`🟠 ALTO: Aumentar supervisión o restricción`);
      lines.push(`Razón: Ciclo de infracciones (${analysis.infractions} infracciones)`);
    } else if (analysis.suspicionScore >= 50) {
      lines.push(`🟡 MEDIO: Advertencia privada`);
      lines.push(`Razón: Comportamiento sospechoso (${analysis.messageCount} mensajes)`);
    } else {
      lines.push(`🟢 BAJO: Monitorear`);
      lines.push(`Razón: Patrón normal detectado`);
    }

    return lines.join('\n');
  }
}
