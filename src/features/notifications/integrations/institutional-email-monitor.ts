import crypto from 'crypto';
import { ParsedMail } from 'mailparser';
import { InstitutionalNoticeRepository, InboundEmailRejectionRepository, AuthorizedEmailRepository } from '../notifications.repository.js';
import { ReminderRepository, ManagedTeacherRepository, GroupRepository, AdminRepository } from '../../../infrastructure/persistence/db/repositories.js';
import { EmailService, OutboundEmailService } from './email.service.js';
import { formatLocalDateOnly, get, all } from '../../../shared/db/db-utils.js';

export class InstitutionalEmailMonitor {
  private _polling = false;
  private _pendingPoll = false;

  constructor(
    private emailService: EmailService,
    private noticeRepository: InstitutionalNoticeRepository,
    private reminderRepository: ReminderRepository,
    private publishCallback: (text: string, groupId?: string) => Promise<void> | void,
    private getTargetGroupId?: () => Promise<string | undefined>,
    private managedTeacherRepository?: ManagedTeacherRepository,
    private groupRepository?: GroupRepository,
    private outboundEmailService?: OutboundEmailService,
    private rejectionRepository?: InboundEmailRejectionRepository,
    private adminRepository?: AdminRepository,
    private authorizedEmailRepository?: AuthorizedEmailRepository,
  ) {}

