import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getSettings } from '../../shared/config/settings.js';
import { DynamicMessageService } from '../messages/dynamic-message.service.js';
import { formatLocalDateOnly, get, run, all } from '../../shared/db/db-utils.js';
import { OutboundEmailService } from '../notifications/integrations/email.service.js';
import { InstitutionalNotice } from '../notifications/notifications.models.js';

import { ModerationAdminCommandService } from '../moderation/moderation-admin-command.service.js';
import { AdminLoggingCommandService } from '../../application/admin/admin-logging-command.service.js';
import { DashboardPanelService } from '../../application/admin/dashboard-panel.service.js';
import { MenuPersistenceService } from './menu-persistence.service.js';
import { ExamMenuService } from './exam-menu.service.js';
import { EditExamMenuService } from './edit-exam-menu.service.js';
import { RemoveNotificationMenuService } from './remove-notification-menu.service.js';
import { TeacherMenuService } from './teacher-menu.service.js';
import { ManagedClass, ManagedExam } from './academic-calendar.models.js';
import {
  ManagedClassRepository,
  ManagedExamRepository,
  ManagedTeacherRepository,
  ReminderRepository,
  ClassCommissionScheduleRepository,
  CommissionRepository,
  GroupContextRepository,
} from './academic-calendar.repository.js';
import { UserProfileRepository, GroupMembershipRepository, InstitutionalNoticeRepository } from '../../infrastructure/persistence/db/repositories.js';
import { LoggingService } from '../../shared/logging/logging.service.js';
import { PrivateChatWorkflowService } from '../../application/admin/private-chat-workflow.service.js';

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function getLocalDateParts(date: Date) {
  const tz = getSettings().timezone || 'America/Argentina/Cordoba';
  const formatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: tz,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    weekday: 'long'
  });
  const parts = formatter.formatToParts(date);
  
  const day = Number(parts.find(p => p.type === 'day')?.value || date.getDate());
  const month = Number(parts.find(p => p.type === 'month')?.value || (date.getMonth() + 1));
  const year = Number(parts.find(p => p.type === 'year')?.value || date.getFullYear());
  const weekdayRaw = parts.find(p => p.type === 'weekday')?.value || 'lunes';
  const weekday = weekdayRaw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return { day, month, year, weekday };
}

type MenuNode = {
  mensaje: string;
  opciones?: Record<string, string>;
  eventos?: Record<string, Array<{ fecha: string; fecha_fin?: string; nombre: string }>>;
  feriados_lista?: Array<{ fecha: string; nombre: string }>;
};

const GENERAL_MENU_TREE: Record<string, MenuNode> = {
  inicio: {
    mensaje: "¡Hola {{nombre_usuario}}! Soy Vectorito, el asistente virtual del grupo🤖. {{frase_ayuda_random}}\n\n¿Cómo te puedo ayudar hoy?\n1️⃣ Fechas Útiles (Calendario y Feriados)\n2️⃣ Comunicarse con ISPC\n3️⃣ Noticias de Software\n4️⃣ Avisos del ISPC\n5️⃣ Próximos Exámenes\n\n{{cta_random}}",
    opciones: {
      "1": "fechas_utiles",
      "2": "contacto_ispc",
      "3": "noticias",
      "4": "avisos",
      "5": "examenes"
    }
  },
  fechas_utiles: {
    mensaje: "📚 *Fechas útiles del ISPC*\n{{frase_ayuda_random}}\n¿Qué querés ver?\n1️⃣ Calendario académico\n2️⃣ Feriados\n\n{{cta_random}}\n0️⃣ Volver al inicio",
    opciones: {
      "1": "calendario_academico",
      "2": "feriados",
      "0": "inicio"
    }
  },
  calendario_academico: {
    mensaje: "📆 *Calendario Académico*\n\n{{calendario_academico_dinamico}}\n\nEscribí 0 para volver a fechas útiles.",
    opciones: {
      "0": "fechas_utiles"
    },
    eventos: {
      "1er_cuatrimestre": [
        { fecha: "2026-02-23", fecha_fin: "2026-03-31", nombre: "Mesas de Exámenes Finales (Feb - Mar)" },
        { fecha: "2026-03-02", fecha_fin: "2026-03-31", nombre: "Ser Técnico/a de Nivel Superior - SIES" },
        { fecha: "2026-03-16", nombre: "Inicio del 1er Cuatrimestre (2° y 3° año)" },
        { fecha: "2026-04-06", nombre: "Inicio del 1er Cuatrimestre (1° año)" },
        { fecha: "2026-05-11", fecha_fin: "2026-05-29", nombre: "Mesas de Exámenes Extraordinarios (Mayo)" },
        { fecha: "2026-07-03", nombre: "Fin del 1er Cuatrimestre" },
        { fecha: "2026-07-06", fecha_fin: "2026-07-17", nombre: "Receso de Invierno" }
      ],
      "2do_cuatrimestre": [
        { fecha: "2026-07-20", fecha_fin: "2026-08-07", nombre: "Mesas de Exámenes (Jul - Ago)" },
        { fecha: "2026-08-10", nombre: "Inicio del 2do Cuatrimestre" },
        { fecha: "2026-09-21", fecha_fin: "2026-10-09", nombre: "Mesas de Exámenes Extraordinarios (Sep)" },
        { fecha: "2026-11-27", nombre: "Fin del 2do Cuatrimestre" },
        { fecha: "2026-11-30", fecha_fin: "2026-12-29", nombre: "Mesas de Exámenes (Nov - Dic)" }
      ]
    }
  },
  feriados: {
    mensaje: "🎉 *Feriados*\n\n{{feriados_dinamico}}\n\nEscribí 0 para volver a fechas útiles.",
    opciones: {
      "0": "fechas_utiles"
    },
    feriados_lista: [
      { fecha: "2026-03-24", nombre: "Día Nacional de la Memoria por la Verdad y la Justicia" },
      { fecha: "2026-04-02", nombre: "Día del Veterano y de los Caídos en la Guerra de Malvinas" },
      { fecha: "2026-04-02", nombre: "Jueves Santo" },
      { fecha: "2026-04-03", nombre: "Viernes Santo" },
      { fecha: "2026-05-01", nombre: "Día Internacional de los trabajadores/as" },
      { fecha: "2026-05-02", nombre: "Día no laborable con fines turísticos" },
      { fecha: "2026-05-25", nombre: "Día de la Revolución de Mayo" },
      { fecha: "2026-06-17", nombre: "Paso a la Inmortalidad de Martín Miguel de Güemes" },
      { fecha: "2026-06-20", nombre: "Paso a la Inmortalidad de Manuel Belgrano" },
      { fecha: "2026-07-09", nombre: "Día de la Independencia" },
      { fecha: "2026-08-17", nombre: "Paso a la Inmortalidad de José de San Martín" },
      { fecha: "2026-09-11", nombre: "Día de la Maestra y el Maestro" },
      { fecha: "2026-09-21", nombre: "Día de los Estudiantes" },
      { fecha: "2026-10-12", nombre: "Día del Respeto a la Diversidad Cultural" },
      { fecha: "2026-11-20", nombre: "Día de la Soberanía Nacional" },
      { fecha: "2026-12-08", nombre: "Inmaculada Concepción de María" },
      { fecha: "2026-12-25", nombre: "Navidad" }
    ]
  },
  contacto_ispc: {
    mensaje: "☎️ *Comunicarse con ISPC*\n{{frase_ayuda_random}}\n¿Qué necesitás?\n\n1️⃣ Coordinación\n2️⃣ Profesores\n3️⃣ Redes Sociales\n\n{{cta_random}}\n0️⃣ Volver al inicio",
    opciones: {
      "1": "coordinacion_ispc",
      "2": "profesores_ispc",
      "3": "redes_ispc",
      "0": "inicio"
    }
  },
  coordinacion_ispc: {
    mensaje: "👩‍💼 *Coordinación - Tecnicatura en Desarrollo de Software*\n\n*Coordinadora General*\n📧 Tatiana Manzanelli\n✉️ coordinacion.software@ispc.edu.ar\n\n*Tutora Virtual*\n📧 Natalia Morán\n✉️ tutoriavirtual@ispc.edu.ar\n\nEscribí !menu para volver al inicio.",
    opciones: {
      "0": "contacto_ispc"
    }
  },
  profesores_ispc: {
    mensaje: "👨‍🏫 *Profesores*\n\n{{lista_profes_dinamica}}\n\nEscribí !menu para volver al inicio.",
    opciones: {
      "0": "contacto_ispc"
    }
  },
  redes_ispc: {
    mensaje: "🌐 *Redes Sociales - ISPC*\n\n📱 Instagram\nhttps://www.instagram.com/ispcordoba\n\n🎥 YouTube\nhttps://www.youtube.com/channel/UCgX9C1Ziq6BbcKValeZyo8Q\n\n👍 Facebook\nhttps://www.facebook.com/ISPCordoba/\n\n💼 LinkedIn\nhttps://www.linkedin.com/company/ispc-instituto-superior-polit-cnico-c-rdoba/\n\n🌍 Web\nhttps://www.ispc.edu.ar/\n\nEscribí !menu para volver al inicio.",
    opciones: {
      "0": "contacto_ispc"
    }
  },
  noticias: {
    mensaje: "📰 *Noticias de Software*\n\n{{lista_links_noticias}}\n\nEscribí !menu para volver al inicio.",
    opciones: {}
  },
  avisos: {
    mensaje: "📢 *Avisos del ISPC*\n\n{{avisos_dinamico}}\n\nEscribí !menu para volver al inicio.",
    opciones: {}
  },
  examenes: {
    mensaje: "📝 *Próximos Exámenes*\n\n{{examenes_dinamico}}\n\nEscribí !menu para volver al inicio.",
    opciones: {}
  }
};

