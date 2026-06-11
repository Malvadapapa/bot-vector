import cron from 'node-cron';

import { ClassNotificationService } from '../features/notifications/class-notification.service.js';
import { ExamNotificationService } from '../features/notifications/exam-notification.service.js';
import { DynamicMessageService } from '../features/messages/dynamic-message.service.js';
import { RateLimitService } from '../features/ai/rate-limit.service.js';
import { GroupRepository, ManagedExamRepository, ReminderRepository, SchedulerRunRepository, UserProfileRepository, InstitutionalNoticeRepository } from '../infrastructure/persistence/db/repositories.js';
import { OutboxDedupRepository } from '../features/messages/messages.repository.js';
import { ConfirmationRepository } from '../features/conversation/conversation.repository.js';
import { InstitutionalEmailMonitor } from '../features/notifications/integrations/institutional-email-monitor.js';
import { VectoritoWhatsAppGateway } from '../interfaces/whatsapp/vectorito-whatsapp-gateway.js';
import { RagPipelineService } from '../features/ai/rag/rag-pipeline.service.js';
import { formatLocalDateOnly, get, all } from '../shared/db/db-utils.js';

export class SchedulerService {
  private examNotificationService: ExamNotificationService;

  constructor(
    private groupRepository: GroupRepository,
    private whatsappGateway: VectoritoWhatsAppGateway,
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
    private noticesRepository?: InstitutionalNoticeRepository,
  ) {
    // ExamNotificationService will be initialized with active groups in startJobs()
    this.examNotificationService = new ExamNotificationService(
      managedExamRepository,
      whatsappGateway,
      [], // Will be populated dynamically
    );
  }

  public async startJobs(): Promise<void> {
    console.log('[Scheduler] Iniciando tareas automáticas...');
    
    // Obtener grupos activos desde BD
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

          const todayLocalStr = formatLocalDateOnly(new Date());
          const todayMidnight = new Date(`${todayLocalStr}T00:00:00-03:00`);
          const eventMidnight = new Date(`${formatLocalDateOnly(reminder.event_date)}T00:00:00-03:00`);
          const delta = Math.round((eventMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
          const text = reminder.event_type === 'institutional_notice'
            ? `Quedan pocos dias para inscribirse a: ${reminder.description}`
            : `Recordatorio: quedan ${delta} dias para ${reminder.description}.`;

          const dedupKey = `reminder:${reminder.id}:${delta}`;
          const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
          if (!shouldSend) continue;

          // Enviar a grupos activos
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
          const dayKey = formatLocalDateOnly(new Date());
          const dedupKey = `class:${managedClass.id}:${dayKey}`;
          const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
          if (!shouldSend) continue;

          const message = await this.classNotificationService.buildNotificationMessage(managedClass);
          // Enviar a grupos activos
          for (const groupId of currentActiveGroupIds) {
            if (managedClass.group_id && managedClass.group_id !== groupId) continue;
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
          // Enviar a grupos activos
          for (const groupId of currentActiveGroupIds) {
            if (item.exam.group_id && item.exam.group_id !== groupId) continue;
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
        const localDateStr = formatLocalDateOnly(now);
        const [year, month, day] = localDateStr.split('-');
        const dayMonth = `${day}/${month}`;
        const users = await this.userProfileRepository.listUsersWithBirthday(dayMonth);

        for (const user of users) {
          const dedupKey = `birthday:${user.user_id}:${localDateStr}`;
          const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
          if (!shouldSend) continue;

          const mention = `@${user.user_id.replace('@s.whatsapp.net', '')}`;
          const message = `🎉🎂🥳 ¡MUY FELIZ CUMPLEAÑOS ${user.name}! 🥳🎂🎉\n\nQue tengas un día espectacular ${mention}. ¡Un abrazo gigante de parte de todos! 🎈🎁🎊`;
          // Enviar a grupos activos
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
            // Enviar a grupos activos
            for (const groupId of currentActiveGroupIds) {
              await this.whatsappGateway.sendTextMessage(groupId, message);
            }
          }
        }
      });
    });