  public async pollOnce(): Promise<number> {
    console.log('[EmailMonitor] Iniciando revisión de emails no leídos...');
    const emails = await this.emailService.fetchUnreadInstitutionEmails();
    let processed = 0;

    console.log(`[EmailMonitor] Se obtuvieron ${emails.length} email(s) del buzón.`);

    // Obtener grupo destino dinámicamente si hay callback
    const targetGroupId = this.getTargetGroupId ? await this.getTargetGroupId() : undefined;

    for (const email of emails) {
      console.log(`[EmailMonitor] Analizando email - De: ${email.from?.text || '?'} | Asunto: "${email.subject || '(sin asunto)'}"`);
      const notice = this.parseNoticeFromEmail(email);
      if (!notice) {
        console.log(`[EmailMonitor] >> Email descartado: el asunto no contiene "aviso".`);
        continue;
      }
      console.log(`[EmailMonitor] [OK] Email reconocido como aviso institucional: "${notice.title}"`);

      // Extract source address (best-effort)
      const src = notice.sourceEmail || '';
      const m = src.match(/<([^>]+)>/);
      const sourceAddr = m ? m[1].toLowerCase() : src.trim().toLowerCase();

      // Validate sender: either superadmin, db admin, registered teacher, or authorized email
      const superadminEmailsEnv = process.env.SUPERADMIN_EMAILS || '';
      const superadmins = superadminEmailsEnv
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);

      let isAuthorized = false;
      let teacherRecords: any[] = [];
      let displayName = sourceAddr; // Fallback to email

      const hasRepositories = !!(this.managedTeacherRepository || this.adminRepository || this.authorizedEmailRepository);

      if (!hasRepositories) {
        isAuthorized = true;
      } else {
        if (superadmins.includes(sourceAddr)) {
          isAuthorized = true;
          if (this.adminRepository) {
            const profile = await get<any>(
              (this.adminRepository as any).db,
              'SELECT name FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
              [sourceAddr]
            );
            if (profile && profile.name) {
              displayName = profile.name;
            }
          }
        }

        if (!isAuthorized && this.adminRepository) {
          const adminEmails = await this.adminRepository.listAdminEmails();
          if (adminEmails.includes(sourceAddr)) {
            isAuthorized = true;
            const profile = await get<any>(
              (this.adminRepository as any).db,
              'SELECT name FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
              [sourceAddr]
            );
            if (profile && profile.name) {
              displayName = profile.name;
            }
          }
        }

        if (!isAuthorized && this.managedTeacherRepository) {
          if (typeof (this.managedTeacherRepository as any).listByEmail === 'function') {
            teacherRecords = await (this.managedTeacherRepository as any).listByEmail(sourceAddr);
          } else {
            const t = await this.managedTeacherRepository.getByEmail(sourceAddr);
            teacherRecords = t ? [t] : [];
          }
          if (teacherRecords.length > 0) {
            isAuthorized = true;
            const teacher = teacherRecords[0];
            displayName = teacher.name || sourceAddr;
          }
        }

        if (!isAuthorized && this.authorizedEmailRepository) {
          const customEmailExists = await this.authorizedEmailRepository.exists(sourceAddr);
          if (customEmailExists) {
            isAuthorized = true;
            const row = await get<any>(
              (this.authorizedEmailRepository as any).db,
              'SELECT description FROM authorized_emails WHERE LOWER(email) = ? LIMIT 1',
              [sourceAddr]
            );
            if (row && row.description) {
              displayName = row.description;
            }
          }
        }
      }

      if (!isAuthorized) {
        console.log(`[EmailMonitor] [RECHAZADO] Remitente no autorizado: ${sourceAddr}`);
        // Anti-spam deduplication logic
        const messageId = email.messageId;
        let fingerprint = '';
        if (messageId) {
          fingerprint = messageId.trim();
        } else {
          const fromStr = email.from?.text || '';
          const subjectStr = email.subject || '';
          const dateStr = email.date ? email.date.toISOString() : '';
          const bodyStr = email.text || '';
          const rawInput = [fromStr, subjectStr, dateStr, bodyStr].join('|');
          fingerprint = crypto.createHash('sha256').update(rawInput).digest('hex');
        }

        if (this.rejectionRepository) {
          const alreadyNotified = await this.rejectionRepository.exists(fingerprint);
          if (alreadyNotified) {
            continue;
          }
          await this.rejectionRepository.markIfNew(fingerprint, sourceAddr, email.subject || '');
        }

        // send unauthorized email if outbound service available
        if (this.outboundEmailService) {
          const subject = 'Correo no autorizado';
          const body = `Hola.\n\nTu correo (${sourceAddr}) no está asociado a un profesor registrado ni a un administrador autorizado, por lo que no puede procesarse como aviso institucional.\n\nSi considerás que esto es un error, contactá a administración.`;
          try {
            await this.outboundEmailService.send(sourceAddr, subject, body);
          } catch (e) {
            /* ignore */
          }
        }
        continue;
      }
      console.log(`[EmailMonitor] [OK] Remitente autorizado: ${sourceAddr}`);

      // Validate structure: at least 'cuerpo' or 'mensaje' is mandatory.
      if (!notice.body || notice.body.trim() === '') {
        console.log(`[EmailMonitor] [RECHAZADO] Email no estructurado (falta cuerpo/mensaje) de: ${sourceAddr}`);
        const messageId = email.messageId;
        let fingerprint = '';
        if (messageId) {
          fingerprint = messageId.trim();
        } else {
          const fromStr = email.from?.text || '';
          const subjectStr = email.subject || '';
          const dateStr = email.date ? email.date.toISOString() : '';
          const bodyStr = email.text || '';
          const rawInput = [fromStr, subjectStr, dateStr, bodyStr].join('|');
          fingerprint = crypto.createHash('sha256').update(rawInput).digest('hex');
        }

        if (this.rejectionRepository) {
          const alreadyNotified = await this.rejectionRepository.exists(fingerprint);
          if (alreadyNotified) {
            continue;
          }
          await this.rejectionRepository.markIfNew(fingerprint, sourceAddr, email.subject || '');
        }

        if (this.outboundEmailService) {
          let cohortsList = '';
          let groupsList = '';
          if (this.groupRepository) {
            const groups = await this.groupRepository.getAllActiveGroupsWithEntryYear();
            const cohorts = Array.from(new Set(groups.map((g) => g.entry_year).filter((y): y is number => y !== null))).sort();
            cohortsList = cohorts.map((c) => `  * camada: ${c}`).join('\n');
            groupsList = groups.map((g) => `  * ${g.display_name || g.group_id}`).join('\n');
          }

          const subject = 'Formato de aviso inválido o incompleto';
          const body = `Hola.\n\nNo pudimos procesar tu aviso institucional porque el mensaje no tiene la estructura correcta o le faltan campos obligatorios. Para publicar un aviso, por favor envía un correo que cumpla con el siguiente formato (completando los campos después del signo de dos puntos):\n\n` +
            `Asunto: aviso (o el título de tu aviso)\n` +
            `Cuerpo del mensaje:\n` +
            `nombre: [Nombre del Profesor / Emisor] (opcional)\n` +
            `inicia: [Fecha de inicio, ej. DD/MM/AAAA] (opcional)\n` +
            `termina: [Fecha límite/fin, ej. DD/MM/AAAA] (opcional)\n` +
            `hora: [Hora del evento, ej. 18:30] (opcional)\n` +
            `frecuencia: [Intervalo en días, ej: "unica" o "5d", "7d"] (opcional)\n` +
            `grupo: [Destinatario del aviso] (obligatorio. Ver opciones más abajo)\n` +
            `cuerpo: [Mensaje/Cuerpo del aviso] (obligatorio)\n\n` +
            `---\n` +
            `Opciones disponibles para el campo "grupo":\n` +
            `- "todos" (para notificar a todos los grupos de la tecnicatura)\n` +
            `- "general" (para notificar a los grupos generales de la tecnicatura)\n` +
            `- Camadas:\n${cohortsList || '  (no hay camadas activas)'}\n` +
            `- Grupos específicos (puedes poner el nombre exacto del grupo o su ID):\n${groupsList || '  (no hay grupos activos)'}\n\n` +
            `---\n` +
            `Si tenés alguna duda, por favor contactá al administrador.`;

          try {
            await this.outboundEmailService.send(sourceAddr, subject, body);
          } catch (e) {
            /* ignore */
          }
        }
        continue;
      }

      // Preventive duplicate check
      const existing = await this.noticeRepository.getByUniqueHashWithId(notice.uniqueHash);
      if (existing) {
        // Si ya fue confirmado, ignorar
        if (existing.notice.confirmed_at) {
          console.log(`[EmailMonitor] >> Aviso duplicado y ya confirmado: "${notice.title}". Ignorando.`);
          continue;
        }

        // If inserted but not confirmed, attempt to resend confirmation only
        if (this.outboundEmailService) {
          try {
            const subject = 'Confirmación de aviso institucional (reintento)';
            const body = `Hola.\n\nTu aviso titulado "${existing.notice.title}" fue publicado previamente. Este es un reintento de confirmación.`;
            await this.outboundEmailService.send(existing.notice.source_email || sourceAddr, subject, body);
            await this.noticeRepository.markConfirmed(existing.id);
          } catch (e) {
            // log and continue
            console.error('[EmailMonitor] Reintento de confirmación falló:', e);
          }
        }
        continue;
      }

      // Validate dates
      const today = new Date();
      if (notice.endDate && formatLocalDateOnly(notice.endDate) < formatLocalDateOnly(today)) {
        if (this.outboundEmailService) {
          const subject = 'Error al procesar tu aviso institucional';
          const body = `Hola.\n\nNo pudimos procesar tu aviso institucional.\n\nError: Fecha de vigencia expirada (termina antes de hoy).`;
          try { await this.outboundEmailService.send(notice.sourceEmail || sourceAddr, subject, body); } catch (e) { /* ignore */ }
        }
        continue;
      }
      if (notice.startDate && notice.endDate && notice.startDate.getTime() > notice.endDate.getTime()) {
        if (this.outboundEmailService) {
          const subject = 'Error al procesar tu aviso institucional';
          const body = `Hola.\n\nNo pudimos procesar tu aviso institucional.\n\nError: Rango temporal inconsistente (inicia > termina).`;
          try { await this.outboundEmailService.send(notice.sourceEmail || sourceAddr, subject, body); } catch (e) { /* ignore */ }
        }
        continue;
      }

      // Resolve groups atomically if groupRepository provided
      let resolvedGroupIds: string[] = [];
      const selector = (notice.grupo_selector || 'todos').trim().toLowerCase();
      if (this.groupRepository) {
        const groups = await this.groupRepository.getAllActiveGroupsWithEntryYear();
        const allowedGroupIdsForTeacher = teacherRecords.map((t) => t.group_id).filter(Boolean);
        const isSenderTeacher = teacherRecords.length > 0;
        const hasGroupRestriction = isSenderTeacher && allowedGroupIdsForTeacher.length > 0;

        if (selector === 'todos') {
          resolvedGroupIds = hasGroupRestriction
            ? allowedGroupIdsForTeacher
            : groups.map((g) => g.group_id);
        } else if (selector === 'general') {
          resolvedGroupIds = groups.filter((g) => g.entry_year === null).map((g) => g.group_id);
          if (hasGroupRestriction) {
            resolvedGroupIds = resolvedGroupIds.filter((gid) => allowedGroupIdsForTeacher.includes(gid));
          }
        } else {
          const m = selector.match(/^camada\s*:\s*(\d{4}(?:\s*,\s*\d{4})*)$/i);
          if (m) {
            const years = m[1].split(',').map((s) => Number(s.trim()));
            const missing: number[] = [];
            for (const y of years) {
              const found = groups.filter((g) => g.entry_year === y);
              if (!found.length) missing.push(y);
            }
            if (missing.length && !isSenderTeacher) {
              if (this.outboundEmailService) {
                const subject = 'Error al procesar tu aviso institucional';
                const body = `Hola.\n\nNo pudimos procesar tu aviso institucional.\n\nError: Las camadas solicitadas no tienen grupos activos: ${missing.join(', ')}`;
                try { await this.outboundEmailService.send(notice.sourceEmail || sourceAddr, subject, body); } catch (e) { /* ignore */ }
              }
              continue;
            }
            resolvedGroupIds = groups.filter((g) => years.includes(g.entry_year as number)).map((g) => g.group_id);
            if (hasGroupRestriction) {
              resolvedGroupIds = resolvedGroupIds.filter((gid) => allowedGroupIdsForTeacher.includes(gid));
            }
          } else {
            // Let's also support matching by individual group ID or display name!
            const matchedGroup = groups.find(
              (g) =>
                g.group_id.toLowerCase() === selector ||
                (g.display_name && g.display_name.toLowerCase() === selector)
            );
            if (matchedGroup) {
              resolvedGroupIds = [matchedGroup.group_id];
              if (hasGroupRestriction && !allowedGroupIdsForTeacher.includes(matchedGroup.group_id)) {
                resolvedGroupIds = [];
              }
            } else {
              // unknown selector
              if (this.outboundEmailService) {
                const subject = 'Error al procesar tu aviso institucional';
                const body = `Hola.\n\nNo pudimos procesar tu aviso institucional.\n\nError: Selector de grupos inválido (${notice.grupo_selector}).`;
                try { await this.outboundEmailService.send(notice.sourceEmail || sourceAddr, subject, body); } catch (e) { /* ignore */ }
              }
              continue;
            }
          }
        }

        if (hasGroupRestriction && resolvedGroupIds.length === 0) {
          if (this.outboundEmailService) {
            const subject = 'Error al procesar tu aviso institucional';
            const body = `Hola.\n\nNo pudimos procesar tu aviso institucional.\n\nError: No estás autorizado/a a publicar avisos en los grupos o camadas seleccionados (${notice.grupo_selector || 'todos'}).`;
            try { await this.outboundEmailService.send(notice.sourceEmail || sourceAddr, subject, body); } catch (e) { /* ignore */ }
          }
          continue;
        }
      }

      // Insert notice
      const inserted = await this.noticeRepository.createIfNew({
        title: notice.title,
        body: notice.body,
        start_date: notice.startDate,
        end_date: notice.endDate,
        event_time: notice.eventTime,
        source_email: sourceAddr,
        unique_hash: notice.uniqueHash,
        frecuencia: notice.frecuencia,
        grupo_selector: notice.grupo_selector,
      });
      if (!inserted) continue;

      // Get inserted id
      const justInserted = await this.noticeRepository.getByUniqueHashWithId(notice.uniqueHash);
      const insertedId = justInserted ? justInserted.id : undefined;

      // Construct grupoName for WhatsApp message template
      let grupoName = selector;
      if (selector === 'todos') {
        grupoName = 'todos los grupos de la técnicatura';
      } else if (selector === 'general') {
        grupoName = 'los grupos generales';
      } else {
        const m = selector.match(/^camada\s*:\s*(\d{4}(?:\s*,\s*\d{4})*)$/i);
        if (m) {
          grupoName = `la camada ${m[1]}`;
        } else if (this.groupRepository) {
          const matchedGroup = (await this.groupRepository.getAllActiveGroupsWithEntryYear()).find(
            (g) =>
              g.group_id.toLowerCase() === selector ||
              (g.display_name && g.display_name.toLowerCase() === selector)
          );
          if (matchedGroup) {
            grupoName = matchedGroup.display_name || matchedGroup.group_id;
          }
        }
      }

      // Build the WhatsApp notice message using the requested template
      const formattedMessage = `Hola! Vectorito reporrandose\u{1F63C}\n` +
        `El profe ${displayName} (ID: ${insertedId})  - e- mail ${sourceAddr} dejo un aviso para ${grupoName}\n` +
        `Título: ${notice.title}\n` +
        `Mensaje:\n` +
        `${notice.body}`;

      // Publish immediately on insertion
      const shouldPublishNow = true;

      if (shouldPublishNow) {
        try {
          if (resolvedGroupIds.length) {
            for (const gid of resolvedGroupIds) {
              await this.publishCallback(formattedMessage, gid);
            }
          } else {
            await this.publishCallback(formattedMessage);
          }
          // mark published and sent
          if (insertedId) await this.noticeRepository.markSent(insertedId);
        } catch (e) {
          // rollback insertion if publishing failed
          if (insertedId) await this.noticeRepository.deleteById(insertedId);
          console.error('[EmailMonitor] Error al publicar en grupos de WhatsApp, aviso revertido:', e);
          continue;
        }
      }

      // Create reminder
      const targetDate = notice.endDate ?? notice.startDate;
      if (targetDate) {
        await this.reminderRepository.create({
          user_id: 'institutional',
          event_type: 'institutional_notice',
          description: `Quedan pocos dias para inscribirse a ${notice.title}.`,
          event_date: targetDate,
          source: 'email',
          group_id: targetGroupId ?? null,
        });
      }

      // Send confirmation email
      if (this.outboundEmailService) {
        try {
          const subject = 'Confirmación de aviso institucional recibido';
          const body = `Hola.\n\nTu aviso institucional fue recibido y procesado correctamente.\n\nTítulo: ${notice.title}\nVigencia: ${notice.startDate ? formatLocalDateOnly(notice.startDate) : 'N/A'} a ${notice.endDate ? formatLocalDateOnly(notice.endDate) : 'N/A'}\nHora: ${notice.eventTime ?? ''}\nGrupo: ${notice.grupo_selector ?? 'todos'}\nEstado: Confirmado`;
          await this.outboundEmailService.send(notice.sourceEmail || sourceAddr, subject, body);
          if (insertedId) await this.noticeRepository.markConfirmed(insertedId);
        } catch (e) {
          console.error('[EmailMonitor] Error enviando email de confirmación:', e);
        }
      }

      console.log(`[EmailMonitor] [OK] Aviso procesado y publicado exitosamente: "${notice.title}"`);
      processed += 1;
    }

