"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeContextService = void 0;
function compact(text, limit = 180) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= limit)
        return normalized;
    return `${normalized.slice(0, limit - 3)}...`;
}
class KnowledgeContextService {
    constructor(userProfileRepository, examRepository, noticeRepository, classRepository, reminderRepository, teacherRepository) {
        this.userProfileRepository = userProfileRepository;
        this.examRepository = examRepository;
        this.noticeRepository = noticeRepository;
        this.classRepository = classRepository;
        this.reminderRepository = reminderRepository;
        this.teacherRepository = teacherRepository;
    }
    async buildContext(userId) {
        const [profile, exams, notices, classes, personalReminders, teachers] = await Promise.all([
            this.userProfileRepository.get(userId),
            this.examRepository.listUpcoming(new Date(), 5),
            this.noticeRepository.listRecent(5),
            this.classRepository.listAll(),
            this.reminderRepository.listRegisteredExams(userId),
            this.teacherRepository.listWithIds(50),
        ]);
        const parts = [];
        // 1. INFORMACIÓN DEL USUARIO
        parts.push('\n─ PERFIL DEL USUARIO ─');
        if (profile) {
            const commissionInfo = profile.user_commission_id ? `, comisión ${profile.user_commission_id}` : ', sin comisión asignada';
            parts.push(`Nombre: ${profile.name} (${profile.birthday_day_month})${profile.email ? ` | Email: ${profile.email}` : ''}${commissionInfo}`);
        }
        else {
            parts.push('Perfil: No registrado');
        }
        // 2. PRÓXIMOS EXÁMENES
        if (exams.length) {
            parts.push('\n─ PRÓXIMOS EXÁMENES ─');
            exams.slice(0, 5).forEach((exam) => {
                parts.push(`• ${exam.subject} - ${exam.exam_date.toISOString().slice(0, 10)} ${exam.exam_time} | ${compact(exam.observations)}`);
            });
        }
        else {
            parts.push('\n─ PRÓXIMOS EXÁMENES ─\nNo hay exámenes próximos cargados en el sistema.');
        }
        // 3. AVISOS INSTITUCIONALES
        if (notices.length) {
            parts.push('\n─ AVISOS INSTITUCIONALES RECIENTES ─');
            notices.slice(0, 5).forEach((notice) => {
                parts.push(`• ${notice.title}: ${compact(notice.body)}`);
            });
        }
        else {
            parts.push('\n─ AVISOS INSTITUCIONALES RECIENTES ─\nNo hay avisos vigentes en este momento.');
        }
        // 4. MATERIAS ACTIVAS
        if (classes.length) {
            parts.push('\n─ MATERIAS ACTIVAS (HORARIOS DE CURSADA) ─');
            classes.slice(0, 8).forEach((entry) => {
                parts.push(`• ${entry.subject} - ${entry.schedule_day} ${entry.schedule_time}`);
            });
        }
        else {
            parts.push('\n─ MATERIAS ACTIVAS ─\nNo hay materias ni horarios cargados.');
        }
        // 5. DIRECTORIO DE PROFESORES
        if (teachers.length) {
            parts.push('\n─ DIRECTORIO DE PROFESORES Y CONTACTOS ─');
            teachers.slice(0, 10).forEach((t) => {
                const subject = t.teacher.subject ? ` (${t.teacher.subject})` : '';
                parts.push(`• ${t.teacher.name}${subject} - ${t.teacher.email}`);
            });
        }
        else {
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
}
exports.KnowledgeContextService = KnowledgeContextService;
