import { getSettings } from './shared/config/settings.js';
import { DEFAULT_BOT_INSTRUCTIONS, FERIA_BOT_INSTRUCTIONS } from './shared/config/instructions.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { AcademicCalendarService } from './features/academic-calendar/academic-calendar.service.js';
import { ExamMenuService } from './features/academic-calendar/exam-menu.service.js';
import { EditExamMenuService } from './features/academic-calendar/edit-exam-menu.service.js';
import { RemoveNotificationMenuService } from './features/academic-calendar/remove-notification-menu.service.js';
import { TeacherMenuService } from './features/academic-calendar/teacher-menu.service.js';
import { AIQueryService } from './features/ai/ai-query.service.js';
import { ClassNotificationService } from './features/notifications/class-notification.service.js';
import { ConversationStateService } from './features/conversation/conversation-state.service.js';
import { DynamicMessageService } from './features/messages/dynamic-message.service.js';
import { MessageRouter } from './features/messages/message-router.service.js';
import { AmbiguityStateService } from './features/conversation/ambiguity-state.service.js';
import { OptionsStateService } from './features/conversation/options-state.service.js';
import { PrivateChatWorkflowService } from './application/admin/private-chat-workflow.service.js';
import { RateLimitService } from './features/ai/rate-limit.service.js';
import { KnowledgeContextService } from './features/ai/knowledge-context.service.js';
import { UserModerationService } from './features/moderation/user-moderation.service.js';
import { LoggingService } from './shared/logging/logging.service.js';
import { DatabaseConnection } from './shared/db/database.js';
import {
  AdminRepository,
  AdminVerificationCodeRepository,
  ClassCommissionScheduleRepository,
  CommissionRepository,
  GroupContextRepository,
  GroupRepository,
  CohortConfigRepository,
  GroupMembershipRepository,
  ManagedClassRepository,
  ManagedExamRepository,
  ManagedTeacherRepository,
  ReminderRepository,
  SchedulerRunRepository,
  UserProfileRepository,
  InboundEmailRejectionRepository,
  AuthorizedEmailRepository,
  OnboardingTokenRepository,
  WebOtpRepository,
} from './infrastructure/persistence/db/repositories.js';
import { HttpServer } from './interfaces/http/http-server.js';
import { ClassNotificationRepository, InstitutionalNoticeRepository } from './features/notifications/notifications.repository.js';
import { DailyGreetingRepository, OutboxDedupRepository } from './features/messages/messages.repository.js';
import { ConfirmationRepository } from './features/conversation/conversation.repository.js';
import { UserModerationRepository } from './features/moderation/moderation.repository.js';
import { RateLimitRepository } from './features/ai/rate-limit.repository.js';
import { MessageIntentParserService } from './features/messages/message-intent-parser.service.js';
import { EmailService, OutboundEmailService } from './features/notifications/integrations/email.service.js';
import { GeminiService } from './features/ai/providers/gemini.service.js';
import { GroqProvider } from './features/ai/providers/groq.provider.js';
import { FallbackAIService } from './features/ai/providers/fallback-ai.service.js';
import { GeminiEmbeddingProvider } from './features/ai/providers/gemini-embedding.provider.js';
import { InstitutionalEmailMonitor } from './features/notifications/integrations/institutional-email-monitor.js';
import { RssParserService } from './features/notifications/integrations/rss.service.js';
import { VectoritoWhatsAppGateway } from './interfaces/whatsapp/vectorito-whatsapp-gateway.js';
import { SchedulerService } from './scheduler/scheduler-service.js';
import { RagQueryService } from './features/ai/rag/rag-query.service.js';
import { RagPipelineService } from './features/ai/rag/rag-pipeline.service.js';
import { TerminalTui } from './interfaces/tui/terminal-tui.js';
import { setTerminalTui } from './shared/config/tui-shared.js';
import { AcademicGuardrail } from './features/ai/academic-guardrail.js';

// Las instrucciones se importan desde ./shared/config/instructions.js

const LOCK_FILE_PATH = path.join(process.cwd(), '.bot-instance.lock');

