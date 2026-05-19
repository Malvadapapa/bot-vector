import crypto from 'crypto';
import { DynamicMessageService } from '../messages/dynamic-message.service.js';
import { ManagedExam, ManagedClassCreateInput, ManagedTeacherCreateInput, InstitutionalNotice } from '../../domain/models.js';
import {
  AdminRepository,
  AdminVerificationCodeRepository,
  InstitutionalNoticeRepository,
  ManagedExamRepository,
  ManagedClassRepository,
  ManagedTeacherRepository,
  UserModerationRepository,
  UserProfileRepository,
  GroupContextRepository,
  CommissionRepository,
} from '../../infrastructure/persistence/db/repositories.js';

interface PendingProfile {
  name?: string;
  birthday?: string;
  email?: string;
  commission?: number;
}

interface PendingClassData {
  subject?: string;
  commission_count?: number;
  schedule_day?: string;
  schedule_time?: string;
  meet_link?: string;
}

interface PendingTeacherData {
  name?: string;
  email?: string;
  subject?: string;
}

interface PendingExamData {
  subject_source?: 'en-curso' | 'otra';
  selected_class_id?: number;
  subject?: string;
  exam_commission_id?: number;
  exam_date?: Date;
  availability?: 'hora-especifica' | 'franja' | 'a-partir-de';
  exam_time?: string;
  horaInicio?: string;
  horaFin?: string;
  exam_type?: string;
  observations?: string;
}

interface PendingNoticeData {
  title?: string;
  body?: string;
  start_date?: Date;
  end_date?: Date;
}

interface PendingNoticeEditData {
  noticeId?: number;
  field?: 'title' | 'body' | 'start_date' | 'end_date';
}

interface PendingGroupContextData {
  groupId?: string;
  year?: number;
  commission_id?: number | null;
}

export class PrivateChatWorkflowService {
  private static readonly PROFILE_STATES = new Set([
    'await_user_profile_name',
    'await_user_profile_birthday',
    'await_user_profile_email',
    'await_user_commission_selection',
  ]);
  private static readonly ADMIN_MODE_HINTS = [
    'Estoy en modo admin, chango. Mandame menu y te muestro las funciones.',
    'Seguimos en modo admin. Si querés ver las opciones escribi menu.',
    'Modo admin activo, máquina. Escribí menu para ver el panel.',
  ];
  private static readonly PRIVATE_ONLY_AFTER_REGISTER = [
    'Ya quedaste registrado. Este bot responde solo en el grupo, así que te leo allá con gusto.',
    'Todo listo con tu registro ✅. Por privado ya no puedo responder consultas: te espero en el grupo del ISPC.',
    'Registro completado, querido. El bot esta programado para responder solo en el grupo, te espero por ahí.',
  ];
  private static readonly PROFILE_WELCOME_INTROS = [
    '¡Bienvenido chango! Vamos a completar tu registro por privado 🙂',
    '¡Hola! Antes de seguir, necesito completar tu registro por privado 🙂',
    '¡Ey! Te doy la bienvenida chango. Necesito que completemos tus datos por privado para seguir 🙂',
  ];
  private static readonly PROFILE_UPDATE_INTROS = [
    'Debido a una actualización del bot necesito que me mandes unos datos por privado. Muchas gracias 🙂',
    '¡Ey! Por una actualización del bot necesito que me completes algunos datos por privado. Gracias 🙂',
    'Che, se actualizó el bot y necesito que completes tus datos por privado. Gracias 🙂',
  ];

  private pendingProfiles = new Map<string, PendingProfile>();
  private pendingAdminState = new Map<string, string>();
  private pendingClassData = new Map<string, PendingClassData>();
  private pendingTeacherData = new Map<string, PendingTeacherData>();
  private pendingExamData = new Map<string, PendingExamData>();
  private pendingNoticeData = new Map<string, PendingNoticeData>();
  private pendingNoticeEditData = new Map<string, PendingNoticeEditData>();
  private pendingGroupContextData = new Map<string, PendingGroupContextData>();
  private postRegistrationWarningShown = new Set<string>();
  private profileUpdateNoticeShown = new Set<string>();
  // Contador de reintentos por campo en el registro (evitar spam loops)
  private registrationRetries = new Map<string, number>();
  // Estado para baneo manual
  private pendingBanData = new Map<string, { phone?: string; banType?: string }>();

  private static TEST_CLASS_PHRASES = [
    '¡Hola! En 10 minutos comienza la clase',
    '⏰ La clase está por comenzar en 10 min',
    '📝 Recordatorio: la clase comienza en 10 minutos',
    '¡No te la pierdas! Faltan 10 minutos para la clase',
    '🔔 Aviso: la clase comienza en 10 minutos',
  ];

  constructor(
    private userProfileRepository: UserProfileRepository,
    private adminRepository: AdminRepository,
    private adminCodeRepository: AdminVerificationCodeRepository,
    private noticesRepository: InstitutionalNoticeRepository,
    private examsRepository: ManagedExamRepository,
    private managedClassRepository: ManagedClassRepository,
    private managedTeacherRepository: ManagedTeacherRepository,
    private moderationRepository: UserModerationRepository,
    private dynamicMessageService: DynamicMessageService,
    private adminPassword: string,
    private groupContextRepository?: GroupContextRepository,
    private commissionRepository?: CommissionRepository,
  ) {}

  private isProfilePopulated(profile?: { name?: string; birthday_day_month?: string; email?: string; user_commission_id?: number } | null): boolean {
    if (!profile) return false;
    const hasName = !!String(profile.name || '').trim();
    const hasBirthday = !!String(profile.birthday_day_month || '').trim();
    const hasEmail = !!String(profile.email || '').trim();
    return hasName && hasBirthday && hasEmail;
  }

  public async handlePrivateMessage(userId: string, text: string): Promise<string> {
    const cleaned = text.trim();
    if (!cleaned) return 'Te leo, pero necesito que me mandes un mensaje con contenido 🙂';

    if (cleaned.startsWith('*')) {
      if (await this.adminRepository.isAuthenticated(userId)) {
        return 'Ya estás autenticado como admin ✅';
      }

      this.clearPendingData(userId);
      return this.handleAdminAuth(userId, cleaned.slice(1).trim());
    }

    if (cleaned.toLowerCase() === 'mequetrefe') {
      this.clearPendingData(userId);

      if (await this.adminRepository.isRegistered(userId)) {
        return 'Ya estás registrado como admin. Enviá *tu_clave para autenticarte.';
      }

      this.pendingAdminState.set(userId, 'await_admin_registration_code');
      return 'Así que te querés registrar 😏\nMandame el código de 6 dígitos.';
    }

    const profileCompletionResponse = await this.maybeHandleProfileCompletion(userId, cleaned);
    if (profileCompletionResponse !== null) return profileCompletionResponse;

    const adminResponse = await this.handleAdminFlow(userId, cleaned);
    if (adminResponse !== null) return adminResponse;

    return this.handleUserRegistrationFlow(userId, cleaned);
  }

  public async handleGroupAdminLink(userId: string, text: string): Promise<string | null> {
    const cleaned = text.trim();
    if (cleaned.toLowerCase().startsWith('!soyadmin ')) {
      const code = cleaned.substring(10).trim();
      if (!/^\d{6}$/.test(code)) {
        return 'Formato de código inválido. Debe ser de 6 dígitos.';
      }
      
      const valid = await this.adminCodeRepository.consumeIfValid(code, userId);
      if (!valid) {
        return 'Código inválido o ya fue utilizado.';
      }

      await this.adminRepository.register(userId);
      await this.adminRepository.setAuthenticated(userId, true);
      
      // Asegurar que tenga un perfil básico para no pedirle registro en el grupo
      const profile = await this.userProfileRepository.get(userId);
      if (!profile || !profile.name || !profile.birthday_day_month || !profile.email) {
        await this.userProfileRepository.upsert(
          userId, 
          profile?.name || 'Admin', 
          profile?.birthday_day_month || '01/01', 
          profile?.email || 'admin@ispc.edu.ar'
        );
      }

      return '✅ Alias de grupo vinculado exitosamente como Administrador. Ya no tenés límites diarios.';
    }
    return null;
  }

  private async maybeHandleProfileCompletion(userId: string, cleaned: string): Promise<string | null> {
    const currentState = this.pendingAdminState.get(userId);
    if (currentState && PrivateChatWorkflowService.PROFILE_STATES.has(currentState)) {
      return this.handleUserRegistrationFlow(userId, cleaned);
    }

    const profile = await this.userProfileRepository.get(userId);
    const missingFields = this.getMissingProfileFields(profile);
    if (missingFields.length > 0) {
      return this.handleUserRegistrationFlow(userId, cleaned);
    }

    return null;
  }

