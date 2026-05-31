import type { Command } from 'commander';
import { resolve } from 'path';
import { openGlobalDb, openKnowledgeDb } from '../db/connection.js';
import { listSkills, listIndustries } from '../global/skills.js';

export function registerProfile(program: Command): void {
  // codegps skills — the global technical skill graph.
  program
    .command('skills')
    .description('Global skill graph: what you know, weighted by evidence across projects')
    .option('--scope <s>', 'Filter: technical | industry')
    .option('--cross', 'Only skills present in more than one project', false)
    .option('--limit <n>', 'Max rows', '60')
    .action(async (opts: { scope?: string; cross: boolean; limit: string }) => {
      const gdb = openGlobalDb();
      try {
        const skills = listSkills(gdb, { scope: opts.scope, crossOnly: opts.cross, limit: parseInt(opts.limit, 10) });
        if (skills.length === 0) {
          console.log('No skills yet. Run `codegps enrich` then `codegps link` in your projects.');
          return;
        }
        for (const s of skills) {
          console.log(
            `${s.evidenceWeight.toFixed(1).padStart(6)}  ${s.grounding.padEnd(12)} ` +
            `${('×' + s.projectCount).padStart(4)}  ${s.name}`,
          );
        }
        console.log(`\n${skills.length} skill(s)`);
      } finally { gdb.close(); }
    });

  // codegps profile — the big-picture second-brain summary.
  program
    .command('profile')
    .description('Big-picture knowledge profile across all projects')
    .action(async () => {
      const gdb = openGlobalDb();
      try {
        const projectCount = (gdb.prepare(`SELECT COUNT(*) AS n FROM projects`).get() as any).n;
        const industries = listIndustries(gdb);
        const tech = listSkills(gdb, { scope: 'technical', limit: 25 });
        const groundingMix = gdb.prepare(`
          SELECT grounding, COUNT(*) AS n FROM skills GROUP BY grounding
        `).all() as Array<{ grounding: string; n: number }>;

        console.log('# Knowledge profile\n');
        console.log(`Projects indexed: ${projectCount}\n`);

        console.log('## Industries');
        if (industries.length === 0) console.log('  (none classified)');
        for (const i of industries) {
          console.log(`  - ${i.name}  (${i.projectCount} project${i.projectCount === 1 ? '' : 's'}, confidence ${i.confidence.toFixed(2)})`);
        }

        console.log('\n## Top technical skills (by evidence weight)');
        if (tech.length === 0) console.log('  (none)');
        for (const s of tech) {
          console.log(`  - ${s.name}  (w=${s.evidenceWeight.toFixed(1)}, ×${s.projectCount}, ${s.grounding})`);
        }

        console.log('\n## Evidence mix (skills by grounding)');
        for (const g of groundingMix) console.log(`  ${g.grounding ?? 'stated'}: ${g.n}`);
      } finally { gdb.close(); }
    });

  // codegps learn — industry-standard knowledge you have NOT demonstrated.
  program
    .command('learn')
    .description('Learning targets: industry-standard knowledge not yet grounded in your work')
    .argument('[path]', 'Project root path', '.')
    .option('--limit <n>', 'Max rows', '40')
    .action(async (path: string, opts: { limit: string }) => {
      const root = resolve(path);
      const db = openKnowledgeDb(root);
      try {
        const rows = db.prepare(`
          SELECT title, summary, grounding, source_url FROM k_nodes
          WHERE scope='industry' AND COALESCE(grounding,'stated') IN ('model','external')
          ORDER BY grounding DESC, title
          LIMIT ?
        `).all(parseInt(opts.limit, 10)) as Array<{ title: string; summary: string | null; grounding: string; source_url: string | null }>;
        if (rows.length === 0) {
          console.log('No learning targets. Run `codegps enrich` (needs an LLM) to surface industry-standard knowledge.');
          return;
        }
        console.log(`# Learning targets (industry-standard, not yet demonstrated)\n`);
        for (const r of rows) {
          console.log(`- [${r.grounding}] ${r.title}` +
            (r.summary ? `\n    ${r.summary}` : '') +
            (r.source_url ? `\n    source: ${r.source_url}` : ''));
        }
        console.log(`\n${rows.length} target(s). These are general industry knowledge, not facts about your project.`);
      } finally { db.close(); }
    });
}
