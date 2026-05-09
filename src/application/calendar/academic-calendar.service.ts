import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { DynamicMessageService } from '../messages/dynamic-message.service.js';
import { ModerationAdminCommandService } from '../moderation/moderation-admin-command.service.js';
import { AdminLoggingCommandService } from '../admin/admin-logging-command.service.js';
import { DashboardPanelService } from '../admin/dashboard-panel.service.js';
import { MenuPersistenceService } from './menu-persistence.service.js';
import { ExamMenuService } from './exam-menu.service.js';
import { EditExamMenuService } from './edit-exam-menu.service.js';
import { RemoveNotificationMenuService } from './remove-notification-menu.service.js';
import { ManagedClass, ManagedExam } from '../../domain/models.js';
import {
  ManagedClassRepository,
  ManagedExamRepository,
  ManagedTeacherRepository,
  ReminderRepository,
  UserProfileRepository,
} from '../../infrastructure/persistence/db/repositories.js';
import { LoggingService } from '../../infrastructure/logging/logging.service.js';

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

type MenuNode = {
  mensaje: string;
  opciones?: Record<string, string>;
  eventos?: Record<string, Array<{ fecha: string; fecha_fin?: string; nombre: string }>>;
  feriados_lista?: Array<{ fecha: string; nombre: string }>;
};

