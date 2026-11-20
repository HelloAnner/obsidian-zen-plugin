import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const temporary = await mkdtemp(join(tmpdir(), 'zen-note-switcher-test-'));
try {
  const outfile = join(temporary, 'note-switcher-store.test.cjs');
  const positionsOutfile = join(temporary, 'note-positions.test.cjs');
  for (const [entry, output] of [
    ['note-switcher-store', outfile], ['note-positions', positionsOutfile],
  ]) {
    await build({
      entryPoints: [fileURLToPath(new URL(`../tests/${entry}.test.ts`, import.meta.url))],
      bundle: true, platform: 'node', target: 'node18', format: 'cjs', outfile: output,
    });
  }
  const result = spawnSync(process.execPath, ['--test', outfile, positionsOutfile], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
