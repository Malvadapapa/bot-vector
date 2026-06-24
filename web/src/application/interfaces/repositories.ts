// ============================================================
// Repository Interfaces — Application Layer
// Define contracts that infrastructure must implement.
// ============================================================

import type {
  User,
  Group,
  GroupConfig,
  Cohort,
  Subject,
  Exam,
  ExamType,
  Notice,
  NoticeTargetType,
  ChatMessage,
  BannedUser,
  ImpersonationProfile,
  AuthSession,
  SimulatedStudent,
  WeeklySlot,
  Teacher,
} from '../../domain/entities';

// ── Auth ─────────────────────────────────────────────────────

export interface IAuthRepository {
  sendOTP(email: string): Promise<{ success: boolean; debugCode?: string }>;
  verifyOTP(email: string, code: string): Promise<AuthSession | null>;
  getSession(): AuthSession | null;
  refreshActivity(): void;
  logout(): void;
  isSessionExpired(): boolean;
}

// ── Groups ───────────────────────────────────────────────────

export interface IGroupRepository {
  getAll(): Promise<Group[]>;
  getById(id: string): Promise<Group | null>;
  create(group: Omit<Group, 'id' | 'createdAt'>): Promise<Group>;
  update(id: string, data: Partial<Group>): Promise<Group>;
  delete(id: string): Promise<void>;
  updateConfig(id: string, config: Partial<GroupConfig>): Promise<Group>;
  getCohorts(groupId: string): Promise<Cohort[]>;
  getCommissions(groupId: string): Promise<any[]>;
  getSubjects(groupId: string): Promise<Subject[]>;
  getSubjectsByCohort(cohortId: string): Promise<Subject[]>;
  getTeachers(groupId: string): Promise<Teacher[]>;
  getStudents(groupId: string): Promise<SimulatedStudent[]>;
  getYearsConfig(): Promise<{ year: number; commissionCount: number }[]>;
  updateYearConfig(year: number, commissionCount: number): Promise<void>;
}

// ── Exams ────────────────────────────────────────────────────

export interface IExamRepository {
  getAll(groupId: string): Promise<Exam[]>;
  getBySubject(subjectId: string): Promise<Exam[]>;
  getByType(groupId: string, type: ExamType): Promise<Exam[]>;
  create(exam: Omit<Exam, 'id' | 'createdAt' | 'updatedAt'>): Promise<Exam>;
  update(id: string, data: Partial<Exam>): Promise<Exam>;
  delete(id: string): Promise<void>;
  /**
   * Returns subject IDs where 3 evidences exist but ABP defense is missing.
   */
  getABPWarnings(groupId: string): Promise<{ subjectId: string; subjectName: string }[]>;
  /**
   * Count evidence exams for a subject in the current semester.
   */
  countEvidences(subjectId: string): Promise<number>;
  /**
   * Check if ABP defense exists for a subject.
   */
  hasABPDefense(subjectId: string): Promise<boolean>;
}

// ── Notices ──────────────────────────────────────────────────

export interface INoticeRepository {
  getAll(groupId: string): Promise<Notice[]>;
  getActive(groupId: string): Promise<Notice[]>;
  getByTarget(targetType: NoticeTargetType, targetId: string): Promise<Notice[]>;
  create(notice: Omit<Notice, 'id' | 'createdAt' | 'updatedAt'>): Promise<Notice>;
  update(id: string, data: Partial<Notice>): Promise<Notice>;
  delete(id: string): Promise<void>;
  toggleActive(id: string, active: boolean): Promise<Notice>;
}

// ── Messages ─────────────────────────────────────────────────

