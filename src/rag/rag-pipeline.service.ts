import fs from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';

import { SyncState } from './sync-state.js';
import { PDFExtractor } from './pdf-extractor.js';
import { SemanticChunker } from './semantic-chunker.js';
import { EmbeddingProvider } from '../infrastructure/integrations/ai/embedding-provider.interface.js';
import { VectorStorage } from './vector-storage.js';
import { VectorRecord } from './models.js';

export class RagPipelineService {
  private syncState: SyncState;
  private pdfExtractor: PDFExtractor;
  private chunker: SemanticChunker;
  private vectorStorage: VectorStorage;
  // Guardamos los que fallaron en memoria para el reporte
  private failedFiles: string[] = [];

  constructor(
    private knowledgeDir: string,
    private stateFilePath: string,
    private storageFilePath: string,
    private embeddingProvider: EmbeddingProvider
  ) {
    this.syncState = new SyncState(stateFilePath);
    this.pdfExtractor = new PDFExtractor();
    this.chunker = new SemanticChunker();
    this.vectorStorage = new VectorStorage(storageFilePath);
  }

  public async runSync(forceAll = false): Promise<void> {
    console.log(`[RAG] Iniciando sincronización de base de conocimiento...`);
    await this.vectorStorage.load();
    const state = await this.syncState.loadState();
    this.failedFiles = [];
    
    // Ensure dir exists
    await fs.mkdir(this.knowledgeDir, { recursive: true });
    
    const files = await fs.readdir(this.knowledgeDir);
    const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));

    const currentFilesSet = new Set(pdfFiles);
    const stateFilesSet = new Set(Object.keys(state));
    
    let processedCount = 0;
    let deletedCount = 0;

    // 1. Manejar archivos borrados
    for (const stateFile of stateFilesSet) {
      if (!currentFilesSet.has(stateFile)) {
        console.log(`[RAG] Archivo eliminado detectado: ${stateFile}`);
        this.vectorStorage.removeBySourceFile(stateFile);
        delete state[stateFile];
        deletedCount++;
      }
    }

    // 2. Manejar archivos nuevos o modificados
    for (const file of pdfFiles) {
      const filePath = path.join(this.knowledgeDir, file);
      const currentHash = await this.syncState.getFileHash(filePath);

      if (forceAll || state[file] !== currentHash) {
        console.log(`[RAG] Indexando archivo: ${file}...`);
        
        // Si ya existía, borrar sus vectores viejos
        if (state[file]) {
          this.vectorStorage.removeBySourceFile(file);
        }

        try {
          const pagesText = await this.pdfExtractor.extractText(filePath);
          const chunks = this.chunker.chunkText(pagesText, file, currentHash);
          
          console.log(`[RAG] -> ${chunks.length} chunks generados. Generando embeddings...`);
          
          // Generar embeddings
          const vectors = await this.embeddingProvider.generateBatchEmbeddings(chunks.map(c => c.text));
          
          // Combinar y guardar
          const records: VectorRecord[] = chunks.map((chunk, i) => ({
            id: chunk.metadata.id,
            text: chunk.text,
            vector: vectors[i],
            metadata: chunk.metadata
          }));

          this.vectorStorage.addRecords(records);
          state[file] = currentHash;
          processedCount++;
          console.log(`[RAG] -> ${file} indexado correctamente.`);
        } catch (error) {
          console.error(`[RAG] Error indexando ${file}:`, error);
          this.failedFiles.push(file);
        }
      }
    }

    // 3. Guardar estado y vectores si hubo cambios
    if (processedCount > 0 || deletedCount > 0 || forceAll) {
      console.log(`[RAG] Guardando cambios en el storage...`);
      await this.vectorStorage.save();
      await this.syncState.saveState(state);
      console.log(`[RAG] Sincronización completa. Vectores totales: ${this.vectorStorage.getRecordCount()}`);
    } else {
      console.log(`[RAG] Sincronización completa. No se detectaron cambios.`);
    }

    if (this.failedFiles.length > 0) {
      console.warn(`[RAG] Advertencia: ${this.failedFiles.length} archivos fallaron al indexar: ${this.failedFiles.join(', ')}`);
    }
  }

  public async getStatus(): Promise<{ files: number; totalVectors: number; failed: number }> {
    await this.vectorStorage.load();
    const state = await this.syncState.loadState();
    return {
      files: Object.keys(state).length,
      totalVectors: this.vectorStorage.getRecordCount(),
      failed: this.failedFiles.length
    };
  }

  // Método de utilidad para el futuro, para probar la búsqueda
  public async testSearch(query: string): Promise<void> {
    await this.vectorStorage.load();
    const queryVector = await this.embeddingProvider.generateEmbedding(query);
    const results = await this.vectorStorage.searchSimilar(queryVector, 3);
    
    console.log(`\n=== Búsqueda de prueba: "${query}" ===`);
    if (results.length === 0) {
      console.log('No hay resultados.');
      return;
    }
    results.forEach((r, i) => {
      console.log(`\n--- Resultado ${i + 1} (Score: ${r.score.toFixed(4)}) [${r.record.metadata.sourceFile}] ---`);
      console.log(r.record.text.slice(0, 300) + '...');
    });
  }
}
