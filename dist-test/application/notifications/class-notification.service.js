"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClassNotificationService = void 0;
const FRIENDLY_PHRASES = [
    '¡Hola! En 10 minutos comienza la clase',
    '⏰ La clase está por comenzar en 10 min',
    '¿Ya estás listo? La clase empieza en 10 minutos',
    '📝 Recordatorio: la clase comienza en 10 minutos',
    '¡No te la pierdas! Faltan 10 minutos para la clase',
    'La clase va a empezar en 10 minutos 🎓',
    '⏳ Últimos 10 minutos, ¡súmate a la clase!',
    '🔔 Aviso: la clase comienza en 10 minutos',
];
class ClassNotificationService {
    constructor(managedClassRepository, classNotificationRepository) {
        this.managedClassRepository = managedClassRepository;
        this.classNotificationRepository = classNotificationRepository;
    }
    async getClassesToNotifyNow(now = new Date()) {
        const dayName = this.getDayName(now);
        const classes = await this.managedClassRepository.listByDay(dayName);
        const classesToNotify = [];
        for (const managedClass of classes) {
            if (!managedClass.id)
                continue;
            const timeStr = managedClass.schedule_time; // "HH:MM" format
            const [classHour, classMin] = timeStr.split(':').map(Number);
            if (isNaN(classHour) || isNaN(classMin))
                continue;
            const classTime = new Date(now);
            classTime.setHours(classHour, classMin, 0, 0);
            const justBeforeClass = new Date(classTime.getTime() - 10 * 60 * 1000);
            const justAfterClass = new Date(classTime.getTime() + 5 * 60 * 1000);
            // Check if we're within the 10-minute window before class, or up to 5 minutes after start time
            if (now >= justBeforeClass && now < justAfterClass) {
                // Check if we've already sent a notification for this class today
                const lastNotif = await this.classNotificationRepository.getLastNotificationBefore(managedClass.id, 10);
                if (!lastNotif || !this.isSameDay(lastNotif, now)) {
                    classesToNotify.push(managedClass);
                }
            }
        }
        return classesToNotify;
    }
    buildNotificationMessage(managedClass) {
        const phrase = FRIENDLY_PHRASES[Math.floor(Math.random() * FRIENDLY_PHRASES.length)];
        return `${phrase}\n\n📚 ${managedClass.subject}\n🧩 Comisiones: ${this.getCommissionText(managedClass.commission_count)}\n🔗 Enlace: ${managedClass.meet_link}`;
    }
    async recordNotificationSent(managedClassId) {
        await this.classNotificationRepository.recordNotificationSent(managedClassId, 10);
    }
    getDayName(date) {
        const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
        return days[date.getDay()] || 'lunes';
    }
    isSameDay(date1, date2) {
        return (date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate());
    }
    getCommissionText(commissionCount) {
        const normalized = Number.isFinite(commissionCount) ? Math.max(1, Math.trunc(commissionCount)) : 1;
        return normalized === 1 ? '1 (unica)' : String(normalized);
    }
}
exports.ClassNotificationService = ClassNotificationService;
