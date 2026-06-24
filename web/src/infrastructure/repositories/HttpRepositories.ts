import type {
  IAuthRepository,
  IGroupRepository,
  IExamRepository,
  INoticeRepository,
  IMessageRepository,
  IModerationRepository,
  IImpersonationRepository,
  IClassRepository,
  IAdminRepository,
  IAuthorizedEmailRepository,
  IAcademicCycleRepository,
  IProfileRepository,
  AdminUser,
  SearchedUser,
  AuthorizedEmail,
  AcademicEvent,
  ProfileSettings,
} from '../../application/interfaces/repositories';
import type {
  User,
  Group,
  GroupConfig,
  Cohort,
  Commission,
  Exam,
  ExamType,
  Notice,
  NoticeTargetType,
  ChatMessage,
  BannedUser,
  ImpersonationProfile,
  WeeklySlot,
  Teacher,
  AuthSession,
  Subject,
  SimulatedStudent,
} from '../../domain/entities';
import { toast } from 'sonner';

const originalFetch = window.fetch;

async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const simulated = localStorage.getItem('simulated_user');
  if (simulated) {
    try {
      const parsed = JSON.parse(simulated);
      if (parsed?.email) {
        init = init || {};
        init.headers = {
          ...(init.headers || {}),
          'x-simulate-user': parsed.email
        };
      }
    } catch {}
  }

  try {
    const res = await originalFetch(input, init);
    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem('auth_session');
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login?expired=true';
        }
      }
      const urlStr = typeof input === 'string' ? input : (input as any).url || '';
      if (!urlStr.includes('/api/auth/')) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
    }
    return res;
  } catch (err) {
    if (err instanceof TypeError) {
      toast.error('⚠️ Conexión perdida con el servidor. Es muy probable que el túnel de acceso haya cambiado. Revisá tu WhatsApp para ingresar por el nuevo enlace.', { duration: 15000 });
    }
    throw err;
  }
}

const fetch = safeFetch;
// ── Auth Repository ──────────────────────────────────────────
export class HttpAuthRepository implements IAuthRepository {
  async sendOTP(email: string) {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    return { success: data.success, debugCode: data.debugCode };
  }

  async verifyOTP(email: string, code: string): Promise<AuthSession | null> {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success) return null;
    
