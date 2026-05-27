"use strict";
/**
 * Servicio de logging centralizado para errores y moderación
 * Escribe a CSV con timestamps y categorización automática
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoggingService = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
class LoggingService {
    constructor(dataDir = 'data') {
        this.dataDir = dataDir;
        this.erroresPath = 'errores.csv';
        this.moderationPath = 'moderation.csv';
        this.bannedUsersPath = 'banned-users.csv';
        this.ensureDataDirExists();
    }
    /**
     * Registra un error automáticamente clasificado
     */
    async logError(error, context) {
        const tipo = this.classifyError(error);
        const timestamp = new Date().toISOString();
        const stack = error.stack?.replace(/\n/g, '|').substring(0, 500) || '';
        const csvLine = [
            timestamp,
            tipo,
            context.componente,
            error.message?.substring(0, 100) || 'Unknown error',
            stack,
            context.usuario || '',
            context.grupoId || '',
        ]
            .map(field => `"${String(field).replace(/"/g, '""')}"`)
            .join(',');
        try {
            await promises_1.default.appendFile(path_1.default.join(this.dataDir, this.erroresPath), csvLine + '\n');
        }
        catch (e) {
            console.error('[LoggingService] Error escribiendo errores.csv:', e);
        }
    }
    /**
     * Registra evento de moderación (ban, infracción, etc)
     */
    async logModeration(event) {
        const timestamp = new Date().toISOString();
        const csvLine = [
            timestamp,
            event.userId,
            event.username,
            event.action,
            event.reason,
            event.details || '',
        ]
            .map(field => `"${String(field).replace(/"/g, '""')}"`)
            .join(',');
        try {
            await promises_1.default.appendFile(path_1.default.join(this.dataDir, this.moderationPath), csvLine + '\n');
        }
        catch (e) {
            console.error('[LoggingService] Error escribiendo moderation.csv:', e);
        }
    }
    /**
     * Registra usuarios baneados en un log separado
     */
    async logBannedUser(event) {
        const timestamp = new Date().toISOString();
        const csvLine = [
            timestamp,
            event.userId,
            event.username,
            event.reason,
            String(event.infractions),
            event.details || '',
        ]
            .map(field => `"${String(field).replace(/"/g, '""')}"`)
            .join(',');
        try {
            await promises_1.default.appendFile(path_1.default.join(this.dataDir, this.bannedUsersPath), csvLine + '\n');
        }
        catch (e) {
            console.error('[LoggingService] Error escribiendo banned-users.csv:', e);
        }
    }
    /**
     * Obtiene últimos errores de un tipo
     */
    async getRecentErrors(tipo, limit = 10) {
        try {
            const content = await promises_1.default.readFile(path_1.default.join(this.dataDir, this.erroresPath), 'utf-8');
            const lines = content.split('\n').filter(Boolean).slice(-limit);
            if (tipo) {
                return lines.filter(line => line.includes(`"${tipo}"`));
            }
            return lines;
        }
        catch {
            return [];
        }
    }
    /**
     * Obtiene eventos de moderación de un usuario
     */
    async getUserModerationHistory(userId, limit = 20) {
        try {
            const content = await promises_1.default.readFile(path_1.default.join(this.dataDir, this.moderationPath), 'utf-8');
            const lines = content
                .split('\n')
                .filter(line => line.includes(userId))
                .slice(-limit);
            return lines;
        }
        catch {
            return [];
        }
    }
    /**
     * Formatea los logs para mostrar en chat
     */
    formatErrorsForChat(errors, limit = 5) {
        if (!errors.length) {
            return '✅ No hay errores registrados.';
        }
        const lines = ['📋 Últimos errores:'];
        for (const error of errors.slice(-limit)) {
            const parts = error.split(',');
            if (parts.length >= 5) {
                const timestamp = parts[0].replace(/"/g, '');
                const tipo = parts[1].replace(/"/g, '');
                const component = parts[2].replace(/"/g, '');
                const message = parts[3].replace(/"/g, '');
                lines.push(`• [${tipo}] ${component}`);
                lines.push(`  ${message}`);
                lines.push(`  ${timestamp}`);
            }
        }
        return lines.join('\n');
    }
    /**
     * Formatea historial de moderación
     */
    formatModerationForChat(events) {
        if (!events.length) {
            return '✅ No hay eventos de moderación registrados.';
        }
        const lines = ['📋 Historial de moderación:'];
        for (const event of events.slice(-10)) {
            const parts = event.split(',');
            if (parts.length >= 6) {
                const timestamp = parts[0].replace(/"/g, '');
                const userId = parts[1].replace(/"/g, '');
                const username = parts[2].replace(/"/g, '');
                const action = parts[3].replace(/"/g, '');
                const reason = parts[4].replace(/"/g, '');
                lines.push(`• ${username} (${action})`);
                lines.push(`  ${reason}`);
                lines.push(`  ${timestamp}`);
            }
        }
        return lines.join('\n');
    }
    classifyError(error) {
        const message = String(error.message || '').toLowerCase();
        // Errores graves
        if (message.includes('database') || message.includes('connection') || message.includes('cannot read')) {
            return 'grave';
        }
        // Errores moderados
        if (message.includes('timeout') || message.includes('undefined') || message.includes('null')) {
            return 'moderado';
        }
        // Errores leves
        return 'leve';
    }
    async ensureDataDirExists() {
        try {
            await promises_1.default.mkdir(this.dataDir, { recursive: true });
            // Crear headers si no existen
            const errorsCsvPath = path_1.default.join(this.dataDir, this.erroresPath);
            try {
                await promises_1.default.access(errorsCsvPath);
            }
            catch {
                const header = '"timestamp","tipo","componente","mensaje","stack","usuario","grupoId"\n';
                await promises_1.default.writeFile(errorsCsvPath, header);
            }
            const modeCsvPath = path_1.default.join(this.dataDir, this.moderationPath);
            try {
                await promises_1.default.access(modeCsvPath);
            }
            catch {
                const header = '"timestamp","userId","username","action","reason","details"\n';
                await promises_1.default.writeFile(modeCsvPath, header);
            }
            const bannedUsersCsvPath = path_1.default.join(this.dataDir, this.bannedUsersPath);
            try {
                await promises_1.default.access(bannedUsersCsvPath);
            }
            catch {
                const header = '"timestamp","userId","username","reason","infractions","details"\n';
                await promises_1.default.writeFile(bannedUsersCsvPath, header);
            }
        }
        catch (e) {
            console.error('[LoggingService] Error inicializando directorio:', e);
        }
    }
}
exports.LoggingService = LoggingService;
