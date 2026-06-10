import crypto from 'crypto';
import { DynamicMessageService } from '../../features/messages/dynamic-message.service.js';
import { ManagedExam, ManagedClassCreateInput, ManagedTeacherCreateInput } from '../../domain/models.js';
import { InstitutionalNotice } from '../../features/notifications/notifications.models.js';
import {
  AdminRepository,
  AdminVerificationCodeRepository,
  ManagedExamRepository,
  ManagedClassRepository,
  ManagedTeacherRepository,
  UserProfileRepository,
  GroupContextRepository,
  GroupRepository,
  GroupMembershipRepository,
  CohortConfigRepository,
  ClassCommissionScheduleRepository,
  CommissionRepository,
} from '../../infrastructure/persistence/db/repositories.js';
import { InstitutionalNoticeRepository } from '../../features/notifications/notifications.repository.js';
import { UserModerationRepository } from '../../features/moderation/moderation.repository.js';

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
  // edit flow
  editId?: number;
  lastScheduleList?: any[];
  selectedScheduleId?: number;
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
  commission_count?: number;
  commission_ids?: number[];
  commission_names?: string[];
  subjects?: string[];
  subjectIndex?: number;
  commissionIndex?: number;
  inScopedAdminMenu?: boolean;
  lastGroupList?: string[];
  currentSubject?: string;
  currentCommissionId?: number;
  expectedDeleteConfirm?: string;
  lastUserList?: any[];
  targetUserId?: string;
  lastCommissionList?: any[];
}

export class PrivateChatWorkflowService {
  private static readonly PROFILE_STATES = new Set([
    'await_user_profile_welcome',
    'await_user_profile_name',
    'await_user_profile_birthday',
    'await_user_profile_email',
    'await_user_commission_selection',
    'await_user_profile_confirmation',
  ]);
  private static readonly ADMIN_MODE_HINTS = [
    'Estoy en modo admin. Mandame menu y te muestro las funciones.',
    'Seguimos en modo admin. Si querés ver las opciones escribi menu.',
    'Modo admin activo. Escribí menu para ver el panel.',
  ];
  private static readonly PRIVATE_ONLY_AFTER_REGISTER = [
    'Ya quedaste registrado/a. Este bot responde solo en el grupo, así que te leo allá con gusto.',
    'Todo listo con tu registro ✅. Por privado ya no puedo responder consultas: te espero en el grupo del ISPC.',
    'Registro completado. El bot está programado para responder solo en el grupo, te espero por ahí.',
  ];
  private static readonly PROFILE_WELCOME_INTROS = [
    '¡Te doy la bienvenida! Vamos a completar tu registro por privado 🙂',
    '¡Hola! Antes de seguir, necesito completar tu registro por privado 🙂',
    '¡Hola! Te doy la bienvenida. Necesito que completemos tus datos por privado para continuar 🙂',
  ];
  private static readonly PROFILE_UPDATE_INTROS = [
    'Debido a una actualización del bot necesito que me mandes unos datos por privado. Muchas gracias 🙂',
    '¡Hola! Por una actualización del bot necesito que me completes algunos datos por privado. Gracias 🙂',
    'Se actualizó el bot y necesito que completes tus datos por privado. Gracias 🙂',
  ];

