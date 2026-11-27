import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const temporary = await mkdtemp(join(tmpdir(), 'zen-test-'));
try {
  const tests = ['note-switcher-store', 'markdown-to-confluence'];
  await build({
    entryPoints: tests.map(name => fileURLToPath(new URL(`../tests/${name}.test.ts`, import.meta.url))),
    bundle: true, platform: 'node', target: 'node18', format: 'cjs', outdir: temporary, outExtension: { '.js': '.cjs' },
  });
  const result = spawnSync(process.execPath, ['--test', ...tests.map(name => join(temporary, `${name}.test.cjs`))], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
