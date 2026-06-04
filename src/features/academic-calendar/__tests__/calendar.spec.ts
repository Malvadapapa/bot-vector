import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import { run } from '../../../shared/db/db-utils.js';
import { applyMigrations } from '../../../shared/db/migrations.js';
import {
  ReminderRepository,
  ManagedExamRepository,
  ManagedClassRepository,
  ManagedTeacherRepository,
  CommissionRepository,
  GroupContextRepository,
  ClassCommissionScheduleRepository,
  CohortConfigRepository,
} from '../academic-calendar.repository.js';
import { ComisionManagementService } from '../comision-management.service.js';
import { ExamMenuService } from '../exam-menu.service.js';
import { EditExamMenuService } from '../edit-exam-menu.service.js';
import { RemoveNotificationMenuService } from '../remove-notification-menu.service.js';
import { AcademicCalendarService } from '../academic-calendar.service.js';
import { UserProfileRepository } from '../../../infrastructure/persistence/db/repositories.js';

describe('Slice de Academic Calendar - Pruebas de Integración y Unitarias', () => {
  let db: sqlite3.Database;
  let reminderRepo: ReminderRepository;
  let examRepo: ManagedExamRepository;
  let classRepo: ManagedClassRepository;
  let teacherRepo: ManagedTeacherRepository;
  let commissionRepo: CommissionRepository;
  let contextRepo: GroupContextRepository;
  let scheduleRepo: ClassCommissionScheduleRepository;
  let cohortRepo: CohortConfigRepository;
  let userProfileRepo: UserProfileRepository;

  beforeEach(async () => {
    db = new sqlite3.Database(':memory:');
    await applyMigrations(db);

    reminderRepo = new ReminderRepository(db);
    examRepo = new ManagedExamRepository(db);
    classRepo = new ManagedClassRepository(db);
    teacherRepo = new ManagedTeacherRepository(db);
    commissionRepo = new CommissionRepository(db);
    contextRepo = new GroupContextRepository(db);
    scheduleRepo = new ClassCommissionScheduleRepository(db);
    cohortRepo = new CohortConfigRepository(db);
    userProfileRepo = new UserProfileRepository(db);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => db.close(() => resolve()));
    vi.restoreAllMocks();
  });

  describe('ReminderRepository', () => {
    it('debería crear y listar recordatorios activos', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const reminderId = await reminderRepo.create({
        user_id: 'user123',
        event_type: 'examen',
        description: 'Parcial de Programación 3',
        event_date: tomorrow,
      });

      expect(reminderId).toBeGreaterThan(0);

      const active = await reminderRepo.listActive();
      expect(active.length).toBe(1);
      expect(active[0].description).toBe('Parcial de Programación 3');
    });

    it('debería filtrar exámenes registrados', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      await reminderRepo.create({
        user_id: 'user123',
        event_type: 'parcial',
        description: 'Examen de Interfaz',
        event_date: tomorrow,
      });

      const exams = await reminderRepo.listRegisteredExams('user123');
      expect(exams.length).toBe(1);
      expect(exams[0].description).toBe('Examen de Interfaz');
    });

    it('debería eliminar recordatorios', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const id = await reminderRepo.create({
        user_id: 'user123',
        event_type: 'recordatorio',
        description: 'Reunión de grupo',
        event_date: tomorrow,
      });

      let active = await reminderRepo.listActive();
      expect(active.length).toBe(1);

      await reminderRepo.delete(id);

      active = await reminderRepo.listActive();
      expect(active.length).toBe(0);
    });
  });

  describe('ManagedExamRepository', () => {
    it('debería crear, consultar, actualizar y eliminar exámenes', async () => {
      const examDate = new Date();
      examDate.setDate(examDate.getDate() + 5);

      const examId = await examRepo.create({
        subject: 'Interfaz de Usuario',
        exam_date: examDate,
        exam_time: '18:30',
        exam_type: 'Parcial',
        observations: 'Traer laptop',
        created_by: 'admin1',
        tipoDisponibilidad: 'franja',
        horaInicio: '18:30',
        horaFin: '20:30',
      });

      expect(examId).toBeGreaterThan(0);

      const retrieved = await examRepo.getById(examId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.subject).toBe('Interfaz de Usuario');
      expect(retrieved?.horaFin).toBe('20:30');

      await examRepo.update(examId, { observations: 'Traer laptop y cargador' });

      const updated = await examRepo.getById(examId);
      expect(updated?.observations).toBe('Traer laptop y cargador');

      const deleted = await examRepo.deleteById(examId);
      expect(deleted).toBe(true);

      const list = await examRepo.listUpcoming(new Date());
      expect(list.length).toBe(0);
    });
  });

  describe('ManagedClassRepository', () => {
    it('debería operar clases del calendario', async () => {
      const classId = await classRepo.create({
        subject: 'Programación 3',
        schedule_day: 'Martes',
        schedule_time: '19:00',
        meet_link: 'http://meet.google.com/abc',
        notifications_enabled: true,
        commission_count: 2,
      });

      expect(classId).toBeGreaterThan(0);

      const list = await classRepo.listAll();
      expect(list.length).toBe(1);
      expect(list[0].subject).toBe('Programación 3');

      const retrieved = await classRepo.getById(classId);
      expect(retrieved).not.toBeNull();

      const byDay = await classRepo.listByDay('Martes');
      expect(byDay.length).toBe(1);

      await classRepo.updateMeetLink(classId, 'http://meet.google.com/def');
      const updated = await classRepo.getById(classId);
      expect(updated?.meet_link).toBe('http://meet.google.com/def');

      await classRepo.delete(classId);
      const afterDelete = await classRepo.listAll();
      expect(afterDelete.length).toBe(0);
    });
  });

  describe('ManagedTeacherRepository', () => {
    it('debería operar directorio de profesores', async () => {
      const teacherId = await teacherRepo.create({
        name: 'Tatiana Manzanelli',
        email: 'tmanzanelli@ispc.edu.ar',
        subject: 'Ingeniería de Software',
      });

      expect(teacherId).toBeGreaterThan(0);

      const list = await teacherRepo.listAll();
      expect(list.length).toBe(1);
      expect(list[0].name).toBe('Tatiana Manzanelli');

      const byEmail = await teacherRepo.getByEmail('tmanzanelli@ispc.edu.ar');
      expect(byEmail).not.toBeNull();

      await teacherRepo.update(teacherId, { name: 'Tatiana M.' });
      const updated = await teacherRepo.getById(teacherId);
      expect(updated?.name).toBe('Tatiana M.');

      await teacherRepo.delete(teacherId);
      const afterDelete = await teacherRepo.listAll();
      expect(afterDelete.length).toBe(0);
    });
  });

  describe('Comisiones, Contexto de Grupo y Horarios', () => {
    it('debería manejar comisiones', async () => {
      const commissionId = await commissionRepo.createOrGet('Comisión A', 2026, 'Noche');
      expect(commissionId).toBeGreaterThan(0);

      const retrieved = await commissionRepo.getById(commissionId);
      expect(retrieved?.name).toBe('Comisión A');

      const list = await commissionRepo.listByYear(2026);
      expect(list.length).toBe(1);
    });

    it('debería asociar comisiones al contexto del grupo', async () => {
      await run(db, "INSERT INTO whatsapp_groups(group_id, display_name, is_active) VALUES ('group123', 'group123', 1)");
      const com1 = await commissionRepo.createOrGet('Comisión 1', 2026, 'Tarde');
      const com2 = await commissionRepo.createOrGet('Comisión 2', 2026, 'Noche');

      const contextId = await contextRepo.upsert('group123', 2026, com1, 'Camada 2026');
      expect(contextId).toBeGreaterThan(0);

      await contextRepo.setCommissionsForGroupContext(contextId, [com1, com2]);

      const mappedComs = await contextRepo.listCommissionsForGroupContext(contextId);
      expect(mappedComs.length).toBe(2);

      await contextRepo.removeCommissionsForGroupContext(contextId, [com2]);
      const mappedComsAfter = await contextRepo.listCommissionsForGroupContext(contextId);
      expect(mappedComsAfter.length).toBe(1);
      expect(mappedComsAfter[0].name).toBe('Comisión 1');
    });

    it('debería operar agendas por comisiones', async () => {
      const comId = await commissionRepo.createOrGet('Comisión 1', 2026, 'Tarde');
      const classId = await classRepo.create({
        subject: 'Programación 3',
        schedule_day: 'Miércoles',
        schedule_time: '14:00',
        meet_link: 'http://meet.google.com/123',
      });

      const schedId = await scheduleRepo.create({
        managed_class_id: classId,
        commission_id: comId,
        schedule_day: 'Miércoles',
        schedule_time: '14:00',
        meet_link: 'http://meet.google.com/com1',
      });

      expect(schedId).toBeGreaterThan(0);

      const schedules = await scheduleRepo.listByCommissionAndDay(comId, 'Miércoles');
      expect(schedules.length).toBe(1);
      expect(schedules[0].meet_link).toBe('http://meet.google.com/com1');
    });
  });

  describe('ComisionManagementService', () => {
    it('debería gestionar comisiones en memoria', () => {
      const service = new ComisionManagementService();
      
      const created = service.createComision(1, 'Comisión A', '18:00-20:00', 'Prof. López');
      expect(created.nombre).toBe('Comisión A');
      
      const list = service.getComisiones(1);
      expect(list.length).toBe(1);

      const formatted = service.formatComisionesForChat(1, 'Programación 3');
      expect(formatted).toContain('Comisión A');
      expect(formatted).toContain('18:00-20:00');
    });
  });

  describe('ExamMenuService', () => {
    it('debería guiar el flujo de carga interactiva de examen', async () => {
      const service = new ExamMenuService(examRepo);
      const userId = 'user_test';

      const promptMateria = service.startExamFlow(userId);
      expect(promptMateria).toContain('¿Cuál es la materia?');

      // 1. Elegir Programación 3
      const step2 = service.processInput(userId, '1');
      expect(step2.response).toContain('¿Tipo de examen?');

      // 2. Elegir Parcial
      const step3 = service.processInput(userId, '1');
      expect(step3.response).toContain('¿Fecha del examen?');

      // 3. Escribir fecha
      const step4 = service.processInput(userId, '15/06/2026');
      expect(step4.response).toContain('¿Disponibilidad?');

      // 4. Elegir Hora Específica
      const step5 = service.processInput(userId, '1');
      expect(step5.response).toContain('¿Hora exacta?');

      // 5. Escribir hora
      const step6 = service.processInput(userId, '18:00');
      expect(step6.response).toContain('¿Hay comisiones?');

      // 6. Elegir sin comisiones
      const step7 = service.processInput(userId, 'no');
      expect(step7.response).toContain('Frecuencia de avisos');

      // 7. Usar frecuencia predeterminada
      const step8 = service.processInput(userId, '');
      expect(step8.response).toContain('Resumen');

      // 8. Confirmar
      const stepFinal = service.processInput(userId, 'sí');
      expect(stepFinal.completed).toBe(true);
      expect(stepFinal.examData.subject).toBe('Programación 3');
      expect(stepFinal.examData.exam_type).toBe('Parcial');

      const savedId = await service.saveExam(stepFinal.examData);
      expect(savedId).toBeGreaterThan(0);
    });
  });

  describe('EditExamMenuService', () => {
    it('debería guiar la edición de exámenes', async () => {
      const examDate = new Date(2026, 5, 15);
      await examRepo.create({
        subject: 'Programación 3',
        exam_date: examDate,
        exam_time: '18:00',
        exam_type: 'Parcial',
        observations: 'Traer laptop',
        created_by: 'system',
      });

      const service = new EditExamMenuService(examRepo);
      const userId = 'user_test';

      const prompt = await service.startEditFlow(userId);
      expect(prompt).toContain('Elige el examen a editar');

      // 1. Elegir examen 1
      const step2 = await service.processInput(userId, '1');
      expect(step2.response).toContain('¿Qué deseas editar?');

      // 2. Elegir "Observaciones" (Opción 4)
      const step3 = await service.processInput(userId, '4');
      expect(step3.response).toContain('Valor actual');

      // 3. Escribir nuevas observaciones
      const step4 = await service.processInput(userId, 'Traer laptop cargada');
      expect(step4.response).toContain('Confirmar cambio');

      // 4. Confirmar con "sí"
      const stepFinal = await service.processInput(userId, 'sí');
      expect(stepFinal.completed).toBe(true);
      expect(stepFinal.updatedExam.observations).toBe('Traer laptop cargada');
    });
  });

  describe('RemoveNotificationMenuService', () => {
    it('debería guiar el flujo de eliminación de avisos genéricos', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      await reminderRepo.create({
        user_id: 'user123',
        event_type: 'recordatorio',
        description: 'Mi recordatorio genérico',
        event_date: futureDate,
      });

      const service = new RemoveNotificationMenuService(reminderRepo, examRepo);
      const userId = 'user_test';

      const prompt = await service.startRemovalFlow(userId);
      expect(prompt).toContain('¿Qué quieres eliminar?');

      // 1. Elegir recordatorios genéricos (Opción 1)
      const step2 = await service.processInput(userId, '1');
      expect(step2.response).toContain('Mi recordatorio genérico');

      // 2. Elegir recordatorio 1
      const step3 = await service.processInput(userId, '1');
      expect(step3.response).toContain('¿Eliminar este aviso?');

      // 3. Confirmar "sí"
      const stepFinal = await service.processInput(userId, 'sí');
      expect(stepFinal.completed).toBe(true);

      const active = await reminderRepo.listActive();
      expect(active.length).toBe(0);
    });
  });

  describe('AcademicCalendarService', () => {
    let calendarService: AcademicCalendarService;
    let mockDynamicMessageService: any;

    beforeEach(async () => {
      mockDynamicMessageService = {
        getNews: vi.fn().mockResolvedValue('Noticia 1\nNoticia 2'),
        getUpcomingExams: vi.fn().mockResolvedValue([]),
        getValidNotices: vi.fn().mockResolvedValue([]),
      };

      calendarService = new AcademicCalendarService(
        mockDynamicMessageService,
        reminderRepo,
        classRepo,
        teacherRepo,
        userProfileRepo,
        scheduleRepo,
        commissionRepo,
        contextRepo,
        new ExamMenuService(examRepo),
        new EditExamMenuService(examRepo),
        new RemoveNotificationMenuService(reminderRepo, examRepo),
        examRepo
      );
    });

    it('debería procesar comandos básicos de ayuda y hoy', async () => {
      const helpResponse = await calendarService.handleCommand('user123', '!help');
      expect(helpResponse).toContain('Comandos disponibles');

      const todayResponse = await calendarService.handleCommand('user123', '!hoy');
      expect(todayResponse).toContain('no hay clases programadas');
    });

    it('debería bloquear comandos académicos en grupos sin configuración', async () => {
      const response = await calendarService.handleCommand(
        'admin123',
        '!hoy',
        new Date('2026-06-04T10:00:00.000Z'),
        false,
        'group-not-configured@g.us',
      );

      expect(response).toContain('todavía no tiene configuración académica completa');
      expect(response).toContain('!config-grupo');
    });

    it('debería mantener agenda separada por groupId en !hoy', async () => {
      await run(db, "INSERT INTO whatsapp_groups(group_id, display_name, is_active) VALUES ('groupA@g.us', 'Group A', 1)");
      await run(db, "INSERT INTO whatsapp_groups(group_id, display_name, is_active) VALUES ('groupB@g.us', 'Group B', 1)");
      const commissionA = await commissionRepo.createOrGet('1', 2026, 'Noche');
      const commissionB = await commissionRepo.createOrGet('2', 2026, 'Noche');

      await contextRepo.upsert('groupA@g.us', 2026, commissionA, 'Grupo A', 'adminA');
      await contextRepo.upsert('groupB@g.us', 2026, commissionB, 'Grupo B', 'adminB');

      const classA = await classRepo.create({
        subject: 'Ingeniería de software',
        schedule_day: 'jueves',
        schedule_time: '18:20',
        meet_link: 'https://meet/a',
        notifications_enabled: true,
        commission_count: 1,
      });

      const classB = await classRepo.create({
        subject: 'Gestión de proyectos',
        schedule_day: 'jueves',
        schedule_time: '19:40',
        meet_link: 'https://meet/b',
        notifications_enabled: true,
        commission_count: 2,
      });

      await scheduleRepo.create({
        managed_class_id: classA,
        commission_id: commissionA,
        schedule_day: 'jueves',
        schedule_time: '18:20',
        meet_link: 'https://meet/a',
      });

      await scheduleRepo.create({
        managed_class_id: classB,
        commission_id: commissionB,
        schedule_day: 'jueves',
        schedule_time: '19:40',
        meet_link: 'https://meet/b',
      });

      const when = new Date('2026-06-04T12:00:00.000Z');
      const groupAResponse = await calendarService.handleCommand('userA', '!hoy', when, false, 'groupA@g.us');
      const groupBResponse = await calendarService.handleCommand('userB', '!hoy', when, false, 'groupB@g.us');

      expect(groupAResponse).toContain('Ingeniería de software');
      expect(groupAResponse).not.toContain('Gestión de proyectos');

      expect(groupBResponse).toContain('Gestión de proyectos');
      expect(groupBResponse).not.toContain('Ingeniería de software');
    });

    it('debería procesar entrada del menú interactivo general', async () => {
      const menuResponse = await calendarService.handleCommand('user123', '!menu');
      expect(menuResponse).not.toBeNull();
      expect(menuResponse!.toLowerCase()).toContain('cómo te puedo ayudar hoy');

      // Navegar a Fechas Útiles (Opción 1)
      const step2 = await calendarService.handleMenuInput('user123', '1');
      expect(step2).not.toBeNull();
      expect(step2!.toLowerCase()).toContain('fechas');
    });
  });
});
