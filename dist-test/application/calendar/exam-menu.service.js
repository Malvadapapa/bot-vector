"use strict";
/**
 * Servicio de menú mejorado para carga de exámenes
 * Flujo interactivo con tipos de disponibilidad, comisiones y frecuencias
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExamMenuService = void 0;
class ExamMenuService {
    constructor(examRepository) {
        this.examRepository = examRepository;
        this.userStates = new Map();
        this.SUBJECTS = ['Programación 3', 'Práctica 2', 'Interfaz de Usuario', 'Ciencia de Datos', 'Ingeniería de Software'];
        this.EXAM_TYPES = ['Parcial', 'Final', 'Evidencia'];
        this.DEFAULT_FREQUENCY = '7d,3d,1d,20m';
    }
    /**
     * Inicia el flujo de carga de examen
     */
    startExamFlow(userId) {
        this.userStates.set(userId, {
            userId,
            stage: 'selecting-subject',
        });
        let response = '📝 *Carga de Examen*\n\n¿Cuál es la materia?\n\n';
        for (let i = 0; i < this.SUBJECTS.length; i++) {
            response += `${i + 1}️⃣ ${this.SUBJECTS[i]}\n`;
        }
        response += '\nO escribe el nombre de la materia';
        return response;
    }
    /**
     * Procesa input en el flujo de menú
     */
    processInput(userId, input) {
        const state = this.userStates.get(userId);
        if (!state) {
            return { response: '⚠️ No hay flujo activo. Usa !agregarexamen', completed: false };
        }
        const normalized = input.trim().toLowerCase();
        // Selección de materia
        if (state.stage === 'selecting-subject') {
            const index = parseInt(input) - 1;
            if (index >= 0 && index < this.SUBJECTS.length) {
                state.subject = this.SUBJECTS[index];
            }
            else if (input.trim().length > 0) {
                state.subject = input.trim();
            }
            else {
                return { response: '❌ Materia no válida.', completed: false };
            }
            state.stage = 'selecting-type';
            return {
                response: `✅ Materia: ${state.subject}\n\n🏷️ ¿Tipo de examen?\n1️⃣ Parcial\n2️⃣ Final\n3️⃣ Evidencia`,
                completed: false,
            };
        }
        // Tipo de examen
        if (state.stage === 'selecting-type') {
            const typeMap = { '1': 'Parcial', '2': 'Final', '3': 'Evidencia' };
            state.exam_type = typeMap[normalized];
            if (!state.exam_type) {
                return { response: '❌ Opción no válida. Elige 1, 2 o 3.', completed: false };
            }
            state.stage = 'selecting-date';
            return {
                response: `✅ Tipo: ${state.exam_type}\n\n📅 ¿Fecha del examen?\nFormato: DD/MM/YYYY (ej: 15/05/2026)`,
                completed: false,
            };
        }
        if (state.stage === 'selecting-date') {
            if (!this.isValidDate(normalized)) {
                return { response: '❌ Fecha inválida. Usa DD/MM/YYYY (ej: 15/05/2026)', completed: false };
            }
            state.exam_date = this.parseDateToISO(normalized);
            state.stage = 'selecting-availability';
            return {
                response: `✅ Fecha: ${normalized}\n\n📅 ¿Disponibilidad?\n1️⃣ Hora específica (ej: 14:30)\n2️⃣ Franja horaria (ej: 14:00-16:00)\n3️⃣ A partir de una hora (ej: 14:00+)`,
                completed: false,
            };
        }
        // Disponibilidad
        if (state.stage === 'selecting-availability') {
            const availMap = {
                '1': 'hora-especifica',
                '2': 'franja',
                '3': 'a-partir-de',
            };
            state.availability = availMap[normalized];
            if (!state.availability) {
                return { response: '❌ Opción no válida. Elige 1, 2 o 3.', completed: false };
            }
            if (state.availability === 'hora-especifica') {
                state.stage = 'entering-time';
                return { response: `📅 ${state.subject} - ${state.exam_type}\n\n⏰ ¿Hora exacta? (Formato: HH:MM, ej: 14:30)`, completed: false };
            }
            else if (state.availability === 'franja') {
                state.stage = 'entering-times';
                return { response: `📅 ${state.subject} - ${state.exam_type}\n\n⏰ ¿Hora de inicio? (Formato: HH:MM, ej: 14:00)`, completed: false };
            }
            else {
                state.stage = 'entering-time';
                return { response: `📅 ${state.subject} - ${state.exam_type}\n\n⏰ ¿Hora de inicio? (Formato: HH:MM, ej: 14:00)`, completed: false };
            }
        }
        // Hora específica
        if (state.stage === 'entering-time') {
            if (!this.isValidTime(normalized)) {
                return { response: '❌ Formato inválido. Usa HH:MM (ej: 14:30)', completed: false };
            }
            state.exam_time = normalized;
            if (state.availability === 'hora-especifica' || state.availability === 'a-partir-de') {
                state.horaInicio = normalized;
            }
            state.stage = 'selecting-comision';
            return {
                response: `⏰ ${state.exam_time}\n\n🏢 ¿Hay comisiones? (Responde: no, 2, 3 o 4)`,
                completed: false,
            };
        }
        // Franjas horarias
        if (state.stage === 'entering-times') {
            if (!this.isValidTime(normalized)) {
                return { response: '❌ Formato inválido. Usa HH:MM (ej: 14:00)', completed: false };
            }
            if (!state.horaInicio) {
                state.horaInicio = normalized;
                state.stage = 'entering-times';
                return { response: `⏰ Inicio: ${normalized}\n\n¿Hora de fin? (Formato: HH:MM, ej: 16:00)`, completed: false };
            }
            else {
                state.horaFin = normalized;
                state.exam_time = state.horaInicio;
                state.stage = 'selecting-comision';
                return {
                    response: `⏰ Franja: ${state.horaInicio} - ${normalized}\n\n🏢 ¿Hay comisiones? (Responde: no, 2, 3 o 4)`,
                    completed: false,
                };
            }
        }
        // Comisiones
        if (state.stage === 'selecting-comision') {
            if (normalized.toLowerCase() === 'no' || normalized === '1') {
                state.comision = 'unica';
                state.stage = 'selecting-freq';
                return {
                    response: `✅ Comisión única\n\n📢 Frecuencia de avisos (Por defecto: 7d,3d,1d,20m)\nFormato: 7d = 7 días antes, 1d = 1 día, 20m = 20 minutos\nPuedes dejar en blanco para usar defaults.`,
                    completed: false,
                };
            }
            else if (['2', '3', '4'].includes(normalized)) {
                state.comision = normalized;
                state.stage = 'selecting-freq'; // Skip same time question for now
                return {
                    response: `📢 Frecuencia de avisos\n(Por defecto: 7d,3d,1d,20m)\n\nPuedes dejar en blanco o escribir personalizado.`,
                    completed: false,
                };
            }
            return { response: '❌ Opción no válida. Responde: no, 2, 3 o 4', completed: false };
        }
        // Frecuencias
        if (state.stage === 'selecting-freq') {
            if (normalized === '1' || normalized === 'predeterminada' || normalized === 'default' || normalized === '') {
                state.frecuencia = this.DEFAULT_FREQUENCY;
                state.stage = 'confirming';
                const summary = this.buildSummary(state);
                return {
                    response: `📋 Resumen:\n${summary}\n\n✅ ¿Confirmar? (sí/no)`,
                    completed: false,
                };
            }
            if (normalized === '2' || normalized === 'personalizada' || normalized === 'custom') {
                state.stage = 'entering-frequency';
                return {
                    response: `📢 Escribe la frecuencia personalizada separada por coma.\nEjemplo: 10d,5d,1d,20m\nUnidades válidas: d = días, h = horas, m = minutos`,
                    completed: false,
                };
            }
            return {
                response: '❌ Opción no válida. Responde 1 para usar la frecuencia predeterminada o 2 para escribir una personalizada.',
                completed: false,
            };
        }
        if (state.stage === 'entering-frequency') {
            const normalizedFrequency = normalized.replace(/\s+/g, '');
            if (!this.isValidFrequencyList(normalizedFrequency)) {
                return {
                    response: '❌ Frecuencia inválida. Usa formato como 10d,5d,1d,20m',
                    completed: false,
                };
            }
            state.frecuencia = normalizedFrequency;
            state.stage = 'confirming';
            const summary = this.buildSummary(state);
            return {
                response: `📋 Resumen:\n${summary}\n\n✅ ¿Confirmar? (sí/no)`,
                completed: false,
            };
        }
        // Confirmación
        if (state.stage === 'confirming') {
            if (normalized === 'sí' || normalized === 'si') {
                const examData = {
                    subject: state.subject,
                    exam_type: state.exam_type,
                    exam_date: state.exam_date ? this.parseDateToLocalDate(state.exam_date) : new Date(),
                    exam_time: state.exam_time,
                    observations: state.observations || '',
                    tipoDisponibilidad: state.availability,
                    horaInicio: state.horaInicio,
                    horaFin: state.horaFin,
                    frecuenciaAvisos: state.frecuencia || this.DEFAULT_FREQUENCY,
                };
                this.userStates.delete(userId);
                return {
                    response: `✅ Examen cargado exitosamente!`,
                    completed: true,
                    examData,
                };
            }
            else {
                this.userStates.delete(userId);
                return {
                    response: `❌ Carga cancelada.`,
                    completed: false,
                };
            }
        }
        return { response: '❌ Error en el flujo.', completed: false };
    }
    /**
     * Guarda el examen en la base de datos
     */
    async saveExam(examData) {
        if (!this.examRepository) {
            console.warn('[ExamMenuService] Repository no disponible');
            return null;
        }
        try {
            const examDate = examData.exam_date instanceof Date
                ? examData.exam_date
                : this.parseDateToLocalDate(String(examData.exam_date || ''));
            const insertData = {
                subject: examData.subject,
                exam_type: examData.exam_type,
                exam_date: examDate,
                exam_time: examData.exam_time,
                observations: examData.observations || '',
                tipoDisponibilidad: examData.tipoDisponibilidad,
                horaInicio: examData.horaInicio,
                horaFin: examData.horaFin,
                frecuenciaAvisos: examData.frecuenciaAvisos,
                created_by: 'system',
            };
            const id = await this.examRepository.create(insertData);
            return id;
        }
        catch (error) {
            console.error('[ExamMenuService] Error guardando examen:', error);
            return null;
        }
    }
    /**
     * Verifica si un usuario está en medio de un flujo
     */
    isInFlow(userId) {
        return this.userStates.has(userId);
    }
    /**
     * Cancela el flujo de un usuario
     */
    cancelFlow(userId) {
        this.userStates.delete(userId);
    }
    isValidTime(time) {
        const match = time.match(/^(\d{1,2}):(\d{2})$/);
        if (!match)
            return false;
        const hour = parseInt(match[1], 10);
        const minute = parseInt(match[2], 10);
        return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    }
    buildSummary(state) {
        let summary = `📝 ${state.subject} - ${state.exam_type}\n`;
        summary += `📅 Fecha: ${state.exam_date || '(sin fecha)'}\n`;
        summary += `📅 Tipo: ${state.availability === 'hora-especifica' ? 'Hora específica' : state.availability === 'franja' ? 'Franja horaria' : 'A partir de'}\n`;
        if (state.availability === 'franja') {
            summary += `⏰ ${state.horaInicio} - ${state.horaFin}\n`;
        }
        else {
            summary += `⏰ ${state.exam_time}\n`;
        }
        summary += `🏢 Comisión: ${state.comision === 'unica' ? 'Única' : state.comision}\n`;
        summary += `📢 Avisos: ${state.frecuencia}`;
        return summary;
    }
    isValidDate(date) {
        const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!match)
            return false;
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        const year = parseInt(match[3], 10);
        if (month < 1 || month > 12)
            return false;
        if (day < 1 || day > 31)
            return false;
        if (year < 2026 || year > 2035)
            return false;
        return true;
    }
    isValidFrequencyList(value) {
        const parts = value.split(',').filter(Boolean);
        if (!parts.length)
            return false;
        return parts.every((part) => /^(\d+)([dhm])$/.test(part));
    }
    parseDateToLocalDate(value) {
        const normalized = value.includes('/') ? this.parseDateToISO(value) : value;
        const parts = normalized.split('-').map(Number);
        if (parts.length === 3 && parts.every(part => !Number.isNaN(part))) {
            return new Date(parts[0], parts[1] - 1, parts[2]);
        }
        return new Date();
    }
    parseDateToISO(dateStr) {
        const [day, month, year] = dateStr.split('/');
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
}
exports.ExamMenuService = ExamMenuService;
