import type { Command } from 'commander';
import { resolve } from 'path';
import { ingestProject } from '../ingest/orchestrator.js';

export function registerIngest(program: Command): void {
  program
    .command('ingest')
    .description('Ingest conversation data (L1) and run agent pipeline (L1.5→L3)')
    .argument('[path]', 'Project root path', '.')
    .option('--agent <id>', 'Limit to one agent: cursor | claude-code | codex | copilot')
    .option('--no-triage', 'Skip Triage Agent (debug)')
    .option('--no-extract', 'Skip extractor agents (debug)')
    .action(async (path: string, opts: { agent?: string; triage?: boolean; extract?: boolean }) => {
      const root = resolve(path);
      const stats = await ingestProject(root, {
        agentFilter: opts.agent as any,
        runTriage: opts.triage !== false,
        runExtract: opts.extract !== false,
      });
      console.log(`Ingest complete:`);
      console.log(`  Sessions seen:    ${stats.sessionsSeen} (new: ${stats.sessionsNew})`);
      console.log(`  Turns ingested:   ${stats.turnsIngested}`);
      console.log(`  Windows created:  ${stats.windowsCreated}`);
      console.log(`  Triaged:          ${stats.triaged} (kept ${stats.kept}, dropped ${stats.dropped})`);
      console.log(`  Facts produced:   ${stats.factsProduced}`);
      console.log(`  Concepts:         ${stats.conceptsCreated} created, ${stats.conceptsAttached} attached`);
    });
}
