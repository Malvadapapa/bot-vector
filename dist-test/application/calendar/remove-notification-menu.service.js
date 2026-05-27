"use strict";
/**
 * Servicio de menú para eliminar avisos y exámenes
 * Flujo: elegir tipo → seleccionar ítem → confirmar eliminación
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoveNotificationMenuService = void 0;
class RemoveNotificationMenuService {
    constructor(reminderRepository, examRepository) {
        this.reminderRepository = reminderRepository;
        this.examRepository = examRepository;
        this.userStates = new Map();
    }
    async startRemovalFlow(userId) {
        this.userStates.set(userId, {
            userId,
            stage: 'selecting-kind',
        });
        return '🗑️ *Eliminar Avisos*\n\n¿Qué quieres eliminar?\n1️⃣ Recordatorios genéricos\n2️⃣ Exámenes cargados (con todas sus frecuencias)';
    }
    async processInput(userId, input) {
        const state = this.userStates.get(userId);
        if (!state) {
            return { response: '❌ Flujo expirado. Usa !eliminaravisos para comenzar.', completed: false };
        }
        const normalized = input.trim().toLowerCase();
        if (state.stage === 'selecting-kind') {
            if (normalized === '1') {
                const reminders = await this.reminderRepository.listActive();
                if (!reminders.length) {
                    this.userStates.delete(userId);
                    return { response: '❌ No hay avisos para eliminar.', completed: false };
                }
                state.kind = 'reminder';
                state.stage = 'selecting-exam';
                state.reminders = reminders;
                let response = '🗑️ *Eliminar Avisos Genéricos*\n\nElige el aviso a eliminar:\n\n';
                reminders.slice(0, 10).forEach((reminder, index) => {
                    const dateText = reminder.event_date instanceof Date ? reminder.event_date.toLocaleDateString('es-AR') : String(reminder.event_date || 'N/A');
                    response += `${index + 1}️⃣ ${reminder.description}\n   📅 Fecha: ${dateText}\n   🏷️ Tipo: ${reminder.event_type}\n\n`;
                });
                if (reminders.length > 10) {
                    response += `... y ${reminders.length - 10} más`;
                }
                return { response, completed: false };
            }
            if (normalized === '2') {
                if (!this.examRepository) {
                    return { response: '❌ No está disponible el repositorio de exámenes.', completed: false };
                }
                const exams = await this.examRepository.listUpcoming(new Date(), 50);
                if (!exams.length) {
                    this.userStates.delete(userId);
                    return { response: '❌ No hay exámenes cargados para eliminar.', completed: false };
                }
                state.kind = 'exam';
                state.stage = 'selecting-exam';
                state.exams = exams;
                let response = '🗑️ *Eliminar Exámenes*\n\nElige el examen a eliminar:\n\n';
                exams.slice(0, 10).forEach((exam, index) => {
                    const availability = this.getAvailabilityText(exam);
                    response += `${index + 1}️⃣ ${exam.subject} - ${exam.exam_type}\n   📅 ${exam.exam_date.toLocaleDateString('es-AR')}\n   ⏰ ${availability}\n   📢 ${exam.frecuenciaAvisos || '7d,3d,1d,20m'}\n\n`;
                });
                if (exams.length > 10) {
                    response += `... y ${exams.length - 10} más`;
                }
                return { response, completed: false };
            }
            return { response: '❌ Opción inválida. Responde 1 o 2.', completed: false };
        }
        if (state.stage === 'selecting-exam') {
            const idx = parseInt(normalized, 10) - 1;
            if (state.kind === 'reminder') {
                if (isNaN(idx) || !state.reminders || idx < 0 || idx >= state.reminders.length) {
                    return { response: '❌ ID inválido. Responde con el número del aviso.', completed: false };
                }
                const reminder = state.reminders[idx];
                state.selectedReminderId = reminder.id;
                state.reminder = reminder;
                state.stage = 'confirming';
                return {
                    response: `🗑️ *${reminder.description}*\n📅 Fecha: ${reminder.event_date instanceof Date ? reminder.event_date.toLocaleDateString('es-AR') : 'N/A'}\n🏷️ Tipo: ${reminder.event_type}\n\n✅ ¿Eliminar este aviso? (sí/no)`,
                    completed: false,
                };
            }
            if (state.kind === 'exam') {
                if (isNaN(idx) || !state.exams || idx < 0 || idx >= state.exams.length) {
                    return { response: '❌ ID inválido. Responde con el número del examen.', completed: false };
                }
                const exam = state.exams[idx];
                state.selectedExamId = exam.id;
                state.exam = exam;
                state.stage = 'confirming';
                return {
                    response: `🗑️ *${exam.subject} - ${exam.exam_type}*\n📅 Fecha: ${exam.exam_date.toLocaleDateString('es-AR')}\n⏰ ${this.getAvailabilityText(exam)}\n📢 ${exam.frecuenciaAvisos || '7d,3d,1d,20m'}\n\n✅ ¿Eliminar este examen y todos sus avisos? (sí/no)`,
                    completed: false,
                };
            }
        }
        if (state.stage === 'confirming') {
            if (normalized === 'sí' || normalized === 'si') {
                if (state.kind === 'reminder') {
                    await this.reminderRepository.delete(state.selectedReminderId);
                }
                else if (state.kind === 'exam' && this.examRepository) {
                    await this.examRepository.deleteById(state.selectedExamId);
                }
                this.userStates.delete(userId);
                return {
                    response: state.kind === 'exam'
                        ? `✅ *Examen eliminado exitosamente!*\n📝 ${state.exam.subject} - ${state.exam.exam_type}`
                        : `✅ *Aviso eliminado exitosamente!*\n📝 ${state.reminder.description}`,
                    completed: true,
                };
            }
            this.userStates.delete(userId);
            return {
                response: `❌ Eliminación cancelada. Usa !eliminaravisos para comenzar de nuevo.`,
                completed: false,
            };
        }
        return { response: '❌ Error en el flujo.', completed: false };
    }
    cancelFlow(userId) {
        this.userStates.delete(userId);
    }
    isInFlow(userId) {
        return this.userStates.has(userId);
    }
    getAvailabilityText(exam) {
        if (exam.tipoDisponibilidad === 'franja') {
            return `Franja ${exam.horaInicio || exam.exam_time} - ${exam.horaFin || 'N/A'}`;
        }
        if (exam.tipoDisponibilidad === 'a-partir-de') {
            return `A partir de ${exam.horaInicio || exam.exam_time}`;
        }
        return `Hora ${exam.exam_time}`;
    }
}
exports.RemoveNotificationMenuService = RemoveNotificationMenuService;