    const session: AuthSession = {
      token: data.token,
      user: data.user,
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      lastActivity: Date.now(),
    };
    localStorage.setItem('auth_session', JSON.stringify(session));
    return session;
  }

  getSession(): AuthSession | null {
    const val = localStorage.getItem('auth_session');
    if (!val) return null;
    try {
      const session = JSON.parse(val);
      if (Date.now() > session.expiresAt) {
        this.logout();
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  refreshActivity() {
    const session = this.getSession();
    if (session) {
      session.lastActivity = Date.now();
      session.expiresAt = Date.now() + 2 * 60 * 60 * 1000;
      localStorage.setItem('auth_session', JSON.stringify(session));
    }
  }

  logout() {
    localStorage.removeItem('auth_session');
  }

  isSessionExpired() {
    return this.getSession() === null;
  }
}

// ── Group Repository ─────────────────────────────────────────
export class HttpGroupRepository implements IGroupRepository {
  private getHeaders() {
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  async getAll(): Promise<Group[]> {
    const res = await fetch('/api/groups', { headers: this.getHeaders() });
    return res.json();
  }

  async getById(id: string): Promise<Group | null> {
    const groups = await this.getAll();
    return groups.find(g => g.id === id) || null;
  }

  async create(group: Omit<Group, 'id' | 'createdAt'>): Promise<Group> {
    throw new Error('Las comisiones se configuran en el onboarding desde los grupos de WhatsApp.');
  }

  async update(id: string, data: Partial<Group>): Promise<Group> {
    const res = await fetch(`/api/groups/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al actualizar el grupo.');
    const updated = await this.getById(id);
    if (!updated) throw new Error('Grupo no encontrado.');
    return updated;
  }

  async delete(id: string): Promise<void> {
    const res = await fetch(`/api/groups/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error('Error al eliminar el grupo.');
  }

  async updateConfig(id: string, config: Partial<GroupConfig>): Promise<Group> {
    return this.update(id, { config } as any);
  }

  async getCohorts(groupId: string): Promise<Cohort[]> {
    const group = await this.getById(groupId);
    if (!group || !group.cohortYear) return [];
    return [{
      id: `camada:${group.cohortYear}`,
      name: `Cohorte ${group.cohortYear}`,
      year: group.cohortYear,
      groupId,
      studentCount: group.studentCount || 0,
      commissions: [
        { id: '1', name: 'Comisión A', cohortId: `camada:${group.cohortYear}` },
        { id: '2', name: 'Comisión B', cohortId: `camada:${group.cohortYear}` }
      ]
    }];
  }

  async getCommissions(groupId: string): Promise<any[]> {
    const res = await fetch(`/api/groups/${groupId}/commissions`, { headers: this.getHeaders() });
    return res.json();
  }

  async getSubjects(groupId: string): Promise<Subject[]> {
    const res = await fetch(`/api/groups/${groupId}/subjects`, { headers: this.getHeaders() });
    return res.json();
  }

  async getSubjectsByCohort(cohortId: string): Promise<Subject[]> {
    const cohortYearStr = cohortId.replace('camada:', '');
    const cohortYear = parseInt(cohortYearStr, 10);
    let cursadaYear = 1;
    if (!isNaN(cohortYear) && cohortYear > 2000) {
      const currentYear = new Date().getFullYear();
      cursadaYear = currentYear - cohortYear + 1;
      if (cursadaYear < 1) cursadaYear = 1;
      if (cursadaYear > 3) cursadaYear = 3;
    } else if (!isNaN(cohortYear)) {
      cursadaYear = cohortYear;
    }
    const res = await fetch(`/api/subjects/preseeded?year=${cursadaYear}`, { headers: this.getHeaders() });
    return res.json();
  }

  async getTeachers(groupId: string): Promise<Teacher[]> {
    const res = await fetch(`/api/teachers?groupId=${groupId}`, { headers: this.getHeaders() });
    if (!res.ok) return [];
    return res.json();
  }

  async getStudents(groupId: string): Promise<SimulatedStudent[]> {
    return [];
  }

  async getYearsConfig(): Promise<{ year: number; commissionCount: number }[]> {
    const res = await fetch('/api/subjects/years-config', { headers: this.getHeaders() });
    if (!res.ok) throw new Error('Error al obtener la configuración de comisiones por año.');
    return res.json();
  }

  async updateYearConfig(year: number, commissionCount: number): Promise<void> {
    const res = await fetch('/api/subjects/years-config', {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ year, commissionCount }),
    });
    if (!res.ok) throw new Error('Error al actualizar la configuración de comisiones por año.');
  }
}

// ── Exam Repository ──────────────────────────────────────────
export class HttpExamRepository implements IExamRepository {
  private getHeaders() {
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  async getAll(groupId: string): Promise<Exam[]> {
    const res = await fetch(`/api/exams?groupId=${groupId}`, { headers: this.getHeaders() });
    return res.json();
  }

  async getBySubject(subjectId: string): Promise<Exam[]> {
    const res = await fetch(`/api/exams`, { headers: this.getHeaders() });
    const allExams: Exam[] = await res.json();
    return allExams.filter(e => e.subjectId === subjectId);
  }

  async getByType(groupId: string, type: ExamType): Promise<Exam[]> {
    const allExams = await this.getAll(groupId);
    return allExams.filter(e => e.type === type);
  }

  async create(exam: Omit<Exam, 'id' | 'createdAt' | 'updatedAt'>): Promise<Exam> {
    const res = await fetch('/api/exams', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(exam),
    });
    if (!res.ok) throw new Error('Error al registrar el examen.');
    const data = await res.json();
    return {
      ...exam,
      id: data.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Exam;
  }

  async update(id: string, data: Partial<Exam>): Promise<Exam> {
    const res = await fetch(`/api/exams/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al actualizar el examen.');
    return { id, ...data } as Exam;
  }

  async delete(id: string): Promise<void> {
    const res = await fetch(`/api/exams/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error('Error al eliminar el examen.');
  }

  async getABPWarnings(groupId: string): Promise<{ subjectId: string; subjectName: string }[]> {
    return [];
  }

  async countEvidences(subjectId: string): Promise<number> {
    const exams = await this.getBySubject(subjectId);
    return exams.filter(e => e.type === 'evidence').length;
  }

  async hasABPDefense(subjectId: string): Promise<boolean> {
    const exams = await this.getBySubject(subjectId);
    return exams.some(e => e.type === 'abp');
  }
}

// ── Notice Repository ────────────────────────────────────────
export class HttpNoticeRepository implements INoticeRepository {
  private getHeaders() {
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  async getAll(groupId: string): Promise<Notice[]> {
    const res = await fetch('/api/notices', { headers: this.getHeaders() });
    const allNotices: Notice[] = await res.json();
    
    try {
      const groupsRes = await fetch('/api/groups', { headers: this.getHeaders() });
      if (groupsRes.ok) {
        const groups = await groupsRes.json();
        const activeGroup = groups.find((g: any) => g.id === groupId);
        if (activeGroup) {
          return allNotices.filter(n => {
            if (n.groupId === groupId) return true;
            if (n.groupId === 'todos' || n.groupId === 'all') return true;
            const isCursada = activeGroup.entryYear !== null && activeGroup.entryYear !== undefined;
            if (n.groupId === 'general' && !isCursada) return true;
            if (n.groupId === 'cursada' && isCursada) return true;
            if (activeGroup.cohortYear && n.groupId === `camada:${activeGroup.cohortYear}`) return true;
            return false;
          });
        }
      }
    } catch (e) {
      console.error('[HttpNoticeRepository] Error matching notice targets:', e);
    }

    return allNotices.filter(n => n.groupId === groupId || n.groupId === 'todos' || n.groupId === 'all' || n.groupId === 'general');
  }

  async getActive(groupId: string): Promise<Notice[]> {
    const allNotices = await this.getAll(groupId);
    return allNotices.filter(n => n.active);
  }

  async getByTarget(targetType: NoticeTargetType, targetId: string): Promise<Notice[]> {
    const res = await fetch('/api/notices', { headers: this.getHeaders() });
    const allNotices: Notice[] = await res.json();
    return allNotices.filter(n => n.targetType === targetType && n.targetId === targetId);
  }

  async create(notice: Omit<Notice, 'id' | 'createdAt' | 'updatedAt'>): Promise<Notice> {
    const res = await fetch('/api/notices', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(notice),
    });
    if (!res.ok) throw new Error('Error al crear el aviso.');
    return {
      ...notice,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      active: true
    } as Notice;
  }

  async update(id: string, data: Partial<Notice>): Promise<Notice> {
    return { id, ...data } as Notice;
  }

  async delete(id: string): Promise<void> {
    const res = await fetch(`/api/notices/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error('Error al eliminar el aviso.');
  }

  async toggleActive(id: string, active: boolean): Promise<Notice> {
    return { id, active } as Notice;
  }
}

// ── Class Repository ─────────────────────────────────────────
export class HttpClassRepository implements IClassRepository {
  private getHeaders() {
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  async getBySubject(subjectId: string): Promise<WeeklySlot[]> {
    const res = await fetch(`/api/classes`, { headers: this.getHeaders() });
    const classes = await res.json();
    return classes.filter((c: any) => c.subjectId === subjectId);
  }

  async getByGroup(groupId: string): Promise<(WeeklySlot & { subjectId: string; subjectName: string; commissions?: any[]; teacherName?: string; teacherEmail?: string })[]> {
    const res = await fetch(`/api/classes?groupId=${groupId}`, { headers: this.getHeaders() });
    return res.json();
  }

  async create(subjectId: string, slot: Omit<WeeklySlot, 'id'> & { commissionIds?: string[]; teacherEmail?: string; teacherName?: string }): Promise<WeeklySlot> {
    const activeGroupVal = localStorage.getItem('active_group') || localStorage.getItem('active_group_id');
    const activeGroup = activeGroupVal ? (activeGroupVal.startsWith('{') ? JSON.parse(activeGroupVal) : { id: activeGroupVal }) : null;
    const groupId = activeGroup?.id || '';

    const res = await fetch('/api/classes', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ subjectId, groupId, ...slot }),
    });
    if (!res.ok) throw new Error('Error al registrar horario de clase.');
    const result = await res.json();
    return result.data;
  }

  async update(subjectId: string, slotId: string, data: Partial<WeeklySlot> & { commissionIds?: string[]; teacherEmail?: string; teacherName?: string }): Promise<WeeklySlot> {
    const res = await fetch(`/api/classes/${subjectId}/${slotId}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al actualizar el horario.');
    return { id: slotId, ...data } as WeeklySlot;
  }

  async delete(subjectId: string, slotId: string): Promise<void> {
    const res = await fetch(`/api/classes/${subjectId}/${slotId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error('Error al eliminar el horario.');
  }
}

// ── Message Repository ───────────────────────────────────────
export class HttpMessageRepository implements IMessageRepository {
  private getHeaders() {
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  async getAll(groupId: string): Promise<ChatMessage[]> {
    const res = await fetch(`/api/messages?groupId=${groupId}`, { headers: this.getHeaders() });
    if (!res.ok) return [];
    return res.json();
  }

  async send(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage> {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(message),
    });
    if (!res.ok) throw new Error('Error al enviar mensaje.');
    const data = await res.json();
    return {
      ...message,
      id: data.data.id,
      timestamp: data.data.timestamp,
    } as ChatMessage;
  }

  async delete(id: string): Promise<void> {
    const res = await fetch(`/api/messages/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error('Error al eliminar mensaje.');
  }

  async getReplies(parentMessageId: string, isNotice?: boolean): Promise<ChatMessage[]> {
    const url = isNotice ? `/api/notices/${parentMessageId}/replies` : `/api/messages/${parentMessageId}/replies`;
    const res = await fetch(url, { headers: this.getHeaders() });
    if (!res.ok) return [];
    return res.json();
  }

  async sendReply(reply: Omit<ChatMessage, 'id' | 'timestamp'>, isNotice?: boolean): Promise<ChatMessage> {
    const url = isNotice ? '/api/notices/reply' : '/api/messages/reply';
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(reply),
    });
    if (!res.ok) throw new Error('Error al responder.');
    return res.json();
  }

  async markAsRead(messageIds: string[], isNotice?: boolean): Promise<void> {
    const url = isNotice ? '/api/notices/mark-read' : '/api/messages/mark-read';
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ messageIds }),
    });
    if (!res.ok) throw new Error('Error al marcar mensajes como leídos.');
  }

  async getUnreadCount(groupId: string): Promise<number> {
    const res = await fetch('/api/messages/unread-count', { headers: this.getHeaders() });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.count || 0;
  }
}

