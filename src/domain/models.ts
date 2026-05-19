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

export interface RateLimitRecord {
  user_id: string;
  question_count: number;
  last_reset_date: Date;
  bonus_questions_remaining: number;
  approval_pending: boolean;
  approval_requested_at?: Date | null;
  approval_expires_at?: Date | null;
}

export interface PendingConfirmation {
  id?: number;
  user_id: string;
  state: string;
  intent: string;
  pending_payload_json: string;
  expires_at: Date;
}

export interface InstitutionalNotice {
  title: string;
  body: string;
  start_date?: Date;
  end_date?: Date;
  event_time?: string;
  source_email?: string;
  unique_hash: string;
}

export interface UserProfile {
  user_id: string;
  name: string;
  birthday_day_month: string;
  email: string;
  user_commission_id?: number;
}

export interface AdminUser {
  user_id: string;
  is_authenticated: boolean;
}

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

export interface SchedulerRunRecord {
  id?: number;
  job_name: string;
  status: 'ok' | 'error';
  message?: string;
  ran_at?: Date;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining_after_request: number;
  message: string;
  quota_message: string;
  approval_pending: boolean;
}

export interface ManagedExam {
  id?: number;
  subject: string;
  exam_date: Date;
  exam_time: string;
  exam_type: string;
  observations: string;
  created_by: string;
  // NUEVOS CAMPOS - Horarios flexibles
  horaInicio?: string;              // "14:30" para franjas
  horaFin?: string;                 // "16:00" para franjas
  tipoDisponibilidad?: 'hora-especifica' | 'franja' | 'a-partir-de'; // Tipo de disponibilidad
  frecuenciaAvisos?: string;        // "7d,3d,1d,20m" formato de avisos
  exam_commission_id?: number;      // Comisión a la que pertenece este examen
  mismaHoraTodasComisiones?: boolean; // Si todas las comisiones tienen el mismo horario
  ultimoAvisoEnviado?: Date;        // Para evitar duplicar avisos
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
}

export interface ManagedClassCreateInput {
  subject: string;
  schedule_day: string;
  schedule_time: string;
  meet_link: string;
  notifications_enabled?: boolean;
  commission_count?: number;
}

export interface ClassNotificationRecord {
  id?: number;
  managed_class_id: number;
  notification_sent_at: Date;
  minutes_before: number;
}

  export interface ManagedTeacher {
    id?: number;
    name: string;
    email: string;
    subject?: string;
    created_at?: Date;
    updated_at?: Date;
  }

  export interface ManagedTeacherCreateInput {
    name: string;
    email: string;
    subject?: string;
  }

// NUEVAS INTERFACES - SISTEMA DE COMISIONES
export interface Comision {
  id: string;
  nombre: string;         // "A", "B", "1", "2", "Única"
  año?: number;
  cuatrimestre?: number;
}

// NUEVAS INTERFACES - LOGGING Y ERRORES
export interface ErrorLog {
  id?: string;
  fecha: Date;
  tipo: 'grave' | 'moderado' | 'leve';
  componente: string;
  descripcion: string;
  stack?: string;
  usuario?: string;
  grupoId?: string;
}

export interface BannedUserRecord {
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

// PHASE 1: Multi-tenant Groups - unlimited groups in database
export interface WhatsAppGroup {
  id?: number;
  group_id: string;      // JID de WhatsApp (e.g., "1234567890-1234567890@g.us")
  display_name?: string; // Nombre personalizado para referencia interna
  is_active: boolean;
  added_by?: string;     // Usuario que registró el grupo
  created_at?: Date;
  updated_at?: Date;
}

// PHASE 2: Academic Commissions - replaces orphaned Comision interface
export interface Commission {
  id?: number;
  name: string;          // "A", "B", "1", "2", "Única", etc.
  year?: number;         // Año académico (2024, 2025, etc.)
  shift?: string;        // Turno (Mañana, Tarde, Noche, etc.)
  created_at?: Date;
  updated_at?: Date;
}

// PHASE 2: Group academic context - maps group to year + commission
export interface GroupContext {
  id?: number;
  group_id: string;              // FK to whatsapp_groups.group_id
  year: number;                  // Academic year for the group
  commission_id?: number | null; // FK to commissions.id (optional)
  label?: string;                // Display label (e.g., "1° Año A")
  configured_by?: string;        // Who configured this context
  created_at?: Date;
  updated_at?: Date;
}

// PHASE 3: Schedule entries that map a managed class to a commission and a weekday/time
export interface ClassCommissionSchedule {
  id?: number;
  managed_class_id: number;
  commission_id: number;
  schedule_day: string;   // e.g., 'lunes'
  schedule_time: string;  // e.g., '14:30'
  meet_link?: string;
  created_at?: Date;
  updated_at?: Date;
}
