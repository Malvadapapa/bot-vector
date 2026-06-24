// ============================================================
// ManageExamsUseCase — CRUD + ABP warning logic
// ============================================================

import type { IExamRepository, IGroupRepository } from '../interfaces/repositories';
import type { Exam, ExamType } from '../../domain/entities';

export interface ABPWarning {
  subjectId: string;
  subjectName: string;
  evidenceCount: number;
}

export class ManageExamsUseCase {
  constructor(
    private examRepo: IExamRepository,
    private groupRepo?: IGroupRepository,
  ) {}

  async getAll(groupId: string): Promise<Exam[]> {
    return this.examRepo.getAll(groupId);
  }

  async getBySubject(subjectId: string): Promise<Exam[]> {
    return this.examRepo.getBySubject(subjectId);
  }

  async getByType(groupId: string, type: ExamType): Promise<Exam[]> {
    return this.examRepo.getByType(groupId, type);
  }

  async create(exam: Omit<Exam, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ exam?: Exam; error?: string }> {
    // Validate evidence limit
    if (exam.type === 'evidence') {
      const count = await this.examRepo.countEvidences(exam.subjectId);
      
      // Determine if subject is annual
      let isAnnual = false;
      if (this.groupRepo) {
        const subjects = await this.groupRepo.getSubjects(exam.groupId);
        const subject = subjects.find(s => s.id === exam.subjectId);
        isAnnual = subject?.isAnnual || false;
      }
      
      const maxEvidences = isAnnual ? 6 : 3;
      if (count >= maxEvidences) {
        return { error: `Ya existen ${maxEvidences} evidencias de aprendizaje para esta materia en el ${isAnnual ? 'año' : 'cuatrimestre'} actual.` };
      }
    }

    // Validate single ABP per subject
    if (exam.type === 'abp') {
      const hasABP = await this.examRepo.hasABPDefense(exam.subjectId);
      if (hasABP) {
        return { error: 'Ya existe una defensa de ABP registrada para esta materia.' };
      }
    }

    // Validate date ranges for evidence
    if (exam.type === 'evidence' && !exam.endDate) {
      return { error: 'Las evidencias de aprendizaje requieren un rango de fechas (inicio y fin).' };
    }

    const created = await this.examRepo.create(exam);
    return { exam: created };
  }

  async update(id: string, data: Partial<Exam>): Promise<Exam> {
    return this.examRepo.update(id, data);
  }

  async delete(id: string): Promise<void> {
    return this.examRepo.delete(id);
  }

  /**
   * Get all subjects that have 3 evidences but are missing ABP defense.
   * This triggers the red warning banner.
   */
  async getABPWarnings(groupId: string): Promise<ABPWarning[]> {
    const warnings = await this.examRepo.getABPWarnings(groupId);
    const results: ABPWarning[] = [];

    for (const w of warnings) {
      const count = await this.examRepo.countEvidences(w.subjectId);
      results.push({
        subjectId: w.subjectId,
        subjectName: w.subjectName,
        evidenceCount: count,
      });
    }

    return results;
  }

  async countEvidences(subjectId: string): Promise<number> {
    return this.examRepo.countEvidences(subjectId);
  }

  async hasABPDefense(subjectId: string): Promise<boolean> {
    return this.examRepo.hasABPDefense(subjectId);
  }
}
