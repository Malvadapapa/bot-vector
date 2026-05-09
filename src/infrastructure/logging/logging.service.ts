/**
 * Servicio de logging centralizado para errores y moderación
 * Escribe a CSV con timestamps y categorización automática
 */

import fs from 'fs/promises';
import path from 'path';
import { ErrorLog } from '../../domain/models.js';

export class LoggingService {
  private erroresPath = 'errores.csv';
  private moderationPath = 'moderation.csv';
  private bannedUsersPath = 'banned-users.csv';

  constructor(private dataDir = 'data') {
    this.ensureDataDirExists();
  }

  /**
   * Registra un error automáticamente clasificado
   */
  async logError(error: any, context: { componente: string; usuario?: string; grupoId?: string }): Promise<void> {
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
      await fs.appendFile(path.join(this.dataDir, this.erroresPath), csvLine + '\n');
    } catch (e) {
      console.error('[LoggingService] Error escribiendo errores.csv:', e);
    }
  }

  /**
   * Registra evento de moderación (ban, infracción, etc)
   */
  async logModeration(event: {
    userId: string;
    username: string;
    action: 'infraction' | 'warning' | 'ban' | 'unban' | 'restriction';
    reason: string;
    details?: string;
  }): Promise<void> {
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
      await fs.appendFile(path.join(this.dataDir, this.moderationPath), csvLine + '\n');
    } catch (e) {
      console.error('[LoggingService] Error escribiendo moderation.csv:', e);
    }
  }

  /**
   * Registra usuarios baneados en un log separado
   */
  async logBannedUser(event: {
    userId: string;
    username: string;
    reason: string;
    infractions: number;
    details?: string;
  }): Promise<void> {
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
      await fs.appendFile(path.join(this.dataDir, this.bannedUsersPath), csvLine + '\n');
    } catch (e) {
      console.error('[LoggingService] Error escribiendo banned-users.csv:', e);
    }
  }

  /**
   * Obtiene últimos errores de un tipo
   */
  async getRecentErrors(tipo?: 'grave' | 'moderado' | 'leve', limit = 10): Promise<string[]> {
    try {
      const content = await fs.readFile(path.join(this.dataDir, this.erroresPath), 'utf-8');
      const lines = content.split('\n').filter(Boolean).slice(-limit);

      if (tipo) {
        return lines.filter(line => line.includes(`"${tipo}"`));
      }

      return lines;
    } catch {
      return [];
    }
  }

  /**
   * Obtiene eventos de moderación de un usuario
   */
  async getUserModerationHistory(userId: string, limit = 20): Promise<string[]> {
    try {
      const content = await fs.readFile(path.join(this.dataDir, this.moderationPath), 'utf-8');
      const lines = content
        .split('\n')
        .filter(line => line.includes(userId))
        .slice(-limit);

      return lines;
    } catch {
      return [];
    }
  }

  /**
   * Formatea los logs para mostrar en chat
   */
  formatErrorsForChat(errors: string[], limit = 5): string {
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
  formatModerationForChat(events: string[]): string {
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

  private classifyError(error: any): 'grave' | 'moderado' | 'leve' {
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

  private async ensureDataDirExists(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });

      // Crear headers si no existen
      const errorsCsvPath = path.join(this.dataDir, this.erroresPath);
      try {
        await fs.access(errorsCsvPath);
      } catch {
        const header = '"timestamp","tipo","componente","mensaje","stack","usuario","grupoId"\n';
        await fs.writeFile(errorsCsvPath, header);
      }

      const modeCsvPath = path.join(this.dataDir, this.moderationPath);
      try {
        await fs.access(modeCsvPath);
      } catch {
        const header = '"timestamp","userId","username","action","reason","details"\n';
        await fs.writeFile(modeCsvPath, header);
      }

      const bannedUsersCsvPath = path.join(this.dataDir, this.bannedUsersPath);
      try {
        await fs.access(bannedUsersCsvPath);
      } catch {
        const header = '"timestamp","userId","username","reason","infractions","details"\n';
        await fs.writeFile(bannedUsersCsvPath, header);
      }
    } catch (e) {
      console.error('[LoggingService] Error inicializando directorio:', e);
    }
  }
}
