import Database, { type Database as SqliteDb } from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { projectConfigDir, globalConfigDir } from '../config.js';

/**
 * SQL schema files are copied into dist/db/ during build. At dev time we read
 * from src/db/. Resolution is best-effort: try dist relative to compiled file,
 * fall back to src relative to repo root.
 */
function schemaPath(file: string): string {
  const fromDist = join(__dirname, '..', 'db', file);
  if (existsSync(fromDist)) return fromDist;
  return join(__dirname, '..', '..', 'src', 'db', file);
}

function open(path: string): SqliteDb {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function applySchema(db: SqliteDb, schemaFile: string): void {
  const sql = readFileSync(schemaPath(schemaFile), 'utf8');
  db.exec(sql);
}

export function openCodeDb(projectRoot: string): SqliteDb {
  const db = open(join(projectConfigDir(projectRoot), 'code.db'));
  applySchema(db, 'code-schema.sql');
  return db;
}

export function openKnowledgeDb(projectRoot: string): SqliteDb {
  const db = open(join(projectConfigDir(projectRoot), 'knowledge.db'));
  applySchema(db, 'knowledge-schema.sql');
  return db;
}

export function openGlobalDb(): SqliteDb {
  const db = open(join(globalConfigDir(), 'global.db'));
  applySchema(db, 'global-schema.sql');
  return db;
}
