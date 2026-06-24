// ============================================================
// ImpersonateStudentUseCase — Admin simulation mode
// ============================================================

import type { IImpersonationRepository } from '../interfaces/repositories';
import type { ImpersonationProfile } from '../../domain/entities';

export class ImpersonateStudentUseCase {
  constructor(private impersonationRepo: IImpersonationRepository) {}

  getProfile(): ImpersonationProfile | null {
    return this.impersonationRepo.getProfile();
  }

  isActive(): boolean {
    const profile = this.impersonationRepo.getProfile();
    return profile !== null && profile.active;
  }

  activate(profile: Omit<ImpersonationProfile, 'active' | 'queriesUsed'>): ImpersonationProfile {
    return this.impersonationRepo.activate(profile);
  }

  deactivate(): void {
    this.impersonationRepo.deactivate();
  }

  setDailyQueryLimit(limit: number): void {
    if (limit < 0) return;
    this.impersonationRepo.updateQueryLimit(limit);
  }

  resetQueries(): void {
    this.impersonationRepo.resetQueries();
  }

  setCommission(commissionId: string, commissionName: string): void {
    this.impersonationRepo.setCommission(commissionId, commissionName);
  }
}
