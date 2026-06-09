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
  is_super_admin?: boolean;
}

export interface SchedulerRunRecord {
  id?: number;
  job_name: string;
  status: 'ok' | 'error';
  message?: string;
  ran_at?: Date;
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

// Grupos multi-tenant de WhatsApp
export interface WhatsAppGroup {
  id?: number;
  group_id: string;      // JID de WhatsApp (e.g., "1234567890-1234567890@g.us")
  display_name?: string; // Nombre personalizado para referencia interna
  is_active: boolean;
  added_by?: string;     // Usuario que registró el grupo
  entry_year?: number | null; // Año de ingreso de la camada (null = general)
  created_at?: Date;
  updated_at?: Date;
}

export type { Reminder, ReminderCreateInput, ManagedExam, ManagedClass, ManagedClassCreateInput, ManagedTeacher, ManagedTeacherCreateInput, Commission, GroupContext, CohortConfig, ClassCommissionSchedule } from '../features/academic-calendar/academic-calendar.models.js';