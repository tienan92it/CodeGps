/**
 * SQL DDL extractor (no tree-sitter; DDL syntax is regular enough).
 *
 * Captures:
 *   - CREATE [OR REPLACE] TABLE [schema.]name (cols ...)            -> table + field columns
 *   - CREATE [OR REPLACE] VIEW  [schema.]name AS ...                -> table (modeled as table)
 *   - CREATE [UNIQUE] INDEX [name] ON table (cols)                  -> pattern
 *   - CREATE [OR REPLACE] FUNCTION name(args) ...                   -> function
 *   - CREATE [OR REPLACE] PROCEDURE name(args) ...                  -> function
 *   - CREATE TRIGGER name ...                                       -> function
 *   - CREATE SCHEMA name                                            -> namespace
 *   - CREATE TYPE name AS ...                                       -> type_alias
 *   - CREATE SEQUENCE name                                          -> variable
 *   - ALTER TABLE name ADD COLUMN col type                          -> field on the existing table
 *
 * Foreign keys (REFERENCES other_table[(col)]) become `references` edges
 * from the field/table to the referenced table. Resolution against other
 * files happens later via the post-sync name resolver.
 */
import { createHash } from 'crypto';
import type { CodeNode, CodeEdge, NodeKind } from '../types.js';
import type { ExtractCtx, ExtractionResult } from './extractor.js';

export function extractSql(source: string, ctx: ExtractCtx): ExtractionResult {
  const result: ExtractionResult = { nodes: [], edges: [], unresolvedCalls: [] };
  const fileId = id(ctx.filePath, 'file', ctx.filePath);
  result.nodes.push(fileNode(fileId, ctx, source));

  const stripped = stripCommentsAndStrings(source);
  const statements = splitStatements(stripped, source);

  for (const stmt of statements) {
    parseStatement(stmt, fileId, ctx, result);
  }

  // Two-pass cleanup: any edge whose target is a non-emitted table id (FK to a
  // table defined in another file, or not yet defined) gets a stub target node
  // so SQLite's FK on edges.target stays satisfied. Stubs are marked via the
  // `provenance` column so the post-sync resolver can later merge them with
  // the real definition.
  const knownIds = new Set(result.nodes.map((n) => n.id));
  for (const edge of result.edges) {
    if (knownIds.has(edge.target)) continue;
    const meta = edge.metadata as { target_table?: string } | undefined;
    const tableName = meta?.target_table ?? `__unresolved_${edge.target.slice(0, 8)}`;
    const qualified = `${ctx.filePath}::${tableName}`;
    const stubId = id(ctx.filePath, 'table', qualified);
    if (stubId !== edge.target) {
      // Shouldn't happen — id() is deterministic — but guard anyway.
      edge.target = stubId;
    }
    if (knownIds.has(stubId)) continue;
    result.nodes.push({
      id: stubId, kind: 'table', name: tableName,
      qualifiedName: qualified,
      filePath: ctx.filePath, language: ctx.language,
      startLine: 0, endLine: 0, startColumn: 0, endColumn: 0,
      signature: `(stub) external table referenced by FK`,
      updatedAt: ctx.now,
    });
    knownIds.add(stubId);
  }
  return result;
}

// ============================================================================
// Statement parsers
// ============================================================================

interface Stmt {
  text: string;          // comment/string-stripped, for matching
  raw: string;           // original
  startLine: number;
}

