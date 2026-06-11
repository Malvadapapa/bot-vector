import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import nodemailer from 'nodemailer';
import fs from 'fs';

export class EmailService {
  constructor() {}

  private buildTlsOptions() {
    const tlsRejectUnauthorized = process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== 'false';
    const tlsCaPath = process.env.IMAP_TLS_CA_PATH || '';
    const tlsServername = process.env.IMAP_TLS_SERVERNAME || '';

    let caContent: Buffer | undefined;
    if (tlsCaPath) {
      try {
        caContent = fs.readFileSync(tlsCaPath);
      } catch (err) {
        console.error(`[EmailService] No se pudo leer IMAP_TLS_CA_PATH en "${tlsCaPath}":`, err);
      }
    }

    return {
      rejectUnauthorized: tlsRejectUnauthorized,
      servername: tlsServername || undefined,
      ca: caContent || undefined,
    };
  }

  private createImapClient(): ImapFlow {
    return new ImapFlow({
      host: process.env.IMAP_HOST || process.env.IMAP_SERVER || 'imap.gmail.com',
      port: parseInt(process.env.IMAP_PORT || '993', 10),
      secure: true,
      auth: {
        user: process.env.IMAP_USER || process.env.EMAIL_USER || '',
        pass: process.env.IMAP_PASSWORD || process.env.EMAIL_PASS || '',
      },
      tls: this.buildTlsOptions(),
      logger: false,
    });
  }

  private isPlaceholderCredentials(): boolean {
    const imapUser = process.env.IMAP_USER || process.env.EMAIL_USER || '';
    const imapPass = process.env.IMAP_PASSWORD || process.env.EMAIL_PASS || '';
    return !imapUser || !imapPass ||
      imapUser.includes('tu_email') || imapPass.includes('tu_contraseña') ||
      imapUser === 'tu_email@gmail.com';
  }

  public async fetchUnreadInstitutionEmails(): Promise<ParsedMail[]> {
    const emails: ParsedMail[] = [];

    // Saltar si las credenciales IMAP no están configuradas (valores placeholder).
    if (this.isPlaceholderCredentials()) {
      return emails; // Credenciales no configuradas, sin intentar conexión.
    }

    const client = this.createImapClient();
    if (typeof client.on === 'function') {
      client.on('error', (err) => {
        console.warn('[EmailService] Error de cliente IMAP (búsqueda):', err?.message || err);
      });
    }

    try {
      await client.connect();
      console.log('[EmailService] Conectado a IMAP para buscar emails no leídos.');
      const lock = await client.getMailboxLock('INBOX');
      try {
        const messages = await client.search({ seen: false });
        
        if (messages === false || messages.length === 0) {
            console.log('[EmailService] No se encontraron emails no leídos en INBOX.');
            return emails;
        }

        console.log(`[EmailService] Se encontraron ${messages.length} email(s) no leido(s). Procesando...`);

        // Primero: recolectar todos los emails y sus UIDs sin modificar flags
        const fetchedUids: number[] = [];
        let emailIdx = 0;
        for await (const message of client.fetch(messages, { source: true })) {
          emailIdx++;
          try {
            if (message.source) {
                const parsed = await simpleParser(message.source);
                console.log(`[EmailService] (${emailIdx}/${messages.length}) Email leido - De: ${parsed.from?.text || '?'} | Asunto: "${parsed.subject || '(sin asunto)'}"`);
                emails.push(parsed);
                fetchedUids.push(message.uid);
            } else {
                console.log(`[EmailService] (${emailIdx}/${messages.length}) Mensaje sin contenido (source vacio), saltando.`);
            }
          } catch (parseErr) {
            console.error(`[EmailService] (${emailIdx}/${messages.length}) Error al parsear email UID ${message.uid}:`, parseErr);
          }
        }

        // Segundo: marcar todos como leidos en batch (despues del fetch para evitar deadlock)
        if (fetchedUids.length > 0) {
          try {
            const uidRange = fetchedUids.join(',');
            await client.messageFlagsAdd(uidRange, ['\\Seen']);
            console.log(`[EmailService] ${fetchedUids.length} email(s) marcados como leidos.`);
          } catch (flagError) {
            console.error('[EmailService] Error al marcar emails como leidos:', flagError);
          }
        }

        console.log(`[EmailService] Lectura completada: ${emails.length} email(s) parseados de ${messages.length} encontrados.`);
      } finally {
        lock.release();
      }
    } catch (error) {
      const isTlsError = error && (
        (error as any).code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        (error as any).code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
        (error as any).code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        String(error).includes('self-signed') ||
        String(error).includes('CERT_')
      );
      if (isTlsError) {
        console.error(`[EmailService] Fallo de conexión TLS a ${process.env.IMAP_HOST || process.env.IMAP_SERVER || 'imap.gmail.com'}:${process.env.IMAP_PORT || '993'}. Sugerencia: configurar IMAP_TLS_CA_PATH, poner IMAP_TLS_REJECT_UNAUTHORIZED=false o revisar proxy/antivirus. Detalle:`, error instanceof Error ? error.message : error);
      } else {
        console.error('[EmailService] Error al obtener emails:', error);
      }
    } finally {
      try {
        await client.logout();
      } catch {
        // Ignorado: fallo al cerrar IMAP no debe impactar al bot de WhatsApp.
      }
    }
    return emails;
  }

