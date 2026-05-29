import { UserModerationRepository } from './moderation.repository.js';
import { BanWarningSystem } from './ban-warning-system.js';

export interface ModerationDecision {
  blocked: boolean;
  warningMessage?: string;
  shouldNotifyPrivate?: boolean;
}

const PRIVATE_WARN_THRESHOLD = 1; // primera vez -> privado
const PUBLIC_WARN_THRESHOLD = 2;  // segunda vez -> público + temp ban
const BAN_THRESHOLD = 3;          // tercera vez -> ban 24h

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
    if (isAdmin) return { blocked: false };

    if (this.banWarningSystem.isBanned(userId)) {
      if (this.privateChatCallback) {
        try {
          await this.privateChatCallback(userId, `Hola — en este momento no puedo responderte porque estás sancionado del grupo. Si crees que es un error, contactá a un administrador.`);
        } catch (e) {
          console.error('[Moderation] Error notificando al usuario baneado:', e);
        }
      }
      return { blocked: true };
    }

    const modState = await this.moderationRepository.getOrCreate(userId);
    if (modState.temp_ban_until && modState.temp_ban_until > now) {
      if (this.privateChatCallback) {
        try {
          await this.privateChatCallback(userId, `Hola — estás sancionado del grupo por acumular demasiadas preguntas fuera de tema. Volverás a tener acceso el ${modState.temp_ban_until.toLocaleString('es-AR')}. Si crees que es un error, contactá a un administrador.`);
        } catch (e) {
          console.error('[Moderation] Error notificando al usuario baneado:', e);
        }
      }
      return { blocked: true };
    }

    if (modState.week_ban_until && modState.week_ban_until > now) {
      if (this.privateChatCallback) {
        try {
          await this.privateChatCallback(userId, `Hola — estás sancionado del grupo por una semana. Volverás a tener acceso el ${modState.week_ban_until.toLocaleString('es-AR')}.`);
        } catch (e) {
          console.error('[Moderation] Error notificando al usuario baneado:', e);
        }
      }
      return { blocked: true };
    }

    return { blocked: false };
  }

  public async handleInfraction(userId: string, username = '', description = 'Off-topic', now: Date = new Date()):
    Promise<{ action: 'none'|'warn-private'|'warn-public-restrict'|'ban'; message: string }> {
    const state = await this.moderationRepository.getOrCreate(userId);
    state.warning_count = (state.warning_count || 0) + 1;
    state.last_offense_at = now;

    if (state.warning_count === PRIVATE_WARN_THRESHOLD) {
      await this.moderationRepository.save(state);
      return { action: 'warn-private', message: 'Tu pregunta parece fuera de lugar. Evitá temas no académicos o podrías recibir sanciones.' };
    }

    if (state.warning_count === PUBLIC_WARN_THRESHOLD) {
      state.temp_ban_until = new Date(now.getTime() + 60 * 60 * 1000); // 1 hora
      await this.moderationRepository.save(state);
      return { action: 'warn-public-restrict', message: 'Atención: conducta inapropiada. Se aplica restricción temporal de 1 hora.' };
    }

    // >= BAN_THRESHOLD
    state.temp_ban_until = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h
    await this.moderationRepository.save(state);
    return { action: 'ban', message: 'Has sido sancionado temporalmente por reiteradas infracciones.' };
  }
}
