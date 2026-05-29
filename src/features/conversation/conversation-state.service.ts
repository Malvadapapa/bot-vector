import { ConversationAction } from './conversation.models.js';
import { ConfirmationRepository } from './conversation.repository.js';
import { ReminderRepository } from '../../infrastructure/persistence/db/repositories.js';
import { ParsedMessage } from '../messages/messages.models.js';

const YES_ANSWERS = new Set(['si', 'sí', 'yes', 'ok', 'dale', 'confirmo']);
const NO_ANSWERS = new Set(['no', 'cancelar', 'cancela', 'n']);

export class ConversationStateService {
  constructor(
    private reminderRepository: ReminderRepository,
    private confirmationRepository: ConfirmationRepository,
    private confirmationTimeoutMinutes = 15,
  ) {}

  public async processMessage(
    userId: string,
    normalizedText: string,
    parsedMessage: ParsedMessage,
    nowUtc?: Date,
  ): Promise<ConversationAction> {
    const now = nowUtc ?? new Date();

    const pending = await this.confirmationRepository.get(userId);
    if (pending) {
      return this.resolvePendingConfirmation(userId, normalizedText, now);
    }

    if (parsedMessage.intent === 'create_reminder') {
      if (parsedMessage.requires_clarification) {
        return {
          action_type: 'ask_date_clarification',
          response_text: 'Necesito una fecha para guardarlo. Por ejemplo: recordame examen el 24/05.',
        };
      }
      if (!parsedMessage.probable_date) {
        return {
          action_type: 'ask_date_clarification',
          response_text: 'No pude detectar la fecha. Indicame dia y mes, por favor.',
        };
      }

      const expiresAt = new Date(now.getTime() + this.confirmationTimeoutMinutes * 60_000);
      const eventType = parsedMessage.keywords[0] || 'recordatorio';

      await this.confirmationRepository.save(
        userId,
        'awaiting_confirmation',
        'create_reminder',
        {
          event_type: eventType,
          description: normalizedText,
          event_date: parsedMessage.probable_date.toISOString(),
        },
        expiresAt,
      );

      return {
        action_type: 'ask_confirmation',
        response_text: `Detecte un recordatorio para el ${parsedMessage.probable_date.toISOString().slice(0, 10)}. Responde 'si' para guardar o 'no' para cancelar.`,
      };
    }

    return { action_type: 'none', response_text: null };
  }

  private async resolvePendingConfirmation(userId: string, normalizedText: string, nowUtc: Date): Promise<ConversationAction> {
    const pending = await this.confirmationRepository.get(userId);
    if (!pending) {
      return { action_type: 'none', response_text: null };
    }

    if (pending.expires_at < nowUtc) {
      await this.confirmationRepository.delete(userId);
      return {
        action_type: 'cancelled',
        response_text: 'La confirmacion vencio. Si queres, pedime el recordatorio otra vez.',
      };
    }

    const answer = normalizedText.trim().toLowerCase();
    if (YES_ANSWERS.has(answer)) {
      const payload = JSON.parse(pending.pending_payload_json) as {
        event_type: string;
        description: string;
        event_date: string;
      };

      await this.reminderRepository.create({
        user_id: userId,
        event_type: payload.event_type,
        description: payload.description,
        event_date: new Date(payload.event_date),
        source: 'whatsapp',
        status: 'pending',
      });
      await this.confirmationRepository.delete(userId);
      return { action_type: 'saved', response_text: 'Listo, recordatorio guardado correctamente.' };
    }

    if (NO_ANSWERS.has(answer)) {
      await this.confirmationRepository.delete(userId);
      return { action_type: 'cancelled', response_text: 'Operacion cancelada. No guarde el recordatorio.' };
    }

    return { action_type: 'ask_confirmation', response_text: "Solo necesito 'si' o 'no' para continuar." };
  }
}
