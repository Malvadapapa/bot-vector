import cron from 'node-cron';

import { ClassNotificationService } from '../features/notifications/class-notification.service.js';
import { ExamNotificationService } from '../features/notifications/exam-notification.service.js';
import { DynamicMessageService } from '../features/messages/dynamic-message.service.js';
import { RateLimitService } from '../features/ai/rate-limit.service.js';
import { GroupRepository, ManagedExamRepository, ReminderRepository, SchedulerRunRepository, UserProfileRepository } from '../infrastructure/persistence/db/repositories.js';
import { OutboxDedupRepository } from '../features/messages/messages.repository.js';
import { ConfirmationRepository } from '../features/conversation/conversation.repository.js';
import { InstitutionalEmailMonitor } from '../features/notifications/integrations/institutional-email-monitor.js';
import { CabezonWhatsAppGateway } from '../interfaces/whatsapp/cabezon-whatsapp-gateway.js';
import { RagPipelineService } from '../features/ai/rag/rag-pipeline.service.js';

export class SchedulerService {
  private examNotificationService: ExamNotificationService;

  constructor(
    private groupRepository: GroupRepository,
    private whatsappGateway: CabezonWhatsAppGateway,
    private rateLimitService: RateLimitService,
    private reminderRepository: ReminderRepository,
    private confirmationRepository: ConfirmationRepository,
    private schedulerRunRepository: SchedulerRunRepository,
    private dynamicMessageService: DynamicMessageService,
    private classNotificationService: ClassNotificationService,
    private userProfileRepository: UserProfileRepository,
    private outboxDedupRepository: OutboxDedupRepository,
    private managedExamRepository: ManagedExamRepository,
    private ragPipelineService: RagPipelineService,
    private emailMonitor?: InstitutionalEmailMonitor,
  ) {
    // ExamNotificationService will be initialized with active groups in startJobs()
    this.examNotificationService = new ExamNotificationService(
      managedExamRepository,
      whatsappGateway,
      [], // Will be populated dynamically
    );
  }

