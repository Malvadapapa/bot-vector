import { InstitutionalNoticeRepository, ManagedClassRepository, ManagedExamRepository, ManagedTeacherRepository, ReminderRepository, UserProfileRepository } from '../../infrastructure/persistence/db/repositories.js';

function compact(text: string, limit = 180): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}

/**
 * Información institucional estática — siempre disponible para la IA
 * Esto asegura que tenga acceso consistente a datos generales del ISPC
 */
const INSTITUTIONAL_STATIC_INFO = `
╔════════════════════════════════════════════════════════════════╗
║           INFORMACIÓN INSTITUCIONAL DEL ISPC                  ║
╚════════════════════════════════════════════════════════════════╝

🏫 INSTITUCIÓN
Nombre: Instituto Superior Politécnico Córdoba (ISPC)
Ubicación: Córdoba, Argentina
Carrera: Tecnicatura Superior en Desarrollo de Software (3 años)
Modalidad: Aula Invertida con encuentros sincronicos

────────────────────────────────────────────────────────────────

👥 CONTACTOS PRINCIPALES

👩‍💼 Coordinación
Coordinadora General: Tatiana Manzanelli
Email: coordinacion.software@ispc.edu.ar
Para: Consultas académicas, cambios de horario, trámites administrativos

👩‍🏫 Tutoría
Tutora Virtual: Natalia Morán
Email: tutorias@ispc.edu.ar
Para: Apoyo académico, dudas sobre materias, orientación

📧 Contacto General
Sitio web: www.ispc.edu.ar


────────────────────────────────────────────────────────────────

⚠️ INFORMACIÓN IMPORTANTE

• Las clases son sincronicas para consulta 1 vez por semana pormateria y el resto se dicta en formato aula invertida 
• La asistencia no es obligatoria para regularizar una materia pero si para promocionar(mínimo 80%)
• Para problemas técnicos o consultas: soporte@ispc.edu.ar

────────────────────────────────────────────────────────────────

📞 CÓMO CONTACTAR SEGÚN TU NECESIDAD

¿Problema académico o duda de materia?
→ Coordinadora Tatiana Manzanelli: coordinacion.software@ispc.edu.ar

¿Necesitas apoyo tutorial?
→ Tutora Natalia Morán: tutorias@ispc.edu.ar

¿Problema técnico o administrativo?
→ Email general: consultas@ispc.edu.ar

════════════════════════════════════════════════════════════════
`;

export class KnowledgeContextService {
  constructor(
    private userProfileRepository: UserProfileRepository,
    private examRepository: ManagedExamRepository,
    private noticeRepository: InstitutionalNoticeRepository,
    private classRepository: ManagedClassRepository,
    private reminderRepository: ReminderRepository,
    private teacherRepository: ManagedTeacherRepository,
  ) {}

  public async buildContext(userId: string): Promise<string> {
    const [profile, exams, notices, classes, personalReminders, teachers] = await Promise.all([
      this.userProfileRepository.get(userId),
      this.examRepository.listUpcoming(new Date(), 5),
      this.noticeRepository.listRecent(5),
      this.classRepository.listAll(),
      this.reminderRepository.listRegisteredExams(userId),
      this.teacherRepository.listWithIds(50),
    ]);

    // 1. INFORMACIÓN INSTITUCIONAL ESTÁTICA (siempre primero)
    const parts: string[] = [INSTITUTIONAL_STATIC_INFO];

    // 2. INFORMACIÓN DEL USUARIO
    parts.push('\n─ PERFIL DEL USUARIO ─');
    if (profile) {
      const commissionInfo = profile.user_commission_id ? `, comisión ${profile.user_commission_id}` : ', sin comisión asignada';
      parts.push(`Nombre: ${profile.name} (${profile.birthday_day_month})${profile.email ? ` | Email: ${profile.email}` : ''}${commissionInfo}`);
    } else {
      parts.push('Perfil: No registrado');
    }

    if (exams.length) {
      parts.push('\n─ PRÓXIMOS EXÁMENES ─');
      exams.slice(0, 5).forEach((exam) => {
        parts.push(`• ${exam.subject} - ${exam.exam_date.toISOString().slice(0, 10)} ${exam.exam_time} | ${compact(exam.observations)}`);
      });
    } else {
      parts.push('\n─ PRÓXIMOS EXÁMENES ─\nNo hay exámenes próximos cargados en el sistema.');
    }

    if (notices.length) {
      parts.push('\n─ AVISOS INSTITUCIONALES RECIENTES ─');
      notices.slice(0, 5).forEach((notice) => {
        parts.push(`• ${notice.title}: ${compact(notice.body)}`);
      });
    } else {
      parts.push('\n─ AVISOS INSTITUCIONALES RECIENTES ─\nNo hay avisos vigentes en este momento.');
    }

    if (classes.length) {
      parts.push('\n─ MATERIAS ACTIVAS (HORARIOS DE CURSADA) ─');
      classes.slice(0, 8).forEach((entry) => {
        parts.push(`• ${entry.subject} - ${entry.schedule_day} ${entry.schedule_time}`);
      });
    } else {
      parts.push('\n─ MATERIAS ACTIVAS ─\nNo hay materias ni horarios cargados.');
    }

    if (teachers.length) {
      parts.push('\n─ DIRECTORIO DE PROFESORES Y CONTACTOS ─');
      teachers.slice(0, 10).forEach((t) => {
        const subject = t.teacher.subject ? ` (${t.teacher.subject})` : '';
        parts.push(`• ${t.teacher.name}${subject} - ${t.teacher.email}`);
      });
    } else {
      parts.push('\n─ DIRECTORIO DE PROFESORES ─\nNo hay profesores cargados en el sistema.');
    }

    if (personalReminders.length) {
      parts.push('\n─ RECORDATORIOS RELEVANTES ─');
      personalReminders.slice(0, 5).forEach((reminder) => {
        parts.push(`• ${reminder.event_type} - ${reminder.description} - ${reminder.event_date.toISOString().slice(0, 10)}`);
      });
    }

    return parts.join('\n');
  }
}