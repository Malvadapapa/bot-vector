import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'node:path';
import fs from 'node:fs/promises';
import { applyMigrations } from '../../../shared/db/migrations.js';
import {
  ManagedExamRepository,
  ManagedClassRepository,
  ManagedTeacherRepository,
  GroupContextRepository,
} from '../academic-calendar.repository.js';
import {
  GroupRepository,
  ReminderRepository,
  UserProfileRepository,
  InstitutionalNoticeRepository,
} from '../../../infrastructure/persistence/db/repositories.js';
import { InstitutionalEmailMonitor } from '../../notifications/integrations/institutional-email-monitor.js';
import { KnowledgeContextService } from '../../ai/knowledge-context.service.js';
import { RagQueryService } from '../../ai/rag/rag-query.service.js';
import { EmbeddingProvider } from '../../ai/providers/embedding-provider.interface.js';

describe('Group Isolation and Hybrid RAG Tests', () => {
  let db: sqlite3.Database;
  let examRepo: ManagedExamRepository;
  let classRepo: ManagedClassRepository;
  let teacherRepo: ManagedTeacherRepository;
  let contextRepo: GroupContextRepository;

  beforeEach(async () => {
    db = new sqlite3.Database(':memory:');
    await applyMigrations(db);

    examRepo = new ManagedExamRepository(db);
    classRepo = new ManagedClassRepository(db);
    teacherRepo = new ManagedTeacherRepository(db);
    contextRepo = new GroupContextRepository(db);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => db.close(() => resolve()));
  });

  describe('Database and Repository Group Isolation', () => {
    it('should strictly isolate managed classes by group_id', async () => {
      const classId1 = await classRepo.create({
        subject: 'Materia Grupo A',
        schedule_day: 'Lunes',
        schedule_time: '19:00',
        meet_link: 'http://meet.google.com/a',
        notifications_enabled: true,
        commission_count: 1,
        group_id: 'grupo-a',
      });

      const classId2 = await classRepo.create({
        subject: 'Materia Grupo B',
        schedule_day: 'Lunes',
        schedule_time: '20:30',
        meet_link: 'http://meet.google.com/b',
        notifications_enabled: true,
        commission_count: 1,
        group_id: 'grupo-b',
      });

      expect(classId1).toBeGreaterThan(0);
      expect(classId2).toBeGreaterThan(0);

      // List group A
      const listA = await classRepo.listAll('grupo-a');
      expect(listA.length).toBe(1);
      expect(listA[0].subject).toBe('Materia Grupo A');

      // List group B
      const listB = await classRepo.listAll('grupo-b');
      expect(listB.length).toBe(1);
      expect(listB[0].subject).toBe('Materia Grupo B');

      // List all (without group) should return both
      const listAll = await classRepo.listAll();
      expect(listAll.length).toBe(2);
    });

    it('should strictly isolate managed exams by group_id', async () => {
      const examDate = new Date();
      examDate.setDate(examDate.getDate() + 5);

      const examId1 = await examRepo.create({
        subject: 'Examen Grupo A',
        exam_date: examDate,
        exam_time: '18:30',
        exam_type: 'Parcial',
        observations: 'Observations A',
        created_by: 'admin1',
        group_id: 'grupo-a',
      });

      const examId2 = await examRepo.create({
        subject: 'Examen Grupo B',
        exam_date: examDate,
        exam_time: '18:30',
        exam_type: 'Parcial',
        observations: 'Observations B',
        created_by: 'admin1',
        group_id: 'grupo-b',
      });

      expect(examId1).toBeGreaterThan(0);
      expect(examId2).toBeGreaterThan(0);

      // List upcoming for group A
      const listA = await examRepo.listUpcoming(new Date(0), 10, 'grupo-a');
      expect(listA.length).toBe(1);
      expect(listA[0].subject).toBe('Examen Grupo A');

      // List upcoming for group B
      const listB = await examRepo.listUpcoming(new Date(0), 10, 'grupo-b');
      expect(listB.length).toBe(1);
      expect(listB[0].subject).toBe('Examen Grupo B');
    });

    it('should strictly isolate managed teachers by group_id', async () => {
      const teacherId1 = await teacherRepo.create({
        name: 'Teacher A',
        email: 'teacher.a@ispc.edu.ar',
        group_id: 'grupo-a',
      });

      const teacherId2 = await teacherRepo.create({
        name: 'Teacher B',
        email: 'teacher.b@ispc.edu.ar',
        group_id: 'grupo-b',
      });

      expect(teacherId1).toBeGreaterThan(0);
      expect(teacherId2).toBeGreaterThan(0);

      // List teachers group A
      const listA = await teacherRepo.listAll('grupo-a');
      expect(listA.length).toBe(1);
      expect(listA[0].name).toBe('Teacher A');

      // List teachers group B
      const listB = await teacherRepo.listAll('grupo-b');
      expect(listB.length).toBe(1);
      expect(listB[0].name).toBe('Teacher B');
    });
  });

  describe('Hybrid RAG Multi-Scope Search and Ranking', () => {
    const tempDir = path.join(process.cwd(), 'data', 'temp_test_vectores');

    beforeEach(async () => {
      await fs.mkdir(path.join(tempDir, 'general'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'groups', 'grupo_test'), { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should prioritize group-specific results over general results', async () => {
      // Guardar algunos vectores de prueba en general y en grupo
      const mockGeneralRecords = [
        {
          id: 'gen-1',
          text: 'Reglamento general del ISPC sobre exámenes.',
          vector: [0.1, 0.2, 0.3],
          metadata: {
            id: 'gen-1',
            sourceFile: 'reglamento.pdf',
            sourceHash: 'hash-gen',
            index: 0,
            totalChunks: 1,
            indexedAt: new Date().toISOString(),
            scope: 'general',
          },
        },
      ];

      const mockGroupRecords = [
        {
          id: 'grp-1',
          text: 'Fechas de exámenes específicas para el Grupo Test.',
          vector: [0.1, 0.2, 0.3],
          metadata: {
            id: 'grp-1',
            sourceFile: 'fechas_grupo.pdf',
            sourceHash: 'hash-grp',
            index: 0,
            totalChunks: 1,
            indexedAt: new Date().toISOString(),
            scope: 'group',
            groupId: 'grupo_test',
          },
        },
      ];

      await fs.writeFile(
        path.join(tempDir, 'general', 'vector_store.json'),
        JSON.stringify(mockGeneralRecords)
      );

      await fs.writeFile(
        path.join(tempDir, 'groups', 'grupo_test', 'vector_store.json'),
        JSON.stringify(mockGroupRecords)
      );

      // Mock Embedding Provider
      const mockEmbeddingProvider: EmbeddingProvider = {
        generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        generateBatchEmbeddings: vi.fn(),
      };

      const ragQueryService = new RagQueryService(
        path.join(tempDir, 'vector_store.json'),
        mockEmbeddingProvider,
        0.15 // minScore bajo para que pasen ambos
      );

      // Buscar con groupId
      const results = await ragQueryService.search('exámenes', 5, 'grupo_test');

      // Comprobar que hay 2 resultados y el primero es el del grupo (priorización)
      expect(results.length).toBe(2);
      expect(results[0].text).toContain('Grupo Test');
      expect(results[1].text).toContain('Reglamento general');

      // Buscar sin groupId (solo debería devolver general)
      const resultsGeneralOnly = await ragQueryService.search('exámenes', 5);
      expect(resultsGeneralOnly.length).toBe(1);
      expect(resultsGeneralOnly[0].text).toContain('Reglamento general');
    });
  });

  describe('Multi-Group Teacher email and Connected Context Tests', () => {
    it('should list all teacher records matching a given email', async () => {
      await teacherRepo.create({
        name: 'Teacher Multi 1',
        email: 'multi@ispc.edu.ar',
        subject: 'Materia 1',
        group_id: 'grupo-a',
      });
      await teacherRepo.create({
        name: 'Teacher Multi 1',
        email: 'multi@ispc.edu.ar',
        subject: 'Materia 2',
        group_id: 'grupo-b',
      });

      const records = await teacherRepo.listByEmail('multi@ispc.edu.ar');
      expect(records.length).toBe(2);
      expect(records.map((r) => r.group_id)).toContain('grupo-a');
      expect(records.map((r) => r.group_id)).toContain('grupo-b');
    });

    it('should format notices with teacher name and subject in buildContext', async () => {
      await teacherRepo.create({
        name: 'Carlos Gomez',
        email: 'carlos@ispc.edu.ar',
        subject: 'Programación 1',
        group_id: 'grupo-a',
      });

      const noticeRepo = new InstitutionalNoticeRepository(db);
      await noticeRepo.createIfNew({
        title: 'Clase Especial',
        body: 'Habrá clases presenciales hoy.',
        source_email: 'carlos@ispc.edu.ar',
        unique_hash: 'hash-test-notice',
      });

      const reminderRepo = new ReminderRepository(db);
      const profileRepo = new UserProfileRepository(db);
      const knowledgeContextService = new KnowledgeContextService(
        profileRepo,
        examRepo,
        noticeRepo,
        classRepo,
        reminderRepo,
        teacherRepo,
        contextRepo
      );

      const context = await knowledgeContextService.buildContext('user-1', 'grupo-a');
      expect(context).toContain('[Aviso de Profesor: Carlos Gomez (Programación 1)] Clase Especial');
    });

    it('should route teacher email notices only to the groups they are registered to teach in', async () => {
      await teacherRepo.create({
        name: 'Teacher X',
        email: 'teacher.x@ispc.edu.ar',
        subject: 'Materia A',
        group_id: 'grupo-a',
      });
      await teacherRepo.create({
        name: 'Teacher X',
        email: 'teacher.x@ispc.edu.ar',
        subject: 'Materia B',
        group_id: 'grupo-b',
      });

      const groupRepo = new GroupRepository(db);
      await groupRepo.register('grupo-a');
      await groupRepo.register('grupo-b');
      await groupRepo.register('grupo-c');
      await groupRepo.setActive('grupo-a', true);
      await groupRepo.setActive('grupo-b', true);
      await groupRepo.setActive('grupo-c', true);

      const noticeRepo = new InstitutionalNoticeRepository(db);
      const reminderRepo = new ReminderRepository(db);

      const published: { text: string; groupId?: string }[] = [];
      const publishCallback = (text: string, groupId?: string) => {
        published.push({ text, groupId });
      };

      const monitor = new InstitutionalEmailMonitor(
        {
          fetchUnreadInstitutionEmails: vi.fn().mockResolvedValue([
            {
              messageId: 'msg-1',
              from: { text: 'teacher.x@ispc.edu.ar' },
              subject: '!aviso: Aviso General',
              text: 'grupo: todos\ncuerpo: Hola alumnos',
              date: new Date(),
            },
          ]),
        } as any,
        noticeRepo,
        reminderRepo,
        publishCallback,
        undefined,
        teacherRepo,
        groupRepo
      );

      await monitor.pollOnce();

      const groupIds = published.map((p) => p.groupId);
      expect(groupIds).toContain('grupo-a');
      expect(groupIds).toContain('grupo-b');
      expect(groupIds).not.toContain('grupo-c');
    });
  });
});
