/**
 * Servicio de recordatorios programados para exámenes
 * Envía notificaciones en momentos estratégicos antes del examen
 */

export interface ScheduledReminder {
  id: string;
  examId: number;
  userId: string;
  examName: string;
  examDate: string;
  examTime: string;
  reminderTime: Date;
  type: 'early-notice' | 'day-before' | 'hour-before' | 'franja-start' | 'franja-end';
  sent: boolean;
  sentAt?: Date;
}

export class ScheduledReminderService {
  private reminders = new Map<string, ScheduledReminder>();
  private reminderCounter = 0;

  /**
   * Crea recordatorios automáticos para un examen
   */
  createRemindersForExam(
    examId: number,
    examName: string,
    examDate: string,
    examTime: string,
    examType: 'simple' | 'franja',
    endTime?: string,
  ): ScheduledReminder[] {
    const reminders: ScheduledReminder[] = [];
    const now = new Date();
    const examDateTime = this.parseDateTime(examDate, examTime);

    // Recordatorio 1: 7 días antes (si aplica)
    const sevenDaysBefore = new Date(examDateTime);
    sevenDaysBefore.setDate(sevenDaysBefore.getDate() - 7);

    if (sevenDaysBefore > now) {
      reminders.push(
        this.createReminder(examId, examName, examDate, examTime, sevenDaysBefore, 'early-notice'),
      );
    }

    // Recordatorio 2: 1 día antes
    const oneDayBefore = new Date(examDateTime);
    oneDayBefore.setDate(oneDayBefore.getDate() - 1);
    oneDayBefore.setHours(18, 0, 0, 0); // A las 18:00

    if (oneDayBefore > now) {
      reminders.push(this.createReminder(examId, examName, examDate, examTime, oneDayBefore, 'day-before'));
    }

    // Recordatorio 3: 1 hora antes
    const oneHourBefore = new Date(examDateTime);
    oneHourBefore.setHours(oneHourBefore.getHours() - 1);

    if (oneHourBefore > now) {
      reminders.push(
        this.createReminder(examId, examName, examDate, examTime, oneHourBefore, 'hour-before'),
      );
    }

    // Recordatorios para franja horaria
    if (examType === 'franja' && endTime) {
      // 10 minutos antes del inicio
      const startMinus10 = new Date(examDateTime);
      startMinus10.setMinutes(startMinus10.getMinutes() - 10);

      if (startMinus10 > now) {
        reminders.push(
          this.createReminder(examId, examName, examDate, examTime, startMinus10, 'franja-start'),
        );
      }

      // 10 minutos antes del final
      const endDateTime = this.parseDateTime(examDate, endTime);
      const endMinus10 = new Date(endDateTime);
      endMinus10.setMinutes(endMinus10.getMinutes() - 10);

      if (endMinus10 > now) {
        reminders.push(
          this.createReminder(examId, examName, examDate, endTime, endMinus10, 'franja-end'),
        );
      }
    }

    return reminders;
  }

  /**
   * Obtiene recordatorios pendientes
   */
  getPendingReminders(): ScheduledReminder[] {
    const now = new Date();
    return Array.from(this.reminders.values()).filter(
      r => !r.sent && r.reminderTime <= now && r.reminderTime > new Date(now.getTime() - 60000),
    );
  }

  /**
   * Obtiene recordatorios proximales (próximas 24 horas)
   */
  getUpcomingReminders(userId?: string): ScheduledReminder[] {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    let reminders = Array.from(this.reminders.values()).filter(
      r => !r.sent && r.reminderTime >= now && r.reminderTime <= tomorrow,
    );

    if (userId) {
      reminders = reminders.filter(r => r.userId === userId);
    }

    return reminders;
  }

  /**
   * Marca un recordatorio como enviado
   */
  markAsSent(reminderId: string): boolean {
    const reminder = this.reminders.get(reminderId);
    if (!reminder) {
      return false;
    }

    reminder.sent = true;
    reminder.sentAt = new Date();
    return true;
  }

  /**
   * Genera mensaje de recordatorio
   */
  generateReminderMessage(reminder: ScheduledReminder): string {
    switch (reminder.type) {
      case 'early-notice':
        return `📢 *Examen próximo*\n\n${reminder.examName}\n📅 ${reminder.examDate} - ${reminder.examTime}\n\n⏰ Tienes una semana para prepararte`;

      case 'day-before':
        return `⏰ *Mañana es examen*\n\n${reminder.examName}\n🕐 ${reminder.examTime}\n\n✏️ Última oportunidad de preparación`;

      case 'hour-before':
        return `🔔 *¡Examen en 1 hora!*\n\n${reminder.examName}\n🕐 ${reminder.examTime}\n\n🚪 Asegúrate de tener todo listo`;

      case 'franja-start':
        return `⚠️ *¡Faltan 10 minutos!*\n\n${reminder.examName}\n🕐 ${reminder.examTime}\n\n📝 Prepárate para comenzar`;

      case 'franja-end':
        return `⏰ *¡Faltan 10 minutos para finalizar!*\n\n${reminder.examName}\n\n⏳ Revisa tu trabajo antes de que termine`;

      default:
        return `📋 Recordatorio: ${reminder.examName}`;
    }
  }

  /**
   * Limpia recordatorios antigos
   */
  cleanupOldReminders(daysToKeep = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    let deletedCount = 0;
    for (const [id, reminder] of this.reminders.entries()) {
      if (reminder.sentAt && reminder.sentAt < cutoffDate) {
        this.reminders.delete(id);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Crea un recordatorio individual
   */
  private createReminder(
    examId: number,
    examName: string,
    examDate: string,
    examTime: string,
    reminderTime: Date,
    type: ScheduledReminder['type'],
  ): ScheduledReminder {
    const reminderId = `REM-${++this.reminderCounter}`;

    const reminder: ScheduledReminder = {
      id: reminderId,
      examId,
      userId: '', // Se asigna después
      examName,
      examDate,
      examTime,
      reminderTime,
      type,
      sent: false,
    };

    this.reminders.set(reminderId, reminder);
    return reminder;
  }

  /**
   * Parsea fecha y hora en formato ISO
   */
  private parseDateTime(dateStr: string, timeStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);

    return new Date(year, month - 1, day, hours, minutes, 0, 0);
  }

  /**
   * Obtiene estadísticas de recordatorios
   */
  getStats(): { total: number; sent: number; pending: number } {
    const allReminders = Array.from(this.reminders.values());
    const sent = allReminders.filter(r => r.sent).length;
    const pending = allReminders.length - sent;

    return {
      total: allReminders.length,
      sent,
      pending,
    };
  }

  /**
   * Obtiene un recordatorio por ID
   */
  getReminder(reminderId: string): ScheduledReminder | undefined {
    return this.reminders.get(reminderId);
  }
}
