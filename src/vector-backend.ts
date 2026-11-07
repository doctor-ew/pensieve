/** Vector persistence/query only. Authorization and content remain in TeamStore. */
export interface VectorBackend {
  readonly identity: string;
  upsert(poolId: string, model: string, records: {id: string; vector: number[]}[]): Promise<void>;
  query(poolId: string, model: string, vector: number[], limit: number): Promise<{id: string; score: number}[]>;
}
