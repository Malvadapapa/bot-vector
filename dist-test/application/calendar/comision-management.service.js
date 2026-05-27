"use strict";
/**
 * Servicio de gestión de comisiones para asignaturas
 * Maneja creación, actualización y eliminación de comisiones
 * Define horarios y opciones de examen por comisión
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComisionManagementService = void 0;
class ComisionManagementService {
    constructor() {
        this.comisionesMap = new Map();
    }
    /**
     * Obtiene comisiones para una asignatura
     */
    getComisiones(asignaturaId) {
        const asignatura = this.comisionesMap.get(asignaturaId);
        if (!asignatura) {
            return [];
        }
        return asignatura.comisiones.filter(c => c.visible);
    }
    /**
     * Crea una nueva comisión para una asignatura
     */
    createComision(asignaturaId, nombre, horario, profesor) {
        let asignatura = this.comisionesMap.get(asignaturaId);
        if (!asignatura) {
            asignatura = {
                id: asignaturaId,
                nombre: `Asignatura ${asignaturaId}`,
                comisiones: [],
                activa: true,
                updatedAt: new Date().toISOString(),
            };
            this.comisionesMap.set(asignaturaId, asignatura);
        }
        const newComision = {
            id: asignatura.comisiones.length + 1,
            nombre,
            horario,
            profesor,
            visible: true,
        };
        asignatura.comisiones.push(newComision);
        asignatura.updatedAt = new Date().toISOString();
        return newComision;
    }
    /**
     * Actualiza una comisión existente
     */
    updateComision(asignaturaId, comisionId, updates) {
        const asignatura = this.comisionesMap.get(asignaturaId);
        if (!asignatura) {
            return false;
        }
        const comision = asignatura.comisiones.find(c => c.id === comisionId);
        if (!comision) {
            return false;
        }
        Object.assign(comision, updates);
        asignatura.updatedAt = new Date().toISOString();
        return true;
    }
    /**
     * Elimina una comisión (soft delete)
     */
    deleteComision(asignaturaId, comisionId) {
        const asignatura = this.comisionesMap.get(asignaturaId);
        if (!asignatura) {
            return false;
        }
        const comision = asignatura.comisiones.find(c => c.id === comisionId);
        if (!comision) {
            return false;
        }
        comision.visible = false;
        asignatura.updatedAt = new Date().toISOString();
        return true;
    }
    /**
     * Formatea comisiones para mostrar en chat
     */
    formatComisionesForChat(asignaturaId, asignaturaNombre) {
        const comisiones = this.getComisiones(asignaturaId);
        if (!comisiones.length) {
            return `No hay comisiones activas para ${asignaturaNombre}`;
        }
        const lines = [`📚 *Comisiones de ${asignaturaNombre}*\n`];
        for (const comision of comisiones) {
            lines.push(`${comision.id}. ${comision.nombre}`);
            if (comision.horario) {
                lines.push(`   ⏰ ${comision.horario}`);
            }
            if (comision.profesor) {
                lines.push(`   👨‍🏫 ${comision.profesor}`);
            }
        }
        return lines.join('\n');
    }
    /**
     * Determina si hay tiempos diferentes entre comisiones
     */
    hasDifferentTimings(examTimes) {
        const times = Array.from(examTimes.values());
        return new Set(times).size > 1;
    }
    /**
     * Agrupa exámenes por comisión
     */
    groupExamsByComision(examDataWithComisiones) {
        const grouped = new Map();
        for (const exam of examDataWithComisiones) {
            if (!grouped.has(exam.comisionId)) {
                grouped.set(exam.comisionId, []);
            }
            grouped.get(exam.comisionId).push(exam.time);
        }
        return grouped;
    }
}
exports.ComisionManagementService = ComisionManagementService;
