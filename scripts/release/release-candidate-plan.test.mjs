import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildReleaseCandidatePlan,
  classifyReleaseFile,
  forbiddenPathReason,
  parsePorcelainV1Z,
} from './plan-release-candidate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const jsonDigest = (value) => sha256(Buffer.from(JSON.stringify(value), 'utf8'));

function manifestFixture(coreFiles, policy = { coreRoots: ['src'], coreRootFiles: ['package.json'] }) {
  const trackedFiles = coreFiles.filter((entry) => entry.gitState === 'tracked');
  const trackedFilesDigest = jsonDigest(trackedFiles);
  const coreFilesDigest = jsonDigest(coreFiles);
  return {
    schemaVersion: 2,
    repository: { head: 'a'.repeat(40), branch: 'fixture' },
    policy,
    trackedFiles,
    trackedFilesDigest,
    coreFiles,
    coreFilesDigest,
    criticalUntrackedCoreFiles: coreFiles.filter((entry) => entry.gitState !== 'tracked').map((entry) => entry.path),
    coreAllTracked: coreFiles.every((entry) => entry.gitState === 'tracked'),
    releaseInputsDigest: jsonDigest({ trackedFilesDigest, coreFilesDigest }),
  };
}

function record(pathValue, gitState = 'tracked') {
  return { path: pathValue, present: true, bytes: 1, sha256: sha256('x'), gitState };
}

function run(command, args, encoding = 'utf8') {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  assert.equal(result.status, 0, String(result.stderr || result.stdout));
  return result.stdout;
}

test('forbidden paths cover private, outputs, local tooling and Supabase temp data', () => {
  for (const pathValue of [
    '.codex/tool.exe',
    'data-private/contacts.xlsx',
    'output/report.pdf',
    'outputs/report.json',
    'test-results/result.json',
    'tmp/cache.txt',
    '.playwright-cli/page.yml',
    'data-brain/supabase/.temp/cli-latest',
    'src/.env.production',
  ]) assert.ok(forbiddenPathReason(pathValue), pathValue);
  assert.equal(forbiddenPathReason('.env.example'), null);
  assert.equal(forbiddenPathReason('data-brain/.env.example'), null);
  for (const pathValue of ['.env', '.env.local', '.env.production', 'data-brain/.env.local']) {
    assert.equal(forbiddenPathReason(pathValue), 'environment-secret');
  }
});

test('binary release inputs are allowed only under public and on the explicit extension list', () => {
  assert.deepEqual(classifyReleaseFile('public/guide.pdf'), { kind: 'binary', reason: null });
  assert.deepEqual(classifyReleaseFile('public/hero.mp4'), { kind: 'binary', reason: null });
  assert.equal(classifyReleaseFile('src/guide.pdf').reason, 'binary-outside-public');
  assert.equal(classifyReleaseFile('public/tool.exe').reason, 'unapproved-file-type');
  assert.deepEqual(classifyReleaseFile('tests/fixtures/secret-shaped-value.ts'), { kind: 'text', reason: null });
});

test('porcelain classifier preserves 80 modified and 33 deleted entries', () => {
  const records = [];
  for (let index = 0; index < 80; index += 1) records.push(` M src/m-${index}.ts\0`);
  for (let index = 0; index < 33; index += 1) records.push(` D legacy/d-${index}.ts\0`);
  records.push('?? src/new.ts\0');
  const parsed = parsePorcelainV1Z(records.join(''));
  assert.equal(parsed.filter((entry) => entry.classification === 'modified').length, 80);
  assert.equal(parsed.filter((entry) => entry.classification === 'deleted').length, 33);
  assert.equal(parsed.filter((entry) => entry.classification === 'untracked').length, 1);
});

test('ignored, missing and symlink core inputs are rejected fail-closed', () => {
  const unsafeStates = manifestFixture([
    record('src/ignored.ts', 'ignored'),
    record('src/missing.ts', 'missing'),
    record('src/link.ts', 'tracked'),
  ]);
  const plan = buildReleaseCandidatePlan(unsafeStates, [], {
    filesystemInspector: (pathValue) => pathValue.endsWith('link.ts')
      ? { kind: 'symlink' }
      : { kind: 'file', bytes: 1, sha256: sha256('x') },
  });
  assert.equal(plan.candidate.safeForOwnerReview, false);
  assert.deepEqual(plan.rejectedInputs.map((entry) => entry.code).sort(), ['SYMLINK', 'UNSAFE_GIT_STATE', 'UNSAFE_GIT_STATE']);
});

