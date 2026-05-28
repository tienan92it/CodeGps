import type { Command } from 'commander';
import { resolve } from 'path';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Run the MCP server (code + knowledge tools)')
    .argument('[path]', 'Project root path', '.')
    .option('--mcp', 'Run MCP transport (stdio)', false)
    .action(async (path: string, opts: { mcp: boolean }) => {
      const root = resolve(path);
      if (!opts.mcp) {
        console.error('Only --mcp transport is supported right now. Re-run with --mcp.');
        process.exit(1);
      }
      const { startMcpServer } = await import('../mcp/server.js');
      await startMcpServer(root);
    });
}
