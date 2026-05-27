"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddingGenerator = void 0;
const generative_ai_1 = require("@google/generative-ai");
class EmbeddingGenerator {
    constructor(apiKey) {
        this.modelName = 'gemini-embedding-001';
        if (!apiKey)
            throw new Error('Se requiere GEMINI_API_KEY para generar embeddings.');
        this.genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    }
    async generateEmbedding(text) {
        const model = this.genAI.getGenerativeModel({ model: this.modelName });
        try {
            const result = await model.embedContent(text);
            return result.embedding.values;
        }
        catch (error) {
            console.error(`[EmbeddingGenerator] Error generando embedding:`, error);
            throw error;
        }
    }
    async generateBatchEmbeddings(texts) {
        const results = [];
        for (const text of texts) {
            results.push(await this.generateEmbedding(text));
            // Pequeña pausa entre requests para evitar rate-limits en el tier gratuito
            if (results.length < texts.length) {
                await new Promise((r) => setTimeout(r, 200));
            }
        }
        return results;
    }
}
exports.EmbeddingGenerator = EmbeddingGenerator;
