import type { EmbeddingProvider } from './types.js';

export function validateVector(value: unknown): asserts value is number[] {
  if (!Array.isArray(value) || !value.length || value.some(x => typeof x !== 'number' || !Number.isFinite(x)) || !value.some(x => x !== 0)) {
    throw new Error('Embedding provider returned an invalid or zero vector');
  }
}

export function providerFromEnv(): EmbeddingProvider {
  const provider = process.env.PENSIEVE_PROVIDER ?? 'ollama';
  if (!['ollama', 'openai'].includes(provider)) throw new Error('PENSIEVE_PROVIDER must be ollama or openai');
  const cloud = provider === 'openai';
  const model = process.env.PENSIEVE_MODEL ?? (cloud ? 'text-embedding-3-small' : 'embeddinggemma');
  const gemma = !cloud && model.split(':')[0] === 'embeddinggemma';
  const base = cloud ? 'https://api.openai.com' : (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434');
  const url = new URL(cloud ? '/v1/embeddings' : '/api/embed', base);
  if (!cloud && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Local embeddings require a loopback OLLAMA_HOST');
  }
  return {
    identity: `${provider}:${model}${gemma ? ':retrieval-v1' : ''}`,
    async embed(texts, purpose = 'document') {
      if (cloud && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the opt-in cloud provider');
      const response = await fetch(url, {
        method: 'POST', signal: AbortSignal.timeout(120_000),
        headers: { 'Content-Type': 'application/json', ...(cloud ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {}) },
        // https://huggingface.co/google/embeddinggemma-300m/blob/main/README.md
        body: JSON.stringify({ model, input: gemma ? texts.map(text =>
          purpose === 'query' ? `task: search result | query: ${text}` : `title: none | text: ${text}`) : texts,
          ...(cloud ? {} : { truncate: false }) }),
      });
      if (!response.ok) throw new Error(`Embedding request failed (${response.status}). Check the provider and model installation.`);
      const body = await response.json() as { embeddings?: unknown[]; data?: { index: number; embedding: unknown }[] };
      const vectors = cloud ? body.data?.sort((a, b) => a.index - b.index).map(x => x.embedding) : body.embeddings;
      if (!vectors || vectors.length !== texts.length) throw new Error('Embedding response count mismatch');
      vectors.forEach(validateVector);
      return vectors as number[][];
    },
  };
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Embedding dimension mismatch; use the original embedding model');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return dot / Math.sqrt(aa * bb);
}