// ── Moderation Repository ────────────────────────────────────
export class HttpModerationRepository implements IModerationRepository {
  private getHeaders() {
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  async getBanned(groupId: string): Promise<BannedUser[]> {
    const res = await fetch(`/api/moderation/users?groupId=${groupId}`, { headers: this.getHeaders() });
    if (!res.ok) return [];
    return res.json();
  }

  async ban(data: Omit<BannedUser, 'id' | 'bannedAt'>): Promise<BannedUser> {
    const res = await fetch('/api/moderation/ban', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al banear usuario.');
    return {
      ...data,
      id: data.jid || data.phone,
      bannedAt: new Date().toISOString(),
    } as BannedUser;
  }

  async unban(id: string): Promise<void> {
    const res = await fetch('/api/moderation/unban', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ userJid: id }),
    });
    if (!res.ok) throw new Error('Error al desbanear usuario.');
  }
}

// ── Impersonation Repository ─────────────────────────────────
export class HttpImpersonationRepository implements IImpersonationRepository {
  private getHeaders() {
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  private getLocal(): ImpersonationProfile | null {
    const data = localStorage.getItem('vectorito_impersonation');
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  private setLocal(profile: ImpersonationProfile | null) {
    if (profile === null) {
      localStorage.removeItem('vectorito_impersonation');
    } else {
      localStorage.setItem('vectorito_impersonation', JSON.stringify(profile));
    }
  }

  getProfile(): ImpersonationProfile | null {
    return this.getLocal();
  }

  activate(profile: Omit<ImpersonationProfile, 'active' | 'queriesUsed'>): ImpersonationProfile {
    const full: ImpersonationProfile = { ...profile, active: true, queriesUsed: 0 };
    this.setLocal(full);

    // Sync to backend asynchronously
    fetch('/api/impersonation', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ active: true, commissionId: profile.commissionId, dailyQueryLimit: profile.dailyQueryLimit }),
    }).catch(err => console.error('[ImpersonationRepo] Error syncing activation:', err));