export class AcademicCalendarService {
  private static readonly GROUP_SCOPED_ACADEMIC_COMMANDS = new Set([
    '!hoy',
    '!clases',
    '!semana',
    '!semana-que-viene',
    '!enlace',
    '!examenes',
  ]);

  private static readonly GROUP_CONFIG_REQUIRED_MESSAGE =
    '⚠️ Este grupo todavía no tiene configuración académica completa. Un administrador del grupo debe ejecutar !config-grupo para habilitar agenda, materias y exámenes.';

  private static readonly INCOMPLETE_PROFILE_MESSAGE =
    '⚠️ Para poder consultar agendas, clases o enlaces de cursado, primero tenés que completar tu registro. Por favor, escribime por privado para registrarte.';

  private static readonly INVALID_OR_MISSING_COMMISSION_MESSAGE =
    '⚠️ Para poder brindarte información sobre horarios, clases, aulas o enlaces de cursado, necesito saber a qué comisión pertenecés. Por favor, registrá tu comisión en el bot escribiendo \'hola\' en el chat privado.';

  private menuStateByUser = new Map<string, string>();
  private moderationAdminService = new ModerationAdminCommandService();
  private dashboardPanelService?: DashboardPanelService;
  private adminLoggingService?: AdminLoggingCommandService;
  private menuPersistenceService?: MenuPersistenceService;

  constructor(
    private dynamicMessageService: DynamicMessageService,
    private reminderRepository: ReminderRepository,
    private managedClassRepository: ManagedClassRepository,
    private managedTeacherRepository: ManagedTeacherRepository,
    private userProfileRepository: UserProfileRepository,
    private classCommissionScheduleRepository?: ClassCommissionScheduleRepository,
    private commissionRepository?: CommissionRepository,
    private groupContextRepository?: GroupContextRepository,
    private examMenuService?: ExamMenuService,
    private editExamMenuService?: EditExamMenuService,
    private removeNotificationMenuService?: RemoveNotificationMenuService,
    private managedExamRepository?: ManagedExamRepository,
    private loggingService?: LoggingService,
    private groupMembershipRepository?: GroupMembershipRepository,
    private teacherMenuService?: TeacherMenuService,
    private noticeRepository?: InstitutionalNoticeRepository,
    private outboundEmailService?: OutboundEmailService,
  ) {
    // Inicializar servicios
    if (this.loggingService) {
      this.adminLoggingService = new AdminLoggingCommandService(this.loggingService);
    }

    // Inicializar servicio de persistencia si tenemos los repositorios necesarios
    // Inicializar servicio de panel
    if (this.loggingService) {
      this.dashboardPanelService = new DashboardPanelService(undefined, this.loggingService);
    }

    if (this.examMenuService && this.managedExamRepository) {
      this.menuPersistenceService = new MenuPersistenceService(
        this.examMenuService,
        this.managedExamRepository,
        this.loggingService,
      );
    }
  }

  public hasActiveMenuState(userId: string): boolean {
    return this.menuStateByUser.has(userId);
  }

  public clearMenuState(userId: string): void {
    this.menuStateByUser.delete(userId);
  }

  public setNotificationSender(sender: (message: string) => Promise<void>): void {
    this.menuPersistenceService?.setNotificationSender(sender);
  }

