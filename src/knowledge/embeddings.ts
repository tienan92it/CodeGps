/**
 * Embedding helpers: encode/decode Float32 vectors to/from SQLite BLOB,
 * cosine similarity, and brute-force nearest-neighbour over a candidate set.
 *
 * Storage: little-endian Float32 packed contiguously. Header byte 0xE1 + 1 byte
 * version so we can recognize and migrate if we ever change the layout.
 */

const MAGIC = 0xe1;
const VERSION = 1;

export function encodeVector(v: number[] | Float32Array): Buffer {
  const arr = v instanceof Float32Array ? v : Float32Array.from(v);
  const buf = Buffer.alloc(2 + arr.byteLength);
  buf[0] = MAGIC;
  buf[1] = VERSION;
  Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(buf, 2);
  return buf;
}

export function decodeVector(b: Buffer | null | undefined): Float32Array | undefined {
  if (!b || b.length < 2) return undefined;
  if (b[0] !== MAGIC || b[1] !== VERSION) return undefined;
  const view = b.subarray(2);
  const arr = new Float32Array(view.byteLength / 4);
  // Copy to avoid Buffer aliasing surprises.
  Buffer.from(arr.buffer).set(view);
  return arr;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface NearestHit {
  id: string;
  score: number;
}

export function topK<T extends { id: string; embedding: Float32Array }>(
  query: Float32Array, items: T[], k: number, minScore = 0,
): NearestHit[] {
  const scored: NearestHit[] = [];
  for (const it of items) {
    const s = cosine(query, it.embedding);
    if (s >= minScore) scored.push({ id: it.id, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
