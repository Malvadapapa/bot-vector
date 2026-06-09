export interface RateLimitRecord {
  user_id: string;
  question_count: number;
  last_reset_date: Date;
  bonus_questions_remaining: number;
  approval_pending: boolean;
  approval_requested_at?: Date | null;
  approval_expires_at?: Date | null;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining_after_request: number;
  message: string;
  quota_message: string;
  approval_pending: boolean;
  newly_pending?: boolean;
}

