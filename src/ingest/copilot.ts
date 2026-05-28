/**
 * GitHub Copilot Chat SessionAdapter — best-effort.
 *
 * Copilot stores chat history inside VS Code's workspace storage at
 *   ~/Library/Application Support/Code/User/workspaceStorage/<hash>/   (macOS)
 *   ~/.config/Code/User/workspaceStorage/<hash>/                       (Linux)
 *   %APPDATA%/Code/User/workspaceStorage/<hash>/                       (Windows)
 *
 * The exact storage layout has shifted across Copilot versions (SQLite blobs
 * inside state.vscdb, plus per-extension JSON files). We probe for the most
 * common shapes; missing data is silently skipped rather than failing the
 * whole ingest pipeline.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { homedir, platform } from 'os';
import { resolve as resolvePath, join } from 'path';
import { createHash } from 'crypto';
import type { SessionAdapter } from './base.js';
import type { RawTurn, SessionRef, TurnRole } from '../types.js';

export class CopilotAdapter implements SessionAdapter {
  readonly agent = 'copilot' as const;
  private readonly storageRoots: string[];

  constructor() {
    this.storageRoots = workspaceStorageRoots();
  }

  async *discover(projectRoot: string): AsyncIterable<SessionRef> {
    const abs = resolvePath(projectRoot);
    const uri = `file://${abs}`;
    const hash = createHash('md5').update(uri).digest('hex');
    for (const root of this.storageRoots) {
      if (!existsSync(root)) continue;
      const candidate = join(root, hash);
      if (!existsSync(candidate)) continue;
      // Probe for chat session files. Copilot has stored these under several
      // extension subdirs over time. We look for any *.json that contains a
      // recognizable conversation shape.
      for (const file of walkProbeFiles(candidate)) {
        const sniff = sniffCopilotFile(file);
        if (!sniff) continue;
        let st;
        try { st = statSync(file); } catch { continue; }
        yield {
          agent: 'copilot',
          sourceId: sniff.sessionId ?? hash + '-' + sniff.shortId,
          sourcePath: file,
          startedAt: st.mtimeMs,
        };
      }
    }
  }

  async *read(
    ref: SessionRef, _fromOffset: number,
  ): AsyncIterable<{ turn: RawTurn; offsetAfter: number }> {
    // Copilot files are JSON (not JSONL); incremental offset reads don't help.
    // We re-read the whole file and rely on stable turn IDs to dedup. The
    // ingestor's nextTurnIdx + ON CONFLICT path makes that idempotent.
    if (!existsSync(ref.sourcePath)) return;
    let raw: any;
    try { raw = JSON.parse(readFileSync(ref.sourcePath, 'utf8')); } catch { return; }
    const turns = extractTurns(raw);
    const size = statSync(ref.sourcePath).size;
    for (const t of turns) {
      yield { turn: t, offsetAfter: size };
    }
  }
}

function workspaceStorageRoots(): string[] {
  const home = homedir();
  const p = platform();
  if (p === 'darwin') {
    return [
      join(home, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'),
      join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'workspaceStorage'),
      join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage'),
    ];
  }
  if (p === 'win32') {
    const appdata = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return [join(appdata, 'Code', 'User', 'workspaceStorage')];
  }
  return [
    join(home, '.config', 'Code', 'User', 'workspaceStorage'),
    join(home, '.config', 'Code - Insiders', 'User', 'workspaceStorage'),
  ];
}

function walkProbeFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(d); } catch { continue; }
    for (const name of entries) {
      const abs = join(d, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) {
        // Limit recursion to ~3 levels under the workspace hash dir.
        const depth = abs.slice(dir.length).split(/[\\/]/).length;
        if (depth < 4) stack.push(abs);
      } else if (name.endsWith('.json')) {
        out.push(abs);
      }
    }
  }
  return out;
}

function sniffCopilotFile(path: string): { sessionId?: string; shortId: string } | undefined {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    // Common shapes: { sessionId, requests: [{ message, response }, ...] }
    if (raw?.sessionId && Array.isArray(raw?.requests)) {
      return { sessionId: String(raw.sessionId), shortId: String(raw.sessionId).slice(0, 8) };
    }
    if (Array.isArray(raw?.history)) {
      return { shortId: createHash('sha1').update(path).digest('hex').slice(0, 8) };
    }
  } catch { /* not json or not relevant */ }
  return undefined;
}

function extractTurns(raw: any): RawTurn[] {
  const turns: RawTurn[] = [];
  // Shape 1: { requests: [{ message: { text: '...' }, response: { value: '...' } }] }
  if (Array.isArray(raw?.requests)) {
    for (const r of raw.requests) {
      const userText = pickText(r?.message);
      if (userText) turns.push({ role: 'user' as TurnRole, text: userText, raw: r });
      const asstText = pickText(r?.response);
      if (asstText) turns.push({ role: 'assistant' as TurnRole, text: asstText, raw: r });
    }
  }
  // Shape 2: { history: [{ role, text }] }
  if (Array.isArray(raw?.history)) {
    for (const h of raw.history) {
      const role = normalizeRole(h?.role);
      const text = pickText(h);
      if (role && text) turns.push({ role, text, raw: h });
    }
  }
  return turns;
}

function pickText(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v.text === 'string') return v.text;
  if (typeof v.value === 'string') return v.value;
  if (Array.isArray(v.parts)) {
    return v.parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
  }
  return '';
}

function normalizeRole(r: unknown): TurnRole | undefined {
  if (r === 'user' || r === 'assistant' || r === 'system' || r === 'tool') return r;
  return undefined;
}
