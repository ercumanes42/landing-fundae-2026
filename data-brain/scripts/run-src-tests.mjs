import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_ROOT = join(PROJECT_ROOT, 'src');

export function discoverSourceTests(directory = SOURCE_ROOT) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...discoverSourceTests(absolute));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(absolute);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tests = discoverSourceTests();
  if (tests.length === 0) throw new Error('No src tests discovered');
  const tsxCli = join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const result = spawnSync(process.execPath, [tsxCli, '--test', ...tests], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
