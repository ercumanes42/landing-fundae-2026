import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const FORBIDDEN_DIRECTORY_NAMES = new Set([
  '.codex',
  '.git',
  '.next',
  '.playwright-cli',
  '.pnpm-store',
  '.runtime',
  '.temp',
  '.vercel',
  'build',
  'coverage',
  'data-private',
  'dist',
  'node_modules',
  'output',
  'outputs',
  'test-results',
  'tmp',
]);

export const PUBLIC_BINARY_EXTENSIONS = new Set([
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mp4',
  '.pdf',
  '.png',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.graphql',
  '.html',
  '.ini',
  '.js',
  '.json',
  '.jsx',
  '.lock',
  '.md',
  '.mjs',
  '.ps1',
  '.py',
  '.scss',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const TEXT_BASENAMES = new Set([
  '.env.example',
  '.gitattributes',
  '.gitignore',
  '.node-version',
  '.vercelignore',
]);

const FORBIDDEN_FILE_PATTERNS = [
  { reason: 'environment-secret', pattern: /(^|\/)\.env(?:\..+)?$/i, except: /(^|\/)\.env\.example$/i },
  { reason: 'private-workbook', pattern: /\.xlsx$/i },
  { reason: 'database-dump', pattern: /(?:\.dump|\.sql\.gz)$/i },
  { reason: 'runtime-log', pattern: /\.log$/i },
  { reason: 'private-key-material', pattern: /\.(?:key|p12|pfx|pem)$/i },
  { reason: 'compiler-output', pattern: /\.tsbuildinfo$/i },
];

const comparePaths = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const jsonDigest = (value) => sha256(Buffer.from(JSON.stringify(value), 'utf8'));

export function normalizeRepositoryPath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '');
}

function resolveInsideRepository(root, relativePath) {
  const normalized = normalizeRepositoryPath(relativePath);
  const absolutePath = path.resolve(root, normalized);
  const safeRelativePath = path.relative(root, absolutePath);
  if (!safeRelativePath || safeRelativePath.startsWith('..') || path.isAbsolute(safeRelativePath)) {
    throw new Error(`Path escapes repository: ${relativePath}`);
  }
  return absolutePath;
}

export function forbiddenPathReason(relativePath) {
  const normalized = normalizeRepositoryPath(relativePath);
  const segments = normalized.split('/');
  const forbiddenDirectory = segments.find((segment) => FORBIDDEN_DIRECTORY_NAMES.has(segment));
  if (forbiddenDirectory) return `forbidden-directory:${forbiddenDirectory}`;
  for (const rule of FORBIDDEN_FILE_PATTERNS) {
    if (rule.pattern.test(normalized) && !(rule.except && rule.except.test(normalized))) return rule.reason;
  }
  return null;
}

export function classifyReleaseFile(relativePath) {
  const normalized = normalizeRepositoryPath(relativePath);
  const basename = path.posix.basename(normalized).toLowerCase();
  const extension = path.posix.extname(normalized).toLowerCase();
  if (TEXT_BASENAMES.has(basename) || TEXT_EXTENSIONS.has(extension)) return { kind: 'text', reason: null };
  if (PUBLIC_BINARY_EXTENSIONS.has(extension)) {
    return normalized.startsWith('public/')
      ? { kind: 'binary', reason: null }
      : { kind: 'binary', reason: 'binary-outside-public' };
  }
  return { kind: 'unknown', reason: 'unapproved-file-type' };
}

export function parsePorcelainV1Z(bufferOrString) {
  const fields = Buffer.isBuffer(bufferOrString)
    ? bufferOrString.toString('utf8').split('\0')
    : String(bufferOrString).split('\0');
  const entries = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) continue;
    if (field.length < 4 || field[2] !== ' ') throw new Error('Invalid git porcelain v1 -z record');
    const code = field.slice(0, 2);
    const repositoryPath = normalizeRepositoryPath(field.slice(3));
    const isRenameOrCopy = /[RC]/.test(code);
    const originalPath = isRenameOrCopy ? normalizeRepositoryPath(fields[++index] || '') : null;
    const classification = code === '??'
      ? 'untracked'
      : code.includes('D')
        ? 'deleted'
        : code.includes('M')
          ? 'modified'
          : 'other';
    entries.push({ path: repositoryPath, code, classification, ...(originalPath ? { originalPath } : {}) });
  }
  return entries.sort((left, right) => comparePaths(left.path, right.path));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: '0',
    },
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function readCurrentManifest() {
  const raw = run(process.execPath, ['scripts/release/baseline-manifest.mjs']);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Baseline manifest output is not valid JSON');
  }
}

