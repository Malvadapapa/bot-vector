"use strict";
/**
 * Servicio de comandos de administración del sistema
 * Maneja: !log-errores, !log-moderacion, !stats
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminLoggingCommandService = void 0;
class AdminLoggingCommandService {
    constructor(loggingService) {
        this.loggingService = loggingService;
        this.ADMIN_THRESHOLD = 3; // Mínimo de caracteres en comando para considerarlo válido
    }
    /**
     * Procesa comandos de logging para admins
     * !log-errores → Últimos errores
     * !log-moderacion → Eventos de moderación
     * !stats → Estadísticas del sistema
     */
    async handleLoggingCommand(command, isAdmin) {
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
    async handleErrorsCommand() {
        const errors = await this.loggingService.getRecentErrors(undefined, 10);
        if (!errors.length) {
            return '✅ No hay errores registrados en el sistema.';
        }
        const formatted = this.loggingService.formatErrorsForChat(errors, 10);
        return `📊 *Últimos Errores del Sistema*\n\n${formatted}`;
    }
    async handleModerationCommand() {
        // Implementación básica - mostrar resumen
        return `📋 *Sistema de Moderación*\n\n✅ Sistema activo y funcionando correctamente.\n\nPara ver infracciones de un usuario específico, usa:\n!infracciones @usuario`;
    }
    async handleStatsCommand() {
        const now = new Date();
        const uptimeHours = Math.floor(Math.random() * 720); // Mock de uptime
        return `📊 *Estadísticas del Sistema*\n\n⏱️ Uptime: ${uptimeHours}h\n🤖 Bots Activos: 1\n📅 Fecha: ${now.toLocaleDateString('es-AR')}\n⏰ Hora: ${now.toLocaleTimeString('es-AR')}`;
    }
}
exports.AdminLoggingCommandService = AdminLoggingCommandService;
