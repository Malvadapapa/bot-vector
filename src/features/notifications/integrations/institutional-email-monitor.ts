import crypto from 'crypto';
import { ParsedMail } from 'mailparser';
import { InstitutionalNoticeRepository, InboundEmailRejectionRepository, AuthorizedEmailRepository } from '../notifications.repository.js';
import { ReminderRepository, ManagedTeacherRepository, GroupRepository, AdminRepository } from '../../../infrastructure/persistence/db/repositories.js';
import { EmailService, OutboundEmailService } from './email.service.js';
import { formatLocalDateOnly, get, all } from '../../../shared/db/db-utils.js';
import { WebOtpRepository } from '../../onboarding/web-otp.repository.js';

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
    private webOtpRepository?: WebOtpRepository,
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
      let senderLabel = 'profe'; // Default fallback

      const hasRepositories = !!(this.managedTeacherRepository || this.adminRepository || this.authorizedEmailRepository);

      if (!hasRepositories) {
        isAuthorized = true;
        if (superadmins.includes(sourceAddr)) {
          senderLabel = 'super-admin';
        }
      } else {
        if (superadmins.includes(sourceAddr)) {
          isAuthorized = true;
          senderLabel = 'super-admin';
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
            senderLabel = 'admin';
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
            senderLabel = 'profe';
            const teacher = teacherRecords[0];
            displayName = teacher.name || sourceAddr;
          }
        }

        if (!isAuthorized && this.authorizedEmailRepository) {
          const customEmailExists = await this.authorizedEmailRepository.exists(sourceAddr);
          if (customEmailExists) {
            isAuthorized = true;
            senderLabel = 'colaborador';
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

      // Generar código OTP y responder al remitente con el enlace para completar la carga en el panel web
      if (this.webOtpRepository && this.outboundEmailService) {
        const otpCode = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos
        await this.webOtpRepository.createOtp(sourceAddr, otpCode, null, expiresAt);

        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        let redirectPath = '/professor/messages';
        if (senderLabel === 'super-admin') {
          redirectPath = '/super-admin/groups';
        } else if (senderLabel === 'admin') {
          redirectPath = '/admin/calendar';
        }
        
        const loginUrl = `${baseUrl}/login?email=${encodeURIComponent(sourceAddr)}&otp=${otpCode}&redirect=${encodeURIComponent(redirectPath)}`;
        const subject = 'Acceso al Panel de Control para Publicar Aviso';
        
        const plainBody = `Hola.\n\n` +
          `Para continuar con la publicación del aviso institucional en el grupo de WhatsApp, ingresá al panel de control utilizando el siguiente enlace directo (que ya incluye tu código de acceso temporal):\n\n` +
          `${loginUrl}\n\n` +
          `Si el enlace no se abre automáticamente, podés ir a ${baseUrl}/login, ingresar tu email (${sourceAddr}) y este código OTP temporal de 6 dígitos:\n\n` +
          `Código OTP: ${otpCode}\n\n` +
          `El código tiene una validez de 10 minutos.\n\n` +
          `Una vez que hayas ingresado, podrás escribir y confirmar el texto de tu aviso, así como seleccionar el grupo o camada de destino para que Vectorito lo publique de inmediato.\n\n` +
          `¡Muchas gracias!\n` +
          `Equipo de Vectorito`;

        const htmlBody = `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
  <h2 style="color: #4f46e5; margin-top: 0; margin-bottom: 20px;">🔑 Acceso al Panel de Control Web</h2>
  
  <p>Hola,</p>
  <p>Para publicar tu aviso institucional en los grupos de WhatsApp, ingresá a la web haciendo click en el siguiente enlace de acceso directo (que ya pre-completa tu email y código temporal):</p>
  
  <div style="text-align: center; margin: 25px 0;">
    <a href="${loginUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Ingresar al Panel</a>
  </div>
  
  <p>Si el botón anterior no funciona, copia y pega este enlace en tu navegador:</p>
  <p style="background-color: #f3f4f6; padding: 10px; border-radius: 4px; font-size: 0.9em; word-break: break-all;">
    <a href="${loginUrl}">${loginUrl}</a>
  </p>
  
  <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;">
  
  <p>O ingresá manualmente en <a href="${baseUrl}">${baseUrl}</a> con los siguientes datos:</p>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
    <tr>
      <td style="padding: 6px 0; font-weight: bold; width: 120px;">Email:</td>
      <td style="padding: 6px 0;"><code>${sourceAddr}</code></td>
    </tr>
    <tr>
      <td style="padding: 6px 0; font-weight: bold;">Código OTP:</td>
      <td style="padding: 6px 0;"><code style="font-size: 1.2em; font-weight: bold; color: #4f46e5;">${otpCode}</code></td>
    </tr>
  </table>
  
  <p style="font-size: 0.9em; color: #6b7280; font-style: italic;">
    * El código OTP es de uso único y vencerá en 10 minutos.
  </p>
  
  <p style="margin-top: 20px; font-size: 0.95em;">
    Una vez dentro, podrás redactar tu aviso, seleccionar el grupo de destino y publicarlo de forma segura en WhatsApp.
  </p>
  
  <p style="margin-top: 25px; border-top: 1px solid #e5e7eb; padding-top: 15px; font-size: 0.9em; color: #4b5563;">
    Saludos,<br>
    <strong>Vectorito Bot</strong>
  </p>
</div>`;

        try {
          await this.outboundEmailService.send(sourceAddr, subject, plainBody, htmlBody);
          console.log(`[EmailMonitor] OTP enviado por correo a ${sourceAddr}. Proceso completado para este email.`);
        } catch (e) {
          console.error('[EmailMonitor] Error enviando email con OTP:', e);
        }
        processed += 1;
        continue;
      }

      // Validate structure: at least 'cuerpo' or 'mensaje' is mandatory.
      const isPlaceholderBody = notice.body && (notice.body.includes('[Mensaje') || notice.body.includes('(obligatorio)'));
      const isPlaceholderGroup = notice.grupo_selector && (notice.grupo_selector.includes('[Destinatario') || notice.grupo_selector.includes('(obligatorio)'));
      const isMissingBody = !notice.body || notice.body.trim() === '';

      if (isMissingBody || isPlaceholderBody || isPlaceholderGroup) {
        console.log(`[EmailMonitor] [RECHAZADO] Email no estructurado o incompleto de: ${sourceAddr}`);
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
          let reasonText = '';
          if (isMissingBody) {
            reasonText = 'No se detectó la estructura requerida del aviso (falta el campo obligatorio "cuerpo:").';
          } else if (isPlaceholderBody) {
            reasonText = 'No has completado el campo obligatorio "cuerpo" (dejaste el texto de ejemplo de la plantilla).';
          } else if (isPlaceholderGroup) {
            reasonText = 'No has completado el campo obligatorio "grupo" (dejaste el texto de ejemplo de la plantilla).';
          }

          let catalogPlain = '';
          let catalogHtml = '';
          
          if (this.groupRepository) {
            const catalog = await this.getGroupOptionsList();
            const cohortEntries = catalog.filter((o) => o.id.startsWith('camada:'));
            const groupEntries = catalog.filter((o) => !o.id.startsWith('camada:'));
            
            // Plain text catalog
            if (cohortEntries.length) {
              catalogPlain += `- Cohortes/Camadas:\n`;
              for (const e of cohortEntries) catalogPlain += `      (${e.shortcut}) ${e.label}\n`;
            }
            if (groupEntries.length) {
              catalogPlain += `- Grupos específicos:\n`;
              for (const e of groupEntries) catalogPlain += `      (${e.shortcut}) ${e.label}\n`;
            }
            
            // HTML catalog
            let cohortsLi = '';
            for (const e of cohortEntries) {
              cohortsLi += `                <li style="margin-bottom: 4px;"><code>(${e.shortcut})</code> ${e.label}</li>\n`;
            }
            let groupsLi = '';
            for (const e of groupEntries) {
              groupsLi += `                <li style="margin-bottom: 4px;"><code>(${e.shortcut})</code> ${e.label}</li>\n`;
            }
            
            catalogHtml = `
        <li style="margin-bottom: 8px;"><strong>Cohortes/Camadas</strong> (escribí la letra):
            <ul style="padding-left: 20px; margin-top: 5px;">
                ${cohortsLi || '<li style="color: #6c757d; font-style: italic;">No hay camadas activas</li>'}
            </ul>
        </li>
        <li style="margin-bottom: 8px;"><strong>Grupos específicos</strong> (escribí el número):
            <ul style="padding-left: 20px; margin-top: 5px;">
                ${groupsLi || '<li style="color: #6c757d; font-style: italic;">No hay grupos activos</li>'}
            </ul>
        </li>`;
          }

          const subject = 'Formato de aviso institucional inválido o incompleto';
          
          const plainBody = `No se pudo procesar tu aviso institucional\n\n` +
            `Hola.\n\n` +
            `Te informamos que tu mensaje no ha podido ser procesado debido al siguiente motivo:\n` +
            `❌ ${reasonText}\n\n` +
            `Para publicar tu aviso correctamente, por favor envía un nuevo correo completando los campos requeridos después de los dos puntos (:) siguiendo este formato:\n\n` +
            `---------------------------------------------------\n` +
            `Asunto: aviso (o el título de tu aviso)\n\n` +
            `Cuerpo del mensaje:\n` +
            `nombre: [Nombre del Profesor / Emisor] (opcional)\n` +
            `inicia: [Fecha de inicio, ej. DD/MM/AAAA] (opcional)\n` +
            `termina: [Fecha límite/fin, ej. DD/MM/AAAA] (opcional)\n` +
            `hora: [Hora del evento, ej. 18:30] (opcional)\n` +
            `frecuencia: [Intervalo en días, ej: "unica" o "5d"] (opcional)\n` +
            `grupo: [Letra, número, "todos" o "general"] (OBLIGATORIO)\n` +
            `cuerpo: [Mensaje/Cuerpo del aviso] (OBLIGATORIO)\n` +
            `---------------------------------------------------\n\n` +
            `💡 Sugerencia: Copia el bloque de arriba, pégalo en un nuevo correo y reemplaza el texto entre corchetes. También puedes pedirle a cualquier IA (ChatGPT, Gemini, Claude) que lo complete por ti con esta estructura.\n\n` +
            `👥 Opciones válidas para el campo "grupo":\n` +
            `- "todos" — Notifica a TODOS los grupos\n` +
            `- "general" — Notifica solo a grupos generales\n` +
            `${catalogPlain}\n` +
            `Solo debes ingresar la letra o el número (con o sin comillas) del grupo al que quieres dirigir el mensaje.\n\n` +
            `Si tenés alguna duda, por favor contactá al administrador.`;

          const htmlBody = `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
    
    <h2 style="color: #d9534f; margin-top: 0; margin-bottom: 20px;">⚠️ No se pudo procesar tu aviso institucional</h2>
    
    <p style="margin-bottom: 15px;">Hola,</p>
    <p style="margin-bottom: 15px;">Te informamos que tu mensaje no ha podido ser procesado debido al siguiente motivo:</p>
    
    <div style="background-color: #fdf2f2; border-left: 4px solid #f05252; color: #9b1c1c; padding: 12px 16px; border-radius: 4px; margin-bottom: 20px; font-weight: bold;">
        ❌ ${reasonText}
    </div>
    
    <p style="margin-bottom: 20px;">Para publicar tu aviso correctamente, por favor envía un nuevo correo completando los campos requeridos después de los dos puntos (<strong>:</strong>) siguiendo este formato:</p>
    
    <!-- Bloque de Plantilla -->
    <div style="background-color: #f8f9fa; border-left: 4px solid #0275d8; padding: 20px; margin: 25px 0; font-family: 'Courier New', Courier, monospace; font-size: 15px;">
        <p style="margin: 0 0 25px 0;"><strong>Asunto:</strong> aviso (o el título de tu aviso)</p>
        
        <p style="margin: 0 0 18px 0;"><strong>Cuerpo del mensaje:</strong></p>
        
        <p style="margin: 0 0 18px 0;"><strong>nombre:</strong> [Tu nombre] <span style="color: #6c757d; font-style: italic; font-size: 13px;">(opcional)</span></p>
        
        <p style="margin: 0 0 18px 0;"><strong>inicia:</strong> [DD/MM/AAAA] <span style="color: #6c757d; font-style: italic; font-size: 13px;">(opcional)</span></p>
        
        <p style="margin: 0 0 18px 0;"><strong>termina:</strong> [DD/MM/AAAA] <span style="color: #6c757d; font-style: italic; font-size: 13px;">(opcional)</span></p>
        
        <p style="margin: 0 0 18px 0;"><strong>hora:</strong> [HH:MM] <span style="color: #6c757d; font-style: italic; font-size: 13px;">(opcional)</span></p>
        
        <p style="margin: 0 0 18px 0;"><strong>frecuencia:</strong> [unica / 5d] <span style="color: #6c757d; font-style: italic; font-size: 13px;">(opcional)</span></p>
        
        <p style="margin: 0 0 18px 0; color: #d9534f;"><strong>grupo:</strong> [letra, número, "todos" o "general"] <strong>(OBLIGATORIO)</strong></p>
        
        <p style="margin: 0; color: #d9534f;"><strong>cuerpo:</strong> [Tu mensaje aquí] <strong>(OBLIGATORIO)</strong></p>
    </div>
    
    <hr style="border: 0; border-top: 1px solid #e0e0e0; margin: 25px 0;">
    
    <!-- Opciones de Grupo -->
    <h3 style="color: #0275d8; margin-top: 0; margin-bottom: 15px;">👥 Opciones válidas para el campo "grupo":</h3>
    <ul style="padding-left: 20px; line-height: 1.8;">
        <li style="margin-bottom: 8px;"><code>"todos"</code> — Notifica a TODOS los grupos de la tecnicatura</li>
        <li style="margin-bottom: 8px;"><code>"general"</code> — Notifica solo a los grupos generales</li>
        ${catalogHtml}
    </ul>
    
    <div style="background-color: #e8f5e9; border-left: 4px solid #4caf50; padding: 12px 16px; border-radius: 4px; margin: 20px 0;">
        <strong>📝 Solo debes ingresar la letra o el número</strong> (con o sin comillas) del grupo al que querés dirigir el mensaje.
    </div>
    
    <hr style="border: 0; border-top: 1px solid #e0e0e0; margin: 25px 0;">
    
    <p style="font-size: 0.9em; color: #6c757d; font-style: italic; background-color: #fdf7e3; padding: 12px; border-radius: 4px; margin-bottom: 20px;">
        💡 <strong>Sugerencia:</strong> Copia el bloque gris de arriba, pégalo en un nuevo correo y reemplaza el texto entre corchetes. También puedes pedirle a cualquier IA (ChatGPT, Gemini, Claude) que lo complete por ti con esta estructura.
    </p>
    
    <p style="margin-bottom: 0;">Si tenés alguna duda, por favor contactá al administrador.</p>
</div>`;



          try {
            await this.outboundEmailService.send(sourceAddr, subject, plainBody, htmlBody);
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
      let selector = (notice.grupo_selector || 'todos').trim().toLowerCase().replace(/^["']+|["']+$/g, '');
      if (this.groupRepository) {
        // Resolve shortcut (letter for cohort, number for group)
        const opts = await this.getGroupOptionsList();
        const shortcutMatch = opts.find((o) => o.shortcut.toLowerCase() === selector);
        if (shortcutMatch) {
          selector = shortcutMatch.id.toLowerCase();
        } else if (/^\d{4}$/.test(selector)) {
          // Plain year → treat as camada
          selector = `camada:${selector}`;
        }

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
            // Match by exact group_id, exact display_name, or partial (includes) display_name
            const matchedGroup = groups.find(
              (g) =>
                g.group_id.toLowerCase() === selector ||
                (g.display_name && g.display_name.toLowerCase() === selector)
            ) || groups.find(
              (g) =>
                (g.display_name && g.display_name.toLowerCase().includes(selector)) ||
                selector.includes(g.display_name?.toLowerCase() ?? '\x00')
            );
            if (matchedGroup) {
              resolvedGroupIds = [matchedGroup.group_id];
              if (hasGroupRestriction && !allowedGroupIdsForTeacher.includes(matchedGroup.group_id)) {
                resolvedGroupIds = [];
              }
            } else {
              // unknown selector — send error with the catalog
              if (this.outboundEmailService) {
                const catalogLines = opts.map((o) => `  (${o.shortcut}) ${o.label}`).join('\n');
                const subject = 'Error al procesar tu aviso institucional';
                const body = `Hola.\n\nNo pudimos procesar tu aviso institucional.\n\nError: Selector de grupos inválido (${notice.grupo_selector}).\n\nOpciones válidas para el campo \"grupo\":\n  \"todos\" — Todos los grupos de la tecnicatura\n  \"general\" — Grupos generales\n${catalogLines}\n\nEscribí solo la letra o el número correspondiente. También podés escribir \"todos\" o \"general\".`;
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
        body: notice.body ?? '',
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

      // Build the WhatsApp notice message using the requested template
      const formattedMessage = `Hola! Vectorito reporrandose\u{1F63C}\n\n` +
        `${headerText}\n\n` +
        `*De:* ${displayName} (${roleText})\n` +
        `*Para:* ${grupoName}\n` +
        `*ID de mensaje:* ID: ${insertedId}\n\n` +
        `*Título:* ${notice.title}\n\n` +
        `*Mensaje:* \n` +
        `${notice.body}\n\n` +
        `💡 *Para responder al profesor, escribí en este grupo:*\n` +
        `!rid${insertedId} tu mensaje para responder al profesor`;

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
    const validKeys = new Set(['nombre', 'inicia', 'termina', 'hora', 'cuerpo', 'mensaje', 'frecuencia', 'grupo']);
    const fieldPattern = /^[\s*_~]*([a-zA-ZáéíóúÁÉÍÓÚñÑ]+)[\s*_~]*\s*:\s*(.+)$/i;

    let currentKey: string | null = null;

    for (const line of body.split('\n')) {
      const trimmedLine = line.trim();
      
      // Stop parsing if we hit email signature or quoted thread dividers
      if (
        /^-{3,}\s*$/.test(trimmedLine) ||
        /^[Ee]l\s+.+ escribió:/i.test(trimmedLine) ||
        /^[Oo]n\s+.+ wrote:/i.test(trimmedLine) ||
        /^[-_=+]*\s*(Original Message|Mensaje Original)\s*[-_=+]*/i.test(trimmedLine) ||
        trimmedLine.startsWith('>')
      ) {
        break;
      }

      const match = trimmedLine.match(fieldPattern);
      if (match) {
        const key = match[1].toLowerCase();
        if (validKeys.has(key)) {
          currentKey = key;
          out[currentKey] = match[2].trim();
        } else {
          currentKey = null;
        }
      } else {
        if (currentKey === 'cuerpo' || currentKey === 'mensaje') {
          out[currentKey] = out[currentKey] ? `${out[currentKey]}\n${line}` : line;
        }
      }
    }

    for (const k of Object.keys(out)) {
      out[k] = out[k].trim();
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

  /**
   * Build a labeled catalog of all available group targets.
   * Special keywords: "todos", "general"
   * Cohorts get uppercase letters: A, B, C...
   * Individual groups get numbers: 1, 2, 3...
   */
  private async getGroupOptionsList(): Promise<{ id: string; shortcut: string; label: string }[]> {
    if (!this.groupRepository) return [];
    const groups = await this.groupRepository.getAllActiveGroupsWithEntryYear();
    const cohorts = Array.from(new Set(groups.map((g) => g.entry_year).filter((y): y is number => y !== null))).sort();
    
    const options: { id: string; shortcut: string; label: string }[] = [];
    
    // Cohorts → letters A, B, C...
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < cohorts.length && i < letters.length; i++) {
      options.push({
        id: `camada:${cohorts[i]}`,
        shortcut: letters[i],
        label: `Cohorte/Camada ${cohorts[i]}`,
      });
    }
    
    // Individual groups → numbers 1, 2, 3...
    for (let i = 0; i < groups.length; i++) {
      options.push({
        id: groups[i].group_id,
        shortcut: String(i + 1),
        label: groups[i].display_name || groups[i].group_id,
      });
    }
    
    return options;
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
