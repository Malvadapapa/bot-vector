import makeWASocket, {
  Browsers,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import * as pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { MessageRouter } from '../../features/messages/message-router.service.js';
import { PrivateChatWorkflowService } from '../../application/admin/private-chat-workflow.service.js';
import { RateLimitService } from '../../features/ai/rate-limit.service.js';
import { UserModerationService } from '../../features/moderation/user-moderation.service.js';
import { AdminRepository, GroupRepository, UserProfileRepository, GroupMembershipRepository } from '../../infrastructure/persistence/db/repositories.js';
import { logTuiChatMessage, logTuiProcessTrace } from '../../shared/config/tui-shared.js';

const nodeRequire = createRequire(import.meta.url);
const qrcodeTerminal = nodeRequire('qrcode-terminal');

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
};

const NEW_USER_REGISTRATION_MESSAGES = [
  '¡Hola! Soy Vectorito, el bot del ISPC. Antes de que podamos charlar, necesito que te registres por privado 🙂\nMandame un "!registrarse" al privado y lo hacemos en un toque.',
  '¡Buenas! Para poder responderte necesito conocerte un poco. ¿Me mandás un "!registrarse" por privado para registrarte? Es súper rápido 🙂',
  '¡Ey! Bienvenido. Porfa, escribime "!registrarse" por privado así te registro y te puedo ayudar con lo que necesites del ISPC.',
];

const PROFILE_UPDATE_GROUP_MESSAGES = [
  'Che, por una actualización del bot del ISPC necesito que completes tus datos por privado. Gracias 🙂\nEscribime por privado con un "!registrarse" y lo hacemos rápido.',
  '¡Ey! Hubo actualización del bot del ISPC y me faltan tus datos. Mandame "!registrarse" por privado así los completamos 🙂',
  'Amigo, para seguir con IA primero completame unos datos por privado por una actualización del bot del ISPC 🙂\nEscribime "!registrarse" en privado.',
];

const NO_PENDING_APPROVAL_MESSAGES = [
  'No tengo ninguna solicitud pendiente para aprobar ahora.',
  'Por ahora no hay pedidos de aprobación en cola.',
  'Todavía no veo solicitudes pendientes para habilitar.',
];

export class VectoritoWhatsAppGateway {
  private whatsappSocket: any;
  private isConnecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private sawQrInCurrentSession = false;
  private sessionResetAttempted = false;
  private consecutive401WithoutQr = 0;
  private connectionReplacedResetAttempted = false;
  private consecutiveConnectionReplaced = 0;
  private processedIds = new Set<string>();
  private unauthorizedGroupNoticeSent = new Set<string>();
  private cachedBotLid: string | null = null;
  private cachedBotLidAtMs = 0;
  private static noisySessionLogPatterns = [
    /^Closing open session in favor of incoming prekey bundle/i,
    /^Closing session:/i,
    /^Removing old closed session:/i,
    /^SessionEntry/i,
  ];

  constructor(
    private router: MessageRouter,
    private privateChatWorkflow: PrivateChatWorkflowService,
    private userProfileRepository: UserProfileRepository,
    private adminRepository: AdminRepository,
    private rateLimitService: RateLimitService,
    private moderationService: UserModerationService,
    private groupRepository: GroupRepository,
    private groupMembershipRepository: GroupMembershipRepository,
  ) {
    this.installConsoleNoiseFilter();
  }

  private isProfilePopulated(profile?: any | null): boolean {
    if (!profile) return false;
    const name = String(profile.name || '').trim();
    const birthday = String(profile.birthday_day_month || '').trim();
    const email = String(profile.email || '').trim();
    return !!name && !!birthday && !!email;
  }