test('plan is deterministic, emits hashes instead of content and separates excluded changes', () => {
  const manifest = manifestFixture([record('src/keep.ts'), record('src/new.ts', 'untracked')]);
  const status = [
    { path: 'src/new.ts', code: '??', classification: 'untracked' },
    { path: '.codex/tool.exe', code: '??', classification: 'untracked' },
    { path: 'src/keep.ts', code: ' M', classification: 'modified' },
  ];
  const options = { verifyFilesystem: false };
  const first = buildReleaseCandidatePlan(manifest, status, options);
  const second = buildReleaseCandidatePlan(manifest, [...status].reverse(), options);
  assert.equal(first.candidate.digest, second.candidate.digest);
  assert.equal(first.candidate.counts.modified, 1);
  assert.equal(first.candidate.counts.untracked, 1);
  assert.equal(first.excludedChanges[0].reason, 'forbidden-directory:.codex');
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /fileContent|rawContent|secretValue/);
  assert.match(serialized, /sha256/);
});

test('tracked forbidden deletions are planned only as repository removals', () => {
  const manifest = manifestFixture([record('src/keep.ts')]);
  const pathValue = '.playwright-cli/page.yml';
  const plan = buildReleaseCandidatePlan(manifest, [{ path: pathValue, code: ' D', classification: 'deleted' }], {
    verifyFilesystem: false,
    trackedBlobOids: new Map([[pathValue, { mode: '100644', oid: 'b'.repeat(40), source: 'index' }]]),
  });
  assert.equal(plan.candidate.counts.trackedArtifactsToRemove, 1);
  assert.deepEqual(plan.candidate.trackedGeneratedOrPrivateArtifactsToRemove[0], {
    path: pathValue,
    code: ' D',
    reason: 'forbidden-directory:.playwright-cli',
    stageIntent: 'delete-from-repository-only',
    package: false,
    restore: false,
    trackedBlobOid: 'b'.repeat(40),
    trackedBlobMode: '100644',
    trackedBlobSource: 'index',
  });
  assert.equal(plan.candidate.allowlist.some((entry) => entry.path === pathValue), false);
  assert.equal(plan.excludedChanges.some((entry) => entry.path === pathValue), false);
});

test('live dry-run does not change HEAD, branch, status or index bytes', () => {
  const gitDir = String(run('git', ['rev-parse', '--git-dir'])).trim();
  const indexPath = path.resolve(root, gitDir, 'index');
  const before = {
    head: run('git', ['rev-parse', 'HEAD']),
    branch: run('git', ['branch', '--show-current']),
    status: run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'buffer'),
    indexHash: sha256(fs.readFileSync(indexPath)),
  };
  const output = run(process.execPath, ['scripts/release/plan-release-candidate.mjs']);
  const plan = JSON.parse(output);
  const after = {
    head: run('git', ['rev-parse', 'HEAD']),
    branch: run('git', ['branch', '--show-current']),
    status: run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'buffer'),
    indexHash: sha256(fs.readFileSync(indexPath)),
  };
  assert.equal(after.head, before.head);
  assert.equal(after.branch, before.branch);
  assert.equal(after.indexHash, before.indexHash);
  const beforeEntries = parsePorcelainV1Z(before.status);
  const afterByPath = new Map(parsePorcelainV1Z(after.status).map((entry) => [entry.path, entry.code]));
  assert.equal(beforeEntries.every((entry) => afterByPath.get(entry.path) === entry.code), true);
  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.sideEffects, 'none');
  const allowlistedPaths = new Set(plan.candidate.allowlist.map((entry) => entry.path));
  assert.equal(allowlistedPaths.has('.env.example'), true);
  assert.equal(allowlistedPaths.has('data-brain/.env.example'), true);
  assert.equal(allowlistedPaths.has('MEMORIA.md'), true);
  assert.equal(allowlistedPaths.has('automation/campaign-reports/FUNDAE_2026_CONTROLLED_COPY_REPORT.json'), true);
  assert.equal(allowlistedPaths.has('data-brain/supabase/.temp/cli-latest'), false);
  assert.equal(plan.candidate.counts.trackedArtifactsToRemove, 33);
  assert.equal(plan.candidate.trackedGeneratedOrPrivateArtifactsToRemove.every((entry) =>
    entry.stageIntent === 'delete-from-repository-only'
    && entry.package === false
    && entry.restore === false
    && /^[a-f0-9]{40,64}$/.test(entry.trackedBlobOid)
    && ['index', 'head'].includes(entry.trackedBlobSource)
  ), true);
  assert.equal(plan.repositoryStatus.counts.modified, 80);
  assert.equal(plan.repositoryStatus.counts.deleted, 33);
});

test('planner source contains no Git mutation or filesystem write primitive', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/release/plan-release-candidate.mjs'), 'utf8');
  assert.doesNotMatch(source, /run\('git',\s*\[\s*'(?:add|commit|checkout|reset|clean|switch|restore|branch)'/);
  assert.doesNotMatch(source, /\b(?:writeFileSync|appendFileSync|renameSync|unlinkSync|rmSync)\b/);
});