export interface IMessageRepository {
  /** Get all professor-sent messages for a group */
  getAll(groupId: string): Promise<ChatMessage[]>;
  /** Send a new professor message */
  send(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage>;
  /** Delete a professor message */
  delete(id: string): Promise<void>;
  /** Get student replies for a specific professor message or notice */
  getReplies(parentMessageId: string, isNotice?: boolean): Promise<ChatMessage[]>;
  /** Send a professor reply within a thread */
  sendReply(reply: Omit<ChatMessage, 'id' | 'timestamp'>, isNotice?: boolean): Promise<ChatMessage>;
  /** Mark replies as read */
  markAsRead(messageIds: string[], isNotice?: boolean): Promise<void>;
  /** Get unread reply count */
  getUnreadCount(groupId: string): Promise<number>;
}

// ── Moderation ───────────────────────────────────────────────

export interface IModerationRepository {
  getBanned(groupId: string): Promise<BannedUser[]>;
  ban(data: Omit<BannedUser, 'id' | 'bannedAt'>): Promise<BannedUser>;
  unban(id: string): Promise<void>;
}

// ── Impersonation ────────────────────────────────────────────

export interface IImpersonationRepository {
  getProfile(): ImpersonationProfile | null;
  activate(profile: Omit<ImpersonationProfile, 'active' | 'queriesUsed'>): ImpersonationProfile;
  deactivate(): void;
  updateQueryLimit(limit: number): void;
  resetQueries(): void;
  setCommission(commissionId: string, commissionName: string): void;
  triggerSimulatedAlert(params: {
    alertType: 'examen' | 'clase' | 'ciclo_lectivo';
    variant?: string;
    timing: string;
    subjectId?: string;
    groupId: string;
  }): Promise<{ success: boolean; messageSent?: string }>;
}

// ── Classes (Weekly Schedule) ────────────────────────────────

export interface IClassRepository {
  getBySubject(subjectId: string): Promise<WeeklySlot[]>;
  getByGroup(groupId: string): Promise<(WeeklySlot & { subjectId: string; subjectName: string; commissions?: any[]; teacherName?: string; teacherEmail?: string })[]>;
  create(subjectId: string, slot: Omit<WeeklySlot, 'id'> & { commissionIds?: string[]; teacherEmail?: string; teacherName?: string }): Promise<WeeklySlot>;
  update(subjectId: string, slotId: string, data: Partial<WeeklySlot> & { commissionIds?: string[]; teacherEmail?: string; teacherName?: string }): Promise<WeeklySlot>;
  delete(subjectId: string, slotId: string): Promise<void>;
}

// ── Admin CRUD ───────────────────────────────────────────────

export interface AdminUser {
  userId: string;
  isSuperAdmin: boolean;
  name?: string;
  email?: string;
  groupId?: string;
  groupName?: string;
}

export interface SearchedUser {
  userId: string;
  name: string;
  email: string;
}

export interface IAdminRepository {
  getAll(): Promise<AdminUser[]>;
  searchUsers(query: string): Promise<SearchedUser[]>;
  createOrUpdate(userId: string, isSuperAdmin: boolean, groupId?: string): Promise<void>;
  delete(userId: string): Promise<void>;
}

// ── Authorized Emails ─────────────────────────────────────────

export interface AuthorizedEmail {
  email: string;
  description: string;
}

export interface IAuthorizedEmailRepository {
  getAll(): Promise<AuthorizedEmail[]>;
  create(email: string, description: string): Promise<AuthorizedEmail>;
  delete(email: string): Promise<void>;
}

// ── Academic Lifecycle / Cycle ────────────────────────────────

export interface AcademicEvent {
  id?: number;
  academic_year?: number;
  academicYear?: number;
  event_type?: string;
  eventType?: string;
  event_name?: string;
  eventName?: string;
  start_date?: string;
  startDate?: string;
  end_date?: string;
  endDate?: string;
  confirmed?: number | boolean;
}

export interface IAcademicCycleRepository {
  getEvents(year: number): Promise<AcademicEvent[]>;
  saveEvents(year: number, events: AcademicEvent[]): Promise<void>;
}

// ── Profile Settings ─────────────────────────────────────────

export interface ProfileSettings {
  name: string;
  email: string;
  phone?: string;
  notifyEmail?: boolean;
  notifyWhatsapp?: boolean;
}

export interface IProfileRepository {
  getSettings(): Promise<ProfileSettings>;
  updateSettings(settings: ProfileSettings): Promise<void>;
  getProfileMe(): Promise<User>;
  sendPhoneOtp(phone: string): Promise<void>;
  verifyPhoneOtp(phone: string, code: string): Promise<void>;
  getMyAssignments(): Promise<any[]>;
}

