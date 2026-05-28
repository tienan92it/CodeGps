/**
 * L0 code sync: walk the project, parse each file, extract symbols/edges,
 * write to code.db. Incremental by content hash; --full bypasses.
 */
import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { relative } from 'path';
import { openCodeDb } from '../db/connection.js';
import { walkFiles } from './walker.js';
import { detectLanguage } from './languages.js';
import { parseSource } from './parser.js';
import { extract } from './extractor.js';
import { extractSql } from './sql-extractor.js';
import { getFileHash, writeExtraction, resolveCalls } from './store.js';
import type { IndexedFile } from '../types.js';

export interface SyncStats {
  filesIndexed: number;
  filesSkipped: number;
  nodes: number;
  edges: number;
  resolvedCalls: number;
  errors: number;
}

export interface SyncOpts {
  full?: boolean;
}

export async function syncProject(root: string, opts: SyncOpts = {}): Promise<SyncStats> {
  const db = openCodeDb(root);
  const stats: SyncStats = {
    filesIndexed: 0, filesSkipped: 0, nodes: 0, edges: 0, resolvedCalls: 0, errors: 0,
  };
  const now = Date.now();
  try {
    const files = walkFiles(root);
    for (const abs of files) {
      const spec = detectLanguage(abs);
      if (!spec) continue;
      let source: string;
      let stat;
      try {
        source = readFileSync(abs, 'utf8');
        stat = statSync(abs);
      } catch {
        stats.errors++;
        continue;
      }
      const hash = createHash('sha1').update(source).digest('hex');
      const relPath = relative(root, abs).split(/[\\/]/).join('/');

      if (!opts.full) {
        const prev = getFileHash(db, relPath);
        if (prev === hash) {
          stats.filesSkipped++;
          continue;
        }
      }

      try {
        const ctxFor = (lang = spec.language) => ({ filePath: relPath, language: lang, source, now });
        let ext;
        if (spec.wasmFile === '' && spec.language === 'sql') {
          // SQL has no tree-sitter WASM; use the DDL regex extractor.
          ext = extractSql(source, ctxFor());
        } else {
          const tree = await parseSource(spec.wasmFile, source);
          if (!tree) { stats.errors++; continue; }
          ext = extract(tree, ctxFor());
          tree.delete();
        }

        const file: IndexedFile = {
          path: relPath,
          contentHash: hash,
          language: spec.language,
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          indexedAt: now,
          nodeCount: ext.nodes.length,
        };
        writeExtraction(db, file, ext);
        stats.filesIndexed++;
        stats.nodes += ext.nodes.length;
        stats.edges += ext.edges.length;
      } catch (e) {
        stats.errors++;
        // best-effort; continue
      }
    }
    stats.resolvedCalls = resolveCalls(db);
  } finally {
    db.close();
  }
  return stats;
}
