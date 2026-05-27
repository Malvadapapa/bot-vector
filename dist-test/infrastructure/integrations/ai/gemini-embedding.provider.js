"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiEmbeddingProvider = void 0;
const generative_ai_1 = require("@google/generative-ai");
class GeminiEmbeddingProvider {
    constructor(apiKey) {
        this.modelName = 'gemini-embedding-001';
        if (!apiKey)
            throw new Error('Se requiere GEMINI_API_KEY para generar embeddings.');
        this.genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    }
    async generateEmbedding(text) {
        const model = this.genAI.getGenerativeModel({ model: this.modelName });
        return this.withRetry(async () => {
            const result = await model.embedContent(text);
            return result.embedding.values;
        }, 3);
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
    async withRetry(fn, maxRetries, baseDelayMs = 1000) {
        let attempts = 0;
        while (true) {
            try {
                return await fn();
            }
            catch (error) {
                attempts++;
                const status = error?.status ?? error?.httpStatusCode ?? error?.code;
                const msg = String(error?.message || '').toLowerCase();
                const isRateLimit = status === 429 || msg.includes('rate limit') || msg.includes('quota') || msg.includes('503') || msg.includes('unavailable');
                if (!isRateLimit || attempts >= maxRetries) {
                    console.error(`[GeminiEmbeddingProvider] Error final tras ${attempts} intentos:`, error?.message || error);
                    throw error;
                }
                const delay = baseDelayMs * Math.pow(2, attempts - 1) + Math.random() * 500;
                console.warn(`[GeminiEmbeddingProvider] Retry ${attempts}/${maxRetries} tras ${(delay / 1000).toFixed(1)}s debido a límite de cuota.`);
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
}
exports.GeminiEmbeddingProvider = GeminiEmbeddingProvider;