function parseStatement(stmt: Stmt, fileId: string, ctx: ExtractCtx, result: ExtractionResult): void {
  const t = stmt.text.trimStart();

  // CREATE TABLE — match the header, then walk paren-balanced body.
  let m = /^CREATE\s+(?:GLOBAL\s+|LOCAL\s+|TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."`]+)\s*\(/i.exec(t);
  if (m) {
    const bodyStart = m.index + m[0].length;
    const body = extractBalancedParenBody(t, bodyStart - 1);
    if (body !== undefined) { emitTable(m[1], body, stmt, fileId, ctx, result); return; }
  }

  // CREATE VIEW
  m = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."`]+)/i.exec(t);
  if (m) { emitSimple(m[1], 'table', 'view', stmt, fileId, ctx, result); return; }

  // CREATE INDEX
  m = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."`]*)\s*ON\s+([\w."`]+)\s*(?:USING\s+\w+\s*)?\(([^)]*)\)/i.exec(t);
  if (m) { emitIndex(m[1] || `idx_${m[2]}_${stmt.startLine}`, m[2], m[3], stmt, fileId, ctx, result); return; }

  // CREATE FUNCTION / PROCEDURE
  m = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([\w."`]+)\s*\(([^)]*)\)/i.exec(t);
  if (m) { emitSimple(m[1], 'function', 'function', stmt, fileId, ctx, result, m[2]); return; }

  // CREATE TRIGGER
  m = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([\w."`]+)/i.exec(t);
  if (m) { emitSimple(m[1], 'function', 'trigger', stmt, fileId, ctx, result); return; }

  // CREATE SCHEMA
  m = /^CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."`]+)/i.exec(t);
  if (m) { emitSimple(m[1], 'namespace', 'schema', stmt, fileId, ctx, result); return; }

  // CREATE TYPE
  m = /^CREATE\s+(?:OR\s+REPLACE\s+)?TYPE\s+([\w."`]+)/i.exec(t);
  if (m) { emitSimple(m[1], 'type_alias', 'type', stmt, fileId, ctx, result); return; }

  // CREATE SEQUENCE
  m = /^CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."`]+)/i.exec(t);
  if (m) { emitSimple(m[1], 'variable', 'sequence', stmt, fileId, ctx, result); return; }

  // ALTER TABLE ... ADD COLUMN col type
  m = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([\w."`]+)\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w."`]+)\s+([^,;]+)/i.exec(t);
  if (m) {
    // Attach the new column to the existing table node (by id). If the table
    // wasn't defined in this file, the resolver will catch the reference later.
    const tableName = stripQualifier(m[1]).name;
    const colName = unquote(m[2]);
    const tableQualified = `${ctx.filePath}::${tableName}`;
    const tableId = id(ctx.filePath, 'table', tableQualified);
    const colId = id(ctx.filePath, 'field', `${tableQualified}.${colName}`);
    result.nodes.push({
      id: colId, kind: 'field', name: colName,
      qualifiedName: `${tableQualified}.${colName}`,
      filePath: ctx.filePath, language: ctx.language,
      startLine: stmt.startLine, endLine: stmt.startLine,
      startColumn: 0, endColumn: 0,
      signature: firstLine(stmt.raw), updatedAt: ctx.now,
    });
    result.edges.push({ source: tableId, target: colId, kind: 'contains' });
    captureForeignKey(m[3], colId, ctx, result, stmt.startLine);
    return;
  }
}

function emitTable(
  rawName: string, body: string, stmt: Stmt, fileId: string,
  ctx: ExtractCtx, result: ExtractionResult,
): void {
  const { schema, name } = stripQualifier(rawName);
  const qualified = `${ctx.filePath}::${schema ? schema + '.' : ''}${name}`;
  const tableId = id(ctx.filePath, 'table', qualified);
  result.nodes.push({
    id: tableId, kind: 'table', name,
    qualifiedName: qualified, filePath: ctx.filePath, language: ctx.language,
    startLine: stmt.startLine, endLine: stmt.startLine,
    startColumn: 0, endColumn: 0,
    signature: firstLine(stmt.raw), updatedAt: ctx.now,
  });
  result.edges.push({ source: fileId, target: tableId, kind: 'contains' });

  // Walk columns
  for (const part of splitTopLevelCommas(body)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const upper = trimmed.toUpperCase();

    // Table-level FK constraint: [CONSTRAINT name] FOREIGN KEY (cols) REFERENCES other(col)
    const fkM = /^(?:CONSTRAINT\s+[\w."`]+\s+)?FOREIGN\s+KEY\s*\([^)]*\)\s+REFERENCES\s+([\w."`]+)/i.exec(trimmed);
    if (fkM) {
      const refName = stripQualifier(fkM[1]).name;
      result.edges.push({
        source: tableId,
        target: id(ctx.filePath, 'table', `${ctx.filePath}::${refName}`),
        kind: 'references',
        metadata: { ref_kind: 'foreign_key', target_table: refName },
        line: stmt.startLine,
      });
      continue;
    }

    // Skip pure constraint lines that aren't columns.
    if (/^(?:PRIMARY\s+KEY|UNIQUE|CHECK|EXCLUDE|CONSTRAINT)\b/i.test(upper)) continue;

    // Column definition: first token is the column name (possibly quoted).
    const colM = /^([\w"`]+|"[^"]+"|`[^`]+`)\s+(.+)$/s.exec(trimmed);
    if (!colM) continue;
    const colName = unquote(colM[1]);
    const colId = id(ctx.filePath, 'field', `${qualified}.${colName}`);
    result.nodes.push({
      id: colId, kind: 'field', name: colName,
      qualifiedName: `${qualified}.${colName}`,
      filePath: ctx.filePath, language: ctx.language,
      startLine: stmt.startLine, endLine: stmt.startLine,
      startColumn: 0, endColumn: 0,
      signature: trimmed.slice(0, 200), updatedAt: ctx.now,
    });
    result.edges.push({ source: tableId, target: colId, kind: 'contains' });

    // Inline FK: REFERENCES other_table[(col)]
    captureForeignKey(colM[2], colId, ctx, result, stmt.startLine);
  }
}

function captureForeignKey(
  fragment: string, fromId: string, ctx: ExtractCtx, result: ExtractionResult, line: number,
): void {
  const m = /\bREFERENCES\s+([\w."`]+)/i.exec(fragment);
  if (!m) return;
  const refName = stripQualifier(m[1]).name;
  result.edges.push({
    source: fromId,
    target: id(ctx.filePath, 'table', `${ctx.filePath}::${refName}`),
    kind: 'references',
    metadata: { ref_kind: 'foreign_key', target_table: refName },
    line,
  });
}

function emitIndex(
  idxName: string, table: string, cols: string,
  stmt: Stmt, fileId: string, ctx: ExtractCtx, result: ExtractionResult,
): void {
  const name = unquote(stripQualifier(idxName).name);
  const qualified = `${ctx.filePath}::index::${name}`;
  const nodeIdx = id(ctx.filePath, 'index', qualified);
  result.nodes.push({
    id: nodeIdx, kind: 'index', name,
    qualifiedName: qualified, filePath: ctx.filePath, language: ctx.language,
    startLine: stmt.startLine, endLine: stmt.startLine,
    startColumn: 0, endColumn: 0,
    signature: `INDEX ON ${table}(${cols.trim()})`,
    updatedAt: ctx.now,
  });
  result.edges.push({ source: fileId, target: nodeIdx, kind: 'contains' });
  // Edge index -> table
  const refName = stripQualifier(table).name;
  result.edges.push({
    source: nodeIdx,
    target: id(ctx.filePath, 'table', `${ctx.filePath}::${refName}`),
    kind: 'references',
    metadata: { ref_kind: 'index_on', target_table: refName, columns: cols.trim() },
    line: stmt.startLine,
  });
}

function emitSimple(
  rawName: string, kind: NodeKind, signaturePrefix: string,
  stmt: Stmt, fileId: string, ctx: ExtractCtx, result: ExtractionResult,
  args?: string,
): void {
  const { name } = stripQualifier(rawName);
  const qualified = `${ctx.filePath}::${name}`;
  const nid = id(ctx.filePath, kind, qualified);
  result.nodes.push({
    id: nid, kind, name,
    qualifiedName: qualified, filePath: ctx.filePath, language: ctx.language,
    startLine: stmt.startLine, endLine: stmt.startLine,
    startColumn: 0, endColumn: 0,
    signature: args !== undefined ? `${signaturePrefix} ${name}(${args.trim()})` : `${signaturePrefix} ${name}`,
    updatedAt: ctx.now,
  });
  result.edges.push({ source: fileId, target: nid, kind: 'contains' });
}

// ============================================================================
// Lexing helpers
// ============================================================================

/**
 * Replace contents of strings/comments with spaces (preserving offsets) so
 * downstream regex matching doesn't trip over keywords inside them.
 */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    // line comment
    if (c === '-' && next === '-') {
      while (i < src.length && src[i] !== '\n') { out += src[i] === '\n' ? '\n' : ' '; i++; }
      continue;
    }
    // block comment
    if (c === '/' && next === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      if (i < src.length) { out += '  '; i += 2; }
      continue;
    }
    // string literals: ' ' (with '' escape) and " " (identifiers) and ` ` (mysql)
    if (c === "'") {
      out += c; i++;
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") { out += '  '; i += 2; continue; }
        if (src[i] === "'") { out += "'"; i++; break; }
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      continue;
    }
    // Keep " and ` as-is — they're used for quoted identifiers we want to read.
    out += c; i++;
  }
  return out;
}

/** Split on top-level `;`, ignoring those inside parens. */
function splitStatements(stripped: string, raw: string): Stmt[] {
  const out: Stmt[] = [];
  let depth = 0;
  let start = 0;
  let line = 1;
  let stmtStartLine = 1;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '\n') line++;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      const text = stripped.slice(start, i).trim();
      const rawText = raw.slice(start, i).trim();
      if (text) out.push({ text, raw: rawText, startLine: stmtStartLine });
      start = i + 1;
      while (start < stripped.length && /\s/.test(stripped[start])) {
        if (stripped[start] === '\n') line++;
        start++;
      }
      stmtStartLine = line;
    }
  }
  const tail = stripped.slice(start).trim();
  if (tail) out.push({ text: tail, raw: raw.slice(start).trim(), startLine: stmtStartLine });
  return out;
}

