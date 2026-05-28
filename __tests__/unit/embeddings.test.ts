import { describe, it, expect } from 'vitest';
import { encodeVector, decodeVector, cosine, topK } from '../../src/knowledge/embeddings';

describe('embedding helpers', () => {
  it('encodes and decodes a vector', () => {
    const v = [1, 2, 3, 4.5];
    const enc = encodeVector(v);
    const dec = decodeVector(enc);
    expect(Array.from(dec!)).toEqual([1, 2, 3, 4.5]);
  });

  it('cosine = 1 for identical', () => {
    const v = Float32Array.from([1, 2, 3]);
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it('cosine = 0 for orthogonal', () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0, 5);
  });

  it('topK returns highest-scoring entries first', () => {
    const q = Float32Array.from([1, 0]);
    const items = [
      { id: 'a', embedding: Float32Array.from([0.9, 0.1]) },
      { id: 'b', embedding: Float32Array.from([0, 1]) },
      { id: 'c', embedding: Float32Array.from([0.95, 0.05]) },
    ];
    const hits = topK(q, items, 2);
    expect(hits.map((h) => h.id)).toEqual(['c', 'a']);
  });
});
