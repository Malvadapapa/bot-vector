/**
 * Sistema de advertencias y bans para moderación
 * Maneja sanciones progresivas: advertencia 1 → privada
 *                              advertencia 2 → pública + restricción
 *                              advertencia 3 → ban permanente
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface BannedUser {
  userId: string;
  username: string;
  banDate: Date;
  reason: string;
  warnings: 1 | 2 | 3;
  status: 'activo' | 'baneado' | 'levantado';
  unbannedAt?: Date;
  unbannedBy?: string;
}

export interface InfractionRecord {
  userId: string;
  username: string;
  type: string;
  date: Date;
  description: string;
  severity: string;
  warnings: number;
}

interface BannedUsersFile {
  bannedUsers: BannedUser[];
  infractions: InfractionRecord[];
}

export class BanWarningSystem {
  private banFilePath: string;
  private banData: BannedUsersFile = { bannedUsers: [], infractions: [] };
  private restrictedUsers = new Map<string, { until: Date }>();

  constructor() {
    this.banFilePath = this.resolveBanFilePath();
    this.loadBanData();

    // Limpiar restricciones cada minuto
    setInterval(() => this.cleanupRestrictions(), 60000);
  }

  /**
   * Agrega una infracción a un usuario y retorna si debe banearse
   */
  addInfraction(userId: string, username: string, type: string, description: string, severity: string): {
    action: 'none' | 'warn-private' | 'warn-public-restrict' | 'ban';
    warnings: number;
  } {
    const bannedUser = this.banData.bannedUsers.find(b => b.userId === userId);

    // Si ya está baneado, no hacer nada
    if (bannedUser && bannedUser.status === 'baneado') {
      return { action: 'none', warnings: bannedUser.warnings };
    }

    // Agregar infracción al historial
    this.banData.infractions.push({
      userId,
      username,
      type,
      date: new Date(),
      description,
      severity,
      warnings: 0,
    });

    // Contar infracciones recientes (últimos 7 días)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentInfractions = this.banData.infractions.filter(
      i => i.userId === userId && i.date >= sevenDaysAgo
    );

    let warnings = recentInfractions.length;

    // Determinar acción
    let action: 'none' | 'warn-private' | 'warn-public-restrict' | 'ban' = 'none';
    if (warnings === 1) {
      action = 'warn-private';
    } else if (warnings === 2) {
      action = 'warn-public-restrict';
      // Restringir por 1 hora
      this.restrictedUsers.set(userId, { until: new Date(Date.now() + 3600000) });
    } else if (warnings >= 3) {
      action = 'ban';
      // Crear registro de ban
      if (!bannedUser) {
        this.banData.bannedUsers.push({
          userId,
          username,
          banDate: new Date(),
          reason: `Infracciones acumuladas: ${type}`,
          warnings: 3,
          status: 'baneado',
        });
      } else {
        bannedUser.status = 'baneado';
        bannedUser.warnings = 3;
      }
    }

    this.saveBanData();
    return { action, warnings };
  }

  /**
   * Verifica si un usuario está baneado
   */
  isBanned(userId: string): boolean {
    const bannedUser = this.banData.bannedUsers.find(b => b.userId === userId && b.status === 'baneado');
    return !!bannedUser;
  }

  /**
   * Verifica si un usuario está restringido temporalmente
   */
  isRestricted(userId: string): boolean {
    const restriction = this.restrictedUsers.get(userId);
    if (!restriction) return false;

    if (new Date() > restriction.until) {
      this.restrictedUsers.delete(userId);
      return false;
    }

    return true;
  }

  /**
   * Obtiene los minutos restantes de restricción
   */
  getRestrictionMinutesRemaining(userId: string): number {
    const restriction = this.restrictedUsers.get(userId);
    if (!restriction) return 0;

    const now = new Date();
    if (now > restriction.until) {
      this.restrictedUsers.delete(userId);
      return 0;
    }

    return Math.ceil((restriction.until.getTime() - now.getTime()) / 60000);
  }

  /**
   * Obtiene el número de advertencias de un usuario
   */
  getWarningCount(userId: string): number {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentInfractions = this.banData.infractions.filter(
      i => i.userId === userId && i.date >= sevenDaysAgo
    );
    return Math.min(recentInfractions.length, 3);
  }

  /**
   * Levanta un ban de un usuario (solo admins)
   */
  unbanUser(userId: string, unbannedBy: string): boolean {
    const bannedUser = this.banData.bannedUsers.find(b => b.userId === userId);
    if (!bannedUser) return false;

    bannedUser.status = 'levantado';
    bannedUser.unbannedAt = new Date();
    bannedUser.unbannedBy = unbannedBy;

    this.saveBanData();
    return true;
  }

  /**
   * Obtiene lista de usuarios actualmente baneados
   */
  getBannedUsers(): BannedUser[] {
    return this.banData.bannedUsers.filter(b => b.status === 'baneado');
  }

  /**
   * Obtiene historial de infracciones de un usuario
   */
  getUserInfractions(userId: string): InfractionRecord[] {
    return this.banData.infractions.filter(i => i.userId === userId);
  }

  /**
   * Admin ban - banea inmediatamente sin advertencias
   */
  adminBan(userId: string, username: string, reason: string): void {
    const existing = this.banData.bannedUsers.find(b => b.userId === userId);

    if (existing) {
      existing.status = 'baneado';
      existing.reason = reason;
      existing.banDate = new Date();
      existing.warnings = 3;
    } else {
      this.banData.bannedUsers.push({
        userId,
        username,
        banDate: new Date(),
        reason,
        warnings: 3,
        status: 'baneado',
      });
    }

    this.saveBanData();
  }

  private loadBanData(): void {
    try {
      if (fs.existsSync(this.banFilePath)) {
        const raw = fs.readFileSync(this.banFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as BannedUsersFile;
        
        // Convertir strings a Dates
        this.banData = {
          bannedUsers: parsed.bannedUsers.map(u => ({
            ...u,
            banDate: new Date(u.banDate),
            unbannedAt: u.unbannedAt ? new Date(u.unbannedAt) : undefined,
          })),
          infractions: parsed.infractions.map(i => ({
            ...i,
            date: new Date(i.date),
          })),
        };
      }
    } catch (error) {
      console.error('[BanWarningSystem] Error cargando ban data:', error);
      this.banData = { bannedUsers: [], infractions: [] };
    }
  }

  private saveBanData(): void {
    try {
      const dir = path.dirname(this.banFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.banFilePath, JSON.stringify(this.banData, null, 2));
    } catch (error) {
      console.error('[BanWarningSystem] Error guardando ban data:', error);
    }
  }

  private resolveBanFilePath(): string {
    const candidates = [
      path.resolve(MODULE_DIR, '..', '..', '..', '..', 'data', 'banned-users.json'),
      path.resolve(MODULE_DIR, '..', '..', 'data', 'banned-users.json'),
      path.resolve(MODULE_DIR, '..', '..', '..', 'data', 'banned-users.json'),
      path.resolve(process.cwd(), 'data', 'banned-users.json'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0];
  }

  private cleanupRestrictions(): void {
    const now = new Date();
    const toDelete: string[] = [];

    for (const [userId, restriction] of this.restrictedUsers.entries()) {
      if (now > restriction.until) {
        toDelete.push(userId);
      }
    }

    toDelete.forEach(userId => this.restrictedUsers.delete(userId));
  }
}
