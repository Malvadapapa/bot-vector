"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RagPipelineService = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
require("dotenv/config");
const sync_state_js_1 = require("./sync-state.js");
const pdf_extractor_js_1 = require("./pdf-extractor.js");
const semantic_chunker_js_1 = require("./semantic-chunker.js");
const vector_storage_js_1 = require("./vector-storage.js");
class RagPipelineService {
    constructor(knowledgeDir, stateFilePath, storageFilePath, embeddingProvider) {
        this.knowledgeDir = knowledgeDir;
        this.stateFilePath = stateFilePath;
        this.storageFilePath = storageFilePath;
        this.embeddingProvider = embeddingProvider;
        // Guardamos los que fallaron en memoria para el reporte
        this.failedFiles = [];
        this.syncState = new sync_state_js_1.SyncState(stateFilePath);
        this.pdfExtractor = new pdf_extractor_js_1.PDFExtractor();
        this.chunker = new semantic_chunker_js_1.SemanticChunker();
        this.vectorStorage = new vector_storage_js_1.VectorStorage(storageFilePath);
    }
    async runSync(forceAll = false) {
        console.log(`[RAG] Iniciando sincronización de base de conocimiento...`);
        await this.vectorStorage.load();
        const state = await this.syncState.loadState();
        this.failedFiles = [];
        // Ensure dir exists
        await promises_1.default.mkdir(this.knowledgeDir, { recursive: true });
        const files = await promises_1.default.readdir(this.knowledgeDir);
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
            const filePath = node_path_1.default.join(this.knowledgeDir, file);
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
                    const records = chunks.map((chunk, i) => ({
                        id: chunk.metadata.id,
                        text: chunk.text,
                        vector: vectors[i],
                        metadata: chunk.metadata
                    }));
                    this.vectorStorage.addRecords(records);
                    state[file] = currentHash;
                    processedCount++;
                    console.log(`[RAG] -> ${file} indexado correctamente.`);
                }
                catch (error) {
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
        }
        else {
            console.log(`[RAG] Sincronización completa. No se detectaron cambios.`);
        }
        if (this.failedFiles.length > 0) {
            console.warn(`[RAG] Advertencia: ${this.failedFiles.length} archivos fallaron al indexar: ${this.failedFiles.join(', ')}`);
        }
    }
    async getStatus() {
        await this.vectorStorage.load();
        const state = await this.syncState.loadState();
        return {
            files: Object.keys(state).length,
            totalVectors: this.vectorStorage.getRecordCount(),
            failed: this.failedFiles.length
        };
    }
    // Método de utilidad para el futuro, para probar la búsqueda
    async testSearch(query) {
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
exports.RagPipelineService = RagPipelineService;
