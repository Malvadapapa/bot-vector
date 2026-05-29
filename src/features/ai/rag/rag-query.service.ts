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

  constructor(
    private storageFilePath: string,
    private embeddingProvider: EmbeddingProvider,
    private readonly minScore = 0.35
  ) {
    this.vectorStorage = new VectorStorage(storageFilePath);
  }

  public async search(query: string, topK = 3): Promise<RagSearchResult[]> {
    try {
      await this.ensureLoaded();

      if (this.vectorStorage.getRecordCount() === 0) {
        return [];
      }

      const queryVector = await this.embeddingProvider.generateEmbedding(query);
      const raw = await this.vectorStorage.searchSimilar(queryVector, topK);

      // Separar los que pasan el umbral de los que no
      const strongMatches = raw.filter((r) => r.score >= this.minScore);
      
      let finalResults: Array<{ record: any; score: number; weak: boolean }> = [];

      if (strongMatches.length > 0) {
        finalResults = strongMatches.map(r => ({ ...r, weak: false }));
      } else {
        // Si nadie pasa el umbral, incluimos los topK (que superen al menos 0.15) como resultados "débiles"
        const weakMatches = raw.filter((r) => r.score >= 0.15);
        finalResults = weakMatches.map(r => ({ ...r, weak: true }));
      }

      const filtered = finalResults.map((r) => ({
        text: r.record.text,
        sourceFile: r.record.metadata.sourceFile,
        pageNumber: r.record.metadata.pageNumber,
        score: r.score,
        weak: r.weak,
      }));

      if (filtered.length > 0) {
        console.log(
          `[RAG] Búsqueda exitosa: ${filtered.length} chunks (scores: ${filtered.map((r) => r.score.toFixed(3)).join(', ')}${filtered[0].weak ? ' - DÉBIL' : ''})`,
        );
      }

      return filtered;
    } catch (error) {
      // Fallo silencioso: el bot sigue funcionando con el contexto interno disponible
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
      const stat = await fs.stat(this.storageFilePath);
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
