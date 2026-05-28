import type { Command } from 'commander';
import { resolve } from 'path';
import { loadConfig } from '../config.js';
import { openKnowledgeDb } from '../db/connection.js';
import { runVerify, invalidateStaleTriageCache } from '../pipeline/verify.js';

export function registerVerify(program: Command): void {
  program
    .command('verify')
    .description('Run the Verifier sweep: prune low-confidence, detect contradictions, refresh stale triage')
    .argument('[path]', 'Project root path', '.')
    .option('--prune-below <n>', 'Min confidence; facts below get pruned', '0.25')
    .option('--max-pairs <n>', 'Max pairwise checks per cluster', '5')
    .option('--invalidate-triage-days <n>', 'Invalidate triage cache older than N days', '0')
    .action(async (path: string, opts: {
      pruneBelow: string; maxPairs: string; invalidateTriageDays: string;
    }) => {
      const root = resolve(path);
      const cfg = loadConfig(root);
      const db = openKnowledgeDb(root);
      try {
        const days = parseInt(opts.invalidateTriageDays, 10);
        if (days > 0) {
          const n = invalidateStaleTriageCache(db, days);
          console.log(`Invalidated ${n} stale triage runs (> ${days} days).`);
        }
        const stats = await runVerify(db, cfg, {
          pruneBelowConfidence: parseFloat(opts.pruneBelow),
          maxPairsPerCluster: parseInt(opts.maxPairs, 10),
        });
        console.log(`Verify complete:`);
        console.log(`  Pruned (low confidence):  ${stats.pruned}`);
        console.log(`  Pairs checked:            ${stats.pairsChecked}`);
        console.log(`  Contradictions:           ${stats.contradictionsFound}`);
        console.log(`  Supersessions:            ${stats.supersessionsFound}`);
      } finally {
        db.close();
      }
    });
}
