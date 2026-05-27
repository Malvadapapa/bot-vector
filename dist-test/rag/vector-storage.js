"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VectorStorage = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
class VectorStorage {
    constructor(storageFilePath) {
        this.storageFilePath = storageFilePath;
        this.records = [];
    }
    async load() {
        try {
            const data = await promises_1.default.readFile(this.storageFilePath, 'utf8');
            const parsed = JSON.parse(data);
            if (!Array.isArray(parsed)) {
                throw new Error('El archivo del vector store no contiene un array válido.');
            }
            this.records = parsed;
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
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                this.records = [];
            }
            else {
                console.error(`[VectorStorage] Error al cargar o validar el store:`, error);
                throw error;
            }
        }
    }
    async save() {
        const dir = node_path_1.default.dirname(this.storageFilePath);
        await promises_1.default.mkdir(dir, { recursive: true });
        await promises_1.default.writeFile(this.storageFilePath, JSON.stringify(this.records, null, 2), 'utf8');
    }
    removeBySourceFile(sourceFile) {
        this.records = this.records.filter((r) => r.metadata.sourceFile !== sourceFile);
    }
    addRecords(records) {
        this.records.push(...records);
    }
    getRecordCount() {
        return this.records.length;
    }
    async searchSimilar(queryVector, topK = 3) {
        if (this.records.length === 0)
            return [];
        const results = this.records.map((record) => ({
            record,
            score: this.cosineSimilarity(queryVector, record.vector),
        }));
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }
    cosineSimilarity(vecA, vecB) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0)
            return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}
exports.VectorStorage = VectorStorage;
