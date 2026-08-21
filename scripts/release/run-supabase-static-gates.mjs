import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const releaseDir = dirname(fileURLToPath(import.meta.url));
const powerShell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const result = spawnSync(powerShell, [
  '-NoProfile',
  '-File',
  join(releaseDir, 'run-supabase-staging-gates.ps1'),
  '-Mode',
  'Static',
], {
  cwd: join(releaseDir, '..', '..'),
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(`[supabase-gates] unable to start ${powerShell}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
