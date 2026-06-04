export interface RagChunkMetadata {
  id: string; // Hash of the text chunk or unique identifier
  sourceFile: string;
  sourceHash: string;
  index: number;
  totalChunks: number;
  pageNumber?: number; // Optional page number reference
  indexedAt: Date;
  scope?: 'general' | 'group';
  groupId?: string;
}

export interface RagChunk {
  text: string;
  metadata: RagChunkMetadata;
}

export interface VectorRecord {
  id: string;
  text: string;
  vector: number[];
  metadata: RagChunkMetadata;
}

export interface SyncStateDict {
  [filename: string]: string; // filename -> fileHash
}
