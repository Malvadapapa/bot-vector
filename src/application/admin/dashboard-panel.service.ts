/**
 * Servicio de panel de control y estadísticas del sistema
 * Proporciona vista unificada del estado del bot
 */

import { BanWarningSystem } from '../../features/moderation/ban-warning-system.js';
import { LoggingService } from '../../shared/logging/logging.service.js';

export class DashboardPanelService {
  constructor(private banWarningSystem?: BanWarningSystem, private loggingService?: LoggingService) {}

  /**
   * Genera panel de control para admins
   */
  async generateAdminDashboard(): Promise<string> {
    const lines = ['📊 *Panel de Control - Administrador*\n'];

    // Información del sistema
    const now = new Date();
    lines.push(`⏰ Hora: ${now.toLocaleTimeString('es-AR')}`);
    lines.push(`📅 Fecha: ${now.toLocaleDateString('es-AR')}\n`);

    // Estadísticas de moderación
    if (this.banWarningSystem) {
      const bannedCount = this.banWarningSystem.getBannedUsers().length;
      lines.push(`🚫 Usuarios baneados: ${bannedCount}`);
    }

    // Información de logging
    if (this.loggingService) {
      const recentErrors = await this.loggingService.getRecentErrors(undefined, 5);
      lines.push(`⚠️ Errores recientes: ${recentErrors.length}`);
    }

    lines.push(`\n📋 *Comandos disponibles:*`);
    lines.push(`• !log-errores - Ver últimos errores`);
    lines.push(`• !log-moderacion - Ver eventos de moderación`);
    lines.push(`• !baneados - Listar usuarios baneados`);
    lines.push(`• !infracciones @usuario - Ver infracciones de usuario`);
    lines.push(`• !stats - Estadísticas del sistema`);

    return lines.join('\n');
  }

  /**
   * Genera panel público (información para estudiantes)
   */
  async generatePublicDashboard(): Promise<string> {
    const lines = ['📚 *Panel de Información*\n'];

    const now = new Date();
    lines.push(`⏰ ${now.toLocaleTimeString('es-AR')}`);
    lines.push(`📅 ${now.toLocaleDateString('es-AR')}\n`);

    lines.push(`📋 *Comandos disponibles:*`);
    lines.push(`• !agregarexamen - Agregar un nuevo examen`);
    lines.push(`• !editarexamen - Editar examen existente`);
    lines.push(`• !eliminaravisos - Eliminar avisos de examen`);
    lines.push(`• !proximos-examenes - Ver próximos exámenes`);

    return lines.join('\n');
  }

  /**
   * Genera informe de salud del sistema
   */
  async getSystemHealthStatus(): Promise<{ status: 'healthy' | 'warning' | 'error'; details: string }> {
    const errors = this.loggingService ? await this.loggingService.getRecentErrors('grave', 5) : [];

    if (errors.length > 3) {
      return {
        status: 'error',
        details: `❌ Sistema con problemas. ${errors.length} errores graves detectados.`,
      };
    }

    if (errors.length > 0) {
      return {
        status: 'warning',
        details: `⚠️ Sistema funcionando con advertencias. ${errors.length} errores detectados.`,
      };
    }

    return {
      status: 'healthy',
      details: `✅ Sistema funcionando correctamente.`,
    };
  }

  /**
   * Formatea información de un usuario para panel
   */
  formatUserInfoPanel(userId: string, username?: string, infractions = 0, isBanned = false): string {
    const lines = [`📋 *Información de ${username || userId}*\n`];

    lines.push(`ID: ${userId}`);
    if (username) {
      lines.push(`Usuario: ${username}`);
    }

    lines.push(`\n🔍 *Estado:*`);
    lines.push(`Infracciones: ${infractions}`);
    lines.push(`Estado: ${isBanned ? '🚫 Baneado' : '✅ Activo'}`);

    return lines.join('\n');
  }
}
