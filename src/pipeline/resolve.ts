/**
 * Code resolver: deterministic mention → L0 node bridging.
 *
 * Looks up paths and symbol names in code.db and writes k_to_code rows.
 * No NL judgement — purely lexical matching.
 */
import type { Database as SqliteDb } from 'better-sqlite3';
import type { KToCode } from '../types.js';

export interface ResolveOpts {
  knowledgeDb: SqliteDb;
  codeDb: SqliteDb;
}

/**
 * Try to resolve a path mention to a `file` node in code.db.
 *  - Exact match on `nodes.qualified_name` (file kind).
 *  - Suffix match: any file whose path ends with the mention.
 */
export function resolvePath(codeDb: SqliteDb, mention: string): { codeNodeId: string; codeFile: string } | undefined {
  const exact = codeDb
    .prepare(`SELECT id, file_path FROM nodes WHERE kind='file' AND qualified_name=? LIMIT 1`)
    .get(mention) as { id: string; file_path: string } | undefined;
  if (exact) return { codeNodeId: exact.id, codeFile: exact.file_path };
  const suffix = codeDb
    .prepare(`
      SELECT id, file_path FROM nodes
      WHERE kind='file' AND file_path LIKE '%' || ?
      LIMIT 2
    `)
    .all(mention) as Array<{ id: string; file_path: string }>;
  if (suffix.length === 1) return { codeNodeId: suffix[0].id, codeFile: suffix[0].file_path };
  return undefined;
}

/**
 * Resolve a symbol name (e.g. "UserService" or "loginUser") to up to 5
 * candidate nodes. Used by agent outputs that name a symbol explicitly.
 */
export function resolveSymbol(codeDb: SqliteDb, name: string): Array<{ id: string; file: string; kind: string }> {
  return codeDb
    .prepare(`
      SELECT id, file_path AS file, kind FROM nodes
      WHERE lower(name) = lower(?) AND kind NOT IN ('file','import')
      LIMIT 5
    `)
    .all(name) as Array<{ id: string; file: string; kind: string }>;
}

export function writeKToCode(knowDb: SqliteDb, link: KToCode): void {
  knowDb.prepare(`
    INSERT INTO k_to_code (k_node_id, code_node_id, code_file, weight)
    VALUES (?, ?, ?, ?)
  `).run(link.kNodeId, link.codeNodeId, link.codeFile ?? null, link.weight ?? 1);
}
