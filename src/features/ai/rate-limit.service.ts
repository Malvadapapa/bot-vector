import { RateLimitDecision } from './ai.models.js';
import { RateLimitRepository } from './rate-limit.repository.js';

export class RateLimitService {
  private static readonly DAILY_LIMIT = 2;
  private static readonly EXTRA_APPROVAL_QUOTA = 2;
  private static readonly APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly LIMIT_NOTICE_TEMPLATES = [
    (remaining: number, max: number) => `Por recursos limitados hoy te puedo responder hasta ${max} preguntas. Te quedan ${remaining}.`,
    (remaining: number, max: number) => `Vamos tranqui para cuidar recursos: límite diario ${max}. Todavía te quedan ${remaining}.`,
    (remaining: number, max: number) => `Che, por recursos del bot del ISPC hay tope diario de ${max}. Te quedan ${remaining} por hoy.`,
  ];
  private static readonly LIMIT_REACHED_TEMPLATES = [
    (max: number, bonus: number) => `Llegaste al tope diario de ${max}. Si querés seguir, un admin puede aprobar hasta ${bonus} extras.`,
    (max: number, bonus: number) => `Ya usamos las ${max} del día. Si un admin da el ok, te habilito ${bonus} más.`,
    (max: number, bonus: number) => `Tope diario alcanzado (${max}). Con aprobación de admin podés tener ${bonus} preguntas extra.`,
  ];
  private static readonly BONUS_TEMPLATES = [
    (remaining: number) => `Listo, tenés aprobación de admin. Te quedan ${remaining} preguntas extra hoy.`,
    (remaining: number) => `Aprobado por admin ✅. Podés hacer ${remaining} más hoy.`,
    (remaining: number) => `Seguimos: te habilitaron cupo extra y te quedan ${remaining}.`,
  ];
  private static readonly BLOCKED_TEMPLATES = [
    'Llegaste al límite diario. Esperá que algún admin lo apruebe para seguir.',
    'Ya no te quedan preguntas por hoy. Si un admin aprueba, seguimos.',
    'Por ahora se cerró tu cupo diario. Quedás a la espera de aprobación admin.',
  ];
  private static readonly BLOCKED_WITH_REQUEST_TEMPLATES = [
    'Ya llegaste al límite diario. Le pedí a un admin que apruebe 2 preguntas más.',
    'Te quedaste sin cupo por hoy. Cuando un admin dé el ok, te habilito 2 extras.',
    'Límite alcanzado. Queda pendiente que un admin te habilite 2 preguntas más.',
  ];

  private activeLocks = new Map<string, Promise<void>>();

  constructor(private repository: RateLimitRepository) {}

  private async acquireLock(userId: string): Promise<() => void> {
    let releaseLock!: () => void;
    const nextLockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const previousLockPromise = this.activeLocks.get(userId) || Promise.resolve();
    this.activeLocks.set(userId, nextLockPromise);

    await previousLockPromise;

    return () => {
      releaseLock();
      if (this.activeLocks.get(userId) === nextLockPromise) {
        this.activeLocks.delete(userId);
      }
    };
  }

  public async isQuotaExhausted(userId: string, now?: Date, isAdmin = false): Promise<boolean> {
    if (isAdmin) {
      return false;
    }

    const release = await this.acquireLock(userId);
    try {
      const localNow = now ?? new Date();
      const localDate = new Date(localNow.toISOString().slice(0, 10));

      const current = await this.repository.get(userId);
      if (!current) {
        return false;
      }

      const isNewDay = current.last_reset_date.toISOString().slice(0, 10) < localDate.toISOString().slice(0, 10);
      if (isNewDay) {
        return false;
      }

      return current.question_count >= RateLimitService.DAILY_LIMIT && current.bonus_questions_remaining <= 0;
    } finally {
      release();
    }
  }

