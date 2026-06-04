import {
  InstitutionalNoticeRepository,
  ManagedClassRepository,
  ManagedExamRepository,
  ManagedTeacherRepository,
  ReminderRepository,
  UserProfileRepository,
  GroupMembershipRepository,
  CommissionRepository
} from '../../infrastructure/persistence/db/repositories.js';
import { GroupContextRepository } from '../academic-calendar/academic-calendar.repository.js';

function compact(text: string, limit = 180): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}

export class KnowledgeContextService {
  constructor(
    private userProfileRepository: UserProfileRepository,
    private examRepository: ManagedExamRepository,
    private noticeRepository: InstitutionalNoticeRepository,
    private classRepository: ManagedClassRepository,
    private reminderRepository: ReminderRepository,
    private teacherRepository: ManagedTeacherRepository,
    private groupContextRepository?: GroupContextRepository,
    private groupMembershipRepository?: GroupMembershipRepository,
    private commissionRepository?: CommissionRepository,
  ) {}

  public async buildContext(userId: string, groupId?: string): Promise<string> {
    const [profile, exams, notices, classes, personalReminders, teachers] = await Promise.all([
      this.userProfileRepository.get(userId),
      this.examRepository.listUpcoming(new Date(), 5, groupId),
      this.noticeRepository.listRecent(5),
      this.classRepository.listAll(groupId),
      this.reminderRepository.listRegisteredExams(userId),
      this.teacherRepository.listWithIds(50, groupId),
    ]);

    const commissionId = await this.resolveCommissionId(userId, profile?.user_commission_id ?? null, groupId);
    const strictGroupScope = Boolean(groupId);
    const scopedClasses = this.filterClassesByCommission(classes, commissionId, strictGroupScope);
    const scopedExams = this.filterExamsByCommission(exams, commissionId, strictGroupScope);

    const parts: string[] = [];

    // 1. INFORMACIÓN DEL USUARIO
    parts.push('\n─ PERFIL DEL USUARIO ─');
    if (profile) {
      let commissionInfo = ', sin comisión asignada';
      if (commissionId !== null) {
        if (this.commissionRepository) {
          try {
            const comm = await this.commissionRepository.getById(commissionId);
            if (comm) {
              const rawName = comm.name || '';
              const friendlyName = rawName.toLowerCase().includes('comisi') ? rawName : `Comisión ${rawName}`;
              commissionInfo = `, ${friendlyName}`;
            } else {
              commissionInfo = `, comisión ID ${commissionId}`;
            }
          } catch {
            commissionInfo = `, comisión ID ${commissionId}`;
          }
        } else {
          commissionInfo = `, comisión ID ${commissionId}`;
        }
      }
      parts.push(`Nombre: ${profile.name} (${profile.birthday_day_month})${profile.email ? ` | Email: ${profile.email}` : ''}${commissionInfo}`);
    } else {
      parts.push('Perfil: No registrado');
    }

    // 2. PRÓXIMOS EXÁMENES
    if (scopedExams.length) {
      parts.push('\n─ PRÓXIMOS EXÁMENES ─');
      scopedExams.slice(0, 5).forEach((exam) => {
        parts.push(`• ${exam.subject} - ${exam.exam_date.toISOString().slice(0, 10)} ${exam.exam_time} | ${compact(exam.observations)}`);
      });
    } else {
      parts.push('\n─ PRÓXIMOS EXÁMENES ─\nNo hay exámenes próximos cargados en el sistema.');
    }

    // 3. AVISOS INSTITUCIONALES
    if (notices.length) {
      parts.push('\n─ AVISOS INSTITUCIONALES RECIENTES ─');
      for (const notice of notices.slice(0, 5)) {
        let senderInfo = notice.source_email || 'Institucional';
        if (notice.source_email) {
          try {
            const teacher = await this.teacherRepository.getByEmail(notice.source_email);
            if (teacher) {
              senderInfo = `Profesor: ${teacher.name} (${teacher.subject})`;
            }
          } catch (e) {
            // ignore
          }
        }
        parts.push(`• [Aviso de ${senderInfo}] ${notice.title}: ${compact(notice.body)}`);
      }
    } else {
      parts.push('\n─ AVISOS INSTITUCIONALES RECIENTES ─\nNo hay avisos vigentes en este momento.');
    }

    // 4. MATERIAS ACTIVAS
    if (scopedClasses.length) {
      parts.push('\n─ MATERIAS ACTIVAS (HORARIOS DE CURSADA) ─');
      scopedClasses.slice(0, 8).forEach((entry) => {
        parts.push(`• ${entry.subject} - ${entry.schedule_day} ${entry.schedule_time}`);
      });
    } else {
      parts.push('\n─ MATERIAS ACTIVAS ─\nNo hay materias ni horarios cargados.');
    }

    // 5. DIRECTORIO DE PROFESORES
    if (teachers.length) {
      parts.push('\n─ DIRECTORIO DE PROFESORES Y CONTACTOS ─');
      teachers.slice(0, 10).forEach((t) => {
        const subject = t.teacher.subject ? ` (${t.teacher.subject})` : '';
        parts.push(`• ${t.teacher.name}${subject} - ${t.teacher.email}`);
      });
    } else {
      parts.push('\n─ DIRECTORIO DE PROFESORES ─\nNo hay profesores cargados en el sistema.');
    }

    // 6. RECORDATORIOS RELEVANTES
    if (personalReminders.length) {
      parts.push('\n─ RECORDATORIOS RELEVANTES ─');
      personalReminders.slice(0, 5).forEach((reminder) => {
        parts.push(`• ${reminder.event_type} - ${reminder.description} - ${reminder.event_date.toISOString().slice(0, 10)}`);
      });
    }

    return parts.join('\n');
  }

  private async resolveCommissionId(userId: string, fallbackCommissionId: number | null, groupId?: string): Promise<number | null> {
    if (groupId) {
      // 1. Check group membership commission first
      if (this.groupMembershipRepository) {
        try {
          const membership = await this.groupMembershipRepository.getMembership(groupId, userId);
          if (membership && typeof membership.commission_id === 'number') {
            return membership.commission_id;
          }
        } catch {
          // ignore
        }
      }

      // 2. Fallback to group context/commissions
      if (this.groupContextRepository) {
        try {
          const groupContext = await this.groupContextRepository.getByGroupId(groupId);
          if (groupContext) {
            if (typeof groupContext.commission_id === 'number') {
              return groupContext.commission_id;
            }

            if (typeof groupContext.id === 'number') {
              const commissions = await this.groupContextRepository.listCommissionsForGroupContext(groupContext.id);
              if (commissions.length === 1 && typeof commissions[0].id === 'number') {
                return commissions[0].id;
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }

    return typeof fallbackCommissionId === 'number' ? fallbackCommissionId : null;
  }

  private filterClassesByCommission<T extends { commission_count: number }>(classes: T[], commissionId: number | null, strictScope: boolean): T[] {
    if (commissionId === null) {
      return classes;
    }
    return classes.filter((entry) => entry.commission_count === 1 || entry.commission_count === commissionId);
  }

  private filterExamsByCommission<T extends { exam_commission_id?: number | null }>(exams: T[], commissionId: number | null, strictScope: boolean): T[] {
    if (commissionId === null) {
      return exams;
    }
    return exams.filter((entry) => entry.exam_commission_id === undefined || entry.exam_commission_id === null || entry.exam_commission_id === commissionId);
  }
}
