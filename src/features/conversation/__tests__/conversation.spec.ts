import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import { run } from '../../../shared/db/db-utils.js';
import { ConfirmationRepository } from '../conversation.repository.js';
import { ConversationStateService } from '../conversation-state.service.js';
import { ParsedMessage } from '../../../domain/message-understanding/parsed-message.types.js';

describe('Slice de Conversación - Pruebas Completas', () => {
  let db: sqlite3.Database;
  let confirmationRepo: ConfirmationRepository;
  let mockReminderRepo: any;
  let stateService: ConversationStateService;

  beforeEach(async () => {
    // 1. Setup in-memory database
    db = new sqlite3.Database(':memory:');
    await run(db, `
      CREATE TABLE IF NOT EXISTS confirmaciones (
        user_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        intent TEXT NOT NULL,
        pending_payload_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    confirmationRepo = new ConfirmationRepository(db);
    mockReminderRepo = {
      create: vi.fn().mockResolvedValue(1),
    };
    stateService = new ConversationStateService(mockReminderRepo, confirmationRepo, 15);
  });

  afterEach(async () => {
    // Clean up DB
    await new Promise<void>((resolve) => db.close(() => resolve()));
    vi.restoreAllMocks();
  });

  describe('ConfirmationRepository', () => {
    it('debería guardar y recuperar una confirmación pendiente', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
      const payload = { event_type: 'examen', description: 'parcial de física', event_date: '2026-06-15T00:00:00.000Z' };

      await confirmationRepo.save('user123', 'awaiting_confirmation', 'create_reminder', payload, expiresAt);

      const retrieved = await confirmationRepo.get('user123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.user_id).toBe('user123');
      expect(retrieved?.state).toBe('awaiting_confirmation');
      expect(retrieved?.intent).toBe('create_reminder');
      expect(JSON.parse(retrieved!.pending_payload_json)).toEqual(payload);
      expect(retrieved?.expires_at.toISOString()).toBe(expiresAt.toISOString());
    });

    it('debería eliminar una confirmación existente', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
      await confirmationRepo.save('user123', 'awaiting_confirmation', 'create_reminder', {}, expiresAt);

      await confirmationRepo.delete('user123');
      const retrieved = await confirmationRepo.get('user123');
      expect(retrieved).toBeNull();
    });

    it('debería eliminar confirmaciones expiradas', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 1000);
      const future = new Date(now.getTime() + 10000);

      await confirmationRepo.save('user_expired', 'awaiting_confirmation', 'create_reminder', {}, past);
      await confirmationRepo.save('user_valid', 'awaiting_confirmation', 'create_reminder', {}, future);

      const deletedCount = await confirmationRepo.deleteExpired(now);
      expect(deletedCount).toBe(1);

      const expired = await confirmationRepo.get('user_expired');
      const valid = await confirmationRepo.get('user_valid');

      expect(expired).toBeNull();
      expect(valid).not.toBeNull();
    });
  });

  describe('ConversationStateService', () => {
    describe('Flujo de nuevo recordatorio sin confirmación pendiente', () => {
      it('debería retornar "none" si el intent no es create_reminder', async () => {
        const parsed: ParsedMessage = {
          intent: 'help',
          entities: [],
          keywords: [],
          requires_clarification: false,
          probable_date: null,
        };

        const action = await stateService.processMessage('user123', 'ayuda', parsed);
        expect(action.action_type).toBe('none');
        expect(action.response_text).toBeNull();
      });

      it('debería pedir aclaración si el recordatorio requiere aclaración de fecha', async () => {
        const parsed: ParsedMessage = {
          intent: 'create_reminder',
          entities: [],
          keywords: ['examen'],
          requires_clarification: true,
          probable_date: null,
        };

        const action = await stateService.processMessage('user123', 'recordame examen', parsed);
        expect(action.action_type).toBe('ask_date_clarification');
        expect(action.response_text).toContain('Necesito una fecha');
      });

      it('debería pedir aclaración si no se detectó una probable_date', async () => {
        const parsed: ParsedMessage = {
          intent: 'create_reminder',
          entities: [],
          keywords: ['examen'],
          requires_clarification: false,
          probable_date: null,
        };

        const action = await stateService.processMessage('user123', 'recordame examen mañana a las diez', parsed);
        expect(action.action_type).toBe('ask_date_clarification');
        expect(action.response_text).toContain('No pude detectar la fecha');
      });

      it('debería guardar confirmación pendiente y preguntar por confirmación cuando tiene datos correctos', async () => {
        const date = new Date('2026-06-15T00:00:00-03:00');
        const parsed: ParsedMessage = {
          intent: 'create_reminder',
          entities: [],
          keywords: ['examen'],
          requires_clarification: false,
          probable_date: date,
        };

        const action = await stateService.processMessage('user123', 'recordame examen el 15 de junio', parsed);
        expect(action.action_type).toBe('ask_confirmation');
        expect(action.response_text).toContain('Detecte un recordatorio para el 2026-06-15');

        const pending = await confirmationRepo.get('user123');
        expect(pending).not.toBeNull();
        expect(pending?.intent).toBe('create_reminder');
        expect(JSON.parse(pending!.pending_payload_json).event_type).toBe('examen');
      });
    });

    describe('Flujo de resolución con confirmación pendiente', () => {
      const dateStr = '2026-06-15T00:00:00.000Z';
      
      beforeEach(async () => {
        // Guardamos una confirmación por defecto para user123
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        await confirmationRepo.save(
          'user123',
          'awaiting_confirmation',
          'create_reminder',
          {
            event_type: 'parcial',
            description: 'recordame parcial el 15 de junio',
            event_date: dateStr,
          },
          expiresAt
        );
      });

      it('debería cancelar si la confirmación expiró', async () => {
        // Hacemos que expire modificando expires_at a una fecha pasada
        const past = new Date(Date.now() - 1000);
        await confirmationRepo.save('user123', 'awaiting_confirmation', 'create_reminder', {}, past);

        const action = await stateService.processMessage('user123', 'si', { intent: 'none' } as any);
        expect(action.action_type).toBe('cancelled');
        expect(action.response_text).toContain('La confirmacion vencio');

        const pending = await confirmationRepo.get('user123');
        expect(pending).toBeNull();
      });

      it('debería guardar el recordatorio y responder guardado si responde "si" o sinónimos', async () => {
        const action = await stateService.processMessage('user123', 'si', { intent: 'none' } as any);
        expect(action.action_type).toBe('saved');
        expect(action.response_text).toContain('Listo, recordatorio guardado correctamente');

        expect(mockReminderRepo.create).toHaveBeenCalledWith({
          user_id: 'user123',
          event_type: 'parcial',
          description: 'recordame parcial el 15 de junio',
          event_date: new Date(dateStr),
          source: 'whatsapp',
          status: 'pending',
        });

        const pending = await confirmationRepo.get('user123');
        expect(pending).toBeNull();
      });

      it('debería cancelar y no guardar el recordatorio si responde "no" o sinónimos', async () => {
        const action = await stateService.processMessage('user123', 'no', { intent: 'none' } as any);
        expect(action.action_type).toBe('cancelled');
        expect(action.response_text).toContain('Operacion cancelada');

        expect(mockReminderRepo.create).not.toHaveBeenCalled();

        const pending = await confirmationRepo.get('user123');
        expect(pending).toBeNull();
      });

      it('debería pedir confirmación de nuevo si la respuesta no es clara', async () => {
        const action = await stateService.processMessage('user123', 'tal vez mañana', { intent: 'none' } as any);
        expect(action.action_type).toBe('ask_confirmation');
        expect(action.response_text).toContain("Solo necesito 'si' o 'no'");

        expect(mockReminderRepo.create).not.toHaveBeenCalled();

        const pending = await confirmationRepo.get('user123');
        expect(pending).not.toBeNull(); // Se mantiene en espera
      });
    });
  });
});
