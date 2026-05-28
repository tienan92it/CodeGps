import type { Command } from 'commander';
import { resolve } from 'path';
import { openKnowledgeDb } from '../db/connection.js';

export function registerTriage(program: Command): void {
  const cmd = program.command('triage').description('Triage operations (L1.5)');

  cmd
    .command('audit')
    .description('List triaged windows with their labels')
    .argument('[path]', 'Project root path', '.')
    .option('--dropped', 'Show only dropped windows', false)
    .option('--limit <n>', 'Max rows to print', '50')
    .action(async (path: string, opts: { dropped: boolean; limit: string }) => {
      const root = resolve(path);
      const db = openKnowledgeDb(root);
      try {
        const filter = opts.dropped ? 'WHERE tl.kept=0' : '';
        const rows = db.prepare(`
          SELECT tl.window_id AS id, tl.domain, tl.quality, tl.relevance, tl.linkage,
                 tl.confidence AS c, tl.kept AS kept, tl.rationale AS r
          FROM triage_labels tl
          JOIN turn_windows tw ON tw.id = tl.window_id
          ${filter}
          ORDER BY tw.session_id, tw.start_turn
          LIMIT ?
        `).all(parseInt(opts.limit, 10)) as any[];
        for (const r of rows) {
          console.log(
            `${r.kept ? 'KEEP' : 'DROP'} ` +
            `${r.domain.padEnd(15)} ${r.quality.padEnd(15)} ` +
            `${r.relevance.padEnd(10)} ${r.linkage.padEnd(18)} ` +
            `c=${Number(r.c).toFixed(2)}  ${(r.r ?? '').slice(0, 80)}`,
          );
        }
        console.log(`\n${rows.length} row(s)`);
      } finally {
        db.close();
      }
    });
}
