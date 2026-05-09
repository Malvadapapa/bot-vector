export interface EmbeddingProvider {
  /** Genera el embedding para un solo texto. */
  generateEmbedding(text: string): Promise<number[]>;
  /** Genera los embeddings para múltiples textos de forma eficiente/secuenciada. */
  generateBatchEmbeddings(texts: string[]): Promise<number[][]>;
}
