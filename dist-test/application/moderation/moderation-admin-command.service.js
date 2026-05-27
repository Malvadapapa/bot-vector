"use strict";
/**
 * Servicio de comandos admin para moderación
 * Maneja: !ban, !unban, !baneados, !infracciones
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModerationAdminCommandService = void 0;
const ban_warning_system_js_1 = require("./ban-warning-system.js");
class ModerationAdminCommandService {
    constructor() {
        this.banWarningSystem = new ban_warning_system_js_1.BanWarningSystem();
    }
    /**
     * Procesa comandos de moderación para admins
     * !ban @usuario razón
     * !unban @usuario
     * !baneados
     * !infracciones @usuario
     */
    async handleCommand(command, admin_id) {
        const parts = command.trim().toLowerCase().split(/\s+/);
        const cmd = parts[0];
        if (!cmd.startsWith('!'))
            return null;
        if (cmd === '!ban' && parts.length >= 2) {
            return this.handleBanCommand(parts, admin_id);
        }
        if (cmd === '!unban' && parts.length >= 2) {
            return this.handleUnbanCommand(parts, admin_id);
        }
        if (cmd === '!baneados') {
            return this.handleBannedListCommand();
        }
        if (cmd === '!infracciones' && parts.length >= 2) {
            return this.handleInfractionsCommand(parts);
        }
        return null;
    }
    handleBanCommand(parts, admin_id) {
        const userMention = parts[1]; // @usuario o usuario@s.whatsapp.net
        const reason = parts.slice(2).join(' ') || 'Sin especificar';
        // Extraer userId
        const userId = this.extractUserId(userMention);
        if (!userId) {
            return '❌ Usuario no válido. Usa: !ban @usuario razón\nEjemplo: !ban @juan Spam';
        }
        const username = userMention.replace('@', '').split('@')[0];
        this.banWarningSystem.adminBan(userId, username, reason);
        return `✅ Usuario ${userMention} ha sido baneado.\n📝 Razón: ${reason}\n👤 Admin: ${admin_id}`;
    }
    handleUnbanCommand(parts, admin_id) {
        const userMention = parts[1];
        const userId = this.extractUserId(userMention);
        if (!userId) {
            return '❌ Usuario no válido. Usa: !unban @usuario\nEjemplo: !unban @juan';
        }
        const success = this.banWarningSystem.unbanUser(userId, admin_id);
        if (!success) {
            return `⚠️ El usuario ${userMention} no está baneado o no existe en el registro.`;
        }
        return `✅ Ban levantado para ${userMention}.\n👤 Admin: ${admin_id}`;
    }
    handleBannedListCommand() {
        const banned = this.banWarningSystem.getBannedUsers();
        if (!banned.length) {
            return '✅ No hay usuarios baneados en este momento.';
        }
        const lines = ['❌ Usuarios actualmente baneados:', ''];
        for (const user of banned) {
            const formattedDate = new Date(user.banDate).toLocaleDateString('es-AR');
            lines.push(`• ${user.username} (${user.userId})`);
            lines.push(`  📅 Baneado: ${formattedDate}`);
            lines.push(`  📝 Razón: ${user.reason}`);
            lines.push(`  ⚠️ Advertencias: ${user.warnings}/3`);
            lines.push('');
        }
        return lines.join('\n');
    }
    handleInfractionsCommand(parts) {
        const userMention = parts[1];
        const userId = this.extractUserId(userMention);
        if (!userId) {
            return '❌ Usuario no válido. Usa: !infracciones @usuario\nEjemplo: !infracciones @juan';
        }
        const infractions = this.banWarningSystem.getUserInfractions(userId);
        if (!infractions.length) {
            return `✅ El usuario ${userMention} no tiene infracciones registradas.`;
        }
        const lines = [`📋 Historial de infracciones de ${userMention}:`, ''];
        for (const infr of infractions.slice(-10)) {
            // Últimas 10
            const formattedDate = new Date(infr.date).toLocaleDateString('es-AR', {
                hour: '2-digit',
                minute: '2-digit',
            });
            lines.push(`• ${infr.type} (${infr.severity})`);
            lines.push(`  📅 ${formattedDate}`);
            lines.push(`  📝 ${infr.description}`);
            lines.push('');
        }
        lines.push(`\n⚠️ Total de infracciones: ${infractions.length}`);
        const warnings = this.banWarningSystem.getWarningCount(userId);
        lines.push(`⚠️ Advertencias actuales: ${warnings}/3`);
        return lines.join('\n');
    }
    extractUserId(userMention) {
        // Manejo de @username o userid@s.whatsapp.net o 34xxxxxxxx
        const cleaned = userMention.replace('@', '').toLowerCase();
        // Si ya tiene @s.whatsapp.net, es válido
        if (cleaned.includes('@s.whatsapp.net')) {
            return cleaned;
        }
        // Si solo tiene números, asumir formato directo
        if (/^\d+$/.test(cleaned)) {
            return `${cleaned}@s.whatsapp.net`;
        }
        // Si contiene letras y números, probablemente sea un username convertido
        // Para ahora, lo dejamos null
        return null;
    }
}
exports.ModerationAdminCommandService = ModerationAdminCommandService;