    return full;
  }

  deactivate(): void {
    this.setLocal(null);

    // Sync to backend asynchronously
    fetch('/api/impersonation', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ active: false }),
    }).catch(err => console.error('[ImpersonationRepo] Error syncing deactivation:', err));
  }

  updateQueryLimit(limit: number): void {
    const profile = this.getLocal();
    if (profile) {
      profile.dailyQueryLimit = limit;
      this.setLocal(profile);

      fetch('/api/impersonation', {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ dailyQueryLimit: limit }),
      }).catch(err => console.error('[ImpersonationRepo] Error syncing query limit:', err));
    }
  }

  resetQueries(): void {
    const profile = this.getLocal();
    if (profile) {
      profile.queriesUsed = 0;
      this.setLocal(profile);

      fetch('/api/impersonation/reset-quota', {
        method: 'POST',
        headers: this.getHeaders(),
      }).catch(err => console.error('[ImpersonationRepo] Error syncing reset queries:', err));
    }
  }

  setCommission(commissionId: string, commissionName: string): void {
    const profile = this.getLocal();
    if (profile) {
      profile.commissionId = commissionId;
      profile.commissionName = commissionName;
      this.setLocal(profile);

      fetch('/api/impersonation', {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ commissionId, commissionName }),
      }).catch(err => console.error('[ImpersonationRepo] Error syncing commission:', err));
    }
  }

  async triggerSimulatedAlert(params: {
    alertType: 'examen' | 'clase' | 'ciclo_lectivo';
    variant?: string;
    timing: string;
    subjectId?: string;
    groupId: string;
  }): Promise<{ success: boolean; messageSent?: string }> {
    const res = await fetch('/api/simulation/trigger-alert', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Error al disparar alerta de prueba.');
    return res.json();
  }
}