function readGitStatus() {
  return parsePorcelainV1Z(run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'buffer' }));
}

function readTrackedBlobOids() {
  const fields = run('git', ['ls-files', '--stage', '-z'], { encoding: 'buffer' }).toString('utf8').split('\0');
  const entries = new Map();
  for (const field of fields) {
    if (!field) continue;
    const match = /^(\d{6}) ([a-f0-9]{40,64}) (\d)\t([\s\S]+)$/.exec(field);
    if (!match || match[3] !== '0') continue;
    entries.set(normalizeRepositoryPath(match[4]), { mode: match[1], oid: match[2], source: 'index' });
  }
  const headFields = run('git', ['ls-tree', '-r', '-z', 'HEAD'], { encoding: 'buffer' }).toString('utf8').split('\0');
  for (const field of headFields) {
    if (!field) continue;
    const match = /^(\d{6}) blob ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(field);
    if (!match) continue;
    const repositoryPath = normalizeRepositoryPath(match[3]);
    if (!entries.has(repositoryPath)) entries.set(repositoryPath, { mode: match[1], oid: match[2], source: 'head' });
  }
  return entries;
}

function inspectRegularFile(root, relativePath) {
  const absolutePath = resolveInsideRepository(root, relativePath);
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
  if (stat.isSymbolicLink()) return { kind: 'symlink' };
  if (!stat.isFile()) return { kind: 'non-regular' };
  const content = fs.readFileSync(absolutePath);
  return { kind: 'file', bytes: content.byteLength, sha256: sha256(content) };
}

function assertManifestIntegrity(manifest) {
  const failures = [];
  if (manifest?.schemaVersion !== 2) failures.push('schemaVersion must be 2');
  if (!Array.isArray(manifest?.trackedFiles)) failures.push('trackedFiles must be an array');
  if (!Array.isArray(manifest?.coreFiles)) failures.push('coreFiles must be an array');
  if (failures.length > 0) throw new Error(`Invalid schema 2 manifest: ${failures.join('; ')}`);
  if (manifest.trackedFilesDigest !== jsonDigest(manifest.trackedFiles)) failures.push('trackedFilesDigest mismatch');
  if (manifest.coreFilesDigest !== jsonDigest(manifest.coreFiles)) failures.push('coreFilesDigest mismatch');
  if (manifest.releaseInputsDigest !== jsonDigest({
    trackedFilesDigest: manifest.trackedFilesDigest,
    coreFilesDigest: manifest.coreFilesDigest,
  })) failures.push('releaseInputsDigest mismatch');
  const corePaths = manifest.coreFiles.map((entry) => entry.path);
  if (new Set(corePaths).size !== corePaths.length) failures.push('duplicate core paths');
  if (failures.length > 0) throw new Error(`Invalid schema 2 manifest: ${failures.join('; ')}`);
}

