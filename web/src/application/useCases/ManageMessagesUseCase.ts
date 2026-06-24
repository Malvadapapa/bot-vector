// ============================================================
// ManageMessagesUseCase — Professor messaging + chat threads
// ============================================================

import type { IMessageRepository } from '../interfaces/repositories';
import type { ChatMessage } from '../../domain/entities';

export class ManageMessagesUseCase {
  constructor(private messageRepo: IMessageRepository) {}

  async getAll(groupId: string): Promise<ChatMessage[]> {
    return this.messageRepo.getAll(groupId);
  }

  async send(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<{ message?: ChatMessage; error?: string }> {
    if (!message.content.trim()) {
      return { error: 'El mensaje no puede estar vacío.' };
    }
    if (!message.targetId) {
      return { error: 'Debe seleccionar un destinatario.' };
    }

    const sent = await this.messageRepo.send(message);
    return { message: sent };
  }

  async delete(id: string): Promise<void> {
    return this.messageRepo.delete(id);
  }

  async getReplies(parentMessageId: string, isNotice?: boolean): Promise<ChatMessage[]> {
    return this.messageRepo.getReplies(parentMessageId, isNotice);
  }

  async sendReply(reply: Omit<ChatMessage, 'id' | 'timestamp'>, isNotice?: boolean): Promise<{ message?: ChatMessage; error?: string }> {
    if (!reply.content.trim()) {
      return { error: 'La respuesta no puede estar vacía.' };
    }

    const sent = await this.messageRepo.sendReply(reply, isNotice);
    return { message: sent };
  }

  async markAsRead(messageIds: string[], isNotice?: boolean): Promise<void> {
    return this.messageRepo.markAsRead(messageIds, isNotice);
  }

  async getUnreadCount(groupId: string): Promise<number> {
    return this.messageRepo.getUnreadCount(groupId);
  }
}