  private pendingProfiles = new Map<string, PendingProfile>();
  private pendingAdminState = new Map<string, string>();
  private pendingClassData = new Map<string, PendingClassData>();
  private pendingTeacherData = new Map<string, PendingTeacherData>();
  private pendingExamData = new Map<string, PendingExamData>();
  private pendingNoticeData = new Map<string, PendingNoticeData>();
  private pendingNoticeEditData = new Map<string, PendingNoticeEditData>();
  private pendingGroupContextData = new Map<string, PendingGroupContextData>();
  private pendingSuperAdminData = new Map<string, PendingGroupContextData>();
  private postRegistrationWarningShown = new Set<string>();
  private profileUpdateNoticeShown = new Set<string>();
  // Contador de reintentos por campo en el registro (evitar spam loops)
  private registrationRetries = new Map<string, number>();
  private pendingProfileTimestamps = new Map<string, number>();
  private dailyWarningSent = new Map<string, string>(); // userId -> YYYY-MM-DD
  private commissionWarningTimestamps = new Map<string, number>(); // userId:groupId -> timestamp
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
    private cohortConfigRepository?: CohortConfigRepository,
    private groupRepository?: GroupRepository,
    private groupMembershipRepository?: GroupMembershipRepository,
    private classCommissionScheduleRepository?: ClassCommissionScheduleRepository,
  ) {}

  private isProfilePopulated(profile?: { name?: string; birthday_day_month?: string; email?: string; user_commission_id?: number } | null): boolean {
    if (!profile) return false;
    const hasName = !!String(profile.name || '').trim();
    const hasBirthday = !!String(profile.birthday_day_month || '').trim();
    const hasEmail = !!String(profile.email || '').trim();
    return hasName && hasBirthday && hasEmail;
  }

  private async handleClassEditSelection(userId: string, cleaned: string): Promise<string> {
    const idxStr = cleaned.trim();
    if (!/^\d+$/.test(idxStr)) return 'Pasame un número válido de la lista.';
    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
    const classes = await this.managedClassRepository.listAll(groupId);
    const idx = Number(idxStr) - 1;
    if (idx < 0 || idx >= classes.length) return `Número inválido. Elegí entre 1 y ${classes.length}.`;
    const cls = classes[idx];
    const pending = this.pendingClassData.get(userId) || {};
    pending.editId = cls.id;
    this.pendingClassData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_class_edit_choice');
    return ['¿Qué querés editar?', '1 - Nombre de la materia', "2 - Día y hora (ej: Lunes 08:30)", '3 - Enlace de Google Meet', '0 - Cancelar'].join('\n');
  }

  private async handleClassEditChoice(userId: string, cleaned: string): Promise<string> {
    const choice = cleaned.trim();
    const pending = this.pendingClassData.get(userId) || {};
    const id = pending.editId;
    if (!id) {
      this.pendingAdminState.delete(userId);
      this.pendingClassData.delete(userId);
      return 'Faltan datos. Volvé a intentar.';
    }

    if (choice === '0' || choice.toLowerCase() === 'cancelar') {
      this.pendingAdminState.delete(userId);
      this.pendingClassData.delete(userId);
      return 'Edición cancelada.';
    }

    if (choice === '1') {
      this.pendingAdminState.set(userId, 'await_class_edit_new_subject');
      return 'Escribí el nuevo nombre de la materia.';
    }

    if (choice === '2') {
      this.pendingAdminState.set(userId, 'await_class_edit_new_time');
      return "Pasame el nuevo día y hora en formato 'Lunes 08:30'.";
    }

    if (choice === '3') {
      this.pendingAdminState.set(userId, 'await_class_edit_new_link');
      return 'Pasame el nuevo enlace (debe comenzar con http).';
    }

    return 'Opción inválida. Elegí 1, 2, 3 o 0 para cancelar.';
  }

  private async handleClassEditNewSubject(userId: string, cleaned: string): Promise<string> {
    const newSubject = cleaned.trim();
    if (!newSubject) return 'El nombre no puede quedar vacío.';
    const pending = this.pendingClassData.get(userId) || {};
    const id = pending.editId;
    if (!id) return 'Faltan datos. Volvé a intentar.';
    await this.managedClassRepository.updateSubject(id, newSubject);
    this.pendingAdminState.delete(userId);
    this.pendingClassData.delete(userId);
    return `Materia actualizada: ${newSubject} ✅`;
  }

  private async handleClassEditNewTime(userId: string, cleaned: string): Promise<string> {
    const txt = cleaned.trim();
    const m = txt.match(/^(\S+)\s+(\d{1,2}:\d{2})$/);
    if (!m) return "Formato inválido. Usá 'Lunes 08:30'.";
    const day = m[1];
    const time = m[2];
    const validDays = ['Lunes','Martes','Miercoles','Jueves','Viernes','lunes','martes','miercoles','jueves','viernes'];
    if (!validDays.includes(day)) return 'Día inválido. Usá Lunes, Martes, Miercoles, Jueves o Viernes.';
    const pending = this.pendingClassData.get(userId) || {};
    const id = pending.editId;
    if (!id) return 'Faltan datos. Volvé a intentar.';
    await this.managedClassRepository.updateSchedule(id, day, time);
    this.pendingAdminState.delete(userId);
    this.pendingClassData.delete(userId);
    return `Horario actualizado: ${day} ${time} ✅`;
  }

  private async handleClassEditNewLink(userId: string, cleaned: string): Promise<string> {
    const link = cleaned.trim();
    if (!link.startsWith('http')) return 'Enlace inválido. Debe comenzar con http.';
    const pending = this.pendingClassData.get(userId) || {};
    const id = pending.editId;
    if (!id) return 'Faltan datos. Volvé a intentar.';
    await this.managedClassRepository.updateMeetLink(id, link);
    this.pendingAdminState.delete(userId);
    this.pendingClassData.delete(userId);
    return `Enlace actualizado ✅`;
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

    if (cleaned.toLowerCase() === 'admin') {
      this.clearPendingData(userId);

      if (await this.adminRepository.isRegistered(userId)) {
        await this.adminRepository.setAuthenticated(userId, true);
        const adminProfile = await this.userProfileRepository.get(userId);
        return `🔓 *¡Bienvenido de nuevo, ${adminProfile?.name || 'Admin'}!*\n\n${await this.enterAdminWorkflow(userId)}`;
      }

      this.pendingAdminState.set(userId, 'await_admin_registration_code');
      return '🔐 *Registro de Administrador*\n\nHola. Para continuar, necesito verificar tu identidad.\n\nMandame el *código de 6 dígitos* que te proporcionaron.';
    }

    // Verificar inactividad de 15 minutos en el registro de estudiante
    const lastInteraction = this.pendingProfileTimestamps.get(userId);
    const now = Date.now();
    const currentState = this.pendingAdminState.get(userId);
    const isRegisterState = currentState && (
      PrivateChatWorkflowService.PROFILE_STATES.has(currentState)
    );

    if (isRegisterState && lastInteraction && (now - lastInteraction > 15 * 60 * 1000)) {
      this.clearPendingData(userId);
      this.pendingProfileTimestamps.delete(userId);
      if (cleaned.toLowerCase() !== '!registrarse' && cleaned.toLowerCase() !== 'registrarse') {
        return 'El proceso de registro se canceló por inactividad (15 minutos) ⏳. Escribí *!registrarse* cuando quieras empezar de nuevo.';
      }
    }

    if (isRegisterState || this.isRegistrationCommand(cleaned)) {
      this.pendingProfileTimestamps.set(userId, now);
    }

    const lowerCleaned = cleaned.toLowerCase().trim();
    if (!isRegisterState && this.isGreetingInvocation(lowerCleaned)) {
      const profile = await this.userProfileRepository.get(userId);
      const missingFields = this.getMissingProfileFields(profile);
      const missingCommissions = await this.getMissingCommissionsForUser(userId);
      if (missingFields.length > 0 || missingCommissions.length > 0) {
        return '¡Hola! Para iniciar tu registro escribí *!registrarse* por privado.';
      }
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
      return 'Este flujo se movió al privado. Escribí Admin por privado para registrar superadmins.';
    }
    return null;
  }

  private async maybeHandleProfileCompletion(userId: string, cleaned: string): Promise<string | null> {
    const currentState = this.pendingAdminState.get(userId);
    if (currentState) {
      if (PrivateChatWorkflowService.PROFILE_STATES.has(currentState)) {
        return this.handleUserRegistrationFlow(userId, cleaned);
      }
      return null;
    }

    const profile = await this.userProfileRepository.get(userId);
    const missingFields = this.getMissingProfileFields(profile);
    const missingCommissions = await this.getMissingCommissionsForUser(userId);
    if (this.isRegistrationCommand(cleaned) && (missingFields.length > 0 || missingCommissions.length > 0)) {
      return this.handleUserRegistrationFlow(userId, cleaned);
    }

    return null;
  }

  private async handleAdminFlow(userId: string, cleaned: string): Promise<string | null> {
    let lowered = cleaned.toLowerCase().trim();
    if (lowered === 'menú') {
      lowered = 'menu';
    }
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
      return `🎉 *¡Registro completo, ${pending.name}!*\n\nAhora tenés acceso al panel de administración.\nEscribí *menu* en cualquier momento para abrirlo.\n\n💡 *Tip de Inicio*: Para que el bot reconozca y publique de forma automática los avisos que envían los profesores desde sus correos institucionales, te sugerimos ir al Menú de Administración -> "5 — Gestionar Profesores" y dar de alta sus correos. 📧`;
    }

    if (currentState === 'await_admin_select_group') {
      const choice = cleaned.trim();
      const data = this.pendingSuperAdminData.get(userId);
      const list = data?.lastGroupList || [];

      if (choice.toLowerCase() === 'menu' || choice === '0' || choice.toLowerCase() === 'salir') {
        this.clearPendingData(userId);
        return 'Modo admin finalizado.';
      }

      if (!/^\d+$/.test(choice)) {
        return 'Opción inválida. Mandá el número del grupo que querés administrar.';
      }

      const idx = Number(choice) - 1;
      if (idx < 0 || idx >= list.length) {
        return `Número inválido. Elegí un número entre 1 y ${list.length}.`;
      }

      const gid = list[idx];
      this.pendingSuperAdminData.set(userId, { groupId: gid, inScopedAdminMenu: true });
      this.pendingAdminState.set(userId, 'super_admin_scoped_admin_main');
      return await this.adminMenuText(userId);
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

    if (currentState === 'await_class_id_to_edit') {
      return this.handleClassEditSelection(userId, cleaned);
    }

    if (currentState === 'await_class_edit_choice') {
      return this.handleClassEditChoice(userId, cleaned);
    }

    if (currentState === 'await_class_edit_new_subject') {
      return this.handleClassEditNewSubject(userId, cleaned);
    }

    if (currentState === 'await_class_edit_new_time') {
      return this.handleClassEditNewTime(userId, cleaned);
    }

    if (currentState === 'await_class_edit_new_link') {
      return this.handleClassEditNewLink(userId, cleaned);
    }

    if (currentState === 'await_class_meet_edit_select_class') {
      return this.handleClassMeetEditSelectClass(userId, cleaned);
    }

    if (currentState === 'await_class_meet_edit_select_commission') {
      return this.handleClassMeetEditSelectCommission(userId, cleaned);
    }

    if (currentState === 'await_class_meet_edit_new_link') {
      return this.handleClassMeetEditNewLink(userId, cleaned);
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

    if (currentState === 'await_group_context_entry_year') {
      return await this.handleGroupContextYear(userId, cleaned);
    }

    if (currentState === 'await_group_context_commission_count') {
      return await this.handleGroupContextCommissionCount(userId, cleaned);
    }

    if (currentState === 'await_group_context_subjects') {
      return await this.handleGroupContextSubjects(userId, cleaned);
    }

    if (currentState === 'await_group_context_subject_schedule') {
      return await this.handleGroupContextSubjectSchedule(userId, cleaned);
    }

    if (currentState === 'await_group_context_subject_teacher') {
      return await this.handleGroupContextSubjectTeacher(userId, cleaned);
    }

    if (currentState === 'await_group_context_emails') {
      return await this.handleGroupContextEmails(userId, cleaned);
    }

    // Super Admin menu handlers
    if (currentState === 'super_admin_main') {
      if (lowered === '1') {
        const groups = this.groupRepository ? await this.groupRepository.findAll() : [];
        if (!groups || groups.length === 0) return 'No hay grupos registrados.';
        // Agrupar por entry_year (cohorte) y ordenar: años asc, 'General' al final
        const grouped: Record<string, any[]> = {};
        for (const g of groups) {
          const key = g.entry_year ? String(g.entry_year) : 'General';
          grouped[key] = grouped[key] || [];
          grouped[key].push(g);
        }
        const years = Object.keys(grouped).filter((k) => k !== 'General').sort((a, b) => Number(a) - Number(b));
        if (grouped['General']) years.push('General');
        const parts: string[] = [];
        // guardar lista para selección por número
        const flatList: string[] = [];
        for (const y of years) {
          parts.push(y === 'General' ? 'General:' : `Cohorte ${y}:`);
          const list = grouped[y].sort((a, b) => (a.display_name || a.group_id).localeCompare(b.display_name || b.group_id));
          for (const g of list) {
            flatList.push(g.group_id);
            parts.push(`- ${flatList.length} - ${g.display_name || g.group_id} (${g.group_id})`);
          }
        }
        // almacenar en pendingSuperAdminData para seleccionar por número
        this.pendingSuperAdminData.set(userId, { ...(this.pendingSuperAdminData.get(userId) || {}), lastGroupList: flatList });
        this.pendingAdminState.set(userId, 'super_admin_listed_groups');
        parts.push('', 'Escribí el número del grupo para seleccionarlo, o "menu" para volver.');
        return parts.join('\n');
      }

      if (lowered === '2') {
        this.pendingAdminState.set(userId, 'super_admin_cohort_main');
        return this.superAdminCohortMenuText(userId);
      }

      if (lowered === '3') {
        if (!this.groupRepository) return 'Repositorio de grupos no disponible.';
        const groups = await this.groupRepository.findAll();
        const without = groups.filter((g) => g.entry_year == null);
        if (!without.length) return 'No hay grupos sin cohorte. ✅';
        return ['Grupos sin cohorte:', ...without.map((g) => `- ${g.display_name || g.group_id} (${g.group_id})`)].join('\n');
      }

      if (lowered === '0' || lowered === 'menu') {
        this.pendingAdminState.delete(userId);
        return this.adminMenuText(userId);
      }

      return this.superAdminMenuText(userId);
    }

    if (currentState === 'super_admin_scoped_admin_main') {
      const data = this.pendingSuperAdminData.get(userId);
      const gid = data?.groupId;
      if (!gid) {
        this.pendingAdminState.delete(userId);
        return 'No hay grupo seleccionado. Volvé a iniciar con admin-grupos.';
      }

      if (lowered === '0' || lowered === 'menu') {
        const isSuperAdmin = typeof (this.adminRepository as any).isSuperAdmin === 'function'
          ? await (this.adminRepository as any).isSuperAdmin(userId)
          : !!(await this.adminRepository.get(userId))?.is_super_admin;

        if (isSuperAdmin) {
          data.inScopedAdminMenu = false;
          this.pendingSuperAdminData.set(userId, data);
          this.pendingAdminState.set(userId, 'super_admin_manage_group');
          return await this.superAdminManageGroupMenuText(gid);
        } else {
          // Normal admin
          const adminGroups = await this.adminRepository.listAdminGroups(userId);
          if (adminGroups.length <= 1) {
            this.clearPendingData(userId);
            return 'Modo admin finalizado.';
          } else {
            // Ir al menú de selección de grupo
            this.pendingSuperAdminData.set(userId, { lastGroupList: adminGroups } as any);
            this.pendingAdminState.set(userId, 'await_admin_select_group');
            
            const parts: string[] = ['🔐 *Selección de Grupo* \n\nElegí el número del grupo que querés administrar:'];
            for (let i = 0; i < adminGroups.length; i++) {
              const gid = adminGroups[i];
              let label = gid;
              if (this.groupRepository) {
                const g = await this.groupRepository.findByGroupId(gid);
                if (g) {
                  label = g.display_name || gid;
                }
              }
              parts.push(`${i + 1} - ${label}`);
            }
            return parts.join('\n');
          }
        }
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

      return 'Opción inválida. Escribí 0 para volver o seleccioná una opción del 1 al 8.';
    }

    if (currentState === 'super_admin_await_select_group') {
      const gid = cleaned.trim();
      if (lowered === 'menu' || lowered === '0' || lowered === 'volver') {
        this.pendingAdminState.set(userId, 'super_admin_main');
        return this.superAdminMenuText(userId);
      }
      const group = this.groupRepository ? await this.groupRepository.findByGroupId(gid) : null;
      if (!group) {
        return 'No encontré ese grupo. Ingresá otro JID, o escribí "menu" para volver:';
      }
      // Si el grupo no tiene cohorte definida preguntar qué hacer
      this.pendingSuperAdminData.set(userId, { groupId: gid });
      if (group.entry_year == null) {
        this.pendingAdminState.set(userId, 'super_admin_handle_group_without_cohort');
        return [
          `El grupo ${group.display_name || gid} no tiene cohorte registrada. Qué querés hacer?`,
          '',
          '1 - Registrar cohorte ahora',
          '2 - Marcar como General (no cohorte)',
          '3 - Cancelar/Salir',
        ].join('\n');
      }
      this.pendingAdminState.set(userId, 'super_admin_manage_group');
      return await this.superAdminManageGroupMenuText(gid);
    }

    if (currentState === 'super_admin_listed_groups') {
      let cmd = cleaned.trim().toLowerCase();
      if (cmd === 'menú') {
        cmd = 'menu';
      }
      if (cmd === 'menu' || cmd === '0') {
        this.pendingAdminState.set(userId, 'super_admin_main');
        return this.superAdminMenuText(userId);
      }
      // si el usuario pide ir a seleccionar por JID
      if (cmd === 'seleccionar' || cmd === 'seleccionar grupo') {
        this.pendingAdminState.set(userId, 'super_admin_await_select_group');
        return 'Ingresá el group_id (JID) del grupo que querés administrar:';
      }
      // intentar interpretar como número de lista
      if (/^\d+$/.test(cmd)) {
        const idx = Number(cmd) - 1;
        const data = this.pendingSuperAdminData.get(userId) || {} as any;
        const list: string[] = data?.lastGroupList || [];
        if (idx < 0 || idx >= list.length) {
          return `Número inválido. Enviá un número entre 1 y ${list.length}, o 'menu' para volver.`;
        }
        const gid = list[idx];
        // verificar cohorte para mantener mismo comportamiento que seleccionar por JID
        const group = this.groupRepository ? await this.groupRepository.findByGroupId(gid) : null;
        this.pendingSuperAdminData.set(userId, { ...(this.pendingSuperAdminData.get(userId) || {}), groupId: gid });
        if (group && group.entry_year == null) {
          this.pendingAdminState.set(userId, 'super_admin_handle_group_without_cohort');
          return [
            `El grupo ${group.display_name || gid} no tiene cohorte registrada. Qué querés hacer?`,
            '',
            '1 - Registrar cohorte ahora',
            '2 - Marcar como General (no cohorte)',
            '3 - Cancelar/Salir',
          ].join('\n');
        }
        this.pendingAdminState.set(userId, 'super_admin_manage_group');
        return await this.superAdminManageGroupMenuText(gid);
      }
      return 'Comando inválido. Escribí el número del grupo para seleccionarlo, o "menu" para volver.';
    }

    if (currentState === 'super_admin_handle_group_without_cohort') {
      const choice = cleaned.trim().toLowerCase();
      const data = this.pendingSuperAdminData.get(userId);
      const gid = data?.groupId;
      if (!gid) {
        this.pendingAdminState.delete(userId);
        return 'No hay grupo seleccionado. Volvé a iniciar con admin-grupos.';
      }

      if (choice === '1' || choice === 'registrar' || choice === 'r') {
        // Reusar estado de edición de entry_year
        this.pendingAdminState.set(userId, 'super_admin_edit_entry_year');
        return 'Ingresá el año (4 dígitos) o escribí "general" para marcar como general:';
      }

      if (choice === '2' || choice === 'general' || choice === 'g') {
        if (!this.groupRepository) return 'Repositorio de grupos no disponible.';
        await this.groupRepository.updateEntryYear(gid, null);
        this.pendingAdminState.set(userId, 'super_admin_manage_group');
        const menuText = await this.superAdminManageGroupMenuText(gid);
        return `Grupo ${gid} marcado como "General".\n\n${menuText}`;
      }

      // cancelar o cualquier otro
      this.pendingAdminState.set(userId, 'super_admin_main');
      const saMenu = await this.superAdminMenuText(userId);
      return `Operación cancelada. Volviendo al menú Super-Admin.\n\n${saMenu}`;
    }

    if (currentState === 'super_admin_manage_group') {
      const data = this.pendingSuperAdminData.get(userId);
      const gid = data?.groupId;
      if (!gid) {
        this.pendingAdminState.delete(userId);
        return 'No hay grupo seleccionado. Volvé a iniciar con admin-grupos.';
      }

      if (lowered === '1') {
        this.pendingAdminState.set(userId, 'super_admin_edit_entry_year');
        return 'Ingresá el año (4 dígitos) o escribí "general" para marcar como general:';
      }

      if (lowered === '2') {
        if (!this.groupRepository) return 'Repositorio de grupos no disponible.';
        const grp = await this.groupRepository.findByGroupId(gid);
        const newState = !(grp?.is_active ?? false);
        await this.groupRepository.setActive(gid, newState);
        const menuText = await this.superAdminManageGroupMenuText(gid);
        return `Grupo ${gid} ahora está ${newState ? 'activo' : 'inactivo'}.\n\n${menuText}`;
      }

      if (lowered === '3') {
        if (!this.groupMembershipRepository) return 'Repositorio de membresías no disponible.';
        const list = await this.groupMembershipRepository.listByGroup(gid);
        if (!list || list.length === 0) return 'No hay miembros registrados en este grupo.';
        return list.map((m) => `- ${m.user_id} | ${m.role} | active=${m.is_active ? 'sí' : 'no'}`).join('\n');
      }

      if (lowered === '4') {
        const cfg = await this.startGroupContextConfiguration(userId, gid);
        return `Se inició re-onboarding por privado:\n\n${cfg}`;
      }

      if (lowered === '5') {
        // Promote user to group admin flow with pagination
        const users = await this.userProfileRepository.listAll();
        if (!users || users.length === 0) return 'No hay usuarios registrados para promover.';
        const sorted = users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        this.pendingSuperAdminData.set(userId, { groupId: gid, users: JSON.stringify(sorted), page: 0 } as any);
        this.pendingAdminState.set(userId, 'super_admin_promote_select');
        return this.renderPromoteUsersPage(userId);
      }

      if (lowered === '6') {
        // Demote a group admin
        if (!this.adminRepository) return 'Repositorio de admins no disponible.';
        const admins = await this.adminRepository.listGroupAdmins(gid);
        if (!admins || admins.length === 0) return 'No hay admins de grupo para quitar.';
        this.pendingSuperAdminData.set(userId, { groupId: gid, admins: JSON.stringify(admins) } as any);
        this.pendingAdminState.set(userId, 'super_admin_demote_select');
        const list = admins.map((a, i) => `${i + 1} - ${a.user_id}`);
        return ['Elegí el número del Admin de Grupo a quitar:', ...list].join('\n');
      }

      if (lowered === '7') {
        data.inScopedAdminMenu = true;
        this.pendingSuperAdminData.set(userId, data);
        this.pendingAdminState.set(userId, 'super_admin_scoped_admin_main');
        return this.adminMenuText(userId);
      }

      if (lowered === '8') {
        this.pendingAdminState.set(userId, 'super_admin_edit_display_name');
        return 'Ingresá el nuevo nombre de apoyo (referencia interna) para este grupo:';
      }

      if (lowered === '9') {
        if (!this.groupRepository) return 'Repositorio de grupos no disponible.';
        const group = await this.groupRepository.findByGroupId(gid);
        if (!group) return 'No se encontró el grupo.';
        const displayName = group.display_name || gid;
        this.pendingSuperAdminData.set(userId, { ...data, groupId: gid, expectedDeleteConfirm: displayName });
        this.pendingAdminState.set(userId, 'super_admin_confirm_delete_group');
        return `⚠️ *ATENCIÓN*: Esto eliminará TODA la información del grupo (materias, exámenes, profesores, membresías, admins de grupo, contexto de comisiones) y el bot abandonará el grupo.\n\nPara confirmar, escribí el nombre del grupo exacto: "${displayName}"\nO escribí "cancelar" para volver.`;
      }

      if (lowered === '10') {
        if (!this.groupMembershipRepository) return 'Repositorio de membresías no disponible.';
        const list = await this.groupMembershipRepository.listByGroup(gid);
        if (!list || list.length === 0) return 'No hay miembros registrados en este grupo.';
        
        this.pendingSuperAdminData.set(userId, { ...data, groupId: gid, lastUserList: list });
        this.pendingAdminState.set(userId, 'super_admin_change_commission_select_user');
        
        const parts: string[] = ['Seleccioná el número del usuario a cambiar de comisión:'];
        for (let i = 0; i < list.length; i++) {
          const u = list[i];
          let commissionLabel = 'Sin asignar';
          if (u.commission_id && this.commissionRepository) {
            const comm = await this.commissionRepository.getById(u.commission_id);
            if (comm) {
              commissionLabel = comm.name;
            }
          }
          parts.push(`${i + 1} - ${u.user_id} (${u.role}) - Comisión actual: ${commissionLabel}`);
        }
        parts.push('', 'Escribí el número o "cancelar" para volver.');
        return parts.join('\n');
      }

      if (lowered === '0' || lowered === 'menu' || lowered === 'volver') {
        this.pendingAdminState.set(userId, 'super_admin_main');
        return await this.superAdminMenuText(userId);
      }

      return 'Opción inválida. Elegí una opción del menú.';
    }

    if (currentState === 'super_admin_edit_entry_year') {
      const data = this.pendingSuperAdminData.get(userId);
      const gid = data?.groupId;
      if (!gid) return 'No hay grupo seleccionado.';
      const val = cleaned.trim().toLowerCase();
      if (val === 'general') {
        if (!this.groupRepository) return 'Repositorio de grupos no disponible.';
        await this.groupRepository.updateEntryYear(gid, null);
        this.pendingAdminState.set(userId, 'super_admin_manage_group');
        const menuText = await this.superAdminManageGroupMenuText(gid);
        return `Entry_year del grupo ${gid} actualizado a "general".\n\n${menuText}`;
      }
      if (!/^\d{4}$/.test(val)) return 'Año inválido. Escribí 4 dígitos o "general".';
      const year = Number(val);
      if (!this.groupRepository) return 'Repositorio de grupos no disponible.';
      await this.groupRepository.updateEntryYear(gid, year);
      this.pendingAdminState.set(userId, 'super_admin_manage_group');
      const menuText = await this.superAdminManageGroupMenuText(gid);
      return `Entry_year del grupo ${gid} actualizado a ${year}.\n\n${menuText}`;
    }

    if (currentState === 'super_admin_edit_display_name') {
      const data = this.pendingSuperAdminData.get(userId);
      const gid = data?.groupId;
      if (!gid) return 'No hay grupo seleccionado.';
      const newName = cleaned.trim();
      if (!newName) return 'El nombre de apoyo no puede estar vacío.';
      if (!this.groupRepository) return 'Repositorio de grupos no disponible.';
      await this.groupRepository.updateDisplayName(gid, newName);
      this.pendingAdminState.set(userId, 'super_admin_manage_group');
      const menuText = await this.superAdminManageGroupMenuText(gid);
      return `Nombre de apoyo para el grupo ${gid} actualizado a "${newName}".\n\n${menuText}`;
    }

    if (currentState === 'super_admin_confirm_delete_group') {
      const data = this.pendingSuperAdminData.get(userId);
      const gid = data?.groupId;
      if (!gid) {
        this.pendingAdminState.delete(userId);
        return 'No hay grupo seleccionado.';
      }
      const val = cleaned.trim().toLowerCase();
      if (val === 'cancelar' || val === '0' || val === 'volver') {
        this.pendingAdminState.set(userId, 'super_admin_manage_group');
        return await this.superAdminManageGroupMenuText(gid);
      }
      const expected = (data?.expectedDeleteConfirm || '').trim().toLowerCase();
      if (val === expected) {
        if (this.managedClassRepository) {
          await this.managedClassRepository.deleteAllByGroupId(gid);
        }
        if (this.examsRepository) {
          await this.examsRepository.deleteAllByGroupId(gid);
        }
        if (this.managedTeacherRepository) {
          await this.managedTeacherRepository.deleteAllByGroupId(gid);
        }
        if (this.groupMembershipRepository) {
          await this.groupMembershipRepository.deleteAllByGroupId(gid);
        }
        if (this.adminRepository) {
          await this.adminRepository.removeAllGroupAdmins(gid);
        }
        if (this.groupContextRepository) {
          const ctx = await this.groupContextRepository.getByGroupId(gid);
          if (ctx && ctx.id) {
            await this.groupContextRepository.removeCommissionsForGroupContext(ctx.id);
            await this.groupContextRepository.delete(gid);
          }
        }
        if (this.groupRepository) {
          await this.groupRepository.delete(gid);
        }

        this.pendingAdminState.set(userId, 'super_admin_main');
        const saMenu = await this.superAdminMenuText(userId);
        return `✅ Grupo eliminado exitosamente. Se borraron todos los datos asociados.\n[BOT_LEAVE_GROUP::${gid}]\n\n${saMenu}`;
      } else {
        return `⚠️ Nombre incorrecto. Escribí exactamente "${data?.expectedDeleteConfirm}" para confirmar la eliminación, o "cancelar" para volver.`;
      }
    }

    if (currentState === 'super_admin_change_commission_select_user') {
      const data = this.pendingSuperAdminData.get(userId);
      const gid = data?.groupId;
      if (!gid) {
        this.pendingAdminState.delete(userId);
        return 'No hay grupo seleccionado.';
      }
      const choice = cleaned.trim().toLowerCase();
      if (choice === 'cancelar' || choice === '0' || choice === 'volver') {
        this.pendingAdminState.set(userId, 'super_admin_manage_group');
        return await this.superAdminManageGroupMenuText(gid);
      }
      if (!/^\d+$/.test(choice)) {
        return 'Número inválido. Elegí un número de la lista, o "cancelar" para volver.';
      }
      const list = data?.lastUserList || [];
      const idx = Number(choice) - 1;
      if (idx < 0 || idx >= list.length) {
        return `Número inválido. Elegí un número entre 1 y ${list.length}.`;
      }
      const targetUser = list[idx];

      if (!this.groupContextRepository || !this.commissionRepository) {
        return 'Repositorio no disponible.';
      }
      const context = await this.groupContextRepository.getByGroupId(gid);
      if (!context || !context.id) {
        return 'Este grupo no tiene configurado un contexto/comisiones. Hacé re-onboarding primero.';
      }
      const commissions = await this.groupContextRepository.listCommissionsForGroupContext(context.id);
      if (!commissions || commissions.length === 0) {
        return 'No hay comisiones asignadas a este grupo.';
      }

      this.pendingSuperAdminData.set(userId, {
        ...data,
        targetUserId: targetUser.user_id,
        lastCommissionList: commissions
      });
      this.pendingAdminState.set(userId, 'super_admin_change_commission_select_commission');

      const parts = [`Seleccioná la nueva comisión para ${targetUser.user_id}:`];
      for (let i = 0; i < commissions.length; i++) {
        parts.push(`${i + 1} - ${commissions[i].name}`);
      }
      parts.push('', 'Escribí el número de comisión, o "cancelar" para volver.');
      return parts.join('\n');
    }

    if (currentState === 'super_admin_change_commission_select_commission') {
      const data = this.pendingSuperAdminData.get(userId);
      const gid = data?.groupId;
      const targetUserId = data?.targetUserId;
      if (!gid || !targetUserId) {
        this.pendingAdminState.delete(userId);
        return 'No hay grupo o usuario seleccionado.';
      }
      const choice = cleaned.trim().toLowerCase();
      if (choice === 'cancelar' || choice === '0' || choice === 'volver') {
        this.pendingAdminState.set(userId, 'super_admin_manage_group');
        return await this.superAdminManageGroupMenuText(gid);
      }
      if (!/^\d+$/.test(choice)) {
        return 'Número inválido. Elegí un número de la lista, o "cancelar" para volver.';
      }
      const list = data?.lastCommissionList || [];
      const idx = Number(choice) - 1;
      if (idx < 0 || idx >= list.length) {
        return `Número inválido. Elegí un número entre 1 y ${list.length}.`;
      }
      const selectedCommission = list[idx];

      if (!this.groupMembershipRepository) {
        return 'Repositorio de membresías no disponible.';
      }

      await this.groupMembershipRepository.setCommission(gid, targetUserId, selectedCommission.id);

      this.pendingAdminState.set(userId, 'super_admin_manage_group');
      const menuText = await this.superAdminManageGroupMenuText(gid);
      return `✅ Comisión de ${targetUserId} cambiada exitosamente a: ${selectedCommission.name}.\n\n${menuText}`;
    }

    // Cohort management menu
    if (currentState === 'super_admin_cohort_main') {
      if (lowered === '1') {
        if (!this.cohortConfigRepository) return 'Repositorio de cohortes no disponible.';
        const list = await this.cohortConfigRepository.listAll();
        if (!list || list.length === 0) return 'No hay cohortes configuradas.';
        return list.map((c) => `- ${c.entry_year} | configs=${c.configs_json}`).join('\n');
      }

      if (lowered === '2') {
        this.pendingAdminState.set(userId, 'super_admin_await_cohort_year');
        return 'Ingresá el año de la cohorte (ej: 2024) para crear/editar configuración:';
      }

      if (lowered === '3') {
        this.pendingAdminState.set(userId, 'super_admin_await_cohort_select');
        return 'Ingresá el año de la cohorte (ej: 2024) que querés gestionar:';
      }

      if (lowered === '0' || lowered === 'menu') {
        this.pendingAdminState.set(userId, 'super_admin_main');
        return this.superAdminMenuText(userId);
      }

      return this.superAdminCohortMenuText(userId);
    }

    if (currentState === 'super_admin_await_cohort_year') {
      const val = cleaned.trim();
      if (lowered === 'menu' || lowered === '0' || lowered === 'volver') {
        this.pendingAdminState.set(userId, 'super_admin_cohort_main');
        return this.superAdminCohortMenuText(userId);
      }
      if (!/^\d{4}$/.test(val)) {
        return 'Año inválido. Ingresá un año de 4 dígitos, o escribí "menu" para volver:';
      }
      const year = Number(val);
      // ensure repo
      if (!this.cohortConfigRepository) return 'Repositorio de cohortes no disponible.';
      // ensure exists or create default
      const existing = await this.cohortConfigRepository.getByYear(year);
      if (!existing) {
        await this.cohortConfigRepository.upsertByYear(year, JSON.stringify({ emails: [], settings: {} }));
      }
      this.pendingSuperAdminData.set(userId, { groupId: String(year) });
      this.pendingAdminState.set(userId, 'super_admin_manage_cohort');
      return `Cohorte ${year} seleccionada.\n1 - Gestionar emails\n2 - Gestionar avisos (pendiente)\n3 - Gestionar examenes (pendiente)\n0 - Volver`;
    }

    if (currentState === 'super_admin_await_cohort_select') {
      const val = cleaned.trim();
      if (lowered === 'menu' || lowered === '0' || lowered === 'volver') {
        this.pendingAdminState.set(userId, 'super_admin_cohort_main');
        return this.superAdminCohortMenuText(userId);
      }
      if (!/^\d{4}$/.test(val)) {
        return 'Año inválido. Ingresá un año de 4 dígitos, o escribí "menu" para volver:';
      }
      const year = Number(val);
      if (!this.cohortConfigRepository) return 'Repositorio de cohortes no disponible.';
      const existing = await this.cohortConfigRepository.getByYear(year);
      if (!existing) {
        return `No existe configuración para ${year}. Podés crearla con la opción 2 del menú, o escribí "menu" para volver:`;
      }
      this.pendingSuperAdminData.set(userId, { groupId: String(year) });
      this.pendingAdminState.set(userId, 'super_admin_manage_cohort');
      return `Cohorte ${year} seleccionada.\n1 - Gestionar emails\n2 - Gestionar avisos (pendiente)\n3 - Gestionar examenes (pendiente)\n0 - Volver`;
    }

    if (currentState === 'super_admin_manage_cohort') {
      const data = this.pendingSuperAdminData.get(userId);
      const yearStr = data?.groupId;
      if (!yearStr) {
        this.pendingAdminState.delete(userId);
        return 'No hay cohorte seleccionada.';
      }
      const year = Number(yearStr);
      if (lowered === '1') {
        this.pendingAdminState.set(userId, 'super_admin_cohort_emails');
        return 'Cohorte emails:\n1 - Listar\n2 - Agregar\n3 - Quitar\n0 - Volver';
      }
      if (lowered === '2') {
        this.pendingAdminState.set(userId, 'super_admin_cohort_notices');
        return 'Cohorte avisos:\n1 - Listar\n2 - Agregar\n3 - Quitar\n0 - Volver';
      }
      if (lowered === '3') {
        this.pendingAdminState.set(userId, 'super_admin_cohort_exams');
        return 'Cohorte examenes:\n1 - Listar\n2 - Agregar\n3 - Quitar\n0 - Volver';
      }
      if (lowered === '0') {
        this.pendingAdminState.set(userId, 'super_admin_cohort_main');
        return this.superAdminCohortMenuText(userId);
      }
      return 'Opción inválida.';
    }

    if (currentState === 'super_admin_cohort_emails') {
      const data = this.pendingSuperAdminData.get(userId);
      const year = Number(data?.groupId);
      if (!this.cohortConfigRepository) return 'Repositorio de cohortes no disponible.';
      if (lowered === '1') {
        const cfg = await this.cohortConfigRepository.getByYear(year);
        if (!cfg) return 'No hay configuración para esa cohorte.';
        const parsed = JSON.parse(cfg.configs_json || '{}');
        const emails = parsed.emails || [];
        if (emails.length === 0) return 'No hay emails configurados para esta cohorte.';
        return emails.map((e: any, i: number) => `${i + 1} - ${e.label} | ${e.email}`).join('\n');
      }
      if (lowered === '2') {
        this.pendingAdminState.set(userId, 'super_admin_cohort_emails_add');
        return 'Ingresá nuevo email en formato: etiqueta|email (ej: contacto|soporte@ispc.edu.ar)';
      }
      if (lowered === '3') {
        const cfg = await this.cohortConfigRepository.getByYear(Number(data?.groupId));
        if (!cfg) return 'No hay configuración para esa cohorte.';
        const parsed = JSON.parse(cfg.configs_json || '{}');
        const emails = parsed.emails || [];
        if (emails.length === 0) return 'No hay emails para quitar.';
        const list = emails.map((e: any, i: number) => `${i + 1} - ${e.label} | ${e.email}`);
        this.pendingProfiles.set(userId, { name: JSON.stringify(emails) });
        this.pendingAdminState.set(userId, 'super_admin_cohort_emails_remove');
        return ['Elegí número a quitar:', ...list].join('\n');
      }
      if (lowered === '0') {
        this.pendingAdminState.set(userId, 'super_admin_manage_cohort');
        return `Volviendo...`;
      }
      return 'Opción inválida.';
    }

    if (currentState === 'super_admin_cohort_emails_add') {
      const data = this.pendingSuperAdminData.get(userId);
      const year = Number(data?.groupId);
      const parts = cleaned.split('|').map((s) => s.trim());
      if (parts.length !== 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parts[1])) return 'Formato inválido. Usa etiqueta|email.';
      const label = parts[0];
      const email = parts[1];
      if (!this.cohortConfigRepository) return 'Repositorio de cohortes no disponible.';
      const cfg = await this.cohortConfigRepository.getByYear(year);
      const parsed = cfg ? JSON.parse(cfg.configs_json || '{}') : { emails: [], settings: {} };
      parsed.emails = parsed.emails || [];
      parsed.emails.push({ label, email });
      await this.cohortConfigRepository.upsertByYear(year, JSON.stringify(parsed));
      this.pendingAdminState.set(userId, 'super_admin_cohort_emails');
      return `Email ${email} agregado a la cohorte ${year}.`;
    }

    if (currentState === 'super_admin_cohort_emails_remove') {
      const idx = Number(cleaned.trim());
      const emailsStr = this.pendingProfiles.get(userId)?.name;
      if (!emailsStr) return 'Session expirada. Volvé a iniciar.';
      const emails = JSON.parse(emailsStr);
      if (!Number.isFinite(idx) || idx < 1 || idx > emails.length) return 'Número inválido.';
      const removed = emails.splice(idx - 1, 1);
      const data = this.pendingSuperAdminData.get(userId);
      const year = Number(data?.groupId);
      if (!this.cohortConfigRepository) return 'Repositorio de cohortes no disponible.';
      const cfg = await this.cohortConfigRepository.getByYear(year);
      const parsed = cfg ? JSON.parse(cfg.configs_json || '{}') : { emails: [], settings: {} };
      parsed.emails = emails;
      await this.cohortConfigRepository.upsertByYear(year, JSON.stringify(parsed));
      this.pendingAdminState.set(userId, 'super_admin_cohort_emails');
      return `Email ${removed[0].email} removido.`;
    }

    // Cohort notices management
    if (currentState === 'super_admin_cohort_notices') {
      const data = this.pendingSuperAdminData.get(userId);
      const year = Number(data?.groupId);
      if (!this.noticesRepository) return 'Repositorio de avisos no disponible.';
      if (lowered === '1') {
        const list = await this.noticesRepository.listWithIds(200);
        const filtered = list.filter((r) => (r.notice.title || '').startsWith(`[Cohorte ${year}] `));
        if (filtered.length === 0) return 'No hay avisos para esta cohorte.';
        return filtered.map((f) => `${f.id} - ${f.notice.title.replace(`[Cohorte ${year}] `, '')}`).join('\n');
      }
      if (lowered === '2') {
        this.pendingNoticeData.delete(userId);
        this.pendingAdminState.set(userId, 'super_admin_cohort_notices_add_title');
        return 'Nuevo aviso (cohorte). Enviá el título:';
      }
      if (lowered === '3') {
        const list = await this.noticesRepository.listWithIds(200);
        const filtered = list.filter((r) => (r.notice.title || '').startsWith(`[Cohorte ${year}] `));
        if (filtered.length === 0) return 'No hay avisos para quitar en esta cohorte.';
        this.pendingProfiles.set(userId, { name: JSON.stringify(filtered.map((f) => ({ id: f.id, title: f.notice.title }))) });
        this.pendingAdminState.set(userId, 'super_admin_cohort_notices_remove');
        return ['Elegí ID a quitar:', ...filtered.map((f) => `${f.id} - ${f.notice.title.replace(`[Cohorte ${year}] `, '')}`)].join('\n');
      }
      if (lowered === '0') {
        this.pendingAdminState.set(userId, 'super_admin_manage_cohort');
        return `Volviendo...`;
      }
      return 'Opción inválida.';
    }

    if (currentState === 'super_admin_cohort_notices_add_title') {
      const title = cleaned.trim();
      if (!title) return 'El título no puede estar vacío.';
      const pending = this.pendingNoticeData.get(userId) || {};
      pending.title = title;
      this.pendingNoticeData.set(userId, pending);
      this.pendingAdminState.set(userId, 'super_admin_cohort_notices_add_body');
      return 'Ahora enviá el cuerpo del aviso:';
    }

    if (currentState === 'super_admin_cohort_notices_add_body') {
      const body = cleaned.trim();
      if (!body) return 'El cuerpo no puede estar vacío.';
      const pending = this.pendingNoticeData.get(userId) || {};
      pending.body = body;
      this.pendingNoticeData.set(userId, pending);
      this.pendingAdminState.set(userId, 'super_admin_cohort_notices_add_start');
      return 'Fecha de inicio (DD/MM) o "0" para sin fecha:';
    }

    if (currentState === 'super_admin_cohort_notices_add_start') {
      const pending = this.pendingNoticeData.get(userId) || {};
      if (cleaned.trim() === '0') {
        pending.start_date = undefined;
      } else {
        const d = this.parseDayMonth(cleaned);
        if (!d) return 'Fecha inválida. Usa DD/MM o 0.';
        pending.start_date = d;
      }
      this.pendingNoticeData.set(userId, pending);
      this.pendingAdminState.set(userId, 'super_admin_cohort_notices_add_end');
      return 'Fecha de fin (DD/MM) o "0" para sin fin:';
    }

    if (currentState === 'super_admin_cohort_notices_add_end') {
      const pending = this.pendingNoticeData.get(userId);
      if (!pending || !pending.title || !pending.body) {
        this.pendingNoticeData.delete(userId);
        this.pendingAdminState.delete(userId);
        return 'Faltan datos. Volvé a intentarlo.';
      }
      if (cleaned.trim() === '0') {
        pending.end_date = undefined;
      } else {
        const d = this.parseDayMonth(cleaned);
        if (!d) return 'Fecha inválida. Usa DD/MM o 0.';
        pending.end_date = d;
      }
      const data = this.pendingSuperAdminData.get(userId);
      const year = Number(data?.groupId);
      const titlePref = `[Cohorte ${year}] ${pending.title}`;
      const uniqueHash = crypto.createHash('sha256').update(`${titlePref}|${pending.body}|${pending.start_date?.toISOString()||''}|${pending.end_date?.toISOString()||''}`).digest('hex');
      await this.noticesRepository.createIfNew({
        title: titlePref,
        body: pending.body,
        start_date: pending.start_date,
        end_date: pending.end_date,
        event_time: undefined,
        source_email: undefined,
        unique_hash: uniqueHash,
      } as any);
      this.pendingNoticeData.delete(userId);
      this.pendingAdminState.set(userId, 'super_admin_cohort_notices');
      return `Aviso agregado para la cohorte ${year}.`;
    }

    if (currentState === 'super_admin_cohort_notices_remove') {
      const idStr = cleaned.trim();
      if (!/^[0-9]+$/.test(idStr)) return 'ID inválido.';
      const id = Number(idStr);
      const removed = await this.noticesRepository.deleteById(id);
      this.pendingAdminState.set(userId, 'super_admin_cohort_notices');
      return removed ? `Aviso ${id} eliminado.` : 'No encontré ese aviso.';
    }

    // Cohort exams management
    if (currentState === 'super_admin_cohort_exams') {
      const data = this.pendingSuperAdminData.get(userId);
      const year = Number(data?.groupId);
      if (!this.examsRepository) return 'Repositorio de examenes no disponible.';
      if (lowered === '1') {
        const list = await this.examsRepository.listWithIds(200);
        const filtered = list.filter((r) => (r.exam.observations || '').includes(`Cohorte ${year}`));
        if (filtered.length === 0) return 'No hay examenes para esta cohorte.';
        return filtered.map((f) => `${f.id} - ${f.exam.subject} (${f.exam.exam_date.toISOString().slice(0,10)})`).join('\n');
      }
      if (lowered === '2') {
        this.pendingExamData.delete(userId);
        this.pendingAdminState.set(userId, 'super_admin_cohort_exams_add_subject');
        return 'Nuevo examen (cohorte). Enviá la materia:';
      }
      if (lowered === '3') {
        const list = await this.examsRepository.listWithIds(200);
        const filtered = list.filter((r) => (r.exam.observations || '').includes(`Cohorte ${year}`));
        if (filtered.length === 0) return 'No hay examenes para quitar en esta cohorte.';
        this.pendingProfiles.set(userId, { name: JSON.stringify(filtered.map((f) => ({ id: f.id, subject: f.exam.subject }))) });
        this.pendingAdminState.set(userId, 'super_admin_cohort_exams_remove');
        return ['Elegí ID a quitar:', ...filtered.map((f) => `${f.id} - ${f.exam.subject} (${f.exam.exam_date.toISOString().slice(0,10)})`)].join('\n');
      }
      if (lowered === '0') {
        this.pendingAdminState.set(userId, 'super_admin_manage_cohort');
        return `Volviendo...`;
      }
      return 'Opción inválida.';
    }

    if (currentState === 'super_admin_cohort_exams_add_subject') {
      const subj = cleaned.trim();
      if (!subj) return 'La materia no puede quedar vacía.';
      const pending = this.pendingExamData.get(userId) || {};
      pending.subject = subj;
      this.pendingExamData.set(userId, pending);
      this.pendingAdminState.set(userId, 'super_admin_cohort_exams_add_date');
      return 'Fecha (DD/MM):';
    }

    if (currentState === 'super_admin_cohort_exams_add_date') {
      const d = this.parseDayMonth(cleaned);
      if (!d) return 'Fecha inválida. Usa DD/MM.';
      const pending = this.pendingExamData.get(userId) || {};
      pending.exam_date = d;
      this.pendingExamData.set(userId, pending);
      this.pendingAdminState.set(userId, 'super_admin_cohort_exams_add_time');
      return 'Hora (HH:MM):';
    }

    if (currentState === 'super_admin_cohort_exams_add_time') {
      if (!/^[0-2]?\d:\d{2}$/.test(cleaned.trim())) return 'Hora inválida. Usa HH:MM.';
      const pending = this.pendingExamData.get(userId) || {};
      pending.exam_time = cleaned.trim();
      this.pendingExamData.set(userId, pending);
      this.pendingAdminState.set(userId, 'super_admin_cohort_exams_add_type');
      return 'Tipo (parcial/final):';
    }

    if (currentState === 'super_admin_cohort_exams_add_type') {
      const type = cleaned.trim() || 'parcial';
      const pending = this.pendingExamData.get(userId) || {};
      pending.exam_type = type;
      this.pendingExamData.set(userId, pending);
      this.pendingAdminState.set(userId, 'super_admin_cohort_exams_add_obs');
      return 'Observaciones (opcional):';
    }

    if (currentState === 'super_admin_cohort_exams_add_obs') {
      const obs = cleaned.trim();
      const pending = this.pendingExamData.get(userId);
      if (!pending || !pending.subject || !pending.exam_date || !pending.exam_time) {
        this.pendingExamData.delete(userId);
        this.pendingAdminState.delete(userId);
        return 'Faltan datos. Volvé a intentarlo.';
      }
      const data = this.pendingSuperAdminData.get(userId);
      const year = Number(data?.groupId);
      const exam: ManagedExam = {
        subject: pending.subject,
        exam_date: pending.exam_date,
        exam_time: pending.exam_time,
        exam_type: pending.exam_type || 'parcial',
        observations: `${obs || ''} | Cohorte ${year}`,
        created_by: userId,
        tipoDisponibilidad: 'hora-especifica',
        horaInicio: pending.exam_time,
        horaFin: undefined,
        frecuenciaAvisos: '7d,3d,1d,20m',
        exam_commission_id: undefined,
      } as any;
      await this.examsRepository.create(exam);
      this.pendingExamData.delete(userId);
      this.pendingAdminState.set(userId, 'super_admin_cohort_exams');
      return `Examen agregado para la cohorte ${year}.`;
    }

    if (currentState === 'super_admin_cohort_exams_remove') {
      const idStr = cleaned.trim();
      if (!/^[0-9]+$/.test(idStr)) return 'ID inválido.';
      const id = Number(idStr);
      const removed = await this.examsRepository.deleteById(id);
      this.pendingAdminState.set(userId, 'super_admin_cohort_exams');
      return removed ? `Examen ${id} eliminado.` : 'No encontré ese examen.';
    }

    // Promotion selection handler
    if (currentState === 'super_admin_promote_select') {
      const cmd = cleaned.trim().toLowerCase();
      const data = this.pendingSuperAdminData.get(userId) as any;
      const gid = data?.groupId;
      if (!gid) return 'No hay grupo seleccionado.';
      const usersJson = data?.users;
      if (!usersJson) return 'Lista de usuarios no disponible. Reintentá.';
      const users = JSON.parse(usersJson) as any[];
      const page = Number(data?.page || 0);
      const pageSize = 10;

      if (cmd === 'n' || cmd === 'siguiente') {
        data.page = page + 1;
        this.pendingSuperAdminData.set(userId, data);
        return this.renderPromoteUsersPage(userId);
      }
      if (cmd === 'p' || cmd === 'anterior') {
        data.page = Math.max(0, page - 1);
        this.pendingSuperAdminData.set(userId, data);
        return this.renderPromoteUsersPage(userId);
      }

      const sel = Number(cmd);
      if (!Number.isFinite(sel)) return 'Comando inválido. Enviá número, "n" (siguiente) o "p" (anterior).';
      const index = page * pageSize + (sel - 1);
      if (index < 0 || index >= users.length) return 'Seleccion inválida.';
      const target = users[index];
      await this.adminRepository.assignGroupAdmin(target.user_id, gid);
      this.pendingAdminState.set(userId, 'super_admin_manage_group');
      return `Usuario ${target.name} (${target.user_id}) promovido a Admin de Grupo para ${gid}.`;
    }

    // Demotion selection handler
    if (currentState === 'super_admin_demote_select') {
      const sel = Number(cleaned.trim());
      const data = this.pendingSuperAdminData.get(userId) as any;
      const gid = data?.groupId;
      if (!gid) return 'No hay grupo seleccionado.';
      const adminsJson = data?.admins;
      if (!adminsJson) return 'Lista de admins no disponible.';
      const admins = JSON.parse(adminsJson) as any[];
      if (!Number.isFinite(sel) || sel < 1 || sel > admins.length) return 'Seleccion inválida.';
      const target = admins[sel - 1];
      await this.adminRepository.removeGroupAdmin(target.user_id, gid);
      this.pendingAdminState.set(userId, 'super_admin_manage_group');
      return `Usuario ${target.user_id} removido como Admin de Grupo para ${gid}.`;
    }

    if (currentState === 'super_admin_await_reonboard_group') {
      const gid = cleaned.trim();
      if (lowered === 'menu' || lowered === '0' || lowered === 'volver') {
        this.pendingAdminState.set(userId, 'super_admin_main');
        return this.superAdminMenuText(userId);
      }
      const group = this.groupRepository ? await this.groupRepository.findByGroupId(gid) : null;
      if (!group) {
        return 'No encontré ese grupo. Ingresá otro JID para forzar re-onboarding, o escribí "menu" para volver:';
      }
      const cfg = await this.startGroupContextConfiguration(userId, gid);
      this.pendingAdminState.set(userId, 'super_admin_main');
      return `Re-onboarding iniciado por privado:\n\n${cfg}`;
    }

    if (!(await this.adminRepository.isAuthenticated(userId))) {
      return null;
    }

    const isSuperAdmin = typeof (this.adminRepository as any).isSuperAdmin === 'function'
      ? await (this.adminRepository as any).isSuperAdmin(userId)
      : !!(await this.adminRepository.get(userId))?.is_super_admin;

    if (lowered === '!admin-grupos' || lowered === 'admin-grupos') {
      if (!isSuperAdmin) {
        return '❌ No estás autorizado para el menú de administración de grupos.';
      }
      const data = this.pendingSuperAdminData.get(userId);
      if (data) {
        data.inScopedAdminMenu = false;
        this.pendingSuperAdminData.set(userId, data);
      }
      this.pendingAdminState.set(userId, 'super_admin_main');
      return this.superAdminMenuText(userId);
    }

    if ((lowered === '!auditar-grupos' || lowered === 'auditar-grupos') && isSuperAdmin) {
      if (!this.groupRepository) return 'Repositorio de grupos no disponible.';
      const groups = await this.groupRepository.findAll();
      const without = groups.filter((g) => g.entry_year == null);
      if (!without.length) return 'No hay grupos sin cohorte.';
      return ['Grupos sin cohorte:', ...without.map((g) => `- ${g.display_name || g.group_id} (${g.group_id})`)].join('\n');
    }

    if (lowered === 'menu' || lowered === '0') {
      const scopedData = this.pendingSuperAdminData.get(userId);
      if (scopedData?.inScopedAdminMenu && isSuperAdmin) {
        this.pendingAdminState.set(userId, 'super_admin_scoped_admin_main');
        return this.adminMenuText(userId);
      }
      if (isSuperAdmin) {
        this.pendingAdminState.set(userId, 'super_admin_main');
        return this.superAdminMenuText(userId);
      }
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

  private async superAdminMenuText(userId: string): Promise<string> {
    return [
      '👑 *Menú Super-Admin*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '1 - Listar y seleccionar grupo',
      '2 - Gestionar cohortes (por entry_year)',
      '3 - Auditar grupos sin cohorte',
      '',
      '0 - Volver al menú admin normal',
    ].join('\n');
  }

  private async superAdminManageGroupMenuText(gid: string): Promise<string> {
    let groupName = gid;
    let groupCohort = 'Sin definir';
    try {
      if (this.groupRepository) {
        const g = await this.groupRepository.findByGroupId(gid);
        if (g) {
          groupName = g.display_name || gid;
          groupCohort = g.entry_year != null ? String(g.entry_year) : 'General';
        }
      }
    } catch (e) {
      // ignore
    }

    return [
      '🗑️ *Administrando grupo:*',
      `• *Nombre:* ${groupName}`,
      `• *Cohorte:* ${groupCohort}`,
      `• *ID:* ${gid}`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '1 - Editar entry_year',
      '2 - Activar/Desactivar grupo',
      '3 - Ver membresías',
      '4 - Forzar re-onboarding (lanzará config por privado)',
      '5 - Promover usuario a Admin de Grupo',
      '6 - Quitar Admin de Grupo',
      '7 - Ir al menú de Admin de este Grupo',
      '8 - Editar nombre de apoyo (display_name)',
      '9 - ❌ Eliminar grupo (borra datos y sale del grupo)',
      '10 - Cambiar comisión de un usuario',
      '',
      '0 - Volver al menú Super-Admin',
    ].join('\n');
  }

  private async superAdminCohortMenuText(userId: string): Promise<string> {
    return [
      '📁 *Menú Cohortes*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '1 - Listar cohortes configuradas',
      '2 - Crear/Editar cohorte',
      '3 - Seleccionar cohorte para gestionar',
      '',
      '0 - Volver al menú Super-Admin',
    ].join('\n');
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
    if (typeof (this.adminRepository as any).setSuperAdmin === 'function') {
      await (this.adminRepository as any).setSuperAdmin(userId, true);
    }
    
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
      const groupLabel = await this.getAdminGroupsLabel(userId);
      const groupMsg = groupLabel ? ` (para el grupo *${groupLabel}*)` : '';
      return `Registrado con éxito como superadmin ✅.\n\n${intro}${groupMsg}\n${this.getAdminProfilePrompt(nextState)}`;
    }

    this.pendingAdminState.set(userId, 'super_admin_main');
    return `Registrado con exito ✅\n${await this.superAdminMenuText(userId)}`;
  }

  private async handleAdminAuth(userId: string, candidate: string): Promise<string> {
    if (!(await this.adminRepository.isRegistered(userId))) {
      return 'Todavia no estas registrado como admin. Envia Admin para empezar.';
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
        const groupLabel = await this.getAdminGroupsLabel(userId);
        const groupMsg = groupLabel ? ` (para el grupo *${groupLabel}*)` : '';
        return `Hola, admin ✅.\n\n${intro}${groupMsg}\n${this.getAdminProfilePrompt(nextState)}`;
      }

      const isSuperAdmin = typeof (this.adminRepository as any).isSuperAdmin === 'function'
        ? await (this.adminRepository as any).isSuperAdmin(userId)
        : !!(await this.adminRepository.get(userId))?.is_super_admin;

      if (isSuperAdmin) {
        this.pendingAdminState.set(userId, 'super_admin_main');
        return `Hola, superadmin ✅\n${await this.superAdminMenuText(userId)}`;
      }

      return `Hola, admin ✅\n${await this.enterAdminWorkflow(userId)}`;
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

    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
    const classes = await this.managedClassRepository.listAll(groupId);
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
      const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
      const classes = await this.managedClassRepository.listAll(groupId);
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

    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
    const classes = await this.managedClassRepository.listAll(groupId);
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

    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
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
      group_id: groupId,
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
    const isCancel = cleaned.toLowerCase() === 'cancelar';

    if (isCancel && currentState !== undefined) {
      this.clearPendingData(userId);
      this.registrationRetries.delete(`${userId}:birthday`);
      this.registrationRetries.delete(`${userId}:email`);
      return 'Entendido, cancelé el registro 🙌\n\nSi querés retomarlo en otro momento, \n\nEscríbeme "!registrarse" cuando quieras.';
    }

    if (currentState === 'await_user_profile_welcome') {
      if (cleaned.toLowerCase() === 'sí' || cleaned.toLowerCase() === 'si') {
        this.pendingProfiles.set(userId, {});
        this.pendingAdminState.set(userId, 'await_user_profile_name');
        return '📝 *Paso 1 de 4 — Tu nombre*\n\n¿Cómo te llamás? Mandame solo tu *nombre* (no hace falta el apellido).\n\n   Ej: → Valentina';
      }
      return 'Escribí *sí* para continuar o *cancelar* para salir.';
    }

    if (currentState === 'await_user_profile_name') {
      const name = cleaned.trim();
      if (name.length < 2 || name.length > 40 || /[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/.test(name)) {
        return 'Ese no parece ser un nombre 🤔 Mandame solo tu nombre, sin números ni símbolos.';
      }

      const pending = this.pendingProfiles.get(userId) || {};
      pending.name = name;
      this.pendingProfiles.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_user_profile_birthday');
      return '🎂 *Paso 2 de 4 — Tu cumpleaños*\n\n¿Cuándo es tu cumpleaños? Mandame el día y el mes así:\n\n   Ej: → 15/09   (15 de septiembre)\n\n( solo el día y el mes)';
    }

    if (currentState === 'await_user_profile_birthday') {
      const birthday = this.parseDayMonth(cleaned);
      const retryKey = `${userId}:birthday`;
      if (!birthday) {
        const retries = (this.registrationRetries.get(retryKey) || 0) + 1;
        this.registrationRetries.set(retryKey, retries);
        if (retries >= 4) {
          this.registrationRetries.delete(retryKey);
          this.clearPendingData(userId);
          return 'Demasiados intentos fallidos. Escribime "!registrarse" cuando quieras intentar registrarte de nuevo 🙂';
        }
        return `No pude leer esa fecha 😅\n\nUsá el formato *DD/MM*, por ejemplo: 15/09\n\n   Intentos restantes: ${4 - retries}`;
      }

      this.registrationRetries.delete(retryKey);
      const pending = this.pendingProfiles.get(userId) || {};
      pending.birthday = `${String(birthday.getDate()).padStart(2, '0')}/${String(birthday.getMonth() + 1).padStart(2, '0')}`;
      this.pendingProfiles.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_user_profile_email');
      return '📧 *Paso 3 de 4 — Tu email institucional*\n\nMandame el email con el que entrás a clase\n\n(con el que te registraste en el ispc y entras al Meet).\n\n   Ej: → juan.perez@alumnos.ispc.edu.ar';
    }

    if (currentState === 'await_user_profile_email') {
      const email = cleaned.trim().toLowerCase();
      const retryKey = `${userId}:email`;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        const retries = (this.registrationRetries.get(retryKey) || 0) + 1;
        this.registrationRetries.set(retryKey, retries);
        if (retries >= 3 && retries < 5) {
          return `¿Tenés problemas con el email? Puede que sea:\n\n  • Un espacio de más al inicio o al final\n\n  • Falta el @ o el .com\n\nInténtalo de nuevo o escribí *cancelar* para salir y volver más tarde. (Intento ${retries}/5)`;
        }
        if (retries >= 5) {
          this.registrationRetries.delete(retryKey);
          this.clearPendingData(userId);
          return 'Demasiados intentos fallidos. Escribime "!registrarse" cuando quieras intentar registrarte de nuevo 🙂';
        }
        return `Ese email no parece válido 🔍\n\nTiene que tener el formato: algo@dominio.algo\n\n   Intentos restantes: ${5 - retries}`;
      }

      this.registrationRetries.delete(retryKey);
      const pending = this.pendingProfiles.get(userId) || {};
      pending.email = email;
      this.pendingProfiles.set(userId, pending);

      // Paso 4: Selección de comisión
      const missing = await this.getMissingCommissionsForUser(userId);
      if (missing.length === 0) {
        // No hay comisiones registradas en sus grupos, saltar a confirmación
        (pending as any).groupId = null;
        (pending as any).commissionId = null;
        (pending as any).commissionName = 'No asignada / No disponible';
        this.pendingProfiles.set(userId, pending);
        this.pendingAdminState.set(userId, 'await_user_profile_confirmation');
        return this.renderProfileConfirmationPrompt(pending);
      }

      const first = missing[0];
      (pending as any).groupId = first.groupId;
      (pending as any).availableCommissions = first.availableCommissions;
      this.pendingProfiles.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_user_commission_selection');

      const options = first.availableCommissions.map((c, idx) => `${idx + 1}️⃣  ${c.name}`).join('\n   ');
      return `🏫 *Paso 4 de 4 — Tu comisión para el grupo "${first.groupName}"*\n\n¿A qué comisión pertenecés?\n\n   ${options}\n\nRespondé con el número correspondiente.`;
    }

    if (currentState === 'await_user_commission_selection') {
      return this.handleUserCommissionSelection(userId, cleaned);
    }

    if (currentState === 'await_user_profile_confirmation') {
      const pending = this.pendingProfiles.get(userId);
      if (!pending?.name || !pending.birthday || !pending.email) {
        this.clearPendingData(userId);
        return 'Faltan datos. Volvé a intentarlo con "!registrarse".';
      }

      if (cleaned.toLowerCase() === 'sí' || cleaned.toLowerCase() === 'si') {
        // Guardar perfil de usuario global
        await this.userProfileRepository.upsert(userId, pending.name, pending.birthday, pending.email);
        
        // Guardar comisión a nivel de membresía si corresponde
        const pAny = pending as any;
        if (pAny.groupId && pAny.commissionId) {
          if (this.groupMembershipRepository) {
            await this.groupMembershipRepository.setCommission(pAny.groupId, userId, pAny.commissionId);
          }
        }

        this.clearPendingData(userId);
        return `🎉 *¡Listo, ${pending.name}! Ya estás registrada.*\n\nA partir de ahora podés usar el bot en el grupo.\n\nAlgunos comandos útiles:\n\n  !menu → Menú general\n\n   !hoy       → Clases de hoy\n\n   !semana    → Agenda de esta semana\n\n   !enlace    → Link de Meet de la clase actual\n\n   !examenes  → Próximos exámenes\n\n   !ayuda      → Ver todos los comandos\n\n¡Nos vemos en el grupo! 👋`;
      }

      if (cleaned.toLowerCase() === 'no') {
        // Empezar de nuevo
        this.pendingProfiles.set(userId, {});
        this.pendingAdminState.set(userId, 'await_user_profile_name');
        return 'Entendido. Empecemos de nuevo con tu nombre 🙂\n\n📝 *Paso 1 de 4 — Tu nombre*\n\n¿Cómo te llamás? Mandame solo tu *nombre* (no hace falta el apellido).\n\n   Ej: → Valentina';
      }

      return 'Respondé *sí* para guardar o *no* para empezar de nuevo.';
    }

    // Si ya está registrado o se quiere registrar
    const missingFields = this.getMissingProfileFields(profile);
    const missingComms = await this.getMissingCommissionsForUser(userId);

    if (missingFields.length === 0 && missingComms.length === 0) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const lastWarn = this.dailyWarningSent.get(userId);
      if (lastWarn === todayStr) {
        return ''; // Ignorar silenciosamente
      }
      this.dailyWarningSent.set(userId, todayStr);
      return `¡Hola de nuevo, ${profile?.name || ''}! 👋\n\nYa estás registrado/a. El bot está diseñado para responder solo en el grupo, \n\n¡Nos vemos allí!.`;
    }

    if (missingFields.length === 0 && missingComms.length > 0) {
      // Solo le falta registrar comisión en algún grupo
      const pending = { name: profile?.name, birthday: profile?.birthday_day_month, email: profile?.email };
      const first = missingComms[0];
      (pending as any).groupId = first.groupId;
      (pending as any).availableCommissions = first.availableCommissions;
      this.pendingProfiles.set(userId, pending);
      this.pendingAdminState.set(userId, 'await_user_commission_selection');

      const options = first.availableCommissions.map((c, idx) => `${idx + 1}️⃣  ${c.name}`).join('\n   ');
      return `🏫 *Paso 4 de 4 — Tu comisión para el grupo "${first.groupName}"*\n\n¿A qué comisión pertenecés?\n\n   ${options}\n\nRespondé con el número correspondiente.`;
    }

    // Iniciar Paso 0
    this.pendingAdminState.set(userId, 'await_user_profile_welcome');
    return '¡Hola! 👋 Soy *Vectorito*.\n\nAntes de que puedas consultar tus clases y horarios,\n\nnecesito que te registres. Son solo 4 preguntas rápidas. \n\n¿Arrancamos?\n\nEscribí *sí* para continuar o *cancelar* para salir.';
  }

  private renderProfileConfirmationPrompt(pending: any): string {
    return `✅ *Revisá tus datos antes de confirmar:*\n\n   👤 Nombre:     ${pending.name}\n   🎂 Cumpleaños: ${pending.birthday}\n   📧 Email:      ${pending.email}\n   🏫 Comisión:   ${pending.commissionName || 'No asignada / No disponible'}\n\n¿Son correctos estos datos?\n\n Respondé *sí* para guardar o *no* para empezar de nuevo.`;
  }

  private async handleUserCommissionSelection(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingProfiles.get(userId);
    if (!pending?.name || !pending.birthday || !pending.email) {
      this.clearPendingData(userId);
      return 'Faltan datos. Volvé a intentarlo con "!registrarse".';
    }

    const choiceStr = cleaned.trim();
    const pAny = pending as any;
    const available = pAny.availableCommissions || [];

    if (!/^\d+$/.test(choiceStr)) {
      return `Necesito número. Elegí una opción válida.`;
    }

    const idx = Number(choiceStr) - 1;
    if (idx < 0 || idx >= available.length) {
      return `Opción inválida. Mandame un número del 1 al ${available.length}.`;
    }

    const chosen = available[idx];
    pAny.commissionId = chosen.id;
    pAny.commissionName = chosen.name;
    this.pendingProfiles.set(userId, pending);

    this.pendingAdminState.set(userId, 'await_user_profile_confirmation');
    return this.renderProfileConfirmationPrompt(pending);
  }

  private async adminMenuText(userId: string): Promise<string> {
    const profile = await this.userProfileRepository.get(userId);
    const displayName = profile?.name?.trim() || 'admin';
    const scopedData = this.pendingSuperAdminData.get(userId);

    if (scopedData?.inScopedAdminMenu && scopedData.groupId) {
      this.pendingAdminState.set(userId, 'super_admin_scoped_admin_main');
      let groupName = scopedData.groupId;
      let groupCohort = 'Sin definir';
      try {
        if (this.groupRepository) {
          const g = await this.groupRepository.findByGroupId(scopedData.groupId);
          if (g) {
            groupName = g.display_name || scopedData.groupId;
            groupCohort = g.entry_year != null ? String(g.entry_year) : 'General';
          }
        }
      } catch (e) {
        // ignore
      }
      return [
        '⚙️ *Panel admin del Grupo:*',
        `• *Nombre:* ${groupName}`,
        `• *Cohorte:* ${groupCohort}`,
        `• *ID:* ${scopedData.groupId}`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━',
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
        '0 - Volver al menú de gestión de grupo',
        '',
        'En cada submenú encontrarás opciones para forzar pruebas de notificación.',
      ].join('\n');
    }

    return [
      `⚙️ *Panel admin (${displayName}):*`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
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
      '0 - Volver al menú principal',
      '',
      'En cada submenú encontrarás opciones para forzar pruebas de notificación.',
    ].join('\n');
  }

  private async enterAdminWorkflow(userId: string): Promise<string> {
    const isSuperAdmin = typeof (this.adminRepository as any).isSuperAdmin === 'function'
      ? await (this.adminRepository as any).isSuperAdmin(userId)
      : !!(await this.adminRepository.get(userId))?.is_super_admin;

    if (isSuperAdmin) {
      this.pendingAdminState.set(userId, 'super_admin_main');
      return this.superAdminMenuText(userId);
    }

    const adminGroups = await this.adminRepository.listAdminGroups(userId);
    if (adminGroups.length === 0) {
      this.pendingAdminState.delete(userId);
      return '❌ No tenés ningún grupo asignado para administrar. Contactá a un superadmin.';
    }

    if (adminGroups.length === 1) {
      const gid = adminGroups[0];
      this.pendingSuperAdminData.set(userId, { groupId: gid, inScopedAdminMenu: true });
      this.pendingAdminState.set(userId, 'super_admin_scoped_admin_main');
      return await this.adminMenuText(userId);
    }

    this.pendingSuperAdminData.set(userId, { lastGroupList: adminGroups } as any);
    this.pendingAdminState.set(userId, 'await_admin_select_group');

    const parts: string[] = ['🔐 *Selección de Grupo* \n\nElegí el número del grupo que querés administrar:'];
    for (let i = 0; i < adminGroups.length; i++) {
      const gid = adminGroups[i];
      let label = gid;
      if (this.groupRepository) {
        const g = await this.groupRepository.findByGroupId(gid);
        if (g) {
          label = g.display_name || gid;
        }
      }
      parts.push(`${i + 1} - ${label}`);
    }
    return parts.join('\n');
  }

  private classNoticesSubmenuText(): string {
    return [
      '⚙️ *Configurar avisos de clase*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '1 - Ver materias programadas',
      '2 - Cargar materia',
      '3 - Eliminar materia',
      '4 - Habilitar/deshabilitar notificaciones',
      '5 - Editar materia/horario',
      '6 - Editar enlace de Meet por materia/comisión',
      '7 - Forzar aviso de clase (prueba)',
      '',
      '0 - Volver',
    ].join('\n');
  }

  private examsSubmenuText(): string {
    return [
      '📝 *Gestión de exámenes*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '1 - Cargar examen',
      '2 - Ver exámenes',
      '3 - Forzar aviso de examen (prueba)',
      '',
      '0 - Volver',
    ].join('\n');
  }

  private institutionalNoticesSubmenuText(): string {
    return [
      '📬 *Gestión de avisos institucionales*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '1 - Cargar aviso',
      '2 - Ver avisos',
      '3 - Forzar aviso institucional (prueba)',
      '4 - Editar aviso existente',
      '',
      '0 - Volver',
    ].join('\n');
  }

  private newsSubmenuText(): string {
    return [
      '📰 *Noticias*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '1 - Actualizar noticias',
      '',
      '0 - Volver',
    ].join('\n');
  }

  private teachersSubmenuText(): string {
    return [
      '👨‍🏫 *Cargar emails de profesores*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '1 - Ver profesores',
      '2 - Cargar profesor',
      '3 - Eliminar profesor',
      '',
      '0 - Volver',
    ].join('\n');
  }

  private moderationSubmenuText(): string {
    return [
      '🛡️ *Moderación de usuarios*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '1 - Ver usuarios baneados',
      '2 - Desbanear usuario por ID',
      '',
      '0 - Volver',
    ].join('\n');
  }

  private async handleClassNoticesSubmenu(userId: string, cleaned: string): Promise<string> {
    const lowered = cleaned.trim().toLowerCase();
    if (lowered === '0' || lowered === 'menu') {
      this.pendingAdminState.delete(userId);
      return this.adminMenuText(userId);
    }

    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;

    if (lowered === '1') {
      const classes = await this.managedClassRepository.listAll(groupId);
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
      const classes = await this.managedClassRepository.listAll(groupId);
      if (!classes.length) return 'No hay materias cargadas.';
      return ['Materias a eliminar:', ...classes.map((c, idx) => `${idx + 1} - ${c.subject} (${c.schedule_day} ${c.schedule_time})`)].join('\n');
    }

    if (lowered === '4') {
      this.pendingAdminState.set(userId, 'await_class_id_to_toggle');
      const classes = await this.managedClassRepository.listAll(groupId);
      if (!classes.length) return 'No hay materias cargadas.';
      return ['Materias - Habilitar/deshabilitar notificaciones:', ...classes.map((c, idx) => `${idx + 1} - ${c.subject} (${c.notifications_enabled ? 'ON' : 'OFF'})`)].join('\n');
    }

    if (lowered === '5') {
      // Edit class flow: list classes and ask which to edit
      this.pendingAdminState.set(userId, 'await_class_id_to_edit');
      const classes = await this.managedClassRepository.listAll(groupId);
      if (!classes.length) return 'No hay materias cargadas.';
      return ['Elegí la materia a editar:', ...classes.map((c, idx) => `${idx + 1} - ${c.subject} (${c.schedule_day} ${c.schedule_time}) | Enlace: ${c.meet_link || '(sin enlace)'}`)].join('\n');
    }

    if (lowered === '6') {
      this.pendingAdminState.set(userId, 'await_class_meet_edit_select_class');
      const classes = await this.managedClassRepository.listAll(groupId);
      if (!classes.length) return 'No hay materias cargadas.';
      return [
        'Elegí la materia para editar su enlace de Meet:',
        ...classes.map((c, idx) => `${idx + 1} - ${c.subject} (${c.schedule_day} ${c.schedule_time})`)
      ].join('\n');
    }

    if (lowered === '7') {
      return this.buildClassNotificationPreview(userId);
    }

    return 'Opción inválida. Elegí un número del submenú o 0 para volver.';
  }

  private async handleExamsSubmenu(userId: string, cleaned: string): Promise<string> {
    const lowered = cleaned.trim().toLowerCase();
    if (lowered === '0' || lowered === 'menu') {
      this.pendingAdminState.delete(userId);
      return this.adminMenuText(userId);
    }

    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;

    if (lowered === '1') {
      this.pendingExamData.delete(userId);
      this.pendingAdminState.set(userId, 'await_exam_subject');
      return 'Vamos paso a paso. ¿Cuál es la materia del examen?';
    }

    if (lowered === '2') {
      const exams = await this.examsRepository.listWithIds(50, groupId);
      if (!exams.length) return 'No hay exámenes cargados.';
      return ['Exámenes actuales:', ...exams.map((e) => `${e.id} - ${e.exam.subject} (${e.exam.exam_date.toISOString().slice(0, 10)})`)].join('\n');
    }

    if (lowered === '3') {
      return this.buildExamNotificationPreview(userId);
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

    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;

    if (lowered === '1') {
      const teachers = await this.managedTeacherRepository.listWithIds(50, groupId);
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
      const teachers = await this.managedTeacherRepository.listWithIds(50, groupId);
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
        ...banned.map((u: any) => `${u.id} - ${u.name || 'Sin nombre'} | Tel: ${u.phone} | Tipo: ${u.ban_type} | Hasta: ${u.banned_until.toISOString().slice(0, 10)}`),
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
        ...banned.map((u: any) => `${u.id} - ${u.name || 'Sin nombre'} | Tel: ${u.phone}`),
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

  private async buildClassNotificationPreview(userId: string): Promise<string> {
    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
    const classes = await this.managedClassRepository.listAll(groupId);
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

  private async buildExamNotificationPreview(userId: string): Promise<string> {
    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
    const exams = await this.dynamicMessageService.getUpcomingExams(1, groupId);
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

    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
    const classData: ManagedClassCreateInput = {
      subject: pendingData.subject,
      commission_count: pendingData.commission_count ?? 1,
      schedule_day: pendingData.schedule_day,
      schedule_time: pendingData.schedule_time,
      meet_link: pendingData.meet_link,
      notifications_enabled: true,
      group_id: groupId,
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
    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
    const classes = await this.managedClassRepository.listAll(groupId);
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
    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
    const classes = await this.managedClassRepository.listAll(groupId);
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

    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
    const teacherData: ManagedTeacherCreateInput = {
      name: pendingData.name,
      email: pendingData.email,
      subject,
      group_id: groupId,
    };

    await this.managedTeacherRepository.create(teacherData);
    this.pendingTeacherData.delete(userId);
    this.pendingAdminState.delete(userId);
    return 'Profesor cargado correctamente ✅';
  }

  private async handleTeacherDelete(userId: string, cleaned: string): Promise<string> {
    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
    const teachers = await this.managedTeacherRepository.listWithIds(50, groupId);
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

  private async handleClassMeetEditSelectClass(userId: string, cleaned: string): Promise<string> {
    const idxStr = cleaned.trim();
    if (!/^\d+$/.test(idxStr)) return 'Pasame un número válido de la lista.';
    const groupId = this.pendingSuperAdminData.get(userId)?.groupId;
    const classes = await this.managedClassRepository.listAll(groupId);
    const idx = Number(idxStr) - 1;
    if (idx < 0 || idx >= classes.length) return `Número inválido. Elegí entre 1 y ${classes.length}.`;
    const cls = classes[idx];

    if (!this.classCommissionScheduleRepository || !this.commissionRepository) {
      this.pendingAdminState.delete(userId);
      return 'Repositorios no disponibles.';
    }

    const schedules = await this.classCommissionScheduleRepository.listByManagedClass(cls.id!);
    if (!schedules.length) {
      this.pendingAdminState.delete(userId);
      return 'No hay comisiones registradas para esta materia.';
    }

    const pending = this.pendingClassData.get(userId) || {};
    pending.editId = cls.id;
    pending.lastScheduleList = schedules;
    this.pendingClassData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_class_meet_edit_select_commission');

    const parts = ['Seleccioná la comisión de la que querés editar el enlace:'];
    for (let i = 0; i < schedules.length; i++) {
      const s = schedules[i];
      const commission = await this.commissionRepository.getById(s.commission_id);
      const commName = commission ? commission.name : String(s.commission_id);
      const formattedCommName = commName.toLowerCase().includes('comisi') ? commName : `Comisión ${commName}`;
      parts.push(`${i + 1} - ${formattedCommName} | Horario: ${s.schedule_day} ${s.schedule_time} | Link: ${s.meet_link || '(sin enlace)'}`);
    }
    return parts.join('\n');
  }

  private async handleClassMeetEditSelectCommission(userId: string, cleaned: string): Promise<string> {
    const idxStr = cleaned.trim();
    if (!/^\d+$/.test(idxStr)) return 'Pasame un número válido de la lista.';
    const pending = this.pendingClassData.get(userId);
    const schedules = pending?.lastScheduleList;
    if (!pending || !schedules || !schedules.length) {
      this.pendingAdminState.delete(userId);
      this.pendingClassData.delete(userId);
      return 'Faltan datos. Volvé a intentar.';
    }

    const idx = Number(idxStr) - 1;
    if (idx < 0 || idx >= schedules.length) return `Número inválido. Elegí entre 1 y ${schedules.length}.`;
    const selectedSchedule = schedules[idx];

    pending.selectedScheduleId = selectedSchedule.id;
    this.pendingClassData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_class_meet_edit_new_link');

    return 'Pasame el nuevo enlace (debe comenzar con http).';
  }

  private async handleClassMeetEditNewLink(userId: string, cleaned: string): Promise<string> {
    const link = cleaned.trim();
    if (!link.startsWith('http')) return 'Enlace inválido. Debe comenzar con http.';
    const pending = this.pendingClassData.get(userId);
    const scheduleId = pending?.selectedScheduleId;
    if (!pending || !scheduleId) {
      this.pendingAdminState.delete(userId);
      this.pendingClassData.delete(userId);
      return 'Faltan datos. Volvé a intentar.';
    }

    if (!this.classCommissionScheduleRepository) {
      this.pendingAdminState.delete(userId);
      this.pendingClassData.delete(userId);
      return 'Repositorio no disponible.';
    }

    await this.classCommissionScheduleRepository.updateMeetLink(scheduleId, link);
    this.pendingAdminState.delete(userId);
    this.pendingClassData.delete(userId);
    return `Enlace de Meet de la comisión actualizado correctamente ✅`;
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
    this.pendingProfileTimestamps.delete(userId);
  }

  private async getMissingCommissionsForUser(userId: string): Promise<Array<{ groupId: string; groupName: string; availableCommissions: any[] }>> {
    if (!this.groupMembershipRepository || !this.groupRepository || !this.groupContextRepository) return [];
    const memberships = await this.groupMembershipRepository.listByUser(userId);
    const missing: Array<{ groupId: string; groupName: string; availableCommissions: any[] }> = [];

    for (const m of memberships) {
      if (!m.is_active) continue;
      const membershipDetails = await this.groupMembershipRepository.getMembership(m.group_id, userId);
      if (membershipDetails && membershipDetails.commission_id) continue;

      const group = await this.groupRepository.findByGroupId(m.group_id);
      const context = await this.groupContextRepository.getByGroupId(m.group_id);
      if (!group || !context || context.id === undefined) continue;

      const contextCommissions = await this.groupContextRepository.listCommissionsForGroupContext(context.id);
      if (contextCommissions.length > 0) {
        missing.push({
          groupId: m.group_id,
          groupName: group.display_name || m.group_id,
          availableCommissions: contextCommissions,
        });
      }
    }
    return missing;
  }

  private getMissingProfileFields(profile: { name: string; birthday_day_month: string; email: string } | null): string[] {
    if (!profile) return ['name', 'birthday', 'email'];

    const missing: string[] = [];
    if (!profile.name?.trim()) missing.push('name');
    if (!profile.birthday_day_month?.trim()) missing.push('birthday');
    if (!profile.email?.trim()) missing.push('email');
    return missing;
  }

  private isRegistrationCommand(cleaned: string): boolean {
    const normalized = cleaned.toLowerCase().trim();
    return normalized === '!registrarse' || normalized === 'registrarse';
  }

  private isGreetingInvocation(cleaned: string): boolean {
    return ['hola', '¡hola', 'hola!', '!hola'].includes(cleaned.toLowerCase().trim());
  }

  public async getGroupCommissionMissingWarning(userId: string, groupId: string, nowMs = Date.now()): Promise<string | null> {
    if (!this.groupMembershipRepository || !this.groupRepository || !this.groupContextRepository) return null;

    const membership = await this.groupMembershipRepository.getMembership(groupId, userId);
    if (!membership || !membership.is_active || membership.commission_id) return null;

    const context = await this.groupContextRepository.getByGroupId(groupId);
    if (!context || context.id === undefined) return null;

    const commissions = await this.groupContextRepository.listCommissionsForGroupContext(context.id);
    if (commissions.length === 0) return null;

    const key = `${userId}:${groupId}`;
    const lastWarning = this.commissionWarningTimestamps.get(key);
    const thresholdMs = 48 * 60 * 60 * 1000;
    if (lastWarning !== undefined && nowMs - lastWarning < thresholdMs) {
      return '';
    }

    this.commissionWarningTimestamps.set(key, nowMs);
    return '⚠️ Para usar el bot en este grupo necesitás completar tu comisión. Escribí *!registrarse* por privado y te guío para finalizarlo.';
  }

  private getNextAdminProfileState(profile: { name: string; birthday_day_month: string; email: string } | null): string {
    const missing = this.getMissingProfileFields(profile);
    if (missing.includes('name')) return 'await_admin_profile_name';
    if (missing.includes('birthday')) return 'await_admin_profile_birthday';
    return 'await_admin_profile_email';
  }

  private async getAdminGroupsLabel(userId: string): Promise<string> {
    const data = this.pendingSuperAdminData.get(userId);
    const gid = data?.groupId;
    if (gid && this.groupRepository) {
      const g = await this.groupRepository.findByGroupId(gid);
      if (g) return g.display_name || gid;
    }
    if (this.adminRepository && this.groupRepository) {
      const adminGroups = await this.adminRepository.listAdminGroups(userId);
      if (adminGroups.length > 0) {
        const names: string[] = [];
        for (const gId of adminGroups) {
          const g = await this.groupRepository.findByGroupId(gId);
          if (g) {
            names.push(g.display_name || gId);
          } else {
            names.push(gId);
          }
        }
        return names.join(', ');
      }
    }
    return '';
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

  // Flujo de configuración de contexto de grupo (ejecutado desde grupo vía !config-grupo)
  public async startGroupContextConfiguration(userId: string, groupId: string): Promise<string> {
    if (!this.groupContextRepository || !this.commissionRepository) {
      return '❌ Servicio de configuración de grupo no disponible.';
    }

    const pending: PendingGroupContextData = { groupId, year: undefined, commission_id: null };
    this.pendingGroupContextData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_group_context_entry_year');

    let groupHeader = `Grupo ID: ${groupId}`;
    try {
      if (this.groupRepository) {
        const g = await this.groupRepository.findByGroupId(groupId);
        if (g) {
          groupHeader = `Grupo: ${g.display_name || groupId} — Cohorte: ${g.entry_year ?? 'General'}\nID: ${groupId}`;
        }
      }
    } catch (e) {
      // ignore
    }

    const currentYear = new Date().getFullYear();
    return [
      `📋 Configuración del grupo para comisiones`,
      '',
      groupHeader,
      '',
      `Primero, ingresá el año de la camada (ej: ${currentYear}).\nSi es un grupo general sin camada, escribí: general`,
    ].join('\n');
  }
  private async handleGroupContextYear(userId: string, cleaned: string): Promise<string> {
    const val = cleaned.trim().toLowerCase();

    // Caso: grupo general
    if (val === 'general') {
      const pending = this.pendingGroupContextData.get(userId);
      const gid = pending?.groupId;
      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);

      if (!gid) return '❌ No se reconoció el grupo. Reintentá desde el grupo con !config-grupo.';

      try {
        if (this.groupRepository) await this.groupRepository.updateEntryYear(gid, null);
      } catch (e) {
        return '❌ Error al registrar el grupo como general. Intentá de nuevo más tarde.';
      }

      return '✅ Grupo registrado exitosamente como Grupo General, sin camada.';
    }

    // Caso: año numérico
    const yearStr = cleaned.trim();
    if (!/^\d{4}$/.test(yearStr)) {
      return 'Necesito un año válido (4 dígitos, ej: 2024) o escribí "general".';
    }

    const year = Number(yearStr);
    if (year < 2000 || year > 2100) {
      return 'Año fuera de rango. Usa un año entre 2000 y 2100.';
    }

    const pending = this.pendingGroupContextData.get(userId) || {};
    pending.year = year;
    this.pendingGroupContextData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_group_context_commission_count');

    return [
      `✅ Año académico: ${year}`,
      '',
      `¿Cuántas comisiones tiene esta camada? Respondé un número (ej: 1 o 2).`,
      `Si preferís que el bot asigne números automáticos, simplemente respondé la cantidad.`,
    ].join('\n');
  }

  private async handleGroupContextCommission(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingGroupContextData.get(userId);
    if (!pending?.groupId || !pending.year) {
      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);
      return '❌ Faltan datos. Intenta de nuevo desde el grupo con !config-grupo.';
    }
    const raw = cleaned.trim();

    if (!this.groupContextRepository) {
      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);
      return '❌ Repositorio de contexto no disponible.';
    }

    if (!this.commissionRepository) {
      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);
      return '❌ Repositorio de comisiones no disponible.';
    }

    const norm = raw.toLowerCase();

    // Handle global / clear mappings
    if (['0', 'todas', 'ninguna', 'global'].includes(norm)) {
      const label = `${pending.year} - Global`;
      const groupContextId = await this.groupContextRepository.upsert(pending.groupId, pending.year, null, label, userId);
      await this.groupContextRepository.removeCommissionsForGroupContext(groupContextId);

      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);

      return [
        '✅ Contexto del grupo actualizado exitosamente',
        '',
        `📅 Año: ${pending.year}`,
        `📌 Comisión: Global (aplica a todas)`,
        '',
        'El bot ahora filtrará clases y horarios según esta configuración.',
      ].join('\n');
    }

    // Split comma-separated commission names
    const tokens = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!tokens.length) {
      // treat as global
      const label = `${pending.year} - Global`;
      const groupContextId = await this.groupContextRepository.upsert(pending.groupId, pending.year, null, label, userId);
      await this.groupContextRepository.removeCommissionsForGroupContext(groupContextId);

      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);

      return [
        '✅ Contexto del grupo actualizado exitosamente',
        '',
        `📅 Año: ${pending.year}`,
        `📌 Comisión: Global (aplica a todas)`,
        '',
        'El bot ahora filtrará clases y horarios según esta configuración.',
      ].join('\n');
    }

    const commissionIds: number[] = [];
    const commissionNames: string[] = [];

    for (const t of tokens) {
      const name = t.toUpperCase();
      try {
        const id = await this.commissionRepository.createOrGet(name, pending.year);
        if (id) {
          commissionIds.push(id);
          commissionNames.push(name);
        }
      } catch (e) {
        // ignore individual failures but continue
      }
    }

    let commissionIdForUpsert: number | null = null;
    if (commissionIds.length === 1) commissionIdForUpsert = commissionIds[0];

    const label = commissionNames.length === 1 ? `${pending.year} - Comisión ${commissionNames[0]}` : `${pending.year} - ${commissionNames.join(',')}`;

    const groupContextId = await this.groupContextRepository.upsert(pending.groupId, pending.year, commissionIdForUpsert, label, userId);

    await this.groupContextRepository.setCommissionsForGroupContext(groupContextId, commissionIds);

    this.pendingGroupContextData.delete(userId);
    this.pendingAdminState.delete(userId);

    return [
      '✅ Contexto del grupo actualizado exitosamente',
      '',
      `📅 Año: ${pending.year}`,
      `📌 Comisión: ${commissionNames.length ? commissionNames.join(', ') : 'Global (aplica a todas)'}`,
      '',
      'El bot ahora filtrará clases y horarios según esta configuración.',
    ].join('\n');
  }

  private async handleGroupContextCommissionCount(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingGroupContextData.get(userId);
    if (!pending?.groupId || !pending.year) {
      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);
      return '❌ Faltan datos. Intenta de nuevo desde el grupo con !config-grupo.';
    }

    const n = Number(cleaned.trim());
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      return 'Necesito un número válido de comisiones (por ejemplo: 1 o 2). Máx 20.';
    }

    pending.commission_count = n;
    this.pendingGroupContextData.set(userId, pending);

    // create commissions numerically: 1..n
    const commissionIds: number[] = [];
    const commissionNames: string[] = [];
    for (let i = 1; i <= n; i++) {
      const name = String(i);
      try {
        const id = await this.commissionRepository?.createOrGet(name, pending.year as number);
        if (id) {
          commissionIds.push(id);
          commissionNames.push(name);
        }
      } catch (e) {
        // ignore
      }
    }

    pending.commission_ids = commissionIds;
    pending.commission_names = commissionNames;
    this.pendingGroupContextData.set(userId, pending);

    // ensure group_context exists and map commissions
    try {
      const groupContextId = await this.groupContextRepository!.upsert(pending.groupId as string, pending.year as number, commissionIds.length === 1 ? commissionIds[0] : null, `${pending.year} - ${commissionNames.join(',')}`, userId);
      await this.groupContextRepository!.setCommissionsForGroupContext(groupContextId, commissionIds);
    } catch (e) {
      // log and continue
    }

    this.pendingAdminState.set(userId, 'await_group_context_subjects');
    return [
      `✅ Registradas ${n} comisiones para la camada ${pending.year}.`,
      '',
      'Ahora, ingresá la lista de materias separadas por comas (ej: Matemáticas,Física,Química).',
      "Si preferís hacerlo más tarde, escribí 'mas tarde'.",
    ].join('\n');
  }

  private async handleGroupContextSubjects(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingGroupContextData.get(userId);
    if (!pending?.groupId || !pending.year) {
      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);
      return '❌ Faltan datos. Intenta de nuevo desde el grupo con !config-grupo.';
    }

    const text = cleaned.trim();
    if (!text || text.toLowerCase() === 'mas tarde' || text.toLowerCase() === 'más tarde' || text.toLowerCase() === 'skip') {
      this.pendingAdminState.set(userId, 'await_group_context_emails');
      return [
        '✅ Configuración de materias y horarios omitida.',
        '',
        `Ahora, podés configurar los Emails de la cohorte ${pending.year}.`,
        'Formato: etiqueta|email, etiqueta|email... (ej: Bedelía|bedelia@school.com, Tutor|tutor@school.com)',
        '',
        "Si preferís omitir o cargarlos más tarde, escribí 'mas tarde' o 'skip':"
      ].join('\n');
    }

    const subjects = text.split(',').map((s) => s.trim()).filter(Boolean);
    if (!subjects.length) return 'No reconozco materias válidas. Enviá la lista separada por comas.';

    pending.subjects = subjects;
    pending.subjectIndex = 0;
    pending.commissionIndex = 0;
    this.pendingGroupContextData.set(userId, pending);

    // Ask for first subject + first commission
    const subj = subjects[0];
    const commissionName = (pending.commission_names && pending.commission_names[0]) || '1';
    this.pendingAdminState.set(userId, 'await_group_context_subject_schedule');
    return [`Ingresá día y hora y opcional enlace para la materia "${subj}" y la comisión ${commissionName}.`, `Formato: Lunes 08:30|https://meet.link (o escribí 'skip' para dejar vacío)`].join('\n');
  }

  private async handleGroupContextSubjectSchedule(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingGroupContextData.get(userId);
    if (!pending?.groupId || !pending.year || !pending.subjects || !pending.commission_ids) {
      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);
      return '❌ Faltan datos. Reintentá con !config-grupo.';
    }

    const subjIdx = pending.subjectIndex ?? 0;
    const commIdx = pending.commissionIndex ?? 0;
    const subject = pending.subjects[subjIdx];
    const commissionId = pending.commission_ids[commIdx];

    const txt = cleaned.trim();
    if (txt.toLowerCase() !== 'skip') {
      const normalizedInput = txt.replace(/\s+/g, ' ').trim();
      let dayAndTime = normalizedInput;
      let meetLink: string | null = null;

      if (normalizedInput.includes('|')) {
        const parts = normalizedInput.split('|').map((s) => s.trim());
        dayAndTime = parts[0] || '';
        meetLink = parts[1] || null;
      } else {
        const urlMatch = normalizedInput.match(/^(.*\S)\s+(https?:\/\/\S+)$/i);
        if (urlMatch) {
          dayAndTime = urlMatch[1].trim();
          meetLink = urlMatch[2].trim();
        }
      }

      const m = dayAndTime.match(/^(\S+)\s+(\d{1,2}:\d{2})$/);
      if (m) {
        const day = m[1];
        const time = m[2];
        try {
          // create or find managed class for the subject (create with commission_count)
          const managedClassId = await this.managedClassRepository!.create({
            subject,
            schedule_day: day,
            schedule_time: time,
            meet_link: meetLink ?? '',
            notifications_enabled: true,
            commission_count: pending.commission_count ?? 1,
            group_id: pending.groupId,
          });

          // create commission-specific schedule
          await this.classCommissionScheduleRepository!.create({
            managed_class_id: managedClassId,
            commission_id: commissionId,
            schedule_day: day,
            schedule_time: time,
            meet_link: meetLink ?? null,
          });
        } catch (e) {
          // ignore and continue
        }
      } else {
        return `Formato inválido. Usá "Lunes 08:30|https://...", "Lunes 08:30 https://..." o escribí 'skip'.`;
      }
    }

    // Transition to teacher configuration for this subject and commission
    pending.currentSubject = subject;
    pending.currentCommissionId = commissionId;
    this.pendingGroupContextData.set(userId, pending);
    this.pendingAdminState.set(userId, 'await_group_context_subject_teacher');

    const commissionName = pending.commission_names ? pending.commission_names[commIdx] : String(commIdx + 1);
    return [
      `Ahora, ingresá el nombre y el email del profesor para la materia "${subject}" y la comisión ${commissionName}.`,
      `Formato: Nombre Profesor|email@ispc.edu.ar (o escribí 'skip' para dejar vacío)`
    ].join('\n');
  }

  private async handleGroupContextSubjectTeacher(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingGroupContextData.get(userId);
    if (!pending?.groupId || !pending.year || !pending.subjects || !pending.commission_ids) {
      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);
      return '❌ Faltan datos. Reintentá con !config-grupo.';
    }

    const txt = cleaned.trim();
    if (txt.toLowerCase() !== 'skip' && txt) {
      const parts = txt.split('|').map((s) => s.trim());
      if (parts.length !== 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parts[1])) {
        return `❌ Formato inválido. Usá el formato: Nombre Profesor|email@ispc.edu.ar (ej: Juan Perez|juan@ispc.edu.ar) o escribí 'skip'.`;
      }
      
      const name = parts[0];
      const email = parts[1];

      try {
        if (this.managedTeacherRepository) {
          await this.managedTeacherRepository.create({
            name,
            email,
            subject: pending.currentSubject,
            group_id: pending.groupId,
            commission_id: pending.currentCommissionId,
          });
        }
      } catch (e) {
        // ignore and continue
      }
    }

    // Advance indices
    // advance indices (commissions)
    if ((pending.commissionIndex ?? 0) + 1 < (pending.commission_ids?.length ?? 0)) {
      pending.commissionIndex = (pending.commissionIndex ?? 0) + 1;
      this.pendingGroupContextData.set(userId, pending);
      const commissionName = pending.commission_names ? pending.commission_names[pending.commissionIndex] : String((pending.commissionIndex ?? 0) + 1);
      this.pendingAdminState.set(userId, 'await_group_context_subject_schedule');
      return `Ingresá día y hora y opcional enlace para la materia "${pending.currentSubject}" y la comisión ${commissionName}. Formato: Lunes 08:30|https://... o 'skip'`;
    }

    // move to next subject
    if ((pending.subjectIndex ?? 0) + 1 < (pending.subjects?.length ?? 0)) {
      pending.subjectIndex = (pending.subjectIndex ?? 0) + 1;
      pending.commissionIndex = 0;
      this.pendingGroupContextData.set(userId, pending);
      const nextSubj = pending.subjects[pending.subjectIndex];
      const commissionName = pending.commission_names ? pending.commission_names[0] : '1';
      this.pendingAdminState.set(userId, 'await_group_context_subject_schedule');
      return `Ahora ingresá día y hora para la materia "${nextSubj}" y la comisión ${commissionName}. Formato: Lunes 08:30|https://... o 'skip'`;
    }

    // finished all subjects and schedules -> go to emails step
    this.pendingAdminState.set(userId, 'await_group_context_emails');
    return [
      '✅ Materias, horarios y profesores registrados exitosamente.',
      '',
      `Ahora, podés configurar los Emails de la cohorte ${pending.year}.`,
      'Formato: etiqueta|email, etiqueta|email... (ej: Bedelía|bedelia@school.com, Tutor|tutor@school.com)',
      '',
      "Si preferís omitir o cargarlos más tarde, escribí 'mas tarde' o 'skip':"
    ].join('\n');
  }

  private async handleGroupContextEmails(userId: string, cleaned: string): Promise<string> {
    const pending = this.pendingGroupContextData.get(userId);
    if (!pending?.groupId || !pending.year) {
      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);
      return '❌ Faltan datos. Reintentá con !config-grupo.';
    }

    const txt = cleaned.trim();
    if (!txt || txt.toLowerCase() === 'mas tarde' || txt.toLowerCase() === 'más tarde' || txt.toLowerCase() === 'skip') {
      this.pendingGroupContextData.delete(userId);
      this.pendingAdminState.delete(userId);
      return '✅ Configuración completada sin registrar emails de clase. Podés gestionarlos más tarde.';
    }

    const tokens = txt.split(',').map((s) => s.trim()).filter(Boolean);
    const parsedEmails: Array<{ label: string; email: string }> = [];

    for (const token of tokens) {
      const parts = token.split('|').map((s) => s.trim());
      if (parts.length !== 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parts[1])) {
        return `❌ Formato inválido. Usá el formato: etiqueta|email, etiqueta|email... (ej: Bedelía|bedelia@school.com, Tutor|tutor@school.com) o escribí 'skip'.`;
      }
      parsedEmails.push({ label: parts[0], email: parts[1] });
    }

    try {
      if (this.cohortConfigRepository) {
        const year = pending.year;
        const cfg = await this.cohortConfigRepository.getByYear(year);
        const parsed = cfg ? JSON.parse(cfg.configs_json || '{}') : { emails: [], settings: {} };
        parsed.emails = parsed.emails || [];
        
        // Append avoiding duplicate email addresses
        for (const item of parsedEmails) {
          if (!parsed.emails.some((e: any) => String(e.email).toLowerCase() === item.email.toLowerCase())) {
            parsed.emails.push(item);
          }
        }

        await this.cohortConfigRepository.upsertByYear(year, JSON.stringify(parsed));
      }
    } catch (e) {
      // ignore
    }

    this.pendingGroupContextData.delete(userId);
    this.pendingAdminState.delete(userId);
    return '✅ Emails de clase registrados exitosamente. ¡Configuración de onboarding completada!';
  }

  private pickOne(options: string[]): string {
    return options[Math.floor(Math.random() * options.length)];
  }

  private renderPromoteUsersPage(userId: string): string {
    const data = this.pendingSuperAdminData.get(userId) as any;
    const usersJson = data?.users;
    if (!usersJson) return 'Lista de usuarios no disponible.';
    const users = JSON.parse(usersJson) as any[];
    const page = Number(data?.page || 0);
    const pageSize = 10;
    const start = page * pageSize;
    const slice = users.slice(start, start + pageSize);
    if (!slice.length) return 'No hay usuarios en esta página.';
    const list = slice.map((u, idx) => `${idx + 1} - ${u.name || '(sin nombre)'} | ${u.user_id}`);
    const controls = [] as string[];
    if (start + pageSize < users.length) controls.push('n - Siguiente');
    if (page > 0) controls.push('p - Anterior');
    return [
      'Seleccioná el número del usuario a promover a Admin de Grupo:',
      ...list,
      '',
      controls.join(' | '),
      '',
      'Enviá el número (ej: 1) o "n"/"p" para navegar.'
    ].filter(Boolean).join('\n');
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
