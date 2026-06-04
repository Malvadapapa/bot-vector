export interface Reminder {
  id?: number;
  user_id: string;
  event_type: string;
  description: string;
  event_date: Date;
  status?: string;
  source?: string;
  group_id?: string;
  notify_7d_sent?: boolean;
  notify_3d_sent?: boolean;
}

export interface ReminderCreateInput {
  user_id: string;
  event_type: string;
  description: string;
  event_date: Date;
  status?: string;
  source?: string;
  group_id?: string | null;
  notify_7d_sent?: boolean;
  notify_3d_sent?: boolean;
}

export interface ManagedExam {
  id?: number;
  subject: string;
  exam_date: Date;
  exam_time: string;
  exam_type: string;
  observations: string;
  created_by: string;
  horaInicio?: string;
  horaFin?: string;
  tipoDisponibilidad?: 'hora-especifica' | 'franja' | 'a-partir-de';
  frecuenciaAvisos?: string;
  exam_commission_id?: number;
  mismaHoraTodasComisiones?: boolean;
  ultimoAvisoEnviado?: Date;
  group_id?: string;
}

export interface ManagedClass {
  id?: number;
  subject: string;
  schedule_day: string;
  schedule_time: string;
  meet_link: string;
  notifications_enabled: boolean;
  commission_count: number;
  created_at?: Date;
  updated_at?: Date;
  group_id?: string;
}

export interface ManagedClassCreateInput {
  subject: string;
  schedule_day: string;
  schedule_time: string;
  meet_link: string;
  notifications_enabled?: boolean;
  commission_count?: number;
  group_id?: string;
}

export interface ManagedTeacher {
  id?: number;
  name: string;
  email: string;
  subject?: string;
  created_at?: Date;
  updated_at?: Date;
  group_id?: string;
  commission_id?: number;
}

export interface ManagedTeacherCreateInput {
  name: string;
  email: string;
  subject?: string;
  group_id?: string;
  commission_id?: number;
}

export interface Commission {
  id?: number;
  name: string;
  year?: number;
  shift?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface GroupContext {
  id?: number;
  group_id: string;
  year: number;
  commission_id?: number | null;
  label?: string;
  configured_by?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface CohortConfig {
  id?: number;
  entry_year: number;
  configs_json: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface ClassCommissionSchedule {
  id?: number;
  managed_class_id: number;
  commission_id: number;
  schedule_day: string;
  schedule_time: string;
  meet_link?: string;
  created_at?: Date;
  updated_at?: Date;
}