// ── Admin Repository ─────────────────────────────────────────
export class HttpAdminRepository implements IAdminRepository {
  private getHeaders() {
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  async getAll(): Promise<AdminUser[]> {
    const res = await fetch('/api/admins', { headers: this.getHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((item: any) => ({
      userId: item.id,
      isSuperAdmin: !!item.isSuperAdmin,
      name: item.name,
      email: item.email,
      groupId: item.groupId || undefined,
      groupName: item.groupName || undefined
    }));
  }

  async searchUsers(query: string): Promise<SearchedUser[]> {
    const res = await fetch(`/api/admins/search-users?q=${encodeURIComponent(query)}`, { headers: this.getHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((item: any) => ({
      userId: item.id,
      name: item.name,
      email: item.email
    }));
  }

  async createOrUpdate(userId: string, isSuperAdmin: boolean, groupId?: string): Promise<void> {
    const res = await fetch('/api/admins', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ userId, isSuperAdmin, groupId })
    });
    if (!res.ok) throw new Error('Error al registrar administrador.');
  }

  async delete(userId: string): Promise<void> {
    const res = await fetch(`/api/admins/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error('Error al eliminar administrador.');
  }
}

// ── Authorized Email Repository ────────────────────────────────
export class HttpAuthorizedEmailRepository implements IAuthorizedEmailRepository {
  private getHeaders() {
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  async getAll(): Promise<AuthorizedEmail[]> {
    const res = await fetch('/api/authorized-emails', { headers: this.getHeaders() });
    if (!res.ok) return [];
    return res.json();
  }

  async create(email: string, description: string): Promise<AuthorizedEmail> {
    const res = await fetch('/api/authorized-emails', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ email, description })
    });
    if (!res.ok) throw new Error('Error al registrar email autorizado.');
    return res.json();
  }

  async delete(email: string): Promise<void> {
    const res = await fetch(`/api/authorized-emails/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error('Error al eliminar email autorizado.');
  }
}

// ── Academic Cycle Repository ────────────────────────────────
export class HttpAcademicCycleRepository implements IAcademicCycleRepository {
  private getHeaders() {
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  async getEvents(year: number): Promise<AcademicEvent[]> {
    const res = await fetch(`/api/academic-calendar/events?year=${year}`, { headers: this.getHeaders() });
    if (!res.ok) return [];
    return res.json();
  }

  async saveEvents(year: number, events: AcademicEvent[]): Promise<void> {
    const res = await fetch('/api/academic-calendar/events', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ year, events })
    });
    if (!res.ok) throw new Error('Error al guardar eventos académicos.');
  }
}

// ── Profile Repository ───────────────────────────────────────
export class HttpProfileRepository implements IProfileRepository {
  private getHeaders() {
    const session = localStorage.getItem('auth_session');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  async getSettings(): Promise<ProfileSettings> {
    const res = await fetch('/api/profile/settings', { headers: this.getHeaders() });
    if (!res.ok) throw new Error('Error al obtener ajustes de perfil.');
    return res.json();
  }

  async updateSettings(settings: ProfileSettings): Promise<void> {
    const res = await fetch('/api/profile/settings', {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(settings)
    });
    if (!res.ok) throw new Error('Error al guardar ajustes de perfil.');
  }

  async getProfileMe(): Promise<User> {
    const res = await fetch('/api/profile/me', { headers: this.getHeaders() });
    if (!res.ok) throw new Error('Error al obtener perfil actual.');
    return res.json();
  }
}