function isIntendedCorePath(relativePath, policy = {}) {
  const normalized = normalizeRepositoryPath(relativePath);
  const roots = Array.isArray(policy.coreRoots) ? policy.coreRoots.map(normalizeRepositoryPath) : [];
  const rootFiles = new Set(Array.isArray(policy.coreRootFiles) ? policy.coreRootFiles.map(normalizeRepositoryPath) : []);
  return rootFiles.has(normalized) || roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function summarizeStatus(statusEntries) {
  const counts = { modified: 0, deleted: 0, untracked: 0, other: 0 };
  for (const entry of statusEntries) counts[entry.classification] += 1;
  return {
    entryCount: statusEntries.length,
    counts,
    digest: jsonDigest(statusEntries),
  };
}

function rejection(pathValue, code, detail = null) {
  return { path: pathValue, code, ...(detail ? { detail } : {}) };
}

export function buildReleaseCandidatePlan(manifest, statusEntries, options = {}) {
  assertManifestIntegrity(manifest);
  const root = options.repositoryRoot ?? repositoryRoot;
  const verifyFilesystem = options.verifyFilesystem !== false;
  const inspector = options.filesystemInspector ?? ((relativePath) => inspectRegularFile(root, relativePath));
  const normalizedStatus = statusEntries
    .map((entry) => ({ ...entry, path: normalizeRepositoryPath(entry.path) }))
    .sort((left, right) => comparePaths(left.path, right.path));
  const statusByPath = new Map(normalizedStatus.map((entry) => [entry.path, entry]));
  const trackedBlobOids = options.trackedBlobOids ?? options.indexBlobOids ?? new Map();
  const allowlist = [];
  const rejectedInputs = [];

  for (const entry of [...manifest.coreFiles].sort((left, right) => comparePaths(left.path, right.path))) {
    const normalizedPath = normalizeRepositoryPath(entry.path);
    if (normalizedPath !== entry.path || normalizedPath.startsWith('/') || normalizedPath.includes('/../')) {
      rejectedInputs.push(rejection(entry.path, 'NON_CANONICAL_PATH'));
      continue;
    }
    const forbiddenReason = forbiddenPathReason(normalizedPath);
    if (forbiddenReason) {
      rejectedInputs.push(rejection(normalizedPath, 'FORBIDDEN_PATH', forbiddenReason));
      continue;
    }
    if (entry.present !== true) {
      rejectedInputs.push(rejection(normalizedPath, 'MISSING_CORE_INPUT'));
      continue;
    }
    if (!['tracked', 'untracked'].includes(entry.gitState)) {
      rejectedInputs.push(rejection(normalizedPath, 'UNSAFE_GIT_STATE', String(entry.gitState ?? 'missing')));
      continue;
    }
    const filePolicy = classifyReleaseFile(normalizedPath);
    if (filePolicy.reason) {
      rejectedInputs.push(rejection(normalizedPath, 'UNAPPROVED_FILE', filePolicy.reason));
      continue;
    }
    if (verifyFilesystem) {
      const actual = inspector(normalizedPath);
      if (actual.kind !== 'file') {
        rejectedInputs.push(rejection(normalizedPath, actual.kind === 'symlink' ? 'SYMLINK' : 'MISSING_OR_NON_REGULAR', actual.kind));
        continue;
      }
      if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) {
        rejectedInputs.push(rejection(normalizedPath, 'MANIFEST_CONTENT_DRIFT'));
        continue;
      }
    }
    const status = statusByPath.get(normalizedPath);
    const action = entry.gitState === 'untracked' || status?.code.includes('A')
      ? 'add'
      : status?.classification === 'modified' || status?.classification === 'other'
        ? 'modify'
        : 'retain';
    allowlist.push({
      path: normalizedPath,
      gitState: entry.gitState,
      action,
      kind: filePolicy.kind,
      bytes: entry.bytes,
      sha256: entry.sha256,
    });
  }

  const allowlistedPaths = new Set(allowlist.map((entry) => entry.path));
  const allowlistByPath = new Map(allowlist.map((entry) => [entry.path, entry]));
  const changes = { modified: [], deleted: [], untracked: [], other: [] };
  const trackedGeneratedOrPrivateArtifactsToRemove = [];
  const excludedChanges = [];
  for (const status of normalizedStatus) {
    const allowlisted = allowlistedPaths.has(status.path);
    const intendedCore = isIntendedCorePath(status.path, manifest.policy);
    const forbiddenReason = forbiddenPathReason(status.path);
    const isCoreDeletion = status.classification === 'deleted' && intendedCore && !forbiddenReason;
    const isTrackedForbiddenDeletion = status.classification === 'deleted' && Boolean(forbiddenReason);
    if (allowlisted || isCoreDeletion) {
      const coreEntry = allowlistByPath.get(status.path);
      changes[status.classification].push({
        path: status.path,
        code: status.code,
        sha256: coreEntry?.sha256 ?? null,
        ...(status.originalPath ? { originalPath: status.originalPath } : {}),
      });
      continue;
    }
    if (isTrackedForbiddenDeletion) {
      const trackedEntry = trackedBlobOids.get(status.path);
      trackedGeneratedOrPrivateArtifactsToRemove.push({
        path: status.path,
        code: status.code,
        reason: forbiddenReason,
        stageIntent: 'delete-from-repository-only',
        package: false,
        restore: false,
        trackedBlobOid: trackedEntry?.oid ?? null,
        trackedBlobMode: trackedEntry?.mode ?? null,
        trackedBlobSource: trackedEntry?.source ?? null,
      });
      continue;
    }
    excludedChanges.push({
      path: status.path,
      code: status.code,
      classification: status.classification,
      reason: forbiddenReason ?? (intendedCore ? 'not-present-in-core-manifest' : 'outside-core-allowlist'),
    });
  }

  for (const key of Object.keys(changes)) changes[key].sort((left, right) => comparePaths(left.path, right.path));
  trackedGeneratedOrPrivateArtifactsToRemove.sort((left, right) => comparePaths(left.path, right.path));
  excludedChanges.sort((left, right) => comparePaths(left.path, right.path));
  const candidateDigestInput = { allowlist, changes, trackedGeneratedOrPrivateArtifactsToRemove };
  const hasPendingCandidateChanges = Object.values(changes).some((entries) => entries.length > 0)
    || trackedGeneratedOrPrivateArtifactsToRemove.length > 0;
  return {
    schemaVersion: 1,
    mode: 'dry-run',
    sideEffects: 'none',
    sourceManifest: {
      schemaVersion: manifest.schemaVersion,
      head: manifest.repository?.head ?? null,
      branch: manifest.repository?.branch ?? null,
      releaseInputsDigest: manifest.releaseInputsDigest,
    },
    policy: {
      gitOperations: 'read-only with GIT_OPTIONAL_LOCKS=0',
      contentInspection: 'sha256-only; no secret-pattern scan; no content emitted',
      publicBinaryExtensions: [...PUBLIC_BINARY_EXTENSIONS].sort(),
      forbiddenDirectoryNames: [...FORBIDDEN_DIRECTORY_NAMES].sort(),
    },
    repositoryStatus: summarizeStatus(normalizedStatus),
    candidate: {
      safeForOwnerReview: rejectedInputs.length === 0,
      readyForTrackedRelease: rejectedInputs.length === 0 && manifest.coreAllTracked === true && !hasPendingCandidateChanges,
      requiresOwnerGitAuthorization: hasPendingCandidateChanges || manifest.coreAllTracked !== true,
      counts: {
        allowlisted: allowlist.length,
        retained: allowlist.filter((entry) => entry.action === 'retain').length,
        modified: changes.modified.length,
        deleted: changes.deleted.length,
        untracked: changes.untracked.length,
        other: changes.other.length,
        trackedArtifactsToRemove: trackedGeneratedOrPrivateArtifactsToRemove.length,
        excludedChanges: excludedChanges.length,
        rejectedInputs: rejectedInputs.length,
      },
      digest: jsonDigest(candidateDigestInput),
      allowlist,
      changes,
      trackedGeneratedOrPrivateArtifactsToRemove,
    },
    excludedChanges,
    rejectedInputs,
  };
}

function parseArguments(argv) {
  let manifestPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--manifest' && argv[index + 1]) {
      manifestPath = argv[++index];
      continue;
    }
    throw new Error(`Unsupported argument: ${argv[index]}`);
  }
  return { manifestPath };
}

function main() {
  const { manifestPath } = parseArguments(process.argv.slice(2));
  const manifest = manifestPath
    ? JSON.parse(fs.readFileSync(resolveInsideRepository(repositoryRoot, manifestPath), 'utf8'))
    : readCurrentManifest();
  const plan = buildReleaseCandidatePlan(manifest, readGitStatus(), { trackedBlobOids: readTrackedBlobOids() });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (!plan.candidate.safeForOwnerReview) process.exitCode = 2;
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryPoint === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`[release-candidate] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
