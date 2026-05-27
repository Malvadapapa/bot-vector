"use strict";
/**
 * Servicio de integración de menús con persistencia
 * Maneja el guardado de datos después de completar los flujos
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MenuPersistenceService = void 0;
const smart_notification_service_js_1 = require("../notifications/smart-notification.service.js");
class MenuPersistenceService {
    constructor(examMenuService, examRepository, loggingService) {
        this.examMenuService = examMenuService;
        this.examRepository = examRepository;
        this.loggingService = loggingService;
        this.smartNotificationService = new smart_notification_service_js_1.SmartNotificationService();
    }
    setNotificationSender(sender) {
        this.notificationSender = sender;
    }
    /**
     * Procesa y guarda un examen después del flujo del menú
     */
    async saveExamFromMenuFlow(examData) {
        try {
            // Insertar el examen
            const examId = await this.examMenuService.saveExam(examData);
            if (!examId) {
                const msg = 'Error saving exam to database';
                if (this.loggingService) {
                    await this.loggingService.logError(new Error(msg), {
                        componente: 'MenuPersistenceService.saveExamFromMenuFlow',
                        usuario: 'system',
                    });
                }
                return {
                    success: false,
                    message: '⚠️ Error al guardar el examen en la base de datos.',
                };
            }
            // Detectar si es una notificación anticipada
            const { isAnticipated, hoursUntilStart } = this.smartNotificationService.detectAnticipationNotification(examData.exam_date, examData.exam_time);
            let anticipationMessage = '';
            if (isAnticipated) {
                anticipationMessage = this.smartNotificationService.formatAnticipationNotification(examData.subject, examData.exam_date, examData.exam_time, hoursUntilStart);
                if (this.notificationSender) {
                    await this.notificationSender(anticipationMessage);
                }
            }
            // Log del éxito
            console.log(`[MenuPersistence] Examen guardado: ID=${examId}, Materia=${examData.subject}, Anticipated=${isAnticipated}`);
            return {
                success: true,
                examId,
                message: `✅ *Examen guardado con ID ${examId}*\n📝 ${examData.subject} - ${examData.exam_type}\n📅 ${examData.exam_date}`,
                anticipation: isAnticipated ? anticipationMessage : undefined,
            };
        }
        catch (error) {
            const msg = `Error in saveExamFromMenuFlow: ${error}`;
            console.error(`[MenuPersistence] ${msg}`);
            if (this.loggingService) {
                await this.loggingService.logError(error, {
                    componente: 'MenuPersistenceService.saveExamFromMenuFlow',
                    usuario: 'system',
                });
            }
            return {
                success: false,
                message: '❌ Ocurrió un error al procesar el examen. Intenta de nuevo.',
            };
        }
    }
    /**
     * Valida datos de examen antes de guardar
     */
    validateExamData(examData) {
        const errors = [];
        const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
        if (!hasText(examData.subject)) {
            errors.push('Materia requerida');
        }
        if (!hasText(examData.exam_type)) {
            errors.push('Tipo de examen requerido');
        }
        if (!examData.exam_date || (typeof examData.exam_date === 'string' && examData.exam_date.trim().length === 0)) {
            errors.push('Fecha requerida');
        }
        if (!hasText(examData.exam_time)) {
            errors.push('Hora requerida');
        }
        return {
            valid: errors.length === 0,
            errors,
        };
    }
}
exports.MenuPersistenceService = MenuPersistenceService;
