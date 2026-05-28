/**
 * Claude Code SessionAdapter.
 *
 * Transcripts live at:
 *   ~/.claude/projects/<slug>/*.jsonl
 *
 * The <slug> Claude Code uses is the absolute project path with non-alnum
 * characters replaced by `-`. Some installs preserve a leading dash from the
 * leading slash. We try both forms.
 *
 * Each JSONL line is a Claude API message-shaped object:
 *   { "type": "user"|"assistant"|"system", "message": { "content": [...] } }
 * Tool use entries appear as content blocks of type `tool_use` / `tool_result`.
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'fs';
import { resolve as resolvePath, join } from 'path';
import { createInterface } from 'readline';
import type { SessionAdapter } from './base.js';
import type { RawTurn, SessionRef, TurnRole } from '../types.js';
import { expandHome } from '../config.js';

const DEFAULT_ROOT = '~/.claude/projects';

export interface ClaudeCodeAdapterOpts {
  root?: string;
}

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly agent = 'claude-code' as const;
  private readonly root: string;

  constructor(opts: ClaudeCodeAdapterOpts = {}) {
    this.root = expandHome(opts.root ?? DEFAULT_ROOT);
  }

  async *discover(projectRoot: string): AsyncIterable<SessionRef> {
    if (!existsSync(this.root)) return;
    const abs = resolvePath(projectRoot);
    const seen = new Set<string>();
    for (const slug of candidateSlugs(abs)) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      const projDir = join(this.root, slug);
      if (!existsSync(projDir)) continue;
      let entries: string[];
      try { entries = readdirSync(projDir); } catch { continue; }
      for (const name of entries) {
        if (!name.endsWith('.jsonl')) continue;
        const fileAbs = join(projDir, name);
        let st;
        try { st = statSync(fileAbs); } catch { continue; }
        if (!st.isFile()) continue;
        yield {
          agent: 'claude-code',
          sourceId: name.replace(/\.jsonl$/, ''),
          sourcePath: fileAbs,
          startedAt: st.mtimeMs,
        };
      }
    }
  }

  async *read(
    ref: SessionRef, fromOffset: number,
  ): AsyncIterable<{ turn: RawTurn; offsetAfter: number }> {
    if (!existsSync(ref.sourcePath)) return;
    const st = statSync(ref.sourcePath);
    if (fromOffset >= st.size) return;
    const stream = createReadStream(ref.sourcePath, { start: fromOffset, encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let cursor = fromOffset;
    for await (const line of rl) {
      cursor += Buffer.byteLength(line, 'utf8') + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let raw: any;
      try { raw = JSON.parse(trimmed); } catch { continue; }
      const turn = parseClaudeEntry(raw);
      if (turn) yield { turn, offsetAfter: cursor };
    }
  }
}

export function parseClaudeEntry(raw: any): RawTurn | undefined {
  const role = normalizeRole(raw?.type ?? raw?.role);
  if (!role) return undefined;

  const parts: string[] = [];
  const toolCalls: { name: string; args?: unknown; resultExcerpt?: string; targetPaths?: string[] }[] = [];

  const content = raw?.message?.content ?? raw?.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (!c || typeof c !== 'object') continue;
      if (c.type === 'text' && typeof c.text === 'string') {
        parts.push(c.text);
      } else if (c.type === 'tool_use') {
        toolCalls.push({
          name: String(c.name ?? 'unknown'),
          args: c.input,
          targetPaths: extractPaths(c.input),
        });
      } else if (c.type === 'tool_result') {
        const last = toolCalls[toolCalls.length - 1];
        const excerpt = typeof c.content === 'string'
          ? c.content
          : Array.isArray(c.content)
            ? c.content.map((x: any) => (typeof x?.text === 'string' ? x.text : '')).join('\n')
            : '';
        if (last) last.resultExcerpt = excerpt.slice(0, 2000);
      }
    }
  } else if (typeof content === 'string') {
    parts.push(content);
  }

  return {
    role,
    text: parts.join('\n').trim(),
    ts: typeof raw?.timestamp === 'number' ? raw.timestamp : undefined,
    raw,
    toolCalls: toolCalls.length ? toolCalls : undefined,
  };
}

function normalizeRole(r: unknown): TurnRole | undefined {
  if (r === 'user' || r === 'assistant' || r === 'system' || r === 'tool') return r;
  return undefined;
}

function extractPaths(args: unknown): string[] | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const out: string[] = [];
  for (const key of ['path', 'file_path', 'filePath', 'target_file', 'targetFile', 'filename']) {
    const v = (args as any)[key];
    if (typeof v === 'string') out.push(v);
  }
  return out.length ? out : undefined;
}

/**
 * Claude Code has used several slug encodings over time. Generate the most
 * common ones; the discover() loop short-circuits on the first that exists.
 */
function candidateSlugs(abs: string): string[] {
  const stripLeading = abs.startsWith('/') ? abs.slice(1) : abs;
  return [
    '-' + stripLeading.replace(/[^a-zA-Z0-9]/g, '-'),  // leading-dash form
    stripLeading.replace(/[^a-zA-Z0-9]/g, '-'),         // no leading dash
    abs.replace(/[^a-zA-Z0-9]/g, '-'),                  // raw with leading dash
  ];
}
