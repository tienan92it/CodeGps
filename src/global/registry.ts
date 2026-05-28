import type { Database as SqliteDb } from 'better-sqlite3';
import { createHash } from 'crypto';
import { basename } from 'path';

export function projectIdForPath(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 16);
}

export function registerProject(gdb: SqliteDb, path: string): string {
  const id = projectIdForPath(path);
  const now = Date.now();
  gdb.prepare(`
    INSERT INTO projects (id, name, path, registered_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET last_seen_at=excluded.last_seen_at
  `).run(id, basename(path), path, now, now);
  return id;
}
