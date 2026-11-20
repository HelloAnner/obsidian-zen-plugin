import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const temporary = await mkdtemp(join(tmpdir(), 'zen-note-switcher-test-'));
try {
  const outfile = join(temporary, 'note-switcher-store.test.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../tests/note-switcher-store.test.ts', import.meta.url))],
    bundle: true, platform: 'node', target: 'node18', format: 'cjs', outfile,
  });
  const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
