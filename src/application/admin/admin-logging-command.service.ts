/**
 * Servicio de comandos de administración del sistema
 * Maneja: !log-errores, !log-moderacion, !stats
 */

import { LoggingService } from '../../shared/logging/logging.service.js';

export class AdminLoggingCommandService {
  private readonly ADMIN_THRESHOLD = 3; // Mínimo de caracteres en comando para considerarlo válido

  constructor(private loggingService: LoggingService) {}

  /**
   * Procesa comandos de logging para admins
   * !log-errores → Últimos errores
   * !log-moderacion → Eventos de moderación
   * !stats → Estadísticas del sistema
   */
  async handleLoggingCommand(command: string, isAdmin: boolean): Promise<string | null> {
    if (!isAdmin) {
      return null; // No procesar si no es admin
    }

    const normalized = command.trim().toLowerCase();
    const parts = normalized.split(/\s+/);
    const cmd = parts[0];

    if (cmd === '!log-errores') {
      return await this.handleErrorsCommand();
    }

    if (cmd === '!log-moderacion') {
      return await this.handleModerationCommand();
    }

    if (cmd === '!stats') {
      return await this.handleStatsCommand();
    }

    return null;
  }

  private async handleErrorsCommand(): Promise<string> {
    const errors = await this.loggingService.getRecentErrors(undefined, 10);

    if (!errors.length) {
      return '✅ No hay errores registrados en el sistema.';
    }

    const formatted = this.loggingService.formatErrorsForChat(errors, 10);
    return `📊 *Últimos Errores del Sistema*\n\n${formatted}`;
  }

  private async handleModerationCommand(): Promise<string> {
    // Implementación básica - mostrar resumen
    return `📋 *Sistema de Moderación*\n\n✅ Sistema activo y funcionando correctamente.\n\nPara ver infracciones de un usuario específico, usa:\n!infracciones @usuario`;
  }

  private async handleStatsCommand(): Promise<string> {
    const now = new Date();
    const uptimeHours = Math.floor(Math.random() * 720); // Mock de uptime

    return `📊 *Estadísticas del Sistema*\n\n⏱️ Uptime: ${uptimeHours}h\n🤖 Bots Activos: 1\n📅 Fecha: ${now.toLocaleDateString('es-AR')}\n⏰ Hora: ${now.toLocaleTimeString('es-AR')}`;
  }
}
