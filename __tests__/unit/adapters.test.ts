/**
 * Tests for Claude Code, Codex, and Copilot session adapters.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClaudeCodeAdapter, parseClaudeEntry } from '../../src/ingest/claude-code';
import { CodexAdapter, parseCodexEntry } from '../../src/ingest/codex';

describe('ClaudeCodeAdapter', () => {
  it('parses Anthropic-shaped JSONL entries', () => {
    const t = parseClaudeEntry({
      type: 'user',
      message: { content: [{ type: 'text', text: 'hi' }] },
    });
    expect(t).toEqual(expect.objectContaining({ role: 'user', text: 'hi' }));

    const t2 = parseClaudeEntry({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'reading' },
          { type: 'tool_use', name: 'Read', input: { path: '/a.ts' } },
          { type: 'tool_result', content: 'ok' },
        ],
      },
    });
    expect(t2?.toolCalls).toHaveLength(1);
    expect(t2!.toolCalls![0].targetPaths).toEqual(['/a.ts']);
    expect(t2!.toolCalls![0].resultExcerpt).toBe('ok');
  });

  it('discovers transcripts under a fake projects root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cc-root-'));
    const projectPath = '/tmp/Foo-Bar';
    // Claude's slug: leading dash + non-alnum -> dash
    const slug = '-' + projectPath.slice(1).replace(/[^a-zA-Z0-9]/g, '-');
    const projDir = join(root, slug);
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, 'sess1.jsonl'),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'q' }] } }) + '\n' +
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }] } }) + '\n',
    );
    try {
      const adapter = new ClaudeCodeAdapter({ root });
      const refs = [];
      for await (const r of adapter.discover(projectPath)) refs.push(r);
      expect(refs).toHaveLength(1);
      const turns = [];
      for await (const t of adapter.read(refs[0], 0)) turns.push(t.turn);
      expect(turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('CodexAdapter', () => {
  it('parses message and function_call entries', () => {
    const m = parseCodexEntry({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'hi' }],
    });
    expect(m?.text).toBe('hi');

    const fc = parseCodexEntry({
      type: 'function_call',
      name: 'Read',
      arguments: '{"path":"/x.ts"}',
    });
    expect(fc?.role).toBe('assistant');
    expect(fc?.toolCalls?.[0].name).toBe('Read');
    expect(fc?.toolCalls?.[0].targetPaths).toEqual(['/x.ts']);

    const out = parseCodexEntry({ type: 'function_call_output', output: 'done' });
    expect(out?.role).toBe('tool');
    expect(out?.text).toBe('done');
  });

  it('discovers sessions whose cwd matches the project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cdx-root-'));
    const project = mkdtempSync(join(tmpdir(), 'cdx-proj-'));
    try {
      writeFileSync(
        join(root, 'sess.jsonl'),
        JSON.stringify({ cwd: project }) + '\n' +
        JSON.stringify({ type: 'message', role: 'user', content: 'hi' }) + '\n',
      );
      writeFileSync(
        join(root, 'other.jsonl'),
        JSON.stringify({ cwd: '/elsewhere' }) + '\n',
      );
      const adapter = new CodexAdapter({ root });
      const refs = [];
      for await (const r of adapter.discover(project)) refs.push(r);
      expect(refs).toHaveLength(1);
      expect(refs[0].sourceId).toBe('sess');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });
});
