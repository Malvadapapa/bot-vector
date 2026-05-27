"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RagQueryService = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const vector_storage_js_1 = require("./vector-storage.js");
class RagQueryService {
    constructor(storageFilePath, embeddingProvider, minScore = 0.35) {
        this.storageFilePath = storageFilePath;
        this.embeddingProvider = embeddingProvider;
        this.minScore = minScore;
        this.loaded = false;
        this.lastModifiedMs = 0;
        this.vectorStorage = new vector_storage_js_1.VectorStorage(storageFilePath);
    }
    async search(query, topK = 3) {
        try {
            await this.ensureLoaded();
            if (this.vectorStorage.getRecordCount() === 0) {
                return [];
            }
            const queryVector = await this.embeddingProvider.generateEmbedding(query);
            const raw = await this.vectorStorage.searchSimilar(queryVector, topK);
            // Separar los que pasan el umbral de los que no
            const strongMatches = raw.filter((r) => r.score >= this.minScore);
            let finalResults = [];
            if (strongMatches.length > 0) {
                finalResults = strongMatches.map(r => ({ ...r, weak: false }));
            }
            else {
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
                console.log(`[RAG] Búsqueda exitosa: ${filtered.length} chunks (scores: ${filtered.map((r) => r.score.toFixed(3)).join(', ')}${filtered[0].weak ? ' - DÉBIL' : ''})`);
            }
            return filtered;
        }
        catch (error) {
            // Fallo silencioso: el bot sigue funcionando con el contexto interno disponible
            console.error(`[RAG] Error en búsqueda (se continúa sin contexto RAG):`, error?.message || error);
            return [];
        }
    }
    /**
     * Formatea los resultados de búsqueda RAG como texto para inyectar en el prompt.
     * Retorna null si no hay resultados relevantes.
     */
    formatContext(results) {
        if (results.length === 0)
            return null;
        const fragments = results.map((r, i) => {
            const pageText = r.pageNumber ? ` (Página ${r.pageNumber})` : '';
            return `[Fragmento ${i + 1} — ${r.sourceFile}${pageText}]:\n${r.text}`;
        });
        return [
            '📚 Información institucional relevante (del reglamento/documentación):',
            ...fragments,
        ].join('\n\n');
    }
    /** Indica si el servicio tiene vectores cargados y disponibles. */
    isAvailable() {
        return this.loaded && this.vectorStorage.getRecordCount() > 0;
    }
    /** Cantidad de vectores cargados. */
    getVectorCount() {
        return this.vectorStorage.getRecordCount();
    }
    /**
     * Carga lazy del vector store. Recarga automáticamente si el archivo
     * fue modificado en disco (por ejemplo, después de un rag:index).
     */
    async ensureLoaded() {
        try {
            const stat = await promises_1.default.stat(this.storageFilePath);
            const currentMtime = Math.round(stat.mtimeMs);
            if (!this.loaded || currentMtime !== this.lastModifiedMs) {
                await this.vectorStorage.load();
                this.lastModifiedMs = currentMtime;
                this.loaded = true;
                if (this.vectorStorage.getRecordCount() > 0) {
                    console.log(`[RAG] Vector store cargado: ${this.vectorStorage.getRecordCount()} vectores.`);
                }
                else {
                    console.log(`[RAG] Vector store vacío. Ejecutá "npm run rag:index" para indexar los PDFs.`);
                }
            }
        }
        catch (error) {
            if (error?.code === 'ENOENT') {
                this.loaded = true; // Marcamos como cargado pero vacío
                return;
            }
            throw error;
        }
    }
}
exports.RagQueryService = RagQueryService;
