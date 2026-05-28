import type { Command } from 'commander';
import { resolve } from 'path';
import { syncProject } from '../code/sync.js';

export function registerSync(program: Command): void {
  program
    .command('sync')
    .description('Re-index code structure (L0)')
    .argument('[path]', 'Project root path', '.')
    .option('--full', 'Force full re-index (ignore file content hashes)', false)
    .action(async (path: string, opts: { full: boolean }) => {
      const root = resolve(path);
      const stats = await syncProject(root, { full: opts.full });
      console.log(
        `L0 sync complete: ${stats.filesIndexed} files, ${stats.nodes} nodes, ${stats.edges} edges` +
          (stats.errors ? `, ${stats.errors} errors` : ''),
      );
    });
}
