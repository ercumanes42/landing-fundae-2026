import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dryRun = process.argv.includes('--dry-run');
const targets = ['dist', 'data-brain/.next'];

function resolveSafeTarget(relativeTarget) {
  const absoluteTarget = path.resolve(repositoryRoot, relativeTarget);
  const relative = path.relative(repositoryRoot, absoluteTarget);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing unsafe clean target: ${relativeTarget}`);
  }
  return absoluteTarget;
}

for (const relativeTarget of targets) {
  const absoluteTarget = resolveSafeTarget(relativeTarget);
  if (!fs.existsSync(absoluteTarget)) {
    console.log(`[clean] absent: ${relativeTarget}`);
    continue;
  }
  if (dryRun) {
    console.log(`[clean] would remove: ${relativeTarget}`);
    continue;
  }
  fs.rmSync(absoluteTarget, { recursive: true, force: false });
  console.log(`[clean] removed: ${relativeTarget}`);
}
