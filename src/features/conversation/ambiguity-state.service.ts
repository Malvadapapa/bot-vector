/**
 * Servicio in-memory que almacena el estado de ambigüedad pendiente por usuario.
 * Se activa cuando el LLM emite [CLARIFY_QUESTION] y guarda:
 *   - La pregunta original del usuario
 *   - La pregunta aclaratoria que hizo el bot
 *   - Los contextos RAG y DB originales (para reutilizarlos sin nueva búsqueda)
 *
 * Solo se usa en contexto de grupo. El estado expira a los 8 minutos.
 */

export interface PendingAmbiguity {
  /** Consulta original del usuario que disparó la ambigüedad. */
  originalPrompt: string;
  /** Pregunta aclaratoria que Vector le hizo al usuario. */
  clarifyingQuestion: string;
  /** Contexto RAG recuperado en el momento de la consulta original (re-usado en resolución). */
  ragContext: string;
  /** Contexto de base de datos del momento original (re-usado en resolución). */
  dbContext: string;
  /** Timestamp de creación para controlar expiración. */
  createdAt: Date;
}

export class AmbiguityStateService {
  private static readonly TIMEOUT_MS = 8 * 60 * 1000; // 8 minutos

  private pendingByUser = new Map<string, PendingAmbiguity>();

  /**
   * Guarda el estado de ambigüedad para un usuario.
   */
  public save(userId: string, state: Omit<PendingAmbiguity, 'createdAt'>): void {
    this.pendingByUser.set(userId, { ...state, createdAt: new Date() });
  }

  /**
   * Retorna el estado pendiente si existe y no expiró. Limpia automáticamente si expiró.
   */
  public get(userId: string, now?: Date): PendingAmbiguity | null {
    const pending = this.pendingByUser.get(userId);
    if (!pending) return null;

    const elapsed = (now ?? new Date()).getTime() - pending.createdAt.getTime();
    if (elapsed > AmbiguityStateService.TIMEOUT_MS) {
      this.pendingByUser.delete(userId);
      return null;
    }

    return pending;
  }

  /**
   * Verifica si el usuario tiene un estado de ambigüedad pendiente no expirado.
   */
  public has(userId: string, now?: Date): boolean {
    return this.get(userId, now) !== null;
  }

  /**
   * Limpia el estado de ambigüedad de un usuario.
   */
  public clear(userId: string): void {
    this.pendingByUser.delete(userId);
  }
}
