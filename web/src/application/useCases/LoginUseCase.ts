// ============================================================
// LoginUseCase — Handles OTP authentication flow
// ============================================================

import type { IAuthRepository } from '../interfaces/repositories';
import type { AuthSession } from '../../domain/entities';

export class LoginUseCase {
  constructor(private authRepo: IAuthRepository) {}

  async requestOTP(email: string): Promise<{ success: boolean; debugCode?: string }> {
    if (!email || !email.includes('@')) {
      return { success: false };
    }
    return this.authRepo.sendOTP(email);
  }

  async verifyOTP(email: string, code: string): Promise<AuthSession | null> {
    if (!code || code.length !== 6) {
      return null;
    }
    return this.authRepo.verifyOTP(email, code);
  }

  getSession(): AuthSession | null {
    const session = this.authRepo.getSession();
    if (session && this.authRepo.isSessionExpired()) {
      this.authRepo.logout();
      return null;
    }
    return session;
  }

  refreshActivity(): void {
    this.authRepo.refreshActivity();
  }

  logout(): void {
    this.authRepo.logout();
  }

  isSessionValid(): boolean {
    const session = this.authRepo.getSession();
    return session !== null && !this.authRepo.isSessionExpired();
  }
}
