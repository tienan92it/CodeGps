/**
 * Write extraction results to code.db. Uses a single transaction per file.
 */
import type { Database as SqliteDb } from 'better-sqlite3';
import type { CodeNode, CodeEdge, IndexedFile } from '../types.js';
import type { ExtractionResult } from './extractor.js';

export interface ResolveCandidate {
  fromNodeId: string;
  referenceName: string;
  line: number;
  col: number;
  filePath: string;
  language: string;
}

export function upsertFile(db: SqliteDb, f: IndexedFile): void {
  db.prepare(`
    INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, errors)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      content_hash = excluded.content_hash,
      language     = excluded.language,
      size         = excluded.size,
      modified_at  = excluded.modified_at,
      indexed_at   = excluded.indexed_at,
      node_count   = excluded.node_count,
      errors       = excluded.errors
  `).run(
    f.path, f.contentHash, f.language, f.size,
    f.modifiedAt, f.indexedAt, f.nodeCount,
    f.errors ? JSON.stringify(f.errors) : null,
  );
}

export function getFileHash(db: SqliteDb, path: string): string | undefined {
  const row = db.prepare(`SELECT content_hash AS h FROM files WHERE path=?`).get(path) as
    | { h: string } | undefined;
  return row?.h;
}

export function deleteFileSymbols(db: SqliteDb, path: string): void {
  // ON DELETE CASCADE on edges takes care of edge cleanup.
  db.prepare(`DELETE FROM nodes WHERE file_path=?`).run(path);
  db.prepare(`DELETE FROM unresolved_refs WHERE file_path=?`).run(path);
}

export function insertNode(db: SqliteDb, n: CodeNode): void {
  db.prepare(`
    INSERT INTO nodes
      (id, kind, name, qualified_name, file_path, language,
       start_line, end_line, start_column, end_column,
       docstring, signature, visibility,
       is_exported, is_async, is_static, is_abstract,
       decorators, type_parameters, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      kind=excluded.kind, name=excluded.name,
      qualified_name=excluded.qualified_name, file_path=excluded.file_path,
      language=excluded.language,
      start_line=excluded.start_line, end_line=excluded.end_line,
      start_column=excluded.start_column, end_column=excluded.end_column,
      docstring=excluded.docstring, signature=excluded.signature,
      visibility=excluded.visibility,
      is_exported=excluded.is_exported, is_async=excluded.is_async,
      is_static=excluded.is_static, is_abstract=excluded.is_abstract,
      decorators=excluded.decorators, type_parameters=excluded.type_parameters,
      updated_at=excluded.updated_at
  `).run(
    n.id, n.kind, n.name, n.qualifiedName, n.filePath, n.language,
    n.startLine, n.endLine, n.startColumn, n.endColumn,
    n.docstring ?? null, n.signature ?? null, n.visibility ?? null,
    n.isExported ? 1 : 0, n.isAsync ? 1 : 0, n.isStatic ? 1 : 0, n.isAbstract ? 1 : 0,
    n.decorators ? JSON.stringify(n.decorators) : null,
    n.typeParameters ? JSON.stringify(n.typeParameters) : null,
    n.updatedAt,
  );
}

export function insertEdge(db: SqliteDb, e: CodeEdge): void {
  db.prepare(`
    INSERT INTO edges (source, target, kind, metadata, line, col, provenance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    e.source, e.target, e.kind,
    e.metadata ? JSON.stringify(e.metadata) : null,
    e.line ?? null, e.col ?? null, e.provenance ?? null,
  );
}

export function insertUnresolved(db: SqliteDb, c: ResolveCandidate): void {
  db.prepare(`
    INSERT INTO unresolved_refs
      (from_node_id, reference_name, reference_kind, line, col, candidates, file_path, language)
    VALUES (?, ?, 'call', ?, ?, NULL, ?, ?)
  `).run(c.fromNodeId, c.referenceName, c.line, c.col, c.filePath, c.language);
}

export function writeExtraction(
  db: SqliteDb, file: IndexedFile, ext: ExtractionResult,
): void {
  const tx = db.transaction(() => {
    deleteFileSymbols(db, file.path);
    upsertFile(db, file);
    for (const n of ext.nodes) insertNode(db, n);
    for (const e of ext.edges) insertEdge(db, e);
    for (const c of ext.unresolvedCalls) {
      insertUnresolved(db, {
        fromNodeId: c.fromId,
        referenceName: c.name,
        line: c.line,
        col: c.col,
        filePath: file.path,
        language: file.language,
      });
    }
  });
  tx();
}

/**
 * After full sync, attempt to resolve unresolved call references by matching
 * `reference_name` against `nodes.name`. Ambiguous names get all candidates
 * stored; deterministic name → unique node becomes an edge.
 */
export function resolveCalls(db: SqliteDb): number {
  const unresolved = db.prepare(`
    SELECT id, from_node_id, reference_name, line, col
    FROM unresolved_refs
    WHERE reference_kind='call'
  `).all() as Array<{
    id: number; from_node_id: string; reference_name: string; line: number; col: number;
  }>;

  const lookup = db.prepare(`
    SELECT id, file_path FROM nodes
    WHERE name=? AND kind IN ('function','method')
    LIMIT 5
  `);

  const insertResolved = db.prepare(`
    INSERT INTO edges (source, target, kind, line, col, provenance)
    VALUES (?, ?, 'calls', ?, ?, 'name_match')
  `);
  const setCandidates = db.prepare(`UPDATE unresolved_refs SET candidates=? WHERE id=?`);
  const dropResolved = db.prepare(`DELETE FROM unresolved_refs WHERE id=?`);

  let resolved = 0;
  const tx = db.transaction(() => {
    for (const u of unresolved) {
      const cands = lookup.all(u.reference_name) as Array<{ id: string; file_path: string }>;
      if (cands.length === 1) {
        insertResolved.run(u.from_node_id, cands[0].id, u.line, u.col);
        dropResolved.run(u.id);
        resolved++;
      } else if (cands.length > 1) {
        setCandidates.run(JSON.stringify(cands.map((c) => c.id)), u.id);
      }
    }
  });
  tx();
  return resolved;
}
