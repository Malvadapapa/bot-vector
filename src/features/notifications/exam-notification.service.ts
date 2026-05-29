/**
 * Servicio de avisos inteligentes para exámenes
 * Maneja avisos programados, franjas horarias, detecta cargas anticipadas
 */

import { ManagedExamRepository } from '../../infrastructure/persistence/db/repositories.js';
import { VectoritoWhatsAppGateway } from '../../interfaces/whatsapp/vectorito-whatsapp-gateway.js';

export class ExamNotificationService {
  private readonly cronWindowMs = 6 * 60 * 1000;

  constructor(
    private examRepository: ManagedExamRepository,
    private gateway: VectoritoWhatsAppGateway,
    private groupIds: string[],
  ) {}

  /**
   * Al cargar un examen, detectar si es < 24h o < 48h y avisar inmediatamente
   */
  async checkAndNotifyEarlyLoad(examDate: Date, examTime: string, subject: string): Promise<void> {
    const now = new Date();
    const [hour, minute] = examTime.split(':').map(Number);
    const examDateTime = new Date(examDate);
    examDateTime.setHours(hour, minute, 0, 0);

    const diffMs = examDateTime.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours <= 0) {
      return;
    }

    if (diffHours < 24) {
      const message = `🚨 Examen cargado con menos de 24 horas:\n📝 ${subject}\n⏰ ${examTime}\n📅 ${examDate.toLocaleDateString('es-AR')}\n\n¡Aviso urgente en el grupo!`;
      for (const groupId of this.groupIds) {
        await this.gateway.sendTextMessage(groupId, message);
      }
      return;
    }