    cron.schedule('0 */12 * * *', async () => {
      await this.safeRun('publish_frequency_notices', async () => {
        if (!this.noticesRepository) return;
        const activeNotices = await this.noticesRepository.listActivePeriodicNotices();
        for (const item of activeNotices) {
          const notice = item.notice;
          if (!notice.frecuencia || notice.frecuencia === 'unica') continue;

          const m = notice.frecuencia.match(/^(\d+)d$/);
          if (!m) continue;
          const days = Number(m[1]);

          const lastSent = notice.last_sent_at || notice.published_at;
          if (lastSent) {
            const diffMs = new Date().getTime() - lastSent.getTime();
            const diffDays = diffMs / (1000 * 60 * 60 * 24);
            if (diffDays < days) continue;
          }

          // Resolve groups
          const selector = notice.grupo_selector || 'todos';
          const groups = await this.groupRepository.getAllActiveGroupsWithEntryYear();
          let resolvedGroupIds: string[] = [];
          const sel = selector.trim().toLowerCase();
          if (sel === 'todos') {
            resolvedGroupIds = groups.map((g) => g.group_id);
          } else if (sel === 'general') {
            resolvedGroupIds = groups.filter((g) => g.entry_year === null).map((g) => g.group_id);
          } else if (sel.startsWith('camada:')) {
            const year = Number(sel.split(':')[1]);
            resolvedGroupIds = groups.filter((g) => g.entry_year === year).map((g) => g.group_id);
          } else {
            const matched = groups.find((g) => g.group_id.toLowerCase() === sel);
            if (matched) resolvedGroupIds = [matched.group_id];
          }

          if (resolvedGroupIds.length === 0) continue;

          // Resolve sender name and role label
          let displayName = notice.source_email || 'Sistema';
          let senderLabel = 'profe'; // Default role label if not matched
          if (notice.source_email) {
            const emailLower = notice.source_email.toLowerCase();
            const superadminEmailsEnv = process.env.SUPERADMIN_EMAILS || '';
            const superadmins = superadminEmailsEnv
              .split(',')
              .map((email) => email.trim().toLowerCase())
              .filter(Boolean);

            const db = (this.groupRepository as any).db;

            if (superadmins.includes(emailLower)) {
              senderLabel = 'super-admin';
              if (db) {
                const profile = await get<any>(
                  db,
                  'SELECT name FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
                  [emailLower]
                );
                if (profile && profile.name) {
                  displayName = profile.name;
                }
              }
            } else if (db) {
              const profile = await get<any>(
                db,
                'SELECT name FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
                [emailLower]
              );
              if (profile) {
                senderLabel = 'admin';
                if (profile.name) {
                  displayName = profile.name;
                }
              } else {
                const teacher = await get<any>(
                  db,
                  'SELECT name FROM managed_teachers WHERE LOWER(email) = ? LIMIT 1',
                  [emailLower]
                );
                if (teacher) {
                  senderLabel = 'profe';
                  if (teacher.name) {
                    displayName = teacher.name;
                  }
                } else {
                  const row = await get<any>(
                    db,
                    'SELECT description FROM authorized_emails WHERE LOWER(email) = ? LIMIT 1',
                    [emailLower]
                  );
                  if (row) {
                    senderLabel = 'colaborador';
                    if (row.description) {
                      displayName = row.description;
                    }
                  }
                }
              }
            }
          }

          // Resolve group selector label
          let grupoName = selector;
          if (selector === 'todos') {
            grupoName = 'todos los grupos de la técnicatura';
          } else if (selector === 'general') {
            grupoName = 'los grupos generales';
          } else if (selector.startsWith('camada:')) {
            grupoName = `la camada ${selector.split(':')[1]}`;
          } else {
            const matched = groups.find((g) => g.group_id.toLowerCase() === sel);
            if (matched) {
              grupoName = matched.display_name || matched.group_id;
            }
          }

          const roleMap: Record<string, string> = {
            'super-admin': 'Super Admin',
            'admin': 'Admin',
            'profe': 'Profe',
            'colaborador': 'Colaborador'
          };
          const roleText = roleMap[senderLabel] || senderLabel;

          const sourceEmailText = notice.source_email || 'N/A';
          const formattedMessage = `Hola! Vectorito reporrandose\u{1F63C}\n\n` +
            `*ID de mensaje:* ID: ${item.id}  \n` +
            `*El/La* ${roleText} ${displayName} \n` +
            `*E- mail:* ${sourceEmailText} \n` +
            `*Dejo un aviso para:* ${grupoName}\n\n` +
            `*Título:* ${notice.title}\n\n` +
            `*Mensaje:* \n` +
            `${notice.body}`;

          // Broadcast to groups
          for (const gid of resolvedGroupIds) {
            try {
              await this.whatsappGateway.sendTextMessage(gid, formattedMessage);
            } catch (err) {
              console.error(`[Scheduler] Error sending periodic notice to group ${gid}:`, err);
            }
          }

          // Mark sent
          await this.noticesRepository.markSent(item.id);
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
