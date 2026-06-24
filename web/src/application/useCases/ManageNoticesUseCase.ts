// ============================================================
// ManageNoticesUseCase — CRUD for institutional notices
// ============================================================

import type { INoticeRepository } from '../interfaces/repositories';
import type { Notice, NoticeTargetType } from '../../domain/entities';

export class ManageNoticesUseCase {
  constructor(private noticeRepo: INoticeRepository) {}

  async getAll(groupId: string): Promise<Notice[]> {
    return this.noticeRepo.getAll(groupId);
  }

  async getActive(groupId: string): Promise<Notice[]> {
    return this.noticeRepo.getActive(groupId);
  }

  async getByTarget(targetType: NoticeTargetType, targetId: string): Promise<Notice[]> {
    return this.noticeRepo.getByTarget(targetType, targetId);
  }

  async create(notice: Omit<Notice, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ notice?: Notice; error?: string }> {
    if (!notice.title.trim()) {
      return { error: 'El título del aviso es obligatorio.' };
    }
    if (!notice.body.trim()) {
      return { error: 'El contenido del aviso es obligatorio.' };
    }
    if (!notice.targetId) {
      return { error: 'Debe seleccionar un destinatario.' };
    }

    const created = await this.noticeRepo.create(notice);
    return { notice: created };
  }

  async update(id: string, data: Partial<Notice>): Promise<Notice> {
    return this.noticeRepo.update(id, data);
  }

  async delete(id: string): Promise<void> {
    return this.noticeRepo.delete(id);
  }

  async toggleActive(id: string, active: boolean): Promise<Notice> {
    return this.noticeRepo.toggleActive(id, active);
  }
}