  public async startJobs(): Promise<void> {
    console.log('[Scheduler] Iniciando tareas automáticas (PHASE 5: multi-tenant aware)...');
    
    // PHASE 5: Get active groups from database instead of static settings
    const activeGroupIds = await this.groupRepository.getAllActiveIds();
    if (!activeGroupIds.length) {
      console.log('[Scheduler] Avisos a grupos desactivados: no hay grupos activos en BD.');
    } else {
      console.log(`[Scheduler] ${activeGroupIds.length} grupos activos cargados desde BD`);
    }

    // Update ExamNotificationService with current groups
    this.examNotificationService = new ExamNotificationService(
      this.managedExamRepository,
      this.whatsappGateway,
      activeGroupIds,
    );

    cron.schedule('0 0 * * *', async () => {
      await this.safeRun('rate_limit_reset', async () => {
        await this.rateLimitService.resetDaily();
      });
    });

    cron.schedule('*/30 * * * *', async () => {
      await this.safeRun('send_reminders', async () => {
        const currentActiveGroupIds = await this.groupRepository.getAllActiveIds();
        const due = await this.reminderRepository.listDueForNotification(new Date());
        for (const reminder of due) {
          if (!reminder.id) continue;

          const delta = Math.round((reminder.event_date.getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / (1000 * 60 * 60 * 24));
          const text = reminder.event_type === 'institutional_notice'
            ? `Quedan pocos dias para inscribirse a: ${reminder.description}`
            : `Recordatorio: quedan ${delta} dias para ${reminder.description}.`;

          const dedupKey = `reminder:${reminder.id}:${delta}`;
          const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
          if (!shouldSend) continue;

          // PHASE 5: Send to active groups from database
          for (const groupId of currentActiveGroupIds) {
            if (reminder.group_id && reminder.group_id !== groupId) continue;
            await this.whatsappGateway.sendTextMessage(groupId, text);
          }

          if (delta === 7 || delta === 3) {
            await this.reminderRepository.markNotified(reminder.id, delta as 7 | 3);
          }
        }
      });
    });

    cron.schedule('*/15 * * * *', async () => {
      await this.safeRun('cleanup_confirmations', async () => {
        await this.confirmationRepository.deleteExpired(new Date());
      });
    });

    cron.schedule('0 8,18 * * *', async () => {
      await this.safeRun('refresh_news_cache', async () => {
        await this.dynamicMessageService.getNews(5, true);
      });
    });

    cron.schedule('*/5 * * * *', async () => {
      await this.safeRun('class_notifications', async () => {
        const currentActiveGroupIds = await this.groupRepository.getAllActiveIds();
        if (!currentActiveGroupIds.length) return;

        const classesToNotify = await this.classNotificationService.getClassesToNotifyNow();
        for (const managedClass of classesToNotify) {
          const dayKey = new Date().toISOString().slice(0, 10);
          const dedupKey = `class:${managedClass.id}:${dayKey}`;
          const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
          if (!shouldSend) continue;

          const message = this.classNotificationService.buildNotificationMessage(managedClass);
          // PHASE 5: Send to active groups from database
          for (const groupId of currentActiveGroupIds) {
            await this.whatsappGateway.sendTextMessage(groupId, message);
          }
          await this.classNotificationService.recordNotificationSent(managedClass.id!);
        }
      });
    });

    cron.schedule('*/5 * * * *', async () => {
      await this.safeRun('exam_notifications', async () => {
        const currentActiveGroupIds = await this.groupRepository.getAllActiveIds();
        if (!currentActiveGroupIds.length) return;

        const examsToNotify = await this.examNotificationService.getExamsReadyForNotification(new Date());
        for (const item of examsToNotify) {
          const dedupKey = `exam:${item.exam.id}:${item.kind || `${item.frequency.value}${item.frequency.unit}`}:${item.notificationTime.toISOString()}`;
          const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
          if (!shouldSend) continue;

          const message = this.examNotificationService.formatNotificationMessage(item.exam, item.frequency);
          // PHASE 5: Send to active groups from database
          for (const groupId of currentActiveGroupIds) {
            await this.whatsappGateway.sendTextMessage(groupId, message);
          }
        }
      });
    });

    cron.schedule('0 9 * * *', async () => {
      await this.safeRun('send_birthday_greetings', async () => {
        const currentActiveGroupIds = await this.groupRepository.getAllActiveIds();
        if (!currentActiveGroupIds.length) return;

        const now = new Date();
        const dayMonth = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;
        const users = await this.userProfileRepository.listUsersWithBirthday(dayMonth);

        for (const user of users) {
          const dedupKey = `birthday:${user.user_id}:${now.toISOString().slice(0, 10)}`;
          const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
          if (!shouldSend) continue;

          const mention = `@${user.user_id.replace('@s.whatsapp.net', '')}`;
          const message = `🎉🎂🥳 ¡MUY FELIZ CUMPLEAÑOS ${user.name}! 🥳🎂🎉\n\nQue tengas un día espectacular ${mention}. ¡Un abrazo gigante de parte de todos! 🎈🎁🎊`;
          // PHASE 5: Send to active groups from database
          for (const groupId of currentActiveGroupIds) {
            await this.whatsappGateway.sendTextMessage(groupId, message);
          }
        }
      });
    });

    cron.schedule('30 3 * * *', async () => {
      await this.safeRun('cleanup_outbox_dedup', async () => {
        await this.outboxDedupRepository.deleteOlderThan(14);
      });
    });

    if (this.emailMonitor) {
      cron.schedule('*/15 * * * *', async () => {
        await this.safeRun('poll_institutional_email', async () => {
          await this.emailMonitor?.pollOnce();
        });
      });
    }

    cron.schedule('0 3 */2 * *', async () => {
      await this.safeRun('rag_sync', async () => {
        console.log('[Scheduler] Ejecutando sincronización RAG por cambios en la base de conocimiento...');
        await this.ragPipelineService.runSync(false);
      });
    });

    cron.schedule('0 * * * *', async () => {
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

  private async safeRun(jobName: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
      await this.schedulerRunRepository.log(jobName, 'ok', 'completed');
    } catch (error) {
      const msg = (error as any)?.message || 'error';
      await this.schedulerRunRepository.log(jobName, 'error', msg);
    }
  }
}
