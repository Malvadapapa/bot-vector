import { describe, it, expect, beforeEach } from 'vitest';
import { OptionsStateService } from '../options-state.service.js';

describe('OptionsStateService - Pruebas Unitarias', () => {
  let service: OptionsStateService;

  beforeEach(() => {
    service = new OptionsStateService();
  });

  describe('saveOptions / hasPendingOptions', () => {
    it('debería almacenar opciones y reportar que hay pendientes', () => {
      service.saveOptions('user-1', '¿qué trámites puedo hacer?', [
        'Equivalencias',
        'Reconocimiento de saberes',
        'Certificado de alumno regular',
      ]);

      expect(service.hasPendingOptions('user-1')).toBe(true);
    });

    it('debería retornar false si no hay opciones pendientes', () => {
      expect(service.hasPendingOptions('user-1')).toBe(false);
    });

    it('debería manejar múltiples usuarios sin interferencia', () => {
      service.saveOptions('user-1', 'pregunta 1', ['A', 'B']);
      service.saveOptions('user-2', 'pregunta 2', ['X', 'Y', 'Z']);

      expect(service.hasPendingOptions('user-1')).toBe(true);
      expect(service.hasPendingOptions('user-2')).toBe(true);
    });
  });

  describe('getSelectedOption', () => {
    it('debería retornar la opción seleccionada cuando el input es un número válido', () => {
      service.saveOptions('user-1', 'pregunta original', [
        'Equivalencias',
        'Reconocimiento de saberes',
        'Certificado',
      ]);

      const result = service.getSelectedOption('user-1', '2');
      expect(result).not.toBeNull();
      expect(result!.selectedOption).toBe('Reconocimiento de saberes');
      expect(result!.originalPrompt).toBe('pregunta original');
    });

    it('debería limpiar el estado después de una selección exitosa', () => {
      service.saveOptions('user-1', 'pregunta', ['A', 'B']);
      service.getSelectedOption('user-1', '1');

      expect(service.hasPendingOptions('user-1')).toBe(false);
    });

    it('debería retornar null si el número está fuera de rango', () => {
      service.saveOptions('user-1', 'pregunta', ['A', 'B']);

      expect(service.getSelectedOption('user-1', '3')).toBeNull();
      expect(service.getSelectedOption('user-1', '0')).toBeNull();
      expect(service.getSelectedOption('user-1', '-1')).toBeNull();
    });

    it('debería retornar null si el input no es un número', () => {
      service.saveOptions('user-1', 'pregunta', ['A', 'B']);

      expect(service.getSelectedOption('user-1', 'hola')).toBeNull();
      expect(service.getSelectedOption('user-1', 'abc')).toBeNull();
      expect(service.getSelectedOption('user-1', '1.5')).toBeNull();
    });

    it('debería retornar null si no hay opciones pendientes', () => {
      expect(service.getSelectedOption('user-1', '1')).toBeNull();
    });

    it('debería retornar null si el input tiene espacios pero es un número válido', () => {
      service.saveOptions('user-1', 'pregunta', ['A', 'B']);

      // El input con espacios de padding al principio/fin debería ser trimmed
      const result = service.getSelectedOption('user-1', ' 1 ');
      // Debería funcionar porque se hace trim() primero
      expect(result).not.toBeNull();
      expect(result!.selectedOption).toBe('A');
    });
  });

  describe('expiración por timeout', () => {
    it('debería expirar opciones después de 10 minutos', () => {
      const base = new Date('2026-06-13T10:00:00Z');
      service.saveOptions('user-1', 'pregunta', ['A', 'B']);

      // Hack: acceder al map interno para setear un timestamp pasado
      const pending = (service as any).pendingByUser.get('user-1');
      pending.createdAt = base;

      // 9 minutos después: aún válido
      const nineMinsLater = new Date(base.getTime() + 9 * 60 * 1000);
      expect(service.hasPendingOptions('user-1', nineMinsLater)).toBe(true);

      // 11 minutos después: expirado
      const elevenMinsLater = new Date(base.getTime() + 11 * 60 * 1000);
      expect(service.hasPendingOptions('user-1', elevenMinsLater)).toBe(false);
    });

    it('debería retornar null en getSelectedOption si las opciones expiraron', () => {
      const base = new Date('2026-06-13T10:00:00Z');
      service.saveOptions('user-1', 'pregunta', ['A', 'B']);

      const pending = (service as any).pendingByUser.get('user-1');
      pending.createdAt = base;

      const later = new Date(base.getTime() + 11 * 60 * 1000);
      expect(service.getSelectedOption('user-1', '1', later)).toBeNull();
    });
  });

  describe('clear', () => {
    it('debería limpiar las opciones pendientes de un usuario', () => {
      service.saveOptions('user-1', 'pregunta', ['A', 'B']);
      service.clear('user-1');

      expect(service.hasPendingOptions('user-1')).toBe(false);
    });

    it('no debería afectar a otros usuarios', () => {
      service.saveOptions('user-1', 'pregunta 1', ['A', 'B']);
      service.saveOptions('user-2', 'pregunta 2', ['X', 'Y']);

      service.clear('user-1');

      expect(service.hasPendingOptions('user-1')).toBe(false);
      expect(service.hasPendingOptions('user-2')).toBe(true);
    });
  });
});
