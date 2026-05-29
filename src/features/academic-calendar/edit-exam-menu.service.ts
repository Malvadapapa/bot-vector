/**
 * Servicio de menú para editar exámenes existentes
 * Flujo: Seleccionar examen → Seleccionar campo → Confirmar nuevo valor
 */

import { ManagedExamRepository } from './academic-calendar.repository.js';

export interface EditExamState {
  userId: string;
  stage: 'selecting-exam' | 'selecting-field' | 'entering-value' | 'confirming';
  selectedExamId?: number;
  selectedField?: 'exam_time' | 'exam_date' | 'exam_type' | 'observations' | 'frecuenciaAvisos' | 'tipoDisponibilidad' | 'horaInicio' | 'horaFin';
  newValue?: string;
  currentExam?: any;
  exams?: any[];
}

export class EditExamMenuService {
  private userStates = new Map<string, EditExamState>();

  constructor(private examRepository: ManagedExamRepository) {}

  /**
   * Inicia el flujo de edición
   */
  async startEditFlow(userId: string): Promise<string> {
    this.userStates.set(userId, {
      userId,
      stage: 'selecting-exam',
      exams: [],
    });

    const exams = await this.examRepository.listUpcoming(new Date(), 100);

    if (!exams.length) {
      this.userStates.delete(userId);
      return '❌ No hay exámenes para editar.';
    }

    const state = this.userStates.get(userId)!;
    state.exams = exams;

    let response = '✏️ *Editar Examen*\n\nElige el examen a editar:\n\n';
    for (let i = 0; i < Math.min(exams.length, 10); i++) {
      const exam = exams[i];
      response += `${i + 1}️⃣ ${exam.subject} - ${exam.exam_type}\n   📅 ${exam.exam_date.toLocaleDateString('es-AR')} ⏰ ${exam.exam_time}\n\n`;
    }

    if (exams.length > 10) {
      response += `... y ${exams.length - 10} más`;
    }

    return response;
  }