  public async listenForNewEmails(onNewEmail: () => void | Promise<void>): Promise<void> {
    if (this.isPlaceholderCredentials()) {
      return;
    }

    const runIdle = async () => {
      // Crear un cliente nuevo en cada intento de conexión para evitar errores de reuso
      const client = this.createImapClient();
      if (typeof client.on === 'function') {
        client.on('error', (err) => {
          console.warn('[EmailService IDLE] Error de cliente IMAP (escucha):', err?.message || err);
        });
      }

      try {
        await client.connect();
        console.log('[EmailService IDLE] Conectado al servidor IMAP para escucha en tiempo real.');

        const lock = await client.getMailboxLock('INBOX');
        try {
          client.on('exists', async (data) => {
            console.log(`[EmailService IDLE] Notificación de mensaje nuevo (cantidad en buzón: ${data.count}). Disparando callback...`);
            try {
              await onNewEmail();
            } catch (err) {
              console.error('[EmailService IDLE] Error ejecutando callback:', err);
            }
          });

          while (client.usable) {
            await client.idle();
          }
        } finally {
          lock.release();
        }
      } catch (error) {
        const isTlsError = error && (
          (error as any).code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
          (error as any).code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
          (error as any).code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
          String(error).includes('self-signed') ||
          String(error).includes('CERT_')
        );
        if (isTlsError) {
          console.error(`[EmailService IDLE] Fallo de conexión TLS a ${process.env.IMAP_HOST || process.env.IMAP_SERVER || 'imap.gmail.com'}:${process.env.IMAP_PORT || '993'}. Sugerencia: configurar IMAP_TLS_CA_PATH, poner IMAP_TLS_REJECT_UNAUTHORIZED=false o revisar proxy/antivirus. Detalle:`, error instanceof Error ? error.message : error);
        } else {
          console.error('[EmailService IDLE] Conexión caída o fallida:', error);
        }
      } finally {
        try {
          await client.logout();
        } catch {
          // Ignorar
        }
        
        console.log('[EmailService IDLE] Reconectando en 10 segundos...');
        setTimeout(runIdle, 10000);
      }
    };

    runIdle();
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

  async send(to: string, subject: string, body: string, html?: string): Promise<void> {
    if (!to) throw new Error('Falta el destinatario');
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com';
    try {
      await this.transporter.sendMail({
        from,
        to,
        subject,
        text: body,
        html,
      });
    } catch (err) {
      console.error('[OutboundEmailService] Error enviando email:', err);
      throw err;
    }
  }
}