  public async checkAndConsume(userId: string, now?: Date, isAdmin = false): Promise<RateLimitDecision> {
    if (isAdmin) {
      return {
        allowed: true,
        remaining_after_request: Number.MAX_SAFE_INTEGER,
        message: '',
        quota_message: '',
        approval_pending: false,
      };
    }

    const release = await this.acquireLock(userId);
    try {
      const localNow = now ?? new Date();
      const localDate = new Date(localNow.toISOString().slice(0, 10));

      const current = (await this.repository.get(userId)) ?? {
        user_id: userId,
        question_count: 0,
        last_reset_date: localDate,
        bonus_questions_remaining: 0,
        approval_pending: false,
        approval_requested_at: null,
        approval_expires_at: null,
      };

      const isNewDay = current.last_reset_date.toISOString().slice(0, 10) < localDate.toISOString().slice(0, 10);
      if (isNewDay) {
        current.question_count = 0;
        current.bonus_questions_remaining = 0;
        current.approval_pending = false;
        current.approval_requested_at = null;
        current.approval_expires_at = null;
        current.last_reset_date = localDate;
      }

      if (current.question_count < RateLimitService.DAILY_LIMIT) {
        current.question_count += 1;
        await this.repository.save(current);

        const remaining = RateLimitService.DAILY_LIMIT - current.question_count;
        return {
          allowed: true,
          remaining_after_request: remaining,
          message: '',
          quota_message: remaining > 0
            ? `Por recursos limitados hoy te puedo responder hasta ${RateLimitService.DAILY_LIMIT} preguntas. Te quedan ${remaining}.`
            : `Llegaste al tope diario de ${RateLimitService.DAILY_LIMIT} preguntas. Si necesitás seguir, tu próxima consulta registrará automáticamente un pedido de aprobación para obtener preguntas extra.`,
          approval_pending: false,
        };
      }

      if (current.bonus_questions_remaining > 0) {
        current.bonus_questions_remaining -= 1;
        current.question_count += 1; // Increment total questions asked to track bonus history
        await this.repository.save(current);

        const remaining = current.bonus_questions_remaining;
        return {
          allowed: true,
          remaining_after_request: remaining,
          message: '',
          quota_message: remaining > 0
            ? `Tenés aprobación de admin: te quedan ${remaining} preguntas extra hoy.`
            : `Consumiste tu última pregunta extra aprobada por el administrador. Si volvés a consultar, se registrará una nueva solicitud de aprobación.`,
          approval_pending: false,
        };
      }

      let newlyPending = false;
      if (!current.approval_pending) {
        current.approval_pending = true;
        current.approval_requested_at = localNow;
        current.approval_expires_at = new Date(localNow.getTime() + RateLimitService.APPROVAL_TTL_MS);
        await this.repository.save(current);
        newlyPending = true;
      }

      const hasConsumedBonus = current.question_count > RateLimitService.DAILY_LIMIT;

      return {
        allowed: false,
        remaining_after_request: 0,
        message: newlyPending
          ? (hasConsumedBonus
              ? `Consumiste todas tus preguntas extra. Ya registré una nueva solicitud de aprobación para que un administrador te habilite otras ${RateLimitService.EXTRA_APPROVAL_QUOTA} preguntas.`
              : `Te quedaste sin preguntas por hoy. Ya registré tu solicitud de aprobación para que un administrador te habilite ${RateLimitService.EXTRA_APPROVAL_QUOTA} preguntas extra.`)
          : `Tu solicitud de aprobación sigue pendiente. Por favor, esperá a que un administrador la apruebe para poder continuar.`,
        quota_message: '',
        approval_pending: true,
        newly_pending: newlyPending,
      };
    } finally {
      release();
    }
  }

  public async resetDaily(now?: Date): Promise<void> {
    const localNow = now ?? new Date();
    const localDate = new Date(localNow.toISOString().slice(0, 10));
    await this.repository.resetAll(localDate);
  }

  public async approveNextPendingRequest(now?: Date): Promise<{ userId: string; extraQuestionsGranted: number } | null> {
    const localNow = now ?? new Date();
    const pendingRecord = await this.repository.getOldestPendingApproval(localNow);
    if (!pendingRecord) return null;

    const release = await this.acquireLock(pendingRecord.user_id);
    try {
      const pending = await this.repository.get(pendingRecord.user_id);
      if (!pending || !pending.approval_pending) return null;

      pending.approval_pending = false;
      pending.approval_requested_at = null;
      pending.approval_expires_at = null;
      pending.bonus_questions_remaining = RateLimitService.EXTRA_APPROVAL_QUOTA;
      await this.repository.save(pending);

      return {
        userId: pending.user_id,
        extraQuestionsGranted: RateLimitService.EXTRA_APPROVAL_QUOTA,
      };
    } finally {
      release();
    }
  }

  private pickOne<T>(options: T[]): T {
    return options[Math.floor(Math.random() * options.length)];
  }
}
