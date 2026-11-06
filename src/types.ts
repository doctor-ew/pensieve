export interface Memory {
  id: string;
  text: string;
  source: 'codex' | 'claude' | 'manual';
  session: string;
  role: 'user' | 'assistant';
  timestamp: string;
  locator: string;
  project: string;
}
export interface EmbeddingProvider {
  identity: string;
  embed(texts: string[], purpose?: 'document' | 'query'): Promise<number[][]>;
}
export interface Bundle {
  format: 'pensieve/v1';
  createdAt: string;
  memories: Memory[];
}
export type Hit = Memory & { score: number };