  private async handleAdminFlow(userId: string, cleaned: string): Promise<string | null> {
    const lowered = cleaned.toLowerCase();
    const currentState = this.pendingAdminState.get(userId);

    if (currentState === 'await_admin_registration_code') {
      return this.handleAdminRegistrationCode(userId, cleaned);
    }

    if (currentState === 'await_admin_profile_name') {
      const pending = this.pendingProfiles.get(userId) || {};
      pending.name = cleaned;
      this.pendingProfiles.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_admin_profile_birthday');
      return 'Genial. Ahora pasame tu fecha de cumpleaños (DD/MM).';
    }

    if (currentState === 'await_admin_profile_birthday') {
      const birthday = this.parseDayMonth(cleaned);
      if (!birthday) return 'No pude leer la fecha. Usa formato DD/MM.';
      const pending = this.pendingProfiles.get(userId);
      if (!pending?.name) {
        this.pendingAdminState.set(userId, 'await_admin_profile_name');
        return 'Error, no tengo tu nombre. Volvé a decírmelo:';
      }
      const dayMonth = `${String(birthday.getDate()).padStart(2, '0')}/${String(birthday.getMonth() + 1).padStart(2, '0')}`;
      pending.birthday = dayMonth;
      this.pendingProfiles.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_admin_profile_email');
      return 'Perfecto. Ahora pasame tu email institucional con el que te conectas a clase.';
    }

    if (currentState === 'await_admin_profile_email') {
      const email = cleaned.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return 'Ese email no parece valido. Revisalo y probá de nuevo.';
      }

      const pending = this.pendingProfiles.get(userId);
      if (!pending?.name || !pending?.birthday) {
        this.pendingAdminState.set(userId, 'await_admin_profile_name');
        return 'Se cortó el registro. Volvamos a empezar con tu nombre.';
      }

      await this.userProfileRepository.upsert(userId, pending.name, pending.birthday, email);
      this.pendingProfiles.delete(userId);
      this.pendingAdminState.delete(userId);
      return `Listo, te registré correctamente ✅\n\n${await this.adminMenuText(userId)}`;
    }

    if (currentState === 'await_notice_title') {
      return this.handleNoticeStep1(userId, cleaned);
    }

    if (currentState === 'await_notice_body') {
      return this.handleNoticeStep2(userId, cleaned);
    }

    if (currentState === 'await_notice_start_date') {
      return this.handleNoticeStep3(userId, cleaned);
    }

    if (currentState === 'await_notice_end_date') {
      return this.handleNoticeStep4(userId, cleaned);
    }

    if (currentState === 'await_notice_edit_id') {
      return this.handleNoticeEditStep1(userId, cleaned);
    }

    if (currentState === 'await_notice_edit_field') {
      return this.handleNoticeEditStep2(userId, cleaned);
    }

    if (currentState === 'await_notice_edit_value') {
      return this.handleNoticeEditStep3(userId, cleaned);
    }

    if (currentState === 'await_exam_subject') {
      return this.handleExamStep1(userId, cleaned);
    }

    if (currentState === 'await_exam_subject_source') {
      return this.handleExamSubjectSourceStep(userId, cleaned);
    }

    if (currentState === 'await_exam_subject_selection') {
      return this.handleExamSubjectSelectionStep(userId, cleaned);
    }

    if (currentState === 'await_exam_subject_other') {
      return this.handleExamSubjectOtherStep(userId, cleaned);
    }

    if (currentState === 'await_exam_commission') {
      return this.handleExamCommissionStep(userId, cleaned);
    }

    if (currentState === 'await_exam_date') {
      return this.handleExamStep2(userId, cleaned);
    }

    if (currentState === 'await_exam_availability') {
      return this.handleExamStep3(userId, cleaned);
    }

    if (currentState === 'await_exam_time') {
      return this.handleExamStep4(userId, cleaned);
    }

    if (currentState === 'await_exam_end_time') {
      return this.handleExamStep5(userId, cleaned);
    }

    if (currentState === 'await_exam_type') {
      return this.handleExamStep6(userId, cleaned);
    }

    if (currentState === 'await_exam_observations') {
      return this.handleExamStep7(userId, cleaned);
    }

    if (currentState === 'await_class_name') {
      return this.handleClassLoadStep1(userId, cleaned);
    }

    if (currentState === 'await_class_commission_count') {
      return this.handleClassLoadCommissionCount(userId, cleaned);
    }

    if (currentState === 'await_class_day') {
      return this.handleClassLoadStep2(userId, cleaned);
    }

    if (currentState === 'await_class_time') {
      return this.handleClassLoadStep3(userId, cleaned);
    }

    if (currentState === 'await_class_link') {
      return this.handleClassLoadStep4(userId, cleaned);
    }

    if (currentState === 'await_class_id_to_delete') {
      return this.handleClassDelete(userId, cleaned);
    }

    if (currentState === 'await_class_id_to_toggle') {
      return this.handleClassToggleNotifications(userId, cleaned);
    }

    if (currentState === 'await_teacher_name') {
      return this.handleTeacherNameStep(userId, cleaned);
    }

    if (currentState === 'await_teacher_email') {
      return this.handleTeacherEmailStep(userId, cleaned);
    }

    if (currentState === 'await_teacher_subject') {
      return this.handleTeacherSubjectStep(userId, cleaned);
    }

    if (currentState === 'await_teacher_id_to_delete') {
      return this.handleTeacherDelete(userId, cleaned);
    }

    if (currentState === 'submenu_class_notices') {
      return this.handleClassNoticesSubmenu(userId, cleaned);
    }

    if (currentState === 'submenu_exams') {
      return this.handleExamsSubmenu(userId, cleaned);
    }

    if (currentState === 'submenu_institutional_notices') {
      return this.handleInstitutionalNoticesSubmenu(userId, cleaned);
    }

    if (currentState === 'submenu_news') {
      return this.handleNewsSubmenu(userId, cleaned);
    }

    if (currentState === 'submenu_teachers') {
      return this.handleTeachersSubmenu(userId, cleaned);
    }

    if (currentState === 'submenu_moderation') {
      return this.handleModerationSubmenu(userId, cleaned);
    }

    if (currentState === 'await_moderation_unban_id') {
      return this.handleModerationUnban(userId, cleaned);
    }

    if (currentState === 'await_ban_phone') {
      return this.handleBanPhoneStep(userId, cleaned);
    }

    if (currentState === 'await_ban_type') {
      return this.handleBanTypeStep(userId, cleaned);
    }

    if (currentState === 'await_group_context_year') {
      return this.handleGroupContextYear(userId, cleaned);
    }

    if (currentState === 'await_group_context_commission') {
      return await this.handleGroupContextCommission(userId, cleaned);
    }

    if (!(await this.adminRepository.isAuthenticated(userId))) {
      return null;
    }

    if (lowered === 'menu' || lowered === '0') {
      this.pendingAdminState.delete(userId);
      return this.adminMenuText(userId);
    }

    if (lowered === '1') {
      this.pendingAdminState.set(userId, 'submenu_class_notices');
      return this.classNoticesSubmenuText();
    }

    if (lowered === '2') {
      this.pendingAdminState.set(userId, 'submenu_exams');
      return this.examsSubmenuText();
    }

    if (lowered === '3') {
      this.pendingAdminState.set(userId, 'submenu_institutional_notices');
      return this.institutionalNoticesSubmenuText();
    }

    if (lowered === '4') {
      this.pendingAdminState.set(userId, 'submenu_news');
      return this.newsSubmenuText();
    }

    if (lowered === '5') {
      this.pendingAdminState.set(userId, 'submenu_teachers');
      return this.teachersSubmenuText();
    }

    if (lowered === '6') {
      return this.handleAdminCodes();
    }

    if (lowered === '7') {
      this.pendingAdminState.set(userId, 'submenu_moderation');
      return this.moderationSubmenuText();
    }

    if (lowered === '8') {
      this.pendingBanData.set(userId, {});
      this.pendingAdminState.set(userId, 'await_ban_phone');
      return '🚫 Banear usuario\n\nPasáme el número de teléfono (solo números, ej: 5493512345678):';
    }

