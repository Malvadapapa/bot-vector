"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CabezonWhatsAppGateway = void 0;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const pino = __importStar(require("pino"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const module_1 = require("module");
const nodeRequire = (0, module_1.createRequire)(import.meta.url);
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
    '¡Hola! Soy Cabezón, el bot del ISPC. Antes de que podamos charlar, necesito que te registres por privado 🙂\nMandame un "hola" al privado y lo hacemos en un toque.',
    '¡Buenas! Para poder responderte necesito conocerte un poco. ¿Me mandás un "hola" por privado para registrarte? Es súper rápido 🙂',
    '¡Ey! Bienvenido. Porfa, escribime "hola" por privado así te registro y te puedo ayudar con lo que necesites del ISPC.',
];
const PROFILE_UPDATE_GROUP_MESSAGES = [
    'Che, por una actualización del bot del ISPC necesito que completes tus datos por privado. Gracias 🙂\nEscribime por privado con un "hola" y lo hacemos rápido.',
    '¡Ey! Hubo actualización del bot del ISPC y me faltan tus datos. Mandame "hola" por privado así los completamos 🙂',
    'Amigo, para seguir con IA primero completame unos datos por privado por una actualización del bot del ISPC 🙂\nEscribime "hola" en privado.',
];
const NO_PENDING_APPROVAL_MESSAGES = [
    'No tengo ninguna solicitud pendiente para aprobar ahora.',
    'Por ahora no hay pedidos de aprobación en cola.',
    'Todavía no veo solicitudes pendientes para habilitar.',
];
class CabezonWhatsAppGateway {
    constructor(router, privateChatWorkflow, userProfileRepository, adminRepository, rateLimitService, moderationService, groupRepository) {
        this.router = router;
        this.privateChatWorkflow = privateChatWorkflow;
        this.userProfileRepository = userProfileRepository;
        this.adminRepository = adminRepository;
        this.rateLimitService = rateLimitService;
        this.moderationService = moderationService;
        this.groupRepository = groupRepository;
        this.isConnecting = false;
        this.reconnectTimer = null;
        this.sawQrInCurrentSession = false;
        this.sessionResetAttempted = false;
        this.consecutive401WithoutQr = 0;
        this.connectionReplacedResetAttempted = false;
        this.consecutiveConnectionReplaced = 0;
        this.processedIds = new Set();
        this.unauthorizedGroupNoticeSent = new Set();
        this.cachedBotLid = null;
        this.cachedBotLidAtMs = 0;
        this.suppressNextSessionDump = false;
        this.streamNoiseFilterInstalled = false;
        this.installConsoleNoiseFilter();
    }
    isProfilePopulated(profile) {
        if (!profile)
            return false;
        const name = String(profile.name || '').trim();
        const birthday = String(profile.birthday_day_month || '').trim();
        const email = String(profile.email || '').trim();
        return !!name && !!birthday && !!email;
    }
    scheduleReconnect(delayMs) {
        if (this.reconnectTimer)
            return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.startConnection();
        }, delayMs);
    }
    async startConnection() {
        if (this.isConnecting)
            return;
        this.isConnecting = true;
        try {
            const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)('./session');
            const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
            this.whatsappSocket = (0, baileys_1.default)({
                version,
                auth: {
                    creds: state.creds,
                    keys: (0, baileys_1.makeCacheableSignalKeyStore)(state.keys, pino.default({ level: 'fatal' })),
                },
                printQRInTerminal: false,
                logger: pino.default({ level: 'silent' }),
                browser: baileys_1.Browsers.ubuntu('CabezonBot'),
                markOnlineOnConnect: true,
                syncFullHistory: true,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
            });
            this.whatsappSocket.ev.on('creds.update', saveCreds);
            this.whatsappSocket.ev.on('group-participants.update', async (update) => {
                await this.handleGroupParticipantsUpdate(update);
            });
            if (!this.whatsappSocket.authState.creds.registered) {
                console.log('\n[WhatsApp] Sesión nueva: se requiere escanear QR.');
            }
            this.whatsappSocket.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                if (qr) {
                    this.sawQrInCurrentSession = true;
                    this.consecutive401WithoutQr = 0;
                    console.log('\n[WhatsApp] QR recibido. Escanealo desde tu teléfono:');
                    qrcodeTerminal.generate(qr, { small: true });
                }
                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reasonText = lastDisconnect?.error?.message || 'sin detalle';
                    const isLoggedOut = statusCode === baileys_1.DisconnectReason.loggedOut;
                    const isRestartRequired = statusCode === baileys_1.DisconnectReason.restartRequired;
                    const isConnectionReplaced = statusCode === baileys_1.DisconnectReason.connectionReplaced;
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
                            }
                            catch (cleanupErr) {
                                const cleanupMsg = cleanupErr?.message || 'error desconocido';
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
                        this.consecutiveConnectionReplaced += 1;
                        if (!this.connectionReplacedResetAttempted) {
                            this.connectionReplacedResetAttempted = true;
                            console.log('\n[WhatsApp] Conflicto de sesión (440). Limpiando session y reintentando.');
                            try {
                                if (fs.existsSync('./session')) {
                                    fs.rmSync('./session', { recursive: true, force: true });
                                }
                            }
                            catch (cleanupErr) {
                                const cleanupMsg = cleanupErr?.message || 'error desconocido';
                                console.log(`[WhatsApp] No se pudo limpiar session automáticamente: ${cleanupMsg}`);
                            }
                            this.isConnecting = false;
                            console.log('[WhatsApp] Reintentando con sesión limpia en 3 segundos...');
                            this.scheduleReconnect(3000);
                            return;
                        }
                        if (this.consecutiveConnectionReplaced >= 2) {
                            console.error('\n[WhatsApp] Otra sesión está reemplazando esta conexión (440).');
                            console.error('[WhatsApp] Cerrá otra instancia del bot y eliminá el dispositivo duplicado en WhatsApp > Dispositivos vinculados.');
                            process.exit(1);
                        }
                    }
                    else {
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
                }
                else if (connection === 'open') {
                    this.isConnecting = false;
                    this.consecutiveConnectionReplaced = 0;
                    console.log('\n[WhatsApp] Conectado correctamente a WhatsApp.');
                }
            });
            this.whatsappSocket.ev.on('messages.upsert', async (event) => {
                try {
                    const incomingMessage = event?.messages?.[0];
                    if (!incomingMessage?.message || incomingMessage?.key?.fromMe)
                        return;
                    await this.markMessageAsRead(incomingMessage);
                    const eventId = String(incomingMessage?.key?.id || '');
                    if (!eventId || this.isDuplicate(eventId))
                        return;
                    const rawChatId = String(incomingMessage?.key?.remoteJid || '');
                    if (!rawChatId)
                        return;
                    const chatId = rawChatId.split(' ')[0];
                    const isGroup = chatId.includes('@g.us');
                    const rawSenderJid = String(incomingMessage?.key?.participant || chatId);
                    const senderJid = rawSenderJid.split(' ')[0];
                    const incomingText = this.extractMessageText(incomingMessage).trim();
                    const isAdmin = await this.adminRepository.isRegistered(senderJid);
                    const isActiveGroup = !isGroup ? true : await this.groupRepository.isActive(chatId);
                    // Auto-registro en primera activación: si el grupo no existe, registrarlo y notificar super-admins
                    if (isGroup && !isActiveGroup) {
                        const existing = await this.groupRepository.findByGroupId(chatId);
                        if (!existing) {
                            try {
                                await this.groupRepository.register(chatId, `Grupo ${chatId}`, senderJid);
                            }
                            catch (e) {
                                console.warn('[Gateway] No se pudo registrar el grupo automáticamente:', e?.message || e);
                            }
                            // Notificar super-admins para que completen la configuración por privado
                            let superAdmins = [];
                            try {
                                if (typeof this.adminRepository.listSuperAdminIds === 'function') {
                                    superAdmins = await this.adminRepository.listSuperAdminIds();
                                }
                                else {
                                    superAdmins = await this.adminRepository.listAllAdminIds();
                                }
                            }
                            catch (e) {
                                console.warn('[Gateway] Error obteniendo super-admins:', e?.message || e);
                            }
                            for (const sa of superAdmins) {
                                try {
                                    const cfgMsg = await this.privateChatWorkflow.startGroupContextConfiguration(sa, chatId);
                                    await this.sendTextMessage(sa, `Nuevo grupo detectado: ${chatId}\nSe creó un registro mínimo.\n\n${cfgMsg}`, undefined, true);
                                }
                                catch (e) {
                                    console.warn('[Gateway] No se pudo notificar super-admin', sa, e?.message || e);
                                }
                            }
                            // Informar al grupo que fue registrado y que los super-admins fueron notificados
                            try {
                                await this.sendTextMessage(chatId, 'Gracias. Este grupo fue registrado y los super-admins fueron notificados para completar la configuración. Un admin puede ejecutar !config-grupo para iniciar la configuración ahora.', undefined, false);
                            }
                            catch { }
                            return;
                        }
                        // Si existe pero está inactivo, permitir registro si quien envía es admin
                        if (!isAdmin) {
                            await this.handleUnauthorizedGroup(chatId);
                            return;
                        }
                        // Si es admin y el grupo está inactivo, re-registrar/activar
                        await this.groupRepository.register(chatId, `Grupo ${chatId}`, senderJid);
                    }
                    if (!incomingText)
                        return;
                    this.logIncoming(chatId, senderJid, incomingText, isGroup, isAdmin);
                    if (!isGroup) {
                        const privateReply = await this.privateChatWorkflow.handlePrivateMessage(senderJid, incomingText);
                        if (!privateReply)
                            return;
                        const parts = privateReply.split('|||SPLIT|||');
                        for (const part of parts) {
                            if (part.trim()) {
                                await this.sendTextMessage(chatId, part, senderJid, true);
                            }
                        }
                        return;
                    }
                    const mentionedJids = this.extractMentionedJids(incomingMessage);
                    // Detectar mención real por JID y, como respaldo, por alias dinámicos del bot.
                    const messageMentionsBot = this.isBotMentioned(mentionedJids, incomingText);
                    if (incomingText.includes('@')) {
                        const botIdDebug = String(this.whatsappSocket?.user?.id || this.whatsappSocket?.user?.jid || '');
                        console.log(`🔎 [MentionDebug] bot=${botIdDebug || 'sin-id'} mentioned=${mentionedJids.join(',') || 'ninguno'} text="${incomingText}" result=${messageMentionsBot}`);
                    }
                    // Limpiar el texto de basura de sesión y menciones para la IA
                    const normalizedGroupText = incomingText
                        .replace(/@session\\[^\s]+/g, '') // Quitar rutas de sesión primero
                        .replace(/@\d[\d\-\s]{5,}/g, '') // Quitar menciones numéricas
                        .trim() || incomingText;
                    const senderProfile = await this.userProfileRepository.get(senderJid);
                    const isRegisteredUser = this.isProfilePopulated(senderProfile);
                    const isNewUser = !this.isProfilePopulated(senderProfile);
                    const cleanForApproval = this.stripBotMentions(normalizedGroupText.trim())
                        .replace(/^!/, '')
                        .trim();
                    if (isAdmin && /^(si|sí|aprobado)$/i.test(cleanForApproval)) {
                        const approval = await this.rateLimitService.approveNextPendingRequest(new Date());
                        if (!approval) {
                            await this.sendTextMessage(chatId, this.pickOne(NO_PENDING_APPROVAL_MESSAGES), senderJid, false);
                            return;
                        }
                        const approvedProfile = await this.userProfileRepository.get(approval.userId);
                        const approvedLabel = approvedProfile?.name || approval.userId;
                        await this.sendTextMessage(chatId, `Aprobado ✅ ${approvedLabel} recibió ${approval.extraQuestionsGranted} preguntas extra para seguir con la IA.`, senderJid, false);
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
                            }
                            catch (e) {
                                console.warn('No se pudo borrar el mensaje del código en el grupo.');
                            }
                        }
                        return;
                    }
                    // Si es un número y NO hay menú activo, ignorar completamente
                    if (isNumericReply && !hasPendingMenu && !messageMentionsBot) {
                        return;
                    }
                    if (messageMentionsBot && !isRegisteredUser && !isCommand) {
                        // Solo interrumpir si es una pregunta de IA, no si es un comando público
                        const messages = isNewUser ? NEW_USER_REGISTRATION_MESSAGES : PROFILE_UPDATE_GROUP_MESSAGES;
                        await this.sendTextMessage(chatId, this.pickOne(messages), senderJid, false);
                        return;
                    }
                    // Procesar solo comandos, menciones al bot o números dentro de un menú activo.
                    const shouldProcess = isCommand || messageMentionsBot || (hasPendingMenu && isNumericReply);
                    if (!shouldProcess)
                        return;
                    const invokedByMention = messageMentionsBot;
                    if (!isAdmin && !isCommand && !(hasPendingMenu && isNumericReply)) {
                        const moderation = await this.moderationService.evaluate(senderJid, normalizedGroupText, isAdmin, new Date());
                        if (moderation.warningMessage) {
                            await this.sendTextMessage(chatId, moderation.warningMessage, senderJid, false);
                            return;
                        }
                        if (moderation.blocked) {
                            if (invokedByMention) {
                                await this.sendTextMessage(chatId, '⚠️ Ahora no puedo responderte. Si creés que es un error, hablá con un admin.', senderJid, false);
                            }
                            return;
                        }
                    }
                    const groupReply = await this.router.route(senderJid, normalizedGroupText, new Date(), invokedByMention || isCommand, isAdmin, invokedByMention, chatId);
                    if (groupReply == null)
                        return;
                    // PHASE 4: Handle group configuration command
                    if (typeof groupReply === 'string' && groupReply.startsWith('config-grupo:')) {
                        const groupId = groupReply.substring('config-grupo:'.length);
                        const configReply = await this.privateChatWorkflow.startGroupContextConfiguration(senderJid, groupId);
                        await this.sendTextMessage(senderJid, configReply, undefined, true);
                        return;
                    }
                    const safeReply = String(groupReply).trim() || 'No pude generar una respuesta en este momento.';
                    // 🔍 Detección dinámica de intención de respuesta IA
                    const intentMatch = safeReply.match(/^\s*\[([^\]]+)\]\s*/);
                    if (intentMatch) {
                        const intent = intentMatch[1].toLowerCase();
                        const isOutOfScope = intent.includes('fuera de lugar') ||
                            intent.includes('off-topic') ||
                            intent.includes('no relacionado') ||
                            intent.includes('fuera de contexto');
                        if (isOutOfScope && messageMentionsBot) {
                            console.log(`⚠️ [IntentDetect] Pregunta fuera de contexto detectada: ${intent}`);
                            const warning = `⚠️ Esa pregunta está fuera de mis funciones del ISPC.\n\nIntenta preguntar algo sobre:\n• Materias y clases\n• Horarios y agenda\n• Coordinación y profesores\n• Noticias del ISPC\n\nSi insistís con temas off-topic, podrías recibir una restricción.`;
                            await this.sendTextMessage(chatId, warning, senderJid, false);
                            return;
                        }
                    }
                    const parts = safeReply.split('|||SPLIT|||');
                    for (const part of parts) {
                        const cleaned = part.trim();
                        if (!cleaned)
                            continue;
                        // Remover encabezado de intención si está presente (solo para envío)
                        const cleanedForSend = cleaned.replace(/^\s*\[[^\]]+\]\s*/, '').trim();
                        if (cleanedForSend) {
                            await this.sendTextMessage(chatId, cleanedForSend, senderJid, false);
                        }
                    }
                }
                catch (msgErr) {
                    const msg = msgErr?.message || 'error desconocido';
                    console.error(`❌ Error procesando mensaje entrante: ${msg}`);
                }
            });
        }
        catch (err) {
            this.isConnecting = false;
            const errorMsg = err?.message || 'Error desconocido';
            console.error('❌ Error conectando:', errorMsg);
            process.exit(1);
        }
    }
    async sendTextMessage(destinationJid, text, senderId, sourceWasPrivate) {
        this.logOutgoing(destinationJid, text, senderId, sourceWasPrivate);
        await this.whatsappSocket.sendMessage(destinationJid, { text });
    }
    close() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.whatsappSocket) {
            this.whatsappSocket.end(new Error('Bot cerrado'));
        }
    }
    async markMessageAsRead(incomingMessage) {
        try {
            const key = incomingMessage?.key;
            if (!key || !this.whatsappSocket?.readMessages)
                return;
            await this.whatsappSocket.readMessages([key]);
        }
        catch {
            // Ignorado: no queremos cortar el flujo principal por un ack de lectura.
        }
    }
    extractMessageText(msg) {
        const m = msg?.message;
        if (!m)
            return '';
        if (m.conversation)
            return m.conversation;
        if (m.extendedTextMessage?.text)
            return m.extendedTextMessage.text;
        if (m.imageMessage?.caption)
            return m.imageMessage.caption;
        if (m.videoMessage?.caption)
            return m.videoMessage.caption;
        if (m.buttonsResponseMessage?.selectedDisplayText)
            return m.buttonsResponseMessage.selectedDisplayText;
        if (m.listResponseMessage?.title)
            return m.listResponseMessage.title;
        if (m.templateButtonReplyMessage?.selectedDisplayText)
            return m.templateButtonReplyMessage.selectedDisplayText;
        if (m.ephemeralMessage?.message)
            return this.extractMessageText({ message: m.ephemeralMessage.message });
        if (m.viewOnceMessage?.message)
            return this.extractMessageText({ message: m.viewOnceMessage.message });
        if (m.viewOnceMessageV2?.message)
            return this.extractMessageText({ message: m.viewOnceMessageV2.message });
        return '';
    }
    isDuplicate(eventId) {
        if (this.processedIds.has(eventId)) {
            return true;
        }
        this.processedIds.add(eventId);
        if (this.processedIds.size > 5000) {
            this.processedIds.clear();
        }
        return false;
    }
    logIncoming(chatId, sender, text, isGroup, isAdmin) {
        const msg = this.compactText(text);
        const scopeLabel = isGroup ? '[GRUPO]' : '[PRIVADO]';
        const baseColor = isGroup ? ANSI.cyan : ANSI.yellow;
        const senderLabel = isAdmin
            ? `${ANSI.magenta}${ANSI.bright}[ADMIN]${ANSI.reset} ${sender}`
            : `${ANSI.dim}${sender}${ANSI.reset}`;
        console.log(`${baseColor}📩 ${scopeLabel}${ANSI.reset} ${senderLabel} ${ANSI.dim}chat=${chatId}${ANSI.reset} -> "${msg}"`);
    }
    logOutgoing(jid, text, senderId, sourceWasPrivate) {
        const msg = this.compactText(text);
        const isGroup = jid.endsWith('@g.us');
        const inferredPrivate = sourceWasPrivate ?? !isGroup;
        const scopeLabel = inferredPrivate ? '[RESPUESTA PRIVADO]' : '[RESPUESTA GRUPO]';
        const color = inferredPrivate ? ANSI.yellow : ANSI.green;
        const replyTo = senderId ? ` ${ANSI.dim}a=${senderId}${ANSI.reset}` : '';
        console.log(`${color}📤 ${scopeLabel}${ANSI.reset}${replyTo} ${ANSI.dim}destino=${jid}${ANSI.reset} -> "${msg}"`);
    }
    compactText(text) {
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (normalized.length <= 180)
            return normalized;
        return `${normalized.slice(0, 177)}...`;
    }
    pickOne(options) {
        return options[Math.floor(Math.random() * options.length)];
    }
    extractMentionedJids(message) {
        const m = message?.message;
        const contextInfo = m?.extendedTextMessage?.contextInfo ||
            m?.imageMessage?.contextInfo ||
            m?.videoMessage?.contextInfo ||
            m?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo ||
            m?.viewOnceMessage?.message?.extendedTextMessage?.contextInfo ||
            m?.viewOnceMessageV2?.message?.extendedTextMessage?.contextInfo;
        const mentioned = contextInfo?.mentionedJid;
        return Array.isArray(mentioned) ? mentioned.map((jid) => String(jid)) : [];
    }
    normalizePhoneJid(jid) {
        if (!jid)
            return '';
        const [left] = String(jid).split('@');
        // Tomamos la parte antes de los dos puntos (si es multi-dispositivo)
        // y limpiamos cualquier carácter que no sea alfanumérico (por si Baileys manda basura)
        const base = left.split(':')[0].trim();
        return base.replace(/[^a-zA-Z0-9]/g, '');
    }
    isBotMentioned(mentionedJids, incomingText) {
        const botId = String(this.whatsappSocket?.user?.id || this.whatsappSocket?.user?.jid || '');
        const botPhone = this.normalizePhoneJid(botId);
        const botLid = botPhone ? this.getBotLidFromSession(botPhone) : null;
        // 1) Mención fuerte: viene en contextInfo.mentionedJid
        for (const jid of mentionedJids) {
            const asString = String(jid || '');
            if (!asString)
                continue;
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
        // 2) Respaldo: mención textual por alias (ej: @cabezon, @Cabezón Bot)
        if (!incomingText)
            return false;
        const normalizedText = this.normalizeMentionText(incomingText);
        const aliases = this.getBotMentionAliases();
        return aliases.some((alias) => {
            if (!alias)
                return false;
            const pattern = new RegExp(`(^|\\s)@${this.escapeRegExp(alias)}\\b`, 'i');
            return pattern.test(normalizedText);
        });
    }
    getBotLidFromSession(botPhone) {
        const now = Date.now();
        // Cache 60s para evitar lecturas de disco por mensaje.
        if (this.cachedBotLidAtMs && now - this.cachedBotLidAtMs < 60000) {
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
        }
        catch {
            return null;
        }
    }
    escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    getBotMentionAliases() {
        const user = this.whatsappSocket?.user || {};
        const candidates = [
            String(user?.name || ''),
            String(user?.pushName || ''),
            String(user?.notify || ''),
            'cabezon',
            'cabezón',
        ];
        return candidates
            .map((candidate) => this.normalizeMentionText(candidate).replace(/^@+/, ''))
            .filter((candidate) => !!candidate);
    }
    normalizeMentionText(text) {
        return String(text)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }
    stripBotMentions(text) {
        let cleaned = String(text);
        for (const alias of this.getBotMentionAliases()) {
            if (!alias)
                continue;
            const pattern = new RegExp(`^(?:@${alias})\\b\\s*`, 'i');
            cleaned = cleaned.replace(pattern, '');
        }
        return cleaned;
    }
    async isAllowedGroup(chatId, senderIsAdmin) {
        if (!chatId.endsWith('@g.us'))
            return true;
        const isActive = await this.groupRepository.isActive(chatId);
        if (isActive)
            return true;
        return senderIsAdmin;
    }
    async handleUnauthorizedGroup(chatId) {
        if (this.unauthorizedGroupNoticeSent.has(chatId))
            return;
        this.unauthorizedGroupNoticeSent.add(chatId);
        try {
            await this.sendTextMessage(chatId, 'Solo un admin puede agregarme a grupos nuevos. Me retiro de este grupo por seguridad 🙂');
            if (this.whatsappSocket?.groupLeave) {
                await this.whatsappSocket.groupLeave(chatId);
            }
        }
        catch (error) {
            const msg = error?.message || 'error desconocido';
            console.warn(`⚠️ No se pudo salir del grupo no autorizado ${chatId}: ${msg}`);
        }
    }
    async handleGroupParticipantsUpdate(update) {
        try {
            const action = String(update?.action || '').toLowerCase();
            const groupId = String(update?.id || '');
            if (!groupId || action !== 'add')
                return;
            const botId = String(this.whatsappSocket?.user?.id || '');
            const botPhone = this.normalizePhoneJid(botId);
            if (!botPhone)
                return;
            const participants = Array.isArray(update?.participants)
                ? update.participants.map((p) => String(p))
                : [];
            const botWasAdded = participants.some((jid) => this.normalizePhoneJid(jid) === botPhone);
            if (!botWasAdded)
                return;
            const isActive = await this.groupRepository.isActive(groupId);
            if (isActive) {
                return;
            }
            const actor = String(update?.author || update?.participant || '');
            const actorIsAdmin = actor ? await this.adminRepository.isRegistered(actor) : false;
            if (!actorIsAdmin) {
                await this.handleUnauthorizedGroup(groupId);
            }
            else {
                // Admin agregó el bot: registrar el grupo automáticamente en SQLite.
                await this.groupRepository.register(groupId, `Grupo ${groupId}`, actor || 'admin');
                console.log(`✅ Bot agregado al nuevo grupo por admin: ${groupId}`);
            }
        }
        catch (error) {
            const msg = error?.message || 'error desconocido';
            console.warn(`⚠️ Error validando actualización de participantes: ${msg}`);
        }
    }
    installConsoleNoiseFilter() {
        if (!this.streamNoiseFilterInstalled) {
            this.installStreamNoiseFilter();
            this.streamNoiseFilterInstalled = true;
        }
        const originalLog = console.log.bind(console);
        console.log = (...args) => {
            const first = args[0];
            // Suprimir líneas tipo "Removing old closed session:" y similares
            if (typeof first === 'string' && CabezonWhatsAppGateway.noisySessionLogPatterns.some((p) => p.test(first))) {
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
    }
    installStreamNoiseFilter() {
        const originalStdoutWrite = process.stdout.write.bind(process.stdout);
        const originalStderrWrite = process.stderr.write.bind(process.stderr);
        const shouldSuppress = (chunk) => {
            const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            return /Closing session:\s*SessionEntry|SessionEntry\s*\{/.test(text);
        };
        process.stdout.write = ((chunk, encoding, callback) => {
            if (shouldSuppress(chunk))
                return true;
            return originalStdoutWrite(chunk, encoding, callback);
        });
        process.stderr.write = ((chunk, encoding, callback) => {
            if (shouldSuppress(chunk))
                return true;
            return originalStderrWrite(chunk, encoding, callback);
        });
    }
}
exports.CabezonWhatsAppGateway = CabezonWhatsAppGateway;
CabezonWhatsAppGateway.noisySessionLogPatterns = [
    /^Closing open session in favor of incoming prekey bundle/i,
    /^Closing session:/i,
    /^Removing old closed session:/i,
    /^SessionEntry/i,
];
