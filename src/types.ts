export interface Memory {
  id: string;
  text: string;
  source: 'codex' | 'claude' | 'manual';
  session: string;
  role: 'user' | 'assistant';
  timestamp: string;
  locator: string;
  project: string;
  kind?: 'raw' | 'distilled';
  citations?: string[];
  synthetic?: boolean;
  ticket?: string;
}
export interface EmbeddingProvider {
  identity: string;
  embed(texts: string[], purpose?: 'document' | 'query'): Promise<number[][]>;
}
export interface Bundle {
  format: 'pensieve/v1';
  createdAt: string;
  memories: Memory[];
  provenance?: MemoryProvenance[];
}
export type Hit = Memory & { score: number };

export interface MemoryProvenance {
  memoryId: string; contributorId: string; contributorName: string; poolId: string;
  createdAt: string; sourceServer: string; verification: 'source-server' | 'unverified-import';
}
