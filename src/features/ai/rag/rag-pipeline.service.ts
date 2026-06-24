import fs from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';

import { SyncState } from './sync-state.js';
import { PDFExtractor } from './pdf-extractor.js';
import { SemanticChunker } from './semantic-chunker.js';
import { EmbeddingProvider } from '../providers/embedding-provider.interface.js';
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
    const generalDir = path.join(this.knowledgeDir, 'general');
    const generalStatePath = path.join(path.dirname(this.stateFilePath), 'general', 'sync_state.json');
    const generalStoragePath = path.join(path.dirname(this.storageFilePath), 'general', 'vector_store.json');
    await this.syncScope(generalDir, generalStatePath, generalStoragePath, 'general', undefined, forceAll);
  }

  public async syncAll(activeGroupIds: string[], forceAll = false): Promise<void> {
    this.failedFiles = [];
    
    // 1. Sincronizar general
    const generalDir = path.join(this.knowledgeDir, 'general');
    const generalStatePath = path.join(path.dirname(this.stateFilePath), 'general', 'sync_state.json');
    const generalStoragePath = path.join(path.dirname(this.storageFilePath), 'general', 'vector_store.json');
    await this.syncScope(generalDir, generalStatePath, generalStoragePath, 'general', undefined, forceAll);

    // 2. Sincronizar cada grupo activo
    for (const gid of activeGroupIds) {
      const cleanGid = gid.replace(/[^a-zA-Z0-9_-]/g, '_');
      const groupDir = path.join(this.knowledgeDir, 'groups', cleanGid);
      const groupStatePath = path.join(path.dirname(this.stateFilePath), 'groups', cleanGid, 'sync_state.json');
      const groupStoragePath = path.join(path.dirname(this.storageFilePath), 'groups', cleanGid, 'vector_store.json');
      
      try {
        await this.syncScope(groupDir, groupStatePath, groupStoragePath, 'group', gid, forceAll);
      } catch (e) {
        console.error(`[RAG] Error sincronizando grupo ${gid}:`, e);
      }
    }
  }

  public async syncScope(
    scopeDir: string,
    statePath: string,
    storagePath: string,
    scope: 'general' | 'group',
    groupId?: string,
    forceAll = false
  ): Promise<void> {
    const scopeLabel = scope === 'general' ? 'general' : `grupo ${groupId}`;
    console.log(`[RAG] Iniciando sincronización (${scopeLabel})...`);
    const tempSyncState = new SyncState(statePath);
    const tempVectorStorage = new VectorStorage(storagePath);
    
    try {
      await tempVectorStorage.load();
    } catch (e) {
      // Ignorar error de carga si no existe
    }
    
    const state: Record<string, string> = await tempSyncState.loadState().catch(() => ({}));
    
    // Asegurar que exista la carpeta
    await fs.mkdir(scopeDir, { recursive: true });
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    
    const files = await fs.readdir(scopeDir);
    const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));

    const currentFilesSet = new Set(pdfFiles);
    const stateFilesSet = new Set(Object.keys(state));
    
    let processedCount = 0;
    let deletedCount = 0;

    // 1. Manejar archivos borrados
    for (const stateFile of stateFilesSet) {
      if (!currentFilesSet.has(stateFile)) {
        console.log(`[RAG] Archivo eliminado detectado: ${stateFile}`);
        tempVectorStorage.removeBySourceFile(stateFile);
        delete state[stateFile];
        deletedCount++;
      }
    }

    // 2. Manejar archivos nuevos o modificados
    for (const file of pdfFiles) {
      const filePath = path.join(scopeDir, file);
      const currentHash = await tempSyncState.getFileHash(filePath);

      if (forceAll || state[file] !== currentHash) {
        console.log(`[RAG] Indexando archivo: ${file}...`);
        
        // Si ya existía, borrar sus vectores viejos
        if (state[file]) {
          tempVectorStorage.removeBySourceFile(file);
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
            metadata: {
              ...chunk.metadata,
              scope,
              groupId
            }
          }));

          tempVectorStorage.addRecords(records);
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
      console.log(`[RAG] Guardando cambios en almacenamiento (${scopeLabel})...`);
      await tempVectorStorage.save();
      await tempSyncState.saveState(state);
      console.log(`[RAG] Sincronización completada (${scopeLabel}). Vectores totales: ${tempVectorStorage.getRecordCount()}`);
    } else {
      console.log(`[RAG] Sincronización completada (${scopeLabel}). Sin cambios.`);
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
