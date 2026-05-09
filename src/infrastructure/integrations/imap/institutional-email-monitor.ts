import crypto from 'crypto';
import { ParsedMail } from 'mailparser';
import { InstitutionalNoticeRepository, ReminderRepository } from '../../persistence/db/repositories.js';
import { EmailService } from '../email-service.js';

export class InstitutionalEmailMonitor {
  constructor(
    private emailService: EmailService,
    private noticeRepository: InstitutionalNoticeRepository,
    private reminderRepository: ReminderRepository,
    private publishCallback: (text: string) => Promise<void> | void,
    private targetGroupId?: string,
  ) {}

  public async pollOnce(): Promise<number> {
    const emails = await this.emailService.fetchUnreadInstitutionEmails();
    let processed = 0;

    for (const email of emails) {
      const notice = this.parseNoticeFromEmail(email);
      if (!notice) continue;

      const inserted = await this.noticeRepository.createIfNew({
        title: notice.title,
        body: notice.body,
        start_date: notice.startDate,
        end_date: notice.endDate,
        event_time: notice.eventTime,
        source_email: notice.sourceEmail,
        unique_hash: notice.uniqueHash,
      });
      if (!inserted) continue;

      processed += 1;
      await this.publishCallback(this.buildNaturalMessage(notice.title, notice.body, notice.endDate, notice.eventTime));

      const targetDate = notice.endDate ?? notice.startDate;
      if (targetDate) {
        await this.reminderRepository.create({
          user_id: 'institutional',
          event_type: 'institutional_notice',
          description: `Quedan pocos dias para inscribirse a ${notice.title}.`,
          event_date: targetDate,
          source: 'email',
          group_id: this.targetGroupId ?? null,
        });
      }
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
    };
  }

  private parseStructuredFields(body: string): Record<string, string> {
    const out: Record<string, string> = {};
    const fieldPattern = /^(nombre|inicia|termina|hora|cuerpo)\s*:\s*(.+)$/i;

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
