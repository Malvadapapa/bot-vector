import { ManagedTeacherRepository, CommissionRepository } from './academic-calendar.repository.js';
import { ManagedTeacher } from './academic-calendar.models.js';

export interface TeacherMenuState {
  userId: string;
  groupId?: string;
  stage: 'selecting-subject' | 'selecting-commission';
  subjects: string[];
  teachers: ManagedTeacher[];
  selectedSubject?: string;
  commissionOptions?: Array<{ id: number | undefined; name: string }>;
}

export class TeacherMenuService {
  private userStates = new Map<string, TeacherMenuState>();

  constructor(
    private managedTeacherRepository: ManagedTeacherRepository,
    private commissionRepository: CommissionRepository
  ) {}

  async startTeacherFlow(userId: string, groupId?: string): Promise<string> {
    const teachers = await this.managedTeacherRepository.listAll(groupId);
    if (!teachers.length) {
      return 'No hay profesores cargados. ¡Pídele al admin que cargue los emails!';
    }

    // Obtener materias únicas
    const subjectsSet = new Set<string>();
    for (const t of teachers) {
      if (t.subject) {
        subjectsSet.add(t.subject);
      }
    }
    const uniqueSubjects = Array.from(subjectsSet).sort();

    if (!uniqueSubjects.length) {
      return 'No hay materias asociadas a los profesores cargados.';
    }

    this.userStates.set(userId, {
      userId,
      groupId,
      stage: 'selecting-subject',
      subjects: uniqueSubjects,
      teachers
    });

    const parts = [
      '👨‍🏫 *Directorio de Profesores*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      'Seleccioná la materia:',
      ''
    ];
    uniqueSubjects.forEach((subject, idx) => {
      parts.push(`${idx + 1} - ${subject}`);
    });
    parts.push('', '0 - Volver al menú principal');

    return parts.join('\n');
  }

  async processInput(userId: string, input: string): Promise<{ response: string; completed: boolean }> {
    const state = this.userStates.get(userId);
    if (!state) {
      return { response: '❌ Flujo expirado. Por favor, vuelve a iniciar.', completed: true };
    }

    const normalized = input.trim();

    if (state.stage === 'selecting-subject') {
      const idx = parseInt(normalized, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= state.subjects.length) {
        return { response: '❌ Número inválido. Por favor, seleccioná una materia de la lista.', completed: false };
      }

      const selectedSubject = state.subjects[idx];
      state.selectedSubject = selectedSubject;

      // Filtrar profesores por materia
      const teachersForSubject = state.teachers.filter(t => t.subject === selectedSubject);

      // Obtener comisiones únicas para esta materia
      const uniqueCommissionIds = Array.from(new Set(teachersForSubject.map(t => t.commission_id)));

      const commissionOptions: Array<{ id: number | undefined; name: string }> = [];
      for (const cid of uniqueCommissionIds) {
        if (cid === undefined || cid === null) {
          commissionOptions.push({ id: undefined, name: 'General/Sin Comisión' });
        } else {
          const comm = await this.commissionRepository.getById(cid);
          commissionOptions.push({ id: cid, name: comm ? comm.name : `Comisión ${cid}` });
        }
      }

      // Ordenar comisiones por nombre para presentarlas ordenadas
      commissionOptions.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

      state.commissionOptions = commissionOptions;
      state.stage = 'selecting-commission';
      this.userStates.set(userId, state);

      const parts = [
        `📚 *Materia: ${selectedSubject}*`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        'Seleccioná la comisión:',
        ''
      ];
      commissionOptions.forEach((opt, index) => {
        parts.push(`${index + 1} - ${opt.name}`);
      });
      parts.push('', '0 - Volver al menú principal');

      return { response: parts.join('\n'), completed: false };
    }

    if (state.stage === 'selecting-commission') {
      const idx = parseInt(normalized, 10) - 1;
      if (isNaN(idx) || !state.commissionOptions || idx < 0 || idx >= state.commissionOptions.length) {
        return { response: '❌ Número inválido. Por favor, seleccioná una comisión de la lista.', completed: false };
      }

      const selectedComm = state.commissionOptions[idx];
      const matchingTeachers = state.teachers.filter(t => 
        t.subject === state.selectedSubject && 
        (t.commission_id === selectedComm.id || (t.commission_id === undefined && selectedComm.id === undefined))
      );

      this.userStates.delete(userId);

      if (!matchingTeachers.length) {
        return {
          response: `❌ No se encontró un profesor asignado para la materia ${state.selectedSubject} en la comisión ${selectedComm.name}.`,
          completed: true
        };
      }

      const parts = [
        '👨‍🏫 *Información del Profesor*',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━',
        ''
      ];
      for (const t of matchingTeachers) {
        parts.push(`📚 *Materia:* ${t.subject}`);
        parts.push(`👥 *Comisión:* ${selectedComm.name}`);
        parts.push(`👤 *Profesor:* ${t.name}`);
        parts.push(`📧 *Email:* ${t.email}`);
        parts.push('');
      }
      parts.push('Escribí !menu para volver al inicio.');

      return { response: parts.join('\n').trim(), completed: true };
    }

    return { response: '❌ Error en el flujo.', completed: true };
  }

  cancelFlow(userId: string): void {
    this.userStates.delete(userId);
  }

  isInFlow(userId: string): boolean {
    return this.userStates.has(userId);
  }
}
