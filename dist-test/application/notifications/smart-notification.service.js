"use strict";
/**
 * Servicio de notificaciones inteligentes para exámenes
 * Detecta cuando se agrega un examen con poco tiempo de anticipación
 * Calcula horas disponibles y genera notificaciones por franja
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmartNotificationService = void 0;
class SmartNotificationService {
    /**
     * Detecta si un examen fue agregado con poco tiempo de anticipación (<48h)
     */
    detectAnticipationNotification(examDate, examTime) {
        const now = new Date();
        let examDateTime;
        try {
            examDateTime = this.parseExamDate(examDate);
            if (examTime) {
                const [hours, minutes] = examTime.split(':').map(Number);
                examDateTime.setHours(hours, minutes, 0, 0);
            }
        }
        catch {
            return { isAnticipated: false, hoursUntilStart: 0 };
        }
        const hoursUntilStart = (examDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const isAnticipated = hoursUntilStart < 48 && hoursUntilStart > 0;
        return { isAnticipated, hoursUntilStart };
    }
    /**
     * Calcula notificaciones para examen en franja horaria
     */
    calculateFranjaNotifications(subject, examDate, startTime, endTime) {
        const notifications = [];
        // Notificación 1: 10 minutos antes del inicio
        notifications.push({
            time: this.subtractMinutes(startTime, 10),
            description: `⏰ Faltan 10 minutos para comenzar ${subject}`,
            minutesBefore: 10,
        });
        // Notificación 2: 10 minutos antes del final
        notifications.push({
            time: this.subtractMinutes(endTime, 10),
            description: `⏰ Faltan 10 minutos para finalizar ${subject}`,
            minutesBefore: 10,
        });
        return {
            hasMultipleNotifications: true,
            notifications,
        };
    }
    /**
     * Calcula horas disponibles entre "ahora" y el examen
     */
    calculateAvailableHours(examDate, examTime) {
        const now = new Date();
        const examDateTime = this.parseExamDate(examDate);
        const [hours, minutes] = examTime.split(':').map(Number);
        examDateTime.setHours(hours, minutes, 0, 0);
        const diffMs = examDateTime.getTime() - now.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        if (diffHours < 0) {
            return 'El examen ya pasó';
        }
        if (diffHours === 0) {
            return `${diffMinutes} minutos`;
        }
        return `${diffHours} horas y ${diffMinutes} minutos`;
    }
    /**
     * Genera mensaje de notificación anticipada
     */
    formatAnticipationNotification(subject, examDate, examTime, hoursUntil) {
        const availableHours = examTime ? this.calculateAvailableHours(examDate, examTime) : 'próximamente';
        if (hoursUntil && hoursUntil < 4) {
            return `⚠️ *ATENCIÓN: Examen próximo*\n\n${subject}\n📅 ${examDate}${examTime ? ` - ${examTime}` : ''}\n⏱️ Tendrás ${availableHours} para prepararte`;
        }
        return `📢 *Examen agregado recientemente*\n\n${subject}\n📅 ${examDate}${examTime ? ` - ${examTime}` : ''}\n⏱️ Tendrás ${availableHours}`;
    }
    /**
     * Genera mensaje de notificación regular
     */
    formatRegularNotification(subject, examDate, examTime) {
        return `📚 ${subject}\n📅 ${examDate}${examTime ? ` ⏰ ${examTime}` : ''}`;
    }
    /**
     * Genera mensaje de notificación franja
     */
    formatFranjaNotification(subject, startTime, endTime, available) {
        return `📝 Examen en franja\n${subject}\n⏰ ${startTime} - ${endTime}\n⏱️ Tendrás ${available}`;
    }
    /**
     * Resta minutos a una hora en formato HH:mm
     */
    subtractMinutes(time, minutes) {
        const [hours, mins] = time.split(':').map(Number);
        let totalMinutes = hours * 60 + mins - minutes;
        if (totalMinutes < 0) {
            totalMinutes += 24 * 60; // Día anterior
        }
        const resultHours = Math.floor(totalMinutes / 60) % 24;
        const resultMinutes = totalMinutes % 60;
        return `${String(resultHours).padStart(2, '0')}:${String(resultMinutes).padStart(2, '0')}`;
    }
    parseExamDate(examDate) {
        if (examDate instanceof Date) {
            return new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());
        }
        const [year, month, day] = examDate.split('-').map(Number);
        return new Date(year, month - 1, day);
    }
}
exports.SmartNotificationService = SmartNotificationService;
