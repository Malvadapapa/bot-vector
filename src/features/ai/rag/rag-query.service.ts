import path from 'node:path';
import fs from 'node:fs/promises';
import { EmbeddingProvider } from '../providers/embedding-provider.interface.js';
import { VectorStorage } from './vector-storage.js';

export interface RagSearchResult {
  text: string;
  sourceFile: string;
  pageNumber?: number;
  score: number;
  weak: boolean; // Indica si el resultado no superó el umbral deseado pero se incluyó por falta de datos
}

export class RagQueryService {
  private vectorStorage: VectorStorage;
  private loaded = false;
  private lastModifiedMs = 0;
  private generalStoragePath: string;

  constructor(
    private storageFilePath: string,
    private embeddingProvider: EmbeddingProvider,
    private readonly minScore = 0.35
  ) {
    this.generalStoragePath = path.join(path.dirname(storageFilePath), 'general', 'vector_store.json');
    this.vectorStorage = new VectorStorage(this.generalStoragePath);
  }

  public async search(query: string, topK = 3, groupId?: string): Promise<RagSearchResult[]> {
    try {
      await this.ensureLoaded();

      const queryVector = await this.embeddingProvider.generateEmbedding(query);

      // 1. Búsqueda en General
      let generalRaw: Array<{ record: any; score: number }> = [];
      if (this.vectorStorage.getRecordCount() > 0) {
        generalRaw = await this.vectorStorage.searchSimilar(queryVector, topK);
      }

      // 2. Búsqueda en Grupo si corresponde
      let groupRaw: Array<{ record: any; score: number }> = [];
      if (groupId) {
        const cleanGid = groupId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const groupStoragePath = path.join(path.dirname(this.storageFilePath), 'groups', cleanGid, 'vector_store.json');
        const groupStorage = new VectorStorage(groupStoragePath);
        try {
          await groupStorage.load();
          if (groupStorage.getRecordCount() > 0) {
            groupRaw = await groupStorage.searchSimilar(queryVector, topK);
          }
        } catch (e) {
          // Ignorar si no existe
        }
      }

      // 3. Fusionar y clasificar (prioridad a grupo)
      const groupStrong = groupRaw.filter((r) => r.score >= this.minScore).map((r) => ({ ...r, weak: false }));
      const generalStrong = generalRaw.filter((r) => r.score >= this.minScore).map((r) => ({ ...r, weak: false }));

      let finalResults: Array<{ record: any; score: number; weak: boolean }> = [];

      if (groupStrong.length > 0 || generalStrong.length > 0) {
        finalResults = [...groupStrong, ...generalStrong];
      } else {
        const groupWeak = groupRaw.filter((r) => r.score >= 0.15).map((r) => ({ ...r, weak: true }));
        const generalWeak = generalRaw.filter((r) => r.score >= 0.15).map((r) => ({ ...r, weak: true }));
        finalResults = [...groupWeak, ...generalWeak];
      }

      // Limitar a topK
      const filtered = finalResults.slice(0, topK).map((r) => ({
        text: r.record.text,
        sourceFile: r.record.metadata.sourceFile,
        pageNumber: r.record.metadata.pageNumber,
        score: r.score,
        weak: r.weak,
      }));

      if (filtered.length > 0) {
        console.log(
          `[RAG] Búsqueda exitosa (${groupId ? `grupo: ${groupId}` : 'solo general'}): ${filtered.length} chunks (scores: ${filtered.map((r) => r.score.toFixed(3)).join(', ')}${filtered[0].weak ? ' - DÉBIL' : ''})`,
        );
      }

      return filtered;
    } catch (error) {
      console.error(`[RAG] Error en búsqueda (se continúa sin contexto RAG):`, (error as any)?.message || error);
      return [];
    }
  }

  /**
   * Formatea los resultados de búsqueda RAG como texto para inyectar en el prompt.
   * Retorna null si no hay resultados relevantes.
   */
  public formatContext(results: RagSearchResult[]): string | null {
    if (results.length === 0) return null;

    const fragments = results.map(
      (r, i) => {
        const pageText = r.pageNumber ? ` (Página ${r.pageNumber})` : '';
        return `[Fragmento ${i + 1} — ${r.sourceFile}${pageText}]:\n${r.text}`;
      }
    );

    return [
      '📚 Información institucional relevante (del reglamento/documentación):',
      ...fragments,
    ].join('\n\n');
  }

  /** Indica si el servicio tiene vectores cargados y disponibles. */
  public isAvailable(): boolean {
    return this.loaded && this.vectorStorage.getRecordCount() > 0;
  }

  /** Cantidad de vectores cargados. */
  public getVectorCount(): number {
    return this.vectorStorage.getRecordCount();
  }

  /**
   * Carga lazy del vector store. Recarga automáticamente si el archivo
   * fue modificado en disco (por ejemplo, después de un rag:index).
   */
  private async ensureLoaded(): Promise<void> {
    try {
      const stat = await fs.stat(this.generalStoragePath);
      const currentMtime = Math.round(stat.mtimeMs);

      if (!this.loaded || currentMtime !== this.lastModifiedMs) {
        await this.vectorStorage.load();
        this.lastModifiedMs = currentMtime;
        this.loaded = true;

        if (this.vectorStorage.getRecordCount() > 0) {
          console.log(`[RAG] Vector store cargado: ${this.vectorStorage.getRecordCount()} vectores.`);
        } else {
          console.log(`[RAG] Vector store vacío. Ejecutá "npm run rag:index" para indexar los PDFs.`);
        }
      }
    } catch (error) {
      if ((error as any)?.code === 'ENOENT') {
        this.loaded = true; // Marcamos como cargado pero vacío
        return;
      }
      throw error;
    }
  }
}
