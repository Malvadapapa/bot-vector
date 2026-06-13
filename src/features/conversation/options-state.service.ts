/**
 * Servicio in-memory que almacena opciones dinámicas generadas por la IA
 * para que el usuario pueda seleccionar una con un número.
 * Solo se usa en contexto de grupo.
 */

export interface PendingOptions {
  originalPrompt: string;
  options: string[];
  createdAt: Date;
}

export class OptionsStateService {
  private static readonly TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos

  private pendingByUser = new Map<string, PendingOptions>();

  /**
   * Guarda las opciones generadas por la IA para un usuario.
   */
  public saveOptions(userId: string, originalPrompt: string, options: string[]): void {
    this.pendingByUser.set(userId, {
      originalPrompt,
      options,
      createdAt: new Date(),
    });
  }

  /**
   * Verifica si el usuario tiene opciones pendientes no expiradas.
   */
  public hasPendingOptions(userId: string, now?: Date): boolean {
    const pending = this.pendingByUser.get(userId);
    if (!pending) return false;

    const currentTime = now ?? new Date();
    if (currentTime.getTime() - pending.createdAt.getTime() > OptionsStateService.TIMEOUT_MS) {
      this.pendingByUser.delete(userId);
      return false;
    }

    return true;
  }

  /**
   * Si el input es un número válido (1-N) y hay opciones pendientes,
   * retorna la opción seleccionada y el prompt original.
   * Limpia el estado después de la selección.
   * Retorna null si no hay opciones pendientes, expiró o el número es inválido.
   */
  public getSelectedOption(userId: string, input: string, now?: Date): { selectedOption: string; originalPrompt: string } | null {
    if (!this.hasPendingOptions(userId, now)) return null;

    const trimmed = input.trim();
    const num = parseInt(trimmed, 10);

    // Solo aceptamos números enteros positivos
    if (isNaN(num) || num < 1 || String(num) !== trimmed) {
      return null;
    }

    const pending = this.pendingByUser.get(userId)!;
    if (num > pending.options.length) {
      return null;
    }

    const selected = pending.options[num - 1];
    const original = pending.originalPrompt;

    // Limpiar estado después de selección exitosa
    this.pendingByUser.delete(userId);

    return { selectedOption: selected, originalPrompt: original };
  }

  /**
   * Limpia las opciones pendientes de un usuario.
   */
  public clear(userId: string): void {
    this.pendingByUser.delete(userId);
  }
}
