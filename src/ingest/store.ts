/**
 * Persistence for L1 conversations: sessions, turns, tool calls.
 */
import type { Database as SqliteDb } from 'better-sqlite3';
import { createHash, randomUUID } from 'crypto';
import type { AgentId, RawTurn, Session, SessionRef, ToolCall, Turn } from '../types.js';

export function sessionIdFor(ref: SessionRef): string {
  return createHash('sha1')
    .update(`${ref.agent}|${ref.sourcePath}|${ref.sourceId}`)
    .digest('hex')
    .slice(0, 16);
}

export function getSession(db: SqliteDb, id: string): Session | undefined {
  const row = db
    .prepare(`SELECT * FROM sessions WHERE id=?`)
    .get(id) as any;
  if (!row) return undefined;
  return {
    id: row.id,
    agent: row.agent as AgentId,
    sourceId: row.source_id,
    sourcePath: row.source_path,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    title: row.title ?? undefined,
    ingestedAt: row.ingested_at,
    ingestOffset: row.ingest_offset,
  };
}

export function upsertSession(
  db: SqliteDb, ref: SessionRef, now: number,
): { id: string; isNew: boolean; offset: number } {
  const id = sessionIdFor(ref);
  const existing = getSession(db, id);
  if (existing) {
    return { id, isNew: false, offset: existing.ingestOffset };
  }
  db.prepare(`
    INSERT INTO sessions
      (id, agent, source_id, source_path, started_at, ended_at, title, ingested_at, ingest_offset)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    id, ref.agent, ref.sourceId, ref.sourcePath,
    ref.startedAt ?? null, null, ref.title ?? null, now,
  );
  return { id, isNew: true, offset: 0 };
}

export function nextTurnIdx(db: SqliteDb, sessionId: string): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(idx), -1) + 1 AS next FROM turns WHERE session_id=?`)
    .get(sessionId) as { next: number };
  return row.next;
}

export function insertTurn(
  db: SqliteDb, sessionId: string, idx: number, raw: RawTurn,
): Turn {
  const id = `${sessionId}-${idx}`;
  db.prepare(`
    INSERT INTO turns (id, session_id, idx, role, text, ts, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, sessionId, idx, raw.role, raw.text,
    raw.ts ?? null, JSON.stringify(raw.raw),
  );
  if (raw.toolCalls) {
    for (const tc of raw.toolCalls) {
      const tcRow: ToolCall = {
        id: randomUUID(),
        turnId: id,
        name: tc.name,
        args: tc.args,
        resultExcerpt: tc.resultExcerpt,
        targetPaths: tc.targetPaths,
      };
      db.prepare(`
        INSERT INTO tool_calls (id, turn_id, name, args, result_excerpt, target_paths)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        tcRow.id, tcRow.turnId, tcRow.name,
        tcRow.args !== undefined ? JSON.stringify(tcRow.args) : null,
        tcRow.resultExcerpt ?? null,
        tcRow.targetPaths ? JSON.stringify(tcRow.targetPaths) : null,
      );
    }
  }
  return {
    id, sessionId, idx,
    role: raw.role, text: raw.text, ts: raw.ts, raw: raw.raw,
  };
}

export function updateOffset(
  db: SqliteDb, sessionId: string, offset: number,
): void {
  db.prepare(`UPDATE sessions SET ingest_offset=? WHERE id=?`)
    .run(offset, sessionId);
}

export function turnsForSession(db: SqliteDb, sessionId: string, fromIdx = 0): Turn[] {
  const rows = db
    .prepare(`SELECT id, session_id, idx, role, text, ts FROM turns
              WHERE session_id=? AND idx>=? ORDER BY idx ASC`)
    .all(sessionId, fromIdx) as any[];
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    idx: r.idx,
    role: r.role,
    text: r.text,
    ts: r.ts ?? undefined,
  }));
}
