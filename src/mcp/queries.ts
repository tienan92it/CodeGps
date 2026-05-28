/**
 * Query helpers used by MCP tools. Keeps SQL out of the tool handlers.
 */
import type { Database as SqliteDb } from 'better-sqlite3';

// ============================================================================
// L0 — code
// ============================================================================

export function codeSearch(
  codeDb: SqliteDb, query: string, kind?: string, limit = 10,
): Array<{ id: string; name: string; kind: string; file: string; line: number }> {
  const kindFilter = kind ? `AND kind = ?` : '';
  const args: any[] = [`%${query}%`];
  if (kind) args.push(kind);
  args.push(limit);
  const rows = codeDb.prepare(`
    SELECT id, name, kind, file_path AS file, start_line AS line
    FROM nodes
    WHERE (name LIKE ? OR qualified_name LIKE ?)
      ${kindFilter}
    ORDER BY length(name) ASC
    LIMIT ?
  `).all(`%${query}%`, `%${query}%`, ...(kind ? [kind] : []), limit) as any[];
  return rows;
}

export function codeNode(codeDb: SqliteDb, name: string): any | undefined {
  return codeDb.prepare(`
    SELECT id, name, qualified_name AS qname, kind, file_path AS file,
           start_line AS line, signature, docstring
    FROM nodes
    WHERE name = ?
    ORDER BY kind
    LIMIT 1
  `).get(name);
}

// ============================================================================
// L1.5 / L2 — knowledge
// ============================================================================

export interface FactRow {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  confidence: number;
  source: string;
  windowId?: string;
}

export function recallByQuery(
  knowDb: SqliteDb, query: string, limit = 20,
  kinds?: string[],
): FactRow[] {
  const kindClause = kinds && kinds.length
    ? `AND k.kind IN (${kinds.map(() => '?').join(',')})`
    : '';
  const ftsClause = query.trim()
    ? `AND k.id IN (SELECT k_nodes_fts.id FROM k_nodes_fts WHERE k_nodes_fts MATCH ?)`
    : '';
  // Bind order must match SQL: kinds clause precedes fts clause below.
  const args: any[] = [];
  if (kinds && kinds.length) args.push(...kinds);
  if (ftsClause) args.push(escapeFtsQuery(query));
  args.push(limit);

  return knowDb.prepare(`
    SELECT k.id, k.kind, k.title, k.summary, k.confidence, k.source,
           (SELECT window_id FROM k_provenance WHERE k_node_id = k.id LIMIT 1) AS windowId
    FROM k_nodes k
    WHERE 1=1 ${kindClause} ${ftsClause}
    ORDER BY k.confidence DESC, k.updated_at DESC
    LIMIT ?
  `).all(...args) as FactRow[];
}

export function decisionsForTopic(
  knowDb: SqliteDb, topic: string, limit = 20,
): FactRow[] {
  return recallByQuery(knowDb, topic, limit, ['decision', 'constraint', 'pattern']);
}

export function businessLogicForTopic(
  knowDb: SqliteDb, topic: string, limit = 20,
): FactRow[] {
  return recallByQuery(knowDb, topic, limit, ['business_rule', 'entity', 'constraint', 'pattern']);
}

/** Facts that link to a given file path via k_to_code. */
export function factsForFile(
  knowDb: SqliteDb, file: string, limit = 20,
): FactRow[] {
  return knowDb.prepare(`
    SELECT DISTINCT k.id, k.kind, k.title, k.summary, k.confidence, k.source,
           (SELECT window_id FROM k_provenance WHERE k_node_id = k.id LIMIT 1) AS windowId
    FROM k_nodes k
    JOIN k_to_code kc ON kc.k_node_id = k.id
    WHERE kc.code_file = ?
    ORDER BY k.confidence DESC
    LIMIT ?
  `).all(file, limit) as FactRow[];
}

export function triageAuditRows(
  knowDb: SqliteDb, opts: { droppedOnly?: boolean; limit?: number } = {},
): Array<{
  windowId: string; domain: string; quality: string; relevance: string;
  linkage: string; confidence: number; kept: boolean; rationale: string;
}> {
  const limit = opts.limit ?? 50;
  const filter = opts.droppedOnly ? 'WHERE kept=0' : '';
  const rows = knowDb.prepare(`
    SELECT window_id AS windowId, domain, quality, relevance, linkage,
           confidence, kept, rationale
    FROM triage_labels
    ${filter}
    ORDER BY produced_at DESC
    LIMIT ?
  `).all(limit) as any[];
  return rows.map((r) => ({ ...r, kept: !!r.kept }));
}

// ============================================================================
// helpers
// ============================================================================

function escapeFtsQuery(q: string): string {
  // FTS5 syntax-safe: escape quotes, wrap each term in quotes, AND-join.
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' AND ');
}