    if (diffHours < 48) {
      const message = `⚠️ Examen cargado con menos de 48 horas:\n📝 ${subject}\n⏰ ${examTime}\n📅 ${examDate.toLocaleDateString('es-AR')}\n\n¡Todos atentos!`;
      for (const groupId of this.groupIds) {
        await this.gateway.sendTextMessage(groupId, message);
      }
    }
  }

  /**
   * Obtiene los próximos avisos a enviar según frecuencias configuradas
   */
  async getExamsReadyForNotification(now: Date): Promise<any[]> {
    const exams = await this.examRepository.listUpcoming(now, 100);
    const toNotify: any[] = [];

    for (const exam of exams) {
      const frequencies = this.parseFrequencies(exam.frecuenciaAvisos || '7d,3d,1d,20m');
      const examDateTime = this.combineLocalDateTime(exam.exam_date, exam.exam_time);

      if (examDateTime.getTime() < now.getTime()) {
        continue;
      }

      for (const freq of frequencies) {
        const { value, unit } = freq;
        const notificationTime = this.calculateNotificationTime(exam.exam_date, exam.exam_time, value, unit);

        if (this.shouldNotifyNow(now, notificationTime, exam.id)) {
          toNotify.push({
            exam,
            frequency: freq,
            notificationTime,
            kind: `${value}${unit}`,
          });
        }
      }

      if (exam.tipoDisponibilidad === 'franja' && exam.horaInicio && exam.horaFin) {
        const startNotifyTime = this.subtractMinutes(exam.exam_date, exam.horaInicio, 10);
        const endNotifyTime = this.subtractMinutes(exam.exam_date, exam.horaFin, 10);

        if (this.shouldNotifyNow(now, startNotifyTime, exam.id)) {
          toNotify.push({
            exam,
            frequency: { value: 10, unit: 'm' as const },
            notificationTime: startNotifyTime,
            kind: 'franja-start',
          });
        }

        if (this.shouldNotifyNow(now, endNotifyTime, exam.id)) {
          toNotify.push({
            exam,
            frequency: { value: 10, unit: 'm' as const },
            notificationTime: endNotifyTime,
            kind: 'franja-end',
          });
        }
      }
    }

    return toNotify;
  }

  /**
   * Genera el mensaje de notificación según el tipo de disponibilidad
   */
  formatNotificationMessage(exam: any, frequency: any): string {
    if (frequency?.kind === 'franja-start') {
      return this.formatFranjaStartMessage(exam);
    }

    if (frequency?.kind === 'franja-end') {
      return this.formatFranjaEndMessage(exam);
    }

    const { value, unit } = frequency;
    const [hour, minute] = exam.exam_time.split(':');
    let timeText = `${hour}:${minute}`;

    // Calcular texto de tiempo faltante
    let timeRemaining = '';
    if (unit === 'd') {
      timeRemaining = `${value} día${value !== 1 ? 's' : ''}`;
    } else if (unit === 'h') {
      timeRemaining = `${value} hora${value !== 1 ? 's' : ''}`;
    } else if (unit === 'm') {
      timeRemaining = `${value} minuto${value !== 1 ? 's' : ''}`;
    }

    const baseMsg = `📢 Recordatorio: Quedan ${timeRemaining} para el ${exam.exam_type} de ${exam.subject}\n⏰ ${timeText}`;

    // Si es franja horaria, agregar info especial
    if (exam.tipoDisponibilidad === 'franja' && exam.horaFin) {
      const availableHours = this.calculateAvailableHours(exam.horaInicio || exam.exam_time, exam.horaFin);
      return `${baseMsg}\n📝 Disponible de ${exam.horaInicio} a ${exam.horaFin} (${availableHours})`;
    }

    // Si es a partir de una hora
    if (exam.tipoDisponibilidad === 'a-partir-de') {
      return `${baseMsg}\n📝 Disponible a partir de las ${exam.horaInicio}`;
    }

    // Agregar observaciones si existen
    if (exam.observations) {
      return `${baseMsg}\n📝 ${exam.observations}`;
    }

    return baseMsg;
  }

  /**
   * Mensaje especial para inicio de franja horaria
   */
  formatFranjaStartMessage(exam: any): string {
    const availableHours = this.calculateAvailableHours(exam.horaInicio || exam.exam_time, exam.horaFin);
    return [
      `🔔 El ${exam.exam_type} de ${exam.subject} comienza a las ${exam.horaInicio || exam.exam_time}`,
      `¡Prepara todo! Faltan 10 minutos para que comience.`,
      `📝 Tenés hasta las ${exam.horaFin} para realizar el intento (${availableHours}).`,
    ].join('\n');
  }

  /**
   * Mensaje especial para final de franja horaria
   */
  formatFranjaEndMessage(exam: any): string {
    return [
      `⏳ El ${exam.exam_type} de ${exam.subject} termina a las ${exam.horaFin}`,
      '¡Últimos minutos! Faltan 10 minutos para que cierre la franja.',
      '📝 Asegurate de que figure entregado en el foro.',
    ].join('\n');
  }

  private parseFrequencies(freqString: string): Array<{ value: number; unit: 'd' | 'h' | 'm' }> {
    const parts = freqString.split(',').map(p => p.trim());
    const frequencies: Array<{ value: number; unit: 'd' | 'h' | 'm' }> = [];

    for (const part of parts) {
      const match = part.match(/^(\d+)([dhm])$/);
      if (match) {
        frequencies.push({
          value: parseInt(match[1], 10),
          unit: match[2] as 'd' | 'h' | 'm',
        });
      }
    }

    return frequencies;
  }

  private calculateNotificationTime(
    examDate: Date,
    examTime: string,
    value: number,
    unit: 'd' | 'h' | 'm',
  ): Date {
    const examDateTime = this.combineLocalDateTime(examDate, examTime);

    const notifTime = new Date(examDateTime);
    if (unit === 'd') {
      notifTime.setDate(notifTime.getDate() - value);
    } else if (unit === 'h') {
      notifTime.setHours(notifTime.getHours() - value);
    } else if (unit === 'm') {
      notifTime.setMinutes(notifTime.getMinutes() - value);
    }

    return notifTime;
  }

  private shouldNotifyNow(now: Date, notificationTime: Date, examId?: number): boolean {
    if (!examId) return false;

    if (now.getTime() < notificationTime.getTime()) {
      return false;
    }

    return now.getTime() - notificationTime.getTime() <= this.cronWindowMs;
  }

  private calculateAvailableHours(startTime: string, endTime: string): string {
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    const durationMinutes = endMinutes - startMinutes;
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;

    if (hours === 0) {
      return `${minutes} minutos`;
    }

    if (minutes === 0) {
      return `${hours} hora${hours !== 1 ? 's' : ''}`;
    }

    return `${hours} hora${hours !== 1 ? 's' : ''} y ${minutes} minutos`;
  }

  private combineLocalDateTime(examDate: Date, examTime: string): Date {
    const [hour, minute] = examTime.split(':').map(Number);
    return new Date(
      examDate.getFullYear(),
      examDate.getMonth(),
      examDate.getDate(),
      hour || 0,
      minute || 0,
      0,
      0,
    );
  }

  private subtractMinutes(examDate: Date, time: string, minutes: number): Date {
    const dt = this.combineLocalDateTime(examDate, time);
    dt.setMinutes(dt.getMinutes() - minutes);
    return dt;
  }
}
