import crypto from 'node:crypto';
import { RagChunk, RagChunkMetadata } from './models.js';

export interface ChunkerConfig {
  targetChunkSize: number; // in characters
  overlapSize: number; // in characters
}

export class SemanticChunker {
  constructor(
    private config: ChunkerConfig = { targetChunkSize: 2000, overlapSize: 300 } // approx 500-700 tokens
  ) {}

  public chunkText(pages: Array<{ pageNumber: number, text: string }>, sourceFile: string, sourceHash: string): RagChunk[] {
    const chunks: Array<{ text: string, pageNumber: number }> = [];
    
    for (const page of pages) {
      // 1. Limpiar espacios excesivos pero mantener estructura de párrafos
      const cleanText = page.text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
      
      // 2. Dividir inicialmente por párrafos (doble salto de línea)
      const paragraphs = cleanText.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
      
      let currentChunk = '';
      
      for (const paragraph of paragraphs) {
        // Si el párrafo en sí mismo es más grande que el target, hay que dividirlo por oraciones
        if (paragraph.length > this.config.targetChunkSize) {
          const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
          for (const sentence of sentences) {
            if ((currentChunk.length + sentence.length) > this.config.targetChunkSize && currentChunk.length > 0) {
              chunks.push({ text: currentChunk.trim(), pageNumber: page.pageNumber });
              // Iniciar nuevo chunk con el overlap (tomando el final del chunk anterior)
              currentChunk = this.getOverlapText(currentChunk) + sentence;
            } else {
              currentChunk += (currentChunk.length > 0 ? ' ' : '') + sentence.trim();
            }
          }
        } else {
          // Párrafo normal
          if ((currentChunk.length + paragraph.length) > this.config.targetChunkSize && currentChunk.length > 0) {
            chunks.push({ text: currentChunk.trim(), pageNumber: page.pageNumber });
            currentChunk = this.getOverlapText(currentChunk) + paragraph;
          } else {
            currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + paragraph.trim();
          }
        }
      }
      
      if (currentChunk.trim().length > 0) {
        chunks.push({ text: currentChunk.trim(), pageNumber: page.pageNumber });
      }
    }

    // 3. Crear objetos RagChunk con metadata
    const now = new Date();
    return chunks.map((chunk, index) => {
      const id = crypto.createHash('sha256').update(`${sourceHash}-${index}`).digest('hex');
      return {
        text: chunk.text,
        metadata: {
          id,
          sourceFile,
          sourceHash,
          index,
          totalChunks: chunks.length,
          pageNumber: chunk.pageNumber,
          indexedAt: now,
        }
      };
    });
  }

  private getOverlapText(text: string): string {
    if (text.length <= this.config.overlapSize) return text;
    // Intentar cortar en la última oración completa dentro del tamaño de overlap
    const tail = text.slice(-this.config.overlapSize);
    const firstSentenceEnd = tail.search(/[.!?]\s/);
    if (firstSentenceEnd !== -1 && firstSentenceEnd < tail.length - 10) {
      return tail.slice(firstSentenceEnd + 2).trim() + ' ';
    }
    // Fallback: corte duro por espacio
    const firstSpace = tail.indexOf(' ');
    return firstSpace !== -1 ? tail.slice(firstSpace + 1).trim() + ' ' : tail + ' ';
  }
}
