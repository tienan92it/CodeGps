import type { Command } from 'commander';
import { resolve } from 'path';

export function registerCanvas(program: Command): void {
  program
    .command('canvas <kind>')
    .description('Generate a .canvas.tsx file from current data')
    .argument('[path]', 'Project root path', '.')
    .action(async (kind: string, path: string) => {
      const root = resolve(path);
      const { generateCanvas } = await import('../canvas/generate.js');
      const out = await generateCanvas(root, kind);
      console.log(`Canvas written: ${out}`);
    });
}