export class AcademicCalendarService {
  private menuStateByUser = new Map<string, string>();
  private menusPath: string;
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
    private examMenuService?: ExamMenuService,
    private editExamMenuService?: EditExamMenuService,
    private removeNotificationMenuService?: RemoveNotificationMenuService,
    private managedExamRepository?: ManagedExamRepository,
    private loggingService?: LoggingService,
  ) {
    this.menusPath = this.resolveDataFilePath('menus.json');

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

  public async handleCommand(userId: string, commandText: string, now?: Date, isAdmin = false): Promise<string | null> {
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
      return this.handleMenuInput(userId, resolvedCommand);
    }

    if (resolvedCommand === '!hoy' || resolvedCommand === '!clases') {
      return this.formatDay(currentNow);
    }

    if (resolvedCommand === '!examenes') {
      return this.formatManagedExams(userId);
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
      return this.formatWeekEvents(userId, currentNow, 0);
    }

    if (resolvedCommand === '!semana-que-viene') {
      return this.formatWeekEvents(userId, currentNow, 7);
    }

    if (resolvedCommand === '!enlace') {
      return this.formatCurrentClassLink(userId, currentNow);
    }

    if (resolvedCommand === '!avisos') {
      return this.formatInstitutionalNotices();
    }

    if (resolvedCommand === '!noticias') {
      return this.dynamicMessageService.getNews(5, false);
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

  public async handleMenuInput(userId: string, rawText: string): Promise<string | null> {
    const normalized = rawText.trim().toLowerCase();
    const isMenuCommand = normalized === '!menu' || normalized === '!m';

    // NUEVO: Procesar flujos de exámenes si el usuario está en uno
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

    const menuTree = this.loadMenus();
    if (!menuTree) {
      if (isMenuCommand) {
        return this.renderFallbackMenu(userId);
      }
      return null;
    }

    if (isMenuCommand) {
      this.menuStateByUser.set(userId, 'inicio');
      return this.renderNode(menuTree, 'inicio', userId);
    }

    const currentNode = this.menuStateByUser.get(userId);
    if (!currentNode) return null;

    const node = menuTree[currentNode];
    const hasOptions = !!node?.opciones && Object.keys(node.opciones).length > 0;
    if (!node || !hasOptions) {
      this.menuStateByUser.delete(userId);
      return null;
    }

    const options = node.opciones as Record<string, string>;

    const nextNode = options[normalized];
    if (!nextNode) {
      // Solo retornar "opción inválida" si realmente hay un menú activo
      // Si no hay opción válida y es un número, indicar error
      if (/^\d+$/.test(normalized)) {
        return 'Opcion invalida. Elegi una opcion del menu o escribi !menu para volver al inicio.';
      }
      return null;
    }

    const next = menuTree[nextNode];
    const nextHasOptions = !!next?.opciones && Object.keys(next.opciones).length > 0;
    const nextOptionKeys = next?.opciones ? Object.keys(next.opciones) : [];
    const navigationalOnly = nextOptionKeys.length > 0 && nextOptionKeys.every((key) => {
      const value = String(next?.opciones?.[key] || '').toLowerCase();
      return key === '0' || /volver|menu|inicio/.test(key) || /volver|menu|inicio/.test(value);
    });
    const promptText = String(next?.mensaje || '').toLowerCase();
    const asksForChoice = /(elegi|elegí|selecciona|seleccioná|mandame el numero|mandame el número|que necesitás|qué necesitás|que querés|qué querés|opcion|opción)/i.test(promptText) || /\d️⃣/.test(promptText);
    const keepState = nextHasOptions && !navigationalOnly && asksForChoice;

    // Debug logging
    const debugMsg = `📌 Menu flow: userId=${userId.slice(-5)}, current=${currentNode}, selected=${normalized}, next=${nextNode}, hasOptions=${nextHasOptions}, navigationalOnly=${navigationalOnly}`;
    if (keepState) {
      console.log(`${debugMsg} -> MANTENER estado`);
      this.menuStateByUser.set(userId, nextNode);
    } else {
      console.log(`${debugMsg} -> LIMPIAR estado`);
      this.menuStateByUser.delete(userId);
    }

    return this.renderNode(menuTree, nextNode, userId);
  }

  private async formatDay(currentDt: Date): Promise<string> {
    const dayName = DAY_NAMES[currentDt.getDay()] || 'dia';
    const dateStr = `${currentDt.getDate()} de ${MONTH_NAMES[currentDt.getMonth()]}`;
    const classes = await this.getClassesForWeekday(dayName);
    const notices = await this.getValidNoticesForDay(currentDt);
    const exams = await this.getExamsForDay(currentDt);

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

  private async formatCurrentClassLink(userId: string, currentDt: Date): Promise<string> {
    const dayName = DAY_NAMES[currentDt.getDay()] || 'dia';
    const classes = await this.getClassesForWeekday(dayName, userId);
    const nowMinutes = currentDt.getHours() * 60 + currentDt.getMinutes();
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

  private async formatManagedExams(userId?: string): Promise<string> {
    const userCommissionId = userId ? await this.getUserCommissionId(userId) : null;
    const exams = this.filterExamsByCommission(await this.dynamicMessageService.getUpcomingExams(10), userCommissionId);
    if (!exams.length) return '📝 Próximos exámenes:\n- No hay exámenes cargados por ahora.';

    const icons = ['📝', '📘', '📗', '📙', '📕'];
    const items: string[] = [];
    for (let index = 0; index < exams.length; index += 1) {
      const exam = exams[index];
      const icon = icons[index % icons.length];
      const date = exam.exam_date.toISOString().slice(0, 10);
      items.push(`${icon} ${exam.subject}\n📅 Fecha: ${date}\n⏰ Hora: ${exam.exam_time}\n🏷️ Tipo: ${exam.exam_type}\n🗒️ Observaciones: ${exam.observations}`);
    }

    return ['📝 Próximos exámenes:', ...items].join('|||SPLIT|||');
  }

  private async formatInstitutionalNotices(): Promise<string> {
    const notices = await this.dynamicMessageService.getValidNotices(10);
    if (!notices.length) return '📢 Avisos vigentes...\n- No hay avisos cargados por ahora.';

    const icons = ['📢', '📣', '🔔', '📌', '📰'];
    const items: string[] = [];
    for (let index = 0; index < notices.length; index += 1) {
      const notice = notices[index];
      const icon = icons[index % icons.length];
      items.push(`${icon} ${notice.title}\n${notice.body}`);
    }
    return ['📢 Avisos vigentes:', ...items].join('|||SPLIT|||');
  }

  private async formatWeekEvents(userId: string, currentDt: Date, offsetDays: number): Promise<string> {
    const allClasses = await this.managedClassRepository.listAll();
    const notices = await this.dynamicMessageService.getValidNotices(100);
    const userCommissionId = await this.getUserCommissionId(userId);
    const filteredClasses = this.filterClassesByCommission(allClasses, userCommissionId);
    const exams = this.filterExamsByCommission(await this.dynamicMessageService.getUpcomingExams(100), userCommissionId);
    const start = new Date(currentDt);
    start.setDate(start.getDate() + offsetDays);
    const monday = new Date(start);
    const day = monday.getDay();
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
    const lines: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const dayDt = new Date(monday);
      dayDt.setDate(monday.getDate() + i);
      const dayName = DAY_NAMES[dayDt.getDay()] || 'dia';

      const dayClasses = filteredClasses
        .filter((c) => this.normalizeDayName(c.schedule_day) === this.normalizeDayName(dayName))
        .sort((a, b) => (a.schedule_time || '').localeCompare(b.schedule_time || ''));

      const dayNotices = notices.filter((n) => this.isNoticeActiveOn(n, dayDt));
      const dayExams = exams.filter((e) => this.isSameCalendarDay(e.exam_date, dayDt));
      const reminders = reminderByDate.get(dayDt.toISOString().slice(0, 10)) || [];

      // Construir lista estructurada para ordenar por hora cuando exista
      const structured: Array<{ time: string | null; text: string }> = [];

      dayClasses.forEach((c) => structured.push({ time: c.schedule_time || null, text: `Clase ${c.schedule_time} ${c.subject}` }));

      dayExams.forEach((e) => {
        const time = (e.horaInicio || e.exam_time || '') as string;
        const text = `Examen ${time ? time + ' ' : ''}${e.subject} (${e.exam_type})`;
        structured.push({ time: time || null, text });
      });

      dayNotices.forEach((n) => {
        const title = String((n as any).title || 'Aviso');
        const m = title.match(/^(\d{1,2}:\d{2})\s*(.*)$/);
        if (m) structured.push({ time: m[1], text: `Aviso ISPC: ${m[2]}` });
        else structured.push({ time: null, text: `Aviso ISPC: ${title}` });
      });

      reminders.forEach((r) => {
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
    try {
      if (!fs.existsSync(this.menusPath)) {
        console.warn(`⚠️ No se encontro menus.json en: ${this.menusPath}`);
        return null;
      }
      const raw = fs.readFileSync(this.menusPath, 'utf-8');
      const parsed = JSON.parse(raw) as any;
      return parsed.bot_flujo || null;
    } catch {
      return null;
    }
  }

  private resolveDataFilePath(fileName: string): string {
    const candidates = [
      path.resolve(MODULE_DIR, '..', '..', '..', '..', 'data', fileName),
      path.resolve(MODULE_DIR, '..', '..', 'data', fileName),
      path.resolve(MODULE_DIR, '..', '..', '..', 'data', fileName),
      path.resolve(process.cwd(), 'data', fileName),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0];
  }

  private async renderNode(menuTree: Record<string, MenuNode>, nodeName: string, userId?: string): Promise<string> {
    const node = menuTree[nodeName];
    if (!node) return 'No hay contenido para este menu.';
    return this.resolveTemplate(String(node.mensaje || 'No hay contenido para este menu.'), node, userId);
  }

  private async renderFallbackMenu(userId: string): Promise<string> {
    const profile = await this.userProfileRepository.get(userId);
    const displayName = profile?.name?.trim();
    const greeting = displayName ? `Hola, ${displayName} 👋` : 'Hola 👋';

    return [
      greeting,
      'Este es tu menú rápido:',
      '!hoy o !clases - Materias de hoy',
      '!enlace - Enlace de la clase en curso',
      '!semana - Agenda de esta semana',
      '!semana-que-viene - Agenda de la próxima semana',
      '!examenes - Próximos exámenes',
      '!avisos - Avisos institucionales',
      '!noticias - Últimas noticias',
      '!help - Ayuda de comandos',
    ].join('\n');
  }

  private async resolveTemplate(template: string, node: MenuNode, userId?: string): Promise<string> {
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
      const noticesText = await this.formatInstitutionalNotices();
      rendered = rendered.replace(/\{\{\s*avisos_dinamico\s*\}\}/gi, noticesText);
    }

    if (/\{\{\s*examenes_dinamico\s*\}\}/i.test(rendered)) {
      const examsText = await this.formatManagedExams();
      rendered = rendered.replace(/\{\{\s*examenes_dinamico\s*\}\}/gi, examsText);
    }

    if (/\{\{\s*calendario_academico_dinamico\s*\}\}/i.test(rendered)) {
      rendered = rendered.replace(/\{\{\s*calendario_academico_dinamico\s*\}\}/gi, this.formatAcademicCalendar(node));
    }

    if (/\{\{\s*lista_profes_dinamica\s*\}\}/i.test(rendered)) {
      rendered = rendered.replace(/\{\{\s*lista_profes_dinamica\s*\}\}/gi, await this.formatTeachers());
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
    const todayAtMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const upcoming = holidays.filter((h) => {
      const dt = this.parseIsoDate(h.fecha);
      return dt !== null && dt.getTime() >= todayAtMidnight.getTime();
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

  private async formatTeachers(): Promise<string> {
    const teachers = await this.managedTeacherRepository.listWithIds(50);
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

  private async getClassesForWeekday(dayName: string, userId?: string): Promise<Array<{ hora: string; materia: string; meetLink: string }>> {
    const all = await this.managedClassRepository.listAll();
    const userCommissionId = userId ? await this.getUserCommissionId(userId) : null;
    const filtered = this.filterClassesByCommission(all, userCommissionId);
    return filtered
      .filter((c) => this.normalizeDayName(c.schedule_day) === this.normalizeDayName(dayName))
      .sort((a, b) => a.schedule_time.localeCompare(b.schedule_time))
      .map((c) => ({ hora: c.schedule_time, materia: c.subject, meetLink: c.meet_link }));
  }

  private async getUserCommissionId(userId: string): Promise<number | null> {
    const profile = await this.userProfileRepository.get(userId);
    if (typeof profile?.user_commission_id !== 'number') {
      return null;
    }
    return profile.user_commission_id;
  }

  private filterClassesByCommission(classes: ManagedClass[], userCommissionId: number | null): ManagedClass[] {
    // Sin comisión de usuario, mostrar todo para evitar bloquear comandos.
    if (userCommissionId === null) {
      return classes;
    }

    return classes.filter((c) => c.commission_count === 1 || c.commission_count === userCommissionId);
  }

  private filterExamsByCommission(exams: ManagedExam[], userCommissionId: number | null): ManagedExam[] {
    // Sin comisión o examen global, no filtrar.
    if (userCommissionId === null) {
      return exams;
    }

    return exams.filter((e) => e.exam_commission_id === undefined || e.exam_commission_id === userCommissionId);
  }

  private async getValidNoticesForDay(day: Date): Promise<Array<{ title: string; body: string }>> {
    const notices = await this.dynamicMessageService.getValidNotices(100);
    return notices
      .filter((n) => this.isNoticeActiveOn(n, day))
      .map((n) => ({ title: n.title, body: n.body }));
  }

  private async getExamsForDay(day: Date): Promise<Array<{ subject: string; exam_time: string; exam_type: string }>> {
    const exams = await this.dynamicMessageService.getUpcomingExams(100);
    return exams
      .filter((e) => this.isSameCalendarDay(e.exam_date, day))
      .map((e) => ({ subject: e.subject, exam_time: e.exam_time, exam_type: e.exam_type }));
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