type InstanceLock = {
  pid: number;
  appId: string;
  cwd: string;
  createdAt: string;
};

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockFile(): InstanceLock | null {
  try {
    if (!fs.existsSync(LOCK_FILE_PATH)) return null;
    const content = fs.readFileSync(LOCK_FILE_PATH, 'utf-8').trim();
    if (!content) return null;

    if (/^\d+$/.test(content)) {
      return {
        pid: Number(content),
        appId: 'node_bot_whatsapp',
        cwd: process.cwd(),
        createdAt: new Date().toISOString(),
      };
    }

    const parsed = JSON.parse(content) as Partial<InstanceLock>;
    if (!parsed || typeof parsed.pid !== 'number') return null;
    return {
      pid: parsed.pid,
      appId: parsed.appId || 'node_bot_whatsapp',
      cwd: parsed.cwd || process.cwd(),
      createdAt: parsed.createdAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function terminatePreviousInstance(pid: number): void {
  if (!isProcessAlive(pid) || pid === process.pid) return;

  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // Ignorado: validaremos de nuevo abajo.
  }

  if (isProcessAlive(pid)) {
    console.error(`❌ No se pudo cerrar la instancia previa (PID ${pid}).`);
    process.exit(1);
  }
}

function terminateWorkspaceBotProcesses(): void {
  if (process.platform !== 'win32') return;

  try {
    const workspace = process.cwd().replace(/\\/g, '\\\\').replace(/'/g, "''");
    const script = [
      "$procs = Get-CimInstance Win32_Process | Where-Object {",
      "  $_.Name -match '^node(\\.exe)?$' -and",
      "  $_.CommandLine -match 'dist/main\\.js' -and",
      `  $_.CommandLine -match '${workspace}' -and`,
      `  $_.ProcessId -ne ${process.pid}`,
      '};',
      "$procs | Select-Object -ExpandProperty ProcessId | ForEach-Object { taskkill /PID $_ /T /F | Out-Null }",
    ].join(' ');

    execSync(`powershell -NoProfile -Command "${script}"`, { stdio: 'ignore' });
  } catch {
    // Ignorado: si falla, el lock file igualmente evita duplicados bien comportados.
  }
}

function releaseInstanceLock(): void {
  try {
    if (!fs.existsSync(LOCK_FILE_PATH)) return;
    const lock = readLockFile();
    if (lock?.pid === process.pid) {
      fs.unlinkSync(LOCK_FILE_PATH);
    }
  } catch {
    // Ignorado para no bloquear el cierre del proceso.
  }
}

function ensureSingleInstance(): void {
  try {
    terminateWorkspaceBotProcesses();

    const existingLock = readLockFile();
    if (existingLock && existingLock.pid !== process.pid && isProcessAlive(existingLock.pid)) {
      console.log(`♻️ Cerrando instancia anterior del bot (PID ${existingLock.pid}) para tomar control...`);
      terminatePreviousInstance(existingLock.pid);
    }

    if (fs.existsSync(LOCK_FILE_PATH)) {
      fs.unlinkSync(LOCK_FILE_PATH);
    }

    const currentLock: InstanceLock = {
      pid: process.pid,
      appId: 'node_bot_whatsapp',
      cwd: process.cwd(),
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(LOCK_FILE_PATH, JSON.stringify(currentLock, null, 2), { encoding: 'utf-8', flag: 'wx' });

    process.once('exit', () => releaseInstanceLock());
    process.once('SIGINT', () => releaseInstanceLock());
    process.once('SIGTERM', () => releaseInstanceLock());
  } catch (error) {
    const msg = (error as any)?.message || 'error desconocido';
    console.error(`❌ No se pudo crear lock de instancia única: ${msg}`);
    process.exit(1);
  }
}

function setupProcessSafetyHandlers() {
  process.on('unhandledRejection', (reason) => {
    const msg = (reason as any)?.message || String(reason);
    console.error(`❌ Unhandled rejection capturada: ${msg}`);
  });

  process.on('uncaughtException', (error) => {
    const msg = (error as any)?.message || 'error desconocido';
    console.error(`❌ Excepcion no capturada: ${msg}`);
  });
}

async function bootstrap() {
  ensureSingleInstance();
  setupProcessSafetyHandlers();

  if (process.env.TUI_ENABLED === 'true') {
    const tui = new TerminalTui();
    setTerminalTui(tui);
  }

  console.log('=== Vectorito: inicio de servicio ===');
  console.log('Cargando configuración, base de datos y conexión a WhatsApp...');

  const settings = getSettings();
  const databaseConnection = new DatabaseConnection(settings.sqlitePath);
  await databaseConnection.waitUntilReady();

  const sqliteDb = databaseConnection.getDb();
  const reminderRepository = new ReminderRepository(sqliteDb);
  const rateLimitRepository = new RateLimitRepository(sqliteDb);
  const confirmationRepository = new ConfirmationRepository(sqliteDb);
  const institutionalNoticeRepository = new InstitutionalNoticeRepository(sqliteDb);
  const userProfileRepository = new UserProfileRepository(sqliteDb);
  const adminRepository = new AdminRepository(sqliteDb);
  const adminCodeRepository = new AdminVerificationCodeRepository(sqliteDb);
  const managedExamRepository = new ManagedExamRepository(sqliteDb);
  const managedClassRepository = new ManagedClassRepository(sqliteDb);
  const classNotificationRepository = new ClassNotificationRepository(sqliteDb);
  const schedulerRunRepository = new SchedulerRunRepository(sqliteDb);
  const managedTeacherRepository = new ManagedTeacherRepository(sqliteDb);
  const dailyGreetingRepository = new DailyGreetingRepository(sqliteDb);
  const outboxDedupRepository = new OutboxDedupRepository(sqliteDb);
  const userModerationRepository = new UserModerationRepository(sqliteDb);
  const groupRepository = new GroupRepository(sqliteDb);
  const groupMembershipRepository = new GroupMembershipRepository(sqliteDb);
  const cohortConfigRepository = new CohortConfigRepository(sqliteDb);
  const classCommissionScheduleRepository = new ClassCommissionScheduleRepository(sqliteDb);
  const inboundEmailRejectionRepository = new InboundEmailRejectionRepository(sqliteDb);
  const authorizedEmailRepository = new AuthorizedEmailRepository(sqliteDb);

  // Repositorios de comisiones y contexto de grupo
  const commissionRepository = new CommissionRepository(sqliteDb);
  const groupContextRepository = new GroupContextRepository(sqliteDb);
  const onboardingTokenRepository = new OnboardingTokenRepository(sqliteDb);
  const webOtpRepository = new WebOtpRepository(sqliteDb);

  const allowedGroupIds = await groupRepository.getAllActiveIds();
  console.log(`[Grupos] ${allowedGroupIds.length} grupos activos cargados desde BD`);

  const seedCodes = settings.adminSeedCodes
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{6}$/.test(s));

  const existingAdmins = await adminRepository.listAllAdminIds();
  if (existingAdmins.length === 0) {
    if (seedCodes.length === 0) {
      const generated = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
      await adminCodeRepository.addCode(generated);
      console.log(`[ADMIN] Sin admins registrados. Código de inicio generado: ${generated}`);
    } else {
      for (const code of seedCodes) {
        await adminCodeRepository.addCode(code);
      }
      console.log(`[ADMIN] Sin admins registrados. Códigos seed cargados: ${seedCodes.join(', ')}`);
    }
  } else {
    // If admins already exist, clean up and delete any unconsumed seed codes from the DB to prevent reuse
    for (const code of seedCodes) {
      await adminCodeRepository.deleteIfUnconsumed(code);
    }
    console.log(`[ADMIN] Sistema ya inicializado con ${existingAdmins.length} admin(s). Códigos seed desactivados.`);
  }

  const emailService = new EmailService();
  const outboundEmailService = new OutboundEmailService();
  const rssParserService = new RssParserService();
  const dynamicMessageService = new DynamicMessageService(reminderRepository, institutionalNoticeRepository, managedExamRepository, rssParserService);
  const examMenuService = new ExamMenuService(managedExamRepository);
  const editExamMenuService = new EditExamMenuService(managedExamRepository);
  const removeNotificationMenuService = new RemoveNotificationMenuService(reminderRepository, managedExamRepository);
  const teacherMenuService = new TeacherMenuService(managedTeacherRepository, commissionRepository);
  const loggingService = new LoggingService();
  const academicCalendarService = new AcademicCalendarService(
    dynamicMessageService,
    reminderRepository,
    managedClassRepository,
    managedTeacherRepository,
    userProfileRepository,
    classCommissionScheduleRepository,
    commissionRepository,
    groupContextRepository,
    examMenuService,
    editExamMenuService,
    removeNotificationMenuService,
    managedExamRepository,
    loggingService,
    groupMembershipRepository,
    teacherMenuService,
    institutionalNoticeRepository,
    outboundEmailService,
  );
  const classNotificationService = new ClassNotificationService(
    managedClassRepository,
    classNotificationRepository,
    classCommissionScheduleRepository,
    commissionRepository
  );
  const messageIntentParserService = new MessageIntentParserService();
  const rateLimitService = new RateLimitService(rateLimitRepository);
  const moderationService = new UserModerationService(userModerationRepository);

  // --- IA Providers y Fallback ---
  const isFeriaMode = process.env.FERIA_MODE === 'true';
  const systemInstructions = isFeriaMode ? FERIA_BOT_INSTRUCTIONS : DEFAULT_BOT_INSTRUCTIONS;

  const geminiProviders: GeminiService[] = [];
  const groqProviders: GroqProvider[] = [];

  // Buscar todas las API keys de Gemini numeradas (ej. GEMINI_API_KEY_1)
  const geminiKeys = Object.keys(process.env)
    .filter(k => /^GEMINI_API_KEY_\d+$/.test(k))
    .sort((a, b) => {
      const numA = parseInt(a.replace('GEMINI_API_KEY_', ''), 10);
      const numB = parseInt(b.replace('GEMINI_API_KEY_', ''), 10);
      return numA - numB;
    })
    .map(k => process.env[k])
    .filter(Boolean) as string[];

  // Buscar todas las API keys de Groq numeradas (ej. GROQ_API_KEY_1)
  const groqKeys = Object.keys(process.env)
    .filter(k => /^GROQ_API_KEY_\d+$/.test(k))
    .sort((a, b) => {
      const numA = parseInt(a.replace('GROQ_API_KEY_', ''), 10);
      const numB = parseInt(b.replace('GROQ_API_KEY_', ''), 10);
      return numA - numB;
    })
    .map(k => process.env[k])
    .filter(Boolean) as string[];

  if (geminiKeys.length > 0) {
    console.log(`[IA] Se detectaron ${geminiKeys.length} API keys de Gemini numeradas.`);
    for (const key of geminiKeys) {
      geminiProviders.push(new GeminiService(key));
    }
  } else if (process.env.GEMINI_API_KEY) {
    geminiProviders.push(new GeminiService(process.env.GEMINI_API_KEY));
  }

  if (groqKeys.length > 0) {
    console.log(`[IA] Se detectaron ${groqKeys.length} API keys de Groq numeradas.`);
    for (const key of groqKeys) {
      groqProviders.push(new GroqProvider(systemInstructions, key));
    }
  } else if (process.env.GROQ_API_KEY) {
    groqProviders.push(new GroqProvider(systemInstructions, process.env.GROQ_API_KEY));
  }

  if (geminiProviders.length === 0 && groqProviders.length === 0) {
    throw new Error('No se configuró ninguna API key de Gemini ni de Groq en las variables de entorno.');
  }

  console.log('[IA] Inicializando proveedores de IA en orden de estrategia...');
  const allProviders: any[] = [];
  
  for (const gemini of geminiProviders) {
    try {
      await gemini.initialize();
      allProviders.push(gemini);
    } catch (e) {
      console.error(`[IA] Error al inicializar proveedor Gemini:`, (e as any)?.message || e);
    }
  }

  for (const groq of groqProviders) {
    try {
      await groq.initialize();
      allProviders.push(groq);
    } catch (e) {
      console.error(`[IA] Error al inicializar proveedor Groq:`, (e as any)?.message || e);
    }
  }

  if (allProviders.length === 0) {
    throw new Error('Todos los proveedores de IA fallaron al inicializarse.');
  }

  const fallbackAiService = new FallbackAIService(allProviders);

  // --- Inicializar AcademicGuardrail semántico local ---
  console.log('[Guardrail] Inicializando filtro semántico local (Hugging Face)...');
  try {
    await AcademicGuardrail.getInstance().initialize();
  } catch (guardrailError) {
    console.error('[Guardrail] ⚠️ No se pudo inicializar el filtro semántico. El bot continuará funcionando sin él.');
    console.error('[Guardrail] Detalle del error:', (guardrailError as any)?.message || guardrailError);
    console.error('[Guardrail] Posibles causas: sin conexión a internet (primera ejecución), memoria insuficiente, o modelo corrupto.');
    console.error('[Guardrail] Tip: Eliminá la carpeta data/.hf-cache/ y reiniciá para forzar la re-descarga del modelo.');
  }

  const knowledgeContextService = new KnowledgeContextService(
    userProfileRepository,
    managedExamRepository,
    institutionalNoticeRepository,
    managedClassRepository,
    reminderRepository,
    managedTeacherRepository,
    groupContextRepository,
    groupMembershipRepository,
    commissionRepository,
  );

  // --- RAG: búsqueda semántica en PDFs indexados ---
  const ragStoragePath = path.join(process.cwd(), 'data', 'vectores', 'vector_store.json');
  const ragKnowledgeDir = path.join(process.cwd(), 'data', 'ai-context');
  const ragStatePath = path.join(process.cwd(), 'data', 'vectores', 'sync_state.json');

  const geminiEmbeddingProvider = new GeminiEmbeddingProvider(process.env.GEMINI_API_KEY || '');
  const ragQueryService = new RagQueryService(ragStoragePath, geminiEmbeddingProvider);

  // Indexación inicial en background (no bloquea el arranque)
  const ragPipeline = new RagPipelineService(ragKnowledgeDir, ragStatePath, ragStoragePath, geminiEmbeddingProvider);
  groupContextRepository.findAll()
    .then((groups) => {
      const activeGroupIds = (groups || []).map((g) => g.group_id);
      return ragPipeline.syncAll(activeGroupIds, false);
    })
    .then(() => {
      console.log(`[RAG] Sincronización inicial completada. Vectores indexados: ${ragQueryService.getVectorCount() || 0}`);
    })
    .catch((err) => {
      console.error(`[RAG] Error en sincronización inicial (se mantiene el flujo IA con contexto interno):`, err?.message);
    });

  const aiQueryService = new AIQueryService(fallbackAiService, rateLimitService, knowledgeContextService, moderationService, ragQueryService);
  const conversationStateService = new ConversationStateService(reminderRepository, confirmationRepository);
  // Instancias de estado de conversación compartidas entre router y gateway
  const optionsStateService = new OptionsStateService();
  const ambiguityStateService = new AmbiguityStateService();

  const messageRouter = new MessageRouter(
    messageIntentParserService,
    academicCalendarService,
    conversationStateService,
    aiQueryService,
    dailyGreetingRepository,
    optionsStateService,
    ambiguityStateService,
  );

  const privateChatWorkflow = new PrivateChatWorkflowService(
    userProfileRepository,
    adminRepository,
    adminCodeRepository,
    institutionalNoticeRepository,
    managedExamRepository,
    managedClassRepository,
    managedTeacherRepository,
    userModerationRepository,
    dynamicMessageService,
    settings.adminPassword,
    groupContextRepository,
    commissionRepository,
    cohortConfigRepository,
    groupRepository,
    groupMembershipRepository,
    classCommissionScheduleRepository,
    rateLimitService,
    authorizedEmailRepository,
    onboardingTokenRepository,
    webOtpRepository,
  );
  const vectoritoWhatsAppGateway = new VectoritoWhatsAppGateway(
    messageRouter,
    privateChatWorkflow,
    userProfileRepository,
    adminRepository,
    rateLimitService,
    moderationService,
    groupRepository,
    groupMembershipRepository,
    aiQueryService,
    ambiguityStateService,
    groupContextRepository,
  );

  privateChatWorkflow.setPublishCallback(async (text: string, groupId?: string) => {
    if (groupId) {
      await vectoritoWhatsAppGateway.sendTextMessage(groupId, text);
      return;
    }
    const activeGroupIds = await groupRepository.getAllActiveIds();
    for (const gid of activeGroupIds) {
      await vectoritoWhatsAppGateway.sendTextMessage(gid, text);
    }
  });

  // Enlazar callbacks de moderación para notificaciones privadas
  moderationService.setPrivateChatCallback(async (userId: string, message: string) => {
    try {
      await vectoritoWhatsAppGateway.sendTextMessage(userId, message, undefined, true);
    } catch (e) {
      console.error('[Main] Error enviando mensaje privado de moderación al usuario:', e);
    }
  });

  academicCalendarService.setNotificationSender(async (message: string) => {
    const activeGroupIds = await groupRepository.getAllActiveIds();
    for (const gid of activeGroupIds) {
      await vectoritoWhatsAppGateway.sendTextMessage(gid, message);
    }
  });

  const emailMonitor = settings.imapHost && settings.imapUser && settings.imapPassword
    ? new InstitutionalEmailMonitor(
      emailService,
      institutionalNoticeRepository,
      reminderRepository,
      async (text: string, groupId?: string) => {
        // If groupId provided, send only to that group; otherwise send to all active groups
        if (groupId) {
          await vectoritoWhatsAppGateway.sendTextMessage(groupId, text);
          return;
        }
        const activeGroupIds = await groupRepository.getAllActiveIds();
        for (const gid of activeGroupIds) {
          await vectoritoWhatsAppGateway.sendTextMessage(gid, text);
        }
      },
      async () => {
        const activeGroupIds = await groupRepository.getAllActiveIds();
        return activeGroupIds[0] || undefined;
      },
      managedTeacherRepository,
      groupRepository,
      outboundEmailService,
      inboundEmailRejectionRepository,
      adminRepository,
      authorizedEmailRepository,
      webOtpRepository,
    )
    : undefined;

  if (emailMonitor) {
    emailMonitor.startListening();
  }

  const scheduler = new SchedulerService(
    groupRepository,
    vectoritoWhatsAppGateway,
    rateLimitService,
    reminderRepository,
    confirmationRepository,
    schedulerRunRepository,
    dynamicMessageService,
    classNotificationService,
    userProfileRepository,
    outboxDedupRepository,
    managedExamRepository,
    ragPipeline,
    emailMonitor,
    institutionalNoticeRepository,
    outboundEmailService,
    sqliteDb,
  );

  const httpServer = new HttpServer(
    onboardingTokenRepository,
    webOtpRepository,
    groupRepository,
    groupContextRepository,
    commissionRepository,
    managedClassRepository,
    classCommissionScheduleRepository,
    managedExamRepository,
    institutionalNoticeRepository,
    adminRepository,
    userProfileRepository,
    managedTeacherRepository,
    authorizedEmailRepository,
    outboundEmailService,
    vectoritoWhatsAppGateway,
    sqliteDb,
    3000
  );
  await httpServer.start();

  await vectoritoWhatsAppGateway.startConnection();
  await scheduler.startJobs();

  process.on('SIGINT', () => {
    console.log('\n=== Cerrando Vectorito ===');
    vectoritoWhatsAppGateway.close();
    httpServer.stop().catch(() => {});
    databaseConnection.close();
    process.exit(0);
  });
}

bootstrap().catch(async (err) => {
  console.error('\n\n==========================================');
  console.error('❌ ERROR FATAL DURANTE EL ARRANQUE DEL BOT');
  console.error('==========================================');
  console.error('Mensaje:', (err as any)?.message || 'Error desconocido');
  console.error('Stack:', (err as any)?.stack || 'Sin stack trace');
  console.error('==========================================\n');
  
  // En Windows, la ventana de PowerShell se cierra antes de que el usuario
  // pueda leer el error. Este delay le da tiempo para ver qué pasó.
  if (process.platform === 'win32' && process.stdout.isTTY) {
    console.error('⏳ El proceso se cerrará en 30 segundos. Copiá el error de arriba.');
    console.error('   Presioná Ctrl+C para cerrar ahora.\n');
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
  
  process.exit(1);
});