  /**
   * Procesa entrada del usuario
   */
  async processInput(userId: string, input: string): Promise<{ response: string; completed: boolean; updatedExam?: any }> {
    const state = this.userStates.get(userId);
    if (!state) {
      return { response: '❌ Flujo expirado. Usa !editarexamen para comenzar.', completed: false };
    }

    const normalized = input.trim();

    // Seleccionar examen
    if (state.stage === 'selecting-exam') {
      const idx = parseInt(normalized, 10) - 1;
      if (isNaN(idx) || !state.exams || idx < 0 || idx >= state.exams.length) {
        return { response: '❌ ID inválido. Responde con el número del examen.', completed: false };
      }

      const exam = state.exams[idx];
      state.selectedExamId = exam.id;
      state.currentExam = exam;
      state.stage = 'selecting-field';

      return {
        response: `✅ *${exam.subject} - ${exam.exam_type}*\n📅 ${exam.exam_date.toLocaleDateString('es-AR')} ⏰ ${exam.exam_time}\n\n¿Qué deseas editar?\n1️⃣ Hora\n2️⃣ Fecha\n3️⃣ Tipo\n4️⃣ Observaciones\n5️⃣ Frecuencia avisos\n6️⃣ Disponibilidad\n7️⃣ Hora inicio\n8️⃣ Hora fin`,
        completed: false,
      };
    }

    // Seleccionar campo
    if (state.stage === 'selecting-field') {
      const fieldMap: Record<string, 'exam_time' | 'exam_date' | 'exam_type' | 'observations' | 'frecuenciaAvisos' | 'tipoDisponibilidad' | 'horaInicio' | 'horaFin'> = {
        '1': 'exam_time',
        '2': 'exam_date',
        '3': 'exam_type',
        '4': 'observations',
        '5': 'frecuenciaAvisos',
        '6': 'tipoDisponibilidad',
        '7': 'horaInicio',
        '8': 'horaFin',
      };

      state.selectedField = fieldMap[normalized];
      if (!state.selectedField) {
        return { response: '❌ Opción inválida. Elige 1-8.', completed: false };
      }

      const fieldDisplay = this.getFieldDisplay(state.selectedField);
      const currentValue = (state.currentExam as any)[state.selectedField] || '(vacío)';

      state.stage = 'entering-value';
      return {
        response: `📝 *${fieldDisplay}*\nValor actual: \`${currentValue instanceof Date ? currentValue.toLocaleDateString('es-AR') : currentValue}\`\n\n¿Nuevo valor?`,
        completed: false,
      };
    }

    // Ingresar nuevo valor
    if (state.stage === 'entering-value') {
      // Validar según el campo
      if (state.selectedField === 'exam_time') {
        if (!this.isValidTime(normalized)) {
          return { response: '❌ Hora inválida. Usa HH:MM (ej: 14:30)', completed: false };
        }
      } else if (state.selectedField === 'exam_date') {
        if (!this.isValidDate(normalized)) {
          return { response: '❌ Fecha inválida. Usa DD/MM/YYYY (ej: 15/05/2026)', completed: false };
        }
      } else if (state.selectedField === 'horaInicio' || state.selectedField === 'horaFin') {
        if (!this.isValidTime(normalized)) {
          return { response: '❌ Hora inválida. Usa HH:MM (ej: 14:30)', completed: false };
        }
      } else if (state.selectedField === 'tipoDisponibilidad') {
        const allowed = ['1', '2', '3', 'hora-especifica', 'franja', 'a-partir-de'];
        if (!allowed.includes(normalized)) {
          return { response: '❌ Opción inválida. Usa 1, 2, 3 o escribe hora-especifica / franja / a-partir-de', completed: false };
        }
      } else if (state.selectedField === 'frecuenciaAvisos') {
        const cleaned = normalized.replace(/\s+/g, '');
        if (!this.isValidFrequencyList(cleaned)) {
          return { response: '❌ Frecuencia inválida. Usa formato como 10d,5d,1d,20m', completed: false };
        }
      }

      state.newValue = normalized;
      state.stage = 'confirming';

      const fieldDisplay = this.getFieldDisplay(state.selectedField!);
      return {
        response: `✏️ *${fieldDisplay}*\nNuevo valor: \`${normalized}\`\n\n✅ ¿Confirmar cambio? (sí/no)`,
        completed: false,
      };
    }

    // Confirmación
    if (state.stage === 'confirming') {
      if (normalized.toLowerCase() === 'sí' || normalized.toLowerCase() === 'si') {
        const updateData: any = {};

        // Convertir valores según el campo
        if (state.selectedField && state.selectedField === 'exam_date') {
          updateData[state.selectedField] = this.parseDateToISO(state.newValue!);
        } else if (state.selectedField === 'tipoDisponibilidad') {
          updateData[state.selectedField] = this.normalizeAvailability(state.newValue!);
        } else if (state.selectedField === 'frecuenciaAvisos') {
          updateData[state.selectedField] = state.newValue!.replace(/\s+/g, '');
        } else if (state.selectedField) {
          updateData[state.selectedField] = state.newValue;
        }

        await this.examRepository.update(state.selectedExamId!, updateData);
        const updated = await this.examRepository.getById(state.selectedExamId!);

        this.userStates.delete(userId);
        return {
          response: `✅ *Examen actualizado exitosamente!*\n✏️ ${this.getFieldDisplay(state.selectedField!)} = ${state.newValue}`,
          completed: true,
          updatedExam: updated,
        };
      } else {
        this.userStates.delete(userId);
        return {
          response: `❌ Edición cancelada. Usa !editarexamen para comenzar de nuevo.`,
          completed: false,
        };
      }
    }

    return { response: '❌ Error en el flujo.', completed: false };
  }

  /**
   * Cancela el flujo
   */
  cancelFlow(userId: string): void {
    this.userStates.delete(userId);
  }

  /**
   * Verifica si está en flujo
   */
  isInFlow(userId: string): boolean {
    return this.userStates.has(userId);
  }

  private getFieldDisplay(field: string): string {
    const displays: Record<string, string> = {
      exam_time: '⏰ Hora',
      exam_date: '📅 Fecha',
      exam_type: '🏷️ Tipo',
      observations: '📝 Observaciones',
      frecuenciaAvisos: '📢 Frecuencia Avisos',
      tipoDisponibilidad: '📅 Disponibilidad',
      horaInicio: '⏰ Hora Inicio',
      horaFin: '⏰ Hora Fin',
    };
    return displays[field] || field;
  }

  private isValidTime(time: string): boolean {
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return false;

    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);

    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
  }

  private isValidDate(date: string): boolean {
    const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return false;

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    if (year < 2026 || year > 2030) return false;

    return true;
  }

  private parseDateToISO(dateStr: string): Date {
    const [day, month, year] = dateStr.split('/');
    return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  }

  private isValidFrequencyList(value: string): boolean {
    const parts = value.split(',').filter(Boolean);
    return parts.length > 0 && parts.every((part) => /^(\d+)([dhm])$/.test(part));
  }

  private normalizeAvailability(value: string): 'hora-especifica' | 'franja' | 'a-partir-de' {
    const normalized = value.toLowerCase();
    if (normalized === '1' || normalized === 'hora-especifica') return 'hora-especifica';
    if (normalized === '2' || normalized === 'franja') return 'franja';
    return 'a-partir-de';
  }
}