    return this.pickOne(PrivateChatWorkflowService.ADMIN_MODE_HINTS);
  }

  private async handleAdminCodes(): Promise<string> {
    const newCode = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    await this.adminCodeRepository.addCode(newCode);

    const available = await this.adminCodeRepository.listAvailableCodes(5);
    return [
      '🔐 Códigos para registrar admins',
      `Código nuevo generado: ${newCode}`,
      '',
      'Últimos códigos disponibles:',
      ...available.map((code) => `- ${code}`),
      '',
      'Compartí uno de estos códigos con la persona que querés registrar como admin.',
    ].join('\n');
  }

  private async handleAdminRegistrationCode(userId: string, cleaned: string): Promise<string> {
    if (!/^\d{6}$/.test(cleaned)) {
      return 'Ese codigo no es valido. Debe tener 6 digitos.';
    }

    const valid = await this.adminCodeRepository.consumeIfValid(cleaned, userId);
    if (!valid) return 'Ese codigo no es valido.';

    await this.adminRepository.register(userId);
    
    const profile = await this.userProfileRepository.get(userId);
    if (this.getMissingProfileFields(profile).length > 0) {
      this.pendingProfiles.set(userId, {
        name: profile?.name,
        birthday: profile?.birthday_day_month,
        email: profile?.email,
      });
      const nextState = this.getNextAdminProfileState(profile);
      this.pendingAdminState.set(userId, nextState);
      const intro = this.isProfilePopulated(profile)
        ? this.pickOne(PrivateChatWorkflowService.PROFILE_UPDATE_INTROS)
        : this.pickOne(PrivateChatWorkflowService.PROFILE_WELCOME_INTROS);
      return `Registrado con éxito como admin ✅.\n\n${intro}\n${this.getAdminProfilePrompt(nextState)}`;
    }

    this.pendingAdminState.delete(userId);
    return `Registrado con exito ✅\n${await this.adminMenuText(userId)}`;
  }

  private async handleAdminAuth(userId: string, candidate: string): Promise<string> {
    if (!(await this.adminRepository.isRegistered(userId))) {
      return 'Todavia no estas registrado como admin. Envia mequetrefe para empezar.';
    }

    if (this.adminPassword && candidate === this.adminPassword) {
      await this.adminRepository.setAuthenticated(userId, true);
      this.clearPendingData(userId);
      
      const profile = await this.userProfileRepository.get(userId);
      if (this.getMissingProfileFields(profile).length > 0) {
        this.pendingProfiles.set(userId, {
          name: profile?.name,
          birthday: profile?.birthday_day_month,
          email: profile?.email,
        });
        const nextState = this.getNextAdminProfileState(profile);
        this.pendingAdminState.set(userId, nextState);
        const intro = this.isProfilePopulated(profile)
          ? this.pickOne(PrivateChatWorkflowService.PROFILE_UPDATE_INTROS)
          : this.pickOne(PrivateChatWorkflowService.PROFILE_WELCOME_INTROS);
        return `Hola, admin ✅.\n\n${intro}\n${this.getAdminProfilePrompt(nextState)}`;
      }

      return `Hola, admin ✅\n${await this.adminMenuText(userId)}`;
    }

    return 'No te pude autenticar, proba de nuevo.';
  }

  private async handleNoticeStep1(userId: string, cleaned: string): Promise<string> {
    const title = cleaned.trim();
    if (!title) return 'Necesito el título del aviso.';

    const pending = this.pendingNoticeData.get(userId) || {};
    pending.title = title;
    this.pendingNoticeData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_notice_body');
    return 'Perfecto. Ahora enviame la descripción del aviso.';
  }

  private async handleNoticeStep2(userId: string, cleaned: string): Promise<string> {
    const body = cleaned.trim();
    if (!body) return 'La descripción no puede estar vacía.';

    const pending = this.pendingNoticeData.get(userId) || {};
    pending.body = body;
    this.pendingNoticeData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_notice_start_date');
    return 'Genial. ¿Fecha de publicación? (DD/MM)';
  }

  private async handleNoticeStep3(userId: string, cleaned: string): Promise<string> {
    const startDate = this.parseDayMonth(cleaned);
    if (!startDate) return 'No pude leer la fecha. Usa formato DD/MM.';

    const pending = this.pendingNoticeData.get(userId) || {};
    pending.start_date = startDate;
    this.pendingNoticeData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_notice_end_date');
    return 'Excelente. ¿Fecha de vencimiento? (DD/MM)';
  }

  private async handleNoticeStep4(userId: string, cleaned: string): Promise<string> {
    const endDate = this.parseDayMonth(cleaned);
    if (!endDate) return 'No pude leer la fecha. Usa formato DD/MM.';

    const pending = this.pendingNoticeData.get(userId);
    if (!pending?.title || !pending.body || !pending.start_date) {
      this.pendingNoticeData.delete(userId);
      this.pendingAdminState.delete(userId);
      return 'Faltan datos para guardar el aviso. Volvé a intentarlo desde el submenú.';
    }

    const uniqueHash = crypto
      .createHash('sha256')
      .update(`${pending.title}|${pending.body}|${pending.start_date.toISOString()}|${endDate.toISOString()}`)
      .digest('hex');

    await this.noticesRepository.createIfNew({
      title: pending.title,
      body: pending.body,
      start_date: pending.start_date,
      end_date: endDate,
      event_time: undefined,
      source_email: undefined,
      unique_hash: uniqueHash,
    });

    this.pendingNoticeData.delete(userId);
    this.pendingAdminState.delete(userId);
    return 'Aviso cargado correctamente ✅';
  }

  private async handleExamStep1(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingExamData.get(userId) || {};
    pending.subject_source = undefined;
    pending.subject = undefined;
    pending.selected_class_id = undefined;
    pending.exam_commission_id = undefined;
    this.pendingExamData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_exam_subject_source');

    const classes = await this.managedClassRepository.listAll();
    const classPreview = classes.length
      ? ['Materias cargadas en curso:', ...classes.map((c, idx) => `${idx + 1} - ${c.subject} (${c.schedule_day} ${c.schedule_time}) | Comisiones: ${this.formatCommissionCount(c.commission_count)}`)].join('\n')
      : 'No hay materias cargadas en curso.';

    return [
      '¿El aviso de examen es para una materia en curso o para otra materia?',
      '1 - Materia en curso',
      '2 - Otra materia',
      '',
      classPreview,
    ].join('\n');
  }

  private async handleExamSubjectSourceStep(userId: string, cleaned: string): Promise<string> {
    const normalized = cleaned.trim().toLowerCase();
    const pending = this.pendingExamData.get(userId) || {};

    if (normalized === '1' || normalized === 'en-curso' || normalized === 'en curso') {
      const classes = await this.managedClassRepository.listAll();
      if (!classes.length) {
        return 'No hay materias cargadas en curso. Elegí otra materia.';
      }

      pending.subject_source = 'en-curso';
      this.pendingExamData.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_exam_subject_selection');

      return [
        'Elegí la materia en curso para el aviso de examen:',
        ...classes.map((c, idx) => `${idx + 1} - ${c.subject} (${c.schedule_day} ${c.schedule_time}) | Comisiones: ${this.formatCommissionCount(c.commission_count)}`),
      ].join('\n');
    }

    if (normalized === '2' || normalized === 'otra' || normalized === 'otra materia') {
      pending.subject_source = 'otra';
      this.pendingExamData.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_exam_subject_other');
      return 'Perfecto. Escribime el nombre de la otra materia.';
    }

    return 'Opción inválida. Elegí 1 para materia en curso o 2 para otra materia.';
  }

  private async handleExamSubjectSelectionStep(userId: string, cleaned: string): Promise<string> {
    const indexStr = cleaned.trim();
    if (!/^\d+$/.test(indexStr)) {
      return 'Pasame un número válido de la lista.';
    }

    const classes = await this.managedClassRepository.listAll();
    const index = Number(indexStr) - 1;
    if (index < 0 || index >= classes.length) {
      return `Número inválido. Elegí entre 1 y ${classes.length}.`;
    }

    const selectedClass = classes[index];
    const pending = this.pendingExamData.get(userId) || {};
    pending.subject = selectedClass.subject;
    pending.selected_class_id = selectedClass.id;
    pending.exam_commission_id = selectedClass.commission_count;
    this.pendingExamData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_exam_commission');

    return [
      `Elegiste ${selectedClass.subject}.`,
      `Comisión sugerida: ${selectedClass.commission_count}.`,
      await this.buildExamCommissionPrompt(selectedClass.commission_count),
    ].join('\n');
  }

  private async handleExamSubjectOtherStep(userId: string, cleaned: string): Promise<string> {
    const subject = cleaned.trim();
    if (!subject) return 'Necesito el nombre de la materia.';

    const pending = this.pendingExamData.get(userId) || {};
    pending.subject = subject;
    pending.exam_commission_id = undefined;
    this.pendingExamData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_exam_commission');
    return await this.buildExamCommissionPrompt();
  }

  private async handleExamCommissionStep(userId: string, cleaned: string): Promise<string> {
    const normalized = cleaned.trim().toLowerCase();
    const pending = this.pendingExamData.get(userId);
    if (!pending?.subject) {
      this.pendingExamData.delete(userId);
      this.pendingAdminState.delete(userId);
      return 'Faltan datos para continuar. Volvé a iniciar la carga del examen.';
    }

    if (normalized === '0' || normalized === 'todas' || normalized === 'global') {
      pending.exam_commission_id = undefined;
      this.pendingExamData.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_exam_date');
      return 'Perfecto. Examen global para todas las comisiones. ¿Fecha del examen? (DD/MM)';
    }

    if (!/^\d+$/.test(normalized)) {
      return await this.buildExamCommissionPrompt(pending.exam_commission_id);
    }

    const selectedCommission = Number(normalized);
    const availableCommissions = await this.managedClassRepository.getDistinctCommissionCounts();
    if (availableCommissions.length > 0 && !availableCommissions.includes(selectedCommission)) {
      return `Comisión inválida. ${await this.buildExamCommissionPrompt(pending.exam_commission_id)}`;
    }

    pending.exam_commission_id = selectedCommission;
    this.pendingExamData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_exam_date');
    return `Perfecto. Examen para comisión ${selectedCommission}. ¿Fecha del examen? (DD/MM)`;
  }

  private async buildExamCommissionPrompt(suggested?: number): Promise<string> {
    const availableCommissions = await this.managedClassRepository.getDistinctCommissionCounts();
    const options = availableCommissions.length > 0 ? availableCommissions.join(' / ') : '1';
    const suggestionLine = typeof suggested === 'number' ? `Sugerencia: ${suggested}` : '';
    return [
      '¿A qué comisión pertenece el examen?',
      suggestionLine,
      `Elegí número (${options}) o 0 para todas las comisiones.`,
    ].filter(Boolean).join('\n');
  }

  private async handleExamStep2(userId: string, cleaned: string): Promise<string> {
    const examDate = this.parseDayMonth(cleaned);
    if (!examDate) return 'No pude leer la fecha. Usa formato DD/MM.';

    const pending = this.pendingExamData.get(userId) || {};
    pending.exam_date = examDate;
    this.pendingExamData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_exam_availability');
    return 'Bien. ¿Cómo se rinde el examen?\n1 - Hora específica\n2 - Franja horaria\n3 - A partir de una hora';
  }

  private async handleExamStep3(userId: string, cleaned: string): Promise<string> {
    const normalized = cleaned.trim().toLowerCase();
    const pending = this.pendingExamData.get(userId) || {};

    if (normalized === '1' || normalized === 'hora-especifica' || normalized === 'hora específica') {
      pending.availability = 'hora-especifica';
      this.pendingExamData.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_exam_time');
      return 'Bien. ¿Hora del examen? (HH:MM)';
    }

    if (normalized === '2' || normalized === 'franja') {
      pending.availability = 'franja';
      this.pendingExamData.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_exam_time');
      return 'Genial. ¿Hora de inicio de la franja? (HH:MM)';
    }

    if (normalized === '3' || normalized === 'a-partir-de' || normalized === 'a partir de') {
      pending.availability = 'a-partir-de';
      this.pendingExamData.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_exam_time');
      return 'Genial. ¿Hora a partir de la cual se habilita el examen? (HH:MM)';
    }

    return 'Opción inválida. Elegí 1, 2 o 3.';
  }

  private async handleExamStep4(userId: string, cleaned: string): Promise<string> {
    const examTime = cleaned.trim();
    if (!/^\d{1,2}:\d{2}$/.test(examTime)) {
      return 'Hora inválida. Usa formato HH:MM (ej: 14:30).';
    }

    const pending = this.pendingExamData.get(userId) || {};
    if (pending.availability === 'franja' && !pending.horaInicio) {
      pending.horaInicio = examTime;
      this.pendingExamData.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_exam_end_time');
      return 'Perfecto. ¿Hora de fin de la franja? (HH:MM)';
    }

    pending.exam_time = examTime;
    this.pendingExamData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_exam_type');
    return 'Genial. ¿Tipo de examen? (parcial/final/evidencia)';
  }

  private async handleExamStep5(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingExamData.get(userId);
    if (!pending) {
      this.pendingAdminState.delete(userId);
      return 'Faltan datos para guardar el examen. Volvé a intentarlo desde el submenú.';
    }

    const examEndTime = cleaned.trim();
    if (!/^\d{1,2}:\d{2}$/.test(examEndTime)) {
      return 'Hora inválida. Usa formato HH:MM (ej: 16:00).';
    }

    pending.horaFin = examEndTime;
    this.pendingExamData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_exam_type');
    return 'Genial. ¿Tipo de examen? (parcial/final/evidencia)';
  }

  private async handleExamStep6(userId: string, cleaned: string): Promise<string> {
    const examType = cleaned.trim().toLowerCase();
    if (!examType) return 'Necesito el tipo de examen (parcial/final/evidencia).';

    const pending = this.pendingExamData.get(userId);
    if (!pending?.subject || !pending.exam_date) {
      this.pendingExamData.delete(userId);
      this.pendingAdminState.delete(userId);
      return 'Faltan datos para guardar el examen. Volvé a intentarlo desde el submenú.';
    }

    pending.exam_type = examType;
    this.pendingExamData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_exam_observations');
    return 'Último paso: enviame observaciones.';
  }

  private async handleExamStep7(userId: string, cleaned: string): Promise<string> {
    const observations = cleaned.trim();
    if (!observations) return 'Las observaciones no pueden quedar vacías.';

    const pending = this.pendingExamData.get(userId);
    if (!pending?.subject || !pending.exam_date || !pending.exam_type) {
      this.pendingExamData.delete(userId);
      this.pendingAdminState.delete(userId);
      return 'Faltan datos para guardar el examen. Volvé a intentarlo desde el submenú.';
    }

    const resolvedExamTime = pending.exam_time || pending.horaInicio;

    const exam: ManagedExam = {
      subject: pending.subject,
      exam_date: pending.exam_date,
      exam_time: resolvedExamTime || '00:00',
      exam_type: pending.exam_type,
      observations,
      created_by: userId,
      tipoDisponibilidad: pending.availability || 'hora-especifica',
      horaInicio: pending.horaInicio || resolvedExamTime,
      horaFin: pending.horaFin,
      frecuenciaAvisos: '7d,3d,1d,20m',
      exam_commission_id: pending.exam_commission_id,
    };

    await this.examsRepository.create(exam);
    this.pendingExamData.delete(userId);
    this.pendingAdminState.delete(userId);
    return 'Examen cargado correctamente ✅';
  }

  private async handleNoticeEditStep1(userId: string, cleaned: string): Promise<string> {
    const notices = await this.noticesRepository.listWithIds(50);
    if (!notices.length) {
      this.pendingAdminState.delete(userId);
      return 'No hay avisos institucionales para editar.';
    }

    const pending = this.pendingNoticeEditData.get(userId) || {};
    this.pendingNoticeEditData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_notice_edit_field');

    const idStr = cleaned.trim();
    if (!/^\d+$/.test(idStr)) {
      return [
        'Selecciona el ID del aviso a editar:',
        ...notices.map((n) => `${n.id} - ${n.notice.title}`),
      ].join('\n');
    }

    const noticeId = Number(idStr);
    const found = notices.find((n) => n.id === noticeId);
    if (!found) {
      return [
        `No encontré un aviso con ID ${noticeId}. Elegí uno válido:`,
        ...notices.map((n) => `${n.id} - ${n.notice.title}`),
      ].join('\n');
    }

    pending.noticeId = noticeId;
    this.pendingNoticeEditData.set(userId, pending);

    return [
      `Perfecto. Aviso: "${found.notice.title}"`,
      '',
      '¿Qué campo queres editar?',
      '1 - Título',
      '2 - Cuerpo',
      '3 - Fecha de inicio',
      '4 - Fecha de fin',
    ].join('\n');
  }

  private async handleNoticeEditStep2(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingNoticeEditData.get(userId);
    if (!pending?.noticeId) {
      this.pendingAdminState.delete(userId);
      return 'Faltan datos para editar. Volvé a intentarlo desde el menú.';
    }

    const notice = await this.noticesRepository.getById(pending.noticeId);
    if (!notice) {
      this.pendingAdminState.delete(userId);
      return 'No encontré el aviso para editar.';
    }

    const fieldMap: { [key: string]: NonNullable<PendingNoticeEditData['field']> } = {
      '1': 'title',
      'titulo': 'title',
      'título': 'title',
      '2': 'body',
      'cuerpo': 'body',
      'body': 'body',
      '3': 'start_date',
      'inicio': 'start_date',
      'fecha de inicio': 'start_date',
      '4': 'end_date',
      'fin': 'end_date',
      'fecha de fin': 'end_date',
    };

    const normalized = cleaned.trim().toLowerCase();
    const field = fieldMap[normalized];

    if (!field) {
      return [
        '¿Qué campo queres editar?',
        '1 - Título',
        '2 - Cuerpo',
        '3 - Fecha de inicio',
        '4 - Fecha de fin',
      ].join('\n');
    }

    const currentValue = this.getNoticeFieldValue(notice, field);
    pending.field = field;
    this.pendingNoticeEditData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_notice_edit_value');

    return [
      `Campo: ${this.getNoticeFieldLabel(field)}`,
      `Valor actual: "${currentValue}"`,
      '',
      `Escribime el nuevo valor.`,
    ].join('\n');
  }

  private async handleNoticeEditStep3(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingNoticeEditData.get(userId);
    if (!pending?.noticeId || !pending.field) {
      this.pendingAdminState.delete(userId);
      return 'Faltan datos para editar. Volvé a intentarlo desde el menú.';
    }

    const newValue = cleaned.trim();
    if (!newValue) {
      return 'El valor no puede estar vacío. Intentá de nuevo.';
    }

    const notice = await this.noticesRepository.getById(pending.noticeId);
    if (!notice) {
      this.pendingAdminState.delete(userId);
      return 'No encontré el aviso para editar.';
    }

    const updateData: Partial<InstitutionalNotice> = {};

    if (pending.field === 'title') {
      updateData.title = newValue;
    } else if (pending.field === 'body') {
      updateData.body = newValue;
    } else if (pending.field === 'start_date') {
      const parsed = this.parseDayMonth(newValue);
      if (!parsed) {
        return 'Fecha inválida. Usa formato DD/MM.';
      }
      updateData.start_date = parsed;
    } else if (pending.field === 'end_date') {
      const parsed = this.parseDayMonth(newValue);
      if (!parsed) {
        return 'Fecha inválida. Usa formato DD/MM.';
      }
      updateData.end_date = parsed;
    }

    const success = await this.noticesRepository.updateById(pending.noticeId, updateData);
    this.pendingNoticeEditData.delete(userId);
    this.pendingAdminState.delete(userId);

    if (!success) {
      return 'Hubo un error al actualizar el aviso. Intentá de nuevo.';
    }

    return `Aviso actualizado correctamente ✅\nCampo "${this.getNoticeFieldLabel(pending.field)}" → "${newValue}"`;
  }

  private async handleUserRegistrationFlow(userId: string, cleaned: string): Promise<string> {
    const profile = await this.userProfileRepository.get(userId);
    const currentState = this.pendingAdminState.get(userId);

    if (currentState === 'await_user_profile_name') {
      const name = cleaned.trim();
      if (!name) {
        return 'Necesito tu nombre para completar el registro.';
      }

      const pending = this.pendingProfiles.get(userId) || {};
      pending.name = name;
      this.pendingProfiles.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_user_profile_birthday');
      return 'Gracias. Ahora mandame tu fecha de cumpleaños (DD/MM).';
    }

    if (currentState === 'await_user_profile_birthday') {
      const birthday = this.parseDayMonth(cleaned);
      if (!birthday) return 'No pude leer la fecha. Usa formato DD/MM.';

      const pending = this.pendingProfiles.get(userId) || {};
      pending.birthday = `${String(birthday.getDate()).padStart(2, '0')}/${String(birthday.getMonth() + 1).padStart(2, '0')}`;
      this.pendingProfiles.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_user_profile_email');
      return 'Perfecto. Ahora pasame tu email institucional con el que te conectas a clase.';
    }

    if (currentState === 'await_user_profile_email') {
      const email = cleaned.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        // Contar reintentos para evitar loop infinito
        const retryKey = `${userId}:email`;
        const retries = (this.registrationRetries.get(retryKey) || 0) + 1;
        this.registrationRetries.set(retryKey, retries);
        if (retries >= 5) {
          this.registrationRetries.delete(retryKey);
          this.pendingProfiles.delete(userId);
          this.pendingAdminState.delete(userId);
          return 'Demasiados intentos fallidos. Escribime "hola" cuando quieras intentar registrarte de nuevo 🙂';
        }
        return `Ese email no parece válido. Revisalo y probá de nuevo. (Intento ${retries}/5)`;
      }

      const pending = this.pendingProfiles.get(userId) || {};
      const resolvedName = pending.name || profile?.name;
      const resolvedBirthday = pending.birthday || profile?.birthday_day_month;

      if (!resolvedName) {
        this.pendingAdminState.set(userId, 'await_user_profile_name');
        return 'Se cortó el registro. Volvamos a empezar con tu nombre.';
      }
      if (!resolvedBirthday) {
        this.pendingAdminState.set(userId, 'await_user_profile_birthday');
        return 'Me falta tu fecha de cumpleaños. Pasamela en formato DD/MM.';
      }

      pending.email = email;
      // Limpiar retries al completar
      this.registrationRetries.delete(`${userId}:email`);
      pending.email = email;
      this.pendingProfiles.set(userId, pending);
      // Obtener comisiones disponibles basadas en materias cargadas
      const availableCommissions = await this.managedClassRepository.getDistinctCommissionCounts();
      if (availableCommissions.length === 0) {
        // Si no hay comisiones cargadas, usar 1 por defecto
        availableCommissions.push(1);
      }
      this.pendingAdminState.set(userId, 'await_user_commission_selection');
      this.pendingProfiles.set(userId, { ...pending, commission: undefined });
      const commissionOptions = availableCommissions.map((c) => `${c}`).join(' / ');
      return `Perfecto. Ahora elegí tu comisión (${commissionOptions}).`;
    }

    if (currentState === 'await_user_commission_selection') {
      return this.handleUserCommissionSelection(userId, cleaned);
    }

    const missingFields = this.getMissingProfileFields(profile);
    if (missingFields.length === 0) {
      if (this.postRegistrationWarningShown.has(userId)) {
        return '';
      }

      this.postRegistrationWarningShown.add(userId);
      return this.pickOne(PrivateChatWorkflowService.PRIVATE_ONLY_AFTER_REGISTER);
    }

    const pending = this.pendingProfiles.get(userId) || {
      name: profile?.name,
      birthday: profile?.birthday_day_month,
      email: profile?.email,
      commission: profile?.user_commission_id,
    };
    this.pendingProfiles.set(userId, pending);

    const intro = this.isProfilePopulated(profile)
      ? (this.profileUpdateNoticeShown.has(userId)
        ? ''
        : `${this.pickOne(PrivateChatWorkflowService.PROFILE_UPDATE_INTROS)}\n`)
      : `${this.pickOne(PrivateChatWorkflowService.PROFILE_WELCOME_INTROS)}\n`;
    this.profileUpdateNoticeShown.add(userId);

    if (!pending.name) {
      this.pendingAdminState.set(userId, 'await_user_profile_name');
      return `${intro}Primero pasame tu nombre.`;
    }

    if (!pending.birthday) {
      this.pendingAdminState.set(userId, 'await_user_profile_birthday');
      return `${intro}Ahora necesito tu fecha de cumpleaños (DD/MM).`;
    }

    if (!pending.email) {
      this.pendingAdminState.set(userId, 'await_user_profile_email');
      return `${intro}Ahora pasame tu email institucional con el que te conectas a clase.`;
    }

    const availableCommissions = await this.managedClassRepository.getDistinctCommissionCounts();
    const options = availableCommissions.length > 0 ? availableCommissions.map((c) => `${c}`).join(' / ') : '1';
    this.pendingAdminState.set(userId, 'await_user_commission_selection');
    return `${intro}Ahora elegí tu comisión (${options}).`;
  }

  private async handleUserCommissionSelection(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingProfiles.get(userId);
    if (!pending?.name || !pending.birthday || !pending.email) {
      this.pendingAdminState.delete(userId);
      this.pendingProfiles.delete(userId);
      return 'Faltan datos. Volvé a intentarlo con "hola".';
    }

    const commissionStr = cleaned.trim();
    if (!/^\d+$/.test(commissionStr)) {
      const availableCommissions = await this.managedClassRepository.getDistinctCommissionCounts();
      const options = availableCommissions.length > 0 ? availableCommissions.map((c) => `${c}`).join(' / ') : '1';
      return `Necesito número. Elegí comisión (${options}).`;
    }

    const chosenCommission = Number(commissionStr);
    const availableCommissions = await this.managedClassRepository.getDistinctCommissionCounts();

    if (availableCommissions.length > 0 && !availableCommissions.includes(chosenCommission)) {
      const options = availableCommissions.map((c) => `${c}`).join(' / ');
      return `Comisión ${chosenCommission} no existe. Disponibles: ${options}`;
    }

    pending.commission = chosenCommission;
    await this.userProfileRepository.upsert(userId, pending.name, pending.birthday, pending.email, pending.commission);
    this.pendingProfiles.delete(userId);
    this.pendingAdminState.delete(userId);
    this.postRegistrationWarningShown.delete(userId);
    this.profileUpdateNoticeShown.delete(userId);
    return `Registrado ✅\nComisión: ${chosenCommission}`;
  }

  private async adminMenuText(userId: string): Promise<string> {
    const profile = await this.userProfileRepository.get(userId);
    const displayName = profile?.name?.trim() || 'admin';

    return [
      `Panel admin (${displayName}):`,
      '',
      '1 - Configurar avisos de clase',
      '2 - Gestionar avisos de exámenes',
      '3 - Gestionar avisos institucionales',
      '4 - Forzar actualización de las noticias',
      '5 - Cargar emails de profesores',
      '6 - Ver/generar código secreto para nuevos admins',
      '7 - Moderación de usuarios (desbaneo)',
      '8 - Banear usuario',
      '',
      '0/menu - Volver al menú principal',
      '',
      'En cada submenú encontrarás opciones para forzar pruebas de notificación.',
    ].join('\n');
  }

  private classNoticesSubmenuText(): string {
    return [
      '⚙️ Configurar avisos de clase',
      '1 - Ver materias programadas',
      '2 - Cargar materia',
      '3 - Eliminar materia',
      '4 - Habilitar/deshabilitar notificaciones',
      '5 - Forzar aviso de clase (prueba)',
      '0 - Volver',
    ].join('\n');
  }

  private examsSubmenuText(): string {
    return [
      '📝 Gestión de exámenes',
      '1 - Cargar examen',
      '2 - Ver exámenes',
      '3 - Forzar aviso de examen (prueba)',
      '0 - Volver',
    ].join('\n');
  }

  private institutionalNoticesSubmenuText(): string {
    return [
      '📬 Gestión de avisos institucionales',
      '1 - Cargar aviso',
      '2 - Ver avisos',
      '3 - Forzar aviso institucional (prueba)',
      '4 - Editar aviso existente',
      '0 - Volver',
    ].join('\n');
  }

  private newsSubmenuText(): string {
    return [
      '📰 Noticias',
      '1 - Actualizar noticias',
      '0 - Volver',
    ].join('\n');
  }

  private teachersSubmenuText(): string {
    return [
      '👨‍🏫 Cargar emails de profesores',
      '1 - Ver profesores',
      '2 - Cargar profesor',
      '3 - Eliminar profesor',
      '0 - Volver',
    ].join('\n');
  }

  private moderationSubmenuText(): string {
    return [
      '🛡️ Moderación de usuarios',
      '1 - Ver usuarios baneados',
      '2 - Desbanear usuario por ID',
      '0 - Volver',
    ].join('\n');
  }

  private async handleClassNoticesSubmenu(userId: string, cleaned: string): Promise<string> {
    const lowered = cleaned.trim().toLowerCase();
    if (lowered === '0' || lowered === 'menu') {
      this.pendingAdminState.delete(userId);
      return this.adminMenuText(userId);
    }

    if (lowered === '1') {
      const classes = await this.managedClassRepository.listAll();
      if (!classes.length) return 'No hay materias cargadas.';
      return [
        'Materias programadas:',
        ...classes.map((c) => `• ${c.subject} - ${c.schedule_day} a las ${c.schedule_time} (Comisiones: ${this.formatCommissionCount(c.commission_count)}) (Avisos: ${c.notifications_enabled ? 'ON' : 'OFF'})`),
      ].join('\n');
    }

    if (lowered === '2') {
      this.pendingAdminState.set(userId, 'await_class_name');
      return 'Vamos paso a paso. ¿Cuál es el nombre de la materia?';
    }

    if (lowered === '3') {
      this.pendingAdminState.set(userId, 'await_class_id_to_delete');
      const classes = await this.managedClassRepository.listAll();
      if (!classes.length) return 'No hay materias cargadas.';
      return ['Materias a eliminar:', ...classes.map((c, idx) => `${idx + 1} - ${c.subject} (${c.schedule_day} ${c.schedule_time})`)].join('\n');
    }

    if (lowered === '4') {
      this.pendingAdminState.set(userId, 'await_class_id_to_toggle');
      const classes = await this.managedClassRepository.listAll();
      if (!classes.length) return 'No hay materias cargadas.';
      return ['Materias - Habilitar/deshabilitar notificaciones:', ...classes.map((c, idx) => `${idx + 1} - ${c.subject} (${c.notifications_enabled ? 'ON' : 'OFF'})`)].join('\n');
    }

    if (lowered === '5') {
      return this.buildClassNotificationPreview();
    }

    return 'Opción inválida. Elegí un número del submenú o 0 para volver.';
  }

  private async handleExamsSubmenu(userId: string, cleaned: string): Promise<string> {
    const lowered = cleaned.trim().toLowerCase();
    if (lowered === '0' || lowered === 'menu') {
      this.pendingAdminState.delete(userId);
      return this.adminMenuText(userId);
    }

    if (lowered === '1') {
      this.pendingExamData.delete(userId);
      this.pendingAdminState.set(userId, 'await_exam_subject');
      return 'Vamos paso a paso. ¿Cuál es la materia del examen?';
    }

    if (lowered === '2') {
      const exams = await this.examsRepository.listWithIds(50);
      if (!exams.length) return 'No hay exámenes cargados.';
      return ['Exámenes actuales:', ...exams.map((e) => `${e.id} - ${e.exam.subject} (${e.exam.exam_date.toISOString().slice(0, 10)})`)].join('\n');
    }

    if (lowered === '3') {
      return this.buildExamNotificationPreview();
    }

    return 'Opción inválida. Elegí un número del submenú o 0 para volver.';
  }

  private async handleInstitutionalNoticesSubmenu(userId: string, cleaned: string): Promise<string> {
    const lowered = cleaned.trim().toLowerCase();
    if (lowered === '0' || lowered === 'menu') {
      this.pendingAdminState.delete(userId);
      return this.adminMenuText(userId);
    }

    if (lowered === '1') {
      this.pendingNoticeData.delete(userId);
      this.pendingAdminState.set(userId, 'await_notice_title');
      return 'Vamos paso a paso. ¿Cuál es el título del aviso?';
    }

    if (lowered === '2') {
      const notices = await this.noticesRepository.listWithIds(50);
      if (!notices.length) return 'No hay avisos cargados.';
      return ['Avisos actuales:', ...notices.map((n) => `${n.id} - ${n.notice.title}`)].join('\n');
    }

    if (lowered === '3') {
      return this.buildInstitutionalNoticePreview();
    }

    if (lowered === '4') {
      const notices = await this.noticesRepository.listWithIds(50);
      if (!notices.length) return 'No hay avisos cargados para editar.';
      this.pendingAdminState.set(userId, 'await_notice_edit_id');
      return ['Elegí el aviso a editar:', ...notices.map((n) => `${n.id} - ${n.notice.title} (${this.formatNoticeDateRange(n.notice.start_date, n.notice.end_date)})`)].join('\n');
    }

    return 'Opción inválida. Elegí un número del submenú o 0 para volver.';
  }

  private async handleNewsSubmenu(userId: string, cleaned: string): Promise<string> {
    const lowered = cleaned.trim().toLowerCase();
    if (lowered === '0' || lowered === 'menu') {
      this.pendingAdminState.delete(userId);
      return this.adminMenuText(userId);
    }

    if (lowered === '1') {
      await this.dynamicMessageService.getNews(5, true);
      return 'Actualizando noticias... ✅';
    }

    return 'Opción inválida. Elegí un número del submenú o 0 para volver.';
  }

  private async handleTeachersSubmenu(userId: string, cleaned: string): Promise<string> {
    const lowered = cleaned.trim().toLowerCase();
    if (lowered === '0' || lowered === 'menu') {
      this.pendingAdminState.delete(userId);
      return this.adminMenuText(userId);
    }

    if (lowered === '1') {
      const teachers = await this.managedTeacherRepository.listWithIds(50);
      if (!teachers.length) return 'No hay profesores cargados. ¡Pidele al admin que cargue los emails!';
      return [
        'Profesores actuales:',
        ...teachers.map(
          (t) => `${t.id} - ${t.teacher.name} <${t.teacher.email}>${t.teacher.subject ? ` | Materia: ${t.teacher.subject}` : ''}`,
        ),
      ].join('\n');
    }

    if (lowered === '2') {
      this.pendingTeacherData.delete(userId);
      this.pendingAdminState.set(userId, 'await_teacher_name');
      return 'Vamos a cargar un profesor. ¿Cuál es su nombre completo?';
    }

    if (lowered === '3') {
      this.pendingAdminState.set(userId, 'await_teacher_id_to_delete');
      const teachers = await this.managedTeacherRepository.listWithIds(50);
      if (!teachers.length) return 'No hay profesores cargados. ¡Pidele al admin que cargue los emails!';
      return ['Profesores a eliminar (ID):', ...teachers.map((t) => `${t.id} - ${t.teacher.name} <${t.teacher.email}>`)].join('\n');
    }

    return 'Opción inválida. Elegí un número del submenú o 0 para volver.';
  }

  private async handleModerationSubmenu(userId: string, cleaned: string): Promise<string> {
    const lowered = cleaned.trim().toLowerCase();
    if (lowered === '0' || lowered === 'menu') {
      this.pendingAdminState.delete(userId);
      return this.adminMenuText(userId);
    }

    if (lowered === '1') {
      const banned = await this.moderationRepository.listCurrentlyBanned(new Date(), 100);
      if (!banned.length) {
        return 'No hay usuarios baneados ahora.';
      }

      return [
        'Usuarios baneados:',
        ...banned.map((u) => `${u.id} - ${u.name || 'Sin nombre'} | Tel: ${u.phone} | Tipo: ${u.ban_type} | Hasta: ${u.banned_until.toISOString().slice(0, 10)}`),
      ].join('\n');
    }

    if (lowered === '2') {
      this.pendingAdminState.set(userId, 'await_moderation_unban_id');
      const banned = await this.moderationRepository.listCurrentlyBanned(new Date(), 100);
      if (!banned.length) {
        this.pendingAdminState.set(userId, 'submenu_moderation');
        return 'No hay usuarios baneados para desbloquear.';
      }

      return [
        'Pasame el ID a desbloquear:',
        ...banned.map((u) => `${u.id} - ${u.name || 'Sin nombre'} | Tel: ${u.phone}`),
      ].join('\n');
    }

    return 'Opción inválida. Elegí 1, 2 o 0.';
  }

  private async handleModerationUnban(userId: string, cleaned: string): Promise<string> {
    const idStr = cleaned.trim();
    if (!/^\d+$/.test(idStr)) {
      return 'Pasame un ID numérico válido.';
    }

    const ok = await this.moderationRepository.unblockById(Number(idStr));
    this.pendingAdminState.set(userId, 'submenu_moderation');

    if (!ok) {
      return 'No encontré un usuario baneado con ese ID.';
    }

    return 'Usuario desbloqueado correctamente ✅';
  }

  private async buildClassNotificationPreview(): Promise<string> {
    const classes = await this.managedClassRepository.listAll();
    const enabled = classes.filter((c) => c.notifications_enabled);
    if (!enabled.length) {
      return 'No hay materias con avisos habilitados para probar. Activa una y vuelve a intentar.';
    }

    const chosen = enabled[0];
    const phrase = PrivateChatWorkflowService.TEST_CLASS_PHRASES[Math.floor(Math.random() * PrivateChatWorkflowService.TEST_CLASS_PHRASES.length)];
    return [
      `${phrase}`,
      '',
      `📚 ${chosen.subject}`,
      `🧩 Comisiones: ${this.formatCommissionCount(chosen.commission_count)}`,
      `🕒 ${chosen.schedule_day} ${chosen.schedule_time}`,
      `🔗 ${chosen.meet_link}`,
    ].join('\n');
  }

  private async buildExamNotificationPreview(): Promise<string> {
    const exams = await this.dynamicMessageService.getUpcomingExams(1);
    if (!exams.length) {
      return 'No hay exámenes próximos para generar una prueba.';
    }

    const exam = exams[0];
    const examDate = exam.exam_date.toISOString().slice(0, 10);
    return [
      `Recordatorio: se acerca ${exam.subject}.`,
      `Fecha: ${examDate}`,
      `Hora: ${exam.exam_time}`,
      `Tipo: ${exam.exam_type}`,
      `Observaciones: ${exam.observations}`,
    ].join('\n');
  }

  private async buildInstitutionalNoticePreview(): Promise<string> {
    const notices = await this.dynamicMessageService.getValidNotices(1);
    if (!notices.length) {
      return 'No hay avisos institucionales vigentes para generar una prueba.';
    }

    const notice = notices[0];
    return [
      `📢 ${notice.title}`,
      `${notice.body}`,
    ].join('\n');
  }

  private async handleClassLoadStep1(userId: string, cleaned: string): Promise<string> {
    const pendingData = this.pendingClassData.get(userId) || {};
    pendingData.subject = cleaned.trim();
    this.pendingClassData.set(userId, pendingData);
    this.pendingAdminState.set(userId, 'await_class_commission_count');
    return 'Perfecto. Antes de seguir, ¿cuantas comisiones tiene esta materia? (1, 2, 3...)';
  }

  private async handleClassLoadCommissionCount(userId: string, cleaned: string): Promise<string> {
    const countStr = cleaned.trim();
    if (!/^\d+$/.test(countStr)) {
      return 'Necesito un numero entero de comisiones. Ejemplo: 1, 2, 3...';
    }

    const commissionCount = Number(countStr);
    if (commissionCount < 1) {
      return 'La materia debe tener al menos 1 comision.';
    }

    const pendingData = this.pendingClassData.get(userId) || {};
    pendingData.commission_count = commissionCount;
    this.pendingClassData.set(userId, pendingData);
    this.pendingAdminState.set(userId, 'await_class_day');
    return commissionCount === 1
      ? 'Bien. Queda como comision unica. Ahora, ¿que dia de la semana? (lunes, martes, miercoles, jueves, viernes)'
      : `Bien. Guardo ${commissionCount} comisiones. Ahora, ¿que dia de la semana? (lunes, martes, miercoles, jueves, viernes)`;
  }

  private async handleClassLoadStep2(userId: string, cleaned: string): Promise<string> {
    const dayLower = cleaned.trim().toLowerCase();
    const validDays = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];
    if (!validDays.includes(dayLower)) {
      return 'Día inválido. Usa: lunes, martes, miercoles, jueves or viernes.';
    }
    const pendingData = this.pendingClassData.get(userId) || {};
    pendingData.schedule_day = dayLower;
    this.pendingClassData.set(userId, pendingData);
    this.pendingAdminState.set(userId, 'await_class_time');
    return 'De acuerdo. ¿A qué hora? (formato HH:MM, ej: 14:30)';
  }

  private async handleClassLoadStep3(userId: string, cleaned: string): Promise<string> {
    const timeStr = cleaned.trim();
    if (!/^\d{1,2}:\d{2}$/.test(timeStr)) {
      return 'Hora inválida. Usa formato HH:MM (ej: 14:30).';
    }
    const pendingData = this.pendingClassData.get(userId) || {};
    pendingData.schedule_time = timeStr;
    this.pendingClassData.set(userId, pendingData);
    this.pendingAdminState.set(userId, 'await_class_link');
    return 'Excelente. ¿Cuál es el enlace de Google Meet?';
  }

  private async handleClassLoadStep4(userId: string, cleaned: string): Promise<string> {
    const linkStr = cleaned.trim();
    if (!linkStr.startsWith('http')) {
      return 'El enlace debe empezar con http:// o https://.';
    }
    const pendingData = this.pendingClassData.get(userId) || {};
    pendingData.meet_link = linkStr;

    if (!pendingData.subject || !pendingData.schedule_day || !pendingData.schedule_time) {
      this.pendingClassData.delete(userId);
      this.pendingAdminState.delete(userId);
      return 'Error: faltan datos. Volvemos a empezar.';
    }

    const classData: ManagedClassCreateInput = {
      subject: pendingData.subject,
      commission_count: pendingData.commission_count ?? 1,
      schedule_day: pendingData.schedule_day,
      schedule_time: pendingData.schedule_time,
      meet_link: pendingData.meet_link,
      notifications_enabled: true,
    };

    await this.managedClassRepository.create(classData);
    this.pendingClassData.delete(userId);
    this.pendingAdminState.delete(userId);
    return 'Materia cargada correctamente ✅';
  }

  private formatCommissionCount(count?: number): string {
    const normalized = Number.isFinite(Number(count)) ? Math.max(1, Math.trunc(Number(count))) : 1;
    return normalized === 1 ? '1 (unica)' : String(normalized);
  }

  private formatNoticeDate(date?: Date): string {
    if (!date) return '(sin fecha)';
    return date.toISOString().slice(0, 10);
  }

  private formatNoticeDateRange(startDate?: Date, endDate?: Date): string {
    return `${this.formatNoticeDate(startDate)} a ${this.formatNoticeDate(endDate)}`;
  }

  private getNoticeFieldLabel(field: NonNullable<PendingNoticeEditData['field']>): string {
    const labels: Record<NonNullable<PendingNoticeEditData['field']>, string> = {
      title: 'título',
      body: 'cuerpo',
      start_date: 'fecha de inicio',
      end_date: 'fecha de fin',
    };

    return labels[field];
  }

  private getNoticeFieldValue(notice: { title: string; body: string; start_date?: Date; end_date?: Date }, field: NonNullable<PendingNoticeEditData['field']>): string {
    if (field === 'title') return notice.title;
    if (field === 'body') return notice.body;
    if (field === 'start_date') return this.formatNoticeDate(notice.start_date);
    return this.formatNoticeDate(notice.end_date);
  }

  private async handleClassDelete(userId: string, cleaned: string): Promise<string> {
    const classes = await this.managedClassRepository.listAll();
    if (!classes.length) {
      this.pendingAdminState.delete(userId);
      return 'No hay materias cargadas.';
    }

    const indexStr = cleaned.trim();
    if (!/^\d+$/.test(indexStr)) {
      return 'Ingresa un número válido.';
    }

    const idx = Number(indexStr) - 1;
    if (idx < 0 || idx >= classes.length) {
      return `Número inválido. Elige entre 1 y ${classes.length}.`;
    }

    const classToDelete = classes[idx];
    if (classToDelete.id) {
      await this.managedClassRepository.delete(classToDelete.id);
      this.pendingAdminState.delete(userId);
      return `Materia "${classToDelete.subject}" eliminada ✅`;
    }

    this.pendingAdminState.delete(userId);
    return 'Error al eliminar la materia.';
  }

  private async handleClassToggleNotifications(userId: string, cleaned: string): Promise<string> {
    const classes = await this.managedClassRepository.listAll();
    if (!classes.length) {
      this.pendingAdminState.delete(userId);
      return 'No hay materias cargadas.';
    }

    const indexStr = cleaned.trim();
    if (!/^\d+$/.test(indexStr)) {
      return 'Ingresa un número válido.';
    }

    const idx = Number(indexStr) - 1;
    if (idx < 0 || idx >= classes.length) {
      return `Número inválido. Elige entre 1 y ${classes.length}.`;
    }

    const classToToggle = classes[idx];
    if (classToToggle.id) {
      const newState = !classToToggle.notifications_enabled;
      await this.managedClassRepository.setNotificationsEnabled(classToToggle.id, newState);
      this.pendingAdminState.delete(userId);
      return `Avisos para "${classToToggle.subject}" ahora están ${newState ? 'HABILITADOS ✅' : 'DESHABILITADOS ❌'}`;
    }

    this.pendingAdminState.delete(userId);
    return 'Error al cambiar el estado.';
  }

  private async handleTeacherNameStep(userId: string, cleaned: string): Promise<string> {
    const name = cleaned.trim();
    if (!name) {
      return 'Necesito un nombre para continuar.';
    }

    const pendingData = this.pendingTeacherData.get(userId) || {};
    pendingData.name = name;
    this.pendingTeacherData.set(userId, pendingData);
    this.pendingAdminState.set(userId, 'await_teacher_email');
    return 'Perfecto. Ahora pasame el email institucional del profesor.';
  }

  private async handleTeacherEmailStep(userId: string, cleaned: string): Promise<string> {
    const email = cleaned.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return 'Ese email no parece valido. Revisalo y probá de nuevo.';
    }

    const pendingData = this.pendingTeacherData.get(userId) || {};
    pendingData.email = email;
    this.pendingTeacherData.set(userId, pendingData);
    this.pendingAdminState.set(userId, 'await_teacher_subject');
    return 'Genial. ¿Qué materia dicta? (opcional, podés responder "-" para omitir)';
  }

  private async handleTeacherSubjectStep(userId: string, cleaned: string): Promise<string> {
    const pendingData = this.pendingTeacherData.get(userId);
    if (!pendingData?.name || !pendingData?.email) {
      this.pendingTeacherData.delete(userId);
      this.pendingAdminState.delete(userId);
      return 'Me faltan datos para guardar el profesor. Empezamos de nuevo desde el menú.';
    }

    const subjectRaw = cleaned.trim();
    const subject = subjectRaw === '-' ? undefined : subjectRaw;

    const teacherData: ManagedTeacherCreateInput = {
      name: pendingData.name,
      email: pendingData.email,
      subject,
    };

    await this.managedTeacherRepository.create(teacherData);
    this.pendingTeacherData.delete(userId);
    this.pendingAdminState.delete(userId);
    return 'Profesor cargado correctamente ✅';
  }

  private async handleTeacherDelete(userId: string, cleaned: string): Promise<string> {
    const teachers = await this.managedTeacherRepository.listWithIds(50);
    if (!teachers.length) {
      this.pendingAdminState.delete(userId);
      return 'No hay profesores cargados. ¡Pidele al admin que cargue los emails!';
    }

    const idStr = cleaned.trim();
    if (!/^\d+$/.test(idStr)) {
      return 'Ingresa un ID valido de profesor.';
    }

    const teacherId = Number(idStr);
    const teacher = teachers.find((t) => t.id === teacherId);
    if (!teacher) {
      return 'No encontré un profesor con ese ID.';
    }

    await this.managedTeacherRepository.delete(teacherId);
    this.pendingAdminState.delete(userId);
    return `Profesor "${teacher.teacher.name}" eliminado ✅`;
  }

  private clearPendingData(userId: string): void {
    this.pendingProfiles.delete(userId);
    this.pendingAdminState.delete(userId);
    this.pendingClassData.delete(userId);
    this.pendingTeacherData.delete(userId);
    this.pendingExamData.delete(userId);
    this.pendingNoticeData.delete(userId);
    this.pendingNoticeEditData.delete(userId);
    this.pendingBanData.delete(userId);
    this.registrationRetries.delete(`${userId}:email`);
  }

  private getMissingProfileFields(profile: { name: string; birthday_day_month: string; email: string; user_commission_id?: number } | null): string[] {
    if (!profile) return ['name', 'birthday', 'email', 'commission'];

    const missing: string[] = [];
    if (!profile.name?.trim()) missing.push('name');
    if (!profile.birthday_day_month?.trim()) missing.push('birthday');
    if (!profile.email?.trim()) missing.push('email');
    if (typeof profile.user_commission_id !== 'number') missing.push('commission');
    return missing;
  }

  private getNextAdminProfileState(profile: { name: string; birthday_day_month: string; email: string } | null): string {
    const missing = this.getMissingProfileFields(profile);
    if (missing.includes('name')) return 'await_admin_profile_name';
    if (missing.includes('birthday')) return 'await_admin_profile_birthday';
    return 'await_admin_profile_email';
  }

  private getAdminProfilePrompt(state: string): string {
    if (state === 'await_admin_profile_name') {
      return 'Pasame tu nombre.';
    }
    if (state === 'await_admin_profile_birthday') {
      return 'Pasame tu fecha de cumpleaños (DD/MM).';
    }
    return 'Pasame tu email institucional con el que te conectas a clase.';
  }

  private async handleBanPhoneStep(userId: string, cleaned: string): Promise<string> {
    const phone = cleaned.trim().replace(/\s+/g, '');
    if (!/^\d{7,15}$/.test(phone)) {
      return 'Número inválido. Ingresá solo dígitos, sin espacios ni guiones (ej: 5493512345678).';
    }

    const banData = this.pendingBanData.get(userId) || {};
    banData.phone = phone;
    this.pendingBanData.set(userId, banData);
    this.pendingAdminState.set(userId, 'await_ban_type');
    return [
      `✅ Número: ${phone}`,
      '',
      '¿Qué tipo de baneo querés aplicar?',
      '1 - Solo bloquear IA (puede seguir usando !menu, !hoy, etc.)',
      '2 - Bloquear todo (IA + menú público)',
      '0 - Cancelar',
    ].join('\n');
  }

  private async handleBanTypeStep(userId: string, cleaned: string): Promise<string> {
    const lowered = cleaned.trim().toLowerCase();
    if (lowered === '0') {
      this.pendingBanData.delete(userId);
      this.pendingAdminState.delete(userId);
      return 'Baneo cancelado.';
    }

    const banData = this.pendingBanData.get(userId);
    if (!banData?.phone) {
      this.pendingBanData.delete(userId);
      this.pendingAdminState.delete(userId);
      return 'Error: faltan datos. Volvé a intentar desde el menú.';
    }

    if (lowered !== '1' && lowered !== '2') {
      return 'Elegí 1 (solo IA), 2 (bloqueo total) o 0 (cancelar).';
    }

    const phone = banData.phone;
    // Construir los posibles JIDs del usuario a banear
    const jidOptions = [
      `${phone}@s.whatsapp.net`,
      `${phone}@lid`,
    ];

    const banUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 año
    let bannedCount = 0;

    for (const jid of jidOptions) {
      const state = await this.moderationRepository.getOrCreate(jid);
      if (lowered === '2') {
        // Bloqueo total: baneo por semana extendido + flag ai_only = false
        state.week_ban_until = banUntil;
        state.temp_ban_until = banUntil;
      } else {
        // Solo IA: solo se bloquea en rate limit (temp_ban para IA, pero se marca diferente)
        // Usamos temp_ban_until como señal de baneo de IA únicamente
        state.temp_ban_until = banUntil;
        state.week_ban_until = null; // No bloquear el menú público
      }
      state.warning_count = 99; // Marcar como baneado manual
      await this.moderationRepository.save(state);
      bannedCount++;
    }

    this.pendingBanData.delete(userId);
    this.pendingAdminState.delete(userId);

    const typeLabel = lowered === '2' ? 'bloqueo total (IA + menú)' : 'solo IA';
    return `🚫 Usuario ${phone} baneado (${typeLabel}) por 365 días ✅\n\nPara desbanear, usá la opción 7 del menú admin.`;
  }

  // PHASE 4: Group Context Configuration Flow (executed from group via !config-grupo)
  public async startGroupContextConfiguration(userId: string, groupId: string): Promise<string> {
    if (!this.groupContextRepository || !this.commissionRepository) {
      return '❌ Servicio de configuración de grupo no disponible.';
    }

    const pending: PendingGroupContextData = { groupId, year: undefined, commission_id: null };
    this.pendingGroupContextData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_group_context_year');

    const currentYear = new Date().getFullYear();
    return [
      `📋 Configuración del grupo para comisiones`,
      '',
      `Grupo ID: ${groupId}`,
      '',
      `Primero, ¿en qué año académico están los estudiantes? (ej: ${currentYear}, ${currentYear + 1}, etc)`,
    ].join('\n');
  }

  private handleGroupContextYear(userId: string, cleaned: string): string {
    const yearStr = cleaned.trim();
    if (!/^\d{4}$/.test(yearStr)) {
      return 'Necesito un año válido (4 dígitos, ej: 2024).';
    }

    const year = Number(yearStr);
    if (year < 2000 || year > 2100) {
      return 'Año fuera de rango. Usa un año entre 2000 y 2100.';
    }

    const pending = this.pendingGroupContextData.get(userId) || {};
    pending.year = year;
    this.pendingGroupContextData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_group_context_commission');

    return [
      `✅ Año académico: ${year}`,
      '',
      `Ahora, ¿a qué comisión pertenece este grupo?`,
      `Respondé el nombre/número (ej: A, B, 1, 2, Única) o "0" para no asignar comisión específica (aplica a todas).`,
    ].join('\n');
  }

  private async handleGroupContextCommission(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingGroupContextData.get(userId);
    if (!pending?.groupId || !pending.year) {
      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);
      return '❌ Faltan datos. Intenta de nuevo desde el grupo con !config-grupo.';
    }

    const commissionName = cleaned.trim().toLowerCase();

    let commissionId: number | null = null;

    if (commissionName !== '0' && commissionName !== 'todas' && commissionName !== 'ninguna') {
      // Buscar o crear comisión
      if (!this.commissionRepository) {
        this.pendingGroupContextData.delete(userId);
        this.pendingAdminState.delete(userId);
        return '❌ Repositorio de comisiones no disponible.';
      }

      commissionId = await this.commissionRepository.createOrGet(commissionName.toUpperCase(), pending.year);
    }

    // Guardar contexto de grupo
    if (!this.groupContextRepository) {
      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);
      return '❌ Repositorio de contexto no disponible.';
    }

    const label = commissionId ? `${pending.year} - Comisión ${commissionName.toUpperCase()}` : `${pending.year} - Global`;

    await this.groupContextRepository.upsert(
      pending.groupId,
      pending.year,
      commissionId,
      label,
      userId
    );

    this.pendingGroupContextData.delete(userId);
    this.pendingAdminState.delete(userId);

    return [
      '✅ Contexto del grupo actualizado exitosamente',
      '',
      `📅 Año: ${pending.year}`,
      `📌 Comisión: ${commissionId ? commissionName.toUpperCase() : 'Global (aplica a todas)'}`,
      '',
      'El bot ahora filtrará clases y horarios según esta configuración.',
    ].join('\n');
  }

  private pickOne(options: string[]): string {
    return options[Math.floor(Math.random() * options.length)];
  }

  private parseDayMonth(value: string): Date | null {
    const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = new Date().getFullYear();
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }
}
