import type { Command } from 'commander';
import { resolve } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadConfig } from '../config.js';
import { openKnowledgeDb } from '../db/connection.js';
import { AgentRuntime } from '../agents/runtime.js';
import { ALL_AGENTS, getAgent } from '../agents/index.js';

export function registerAgents(program: Command): void {
  const cmd = program.command('agents').description('Agent operations');

  cmd
    .command('list')
    .description('List registered agents')
    .action(() => {
      for (const a of ALL_AGENTS) {
        console.log(`  ${a.name.padEnd(20)} v${a.promptVersion}`);
      }
    });

  cmd
    .command('eval')
    .description('Run golden tests for all agents')
    .argument('[path]', 'Project root path', '.')
    .option('--agent <name>', 'Limit to one agent')
    .action(async (path: string, opts: { agent?: string }) => {
      const root = resolve(path);
      const cfg = loadConfig(root);
      const db = openKnowledgeDb(root);
      const rt = new AgentRuntime({ knowledgeDb: db, config: cfg });
      try {
        const targets = opts.agent
          ? ALL_AGENTS.filter((a) => a.name === opts.agent)
          : ALL_AGENTS;
        let pass = 0, fail = 0;
        for (const agent of targets) {
          const fixturesDir = join(__dirname, '..', '..', '__tests__', 'agents', agent.name);
          if (!existsSync(fixturesDir)) {
            console.log(`  ${agent.name}: no golden set`);
            continue;
          }
          const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith('.input.json'));
          for (const f of fixtures) {
            const name = f.replace('.input.json', '');
            const input = JSON.parse(readFileSync(join(fixturesDir, f), 'utf8'));
            try {
              const out = await rt.run(agent as any, input);
              console.log(`  PASS  ${agent.name}/${name}  (cached=${out.cached})`);
              pass++;
            } catch (e) {
              console.log(`  FAIL  ${agent.name}/${name}: ${(e as Error).message}`);
              fail++;
            }
          }
        }
        console.log(`\n${pass} passed, ${fail} failed`);
        if (fail > 0) process.exit(1);
      } finally {
        db.close();
      }
    });

  cmd
    .command('run <name>')
    .description('Run a single agent over pending input (debug)')
    .argument('[path]', 'Project root path', '.')
    .action(async (name: string, path: string) => {
      const root = resolve(path);
      const cfg = loadConfig(root);
      const db = openKnowledgeDb(root);
      const rt = new AgentRuntime({ knowledgeDb: db, config: cfg });
      try {
        const agent = getAgent(name);
        if (!agent) {
          console.error(`Unknown agent: ${name}`);
          process.exit(1);
        }
        const { runPendingFor } = await import('../pipeline/orchestrator.js');
        const n = await runPendingFor(root, rt, agent);
        console.log(`Ran ${agent.name} on ${n} pending inputs`);
      } finally {
        db.close();
      }
    });
}
