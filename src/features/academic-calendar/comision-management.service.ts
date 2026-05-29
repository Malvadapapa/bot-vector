/**
 * Servicio de gestión de comisiones para asignaturas
 * Maneja creación, actualización y eliminación de comisiones
 * Define horarios y opciones de examen por comisión
 */

export interface ComisionOption {
  id: number;
  nombre: string;
  horario?: string; // ej: "14:00-16:00"
  profesor?: string;
  visible: boolean;
}

export interface AsignaturaComisiones {
  id: number;
  nombre: string;
  comisiones: ComisionOption[];
  activa: boolean;
  updatedAt: string;
}

export class ComisionManagementService {
  private comisionesMap = new Map<number, AsignaturaComisiones>();

  /**
   * Obtiene comisiones para una asignatura
   */
  getComisiones(asignaturaId: number): ComisionOption[] {
    const asignatura = this.comisionesMap.get(asignaturaId);
    if (!asignatura) {
      return [];
    }
    return asignatura.comisiones.filter(c => c.visible);
  }

  /**
   * Crea una nueva comisión para una asignatura
   */
  createComision(
    asignaturaId: number,
    nombre: string,
    horario?: string,
    profesor?: string,
  ): ComisionOption {
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

    const newComision: ComisionOption = {
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
  updateComision(asignaturaId: number, comisionId: number, updates: Partial<ComisionOption>): boolean {
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
  deleteComision(asignaturaId: number, comisionId: number): boolean {
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
  formatComisionesForChat(asignaturaId: number, asignaturaNombre: string): string {
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
  hasDifferentTimings(examTimes: Map<number, string>): boolean {
    const times = Array.from(examTimes.values());
    return new Set(times).size > 1;
  }

  /**
   * Agrupa exámenes por comisión
   */
  groupExamsByComision(examDataWithComisiones: Array<{ comisionId: number; time: string }>): Map<number, string[]> {
    const grouped = new Map<number, string[]>();

    for (const exam of examDataWithComisiones) {
      if (!grouped.has(exam.comisionId)) {
        grouped.set(exam.comisionId, []);
      }
      grouped.get(exam.comisionId)!.push(exam.time);
    }

    return grouped;
  }
}
