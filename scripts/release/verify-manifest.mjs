import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const requireTrackedCore = process.argv.includes('--require-tracked-core');
const result = spawnSync(process.execPath, ['scripts/release/baseline-manifest.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  windowsHide: true,
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'Manifest generation failed.\n');
  process.exit(result.status ?? 1);
}

let manifest;
try {
  manifest = JSON.parse(result.stdout);
} catch {
  console.error('[manifest] output is not valid JSON');
  process.exit(1);
}

const failures = [];
if (manifest.schemaVersion !== 2) failures.push('schemaVersion must be 2');
if (!Array.isArray(manifest.trackedFiles) || manifest.trackedFiles.length === 0) failures.push('trackedFiles is empty');
if (!Array.isArray(manifest.coreFiles) || manifest.coreFiles.length === 0) failures.push('coreFiles is empty');
for (const key of ['trackedFilesDigest', 'coreFilesDigest', 'releaseInputsDigest']) {
  if (!/^[a-f0-9]{64}$/.test(manifest[key] || '')) failures.push(`${key} is not a SHA-256 digest`);
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
if (manifest.trackedFilesDigest !== sha256(JSON.stringify(manifest.trackedFiles))) {
  failures.push('trackedFilesDigest does not match trackedFiles');
}
if (manifest.coreFilesDigest !== sha256(JSON.stringify(manifest.coreFiles))) {
  failures.push('coreFilesDigest does not match coreFiles');
}
if (manifest.releaseInputsDigest !== sha256(JSON.stringify({
  trackedFilesDigest: manifest.trackedFilesDigest,
  coreFilesDigest: manifest.coreFilesDigest,
}))) {
  failures.push('releaseInputsDigest does not match component digests');
}
const forbidden = (manifest.coreFiles || []).filter((entry) =>
  /(^|\/)\.env(?:\..+)?$|\.dump$|\.sql\.gz$|\.xlsx$/i.test(entry.path)
  && !/(^|\/)\.env\.example$/i.test(entry.path),
);
if (forbidden.length > 0) failures.push(`sensitive/private paths included: ${forbidden.map((entry) => entry.path).join(', ')}`);
if (requireTrackedCore && !manifest.coreAllTracked) {
  failures.push(`core contains ${manifest.criticalUntrackedCoreFiles.length} untracked/ignored files`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[manifest] FAIL: ${failure}`);
  process.exit(1);
}

console.log(`[manifest] PASS schema=${manifest.schemaVersion} tracked=${manifest.trackedFiles.length} core=${manifest.coreFiles.length}`);
console.log(`[manifest] releaseInputsDigest=${manifest.releaseInputsDigest}`);
if (!manifest.coreAllTracked) {
  console.log(`[manifest] LOCAL_ONLY: ${manifest.criticalUntrackedCoreFiles.length} core files are not tracked; CI/release packaging remains blocked.`);
}
