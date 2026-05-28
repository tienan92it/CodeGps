/**
 * Syntax pass — deterministic extraction from a turn window.
 *
 * Only captures things that are unambiguous from FORM, not meaning:
 *   - file paths
 *   - fenced code blocks (with optional language tag)
 *   - shell commands (lines starting with `$ ` in prose, OR all lines
 *     inside ```bash / ```sh / ```zsh / ```shell fences)
 *   - error message lines (e.g. "Error: ...", "TypeError: ...")
 *   - stack traces (multi-line; "at <fn> (path:line:col)")
 *   - ticket IDs (e.g. JIRA-123, GH-42)
 *   - URLs
 *
 * Each extracted artifact becomes a k_node with source='syntax'. The
 * caller wires k_provenance and (for paths) k_to_code resolution.
 *
 * Strict non-goal: deciding *meaning* (is this a "decision"? is this
 * "business logic"?). That lives in agents.
 */
import { createHash } from 'crypto';
import type { KNode, KNodeKind, KProvenance } from '../types.js';

export interface SyntaxArtifact {
  node: KNode;
  provenance: KProvenance;
  /** For paths only: raw path string to feed the code resolver. */
  pathMention?: string;
}

const RE_FENCE = /```([a-zA-Z0-9_+\-]*)\n([\s\S]*?)```/g;
// Conservative path matcher: relative or rooted, includes a / or \, ends
// with file-ish chars, optionally with :line[:col]. Avoids matching URLs
// (those are stripped first).
const RE_PATH = /(?<![\w/])((?:\.{1,2}\/|\/|[a-zA-Z]:\\)?[\w.\-]+(?:[/\\][\w.\-]+){1,8}(?:\.[a-zA-Z0-9]{1,8})(?::\d+(?::\d+)?)?)(?![\w/])/g;
const RE_URL = /\bhttps?:\/\/[^\s)>\]]+/g;
const RE_TICKET = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;
const RE_ERROR_LINE = /^(?:[A-Z][A-Za-z]+(?:Error|Exception|Warning|Failure))(?::\s.*)?$/m;
const RE_STACK_FRAME = /^\s+at\s+[\w$.<>]+\s+\(?[^\s]+:\d+(?::\d+)?\)?/m;
const RE_DOLLAR_CMD = /^[ \t]*\$\s+(.+)$/gm;
const SHELL_LANGS = new Set(['bash', 'sh', 'zsh', 'shell', 'console']);

export interface SyntaxOpts {
  windowId: string;
}

export function runSyntaxPass(text: string, opts: SyntaxOpts): SyntaxArtifact[] {
  const out: SyntaxArtifact[] = [];

  // 1. fenced code blocks (and shell commands within shell-typed fences).
  // We capture position-tracked spans so prose handling below can skip them
  // to avoid double-capturing paths inside code.
  const codeSpans: Array<[number, number]> = [];
  RE_FENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_FENCE.exec(text))) {
    const lang = (m[1] || '').toLowerCase();
    const body = m[2];
    const start = m.index;
    const end = m.index + m[0].length;
    codeSpans.push([start, end]);
    out.push(makeNode(
      opts.windowId,
      'code_block',
      lang ? `code block (${lang})` : 'code block',
      body.slice(0, 500),
      body,
      start, end,
    ));
    if (SHELL_LANGS.has(lang)) {
      for (const line of body.split('\n')) {
        const cmd = line.replace(/^\s*\$?\s*/, '').trim();
        if (!cmd) continue;
        out.push(makeNode(
          opts.windowId,
          'shell_command',
          'shell command',
          cmd.slice(0, 200),
          cmd,
        ));
      }
    }
  }

  // Prose-only view: blank out code spans so RE_PATH/RE_URL don't reach into them.
  const prose = redactSpans(text, codeSpans);

  // 2. URLs
  RE_URL.lastIndex = 0;
  while ((m = RE_URL.exec(prose))) {
    out.push(makeNode(opts.windowId, 'url', 'url', m[0], m[0], m.index, m.index + m[0].length));
  }

  // 3. Paths — after URLs, so URL hosts/paths don't get re-captured.
  const proseNoUrls = prose.replace(RE_URL, (s) => ' '.repeat(s.length));
  RE_PATH.lastIndex = 0;
  const seenPaths = new Set<string>();
  while ((m = RE_PATH.exec(proseNoUrls))) {
    const raw = m[0];
    if (seenPaths.has(raw)) continue;
    seenPaths.add(raw);
    const cleaned = raw.replace(/:\d+(:\d+)?$/, '');
    out.push({
      node: buildNode(opts.windowId, 'path_mention', 'path mention', cleaned, raw),
      provenance: { kNodeId: '', windowId: opts.windowId, spanStart: m.index, spanEnd: m.index + raw.length },
      pathMention: cleaned,
    });
  }

  // 4. Ticket IDs
  RE_TICKET.lastIndex = 0;
  const seenTickets = new Set<string>();
  while ((m = RE_TICKET.exec(prose))) {
    if (seenTickets.has(m[0])) continue;
    seenTickets.add(m[0]);
    out.push(makeNode(opts.windowId, 'ticket_id', 'ticket id', m[0], m[0], m.index, m.index + m[0].length));
  }

  // 5. $-prefixed shell commands appearing in prose
  RE_DOLLAR_CMD.lastIndex = 0;
  while ((m = RE_DOLLAR_CMD.exec(prose))) {
    const cmd = m[1].trim();
    if (!cmd) continue;
    out.push(makeNode(opts.windowId, 'shell_command', 'shell command', cmd.slice(0, 200), cmd, m.index, m.index + m[0].length));
  }

  // 6. Error lines + stack frames (any occurrence anywhere; prose+code)
  for (const re of [RE_ERROR_LINE, RE_STACK_FRAME] as const) {
    const reG = new RegExp(re.source, 'gm');
    while ((m = reG.exec(text))) {
      const kind: KNodeKind = re === RE_ERROR_LINE ? 'error_message' : 'stack_trace';
      out.push(makeNode(opts.windowId, kind, kind.replace('_', ' '), m[0].trim(), m[0], m.index, m.index + m[0].length));
    }
  }

  // Stable-ish: fill in provenance.kNodeId for entries that need it
  for (const a of out) if (a.provenance.kNodeId === '') a.provenance.kNodeId = a.node.id;
  return out;
}

// ============================================================================

function makeNode(
  windowId: string, kind: KNodeKind, title: string, summary: string, evidence: string,
  spanStart?: number, spanEnd?: number,
): SyntaxArtifact {
  const node = buildNode(windowId, kind, title, summary, evidence);
  return {
    node,
    provenance: { kNodeId: node.id, windowId, spanStart, spanEnd },
  };
}

function buildNode(windowId: string, kind: KNodeKind, title: string, summary: string, evidence: string): KNode {
  const now = Date.now();
  const id = createHash('sha1')
    .update(`${kind}|${windowId}|${evidence}`)
    .digest('hex')
    .slice(0, 16);
  return {
    id,
    kind,
    title: title.slice(0, 240),
    summary: summary.slice(0, 1000),
    evidenceText: evidence.slice(0, 4000),
    confidence: 1,
    source: 'syntax',
    createdAt: now,
    updatedAt: now,
  };
}

function redactSpans(text: string, spans: Array<[number, number]>): string {
  if (!spans.length) return text;
  const chars = text.split('');
  for (const [s, e] of spans) {
    for (let i = s; i < e && i < chars.length; i++) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  }
  return chars.join('');
}