    console.log(`[EmailMonitor] Revision completada. Avisos procesados: ${processed}/${emails.length}`);
    return processed;
  }

  private parseNoticeFromEmail(email: ParsedMail): {
    title: string;
    body?: string;
    startDate?: Date;
    endDate?: Date;
    eventTime?: string;
    sourceEmail?: string;
    uniqueHash: string;
    frecuencia?: string;
    grupo_selector?: string;
  } | null {
    const subject = (email.subject || '').trim();
    if (!subject.toLowerCase().includes('aviso')) return null;

    const sourceEmail = email.from?.text || undefined;
    const body = (email.text || '').trim();
    const fields = this.parseStructuredFields(body);

    const title = fields.nombre || subject.replace(/aviso/gi, '').trim() || 'Aviso institucional';
    const bodyText = fields.cuerpo || fields.mensaje;
    const startDate = this.parseDate(fields.inicia);
    const endDate = this.parseDate(fields.termina);
    const eventTime = fields.hora;
    const frecuencia = fields.frecuencia;
    const grupoSelector = fields.grupo;

    const uniqueInput = [
      subject,
      sourceEmail || '',
      title,
      startDate?.toISOString() || '',
      endDate?.toISOString() || '',
      eventTime || '',
      bodyText || '',
    ].join('|');

    const uniqueHash = crypto.createHash('sha256').update(uniqueInput).digest('hex');

    return {
      title,
      body: bodyText,
      startDate,
      endDate,
      eventTime,
      sourceEmail,
      uniqueHash,
      frecuencia,
      grupo_selector: grupoSelector,
    };
  }

  private parseStructuredFields(body: string): Record<string, string> {
    const out: Record<string, string> = {};
    const fieldPattern = /^(nombre|inicia|termina|hora|cuerpo|mensaje|frecuencia|grupo)\s*:\s*(.+)$/i;

    for (const line of body.split('\n')) {
      const match = line.trim().match(fieldPattern);
      if (!match) continue;
      out[match[1].toLowerCase()] = match[2].trim();
    }

    return out;
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) return undefined;

    const dm = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (dm) {
      const day = Number(dm[1]);
      const month = Number(dm[2]);
      const year = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : new Date().getFullYear();
      const dt = new Date(year, month - 1, day);
      if (!Number.isNaN(dt.getTime())) return dt;
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    return undefined;
  }

  public startListening(): void {
    if (this.emailService && typeof this.emailService.listenForNewEmails === 'function') {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      this.emailService.listenForNewEmails(async () => {
        // Debounce: esperar 1.5s a que se estabilicen los eventos rapidos
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(async () => {
          debounceTimer = null;
          await this.safePollOnce();
        }, 1500);
      });
    }
  }

  private async safePollOnce(): Promise<void> {
    if (this._polling) {
      console.log('[EmailMonitor] Ya hay un poll en curso. Se re-procesara al terminar.');
      this._pendingPoll = true;
      return;
    }

    this._polling = true;
    try {
      console.log('[EmailMonitor] Callback disparado por escucha en tiempo real de email.');
      await this.pollOnce();
    } catch (err) {
      console.error('[EmailMonitor] Error inesperado en pollOnce:', err);
    } finally {
      this._polling = false;

      // Si llego otro evento durante el poll, re-ejecutar una vez mas
      if (this._pendingPoll) {
        this._pendingPoll = false;
        console.log('[EmailMonitor] Re-procesando emails pendientes...');
        // Pequeña pausa antes de re-poll
        setTimeout(() => this.safePollOnce(), 2000);
      }
    }
  }
}
