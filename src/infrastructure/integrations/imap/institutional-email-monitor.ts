import crypto from 'crypto';
import { ParsedMail } from 'mailparser';
import { InstitutionalNoticeRepository, ReminderRepository, ManagedTeacherRepository, GroupRepository } from '../../persistence/db/repositories.js';
import { EmailService, OutboundEmailService } from '../email-service.js';

export class InstitutionalEmailMonitor {
  constructor(
    private emailService: EmailService,
    private noticeRepository: InstitutionalNoticeRepository,
    private reminderRepository: ReminderRepository,
    private publishCallback: (text: string, groupId?: string) => Promise<void> | void,
    private getTargetGroupId?: () => Promise<string | undefined>,
    private managedTeacherRepository?: ManagedTeacherRepository,
    private groupRepository?: GroupRepository,
    private outboundEmailService?: OutboundEmailService,
  ) {}

  public async pollOnce(): Promise<number> {
    const emails = await this.emailService.fetchUnreadInstitutionEmails();
    let processed = 0;

    // PHASE 5: Get target group ID dynamically if callback provided
    const targetGroupId = this.getTargetGroupId ? await this.getTargetGroupId() : undefined;

    for (const email of emails) {
      const notice = this.parseNoticeFromEmail(email);
      if (!notice) continue;

      // Extract source address (best-effort)
      const src = notice.sourceEmail || '';
      const m = src.match(/<([^>]+)>/);
      const sourceAddr = m ? m[1].toLowerCase() : src.trim().toLowerCase();

      // Validate sender if repository is provided
      if (this.managedTeacherRepository) {
        const teacher = await this.managedTeacherRepository.getByEmail(sourceAddr);
        if (!teacher) {
          // send unauthorized email if outbound service available
          if (this.outboundEmailService) {
            const subject = 'Correo no autorizado';
            const body = `Hola.\n\nTu correo (${sourceAddr}) no está asociado a un profesor registrado, por lo que no puede procesarse como aviso institucional.\n\nSi considerás que esto es un error, contactá a administración.`;
            try { await this.outboundEmailService.send(sourceAddr, subject, body); } catch (e) { /* ignore */ }
          }
          continue;
        }
      }

      // Preventive duplicate check
      const existing = await this.noticeRepository.getByUniqueHashWithId(notice.uniqueHash);
      if (existing) {
        // If already confirmed, ignore
        if (existing.notice.confirmed_at) continue;

        // If inserted but not confirmed, attempt to resend confirmation only
        if (this.outboundEmailService) {
          try {
            const subject = 'Confirmación de aviso institucional (reintento)';
            const body = `Hola.\n\nTu aviso titulado "${existing.notice.title}" fue publicado previamente. Este es un reintento de confirmación.`;
            await this.outboundEmailService.send(existing.notice.source_email || sourceAddr, subject, body);
            await this.noticeRepository.markConfirmed(existing.id);
          } catch (e) {
            // log and continue
            console.error('[InstitutionalEmailMonitor] Reintento de confirmación falló:', e);
          }
        }
        continue;
      }

      // Validate dates
      const today = new Date();
      if (notice.endDate && notice.endDate.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) {
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
        if (selector === 'todos') {
          resolvedGroupIds = groups.map((g) => g.group_id);
        } else if (selector === 'general') {
          resolvedGroupIds = groups.filter((g) => g.entry_year === null).map((g) => g.group_id);
        } else {
          const m = selector.match(/^camada\s*:\s*(\d{4}(?:\s*,\s*\d{4})*)$/i);
          if (m) {
            const years = m[1].split(',').map((s) => Number(s.trim()));
            const missing: number[] = [];
            for (const y of years) {
              const found = groups.filter((g) => g.entry_year === y);
              if (!found.length) missing.push(y);
            }
            if (missing.length) {
              if (this.outboundEmailService) {
                const subject = 'Error al procesar tu aviso institucional';
                const body = `Hola.\n\nNo pudimos procesar tu aviso institucional.\n\nError: Las camadas solicitadas no tienen grupos activos: ${missing.join(', ')}`;
                try { await this.outboundEmailService.send(notice.sourceEmail || sourceAddr, subject, body); } catch (e) { /* ignore */ }
              }
              continue;
            }
            resolvedGroupIds = groups.filter((g) => years.includes(g.entry_year as number)).map((g) => g.group_id);
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

      // Insert notice
      const inserted = await this.noticeRepository.createIfNew({
        title: notice.title,
        body: notice.body,
        start_date: notice.startDate,
        end_date: notice.endDate,
        event_time: notice.eventTime,
        source_email: notice.sourceEmail,
        unique_hash: notice.uniqueHash,
        frecuencia: notice.frecuencia,
        grupo_selector: notice.grupo_selector,
      });
      if (!inserted) continue;

      // Get inserted id
      const justInserted = await this.noticeRepository.getByUniqueHashWithId(notice.uniqueHash);
      const insertedId = justInserted ? justInserted.id : undefined;

      // Publish per resolved group if any, otherwise fallback to publishCallback default behavior
      const message = this.buildNaturalMessage(notice.title, notice.body, notice.endDate, notice.eventTime);
      try {
        if (resolvedGroupIds.length) {
          for (const gid of resolvedGroupIds) {
            await this.publishCallback(message, gid);
          }
        } else {
          await this.publishCallback(message);
        }
        // mark published
        if (insertedId) await this.noticeRepository.markPublished(insertedId);
      } catch (e) {
        // rollback insertion if publishing failed
        if (insertedId) await this.noticeRepository.deleteById(insertedId);
        console.error('[InstitutionalEmailMonitor] Error publishing to WhatsApp groups, rolled back notice:', e);
        continue;
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
          const body = `Hola.\n\nTu aviso institucional fue recibido y procesado correctamente.\n\nTítulo: ${notice.title}\nVigencia: ${notice.startDate ? notice.startDate.toISOString().slice(0,10) : 'N/A'} a ${notice.endDate ? notice.endDate.toISOString().slice(0,10) : 'N/A'}\nHora: ${notice.eventTime ?? ''}\nGrupo: ${notice.grupo_selector ?? 'todos'}\nEstado: Confirmado`;
          await this.outboundEmailService.send(notice.sourceEmail || sourceAddr, subject, body);
          if (insertedId) await this.noticeRepository.markConfirmed(insertedId);
        } catch (e) {
          console.error('[InstitutionalEmailMonitor] Error sending confirmation email:', e);
        }
      }

      processed += 1;
    }

    return processed;
  }

  private parseNoticeFromEmail(email: ParsedMail): {
    title: string;
    body: string;
    startDate?: Date;
    endDate?: Date;
    eventTime?: string;
    sourceEmail?: string;
    uniqueHash: string;
    frecuencia?: string;
    grupo_selector?: string;
  } | null {
    const subject = (email.subject || '').trim();
    if (!subject.toLowerCase().includes('!aviso')) return null;

    const sourceEmail = email.from?.text || undefined;
    const body = (email.text || '').trim();
    const fields = this.parseStructuredFields(body);

    const title = fields.nombre || subject.replace(/!aviso/gi, '').trim() || 'Aviso institucional';
    const bodyText = fields.cuerpo || body;
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
      bodyText,
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
    const fieldPattern = /^(nombre|inicia|termina|hora|cuerpo|frecuencia|grupo)\s*:\s*(.+)$/i;

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

  private buildNaturalMessage(title: string, body: string, endDate?: Date, eventTime?: string): string {
    const endText = endDate ? ` hasta ${endDate.toISOString().slice(0, 10)}` : '';
    const timeText = eventTime ? ` a las ${eventTime}` : '';
    return `Aviso institucional: ${title}. ${body}${endText}${timeText}.`.trim();
  }
}
