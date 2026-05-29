import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import nodemailer from 'nodemailer';

export class EmailService {
  constructor() {}

  public async fetchUnreadInstitutionEmails(): Promise<ParsedMail[]> {
    const emails: ParsedMail[] = [];

    // Saltar si las credenciales IMAP no están configuradas (valores placeholder).
    const imapUser = process.env.IMAP_USER || process.env.EMAIL_USER || '';
    const imapPass = process.env.IMAP_PASSWORD || process.env.EMAIL_PASS || '';
    const isPlaceholder = !imapUser || !imapPass ||
      imapUser.includes('tu_email') || imapPass.includes('tu_contraseña') ||
      imapUser === 'tu_email@gmail.com';
    if (isPlaceholder) {
      return emails; // Credenciales no configuradas, sin intentar conexión.
    }

    const client = new ImapFlow({
      host: process.env.IMAP_HOST || process.env.IMAP_SERVER || 'imap.gmail.com',
      port: parseInt(process.env.IMAP_PORT || '993', 10),
      secure: true,
      auth: {
        user: process.env.IMAP_USER || process.env.EMAIL_USER || '',
        pass: process.env.IMAP_PASSWORD || process.env.EMAIL_PASS || '',
      },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const messages = await client.search({ seen: false });
        
        if (messages === false || messages.length === 0) {
            return emails;
        }

        for await (const message of client.fetch(messages, { source: true })) {
            if (message.source) {
                const parsed = await simpleParser(message.source);
                emails.push(parsed);
            }
        }
      } finally {
        lock.release();
      }
    } catch (error) {
      console.error('Error fetching emails:', error);
    } finally {
      try {
        await client.logout();
      } catch {
        // Ignorado: fallo al cerrar IMAP no debe impactar al bot de WhatsApp.
      }
    }
    return emails;
  }
}

export class OutboundEmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT || 587),
      secure: (process.env.SMTP_SECURE || 'false') === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    });
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    if (!to) throw new Error('Missing recipient');
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com';
    try {
      await this.transporter.sendMail({
        from,
        to,
        subject,
        text: body,
      });
    } catch (err) {
      console.error('[OutboundEmailService] Error sending email:', err);
      throw err;
    }
  }
}
