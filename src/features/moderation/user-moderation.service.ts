import { UserModerationRepository } from './moderation.repository.js';
import { BanWarningSystem } from './ban-warning-system.js';


export interface ModerationDecision {
  blocked: boolean;
  warningMessage?: string;
  shouldNotifyPrivate?: boolean;
}

export class UserModerationService {
  private banWarningSystem = new BanWarningSystem();
  private privateChatCallback?: (userId: string, message: string) => Promise<void>;

  constructor(
    private moderationRepository: UserModerationRepository,
  ) { }

  setPrivateChatCallback(callback: (userId: string, message: string) => Promise<void>): void {
    this.privateChatCallback = callback;
  }

  public async evaluate(userId: string, text: string, isAdmin: boolean, now: Date = new Date()): Promise<ModerationDecision> {
    // Los admins nunca son moderados
    if (isAdmin) {
      return { blocked: false };
    }

    // Verificar si usuario está baneado en archivo local (BanWarningSystem)
    if (this.banWarningSystem.isBanned(userId)) {
      console.log(`[Moderation] Usuario baneado ${userId} intentó enviar mensaje`);
      if (this.privateChatCallback) {
        try {
          await this.privateChatCallback(
            userId,
            `Hola — en este momento no puedo responderte porque estás sancionado del grupo. Si crees que es un error, contactá a un administrador.`,
          );
        } catch (e) {
          console.error('[Moderation] Error notificando al usuario baneado:', e);
        }
      }
      return { blocked: true };
    }

    // Verificar si usuario está baneado en DB (sistema de infracciones)
    const modState = await this.moderationRepository.getOrCreate(userId);
    if (modState.temp_ban_until && modState.temp_ban_until > now) {
      console.log(`[Moderation] Usuario baneado temporalmente ${userId} intentó enviar mensaje`);
      if (this.privateChatCallback) {
        try {
          await this.privateChatCallback(
            userId,
            `Hola — estás sancionado del grupo por acumular demasiadas preguntas fuera de tema. Volverás a tener acceso el ${modState.temp_ban_until.toLocaleString('es-AR')}. Si crees que es un error, contactá a un administrador.`,
          );
        } catch (e) {
          console.error('[Moderation] Error notificando al usuario baneado:', e);
        }
      }
      return { blocked: true };
    }

    if (modState.week_ban_until && modState.week_ban_until > now) {
      console.log(`[Moderation] Usuario baneado por semana ${userId} intentó enviar mensaje`);
      if (this.privateChatCallback) {
        try {
          await this.privateChatCallback(
            userId,
            `Hola — estás sancionado del grupo por una semana. Volverás a tener acceso el ${modState.week_ban_until.toLocaleString('es-AR')}.`,
          );
        } catch (e) {
          console.error('[Moderation] Error notificando al usuario baneado:', e);
        }
      }
      return { blocked: true };
    }

    // CAMBIO: Sistema flexible - permitir casi todo, detectar dinámicamente por encabezado IA
    console.log(`[Moderation] Mensaje permitido de ${userId} (sistema flexible)`);
    return { blocked: false };
  }
}
