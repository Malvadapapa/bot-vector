/**
 * Servicio de escalado de casos para moderadores y admins
 * Gestiona situaciones complejas que requieren revisión manual
 */

export enum EscalationLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface EscalatedCase {
  id: string;
  userId: string;
  username?: string;
  level: EscalationLevel;
  reason: string;
  description: string;
  createdAt: Date;
  status: 'open' | 'reviewing' | 'resolved';
  assignedAdmin?: string;
  notes: string[];
  actionTaken?: string;
}

export class CaseEscalationService {
  private cases = new Map<string, EscalatedCase>();
  private caseCounter = 0;

  /**
   * Crea un nuevo caso escalado
   */
  createCase(
    userId: string,
    reason: string,
    description: string,
    level: EscalationLevel = EscalationLevel.MEDIUM,
    username?: string,
  ): EscalatedCase {
    const caseId = `CASE-${++this.caseCounter}`;

    const escalatedCase: EscalatedCase = {
      id: caseId,
      userId,
      username,
      level,
      reason,
      description,
      createdAt: new Date(),
      status: 'open',
      notes: [],
    };

    this.cases.set(caseId, escalatedCase);
    console.log(`[CaseEscalation] Nuevo caso: ${caseId} - ${reason}`);

    return escalatedCase;
  }

  /**
   * Agrega nota a un caso
   */
  addNote(caseId: string, note: string, author?: string): boolean {
    const caseData = this.cases.get(caseId);
    if (!caseData) {
      return false;
    }

    caseData.notes.push(`[${new Date().toLocaleTimeString('es-AR')}] ${author || 'Admin'}: ${note}`);
    return true;
  }

  /**
   * Asigna un caso a un admin
   */
  assignCase(caseId: string, adminName: string): boolean {
    const caseData = this.cases.get(caseId);
    if (!caseData) {
      return false;
    }

    caseData.assignedAdmin = adminName;
    caseData.status = 'reviewing';
    return true;
  }

  /**
   * Resuelve un caso
   */
  resolveCase(caseId: string, action: string): boolean {
    const caseData = this.cases.get(caseId);
    if (!caseData) {
      return false;
    }

    caseData.status = 'resolved';
    caseData.actionTaken = action;
    return true;
  }

  /**
   * Obtiene casos abiertos
   */
  getOpenCases(): EscalatedCase[] {
    return Array.from(this.cases.values()).filter(c => c.status === 'open');
  }

  /**
   * Obtiene casos por usuario
   */
  getCasesByUser(userId: string): EscalatedCase[] {
    return Array.from(this.cases.values()).filter(c => c.userId === userId);
  }

  /**
   * Obtiene casos por nivel
   */
  getCasesByLevel(level: EscalationLevel): EscalatedCase[] {
    return Array.from(this.cases.values()).filter(c => c.level === level);
  }

  /**
   * Formatea caso para mostrar en chat
   */
  formatCaseForChat(caseData: EscalatedCase): string {
    const lines = [`📋 *Caso: ${caseData.id}*\n`];

    lines.push(`Usuario: ${caseData.username || caseData.userId}`);
    lines.push(`Nivel: ${this.getLevelEmoji(caseData.level)} ${caseData.level}`);
    lines.push(`Estado: ${caseData.status}`);
    lines.push(`Razón: ${caseData.reason}\n`);

    lines.push(`Descripción: ${caseData.description}\n`);

    if (caseData.assignedAdmin) {
      lines.push(`Asignado a: ${caseData.assignedAdmin}`);
    }

    if (caseData.notes.length > 0) {
      lines.push(`\n📝 Notas:`);
      for (const note of caseData.notes.slice(-5)) {
        lines.push(`  ${note}`);
      }
    }

    if (caseData.actionTaken) {
      lines.push(`\n✅ Acción: ${caseData.actionTaken}`);
    }

    return lines.join('\n');
  }

  /**
   * Obtiene resumen de casos abiertos
   */
  getSummary(): string {
    const allCases = Array.from(this.cases.values());
    const openCases = allCases.filter(c => c.status === 'open');
    const reviewing = allCases.filter(c => c.status === 'reviewing');
    const critical = allCases.filter(c => c.level === EscalationLevel.CRITICAL && c.status !== 'resolved');

    const lines = ['📊 *Resumen de Casos*\n'];
    lines.push(`Total: ${allCases.length}`);
    lines.push(`Abiertos: ${openCases.length} 🟢`);
    lines.push(`En revisión: ${reviewing.length} 🟡`);
    lines.push(`Críticos: ${critical.length} 🔴`);

    return lines.join('\n');
  }

  private getLevelEmoji(level: EscalationLevel): string {
    switch (level) {
      case EscalationLevel.LOW:
        return '🟢';
      case EscalationLevel.MEDIUM:
        return '🟡';
      case EscalationLevel.HIGH:
        return '🟠';
      case EscalationLevel.CRITICAL:
        return '🔴';
    }
  }

  /**
   * Obtiene un caso por ID
   */
  getCase(caseId: string): EscalatedCase | undefined {
    return this.cases.get(caseId);
  }
}
