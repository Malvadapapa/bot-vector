export interface InstitutionalNotice {
  title: string;
  body: string;
  start_date?: Date;
  end_date?: Date;
  event_time?: string;
  source_email?: string;
  unique_hash: string;
  frecuencia?: string;
  grupo_selector?: string;
  published_at?: Date;
  confirmed_at?: Date;
  last_sent_at?: Date;
}

export interface ClassNotificationRecord {
  id?: number;
  managed_class_id: number;
  notification_sent_at: Date;
  minutes_before: number;
}
