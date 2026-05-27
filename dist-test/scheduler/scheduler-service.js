"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const exam_notification_service_js_1 = require("../application/notifications/exam-notification.service.js");
class SchedulerService {
    constructor(groupRepository, whatsappGateway, rateLimitService, reminderRepository, confirmationRepository, schedulerRunRepository, dynamicMessageService, classNotificationService, userProfileRepository, outboxDedupRepository, managedExamRepository, ragPipelineService, emailMonitor) {
        this.groupRepository = groupRepository;
        this.whatsappGateway = whatsappGateway;
        this.rateLimitService = rateLimitService;
        this.reminderRepository = reminderRepository;
        this.confirmationRepository = confirmationRepository;
        this.schedulerRunRepository = schedulerRunRepository;
        this.dynamicMessageService = dynamicMessageService;
        this.classNotificationService = classNotificationService;
        this.userProfileRepository = userProfileRepository;
        this.outboxDedupRepository = outboxDedupRepository;
        this.managedExamRepository = managedExamRepository;
        this.ragPipelineService = ragPipelineService;
        this.emailMonitor = emailMonitor;
        // ExamNotificationService will be initialized with active groups in startJobs()
        this.examNotificationService = new exam_notification_service_js_1.ExamNotificationService(managedExamRepository, whatsappGateway, []);
    }
    async startJobs() {
        console.log('[Scheduler] Iniciando tareas automáticas (PHASE 5: multi-tenant aware)...');
        // PHASE 5: Get active groups from database instead of static settings
        const activeGroupIds = await this.groupRepository.getAllActiveIds();
        if (!activeGroupIds.length) {
            console.log('[Scheduler] Avisos a grupos desactivados: no hay grupos activos en BD.');
        }
        else {
            console.log(`[Scheduler] ${activeGroupIds.length} grupos activos cargados desde BD`);
        }
        // Update ExamNotificationService with current groups
        this.examNotificationService = new exam_notification_service_js_1.ExamNotificationService(this.managedExamRepository, this.whatsappGateway, activeGroupIds);
        node_cron_1.default.schedule('0 0 * * *', async () => {
            await this.safeRun('rate_limit_reset', async () => {
                await this.rateLimitService.resetDaily();
            });
        });
        node_cron_1.default.schedule('*/30 * * * *', async () => {
            await this.safeRun('send_reminders', async () => {
                const currentActiveGroupIds = await this.groupRepository.getAllActiveIds();
                const due = await this.reminderRepository.listDueForNotification(new Date());
                for (const reminder of due) {
                    if (!reminder.id)
                        continue;
                    const delta = Math.round((reminder.event_date.getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / (1000 * 60 * 60 * 24));
                    const text = reminder.event_type === 'institutional_notice'
                        ? `Quedan pocos dias para inscribirse a: ${reminder.description}`
                        : `Recordatorio: quedan ${delta} dias para ${reminder.description}.`;
                    const dedupKey = `reminder:${reminder.id}:${delta}`;
                    const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
                    if (!shouldSend)
                        continue;
                    // PHASE 5: Send to active groups from database
                    for (const groupId of currentActiveGroupIds) {
                        if (reminder.group_id && reminder.group_id !== groupId)
                            continue;
                        await this.whatsappGateway.sendTextMessage(groupId, text);
                    }
                    if (delta === 7 || delta === 3) {
                        await this.reminderRepository.markNotified(reminder.id, delta);
                    }
                }
            });
        });
        node_cron_1.default.schedule('*/15 * * * *', async () => {
            await this.safeRun('cleanup_confirmations', async () => {
                await this.confirmationRepository.deleteExpired(new Date());
            });
        });
        node_cron_1.default.schedule('0 8,18 * * *', async () => {
            await this.safeRun('refresh_news_cache', async () => {
                await this.dynamicMessageService.getNews(5, true);
            });
        });
        node_cron_1.default.schedule('*/5 * * * *', async () => {
            await this.safeRun('class_notifications', async () => {
                const currentActiveGroupIds = await this.groupRepository.getAllActiveIds();
                if (!currentActiveGroupIds.length)
                    return;
                const classesToNotify = await this.classNotificationService.getClassesToNotifyNow();
                for (const managedClass of classesToNotify) {
                    const dayKey = new Date().toISOString().slice(0, 10);
                    const dedupKey = `class:${managedClass.id}:${dayKey}`;
                    const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
                    if (!shouldSend)
                        continue;
                    const message = this.classNotificationService.buildNotificationMessage(managedClass);
                    // PHASE 5: Send to active groups from database
                    for (const groupId of currentActiveGroupIds) {
                        await this.whatsappGateway.sendTextMessage(groupId, message);
                    }
                    await this.classNotificationService.recordNotificationSent(managedClass.id);
                }
            });
        });
        node_cron_1.default.schedule('*/5 * * * *', async () => {
            await this.safeRun('exam_notifications', async () => {
                const currentActiveGroupIds = await this.groupRepository.getAllActiveIds();
                if (!currentActiveGroupIds.length)
                    return;
                const examsToNotify = await this.examNotificationService.getExamsReadyForNotification(new Date());
                for (const item of examsToNotify) {
                    const dedupKey = `exam:${item.exam.id}:${item.kind || `${item.frequency.value}${item.frequency.unit}`}:${item.notificationTime.toISOString()}`;
                    const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
                    if (!shouldSend)
                        continue;
                    const message = this.examNotificationService.formatNotificationMessage(item.exam, item.frequency);
                    // PHASE 5: Send to active groups from database
                    for (const groupId of currentActiveGroupIds) {
                        await this.whatsappGateway.sendTextMessage(groupId, message);
                    }
                }
            });
        });
        node_cron_1.default.schedule('0 9 * * *', async () => {
            await this.safeRun('send_birthday_greetings', async () => {
                const currentActiveGroupIds = await this.groupRepository.getAllActiveIds();
                if (!currentActiveGroupIds.length)
                    return;
                const now = new Date();
                const dayMonth = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;
                const users = await this.userProfileRepository.listUsersWithBirthday(dayMonth);
                for (const user of users) {
                    const dedupKey = `birthday:${user.user_id}:${now.toISOString().slice(0, 10)}`;
                    const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
                    if (!shouldSend)
                        continue;
                    const mention = `@${user.user_id.replace('@s.whatsapp.net', '')}`;
                    const message = `🎉🎂🥳 ¡MUY FELIZ CUMPLEAÑOS ${user.name}! 🥳🎂🎉\n\nQue tengas un día espectacular ${mention}. ¡Un abrazo gigante de parte de todos! 🎈🎁🎊`;
                    // PHASE 5: Send to active groups from database
                    for (const groupId of currentActiveGroupIds) {
                        await this.whatsappGateway.sendTextMessage(groupId, message);
                    }
                }
            });
        });
        node_cron_1.default.schedule('30 3 * * *', async () => {
            await this.safeRun('cleanup_outbox_dedup', async () => {
                await this.outboxDedupRepository.deleteOlderThan(14);
            });
        });
        if (this.emailMonitor) {
            node_cron_1.default.schedule('*/15 * * * *', async () => {
                await this.safeRun('poll_institutional_email', async () => {
                    await this.emailMonitor?.pollOnce();
                });
            });
        }
        node_cron_1.default.schedule('0 3 */2 * *', async () => {
            await this.safeRun('rag_sync', async () => {
                console.log('[Scheduler] Ejecutando sincronización RAG por cambios en la base de conocimiento...');
                await this.ragPipelineService.runSync(false);
            });
        });
        node_cron_1.default.schedule('0 * * * *', async () => {
            await this.safeRun('cleanup_expired_exams', async () => {
                const deleted = await this.managedExamRepository.deleteExpired(new Date());
                if (deleted > 0) {
                    console.log(`[Scheduler] Exámenes expirados eliminados: ${deleted}`);
                    const currentActiveGroupIds = await this.groupRepository.getAllActiveIds();
                    if (currentActiveGroupIds.length > 0) {
                        const message = `✅ Se limpió la agenda: ${deleted} examen(es) vencido(s) eliminado(s).`;
                        // PHASE 5: Send to active groups from database
                        for (const groupId of currentActiveGroupIds) {
                            await this.whatsappGateway.sendTextMessage(groupId, message);
                        }
                    }
                }
            });
        });
    }
    async safeRun(jobName, work) {
        try {
            await work();
            await this.schedulerRunRepository.log(jobName, 'ok', 'completed');
        }
        catch (error) {
            const msg = error?.message || 'error';
            await this.schedulerRunRepository.log(jobName, 'error', msg);
        }
    }
}
exports.SchedulerService = SchedulerService;
