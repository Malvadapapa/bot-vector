/**
 * Servicio de flujo interactivo para agregar exámenes con soporte de comisiones multi-horario
 * Fase 4: Manejo de exámenes por comisión con tiempos diferentes
 */

import { ComisionManagementService } from './comision-management.service.js';

export class MultiComisionExamMenuService {
  private comisionManagementService: ComisionManagementService;
  private menuStateByUser = new Map<string, { stage: string; examData: any }>();
  private examComisionsByUser = new Map<string, Map<number, { time: string; horarial?: string }>>();

  constructor() {
    this.comisionManagementService = new ComisionManagementService();
  }

  /**
   * Inicia flujo de examen multi-comisión
   */
  startMultiComisionFlow(userId: string): string {
    this.menuStateByUser.set(userId, {
      stage: 'selecting-comisiones',
      examData: { comisiones: {} },
    });

    return `📝 *Agregar Examen con Comisiones*\n\n¿Cuántas comisiones tienen este examen?\n\n1️⃣ Una comisión (mismo horario)\n2️⃣ Múltiples comisiones (horarios diferentes)`;
  }

  /**
   * Procesa input en flujo multi-comisión
   */
  processMultiComisionInput(userId: string, input: string): { response: string; completed: boolean; examData?: any } {
    const state = this.menuStateByUser.get(userId);
    if (!state) {
      return { response: '⚠️ Por favor, usa !agregarexamen para comenzar', completed: false };
    }

    const choice = input.trim();

    if (state.stage === 'selecting-comisiones') {
      if (choice === '1') {
        state.stage = 'single-comision';
        state.examData.multiComision = false;
        return {
          response: `✅ Modo: Una comisión\n\n¿Cuál es la comisión? (ej: Comisión 1)`,
          completed: false,
        };
      } else if (choice === '2') {
        state.stage = 'multi-comision-count';
        state.examData.multiComision = true;
        return {
          response: `✅ Modo: Múltiples comisiones\n\n¿Cuántas comisiones? (1-4)`,
          completed: false,
        };
      }
    }

    if (state.stage === 'multi-comision-count') {
      const count = parseInt(choice, 10);
      if (isNaN(count) || count < 1 || count > 4) {
        return {
          response: '❌ Ingresa un número entre 1 y 4',
          completed: false,
        };
      }

      state.examData.comisionCount = count;
      state.examData.comisions = [];
      state.stage = 'collecting-comision-times';

      return {
        response: this.generateComisionTimePrompt(1, count),
        completed: false,
      };
    }

    if (state.stage === 'collecting-comision-times') {
      const count = state.examData.comisionCount;
      const currentIndex = state.examData.comisions.length + 1;

      // Validar formato HH:mm
      if (!/^\d{2}:\d{2}$/.test(choice)) {
        return {
          response: '❌ Formato inválido. Usa HH:mm (ej: 14:30)',
          completed: false,
        };
      }

      state.examData.comisions.push({
        index: currentIndex,
        time: choice,
      });

      if (state.examData.comisions.length === count) {
        state.stage = 'exam-saved';
        return {
          response: `✅ *Comisiones configuradas*\n\n${this.formatComisionSummary(state.examData)}\n\n⏰ Horarios capturados correctamente`,
          completed: true,
          examData: state.examData,
        };
      }

      return {
        response: this.generateComisionTimePrompt(currentIndex + 1, count),
        completed: false,
      };
    }

    if (state.stage === 'single-comision') {
      state.examData.singleComision = choice;
      state.stage = 'exam-saved';

      return {
        response: `✅ *Comisión configurada*\n\nComisión: ${choice}`,
        completed: true,
        examData: state.examData,
      };
    }

    return { response: '⚠️ Estado inválido', completed: false };
  }

  /**
   * Verifica si hay un flujo activo para el usuario
   */
  isInFlow(userId: string): boolean {
    return this.menuStateByUser.has(userId);
  }

  /**
   * Limpia el estado del usuario
   */
  clearState(userId: string): void {
    this.menuStateByUser.delete(userId);
    this.examComisionsByUser.delete(userId);
  }

  /**
   * Genera prompt para tiempo de comisión
   */
  private generateComisionTimePrompt(index: number, total: number): string {
    return `⏰ *Comisión ${index} de ${total}*\n\n¿A qué hora? (formato HH:mm, ej: 14:30)`;
  }

  /**
   * Formatea resumen de comisiones
   */
  private formatComisionSummary(examData: any): string {
    if (!examData.multiComision) {
      return `📌 Comisión: ${examData.singleComision}`;
    }

    const lines = ['📌 Comisiones:'];
    for (const c of examData.comisions) {
      lines.push(`  • Comisión ${c.index}: ${c.time}`);
    }

    return lines.join('\n');
  }
}
