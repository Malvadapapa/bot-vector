import fs from 'node:fs/promises';
import path from 'node:path';
import { VectorRecord } from './models.js';

export class VectorStorage {
  private records: VectorRecord[] = [];

  constructor(private storageFilePath: string) {}

  public async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.storageFilePath, 'utf8');
      const parsed = JSON.parse(data);
      
      if (!Array.isArray(parsed)) {
        throw new Error('El archivo del vector store no contiene un array válido.');
      }

      this.records = parsed as VectorRecord[];

      // Validación de consistencia: asegurarse de que todos los vectores tengan la misma dimensión
      if (this.records.length > 0) {
        const expectedDim = this.records[0].vector?.length;
        if (!expectedDim) {
          throw new Error('El primer registro del vector store no tiene un vector válido.');
        }

        const validRecords = this.records.filter(r => r.vector && r.vector.length === expectedDim);
        if (validRecords.length !== this.records.length) {
          console.warn(`[VectorStorage] Advertencia: Se descartaron ${this.records.length - validRecords.length} vectores por inconsistencia en dimensiones (se esperaba dimensión ${expectedDim}).`);
          this.records = validRecords;
        }
      }
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        this.records = [];
      } else {
        console.error(`[VectorStorage] Error al cargar o validar el store:`, error);
        throw error;
      }
    }
  }

  public async save(): Promise<void> {
    const dir = path.dirname(this.storageFilePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.storageFilePath, JSON.stringify(this.records, null, 2), 'utf8');
  }

  public removeBySourceFile(sourceFile: string): void {
    this.records = this.records.filter((r) => r.metadata.sourceFile !== sourceFile);
  }

  public addRecords(records: VectorRecord[]): void {
    this.records.push(...records);
  }

  public getRecordCount(): number {
    return this.records.length;
  }

  public async searchSimilar(queryVector: number[], topK: number = 3): Promise<Array<{ record: VectorRecord; score: number }>> {
    if (this.records.length === 0) return [];

    const results = this.records.map((record) => ({
      record,
      score: this.cosineSimilarity(queryVector, record.vector),
    }));

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
