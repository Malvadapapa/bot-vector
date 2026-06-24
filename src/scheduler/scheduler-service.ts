import cron from 'node-cron';
import sqlite3 from 'sqlite3';

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
import { formatLocalDateOnly, get, all, run } from '../shared/db/db-utils.js';
import { YearLifecycleService } from '../features/academic-calendar/year-lifecycle.service.js';
import { OutboundEmailService } from '../features/notifications/integrations/email.service.js';

export class SchedulerService {
  private examNotificationService: ExamNotificationService;
  private yearLifecycleService: YearLifecycleService;

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
    private outboundEmailService?: OutboundEmailService,
    private sqliteDb?: sqlite3.Database,
  ) {
    // ExamNotificationService will be initialized with active groups in startJobs()
    this.examNotificationService = new ExamNotificationService(
      managedExamRepository,
      whatsappGateway,
      [], // Will be populated dynamically
    );
    this.yearLifecycleService = new YearLifecycleService(
      groupRepository,
      whatsappGateway,
      outboxDedupRepository
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

    cron.schedule('*/15 * * * *', async () => {
      await this.safeRun('send_email_digests', async () => {
        await this.sendEmailDigests();
      });
      await this.safeRun('send_whatsapp_digests', async () => {
        await this.sendWhatsAppDigests();
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

          let headerText = '📢 *AVISO INSTITUCIONAL*';
          if (senderLabel === 'super-admin') {
            headerText = '📢 *AVISO DEL SUPER ADMINISTRADOR*';
          } else if (senderLabel === 'admin') {
            headerText = '📢 *AVISO DEL ADMINISTRADOR*';
          } else if (senderLabel === 'profe') {
            headerText = '📢 *AVISO DE PROFESOR*';
          }

          const formattedMessage = `Hola! Vectorito reporrandose\u{1F63C}\n\n` +
            `${headerText}\n\n` +
            `*De:* ${displayName} (${roleText})\n` +
            `*Para:* ${grupoName}\n` +
            `*ID de mensaje:* ID: ${item.id}\n\n` +
            `*Título:* ${notice.title}\n\n` +
            `*Mensaje:* \n` +
            `${notice.body}\n\n` +
            `💡 *Para responder al profesor, escribí en este grupo:*\n` +
            `!rid${item.id} tu mensaje para responder al profesor`;

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

    // Tarea diaria de ciclo de vida académico
    cron.schedule('0 10 * * *', async () => {
      await this.safeRun('year_lifecycle_messages', async () => {
        await this.yearLifecycleService.checkAndSendLifecycleMessages();
      });
    });

    // Tarea diaria de alertas ABP
    cron.schedule('0 9 * * *', async () => {
      await this.safeRun('abp_warnings_daemon', async () => {
        await this.checkABPWarnings();
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

  public async checkABPWarnings(): Promise<void> {
    const activeGroupIds = await this.groupRepository.getAllActiveIds();
    for (const groupId of activeGroupIds) {
      const examEntries = await this.managedExamRepository.listWithIds(1000, groupId);
      const exams = examEntries.map((e) => e.exam);
      
      const subjects = Array.from(new Set(exams.map((e) => e.subject.trim())));
      const warnings: string[] = [];

      for (const subject of subjects) {
        const subjectExams = exams.filter((e) => e.subject.trim().toLowerCase() === subject.toLowerCase());
        const evidences = subjectExams.filter((e) => e.exam_type.trim().toLowerCase() === 'evidencia');
        const hasABP = subjectExams.some((e) => e.exam_type.trim().toLowerCase() === 'abp');

        if (evidences.length >= 3 && !hasABP) {
          warnings.push(subject);
        }
      }

      if (warnings.length > 0) {
        const warningsText = warnings.map((w) => `• ${w}`).join('\n');
        const group = await this.groupRepository.findByGroupId(groupId);
        const groupName = group?.display_name || groupId;

        const db = (this.groupRepository as any).db;
        const adminRows = await all<any>(db, 'SELECT user_id FROM group_admins WHERE group_id = ?', [groupId]);
        let adminIds = adminRows.map((r) => String(r.user_id));

        if (adminIds.length === 0) {
          const superAdminRows = await all<any>(db, 'SELECT user_id FROM admin_users WHERE is_super_admin = 1');
          adminIds = superAdminRows.map((r) => String(r.user_id));
        }

        const alertTextWithGroup = [
          `⚠️ *Alerta ABP de Grupo: ${groupName}*`,
          `Se detectaron materias con 3 o más evidencias registradas pero sin Defensa ABP asignada:`,
          ``,
          warningsText,
          ``,
          `Por favor, recuerden programar la Defensa ABP desde la configuración del grupo.`
        ].join('\n');
        
        for (const adminId of adminIds) {
          const todayLocalStr = formatLocalDateOnly(new Date());
          const dedupKey = `abp_alert:${groupId}:${todayLocalStr}:${adminId}`;
          const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
          if (shouldSend) {
            try {
              await this.whatsappGateway.sendTextMessage(adminId, alertTextWithGroup, undefined, true);
            } catch (e) {
              console.error(`Error sending abp warning to admin ${adminId}:`, e);
            }
          }
        }
      }
    }
  }

  private async sendEmailDigests(): Promise<void> {
    if (!this.sqliteDb || !this.outboundEmailService) return;

    // Fetch student replies from teacher messages
    let teacherReplies: any[] = [];
    try {
      teacherReplies = await all<any>(
        this.sqliteDb,
        `SELECT r.id, r.teacher_message_id, r.author_name, r.content, r.timestamp,
                m.author_id as teacher_email, m.author_name as teacher_name, m.content as message_subject
         FROM teacher_message_replies r
         JOIN teacher_messages m ON r.teacher_message_id = m.id
         WHERE r.is_from_student = 1 AND r.email_sent = 0`
      );
    } catch (e) {
      console.warn('[Scheduler] Error fetching unsent teacher replies:', e);
    }

    // Fetch student replies from institutional notices
    let noticeReplies: any[] = [];
    try {
      noticeReplies = await all<any>(
        this.sqliteDb,
        `SELECT r.id, r.notice_id, r.author_name, r.content, r.timestamp,
                n.source_email as creator_email, n.title as notice_title
         FROM notice_replies r
         JOIN institutional_notices n ON r.notice_id = n.id
         WHERE r.is_from_student = 1 AND r.email_sent = 0`
      );
    } catch (e) {
      console.warn('[Scheduler] Error fetching unsent notice replies:', e);
    }

    if (teacherReplies.length === 0 && noticeReplies.length === 0) {
      return;
    }

    const digests: Record<string, {
      recipientName: string;
      teacherReplies: any[];
      noticeReplies: any[];
    }> = {};

    for (const r of teacherReplies) {
      const email = r.teacher_email?.toLowerCase().trim();
      if (!email) continue;
      if (!digests[email]) {
        digests[email] = { recipientName: r.teacher_name || 'Profesor', teacherReplies: [], noticeReplies: [] };
      }
      digests[email].teacherReplies.push(r);
    }

    for (const r of noticeReplies) {
      const email = r.creator_email?.toLowerCase().trim();
      if (!email) continue;
      if (!digests[email]) {
        let creatorName = email;
        try {
          const profile = await get<any>(
            this.sqliteDb,
            'SELECT name FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
            [email]
          );
          if (profile?.name) {
            creatorName = profile.name;
          } else {
            const teacher = await get<any>(
              this.sqliteDb,
              'SELECT name FROM managed_teachers WHERE LOWER(email) = ? LIMIT 1',
              [email]
            );
            if (teacher?.name) {
              creatorName = teacher.name;
            }
          }
        } catch {}
        digests[email] = { recipientName: creatorName, teacherReplies: [], noticeReplies: [] };
      }
      digests[email].noticeReplies.push(r);
    }

    for (const [email, data] of Object.entries(digests)) {
      const { recipientName, teacherReplies, noticeReplies } = data;
      const count = teacherReplies.length + noticeReplies.length;

      const subject = `Resumen de nuevas consultas de alumnos (${count})`;

      let textBody = `Hola ${recipientName},\n\nTenés ${count} nuevas respuestas/consultas de alumnos pendientes en el Panel de Vectorito:\n\n`;
      let htmlBody = `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">`;
      htmlBody += `<h2 style="color: #4f46e5; margin-top: 0; margin-bottom: 20px;">🔔 Resumen de nuevas consultas</h2>`;
      htmlBody += `<p>Hola <strong>${recipientName}</strong>,</p>`;
      htmlBody += `<p>Tenés <strong>${count}</strong> nuevas respuestas/consultas de alumnos en el Panel de Vectorito:</p>`;

      if (teacherReplies.length > 0) {
        textBody += `💬 CONSULTAS A TUS MENSAJES DE PROFESOR:\n`;
        htmlBody += `<h3 style="color: #4b5563; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-top: 24px;">💬 Consultas a tus mensajes de Profesor:</h3><ul style="padding-left: 20px; list-style-type: none;">`;
        for (const r of teacherReplies) {
          textBody += `- De: ${r.author_name}\n  En respuesta a: "${r.message_subject || 'Sin Asunto'}"\n  Mensaje: "${r.content}"\n  Fecha: ${r.timestamp}\n\n`;
          htmlBody += `<li style="margin-bottom: 16px; border-left: 3px solid #10b981; padding-left: 12px;"><strong>${r.author_name}</strong> (en respuesta a: <em>"${r.message_subject || 'Sin Asunto'}"</em>):<br/>`;
          htmlBody += `<span style="display:inline-block; margin-top:4px; padding: 8px 12px; background-color:#f3f4f6; border-radius:6px; color:#1f2937;">${r.content}</span></li>`;
        }
        htmlBody += `</ul>`;
      }

      if (noticeReplies.length > 0) {
        textBody += `📢 RESPUESTAS A TUS AVISOS INSTITUCIONALES:\n`;
        htmlBody += `<h3 style="color: #4b5563; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-top: 24px;">📢 Respuestas a tus avisos Institucionales:</h3><ul style="padding-left: 20px; list-style-type: none;">`;
        for (const r of noticeReplies) {
          textBody += `- De: ${r.author_name}\n  En respuesta a: "${r.notice_title || 'Sin Título'}"\n  Mensaje: "${r.content}"\n  Fecha: ${r.timestamp}\n\n`;
          htmlBody += `<li style="margin-bottom: 16px; border-left: 3px solid #8b5cf6; padding-left: 12px;"><strong>${r.author_name}</strong> (en respuesta a: <em>"${r.notice_title || 'Sin Título'}"</em>):<br/>`;
          htmlBody += `<span style="display:inline-block; margin-top:4px; padding: 8px 12px; background-color:#f3f4f6; border-radius:6px; color:#1f2937;">${r.content}</span></li>`;
        }
        htmlBody += `</ul>`;
      }

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      textBody += `Podés ingresar al panel para responder en: ${baseUrl}\n\nEquipo de Vectorito`;
      htmlBody += `<hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;">`;
      htmlBody += `<p>Ingresá al panel de control para responderles:</p>`;
      htmlBody += `<div style="text-align: center; margin: 24px 0;"><a href="${baseUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Ir al Panel Web</a></div>`;
      htmlBody += `<p style="font-size: 0.9em; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 10px; margin-top: 20px;">Saludos,<br/><strong>Vectorito Bot</strong></p>`;
      htmlBody += `</div>`;

      try {
        await this.outboundEmailService.send(email, subject, textBody, htmlBody);
        
        // Mark as sent
        if (teacherReplies.length > 0) {
          const tIds = teacherReplies.map((r) => r.id);
          await run(this.sqliteDb, `UPDATE teacher_message_replies SET email_sent = 1 WHERE id IN (${tIds.map(() => '?').join(',')})`, tIds);
        }
        if (noticeReplies.length > 0) {
          const nIds = noticeReplies.map((r) => r.id);
          await run(this.sqliteDb, `UPDATE notice_replies SET email_sent = 1 WHERE id IN (${nIds.map(() => '?').join(',')})`, nIds);
        }
      } catch (err) {
        console.error(`[Scheduler] Error sending email digest to ${email}:`, err);
      }
    }
  }

  private async sendWhatsAppDigests(): Promise<void> {
    if (!this.sqliteDb || !this.whatsappGateway) return;

    // Fetch student replies from teacher messages (whatsapp_sent = 0)
    let teacherReplies: any[] = [];
    try {
      teacherReplies = await all<any>(
        this.sqliteDb,
        `SELECT r.id, r.teacher_message_id, r.author_name, r.content, r.timestamp,
                m.author_id as teacher_email, m.author_name as teacher_name, m.content as message_subject
         FROM teacher_message_replies r
         JOIN teacher_messages m ON r.teacher_message_id = m.id
         WHERE r.is_from_student = 1 AND r.whatsapp_sent = 0`
      );
    } catch (e) {
      console.warn('[Scheduler] Error fetching unsent WhatsApp teacher replies:', e);
    }

    // Fetch student replies from institutional notices (whatsapp_sent = 0)
    let noticeReplies: any[] = [];
    try {
      noticeReplies = await all<any>(
        this.sqliteDb,
        `SELECT r.id, r.notice_id, r.author_name, r.content, r.timestamp,
                n.source_email as creator_email, n.title as notice_title
         FROM notice_replies r
         JOIN institutional_notices n ON r.notice_id = n.id
         WHERE r.is_from_student = 1 AND r.whatsapp_sent = 0`
      );
    } catch (e) {
      console.warn('[Scheduler] Error fetching unsent WhatsApp notice replies:', e);
    }

    if (teacherReplies.length === 0 && noticeReplies.length === 0) {
      return;
    }

    const digests: Record<string, {
      recipientName: string;
      phone: string;
      notifyWhatsapp: number;
      teacherReplies: any[];
      noticeReplies: any[];
    }> = {};

    for (const r of teacherReplies) {
      const email = r.teacher_email?.toLowerCase().trim();
      if (!email) continue;
      if (!digests[email]) {
        let teacherName = r.teacher_name || 'Profesor';
        let phone = '';
        let notifyWhatsapp = 0;
        try {
          const t = await get<any>(
            this.sqliteDb,
            'SELECT name, phone, notify_whatsapp FROM managed_teachers WHERE LOWER(email) = ? LIMIT 1',
            [email]
          );
          if (t) {
            teacherName = t.name || teacherName;
            phone = t.phone || '';
            notifyWhatsapp = t.notify_whatsapp;
          }
        } catch {}
        digests[email] = { recipientName: teacherName, phone, notifyWhatsapp, teacherReplies: [], noticeReplies: [] };
      }
      digests[email].teacherReplies.push(r);
    }

    for (const r of noticeReplies) {
      const email = r.creator_email?.toLowerCase().trim();
      if (!email) continue;
      if (!digests[email]) {
        let creatorName = email;
        let phone = '';
        let notifyWhatsapp = 0;
        try {
          const t = await get<any>(
            this.sqliteDb,
            'SELECT name, phone, notify_whatsapp FROM managed_teachers WHERE LOWER(email) = ? LIMIT 1',
            [email]
          );
          if (t) {
            creatorName = t.name || creatorName;
            phone = t.phone || '';
            notifyWhatsapp = t.notify_whatsapp;
          } else {
            const profile = await get<any>(
              this.sqliteDb,
              'SELECT name FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
              [email]
            );
            if (profile?.name) {
              creatorName = profile.name;
            }
          }
        } catch {}
        digests[email] = { recipientName: creatorName, phone, notifyWhatsapp, teacherReplies: [], noticeReplies: [] };
      }
      digests[email].noticeReplies.push(r);
    }

    for (const [email, data] of Object.entries(digests)) {
      const { recipientName, phone, notifyWhatsapp, teacherReplies, noticeReplies } = data;
      if (notifyWhatsapp === 0 || !phone.trim()) {
        continue;
      }

      const count = teacherReplies.length + noticeReplies.length;
      
      let message = `🔔 *Vectorito: Resumen de consultas* 🔔\n\n` +
        `Hola *${recipientName}*,\n\n` +
        `Tenés *${count}* nuevas respuestas/consultas de alumnos pendientes en el Panel de Vectorito:\n\n`;

      if (teacherReplies.length > 0) {
        message += `💬 *Consultas a tus mensajes de Profesor:*\n`;
        for (const r of teacherReplies) {
          message += `• *${r.author_name}* (en _"${r.message_subject || 'Sin Asunto'}"_):\n  "${r.content}"\n`;
        }
        message += `\n`;
      }

      if (noticeReplies.length > 0) {
        message += `📢 *Respuestas a tus avisos Institucionales:*\n`;
        for (const r of noticeReplies) {
          message += `• *${r.author_name}* (en _"${r.notice_title || 'Sin Título'}"_):\n  "${r.content}"\n`;
        }
        message += `\n`;
      }

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      message += `Podés responder ingresando al panel en:\n${baseUrl}\n\n_Equipo de Vectorito_`;

      let destinationJid = phone.trim();
      if (!destinationJid.includes('@')) {
        const digits = destinationJid.replace(/\D/g, '');
        destinationJid = `${digits}@s.whatsapp.net`;
      }

      try {
        await this.whatsappGateway.sendTextMessage(destinationJid, message);

        if (teacherReplies.length > 0) {
          const tIds = teacherReplies.map((r) => r.id);
          await run(
            this.sqliteDb,
            `UPDATE teacher_message_replies SET whatsapp_sent = 1 WHERE id IN (${tIds.map(() => '?').join(',')})`,
            tIds
          );
        }
        if (noticeReplies.length > 0) {
          const nIds = noticeReplies.map((r) => r.id);
          await run(
            this.sqliteDb,
            `UPDATE notice_replies SET whatsapp_sent = 1 WHERE id IN (${nIds.map(() => '?').join(',')})`,
            nIds
          );
        }
      } catch (err) {
        console.error(`[Scheduler] Error sending WhatsApp digest to ${destinationJid}:`, err);
      }
    }
  }
}
