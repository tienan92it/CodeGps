/**
 * Persistence helpers for L3 concepts.
 */
import type { Database as SqliteDb } from 'better-sqlite3';
import { createHash, randomUUID } from 'crypto';
import type { Concept } from '../types.js';
import { cosine, decodeVector, encodeVector } from './embeddings.js';

export function newConceptId(seed: string): string {
  return createHash('sha1').update(`concept|${seed}|${randomUUID()}`).digest('hex').slice(0, 16);
}

export function upsertConcept(db: SqliteDb, c: Concept): void {
  db.prepare(`
    INSERT INTO concepts (id, name, summary, domain, scope, grounding, member_count, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, summary=excluded.summary,
      domain=excluded.domain, scope=excluded.scope, grounding=excluded.grounding,
      member_count=excluded.member_count, embedding=excluded.embedding
  `).run(
    c.id, c.name, c.summary ?? null, c.domain ?? null,
    c.scope ?? null, c.grounding ?? null,
    c.memberCount, c.embedding ?? null,
  );
}

export function getConcept(db: SqliteDb, id: string): Concept | undefined {
  const row = db.prepare(`SELECT * FROM concepts WHERE id=?`).get(id) as any;
  if (!row) return undefined;
  return {
    id: row.id, name: row.name,
    summary: row.summary ?? undefined,
    domain: row.domain ?? undefined,
    scope: row.scope ?? undefined,
    grounding: row.grounding ?? undefined,
    memberCount: row.member_count,
    embedding: row.embedding ?? undefined,
  };
}

export function listConcepts(db: SqliteDb, domain?: string, limit = 50): Concept[] {
  const where = domain ? 'WHERE domain=?' : '';
  const rows = (domain
    ? db.prepare(`SELECT * FROM concepts ${where} ORDER BY member_count DESC LIMIT ?`).all(domain, limit)
    : db.prepare(`SELECT * FROM concepts ORDER BY member_count DESC LIMIT ?`).all(limit)
  ) as any[];
  return rows.map((r) => ({
    id: r.id, name: r.name,
    summary: r.summary ?? undefined,
    domain: r.domain ?? undefined,
    scope: r.scope ?? undefined,
    grounding: r.grounding ?? undefined,
    memberCount: r.member_count,
    embedding: r.embedding ?? undefined,
  }));
}

export function setKNodeCluster(db: SqliteDb, kNodeId: string, conceptId: string | null): void {
  db.prepare(`UPDATE k_nodes SET cluster_id=?, updated_at=? WHERE id=?`)
    .run(conceptId, Date.now(), kNodeId);
}

export function membersOf(db: SqliteDb, conceptId: string): Array<{ id: string; kind: string; title: string; summary?: string }> {
  return db.prepare(`
    SELECT id, kind, title, summary
    FROM k_nodes
    WHERE cluster_id=?
    ORDER BY updated_at DESC
  `).all(conceptId) as any[];
}

export function recountAndCentroid(
  db: SqliteDb, conceptId: string,
): { memberCount: number; centroid?: Float32Array } {
  const memberCount = (db.prepare(`SELECT COUNT(*) AS n FROM k_nodes WHERE cluster_id=?`).get(conceptId) as any).n as number;
  // Average all member embeddings to get a centroid.
  const rows = db.prepare(`
    SELECT e.embedding AS emb
    FROM k_nodes k
    JOIN k_node_embeddings e ON e.k_node_id = k.id
    WHERE k.cluster_id = ?
  `).all(conceptId) as Array<{ emb: Buffer }>;
  if (rows.length === 0) return { memberCount };
  let dim = 0;
  const sum: number[] = [];
  for (const r of rows) {
    const v = decodeVector(r.emb);
    if (!v) continue;
    if (dim === 0) { dim = v.length; for (let i = 0; i < dim; i++) sum.push(0); }
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  if (dim === 0) return { memberCount };
  for (let i = 0; i < dim; i++) sum[i] /= rows.length;
  return { memberCount, centroid: Float32Array.from(sum) };
}

export function nearestConcepts(
  db: SqliteDb, query: Float32Array, k = 5, minScore = 0.6,
): Array<{ id: string; name: string; summary?: string; score: number }> {
  const rows = db.prepare(`SELECT id, name, summary, embedding AS emb FROM concepts WHERE embedding IS NOT NULL`)
    .all() as Array<{ id: string; name: string; summary: string | null; emb: Buffer }>;
  const out: Array<{ id: string; name: string; summary?: string; score: number }> = [];
  for (const r of rows) {
    const v = decodeVector(r.emb);
    if (!v) continue;
    const s = cosine(query, v);
    if (s >= minScore) out.push({ id: r.id, name: r.name, summary: r.summary ?? undefined, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, k);
}

export function encodeCentroid(v: Float32Array): Buffer {
  return encodeVector(v);
}
