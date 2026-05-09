/**
 * Servicio de integración de menús con persistencia
 * Maneja el guardado de datos después de completar los flujos
 */

import { ExamMenuService } from './exam-menu.service.js';
import { ManagedExamRepository } from '../../infrastructure/persistence/db/repositories.js';
import { LoggingService } from '../../infrastructure/logging/logging.service.js';
import { SmartNotificationService } from '../notifications/smart-notification.service.js';

export class MenuPersistenceService {
  private smartNotificationService = new SmartNotificationService();
  private notificationSender?: (message: string) => Promise<void>;

  constructor(
    private examMenuService: ExamMenuService,
    private examRepository: ManagedExamRepository,
    private loggingService?: LoggingService,
  ) {}

  setNotificationSender(sender: (message: string) => Promise<void>): void {
    this.notificationSender = sender;
  }

  /**
   * Procesa y guarda un examen después del flujo del menú
   */
  async saveExamFromMenuFlow(examData: any): Promise<{ success: boolean; examId?: number; message: string; anticipation?: string }> {
    try {
      // Insertar el examen
      const examId = await this.examMenuService.saveExam(examData);

      if (!examId) {
        const msg = 'Error saving exam to database';
        if (this.loggingService) {
          await this.loggingService.logError(new Error(msg), {
            componente: 'MenuPersistenceService.saveExamFromMenuFlow',
            usuario: 'system',
          });
        }
        return {
          success: false,
          message: '⚠️ Error al guardar el examen en la base de datos.',
        };
      }

      // Detectar si es una notificación anticipada
      const { isAnticipated, hoursUntilStart } = this.smartNotificationService.detectAnticipationNotification(
        examData.exam_date,
        examData.exam_time,
      );

      let anticipationMessage = '';
      if (isAnticipated) {
        anticipationMessage = this.smartNotificationService.formatAnticipationNotification(
          examData.subject,
          examData.exam_date,
          examData.exam_time,
          hoursUntilStart,
        );

        if (this.notificationSender) {
          await this.notificationSender(anticipationMessage);
        }
      }

      // Log del éxito
      console.log(`[MenuPersistence] Examen guardado: ID=${examId}, Materia=${examData.subject}, Anticipated=${isAnticipated}`);

      return {
        success: true,
        examId,
        message: `✅ *Examen guardado con ID ${examId}*\n📝 ${examData.subject} - ${examData.exam_type}\n📅 ${examData.exam_date}`,
        anticipation: isAnticipated ? anticipationMessage : undefined,
      };
    } catch (error) {
      const msg = `Error in saveExamFromMenuFlow: ${error}`;
      console.error(`[MenuPersistence] ${msg}`);

      if (this.loggingService) {
        await this.loggingService.logError(error, {
          componente: 'MenuPersistenceService.saveExamFromMenuFlow',
          usuario: 'system',
        });
      }

      return {
        success: false,
        message: '❌ Ocurrió un error al procesar el examen. Intenta de nuevo.',
      };
    }
  }

  /**
   * Valida datos de examen antes de guardar
   */
  validateExamData(examData: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

    if (!hasText(examData.subject)) {
      errors.push('Materia requerida');
    }

    if (!hasText(examData.exam_type)) {
      errors.push('Tipo de examen requerido');
    }

    if (!examData.exam_date || (typeof examData.exam_date === 'string' && examData.exam_date.trim().length === 0)) {
      errors.push('Fecha requerida');
    }

    if (!hasText(examData.exam_time)) {
      errors.push('Hora requerida');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
