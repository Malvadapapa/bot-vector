import { GoogleGenerativeAI } from '@google/generative-ai';

export class EmbeddingGenerator {
  private genAI: GoogleGenerativeAI;
  private readonly modelName = 'gemini-embedding-001';

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('Se requiere GEMINI_API_KEY para generar embeddings.');
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });
    try {
      const result = await model.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      console.error(`[EmbeddingGenerator] Error generando embedding:`, error);
      throw error;
    }
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
}
