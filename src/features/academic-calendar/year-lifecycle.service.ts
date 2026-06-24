import { GroupRepository } from '../../infrastructure/persistence/db/repositories.js';
import { OutboxDedupRepository } from '../messages/messages.repository.js';
import { VectoritoWhatsAppGateway } from '../../interfaces/whatsapp/vectorito-whatsapp-gateway.js';
import { getSettings } from '../../shared/config/settings.js';

export class YearLifecycleService {
  constructor(
    private groupRepository: GroupRepository,
    private whatsappGateway: VectoritoWhatsAppGateway,
    private outboxDedupRepository: OutboxDedupRepository
  ) {}

  public async checkAndSendLifecycleMessages(now = new Date()): Promise<void> {
    const tz = getSettings().timezone || 'America/Argentina/Cordoba';
    const formatter = new Intl.DateTimeFormat('es-AR', {
      timeZone: tz,
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
    });
    const parts = formatter.formatToParts(now);
    const day = Number(parts.find(p => p.type === 'day')?.value ?? now.getDate());
    const month = Number(parts.find(p => p.type === 'month')?.value ?? (now.getMonth() + 1));
    const year = Number(parts.find(p => p.type === 'year')?.value ?? now.getFullYear());

    const activeGroups = await this.groupRepository.getAllActiveGroupsWithEntryYear();
    if (activeGroups.length === 0) return;

    const db = (this.groupRepository as any).db;
    let dbEvents: any[] = [];
    if (db) {
      try {
        const { all } = await import('../../shared/db/db-utils.js');
        dbEvents = await all<any>(
          db,
          'SELECT event_type, event_name, start_date, end_date FROM academic_calendar_events WHERE academic_year = ?',
          [year]
        );
      } catch (e) {
        console.warn('[Lifecycle] Error querying academic_calendar_events:', e);
      }
    }

    const matchEvent = (eventType: string): boolean => {
      const ev = dbEvents.find(e => e.event_type === eventType);
      if (!ev) return false;
      const todayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const start = ev.start_date;
      const end = ev.end_date || ev.start_date;
      return todayStr >= start && todayStr <= end;
    };

    // Calculate next week date string YYYY-MM-DD
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nextWeekParts = formatter.formatToParts(nextWeek);
    const nwDay = Number(nextWeekParts.find(p => p.type === 'day')?.value ?? nextWeek.getDate());
    const nwMonth = Number(nextWeekParts.find(p => p.type === 'month')?.value ?? (nextWeek.getMonth() + 1));
    const nwYear = Number(nextWeekParts.find(p => p.type === 'year')?.value ?? nextWeek.getFullYear());
    const nextWeekStr = `${nwYear}-${String(nwMonth).padStart(2, '0')}-${String(nwDay).padStart(2, '0')}`;

    const findEventDate = (type: string, fallback: string): string => {
      const ev = dbEvents.find(e => e.event_type === type);
      return ev ? ev.start_date : `${year}-${fallback}`;
    };

    const formatLocalDate = (dateStr: string): string => {
      try {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        const raw = dt.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
        return raw.charAt(0).toUpperCase() + raw.slice(1);
      } catch {
        return dateStr;
      }
    };

    const startAdvanced = findEventDate('start_classes_advanced', '03-16');
    const startFirstYear = findEventDate('start_classes_first_year', '04-06');
    const startSecond = findEventDate('start_second_semester', '08-10');

    for (const group of activeGroups) {
      const groupId = group.group_id;
      const entryYear = group.entry_year;

      // 1. Receso de Invierno
      const hasWinterConfig = dbEvents.some(e => e.event_type === 'winter_break');
      const isWinter = hasWinterConfig ? matchEvent('winter_break') : (month === 7 && day >= 10 && day <= 25);
      if (isWinter) {
        await this.sendLifecycleMessage(
          groupId,
          'winter_break',
          year,
          `⛄ *¡Llegó el receso de invierno!* ❄️\n\nAprovechen estas semanas para descansar, desconectarse de las entregas y recargar energías. ¡Nos volvemos a encontrar a la vuelta! ¡Buenas vacaciones! ☕🎉`
        );
      }

      // 2. Fin de Año
      const hasEndOfYearConfig = dbEvents.some(e => e.event_type === 'end_of_year');
      const isEndOfYear = hasEndOfYearConfig ? matchEvent('end_of_year') : (month === 12 && day >= 10 && day <= 23);
      if (isEndOfYear) {
        await this.sendLifecycleMessage(
          groupId,
          'end_of_year',
          year,
          `🎄 *¡Cierre de ciclo lectivo!* 🌟\n\nFelicitaciones a todos por el esfuerzo realizado a lo largo de este año. Disfruten de las fiestas, descansen y les deseo un excelente comienzo del nuevo año. ¡Felicidades! 🥂✨`
        );
      }

      // 3. Bienvenida al Año Académico (General / Fallback)
      const hasWelcomeConfig = dbEvents.some(e => e.event_type === 'welcome');
      const isWelcome = hasWelcomeConfig ? matchEvent('welcome') : (month === 4 && day >= 1 && day <= 15);
      if (isWelcome) {
        await this.sendLifecycleMessage(
          groupId,
          'welcome',
          year,
          `👋 ¡Les damos la bienvenida a un nuevo año académico en el ISPC! 🎓 Espero que tengan una cursada espectacular. Recuerden que estoy aquí para ayudarlos con horarios (!hoy, !semana), exámenes (!examenes) y avisos (!avisos). ¡Muchos éxitos! 🚀`
        );
      }

      // 4. Egreso de Técnicos
      if (entryYear && (year - entryYear >= 2)) {
        const hasGraduationConfig = dbEvents.some(e => e.event_type === 'graduation');
        const isGraduation = hasGraduationConfig ? matchEvent('graduation') : (month === 12 && day >= 15 && day <= 30);
        if (isGraduation) {
          await this.sendLifecycleMessage(
            groupId,
            'graduation',
            year,
            `🎓 *¡FELICITACIONES EGRESADOS!* 🎓\n\nHan completado su trayectoria de Tecnicatura Superior en Desarrollo de Software. Es un orgullo enorme verlos convertirse en profesionales de la tecnología y egresar del ISPC. ¡El mayor de los éxitos en su futuro laboral! 🚀💻`
          );
        }
      }

      // 5. Recordatorios de Inicio/Reinicio de Clases (7 días de anticipación)
      if (entryYear === year) {
        // Ingresantes (1er año)
        if (nextWeekStr === startFirstYear) {
          await this.sendLifecycleMessage(
            groupId,
            'reminder_classes_first_year',
            year,
            `🔔 *Recordatorio:* Les recordamos que las clases presenciales/virtuales para ingresantes de 1er Año iniciarán el próximo *${formatLocalDate(startFirstYear)}*. ¡Vayan preparando todo! 📚✨`
          );
        }
      } else if (entryYear && entryYear < year) {
        // Avanzados (2do y 3er año)
        if (nextWeekStr === startAdvanced) {
          await this.sendLifecycleMessage(
            groupId,
            'reminder_classes_advanced',
            year,
            `🔔 *Recordatorio:* Les recordamos que las clases regulares para estudiantes de 2° y 3° Año iniciarán el próximo *${formatLocalDate(startAdvanced)}*. ¡Vayan preparando todo! 📚✨`
          );
        }
      }

      // Segundo cuatrimestre (para todos los grupos)
      if (nextWeekStr === startSecond) {
        await this.sendLifecycleMessage(
          groupId,
          'reminder_classes_second',
          year,
          `🔔 *Recordatorio:* Les recordamos que el segundo cuatrimestre iniciará el próximo *${formatLocalDate(startSecond)}*. ¡Vayan preparando todo! 📚✨`
        );
      }
    }
  }

  private async sendLifecycleMessage(groupId: string, eventId: string, year: number, text: string): Promise<void> {
    const dedupKey = `lifecycle:${eventId}:${groupId}:${year}`;
    const shouldSend = await this.outboxDedupRepository.markIfNew(dedupKey);
    if (!shouldSend) return;

    try {
      await this.whatsappGateway.sendTextMessage(groupId, text);
      console.log(`[Lifecycle] Mensaje de '${eventId}' enviado al grupo ${groupId}`);
    } catch (err) {
      const msg = (err as any)?.message || err;
      console.error(`[Lifecycle] Error al enviar mensaje de '${eventId}' al grupo ${groupId}:`, msg);
    }
  }
}
