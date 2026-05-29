import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AcademicCalendarService } from '../features/academic-calendar/academic-calendar.service.js';
import { LoggingService } from '../shared/logging/logging.service.js';
import fs from 'fs/promises';
import path from 'path';

describe('General Menu Navigation and Error Logging Tests', () => {
  const TEST_DATA_DIR = path.join(process.cwd(), 'data-test-logging');

  beforeEach(async () => {
    // clean test dir
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {}
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {}
  });

  describe('AcademicCalendarService - General Menu Flow', () => {
    let service: AcademicCalendarService;
    let mockProfileRepo: any;

    beforeEach(() => {
      mockProfileRepo = {
        get: vi.fn(async () => ({ name: 'Test User' })),
      };

      service = new AcademicCalendarService(
        { getNews: vi.fn(async () => 'mock news') } as any,
        {} as any,
        { listAll: vi.fn(async () => []) } as any,
        {} as any,
        mockProfileRepo as any,
      );
    });

    it('should start menu flow at inicio when typing !menu', async () => {
      const resp = await service.handleMenuInput('user123', '!menu');
      expect(resp).toContain('¿Cómo te puedo ayudar hoy?');
      expect(resp).toContain('1️⃣ Fechas Útiles');
      expect(service.hasActiveMenuState('user123')).toBe(true);
    });

    it('should transition to fechas_utiles when typing 1 at inicio', async () => {
      await service.handleMenuInput('user123', '!menu');
      const resp = await service.handleMenuInput('user123', '1');
      expect(resp).toContain('Fechas Útiles');
      expect(resp).toContain('Inicio de clases');
      expect(service.hasActiveMenuState('user123')).toBe(true);
    });

    it('should show invalid option and maintain state when typing invalid number', async () => {
      await service.handleMenuInput('user123', '!menu');
      const resp = await service.handleMenuInput('user123', '9');
      expect(resp).toContain('Opcion invalida');
      expect(service.hasActiveMenuState('user123')).toBe(true);
    });

    it('should transition back to inicio when typing 0 or menu from a submenu', async () => {
      await service.handleMenuInput('user123', '!menu');
      await service.handleMenuInput('user123', '1'); // go to fechas_utiles
      const resp = await service.handleMenuInput('user123', '0'); // go back to inicio
      expect(resp).toContain('¿Cómo te puedo ayudar hoy?');
      expect(service.hasActiveMenuState('user123')).toBe(true);
    });

    it('should clear menu state and return null when typing free text', async () => {
      await service.handleMenuInput('user123', '!menu');
      const resp = await service.handleMenuInput('user123', 'some free text');
      expect(resp).toBeNull();
      expect(service.hasActiveMenuState('user123')).toBe(false);
    });
  });

  describe('LoggingService - Error and Moderation Logging', () => {
    it('should create data directory and error file with headers and log error', async () => {
      const logger = new LoggingService(TEST_DATA_DIR);
      
      // wait a tiny bit for async ensureDataDirExists to run in constructor
      await new Promise(resolve => setTimeout(resolve, 50));

      const err = new Error('Database connection failed');
      await logger.logError(err, { componente: 'TestComponent', usuario: 'user_A', grupoId: 'group_A' });

      const filePath = path.join(TEST_DATA_DIR, 'errores.csv');
      const content = await fs.readFile(filePath, 'utf-8');
      
      expect(content).toContain('"timestamp","tipo","componente","mensaje","stack","usuario","grupoId"');
      expect(content).toContain('"grave"');
      expect(content).toContain('"TestComponent"');
      expect(content).toContain('"Database connection failed"');

      const recent = await logger.getRecentErrors();
      expect(recent.length).toBe(1);
      expect(recent[0]).toContain('"grave"');
    });

    it('should propagate errors on write failure', async () => {
      const logger = new LoggingService(TEST_DATA_DIR);
      // Stub appendFile to reject
      vi.spyOn(fs, 'appendFile').mockRejectedValueOnce(new Error('Disk full'));

      const err = new Error('Database connection failed');
      await expect(logger.logError(err, { componente: 'TestComponent' })).rejects.toThrow('Disk full');
    });

    it('should retrieve recent errors by type', async () => {
      const logger = new LoggingService(TEST_DATA_DIR);
      await logger.logError(new Error('db connection failed'), { componente: 'TestComponent' }); // grave
      await logger.logError(new Error('some timeout occurred'), { componente: 'TestComponent' }); // moderado
      await logger.logError(new Error('general warning'), { componente: 'TestComponent' }); // leve

      const graveErrors = await logger.getRecentErrors('grave');
      expect(graveErrors.length).toBe(1);
      expect(graveErrors[0]).toContain('"grave"');

      const allErrors = await logger.getRecentErrors(undefined, 10);
      expect(allErrors.length).toBe(3);
    });
  });
});
