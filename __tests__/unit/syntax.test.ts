import { describe, it, expect } from 'vitest';
import { runSyntaxPass } from '../../src/pipeline/syntax';

describe('syntax pass', () => {
  it('captures fenced code blocks with language tag', () => {
    const out = runSyntaxPass(
      'Here is some code:\n```ts\nexport function f() { return 1; }\n```\nDone.',
      { windowId: 'w1' },
    );
    const blocks = out.filter((a) => a.node.kind === 'code_block');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].node.title).toContain('ts');
  });

  it('captures shell commands inside ```bash fences', () => {
    const out = runSyntaxPass(
      '```bash\nnpm install\nnpm run build\n```',
      { windowId: 'w1' },
    );
    const cmds = out.filter((a) => a.node.kind === 'shell_command');
    expect(cmds.length).toBeGreaterThanOrEqual(2);
    expect(cmds.map((c) => c.node.summary)).toEqual(
      expect.arrayContaining(['npm install', 'npm run build']),
    );
  });

  it('captures file paths in prose', () => {
    const out = runSyntaxPass(
      'Edit src/foo/bar.ts:42 and check ./README.md',
      { windowId: 'w1' },
    );
    const paths = out.filter((a) => a.node.kind === 'path_mention').map((a) => a.pathMention);
    expect(paths).toEqual(expect.arrayContaining(['src/foo/bar.ts', './README.md']));
  });

  it('does not capture paths inside code fences', () => {
    const out = runSyntaxPass(
      '```ts\nimport x from "./inside.ts";\n```\nsee outside.ts',
      { windowId: 'w1' },
    );
    const paths = out.filter((a) => a.node.kind === 'path_mention').map((a) => a.pathMention);
    expect(paths).not.toContain('./inside.ts');
  });

  it('captures URLs', () => {
    const out = runSyntaxPass(
      'See https://example.com/docs for details.',
      { windowId: 'w1' },
    );
    const urls = out.filter((a) => a.node.kind === 'url');
    expect(urls).toHaveLength(1);
    expect(urls[0].node.summary).toBe('https://example.com/docs');
  });

  it('captures ticket ids', () => {
    const out = runSyntaxPass('Fixed JIRA-1234 and GH-42.', { windowId: 'w1' });
    const ids = out.filter((a) => a.node.kind === 'ticket_id').map((a) => a.node.summary);
    expect(ids).toEqual(expect.arrayContaining(['JIRA-1234', 'GH-42']));
  });

  it('every artifact has provenance pointing to its node', () => {
    const out = runSyntaxPass('foo/bar.ts\nhttps://x.io', { windowId: 'w1' });
    for (const a of out) {
      expect(a.provenance.windowId).toBe('w1');
      expect(a.provenance.kNodeId).toBe(a.node.id);
    }
  });
});