  private scheduleReconnect(delayMs: number) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startConnection();
    }, delayMs);
  }

  public async startConnection() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      const { state, saveCreds } = await useMultiFileAuthState('./session');
      const { version } = await fetchLatestBaileysVersion();

      this.whatsappSocket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino.default({ level: 'fatal' })),
        },
        printQRInTerminal: false,
        logger: pino.default({ level: 'silent' }),
        browser: Browsers.ubuntu('VectoritoBot'),
        markOnlineOnConnect: true,
        syncFullHistory: true,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000,
      });

      this.whatsappSocket.ev.on('creds.update', saveCreds);
      this.whatsappSocket.ev.on('group-participants.update', async (update: any) => {
        await this.handleGroupParticipantsUpdate(update);
      });



      this.whatsappSocket.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.sawQrInCurrentSession = true;
          this.consecutive401WithoutQr = 0;
          console.log('\n[WhatsApp] QR recibido. Escanealo desde tu teléfono:');
          qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const reasonText = (lastDisconnect?.error as any)?.message || 'sin detalle';
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          const isRestartRequired = statusCode === DisconnectReason.restartRequired;
          const isConnectionReplaced = statusCode === DisconnectReason.connectionReplaced;

          console.log(`\n[WhatsApp] Conexión cerrada. Código=${statusCode ?? 'N/A'} Motivo=${reasonText}`);

          if (statusCode === 401 && !this.sawQrInCurrentSession) {
            this.consecutive401WithoutQr += 1;

            if (!this.sessionResetAttempted) {
              this.sessionResetAttempted = true;
              console.log('\n[WhatsApp] 401 sin QR: limpiando session para reintentar.');
              try {
                if (fs.existsSync('./session')) {
                  fs.rmSync('./session', { recursive: true, force: true });
                }
              } catch (cleanupErr) {
                const cleanupMsg = (cleanupErr as any)?.message || 'error desconocido';
                console.log(`[WhatsApp] No se pudo limpiar session automáticamente: ${cleanupMsg}`);
              }

              this.isConnecting = false;
              console.log('[WhatsApp] Reintentando con sesión limpia en 2 segundos...');
              this.scheduleReconnect(2000);
              return;
            }

            if (this.consecutive401WithoutQr >= 6) {
              console.error('\n[WhatsApp] 401 persistente sin QR. Revisar session y volver a vincular.');
              process.exit(1);
            }
          }

          if (isConnectionReplaced) {
            console.log('\n[WhatsApp] 🛑 Conexión reemplazada: Otra instancia del bot ha iniciado sesión en otra PC.');
            console.log('[WhatsApp] Cerrando esta instancia para evitar conflictos de escritura y asegurar la consistencia de los datos.');
            process.exit(0);
          } else {
            this.consecutiveConnectionReplaced = 0;
          }

          if (isLoggedOut && this.whatsappSocket.authState.creds.registered) {
            console.log('\n[WhatsApp] Sesión cerrada por WhatsApp. Borrá session y escaneá un QR nuevo.');
            process.exit(1);
          }

          if (isRestartRequired) {
            this.isConnecting = false;
            console.log('\n[WhatsApp] WhatsApp pidió reinicio del socket (515). Reconectando...');
            this.scheduleReconnect(1000);
            return;
          }

          this.isConnecting = false;
          console.log('\n[WhatsApp] Conexión cerrada. Reintentando en 5 segundos...');
          this.scheduleReconnect(5000);
        } else if (connection === 'open') {
          this.isConnecting = false;
          this.consecutiveConnectionReplaced = 0;
          console.log('\n[WhatsApp] Conectado correctamente a WhatsApp.');
          this.syncGroupDisplayNames().catch((err: any) => {
            console.warn('[Gateway] Error al sincronizar nombres de grupo en el inicio:', err);
          });
        }
      });

      this.whatsappSocket.ev.on('messages.upsert', async (event: any) => {
        try {
          if (event.type === 'append') {
            return;
          }

          const incomingMessages = Array.isArray(event?.messages) ? event.messages : [];
          for (const incomingMessage of incomingMessages) {
            if (!incomingMessage?.message || incomingMessage?.key?.fromMe) continue;

            // Ignorar mensajes enviados mientras el bot estaba desconectado (más de 2 minutos de antigüedad)
            const timestamp = Number(incomingMessage?.messageTimestamp || 0);
            if (timestamp > 0) {
              const ageSeconds = Math.floor(Date.now() / 1000) - timestamp;
              if (ageSeconds > 120) {
                console.log(`[Gateway] Ignorando mensaje antiguo de ${incomingMessage.key.remoteJid} (antigüedad: ${ageSeconds}s)`);
                continue;
              }
            }

            await this.markMessageAsRead(incomingMessage);

            const eventId = String(incomingMessage?.key?.id || '');
            if (!eventId || this.isDuplicate(eventId)) continue;

            const rawChatId = String(incomingMessage?.key?.remoteJid || '');
            if (!rawChatId) continue;
            const chatId = rawChatId.split(' ')[0];

            const isGroup = chatId.includes('@g.us');
            const rawSenderJid = String(incomingMessage?.key?.participant || chatId);
            const senderJid = rawSenderJid.split(' ')[0];

            const incomingText = this.extractMessageText(incomingMessage).trim();
            const impersonation = PrivateChatWorkflowService.getImpersonation(senderJid);
            const isSuperAdmin = impersonation.isActive ? false : (typeof (this.adminRepository as any).isSuperAdmin === 'function'
              ? await (this.adminRepository as any).isSuperAdmin(senderJid)
              : !!(await this.adminRepository.get(senderJid))?.is_super_admin);
            const isGlobalAdmin = impersonation.isActive ? false : (typeof (this.adminRepository as any).isGlobalAdmin === 'function'
              ? await (this.adminRepository as any).isGlobalAdmin(senderJid)
              : (await this.adminRepository.isAuthenticated(senderJid)) && !isSuperAdmin);
            const isAdmin = impersonation.isActive ? false : (isGlobalAdmin || isSuperAdmin);
            const isGroupAdmin = impersonation.isActive ? false : (isGroup ? await this.adminRepository.isGroupAdmin(senderJid, chatId) : false);
            const isActiveGroup = !isGroup ? true : await this.groupRepository.isActive(chatId);

            if (incomingText) {
              this.logIncoming(chatId, senderJid, incomingText, isGroup, isAdmin, incomingMessage);
            }

            // Dynamic display_name update for active groups if currently generic
            if (isGroup && isActiveGroup) {
              await this.groupMembershipRepository.addMembership(chatId, senderJid);
              const existing = await this.groupRepository.findByGroupId(chatId);
              if (existing) {
                if (!existing.display_name || existing.display_name.startsWith('Grupo ')) {
                  try {
                    if (this.whatsappSocket && typeof this.whatsappSocket.groupMetadata === 'function') {
                      const meta = await this.whatsappSocket.groupMetadata(chatId);
                      if (meta && meta.subject && meta.subject !== existing.display_name) {
                        await this.groupRepository.updateDisplayName(chatId, meta.subject);
                        existing.display_name = meta.subject;
                      }
                    }
                  } catch (e) {
                    // Silently ignore if metadata cannot be fetched at the moment
                  }
                }
              }
            }

            // Auto-registro en primera activación: si el grupo no existe, registrarlo y notificar super-admins
            if (isGroup && !isActiveGroup) {
              const existing = await this.groupRepository.findByGroupId(chatId);
              if (!existing) {
                let groupName = `Grupo ${chatId}`;
                try {
                  if (this.whatsappSocket && typeof this.whatsappSocket.groupMetadata === 'function') {
                    const meta = await this.whatsappSocket.groupMetadata(chatId);
                    if (meta && meta.subject) {
                      groupName = meta.subject;
                    }
                  }
                } catch (e) {
                  console.warn('[Gateway] No se pudo obtener metadata del grupo:', (e as any)?.message || e);
                }

                try {
                  await this.groupRepository.register(chatId, groupName, senderJid);
                } catch (e) {
                  console.warn('[Gateway] No se pudo registrar el grupo automáticamente:', (e as any)?.message || e);
                }

                // Notificar super-admins para que completen la configuración por privado
                let superAdmins: string[] = [];
                try {
                  if (typeof (this.adminRepository as any).listSuperAdminIds === 'function') {
                    superAdmins = await (this.adminRepository as any).listSuperAdminIds();
                  } else {
                    superAdmins = await this.adminRepository.listAllAdminIds();
                  }
                } catch (e) {
                  console.warn('[Gateway] Error obteniendo super-admins:', (e as any)?.message || e);
                }

                for (const sa of superAdmins) {
                  try {
                    const cfgMsg = await this.privateChatWorkflow.startGroupContextConfiguration(sa, chatId);
                    await this.sendTextMessage(sa, `Nuevo grupo detectado: ${chatId}\nSe creó un registro mínimo.\n\n${cfgMsg}`, undefined, true);
                  } catch (e) {
                    console.warn('[Gateway] No se pudo notificar super-admin', sa, (e as any)?.message || e);
                  }
                }

                // Informar al grupo que fue registrado y que los super-admins fueron notificados
                try {
                  const welcomeMsg = [
                    '👋 ¡Hola a todos! Soy Vectorito, el asistente académico diseñado para ayudarlos en el cursado de su tecnicatura 😌.',
                    '',
                    'Puedo avisarles cuándo tienen clases, mostrarles los enlaces de Meet,',
                    'recordarles exámenes y mantenerlos al día de los avisos institucionales.',
                    '',
                    '📌Para empezar, cada alumno tiene que registrarse una sola vez.',
                    '   Escribime por privado un: *hola*',
                    '',
                    '⚙️ Si sos Admin del grupo y tenés los permisos,',
                    ' Envía mensaje con *!config-grupo* para configurar las materias y horarios.'
                  ].join('\n');
                  await this.sendTextMessage(chatId, welcomeMsg, undefined, false);
                } catch {}

                continue;
              }

              // Si existe pero está inactivo, permitir registro si quien envía es admin
              if (!isAdmin) {
                await this.handleUnauthorizedGroup(chatId);
                continue;
              }

              // Si es admin y el grupo está inactivo, re-registrar/activar
              let groupName = `Grupo ${chatId}`;
              try {
                if (this.whatsappSocket && typeof this.whatsappSocket.groupMetadata === 'function') {
                  const meta = await this.whatsappSocket.groupMetadata(chatId);
                  if (meta && meta.subject) {
                    groupName = meta.subject;
                  }
                }
              } catch (e) {
                console.warn('[Gateway] No se pudo obtener metadata del grupo:', (e as any)?.message || e);
              }
              await this.groupRepository.register(chatId, groupName, senderJid);
              if (groupName !== `Grupo ${chatId}`) {
                await this.groupRepository.updateDisplayName(chatId, groupName);
              }
            }
          if (!incomingText) continue;

          if (!isGroup) {
            const privateReply = await this.privateChatWorkflow.handlePrivateMessage(senderJid, incomingText);
            if (!privateReply) continue;
            const parts = privateReply.split('|||SPLIT|||');
            for (const part of parts) {
              if (part.trim()) {
                let textToSend = part;
                const match = textToSend.match(/\[BOT_LEAVE_GROUP::([^\]]+)\]/);
                let groupIdToLeave: string | null = null;
                if (match) {
                  groupIdToLeave = match[1];
                  textToSend = textToSend.replace(/\[BOT_LEAVE_GROUP::[^\]]+\]/, '').trim();
                }

                if (textToSend) {
                  await this.sendTextMessage(chatId, textToSend, senderJid, true);
                }

                if (groupIdToLeave) {
                  console.log(`[Gateway] Saliendo del grupo por comando de eliminación: ${groupIdToLeave}`);
                  if (this.whatsappSocket?.groupLeave) {
                    this.whatsappSocket.groupLeave(groupIdToLeave).catch((err: any) => {
                      console.error(`Error al intentar salir del grupo ${groupIdToLeave}:`, err);
                    });
                  }
                }
              }
            }
            continue;
          }

          const mentionedJids = this.extractMentionedJids(incomingMessage);

          // Detectar mención real por JID y, como respaldo, por alias dinámicos del bot.
          const messageMentionsBot = this.isBotMentioned(mentionedJids, incomingText);


          // Limpiar el texto de basura de sesión y menciones para la IA
          const normalizedGroupText = incomingText
            .replace(/@session\\[^\s]+/g, '') // Quitar rutas de sesión primero
            .replace(/@\d[\d\-\s]{5,}/g, '') // Quitar menciones numéricas
            .trim() || incomingText;

          const senderProfile = await this.userProfileRepository.get(senderJid);
          const isRegisteredUser = this.isProfilePopulated(senderProfile);
          const isNewUser = !this.isProfilePopulated(senderProfile);

          const cleanForApproval = this.stripBotMentions(normalizedGroupText.trim()).trim();

          if (isAdmin && /^\!(si|sí|aprobado)$/i.test(cleanForApproval)) {
            const approval = await this.rateLimitService.approveNextPendingRequest(new Date());
            if (!approval) {
              await this.sendTextMessage(chatId, this.pickOne(NO_PENDING_APPROVAL_MESSAGES), senderJid, false);
              return;
            }

            const approvedProfile = await this.userProfileRepository.get(approval.userId);
            const approvedLabel = approvedProfile?.name || approval.userId;
            await this.sendTextMessage(
              chatId,
              `Aprobado ✅ ${approvedLabel} recibió ${approval.extraQuestionsGranted} preguntas extra para seguir con la IA.`,
              senderJid,
              false,
            );
            return;
          }

          const isCommand = normalizedGroupText.trim().startsWith('!');
          const isNumericReply = /^\d+$/.test(normalizedGroupText.trim());
          const hasPendingMenu = this.router.hasActiveMenuState(senderJid);

          if (isGroup && isCommand && normalizedGroupText.toLowerCase().startsWith('!soyadmin ')) {
            const result = await this.privateChatWorkflow.handleGroupAdminLink(senderJid, normalizedGroupText);
            if (result) {
              await this.sendTextMessage(chatId, result, senderJid, false);
              try {
                // Intentar borrar el mensaje del grupo para ocultar el código
                if (this.whatsappSocket?.sendMessage) {
                  await this.whatsappSocket.sendMessage(chatId, { delete: incomingMessage.key });
                }
              } catch (e) {
                console.warn('No se pudo borrar el mensaje del código en el grupo.');
              }
            }
            return;
          }

          // Si es un número y NO hay menú activo, ignorar completamente
          if (isNumericReply && !hasPendingMenu && !messageMentionsBot) {
            continue;
          }

          if (messageMentionsBot && !isRegisteredUser && !isCommand) {
            // Solo interrumpir si es una pregunta de IA, no si es un comando público
            const messages = isNewUser ? NEW_USER_REGISTRATION_MESSAGES : PROFILE_UPDATE_GROUP_MESSAGES;
            await this.sendTextMessage(
              chatId,
              this.pickOne(messages),
              senderJid,
              false,
            );
            continue;
          }

          // Procesar solo comandos, menciones al bot o números dentro de un menú activo.
          const shouldProcess = isCommand || messageMentionsBot || (hasPendingMenu && isNumericReply);
          if (!shouldProcess) {
            console.warn(`⚠️ [Gateway] Mensaje de grupo descartado antes del router: chat=${chatId} sender=${senderJid} command=${isCommand} mentioned=${messageMentionsBot} menu=${hasPendingMenu} text="${incomingText}"`);
            continue;
          }

          if (!isAdmin) {
            const commissionWarning = await this.privateChatWorkflow.getGroupCommissionMissingWarning(senderJid, chatId);
            if (commissionWarning !== null) {
              if (commissionWarning) {
                await this.sendTextMessage(chatId, commissionWarning, senderJid, false);
              }
              continue;
            }
          }

          const invokedByMention = messageMentionsBot;

          if (!isAdmin && !isCommand && !(hasPendingMenu && isNumericReply)) {
            const moderation = await this.moderationService.evaluate(senderJid, normalizedGroupText, isAdmin || isSuperAdmin, new Date());
            if (moderation.warningMessage) {
              logTuiProcessTrace(`Advertencia de moderación para ${senderJid}: ${moderation.warningMessage}`);
              await this.sendTextMessage(chatId, moderation.warningMessage, senderJid, false);
              continue;
            }
            if (moderation.blocked) {
              logTuiProcessTrace(`Acceso denegado: El usuario ${senderJid} se encuentra bloqueado por moderación.`);
              if (invokedByMention) {
                await this.sendTextMessage(chatId, '⚠️ Ahora no puedo responderte. Si creés que es un error, hablá con un admin.', senderJid, false);
              }
              continue;
            }
          }

          const groupReply = await this.router.route(
            senderJid,
            normalizedGroupText,
            new Date(),
            invokedByMention || isCommand,
            isGlobalAdmin,
            isGroupAdmin,
            invokedByMention,
            chatId,
            isSuperAdmin,
          );
          if (groupReply == null) continue;

          // Manejar comando de configuración de grupo
          if (typeof groupReply === 'string' && groupReply.startsWith('config-grupo:')) {
            const groupId = groupReply.substring('config-grupo:'.length);
            const configReply = await this.privateChatWorkflow.startGroupContextConfiguration(senderJid, groupId);
            await this.sendTextMessage(senderJid, configReply, undefined, true);
            continue;
          }

          const safeReply = String(groupReply).trim() || 'No pude generar una respuesta en este momento.';

          // ABSENT DATA HANDLING
          const absentDataMatch = safeReply.match(/^\s*\[ABSENT_DATA::([^\]]+)\]/i);
          if (absentDataMatch) {
            const tipoDato = absentDataMatch[1].trim().toLowerCase();
            
            // 1. Obtener información de usuario y grupo
            const profile = await this.userProfileRepository.get(senderJid);
            const userName = profile?.name ? `${profile.name} (${senderJid.split('@')[0]})` : senderJid.split('@')[0];
            const group = await this.groupRepository.findByGroupId(chatId);
            const groupName = group?.display_name || chatId;

            // 2. Notificar a los administradores del grupo (o superadmins de fallback)
            let admins = await this.adminRepository.listGroupAdmins(chatId);
            let adminIds = admins.map((a) => a.user_id);
            if (adminIds.length === 0) {
              adminIds = await this.adminRepository.listSuperAdminIds();
            }

            const adminNotifyText = [
              `⚠️ *Notificación de Información Ausente*`,
              `• *Grupo:* ${groupName}`,
              `• *Usuario:* ${userName}`,
              `• *Consulta:* "${normalizedGroupText}"`,
              `• *Información solicitada:* ${tipoDato.toUpperCase()}`,
              ``,
              `Por favor, cargá esta información en el sistema ingresando a la configuración usando el comando *!config-grupo* desde el grupo correspondiente.`,
            ].join('\n');

            for (const adminId of adminIds) {
              try {
                await this.sendTextMessage(adminId, adminNotifyText, undefined, true);
              } catch (e) {
                console.error(`Error al notificar al admin ${adminId}:`, e);
              }
            }

            // 3. Responder en el grupo
            const groupReplyText = `⚠️ Hola. No tengo la información de *${tipoDato}* cargada para este grupo en este momento.\n\nPor favor, pedile a un administrador del grupo que cargue los horarios, exámenes o profesores correspondientes usando el comando *!config-grupo*.`;
            await this.sendTextMessage(chatId, groupReplyText, senderJid, false);
            continue;
          }

          // CONFIG WARNING HANDLING FOR FAST COMMANDS
          if (safeReply.includes('Este grupo todavía no tiene configuración académica completa')) {
            // 1. Obtener información de usuario y grupo
            const profile = await this.userProfileRepository.get(senderJid);
            const userName = profile?.name ? `${profile.name} (${senderJid.split('@')[0]})` : senderJid.split('@')[0];
            const group = await this.groupRepository.findByGroupId(chatId);
            const groupName = group?.display_name || chatId;

            // 2. Notificar a los administradores del grupo (o superadmins de fallback)
            let admins = await this.adminRepository.listGroupAdmins(chatId);
            let adminIds = admins.map((a) => a.user_id);
            if (adminIds.length === 0) {
              adminIds = await this.adminRepository.listSuperAdminIds();
            }

            const adminNotifyText = [
              `⚠️ *Notificación de Configuración Faltante*`,
              `• *Grupo:* ${groupName}`,
              `• *Usuario:* ${userName}`,
              `• *Comando ejecutado:* "${normalizedGroupText}"`,
              ``,
              `El usuario intentó usar un comando de calendario/agenda pero el grupo no está configurado. Por favor, inicializá el grupo con *!config-grupo*.`,
            ].join('\n');

            for (const adminId of adminIds) {
              try {
                await this.sendTextMessage(adminId, adminNotifyText, undefined, true);
              } catch (e) {
                console.error(`Error al notificar al admin ${adminId}:`, e);
              }
            }
          }

          // 🔍 Detección dinámica de intención de respuesta IA
          const intentMatch = safeReply.match(/^\s*\[([^\]]+)\]\s*/);
          if (intentMatch) {
            const intentRaw = intentMatch[1] || '';
            const intent = intentRaw.toUpperCase();

            // Manejo explícito de tokens de moderación
            if (intent.startsWith('MODERATION::')) {
              const body = safeReply.replace(/^\s*\[[^\]]+\]\s*/, '').trim();

              if (intent.includes('WARN_PRIVATE')) {
                // Enviar sólo al usuario por privado (no al grupo)
                await this.sendTextMessage(senderJid, body, undefined, true);
                continue;
              }

              if (intent.includes('WARN_PUBLIC')) {
                // Advertencia pública en el grupo
                await this.sendTextMessage(chatId, body, senderJid, false);
                continue;
              }

              if (intent.includes('BAN')) {
                // Notificar al grupo y no enviar respuesta IA adicional
                await this.sendTextMessage(chatId, body, senderJid, false);
                continue;
              }
            }

            // Manejo explícito de tokens de cuota (rate limit)
            if (intent.startsWith('QUOTA_BLOCKED::')) {
              const body = safeReply.replace(/^\s*\[[^\]]+\]\s*/, '').trim();

              if (intent.includes('NEW')) {
                // 1. Obtener información de usuario y grupo
                const profile = await this.userProfileRepository.get(senderJid);
                const userName = profile?.name ? `${profile.name} (${senderJid.split('@')[0]})` : senderJid.split('@')[0];
                const group = await this.groupRepository.findByGroupId(chatId);
                const groupName = group?.display_name || chatId;

                // 2. Notificar a los administradores del grupo (o superadmins de fallback)
                let admins = await this.adminRepository.listGroupAdmins(chatId);
                let adminIds = admins.map((a) => a.user_id);
                if (adminIds.length === 0) {
                  adminIds = await this.adminRepository.listSuperAdminIds();
                }

                const adminNotifyText = [
                  `⚠️ *Solicitud de Aprobación de Cuota*`,
                  `• *Grupo:* ${groupName}`,
                  `• *Usuario:* ${userName}`,
                  `• *Detalle:* Se quedó sin preguntas y solicita habilitación de cupo extra.`,
                  ``,
                  `Para aprobar, respondé a este mensaje o escribí en el grupo el comando: *!sí* o *!aprobado*`,
                ].join('\n');

                for (const adminId of adminIds) {
                  try {
                    await this.sendTextMessage(adminId, adminNotifyText, undefined, true);
                  } catch (e) {
                    console.error(`Error al notificar al admin ${adminId} sobre cuota:`, e);
                  }
                }
              }

              // Responder al usuario en el grupo/privado sin el tag
              if (body) {
                await this.sendTextMessage(chatId, body, senderJid, false);
              }
              continue;
            }

            // Compatibilidad: detección antigua de "fuera de lugar" en texto de intención
            const lowerIntent = String(intentRaw).toLowerCase();
            const isOutOfScope = lowerIntent.includes('fuera de lugar') ||
                               lowerIntent.includes('off-topic') ||
                               lowerIntent.includes('no relacionado') ||
                               lowerIntent.includes('fuera de contexto');

            if (isOutOfScope && messageMentionsBot) {
              console.log(`⚠️ [IntentDetect] Pregunta fuera de contexto detectada: ${intentRaw}`);
              const warning = `⚠️ Esa pregunta está fuera de mis funciones del ISPC.\n\nIntenta preguntar algo sobre:\n• Materias y clases\n• Horarios y agenda\n• Coordinación y profesores\n• Noticias del ISPC\n\nSi insistís con temas off-topic, podrías recibir una restricción.`;
              await this.sendTextMessage(chatId, warning, senderJid, false);
              continue;
            }
          }

          const parts = safeReply.split('|||SPLIT|||');
          for (const part of parts) {
            const cleaned = part.trim();
            if (!cleaned) continue;
            // Remover encabezado de intención si está presente (solo para envío)
            const cleanedForSend = cleaned.replace(/^\s*\[[^\]]+\]\s*/, '').trim();
            if (cleanedForSend) {
              await this.sendTextMessage(chatId, cleanedForSend, senderJid, false);
            }
          }
        }
        } catch (msgErr) {
          const msg = (msgErr as any)?.message || 'error desconocido';
          console.error(`❌ Error procesando mensaje entrante: ${msg}`);
        }
      });
    } catch (err) {
      this.isConnecting = false;
      const errorMsg = (err as any)?.message || 'Error desconocido';
      console.error('❌ Error conectando:', errorMsg);
      process.exit(1);
    }
  }

  public async sendTextMessage(destinationJid: string, text: string, senderId?: string, sourceWasPrivate?: boolean): Promise<void> {
    this.logOutgoing(destinationJid, text, senderId, sourceWasPrivate);
    await this.whatsappSocket.sendMessage(destinationJid, { text });
  }

  public close() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.whatsappSocket) {
      this.whatsappSocket.end(new Error('Bot cerrado'));
    }
  }

  private async markMessageAsRead(incomingMessage: any): Promise<void> {
    try {
      const key = incomingMessage?.key;
      if (!key || !this.whatsappSocket?.readMessages) return;
      await this.whatsappSocket.readMessages([key]);
    } catch {
      // Ignorado: no queremos cortar el flujo principal por un ack de lectura.
    }
  }

  private extractMessageText(msg: any): string {
    const m = msg?.message;
    if (!m) return '';

    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;
    if (m.videoMessage?.caption) return m.videoMessage.caption;
    if (m.buttonsResponseMessage?.selectedDisplayText) return m.buttonsResponseMessage.selectedDisplayText;
    if (m.listResponseMessage?.title) return m.listResponseMessage.title;
    if (m.templateButtonReplyMessage?.selectedDisplayText) return m.templateButtonReplyMessage.selectedDisplayText;
    if (m.ephemeralMessage?.message) return this.extractMessageText({ message: m.ephemeralMessage.message });
    if (m.viewOnceMessage?.message) return this.extractMessageText({ message: m.viewOnceMessage.message });
    if (m.viewOnceMessageV2?.message) return this.extractMessageText({ message: m.viewOnceMessageV2.message });

    return '';
  }

  private isDuplicate(eventId: string): boolean {
    if (this.processedIds.has(eventId)) {
      return true;
    }

    this.processedIds.add(eventId);
    if (this.processedIds.size > 5000) {
      this.processedIds.clear();
    }
    return false;
  }

  private logIncoming(chatId: string, sender: string, text: string, isGroup: boolean, isAdmin: boolean, incomingMessage?: any): void {
    const msg = this.compactText(text);
    const scopeLabel = isGroup ? '[GRUPO]' : '[PRIVADO]';
    const baseColor = isGroup ? ANSI.cyan : ANSI.yellow;
    const senderLabel = isAdmin
      ? `${ANSI.magenta}${ANSI.bright}[ADMIN]${ANSI.reset} ${sender}`
      : `${ANSI.dim}${sender}${ANSI.reset}`;

    if (process.env.TUI_ENABLED !== 'true') {
      console.log(`${baseColor}📩 ${scopeLabel}${ANSI.reset} ${senderLabel} ${ANSI.dim}chat=${chatId}${ANSI.reset} -> "${msg}"`);
    }
    
    const phone = sender.split('@')[0];
    const key = incomingMessage?.key;
    const altJid = key?.participantAlt || key?.remoteJidAlt;
    const realPhone = altJid ? altJid.split('@')[0] : phone;
    const realPhoneJid = altJid || (sender.endsWith('@s.whatsapp.net') ? sender : `${realPhone}@s.whatsapp.net`);

    // Intentar obtener perfil usando el sender (puede ser LID) y, si no existe, el JID real de teléfono.
    const getProfile = async () => {
      let profile = await this.userProfileRepository.get(sender);
      if (!profile && realPhoneJid !== sender) {
        profile = await this.userProfileRepository.get(realPhoneJid);
      }
      return profile;
    };

    getProfile().then((profile) => {
      const displayName = profile?.name ? `${profile.name} (${realPhone})` : realPhone;
      if (isGroup) {
        this.groupRepository.findByGroupId(chatId).then((group) => {
          const entryYear = group?.entry_year != null ? `Camada ${group.entry_year}` : 'General';
          const contextLabel = `[Grupo: ${group?.display_name || chatId} | ${entryYear}]`;
          logTuiChatMessage(displayName, text, 'user', contextLabel);
        }).catch(() => {
          logTuiChatMessage(displayName, text, 'user', `[Grupo: ${chatId}]`);
        });
      } else {
        logTuiChatMessage(displayName, text, 'user', '[Privado]');
      }
    }).catch(() => {
      logTuiChatMessage(realPhone, text, 'user', isGroup ? `[Grupo: ${chatId}]` : '[Privado]');
    });
  }

  private logOutgoing(jid: string, text: string, senderId?: string, sourceWasPrivate?: boolean): void {
    const msg = this.compactText(text);
    const isGroup = jid.endsWith('@g.us');
    const inferredPrivate = sourceWasPrivate ?? !isGroup;
    const scopeLabel = inferredPrivate ? '[RESPUESTA PRIVADO]' : '[RESPUESTA GRUPO]';
    const color = inferredPrivate ? ANSI.yellow : ANSI.green;
    const replyTo = senderId ? ` ${ANSI.dim}a=${senderId}${ANSI.reset}` : '';

    if (process.env.TUI_ENABLED !== 'true') {
      console.log(`${color}📤 ${scopeLabel}${ANSI.reset}${replyTo} ${ANSI.dim}destino=${jid}${ANSI.reset} -> "${msg}"`);
    }
    
    if (isGroup) {
      this.groupRepository.findByGroupId(jid).then((group) => {
        const entryYear = group?.entry_year != null ? `Camada ${group.entry_year}` : 'General';
        const contextLabel = `[Grupo: ${group?.display_name || jid} | ${entryYear}]`;
        logTuiChatMessage('Vectorito', text, 'bot', contextLabel);
      }).catch(() => {
        logTuiChatMessage('Vectorito', text, 'bot', `[Grupo: ${jid}]`);
      });
    } else {
      logTuiChatMessage('Vectorito', text, 'bot', '[Privado]');
    }
  }

  private compactText(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 180) return normalized;
    return `${normalized.slice(0, 177)}...`;
  }

  private pickOne(options: string[]): string {
    return options[Math.floor(Math.random() * options.length)];
  }

  private extractMentionedJids(message: any): string[] {
    const m = message?.message;
    const contextInfo =
      m?.extendedTextMessage?.contextInfo ||
      m?.imageMessage?.contextInfo ||
      m?.videoMessage?.contextInfo ||
      m?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo ||
      m?.viewOnceMessage?.message?.extendedTextMessage?.contextInfo ||
      m?.viewOnceMessageV2?.message?.extendedTextMessage?.contextInfo;

    const mentioned = contextInfo?.mentionedJid;
    return Array.isArray(mentioned) ? mentioned.map((jid: any) => String(jid)) : [];
  }

  private normalizePhoneJid(jid: string): string {
    if (!jid) return '';
    const [left] = String(jid).split('@');
    // Tomamos la parte antes de los dos puntos (si es multi-dispositivo)
    // y limpiamos cualquier carácter que no sea alfanumérico (por si Baileys manda basura)
    const base = left.split(':')[0].trim();
    return base.replace(/[^a-zA-Z0-9]/g, '');
  }

  private isBotMentioned(mentionedJids: string[], incomingText?: string): boolean {
    const botId = String(this.whatsappSocket?.user?.id || this.whatsappSocket?.user?.jid || '');
    const botPhone = this.normalizePhoneJid(botId);
    const botLid = botPhone ? this.getBotLidFromSession(botPhone) : null;

    // 1) Mención fuerte: viene en contextInfo.mentionedJid
    for (const jid of mentionedJids) {
      const asString = String(jid || '');
      if (!asString) continue;

      if (asString.endsWith('@lid')) {
        const lid = this.normalizePhoneJid(asString);
        if (lid && botLid && lid === botLid) {
          return true;
        }
        continue;
      }

      const normalizedJid = this.normalizePhoneJid(asString);
      if (normalizedJid && botPhone && normalizedJid === botPhone) {
        return true;
      }
    }

    // 2) Respaldo: mención textual por alias (ej: @vectorito, @Vectorito Bot)
    if (!incomingText) return false;
    const normalizedText = this.normalizeMentionText(incomingText);
    const aliases = this.getBotMentionAliases();
    return aliases.some((alias) => {
      if (!alias) return false;
      const pattern = new RegExp(`(^|\\s)@${this.escapeRegExp(alias)}\\b`, 'i');
      return pattern.test(normalizedText);
    });
  }

  private getBotLidFromSession(botPhone: string): string | null {
    const now = Date.now();
    // Cache 60s para evitar lecturas de disco por mensaje.
    if (this.cachedBotLidAtMs && now - this.cachedBotLidAtMs < 60_000) {
      return this.cachedBotLid;
    }

    this.cachedBotLidAtMs = now;
    this.cachedBotLid = null;

    try {
      const mappingPath = path.resolve(process.cwd(), 'session', `lid-mapping-${botPhone}.json`);
      if (!fs.existsSync(mappingPath)) {
        return null;
      }
      const raw = fs.readFileSync(mappingPath, 'utf-8');
      const lid = String(JSON.parse(raw) || '').trim();
      this.cachedBotLid = lid ? this.normalizePhoneJid(lid) : null;
      return this.cachedBotLid;
    } catch {
      return null;
    }
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getBotMentionAliases(): string[] {
    const user = this.whatsappSocket?.user || {};
    const candidates = [
      String(user?.name || ''),
      String(user?.pushName || ''),
      String(user?.notify || ''),
      'vectorito',
      'Vectorito Bot',
    ];

    return candidates
      .map((candidate) => this.normalizeMentionText(candidate).replace(/^@+/, ''))
      .filter((candidate) => !!candidate);
  }

  private normalizeMentionText(text: string): string {
    return String(text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private stripBotMentions(text: string): string {
    let cleaned = String(text);
    for (const alias of this.getBotMentionAliases()) {
      if (!alias) continue;
      const pattern = new RegExp(`^(?:@${alias})\\b\\s*`, 'i');
      cleaned = cleaned.replace(pattern, '');
    }
    return cleaned;
  }

  private async isAllowedGroup(chatId: string, senderIsAdmin: boolean): Promise<boolean> {
    if (!chatId.endsWith('@g.us')) return true;
    const isActive = await this.groupRepository.isActive(chatId);
    if (isActive) return true;
    return senderIsAdmin;
  }

  private async handleUnauthorizedGroup(chatId: string): Promise<void> {
    if (this.unauthorizedGroupNoticeSent.has(chatId)) return;
    this.unauthorizedGroupNoticeSent.add(chatId);

    try {
      await this.sendTextMessage(
        chatId,
        'Solo un admin puede agregarme a grupos nuevos. Me retiro de este grupo por seguridad 🙂'
      );
      if (this.whatsappSocket?.groupLeave) {
        await this.whatsappSocket.groupLeave(chatId);
      }
    } catch (error) {
      const msg = (error as any)?.message || 'error desconocido';
      console.warn(`⚠️ No se pudo salir del grupo no autorizado ${chatId}: ${msg}`);
    }
  }

  private async handleGroupParticipantsUpdate(update: any): Promise<void> {
    try {
      const action = String(update?.action || '').toLowerCase();
      const groupId = String(update?.id || '');
      if (!groupId || (action !== 'add' && action !== 'remove' && action !== 'leave')) return;

      const botId = String(this.whatsappSocket?.user?.id || '');
      const botPhone = this.normalizePhoneJid(botId);
      if (!botPhone) return;

      const participants: string[] = Array.isArray(update?.participants)
        ? update.participants.map((p: any) => String(p))
        : [];
      const botWasAdded = participants.some((jid) => this.normalizePhoneJid(jid) === botPhone);

      if (!botWasAdded) {
        // Participante estándar agregado o quitado en un grupo activo
        const isActive = await this.groupRepository.isActive(groupId);
        if (isActive) {
          if (action === 'add') {
            for (const p of participants) {
              const userJid = p.split('@')[0] + '@s.whatsapp.net';
              await this.groupMembershipRepository.addMembership(groupId, userJid);
              console.log(`[Gateway] Membresía registrada para ${userJid} en grupo activo ${groupId}`);
            }
          } else if (action === 'remove' || action === 'leave') {
            for (const p of participants) {
              const userJid = p.split('@')[0] + '@s.whatsapp.net';
              await this.groupMembershipRepository.removeMembership(groupId, userJid);
              console.log(`[Gateway] Membresía removida para ${userJid} del grupo ${groupId}`);
            }
          }
        }
        return;
      }

      // Si el bot fue agregado al grupo
      if (action !== 'add') return;

      const isActive = await this.groupRepository.isActive(groupId);
      if (isActive) {
        return;
      }

      const actor = String(update?.author || update?.participant || '');
      const actorIsAdmin = actor ? await this.adminRepository.isRegistered(actor) : false;

      if (!actorIsAdmin) {
        await this.handleUnauthorizedGroup(groupId);
      } else {
        // Admin agregó el bot: registrar el grupo automáticamente en SQLite y enviar bienvenida.
        let groupName = `Grupo ${groupId}`;
        try {
          if (this.whatsappSocket && typeof this.whatsappSocket.groupMetadata === 'function') {
            const meta = await this.whatsappSocket.groupMetadata(groupId);
            if (meta && meta.subject) {
              groupName = meta.subject;
            }
          }
        } catch (e) {
          console.warn('[Gateway] No se pudo obtener metadata del grupo:', (e as any)?.message || e);
        }
        await this.groupRepository.register(groupId, groupName, actor || 'admin');
        if (groupName !== `Grupo ${groupId}`) {
          await this.groupRepository.updateDisplayName(groupId, groupName);
        }
        console.log(`✅ Bot agregado al nuevo grupo por admin: ${groupId}`);

        // Enviar mensaje de bienvenida Flujo 1
        try {
          const welcomeMsg = [
            '👋 ¡Hola a todos! Soy Vectorito, el asistente académico diseñado para ayudarlos en el cursado de su tecnicatura 😌.',
            '',
            'Puedo avisarles cuándo tienen clases, mostrarles los enlaces de Meet,',
            'recordarles exámenes y mantenerlos al día de los avisos institucionales.',
            '',
            '📌Para empezar, cada alumno tiene que registrarse una sola vez.',
            '   Escribime por privado un: *hola*',
            '',
            '⚙️ Si sos Admin del grupo y tenés los permisos,',
            ' Envía mensaje con *!config-grupo* para configurar las materias y horarios.'
          ].join('\n');
          await this.sendTextMessage(groupId, welcomeMsg, undefined, false);
        } catch {}
      }
    } catch (error) {
      const msg = (error as any)?.message || 'error desconocido';
      console.warn(`⚠️ Error validando actualización de participantes: ${msg}`);
    }
  }

  private suppressNextSessionDump = false;
  private streamNoiseFilterInstalled = false;

  private installConsoleNoiseFilter(): void {
    if (!this.streamNoiseFilterInstalled) {
      this.installStreamNoiseFilter();
      this.streamNoiseFilterInstalled = true;
    }

    const originalLog = console.log.bind(console);
    console.log = (...args: any[]) => {
      const first = args[0];

      // Evitar filtrar si es un log de trazabilidad del bot (📩 o 📤)
      if (typeof first === 'string' && (first.includes('📩') || first.includes('📤'))) {
        if (process.env.TUI_ENABLED !== 'true') {
          originalLog(...args);
        }
        return;
      }

      // Suprimir líneas tipo "Removing old closed session:" y similares
      if (typeof first === 'string' && VectoritoWhatsAppGateway.noisySessionLogPatterns.some((p) => p.test(first))) {
        this.suppressNextSessionDump = true;
        return;
      }

      if (args.some((arg) => arg && typeof arg === 'object' && ('_chains' in arg || 'registrationId' in arg || 'currentRatchet' in arg || 'indexInfo' in arg))) {
        return;
      }

      // Suprimir el objeto SessionEntry que Baileys vuelca justo después
      if (this.suppressNextSessionDump) {
        this.suppressNextSessionDump = false;
        if (first && typeof first === 'object' && ('_chains' in first || 'registrationId' in first || 'currentRatchet' in first || 'indexInfo' in first)) {
          return;
        }
      }

      originalLog(...args);
    };

    const originalInfo = console.info.bind(console);
    console.info = (...args: any[]) => {
      const first = args[0];

      if (typeof first === 'string' && VectoritoWhatsAppGateway.noisySessionLogPatterns.some((p) => p.test(first))) {
        this.suppressNextSessionDump = true;
        return;
      }

      if (args.some((arg) => arg && typeof arg === 'object' && ('_chains' in arg || 'registrationId' in arg || 'currentRatchet' in arg || 'indexInfo' in arg))) {
        return;
      }

      if (this.suppressNextSessionDump) {
        this.suppressNextSessionDump = false;
        if (first && typeof first === 'object' && ('_chains' in first || 'registrationId' in first || 'currentRatchet' in first || 'indexInfo' in first)) {
          return;
        }
      }

      originalInfo(...args);
    };

    const originalWarn = console.warn.bind(console);
    console.warn = (...args: any[]) => {
      const first = args[0];

      if (typeof first === 'string' && VectoritoWhatsAppGateway.noisySessionLogPatterns.some((p) => p.test(first))) {
        this.suppressNextSessionDump = true;
        return;
      }

      if (args.some((arg) => arg && typeof arg === 'object' && ('_chains' in arg || 'registrationId' in arg || 'currentRatchet' in arg || 'indexInfo' in arg))) {
        return;
      }

      if (this.suppressNextSessionDump) {
        this.suppressNextSessionDump = false;
        if (first && typeof first === 'object' && ('_chains' in first || 'registrationId' in first || 'currentRatchet' in first || 'indexInfo' in first)) {
          return;
        }
      }

      originalWarn(...args);
    };
  }

  private installStreamNoiseFilter(): void {
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    const shouldSuppress = (chunk: unknown): boolean => {
      const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      return /Closing session:\s*SessionEntry|SessionEntry\s*\{/.test(text);
    };

    process.stdout.write = ((chunk: any, encoding?: any, callback?: any) => {
      if (shouldSuppress(chunk)) return true;
      return originalStdoutWrite(chunk, encoding, callback);
    }) as any;

    process.stderr.write = ((chunk: any, encoding?: any, callback?: any) => {
      if (shouldSuppress(chunk)) return true;
      return originalStderrWrite(chunk, encoding, callback);
    }) as any;
  }

  private async syncGroupDisplayNames(): Promise<void> {
    if (!this.groupRepository) return;
    try {
      const groups = await this.groupRepository.findAll();
      for (const g of groups) {
        if (!g.display_name || g.display_name.startsWith('Grupo ')) {
          try {
            if (this.whatsappSocket && typeof this.whatsappSocket.groupMetadata === 'function') {
              const meta = await this.whatsappSocket.groupMetadata(g.group_id);
              if (meta && meta.subject && meta.subject !== g.display_name) {
                await this.groupRepository.updateDisplayName(g.group_id, meta.subject);
                console.log(`[Gateway] Sincronizado display_name del grupo ${g.group_id} a: "${meta.subject}"`);
              }
            }
          } catch (e) {
            // Silently ignore if metadata cannot be fetched at the moment
          }
        }
      }
    } catch (err) {
      console.warn('[Gateway] Error leyendo grupos para sincronizar:', err);
    }
  }
}
