import { GoogleGenerativeAI } from '@google/generative-ai';
import { EmbeddingProvider } from './embedding-provider.interface.js';

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private genAI: GoogleGenerativeAI;
  private readonly modelName = 'gemini-embedding-001';

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('Se requiere GEMINI_API_KEY para generar embeddings.');
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });
    return this.withRetry(async () => {
      const result = await model.embedContent(text);
      return result.embedding.values;
    }, 3);
  }

  public async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.generateEmbedding(text));
      // Pequeña pausa entre requests para evitar rate-limits en el tier gratuito
      if (results.length < texts.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return results;
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries: number, baseDelayMs = 1000): Promise<T> {
    let attempts = 0;
    while (true) {
      try {
        return await fn();
      } catch (error: any) {
        attempts++;
        const status = error?.status ?? error?.httpStatusCode ?? error?.code;
        const msg = String(error?.message || '').toLowerCase();
        const isRateLimit = status === 429 || msg.includes('rate limit') || msg.includes('quota') || msg.includes('503') || msg.includes('unavailable');

        if (!isRateLimit || attempts >= maxRetries) {
          console.error(`[GeminiEmbeddingProvider] Error final tras ${attempts} intentos:`, error?.message || error);
          throw error;
        }

        const delay = baseDelayMs * Math.pow(2, attempts - 1) + Math.random() * 500;
        console.warn(`[GeminiEmbeddingProvider] Retry ${attempts}/${maxRetries} tras ${(delay/1000).toFixed(1)}s debido a límite de cuota.`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}
