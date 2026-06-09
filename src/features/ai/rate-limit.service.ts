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

  constructor(private repository: RateLimitRepository) {}

  public async isQuotaExhausted(userId: string, now?: Date, isAdmin = false): Promise<boolean> {
    if (isAdmin) {
      return false;
    }

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
          ? this.pickOne(RateLimitService.LIMIT_NOTICE_TEMPLATES)(remaining, RateLimitService.DAILY_LIMIT)
          : this.pickOne(RateLimitService.LIMIT_REACHED_TEMPLATES)(RateLimitService.DAILY_LIMIT, RateLimitService.EXTRA_APPROVAL_QUOTA),
        approval_pending: false,
      };
    }

    if (current.bonus_questions_remaining > 0) {
      current.bonus_questions_remaining -= 1;
      await this.repository.save(current);

      return {
        allowed: true,
        remaining_after_request: current.bonus_questions_remaining,
        message: '',
        quota_message: this.pickOne(RateLimitService.BONUS_TEMPLATES)(current.bonus_questions_remaining),
        approval_pending: false,
      };
    }

    if (!current.approval_pending) {
      current.approval_pending = true;
      current.approval_requested_at = localNow;
      current.approval_expires_at = new Date(localNow.getTime() + RateLimitService.APPROVAL_TTL_MS);
      await this.repository.save(current);
    }

    return {
      allowed: false,
      remaining_after_request: 0,
      message: this.pickOne(RateLimitService.BLOCKED_TEMPLATES),
      quota_message: this.pickOne(RateLimitService.BLOCKED_WITH_REQUEST_TEMPLATES),
      approval_pending: true,
    };
  }

  public async resetDaily(now?: Date): Promise<void> {
    const localNow = now ?? new Date();
    const localDate = new Date(localNow.toISOString().slice(0, 10));
    await this.repository.resetAll(localDate);
  }

  public async approveNextPendingRequest(now?: Date): Promise<{ userId: string; extraQuestionsGranted: number } | null> {
    const localNow = now ?? new Date();
    const pending = await this.repository.getOldestPendingApproval(localNow);
    if (!pending) return null;

    pending.approval_pending = false;
    pending.approval_requested_at = null;
    pending.approval_expires_at = null;
    pending.bonus_questions_remaining = RateLimitService.EXTRA_APPROVAL_QUOTA;
    await this.repository.save(pending);

    return {
      userId: pending.user_id,
      extraQuestionsGranted: RateLimitService.EXTRA_APPROVAL_QUOTA,
    };
  }

  private pickOne<T>(options: T[]): T {
    return options[Math.floor(Math.random() * options.length)];
  }
}