/** Split a parenthesized column-list body on top-level commas. */
function splitTopLevelCommas(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/**
 * Given text and the index of an opening `(`, return the content between
 * the matching balanced pair (exclusive), or undefined if unbalanced.
 */
function extractBalancedParenBody(text: string, openIdx: number): string | undefined {
  if (text[openIdx] !== '(') return undefined;
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return text.slice(openIdx + 1, i); }
  }
  return undefined;
}

function stripQualifier(raw: string): { schema?: string; name: string } {
  const parts = raw.split('.').map(unquote);
  if (parts.length >= 2) return { schema: parts[parts.length - 2], name: parts[parts.length - 1] };
  return { name: parts[0] };
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  if (t.startsWith('`') && t.endsWith('`')) return t.slice(1, -1);
  return t;
}

function id(filePath: string, kind: string, qualified: string): string {
  return createHash('sha1').update(`${kind}|${qualified}|${filePath}`).digest('hex').slice(0, 16);
}

function fileNode(fileId: string, ctx: ExtractCtx, source: string): CodeNode {
  return {
    id: fileId, kind: 'file', name: baseName(ctx.filePath),
    qualifiedName: ctx.filePath, filePath: ctx.filePath, language: ctx.language,
    startLine: 1, endLine: source.split('\n').length,
    startColumn: 0, endColumn: 0, updatedAt: ctx.now,
  };
}

function baseName(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

function firstLine(s: string): string {
  const i = s.indexOf('\n');
  return (i < 0 ? s : s.slice(0, i)).trim().slice(0, 240);
}

// Re-export CodeEdge so the result type matches extractor.ts exactly without
// pulling its full dependency chain here.
export type { CodeEdge };
