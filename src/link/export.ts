/**
 * Export the project's L3 concepts (and their L0 evidence) into the global DB,
 * keyed by (project_id, local_concept_id). Idempotent: running again refreshes
 * names/summaries/embeddings.
 */
import type { Database as SqliteDb } from 'better-sqlite3';
import { createHash } from 'crypto';
import { openCodeDb, openKnowledgeDb, openGlobalDb } from '../db/connection.js';
import { registerProject } from '../global/registry.js';

export interface ExportStats {
  projectId: string;
  conceptsExported: number;
  conceptsWithEmbedding: number;
}

export function globalConceptId(projectId: string, localConceptId: string): string {
  return createHash('sha1').update(`${projectId}|${localConceptId}`).digest('hex').slice(0, 16);
}

export async function exportProjectConcepts(root: string): Promise<ExportStats> {
  const know = openKnowledgeDb(root);
  // open code DB just to ensure it exists for downstream queries
  openCodeDb(root).close();
  const gdb = openGlobalDb();
  try {
    const projectId = registerProject(gdb, root);
    const now = Date.now();
    const rows = know.prepare(`
      SELECT id, name, summary, domain, scope, embedding
      FROM concepts
    `).all() as Array<{ id: string; name: string; summary: string | null; domain: string | null; scope: string | null; embedding: Buffer | null }>;

    let withEmb = 0;
    const insert = gdb.prepare(`
      INSERT INTO concepts_global (id, project_id, local_concept_id, name, summary, domain, scope, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, summary=excluded.summary, domain=excluded.domain,
        scope=excluded.scope, embedding=excluded.embedding, updated_at=excluded.updated_at
    `);
    const tx = gdb.transaction(() => {
      for (const r of rows) {
        const gid = globalConceptId(projectId, r.id);
        insert.run(
          gid, projectId, r.id, r.name,
          r.summary ?? null, r.domain ?? null, r.scope ?? null,
          r.embedding ?? null, now,
        );
        if (r.embedding) withEmb++;
      }
    });
    tx();

    return { projectId, conceptsExported: rows.length, conceptsWithEmbedding: withEmb };
  } finally {
    know.close();
    gdb.close();
  }
}