  public async handleCommand(userId: string, commandText: string, now?: Date, isAdmin = false, groupId?: string, isGroupAdmin = false, isSuperAdmin = false): Promise<string | null> {
    const normalized = commandText.trim().toLowerCase();
    const currentNow = now ?? new Date();

    // Resolución de alias cortos a comandos completos
    const ALIASES: Record<string, string> = {
      '!m':  '!menu',
      '!h':  '!hoy',
      '!e':  '!enlace',
      '!s':  '!semana',
      '!sv': '!semana-que-viene',
      '!ex': '!examenes',
      '!av': '!avisos',
      '!n':  '!noticias',
      '!he': '!help',
    };
    const resolvedCommand = ALIASES[normalized] ?? normalized;

    if (resolvedCommand === '!menu') {
      return this.handleMenuInput(userId, resolvedCommand, groupId);
    }

    if (
      groupId
      && AcademicCalendarService.GROUP_SCOPED_ACADEMIC_COMMANDS.has(resolvedCommand)
      && !(await this.isGroupAcademicallyConfigured(groupId))
    ) {
      return AcademicCalendarService.GROUP_CONFIG_REQUIRED_MESSAGE;
    }

    if (resolvedCommand === '!hoy' || resolvedCommand === '!clases') {
      return this.formatDay(userId, currentNow, groupId);
    }

    if (resolvedCommand === '!examenes') {
      return this.formatManagedExams(userId, groupId);
    }

    if (resolvedCommand === '!help') {
      return [
        '🛠️ Comandos disponibles:',
        '!menu (!m)               → Menú interactivo',
        '!hoy o !clases (!h)      → Materias de hoy (fecha y hora)',
        '!enlace (!e)             → Enlace de la clase en curso (o próxima en 10 min)',
        '!semana (!s)             → Agenda de esta semana',
        '!semana-que-viene (!sv)  → Agenda de la próxima semana',
        '!examenes (!ex)          → Próximos exámenes',
        '!avisos (!av)            → Avisos institucionales vigentes',
        '!noticias (!n)           → Últimas noticias de software',
        '!help (!he)              → Muestra este mensaje de ayuda'
      ].join('\n');
    }

    if (resolvedCommand === '!semana') {
      return this.formatWeekEvents(userId, currentNow, 0, groupId);
    }

    if (resolvedCommand === '!semana-que-viene') {
      return this.formatWeekEvents(userId, currentNow, 7, groupId);
    }

    if (resolvedCommand === '!enlace') {
      return this.formatCurrentClassLink(userId, currentNow, groupId);
    }

    if (resolvedCommand === '!avisos') {
      return this.formatInstitutionalNotices(groupId, userId);
    }

    if (resolvedCommand === '!noticias') {
      return this.dynamicMessageService.getNews(5, false);
    }

    // Comando de configuración de grupo
    if (resolvedCommand === '!config-grupo' || resolvedCommand === '!configurar-grupo') {
      if (!isGroupAdmin && !isSuperAdmin) {
        return '🔒 Solo administradores pueden ejecutar este comando.';
      }
      if (!groupId) {
        return '⚠️ Este comando solo funciona desde el grupo.';
      }
      return '⚠️ La configuración por chat y comandos interactivos ha sido deshabilitada. Ahora podés configurar este grupo ingresando al panel de administración web centralizado.';
    }

    // Comando de onboarding web del grupo
    if (resolvedCommand === '!onboarding') {
      if (!isGroupAdmin && !isSuperAdmin) {
        return '🔒 Solo administradores pueden ejecutar este comando.';
      }
      if (!groupId) {
        return '⚠️ Este comando solo funciona desde el grupo.';
      }
      return '⚠️ El flujo de onboarding por token ha sido deshabilitado. La configuración de este grupo se realiza directamente desde el panel de administración web.';
    }

    // Comando !responderid y alias !rid
    const lowerCmd = commandText.trim().toLowerCase();
    const isResponderId = lowerCmd.startsWith('!responderid');
    const isRid = lowerCmd.startsWith('!rid');
    if (isResponderId || isRid) {
      const cmdLength = isResponderId ? '!responderid'.length : '!rid'.length;
      const restText = commandText.trim().slice(cmdLength).trim();
      const match = restText.match(/^(\d+)\s+(.+)$/s);
      if (!match) {
        const cmdName = isResponderId ? '!responderid' : '!rid';
        return `❌ Formato inválido. Usá: ${cmdName}<ID> <mensaje> o ${cmdName} <ID> <mensaje>`;
      }
      
      const id = Number(match[1]);
      const message = match[2].trim();

      const db = (this.reminderRepository as any).db;

      if (db) {
        // Try to match teacher message
        let teacherMsg;
        try {
          teacherMsg = await get<any>(
            db,
            'SELECT * FROM teacher_messages WHERE id = ? LIMIT 1',
            [id]
          );
        } catch (e) {
          console.warn('[AcademicCalendarService] Error checking teacher_messages:', e);
        }

        if (teacherMsg) {
          let authorName = userId.split('@')[0];
          try {
            const profile = await get<any>(
              db,
              'SELECT name FROM user_profiles WHERE user_id = ? LIMIT 1',
              [userId]
            );
            if (profile?.name) {
              authorName = profile.name;
            }
          } catch {}

          await run(
            db,
            `INSERT INTO teacher_message_replies (teacher_message_id, author_id, author_name, author_phone, content, is_from_student, read_by_professor)
             VALUES (?, ?, ?, ?, ?, 1, 0)`,
            [id, userId, authorName, userId.split('@')[0], message]
          );
          return `✅ Hola *${authorName}*, tu consulta fue registrada para el profesor *${teacherMsg.author_name}*. Te responderá a la brevedad.`;
        }

        // Try to match institutional notice
        let noticeMsg;
        try {
          noticeMsg = await get<any>(
            db,
            'SELECT * FROM institutional_notices WHERE id = ? LIMIT 1',
            [id]
          );
        } catch (e) {
          console.warn('[AcademicCalendarService] Error checking institutional_notices:', e);
        }

        if (noticeMsg) {
          let authorName = userId.split('@')[0];
          try {
            const profile = await get<any>(
              db,
              'SELECT name FROM user_profiles WHERE user_id = ? LIMIT 1',
              [userId]
            );
            if (profile?.name) {
              authorName = profile.name;
            }
          } catch {}

          const isFromStudent = isSuperAdmin ? 0 : 1;
          await run(
            db,
            `INSERT INTO notice_replies (notice_id, author_id, author_name, author_phone, content, is_from_student, read_by_professor, email_sent)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
            [id, userId, authorName, userId.split('@')[0], message, isFromStudent, isSuperAdmin ? 1 : 0]
          );

          if (!isSuperAdmin) {
            return `✅ Hola *${authorName}*, tu consulta sobre el aviso fue registrada. Te responderemos a la brevedad.`;
          }

          if (!noticeMsg.source_email) {
            return `❌ El aviso con ID ${id} no tiene un correo electrónico de origen asociado.`;
          }

          if (!this.outboundEmailService) {
            return '❌ Servicio de correo saliente no configurado.';
          }

          // Resolve creator display name
          let creatorName = noticeMsg.source_email;
          try {
            const profile = await get<any>(
              db,
              'SELECT name FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
              [noticeMsg.source_email.toLowerCase()]
            );
            if (profile && profile.name) {
              creatorName = profile.name;
            } else {
              const teacher = await get<any>(
                db,
                'SELECT name FROM managed_teachers WHERE LOWER(email) = ? LIMIT 1',
                [noticeMsg.source_email.toLowerCase()]
              );
              if (teacher && teacher.name) {
                creatorName = teacher.name;
              }
            }
          } catch {}

          const emailSubject = `Respuesta a tu aviso: ${noticeMsg.title}`;
          const emailBody = `Hola ${creatorName}.\n\nUn superadministrador ha respondido a tu aviso "${noticeMsg.title}" con el siguiente mensaje:\n\n` +
            `----------------------------------------\n` +
            `${message}\n` +
            `----------------------------------------\n\n` +
            `Datos del emisor original:\n` +
            `- Nombre: ${creatorName}\n` +
            `- Correo: ${noticeMsg.source_email}\n` +
            `- Título del aviso: ${noticeMsg.title}`;

          try {
            await this.outboundEmailService.send(noticeMsg.source_email, emailSubject, emailBody);
            return `✅ Respuesta enviada por correo a ${noticeMsg.source_email} con éxito.`;
          } catch (err) {
            console.error('[AcademicCalendarService] Error sending reply email:', err);
            return `❌ Error al enviar la respuesta por correo.`;
          }
        }
      }

      return `❌ No se encontró ningún aviso o mensaje con el ID ${id}.`;
    }

    // Comandos de menú para exámenes
    if (resolvedCommand === '!agregarexamen') {
      if (this.examMenuService) {
        return this.examMenuService.startExamFlow(userId);
      }
      return '⚠️ Servicio de exámenes no disponible.';
    }

    if (resolvedCommand === '!editarexamen') {
      if (this.editExamMenuService) {
        return await this.editExamMenuService.startEditFlow(userId);
      }
      return '⚠️ Servicio de edición no disponible.';
    }

    if (resolvedCommand === '!eliminaravisos') {
      if (this.removeNotificationMenuService) {
        return await this.removeNotificationMenuService.startRemovalFlow(userId);
      }
      return '⚠️ Servicio de avisos no disponible.';
    }

    if (resolvedCommand === '!panel') {
      if (this.dashboardPanelService) {
        return isAdmin ? await this.dashboardPanelService.generateAdminDashboard() : await this.dashboardPanelService.generatePublicDashboard();
      }
      return '📊 Panel no disponible.';
    }

    if (resolvedCommand === '!log-errores' || resolvedCommand === '!log-moderacion' || resolvedCommand === '!stats') {
      if (this.adminLoggingService) {
        const response = await this.adminLoggingService.handleLoggingCommand(commandText, isAdmin);
        if (response) return response;
      }
      return '🔒 Este comando es solo para administradores.';
    }

    // COMANDOS DE MODERACIÓN (Admin)
    const adminCommandResponse = await this.moderationAdminService.handleCommand(commandText, userId);
    if (adminCommandResponse) {
      return adminCommandResponse;
    }

    return null;
  }

  public async handleMenuInput(userId: string, rawText: string, groupId?: string): Promise<string | null> {
    let normalized = rawText.trim().toLowerCase();
    if (normalized === 'menú') {
      normalized = 'menu';
    }
    const isMenuCommand = normalized === '!menu' || normalized === '!m' || normalized === '!menú';
    const menuTree = this.loadMenus();

    // Procesar flujos de exámenes si el usuario está en uno
    if (this.examMenuService?.isInFlow(userId)) {
      const { response, completed, examData } = this.examMenuService.processInput(userId, rawText);

      // Si el flujo se completó, guardar el examen
      if (completed && examData && this.menuPersistenceService) {
        const validation = this.menuPersistenceService.validateExamData(examData);
        if (!validation.valid) {
          return `❌ Error de validación:\n${validation.errors.join('\n')}`;
        }

        const saveResult = await this.menuPersistenceService.saveExamFromMenuFlow(examData);
        if (!saveResult.success) {
          return saveResult.message;
        }

        let finalMessage = response + '\n\n' + saveResult.message;
        if (saveResult.anticipation) {
          finalMessage += '\n\n' + saveResult.anticipation;
        }

        return finalMessage;
      }

      return response;
    }

    if (this.editExamMenuService?.isInFlow(userId)) {
      const { response, completed } = await this.editExamMenuService.processInput(userId, rawText);
      return response;
    }

    if (this.removeNotificationMenuService?.isInFlow(userId)) {
      const { response, completed } = await this.removeNotificationMenuService.processInput(userId, rawText);
      return response;
    }

    if (this.teacherMenuService?.isInFlow(userId)) {
      if (normalized === '0' || normalized === 'volver' || normalized === 'regresar') {
        this.teacherMenuService.cancelFlow(userId);
        this.menuStateByUser.set(userId, 'contacto_ispc');
        return this.renderNode(menuTree!, 'contacto_ispc', userId, groupId);
      }
      const { response, completed } = await this.teacherMenuService.processInput(userId, rawText);
      return response;
    }

    if (!menuTree) {
      if (isMenuCommand) {
        return this.renderFallbackMenu(userId);
      }
      return null;
    }

    if (isMenuCommand) {
      this.menuStateByUser.set(userId, 'inicio');
      this.teacherMenuService?.cancelFlow(userId);
      return this.renderNode(menuTree, 'inicio', userId, groupId);
    }

    const currentNode = this.menuStateByUser.get(userId);
    if (!currentNode) return null;

    // Si el usuario escribe "0", "menu", "volver" o "regresar", regresamos a inicio
    if (normalized === '0' || normalized === 'menu' || normalized === 'volver' || normalized === 'regresar') {
      this.menuStateByUser.set(userId, 'inicio');
      return this.renderNode(menuTree, 'inicio', userId, groupId);
    }

    const node = menuTree[currentNode];
    if (!node) {
      this.menuStateByUser.delete(userId);
      return null;
    }

    const options = node.opciones || {};
    const nextNode = options[normalized];

    if (nextNode === 'profesores_ispc' && this.teacherMenuService) {
      this.menuStateByUser.delete(userId);
      return await this.teacherMenuService.startTeacherFlow(userId, groupId);
    }

    if (!nextNode) {
      // Si la opción no es válida y es un número, indicamos error y mantenemos el estado
      if (/^\d+$/.test(normalized)) {
        return 'Opcion invalida. Elegi una opcion del menu o escribi !menu para volver al inicio.';
      }
      // Si es un comando o texto libre, salimos del flujo del menú general del grupo para permitir comandos e IA
      this.menuStateByUser.delete(userId);
      return null;
    }

    // Determinar si el siguiente nodo debe persistir el estado de FSM
    const next = menuTree[nextNode];
    const nextHasOptions = !!next?.opciones && Object.keys(next.opciones).length > 0;
    const nextOptionKeys = next?.opciones ? Object.keys(next.opciones) : [];

    const navigationalOnly = nextOptionKeys.length > 0 && nextOptionKeys.every((key) => {
      const value = String(next?.opciones?.[key] || '').toLowerCase();
      return key === '0' || /volver|menu|inicio/.test(key) || /volver|menu|inicio/.test(value);
    });

    const promptText = String(next?.mensaje || '').toLowerCase();
    const asksForChoice = /(elegi|elegí|selecciona|seleccioná|mandame el numero|que necesitás|qué necesitás|opcion|opción)/i.test(promptText) || /\d️⃣/.test(promptText);

    // Mantener estado SOLO si tiene opciones reales y nos está pidiendo activamente una elección
    const keepState = nextHasOptions && !navigationalOnly && asksForChoice;

    if (keepState) {
      this.menuStateByUser.set(userId, nextNode);
    } else {
      this.menuStateByUser.delete(userId); // Nodos terminales o informativos limpian el estado automáticamente
    }

    return this.renderNode(menuTree, nextNode, userId, groupId);
  }

  private async formatDay(userId: string, currentDt: Date, groupId?: string): Promise<string> {
    const validation = await this.validateUserCommission(userId, groupId);
    if (!validation.valid) {
      return validation.reason === 'incomplete_profile'
        ? AcademicCalendarService.INCOMPLETE_PROFILE_MESSAGE
        : AcademicCalendarService.INVALID_OR_MISSING_COMMISSION_MESSAGE;
    }
    const { day, month, weekday } = getLocalDateParts(currentDt);
    const dayName = weekday;
    const dateStr = `${day} de ${MONTH_NAMES[month - 1]}`;
    const classes = await this.getClassesForWeekday(dayName, userId, groupId);
    const notices = await this.getValidNoticesForDay(currentDt, groupId);
    const exams = await this.getExamsForDay(currentDt, userId, groupId);

    const chunks: string[] = [];
    if (classes.length) {
      chunks.push(`📅 Hoy tenemos clase de (${dayName} ${dateStr}):`);
      chunks.push(...classes.map((c) => `🕒 ${c.hora}\n📚 ${c.materia}`));
    } else {
      chunks.push(`📅 Hoy (${dayName} ${dateStr}) no hay clases programadas.`);
    }

    if (notices.length) {
      chunks.push(`📢 ¡Y hay avisos del ISPC vigentes hoy!\n${notices.map((n) => `- ${n.title}`).join('\n')}`);
    }

    if (exams.length) {
      chunks.push(`📝 También hay exámenes hoy:\n${exams.map((e) => `- ${e.exam_time} | ${e.subject} (${e.exam_type})`).join('\n')}`);
    }

    return chunks.join('|||SPLIT|||');
  }

  private async formatCurrentClassLink(userId: string, currentDt: Date, groupId?: string): Promise<string> {
    const validation = await this.validateUserCommission(userId, groupId);
    if (!validation.valid) {
      return validation.reason === 'incomplete_profile'
        ? AcademicCalendarService.INCOMPLETE_PROFILE_MESSAGE
        : AcademicCalendarService.INVALID_OR_MISSING_COMMISSION_MESSAGE;
    }
    const { weekday } = getLocalDateParts(currentDt);
    const dayName = weekday;
    const classes = await this.getClassesForWeekday(dayName, userId, groupId);
    const tz = getSettings().timezone || 'America/Argentina/Cordoba';
    const parts = new Intl.DateTimeFormat('es-AR', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).formatToParts(currentDt);
    const hours = Number(parts.find(p => p.type === 'hour')?.value ?? currentDt.getHours());
    const minutes = Number(parts.find(p => p.type === 'minute')?.value ?? currentDt.getMinutes());
    const nowMinutes = hours * 60 + minutes;
    const AHEAD_MINUTES = 10; // Mostrar enlace hasta 10 min antes del inicio

    const available = classes
      .map((c) => ({ ...c, start: this.parseTimeToMinutes(c.hora) }))
      .filter((c) => c.start !== null)
      .filter((c) => {
        const start = c.start as number;
        // Ventana: desde 10 min antes hasta 60 min despues del inicio
        return nowMinutes >= start - AHEAD_MINUTES && nowMinutes < start + 60;
      })
      .sort((a, b) => (a.start as number) - (b.start as number)); // la mas proxima primero

    if (!available.length) {
      return 'En este momento no hay ninguna clase en curso 🙂';
    }

    const currentClass = available[0];
    const minutesUntilStart = (currentClass.start as number) - nowMinutes;
    const statusLine = minutesUntilStart > 0
      ? `⏳ Comienza en ${minutesUntilStart} minuto${minutesUntilStart !== 1 ? 's' : ''}`
      : '🟢 Clase en curso';

    return [
      statusLine,
      `📚 Materia: ${currentClass.materia}`,
      `🕒 Horario: ${currentClass.hora}`,
      `🔗 Enlace: ${currentClass.meetLink || 'No hay enlace cargado para esta materia.'}`,
    ].join('\n');
  }

  private async formatManagedExams(userId?: string, groupId?: string): Promise<string> {
    if (userId) {
      const validation = await this.validateUserCommission(userId, groupId);
      if (!validation.valid) {
        return validation.reason === 'incomplete_profile'
          ? AcademicCalendarService.INCOMPLETE_PROFILE_MESSAGE
          : AcademicCalendarService.INVALID_OR_MISSING_COMMISSION_MESSAGE;
      }
    }
    const userCommissionId = userId ? await this.getUserCommissionId(userId, groupId) : null;
    const exams = this.filterExamsByCommission(await this.dynamicMessageService.getUpcomingExams(10, groupId), userCommissionId, Boolean(groupId));
    if (!exams.length) return '📝 Próximos exámenes:\n- No hay exámenes cargados por ahora.';

    const icons = ['📝', '📘', '📗', '📙', '📕'];
    const items: string[] = [];
    for (let index = 0; index < exams.length; index += 1) {
      const exam = exams[index];
      const icon = icons[index % icons.length];
      const date = exam.exam_date instanceof Date ? exam.exam_date.toISOString().slice(0, 10) : String(exam.exam_date);
      items.push(`${icon} ${exam.subject}\n📅 Fecha: ${date}\n⏰ Hora: ${exam.exam_time}\n🏷️ Tipo: ${exam.exam_type}\n🗒️ Observaciones: ${exam.observations}`);
    }

    return ['📝 Próximos exámenes:', ...items].join('|||SPLIT|||');
  }

  private async resolveSenderInfo(sourceEmail?: string): Promise<{ name: string; email: string }> {
    const defaultInfo = { name: 'Institucional', email: sourceEmail || 'institucional@ispc.edu.ar' };
    if (!sourceEmail) {
      return defaultInfo;
    }
    const db = (this.reminderRepository as any).db;
    const emailLower = sourceEmail.toLowerCase().trim();
    try {
      // 1. Search in user_profiles
      const profile = await get<{ name: string }>(
        db,
        'SELECT name FROM user_profiles WHERE LOWER(email) = ? LIMIT 1',
        [emailLower]
      );
      if (profile?.name) {
        return { name: profile.name, email: sourceEmail };
      }
      // 2. Search in managed_teachers
      const teacher = await get<{ name: string }>(
        db,
        'SELECT name FROM managed_teachers WHERE LOWER(email) = ? LIMIT 1',
        [emailLower]
      );
      if (teacher?.name) {
        return { name: teacher.name, email: sourceEmail };
      }
    } catch (err) {
      console.error('[AcademicCalendarService] Error resolving notice sender info:', err);
    }
    if (emailLower.includes('institucional') || emailLower.includes('sistema') || emailLower.includes('admin')) {
      return { name: 'Institucional', email: sourceEmail };
    }
    return { name: 'Administrador', email: sourceEmail };
  }

  private async getValidTeacherMessages(groupId?: string, userId?: string): Promise<InstitutionalNotice[]> {
    const db = (this.reminderRepository as any).db;
    if (!db) return [];

    try {
      // 1. Fetch group context entry_year
      let entryYear: number | null = null;
      if (groupId) {
        const groupRow = await get<{ entry_year: number | null }>(
          db,
          'SELECT entry_year FROM whatsapp_groups WHERE group_id = ? LIMIT 1',
          [groupId]
        );
        if (groupRow) {
          entryYear = groupRow.entry_year;
        }
      }

      // 2. Fetch user's active groups and their entry years
      const userGroupIds: string[] = [];
      const userGroupEntryYears: number[] = [];
      if (userId) {
        const userGroups = await all<{ group_id: string; entry_year: number | null }>(
          db,
          `SELECT gm.group_id, wg.entry_year 
           FROM group_memberships gm
           JOIN whatsapp_groups wg ON gm.group_id = wg.group_id
           WHERE gm.user_id = ? AND gm.is_active = 1`,
          [userId]
        );
        for (const ug of userGroups) {
          userGroupIds.push(ug.group_id);
          if (ug.entry_year !== null) {
            userGroupEntryYears.push(ug.entry_year);
          }
        }
      }

      // 3. Fetch recent teacher messages (joined with managed_teachers for subject)
      const rows = await all<any>(
        db,
        `SELECT m.*, t.subject 
         FROM teacher_messages m 
         LEFT JOIN managed_teachers t ON LOWER(m.author_id) = LOWER(t.email)
         ORDER BY m.created_at DESC LIMIT 100`
      );

      const now = new Date();
      const today = new Date(now.toISOString().slice(0, 10));
      const validNotices: InstitutionalNotice[] = [];

      for (const row of rows) {
        // Parse UTC created_at to local date context safely
        const rawDateStr = String(row.created_at || '');
        const datePart = rawDateStr.includes(' ') ? rawDateStr.replace(' ', 'T') + 'Z' : rawDateStr;
        const publishedDate = row.created_at ? new Date(datePart) : new Date();
        const publishedDayOnly = new Date(publishedDate.toISOString().slice(0, 10));

        // Weekly expiration logic: active until Monday at 00:00 of the following calendar week
        const startDay = publishedDayOnly.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const daysToMonday = startDay === 1 ? 7 : (8 - startDay) % 7;
        const expiration = new Date(publishedDayOnly);
        expiration.setDate(expiration.getDate() + daysToMonday);

        if (today >= expiration) {
          continue; // Expired
        }

        // Audience target validation
        let isForAudience = false;
        if (groupId) {
          if (row.target_id === groupId) {
            isForAudience = true;
          } else if (row.target_type === 'cohort' && entryYear !== null) {
            const cohortVal = row.target_id.replace('camada:', '');
            if (String(cohortVal) === String(entryYear)) {
              isForAudience = true;
            }
          }
        } else if (userId) {
          if (userGroupIds.includes(row.target_id)) {
            isForAudience = true;
          } else if (row.target_type === 'cohort') {
            const cohortVal = row.target_id.replace('camada:', '');
            if (userGroupEntryYears.some(ey => String(ey) === String(cohortVal))) {
              isForAudience = true;
            }
          }
        }

        if (isForAudience) {
          const subjectName = row.subject || 'Materia';
          validNotices.push({
            title: `Mensaje de Profesor: ${subjectName}`,
            body: row.content,
            published_at: publishedDate,
            start_date: publishedDayOnly,
            end_date: expiration,
            source_email: row.author_id,
            unique_hash: `teacher-msg-${row.id}`,
            grupo_selector: row.target_id,
          });
        }
      }

      return validNotices;
    } catch (err) {
      console.error('[AcademicCalendarService] Error fetching valid teacher messages:', err);
      return [];
    }
  }

  private async formatInstitutionalNotices(groupId?: string, userId?: string): Promise<string> {
    const rawNotices = await this.dynamicMessageService.getValidNotices(100);
    const notices = await this.filterNoticesByAudience(rawNotices, groupId);
    const teacherNotices = await this.getValidTeacherMessages(groupId, userId);
    const allNotices = [...notices, ...teacherNotices];

    // Sort by publication date (published_at or start_date) descending
    allNotices.sort((a, b) => {
      const dateA = a.published_at || a.start_date || new Date(0);
      const dateB = b.published_at || b.start_date || new Date(0);
      return dateB.getTime() - dateA.getTime();
    });

    if (!allNotices.length) return '📢 Avisos vigentes...\n- No hay avisos cargados por ahora.';

    const icons = ['📢', '📣', '🔔', '📌', '📰'];
    const items: string[] = [];
    const displayNotices = allNotices.slice(0, 10);

    for (let index = 0; index < displayNotices.length; index += 1) {
      const notice = displayNotices[index];
      const icon = icons[index % icons.length];
      const sender = await this.resolveSenderInfo(notice.source_email);
      const dateVal = notice.published_at || notice.start_date;
      const dateStr = dateVal ? formatLocalDateOnly(dateVal) : '';

      let msg = `${icon} ${notice.title}\n` +
                `fecha: ${dateStr}\n` +
                `De: ${sender.name}\n` +
                `email: ${sender.email}\n\n` +
                `${notice.body}`;

      if (notice.end_date) {
        msg += `\n⚠️ Tienes hasta el ${formatLocalDateOnly(notice.end_date)} para realizar esta actividad`;
      }
      items.push(msg);
    }
    return ['📢 Avisos vigentes:', ...items].join('|||SPLIT|||');
  }

  private async formatWeekEvents(userId: string, currentDt: Date, offsetDays: number, groupId?: string): Promise<string> {
    const validation = await this.validateUserCommission(userId, groupId);
    if (!validation.valid) {
      return validation.reason === 'incomplete_profile'
        ? AcademicCalendarService.INCOMPLETE_PROFILE_MESSAGE
        : AcademicCalendarService.INVALID_OR_MISSING_COMMISSION_MESSAGE;
    }
    const rawNotices = await this.dynamicMessageService.getValidNotices(100);
    const notices = await this.filterNoticesByAudience(rawNotices, groupId);
    const teacherNotices = await this.getValidTeacherMessages(groupId, userId);
    const allNotices = [...notices, ...teacherNotices];
    const userCommissionId = await this.getUserCommissionId(userId, groupId);
    const exams = this.filterExamsByCommission(await this.dynamicMessageService.getUpcomingExams(100, groupId), userCommissionId, Boolean(groupId));
    const start = new Date(currentDt);
    start.setDate(start.getDate() + offsetDays);
    const monday = new Date(start);
    const { weekday: mondayWeekday } = getLocalDateParts(monday);
    const DAY_INDEXES: Record<string, number> = {
      domingo: 0,
      lunes: 1,
      martes: 2,
      miercoles: 3,
      jueves: 4,
      viernes: 5,
      sabado: 6
    };
    const day = DAY_INDEXES[mondayWeekday] !== undefined ? DAY_INDEXES[mondayWeekday] : monday.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    monday.setDate(monday.getDate() + diff);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const reminders = await this.reminderRepository.listByDateRange(monday, sunday);
    const reminderByDate = new Map<string, string[]>();
    for (const r of reminders) {
      const key = this.formatLocalDateKey(r.event_date);
      const arr = reminderByDate.get(key) || [];
      arr.push(`Recordatorio (${r.event_type}): ${r.description}`);
      reminderByDate.set(key, arr);
    }

    const dayIcon = '📅';
    const daysData = await Promise.all(
      Array.from({ length: 7 }, async (_, i) => {
        const dayDt = new Date(monday);
        dayDt.setDate(monday.getDate() + i);
        const { weekday: dayName } = getLocalDateParts(dayDt);
        const dayClasses = await this.getClassesForWeekday(dayName, userId, groupId);
        return { dayDt, dayName, dayClasses };
      })
    );

    const lines: string[] = [];
    for (const { dayDt, dayName, dayClasses } of daysData) {
      const dayExams = exams.filter((e) => this.isSameCalendarDay(e.exam_date, dayDt));
      const remindersList = reminderByDate.get(dayDt.toISOString().slice(0, 10)) || [];

      // Construir lista estructurada para ordenar por hora cuando exista
      const structured: Array<{ time: string | null; text: string }> = [];

      dayClasses.forEach((c) => structured.push({ time: c.hora || null, text: `Clase ${c.hora} ${c.materia}` }));

      dayExams.forEach((e) => {
        const time = (e.horaInicio || e.exam_time || '') as string;
        const text = `Examen ${time ? time + ' ' : ''}${e.subject} (${e.exam_type})`;
        structured.push({ time: time || null, text });
      });

      for (const n of allNotices) {
        const title = String((n as any).title || 'Aviso');
        const m = title.match(/^(\d{1,2}:\d{2})\s*(.*)$/);
        const time = m ? m[1] : null;
        const cleanTitle = m ? m[2] : title;

        if (n.start_date && this.isSameCalendarDay(n.start_date, dayDt)) {
          structured.push({ time, text: `Aviso ISPC: Inicio: ${cleanTitle}` });
        }
        if (n.end_date && this.isSameCalendarDay(n.end_date, dayDt)) {
          structured.push({ time, text: `Aviso ISPC: Límite: ${cleanTitle}` });
        }
      }

      remindersList.forEach((r) => {
        const textRaw = String(r);
        const m = textRaw.match(/^(\d{1,2}:\d{2})\s*(.*)$/);
        if (m) structured.push({ time: m[1], text: m[2] });
        else structured.push({ time: null, text: textRaw });
      });

      // Ordenar: los que tienen hora primero por HH:MM, luego los sin hora alfabeticamente
      structured.sort((a, b) => {
        if (a.time && b.time) return a.time.localeCompare(b.time);
        if (a.time) return -1;
        if (b.time) return 1;
        return a.text.localeCompare(b.text);
      });

      const label = this.formatLocalDateKey(dayDt);
      const header = `${dayIcon} ${dayName} ${label}`;

      if (!structured.length) {
        lines.push(`${header}\n- Sin eventos.`);
        continue;
      }

      const eventLines = structured.map((ev) => `- ${ev.time ? ev.time + ' ' : ''}${ev.text}`);
      lines.push(`${header}\n${eventLines.join('\n')}`);
    }

    const heading = offsetDays === 0 ? 'Agenda de esta semana' : 'Agenda de la semana que viene';
    return [`🗓️ ${heading}`, ...lines].join('|||SPLIT|||');
  }

  private loadMenus(): Record<string, MenuNode> | null {
    return GENERAL_MENU_TREE;
  }

  private async renderNode(menuTree: Record<string, MenuNode>, nodeName: string, userId?: string, groupId?: string): Promise<string> {
    const node = menuTree[nodeName];
    if (!node) return 'No hay contenido para este menu.';
    return this.resolveTemplate(String(node.mensaje || 'No hay contenido para este menu.'), node, userId, groupId);
  }

  private async renderFallbackMenu(userId: string): Promise<string> {
    const profile = await this.userProfileRepository.get(userId);
    const displayName = profile?.name?.trim();
    const greeting = displayName ? `Hola, ${displayName} 👋` : 'Hola 👋';
    return [
      '¡Hola! Soy Vectorito, el asistente virtual del grupo 🤖.',
      greeting,
      '',
      '¿En qué te puedo ayudar hoy?',
      '',
      '1 - Fechas útiles del calendario académico',
      '2 - Comunicarse con ISPC / contactos',
      '3 - Noticias y novedades',
      '4 - Avisos institucionales',
      '5 - Próximos exámenes',
      '6 - Enlace de la clase en curso',
      '7 - Ayuda y comandos disponibles',
      '',
      'También podés usar comandos rápidos: !hoy, !semana, !enlace, !noticias, !help',
    ].join('\n');
  }

  private async resolveTemplate(template: string, node: MenuNode, userId?: string, groupId?: string): Promise<string> {
    let rendered = template;

    // Nombre del usuario personalizado
    if (/\{\{\s*nombre_usuario\s*\}\}/i.test(rendered) && userId) {
      const profile = await this.userProfileRepository.get(userId);
      const displayName = profile?.name?.trim() || 'amigo';
      rendered = rendered.replace(/\{\{\s*nombre_usuario\s*\}\}/gi, displayName);
    } else if (/\{\{\s*nombre_usuario\s*\}\}/i.test(rendered)) {
      rendered = rendered.replace(/\{\{\s*nombre_usuario\s*\}\}/gi, '');
    }

    const helpRandom = this.pickRandom([
      'Te acompaño paso a paso 😊',
      'Vamos por partes, asi es mas facil 🙌',
      'Si te trabas, escribi !menu y arrancamos de nuevo.',
    ]);
    const nextOptionKeys = node.opciones ? Object.keys(node.opciones) : [];
    const hasRealOptions = nextOptionKeys.some((key) => {
      const value = String(node.opciones?.[key] || '').toLowerCase();
      // Ignorar '0', 'volver', 'menu', 'inicio' como opciones reales para el CTA
      const isNav = key === '0' || /volver|menu|inicio/.test(key) || /volver|menu|inicio/.test(value);
      return !isNav;
    });

    const ctaRandom = hasRealOptions ? this.pickRandom([
      'Elegi una opcion enviando solo el numero.',
      'Responde con el numero de la opcion que quieras.',
      'Mandame el numero y te llevo directo.',
    ]) : '';

    rendered = rendered
      .replace(/\{\{\s*frase_ayuda_random\s*\}\}/gi, helpRandom)
      .replace(/\{\{\s*cta_random\s*\}\}/gi, ctaRandom)
      .replace(/\{\{\s*cita_random\s*\}\}/gi, ctaRandom);

    if (/\{\{\s*lista_links_noticias\s*\}\}/i.test(rendered)) {
      const newsText = await this.dynamicMessageService.getNews(3, false);
      rendered = rendered.replace(/\{\{\s*lista_links_noticias\s*\}\}/gi, newsText);
    }

    if (/\{\{\s*avisos_dinamico\s*\}\}/i.test(rendered)) {
      const noticesText = await this.formatInstitutionalNotices(groupId);
      rendered = rendered.replace(/\{\{\s*avisos_dinamico\s*\}\}/gi, noticesText);
    }

    if (/\{\{\s*examenes_dinamico\s*\}\}/i.test(rendered)) {
      const examsText = await this.formatManagedExams(userId, groupId);
      rendered = rendered.replace(/\{\{\s*examenes_dinamico\s*\}\}/gi, examsText);
    }

    if (/\{\{\s*calendario_academico_dinamico\s*\}\}/i.test(rendered)) {
      rendered = rendered.replace(/\{\{\s*calendario_academico_dinamico\s*\}\}/gi, this.formatAcademicCalendar(node));
    }

    if (/\{\{\s*lista_profes_dinamica\s*\}\}/i.test(rendered)) {
      rendered = rendered.replace(/\{\{\s*lista_profes_dinamica\s*\}\}/gi, await this.formatTeachers(groupId));
    }

    if (/\{\{\s*feriados_dinamico\s*\}\}/i.test(rendered)) {
      rendered = rendered.replace(/\{\{\s*feriados_dinamico\s*\}\}/gi, this.formatHolidays(node));
    }

    return rendered;
  }

  private formatAcademicCalendar(node: MenuNode): string {
    const sections = node.eventos || {};
    const lines = ['📆 Calendario academico:'];

    for (const [sectionName, events] of Object.entries(sections)) {
      lines.push(`\n${sectionName.replace(/_/g, ' ')}:`);
      for (const event of events || []) {
        if (event.fecha_fin) {
          lines.push(`- ${this.formatIsoDateText(event.fecha)} a ${this.formatIsoDateText(event.fecha_fin)}: ${event.nombre}`);
        } else {
          lines.push(`- ${this.formatIsoDateText(event.fecha)}: ${event.nombre}`);
        }
      }
    }

    if (lines.length === 1) {
      lines.push('- No hay eventos cargados.');
    }

    return lines.join('\n');
  }

  private formatHolidays(node: MenuNode): string {
    const holidays = node.feriados_lista || [];
    if (!holidays.length) return 'Feriados: no hay feriados cargados.';

    const today = new Date();
    const tz = getSettings().timezone || 'America/Argentina/Cordoba';
    const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(today);
    const upcoming = holidays.filter((h) => {
      return h.fecha >= todayStr;
    });

    if (!upcoming.length) {
      return '🎉 Feriados que aun no pasaron:\n- No quedan feriados pendientes en el calendario cargado.';
    }

    const lines = ['🎉 Feriados que aun no pasaron:'];
    for (const holiday of upcoming) {
      lines.push(`- ${this.formatIsoDateText(holiday.fecha)}: ${holiday.nombre}`);
    }
    return lines.join('\n');
  }

  private async formatTeachers(groupId?: string): Promise<string> {
    const teachers = await this.managedTeacherRepository.listWithIds(50, groupId);
    if (!teachers.length) {
      return 'No hay profesores cargados. ¡Pidele al admin que cargue los emails!';
    }

    const lines = ['Profesores cargados:'];
    for (const entry of teachers) {
      const subjectText = entry.teacher.subject ? ` | Materia: ${entry.teacher.subject}` : '';
      lines.push(`- ${entry.teacher.name} <${entry.teacher.email}>${subjectText}`);
    }
    return lines.join('\n');
  }

  private parseIsoDate(value: string): Date | null {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const dt = new Date(year, month - 1, day);
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  }

  private formatIsoDateText(value: string): string {
    const dt = this.parseIsoDate(value);
    if (!dt) return value;
    const monthName = MONTH_NAMES[dt.getMonth()] || '';
    return `${dt.getDate()} de ${monthName}`;
  }

  private formatLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private pickRandom(options: string[]): string {
    if (!options.length) return '';
    const idx = Math.floor(Math.random() * options.length);
    return options[idx];
  }

  private normalizeDayName(value: string): string {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private parseTimeToMinutes(value: string): number | null {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
      return null;
    }
    return hh * 60 + mm;
  }

  private async getClassesForWeekday(dayName: string, userId?: string, groupId?: string): Promise<Array<{ hora: string; materia: string; meetLink: string }>> {
    // Usar ClassCommissionSchedule cuando exista
    const userCommissionId = userId ? await this.getUserCommissionId(userId, groupId) : null;

    // Si tenemos schedules en la BD y la repo correspondiente, preferirlos
    if (this.classCommissionScheduleRepository) {
      // 1) Si usuario tiene comision, listar schedules para esa comision
      if (userCommissionId !== null) {
        const schedules = await this.classCommissionScheduleRepository.listByCommissionAndDay(userCommissionId, dayName);
        if (schedules.length) {
          const mapped = await Promise.all(schedules.map(async (s) => {
            const mc = await this.managedClassRepository.getById(s.managed_class_id);
            if (!mc) return null;
            return {
              hora: s.schedule_time,
              materia: mc.subject,
              meetLink: s.meet_link || mc.meet_link || '',
              group_id: mc.group_id || null,
            };
          }));
          const filteredMapped = mapped.filter((item) => {
            if (!item) return false;
            if (groupId && item.group_id && item.group_id !== groupId) return false;
            return true;
          }) as Array<{ hora: string; materia: string; meetLink: string }>;
          return filteredMapped.sort((a, b) => a.hora.localeCompare(b.hora));
        }
      }

      // 2) Si estamos en contexto grupal, listar schedules de todas las comisiones del grupo
      if (groupId) {
        const groupContext = this.groupContextRepository ? await this.groupContextRepository.getByGroupId(groupId) : null;
        if (groupContext && typeof groupContext.id === 'number' && this.groupContextRepository && this.classCommissionScheduleRepository) {
          const commissions = await this.groupContextRepository.listCommissionsForGroupContext(groupContext.id);
          if (commissions.length > 0) {
            const allSchedules = await Promise.all(
              commissions
                .filter((c) => typeof c.id === 'number')
                .map((c) => this.classCommissionScheduleRepository!.listByCommissionAndDay(c.id as number, dayName)),
            );

            const flattened = allSchedules.flat();
            if (flattened.length) {
              const mapped = await Promise.all(flattened.map(async (s) => {
                const mc = await this.managedClassRepository.getById(s.managed_class_id);
                if (!mc) return null;
                return {
                  hora: s.schedule_time,
                  materia: mc.subject,
                  meetLink: s.meet_link || mc.meet_link || '',
                  group_id: mc.group_id || null,
                };
              }));
              const filteredMapped = mapped.filter((item) => {
                if (!item) return false;
                if (item.group_id && item.group_id !== groupId) return false;
                return true;
              }) as Array<{ hora: string; materia: string; meetLink: string }>;
              return filteredMapped.sort((a, b) => a.hora.localeCompare(b.hora));
            }
          }
        }
      } else {
        // 3) Solo si NO estamos en un contexto grupal, intentamos buscar schedules globales por dia
        const globalSchedules = await this.classCommissionScheduleRepository.listByDay(dayName);
        if (globalSchedules.length) {
          const mapped = await Promise.all(globalSchedules.map(async (s) => {
            const mc = await this.managedClassRepository.getById(s.managed_class_id);
            if (!mc) return null;
            return {
              hora: s.schedule_time,
              materia: mc.subject,
              meetLink: s.meet_link || mc.meet_link || '',
            };
          }));
          const filteredMapped = mapped.filter(Boolean) as Array<{ hora: string; materia: string; meetLink: string }>;
          return filteredMapped.sort((a, b) => a.hora.localeCompare(b.hora));
        }
      }
    }

    // Fallback: comportamiento legacy con managed_classes + filter por comision si aplica
    const all = await this.managedClassRepository.listAll(groupId);
    const filtered = this.filterClassesByCommission(all, userCommissionId, Boolean(groupId));
    return filtered
      .filter((c) => this.normalizeDayName(c.schedule_day) === this.normalizeDayName(dayName))
      .sort((a, b) => a.schedule_time.localeCompare(b.schedule_time))
      .map((c) => ({ hora: c.schedule_time, materia: c.subject, meetLink: c.meet_link }));
  }

  private async getUserCommissionId(userId: string, groupId?: string): Promise<number | null> {
    const impersonation = PrivateChatWorkflowService.getImpersonation(userId);
    if (impersonation.isActive && impersonation.commissionId !== null) {
      return impersonation.commissionId;
    }

    // 1) Try to get commission from group membership first (specific to this user in this group)
    if (groupId && this.groupMembershipRepository) {
      try {
        const membership = await this.groupMembershipRepository.getMembership(groupId, userId);
        if (membership?.commission_id) {
          return membership.commission_id;
        }
      } catch (err) {
        // ignore
      }
    }

    // 2) Try to get commission from group context first (multi-tenant aware)
    if (groupId && this.groupContextRepository) {
      try {
        const groupContext = await this.groupContextRepository.getByGroupId(groupId);
        if (groupContext?.commission_id) {
          return groupContext.commission_id;
        }

        if (groupContext && typeof groupContext.id === 'number') {
          const commissions = await this.groupContextRepository.listCommissionsForGroupContext(groupContext.id);
          if (commissions.length === 1 && typeof commissions[0].id === 'number') {
            return commissions[0].id;
          }
        }
      } catch (err) {
        // ignore
      }
    }

    // 3) Fall back to user profile commission
    const profile = await this.userProfileRepository.get(userId);
    if (typeof profile?.user_commission_id !== 'number') {
      return null;
    }
    return profile.user_commission_id;
  }

  private async validateUserCommission(userId: string, groupId?: string): Promise<{ valid: boolean; reason: 'incomplete_profile' | 'missing_commission' | 'invalid_commission' | null }> {
    const impersonation = PrivateChatWorkflowService.getImpersonation(userId);
    if (impersonation.isActive && impersonation.commissionId !== null) {
      if (groupId && this.groupContextRepository) {
        const groupContext = await this.groupContextRepository.getByGroupId(groupId);
        if (groupContext && typeof groupContext.id === 'number') {
          const commissions = await this.groupContextRepository.listCommissionsForGroupContext(groupContext.id);
          if (commissions.length > 1) {
            const belongs = commissions.some((c) => c.id === impersonation.commissionId);
            if (!belongs) {
              return { valid: false, reason: 'invalid_commission' };
            }
          }
        }
      }
      return { valid: true, reason: null };
    }

    if (groupId && this.groupContextRepository) {
      const groupContext = await this.groupContextRepository.getByGroupId(groupId);
      if (groupContext && typeof groupContext.id === 'number') {
        const commissions = await this.groupContextRepository.listCommissionsForGroupContext(groupContext.id);
        if (commissions.length > 1) {
          const profile = await this.userProfileRepository.get(userId);
          if (!profile || !profile.name?.trim() || !profile.birthday_day_month?.trim() || !profile.email?.trim()) {
            return { valid: false, reason: 'incomplete_profile' };
          }

          const commissionId = await this.getUserCommissionId(userId, groupId);
          if (commissionId === null) {
            return { valid: false, reason: 'missing_commission' };
          }

          const belongs = commissions.some((c) => c.id === commissionId);
          if (!belongs) {
            return { valid: false, reason: 'invalid_commission' };
          }

          if (this.commissionRepository) {
            const exists = await this.commissionRepository.getById(commissionId);
            if (!exists) {
              return { valid: false, reason: 'invalid_commission' };
            }
          }
        }
      }
    }

    return { valid: true, reason: null };
  }

  private filterClassesByCommission(classes: ManagedClass[], userCommissionId: number | null, strictScope = false): ManagedClass[] {
    // Sin comisión de usuario, mostrar todo para evitar bloquear comandos.
    if (userCommissionId === null) {
      return classes;
    }

    return classes.filter((c) => c.commission_count === 1 || c.commission_count === userCommissionId);
  }

  private filterExamsByCommission(exams: ManagedExam[], userCommissionId: number | null, strictScope = false): ManagedExam[] {
    // Sin comisión o examen global, no filtrar.
    if (userCommissionId === null) {
      return exams;
    }

    return exams.filter((e) => e.exam_commission_id === undefined || e.exam_commission_id === null || e.exam_commission_id === userCommissionId);
  }

  private async getValidNoticesForDay(day: Date, groupId?: string): Promise<Array<{ title: string; body: string }>> {
    const rawNotices = await this.dynamicMessageService.getValidNotices(100);
    const notices = await this.filterNoticesByAudience(rawNotices, groupId);
    const teacherNotices = await this.getValidTeacherMessages(groupId, undefined);
    const allNotices = [...notices, ...teacherNotices];
    return allNotices
      .filter((n) => this.isNoticeActiveOn(n, day))
      .map((n) => ({ title: n.title, body: n.body }));
  }

  private async filterNoticesByAudience(notices: InstitutionalNotice[], groupId?: string): Promise<InstitutionalNotice[]> {
    let entryYear: number | null = null;
    let hasGroupRow = false;
    if (groupId) {
      const db = (this.reminderRepository as any).db;
      try {
        const groupRow = await get<{ entry_year: number | null }>(
          db,
          'SELECT entry_year FROM whatsapp_groups WHERE group_id = ? LIMIT 1',
          [groupId]
        );
        if (groupRow) {
          entryYear = groupRow.entry_year;
          hasGroupRow = true;
        }
      } catch (err) {
        console.error('[AcademicCalendarService] Error fetching group entry_year for audience filtering:', err);
      }
    }

    return notices.filter((n) => {
      // Private chat: only show notices directed to "todos" / "all"
      if (!groupId) {
        return n.grupo_selector === 'todos' || n.grupo_selector === 'all';
      }

      // Direct JID match
      if (n.grupo_selector === groupId) return true;
      if (n.grupo_selector === 'todos' || n.grupo_selector === 'all') return true;

      // Cursada vs General match
      const isCursada = hasGroupRow && entryYear !== null;
      if (n.grupo_selector === 'general' && !isCursada) return true;
      if (n.grupo_selector === 'cursada' && isCursada) return true;

      // Camada match
      if (hasGroupRow && entryYear && n.grupo_selector === `camada:${entryYear}`) return true;

      return false;
    });
  }

  private async getExamsForDay(day: Date, userId?: string, groupId?: string): Promise<Array<{ subject: string; exam_time: string; exam_type: string }>> {
    const userCommissionId = userId ? await this.getUserCommissionId(userId, groupId) : null;
    const exams = this.filterExamsByCommission(await this.dynamicMessageService.getUpcomingExams(100, groupId), userCommissionId, Boolean(groupId));
    return exams
      .filter((e) => this.isSameCalendarDay(e.exam_date, day))
      .map((e) => ({ subject: e.subject, exam_time: e.exam_time, exam_type: e.exam_type }));
  }

  private async isGroupAcademicallyConfigured(groupId: string): Promise<boolean> {
    if (!this.groupContextRepository) return true;

    try {
      const groupContext = await this.groupContextRepository.getByGroupId(groupId);
      if (!groupContext || typeof groupContext.year !== 'number') return false;

      if (typeof groupContext.commission_id === 'number') return true;
      if (typeof groupContext.id !== 'number') return false;

      const commissions = await this.groupContextRepository.listCommissionsForGroupContext(groupContext.id);
      return commissions.length > 0;
    } catch {
      return false;
    }
  }

  private isSameCalendarDay(left: Date, right: Date): boolean {
    return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  }

  private isNoticeActiveOn(notice: { start_date?: Date; end_date?: Date }, day: Date): boolean {
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());

    if (notice.end_date) {
      const end = new Date(notice.end_date.getFullYear(), notice.end_date.getMonth(), notice.end_date.getDate());
      if (end < dayStart) {
        return false;
      }
    }

    if (notice.start_date) {
      const start = new Date(notice.start_date.getFullYear(), notice.start_date.getMonth(), notice.start_date.getDate());
      if (start > dayStart) {
        return false;
      }

      if (!notice.end_date) {
        const expires = new Date(start);
        expires.setDate(expires.getDate() + 7);
        return expires >= dayStart;
      }
    }

    return true;
  }
}
