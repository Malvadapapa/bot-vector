export interface UserModerationState {
  id?: number;
  user_id: string;
  warning_count: number;
  suspension_count_week: number;
  first_week_suspension_at?: Date | null;
  temp_ban_until?: Date | null;
  week_ban_until?: Date | null;
  last_offense_at?: Date | null;
}

export interface BannedUserView {
  id: number;
  user_id: string;
  name?: string;
  phone: string;
  ban_type: 'temp' | 'week';
  banned_until: Date;
}

export interface BannedUser {
  userId: string;
  username: string;
  banDate: Date;
  reason: string;
  warnings: 1 | 2 | 3;
  status: 'activo' | 'baneado' | 'levantado';
  unbannedAt?: Date;
  unbannedBy?: string;
}

export interface InfractionRecord {
  userId: string;
  username: string;
  type: string;
  date: Date;
  description: string;
  severity: string;
  warnings: number;
}
