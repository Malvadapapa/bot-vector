// ============================================================
// Domain Entities — Vectorito Admin Panel
// Pure TypeScript types. No external dependencies.
// ============================================================

// ── Roles ────────────────────────────────────────────────────

export type UserRole = 'super_admin' | 'group_admin' | 'professor' | 'institutional';

// ── Core Entities ────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  groupIds: string[];
  avatarUrl?: string;
  phone?: string;
}

export interface GroupAdmin {
  name: string;
  phone: string;
}

export interface Group {
  id: string;
  name: string;
  institutionName: string;
  cohortIds: string[];
  config: GroupConfig;
  createdAt: string;
  type: 'cursada' | 'general';
  entryYear?: number;
  cohortYear?: number;
  studentCount?: number;
  commissionsCount?: number;
  isConfigured?: boolean;
  admins?: GroupAdmin[];
}

export interface GroupConfig {
  silenceStartHour: number;    // e.g. 22
  silenceEndHour: number;      // e.g. 7
  dailyQueryLimit: number;     // max queries per student per day
  timezone: string;            // e.g. 'America/Argentina/Buenos_Aires'
  welcomeMessage: string;
}

export interface Cohort {
  id: string;
  name: string;
  year: number;
  groupId: string;
  studentCount: number;
  commissions: Commission[];
}

export interface Commission {
  id: string;
  name: string;        // e.g. "Comisión A", "Turno Mañana"
  cohortId: string;
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  cohortId: string;
  groupId: string;
  professorIds: string[];
  weeklySchedule: WeeklySlot[];
  isAnnual?: boolean;
}

export interface WeeklySlot {
  id: string;
  dayOfWeek: number;     // 0=Sunday … 6=Saturday
  startTime: string;     // "HH:mm"
  endTime: string;       // "HH:mm"
  meetLink?: string;
  classroom?: string;
}

export interface Teacher {
  id: string;
  name: string;
  email: string;
  phone?: string;
  subjectIds: string[];
}

// ── Exams ────────────────────────────────────────────────────

export type ExamType = 'evidence' | 'abp' | 'final' | 'colloquium';

export type AlertTiming = '7d' | '3d' | '2d' | '1d';

export interface ExamAlertConfig {
  timings: AlertTiming[];
  notifyAtRangeStart: boolean;     // "Avisar solo al principio del rango"
  notifyBeforeDeadline: boolean;   // "Avisar antes de finalizar el plazo"
}

export interface Exam {
  id: string;
  subjectId: string;
  groupId: string;
  type: ExamType;
  title: string;
  startDate: string;           // ISO datetime
  endDate?: string;            // ISO datetime — only for 'evidence' type (range)
  evidenceNumber?: 1 | 2 | 3 | 4 | 5 | 6; // only for 'evidence' type (up to 6 for annual)
  alerts: ExamAlertConfig;
  createdBy: string;           // userId
  createdAt: string;
  updatedAt: string;
}

// ── Notices ──────────────────────────────────────────────────

export type NoticeTargetType = 'group' | 'cohort' | 'commission' | 'all_groups' | 'general_groups' | 'cursada_groups' | 'single_group';

export interface Notice {
  id: string;
  groupId: string;
  title: string;
  body: string;
  targetType: NoticeTargetType;
  targetId: string;           // groupId, cohortId, or commissionId
  targetName: string;         // display name of the target
  createdAt: string;
  updatedAt: string;
  authorId: string;
  authorName: string;
  active: boolean;
  startDate?: string;         // Optional range/vigencia start
  endDate?: string;           // Optional range/vigencia end
  frecuencia?: string;        // Optional timing/frequency (e.g. 'unica', 'diaria', etc)
  repliesCount?: number;
  unreadRepliesCount?: number;
}

// ── Chat / Messages ─────────────────────────────────────────

export interface ChatMessage {
  id: string;
  noticeId?: string;           // if this message is tied to a notice
  authorId: string;
  authorName: string;
  authorPhone?: string;
  content: string;
  timestamp: string;
  isFromStudent: boolean;
  parentMessageId?: string;    // the original professor message this replies to
  targetType?: NoticeTargetType;
  targetId?: string;
  targetName?: string;
  readByProfessor?: boolean;
  repliesCount?: number;
  unreadRepliesCount?: number;
}

// ── Authentication ──────────────────────────────────────────

export interface OTPSession {
  email: string;
  code: string;
  createdAt: number;        // epoch ms
  expiresAt: number;        // epoch ms
  lastSentAt: number;       // epoch ms — for debounce
}

export interface AuthSession {
  token: string;
  user: User;
  expiresAt: number;        // epoch ms
  lastActivity: number;     // epoch ms — for inactivity timeout
}

// ── Moderation ──────────────────────────────────────────────

export interface BannedUser {
  id: string;
  phone: string;
  jid?: string;
  studentName?: string;
  reason: string;
  groupId: string;
  bannedAt: string;
  bannedBy: string;          // userId
  bannedByName: string;
}

// ── Impersonation ───────────────────────────────────────────

export interface ImpersonationProfile {
  active: boolean;
  studentName: string;
  studentPhone: string;
  cohortId: string;
  cohortName: string;
  commissionId?: string;
  commissionName?: string;
  dailyQueryLimit: number;
  queriesUsed: number;
  subjectIds: string[];
}

// ── Calendar Events (for Schedule-X integration) ────────────

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;             // ISO datetime or "YYYY-MM-DD HH:mm"
  end: string;
  calendarId: string;        // maps to calendar color category
  description?: string;
  location?: string;
  // Metadata for linking back to domain entities
  _type: 'class' | 'exam' | 'notice';
  _entityId: string;
  _examType?: ExamType;
  _noticeType?: 'general' | 'professor';
}

// ── Utility Types ───────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ── Simulated Student (for chat simulation) ──────────────────

export interface SimulatedStudent {
  id: string;
  name: string;
  phone: string;
  email: string;
  cohortId: string;
  commissionId?: string;
}
