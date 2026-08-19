import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const CORE_ROOTS = [
  '.github/workflows',
  'scripts/release',
  'docs/fundae-release',
  'src',
  'tests',
  'public',
  'automation/make',
  'automation/campaign-reports',
  'automation/scripts',
  'data-brain/scripts',
  'data-brain/src',
  'data-brain/supabase',
];

const CORE_ROOT_FILES = [
  '.env.example',
  '.gitattributes',
  '.gitignore',
  '.node-version',
  '.vercelignore',
  'automation/ARCHITECTURE.md',
  'automation/CAMPAIGN_OPERATIONS_2026.md',
  'automation/MAKE_PRODUCTION_CHECKLIST.md',
  'automation/MAKE_SETUP.md',
  'automation/MAKE_TRANSACTIONAL_AUTOMATION_GUIDE.md',
  'automation/README.md',
  'automation/UNSUBSCRIBE_SETUP.md',
  'cold_emails_copies.md',
  'index.html',
  'MEMORIA.md',
  'package-lock.json',
  'package.json',
  'playwright.config.cjs',
  'tsconfig.json',
  'vercel.json',
  'vite.config.ts',
  'data-brain/.env.example',
  'data-brain/.gitignore',
  'data-brain/.vercelignore',
  'data-brain/DASHBOARD_MASTER_SPEC.md',
  'data-brain/docs/HUBSPOT_IDEMPOTENCY_CONTRACT.md',
  'data-brain/next-env.d.ts',
  'data-brain/next.config.ts',
  'data-brain/package-lock.json',
  'data-brain/package.json',
  'data-brain/README.md',
  'data-brain/tsconfig.json',
];

const REQUIRED_CORE_PATHS = [
  '.gitattributes',
  '.github/workflows/release-gates.yml',
  '.env.example',
  '.node-version',
  'package-lock.json',
  'package.json',
  'scripts/release/baseline-manifest.mjs',
  'scripts/release/clean.mjs',
  'scripts/release/plan-release-candidate.mjs',
  'scripts/release/release-candidate-plan.test.mjs',
  'scripts/release/verify-ci-pins.mjs',
  'scripts/release/verify-manifest.mjs',
  'scripts/release/verify-release.mjs',
  'docs/fundae-release/BASELINE_MANIFEST.md',
  'docs/fundae-release/EVIDENCE_INDEX.md',
  'docs/fundae-release/GATE_MATRIX.md',
  'MEMORIA.md',
  'automation/campaign-reports/FUNDAE_2026_CONTROLLED_COPY_REPORT.json',
  'data-brain/package-lock.json',
  'data-brain/package.json',
  'data-brain/.env.example',
  'data-brain/docs/HUBSPOT_IDEMPOTENCY_CONTRACT.md',
  'data-brain/scripts/production-readiness.test.ts',
  'data-brain/scripts/production-readiness.ts',
  'data-brain/src/app/api/internal/graph/transactional/route.ts',
  'data-brain/src/lib/graph-outbox-repository.ts',
  'data-brain/src/lib/graph-runtime.ts',
  'data-brain/src/lib/graph-secure-client.ts',
  'data-brain/src/lib/graph-worker.ts',
  'data-brain/supabase/GRAPH_OUTBOX_FORWARD_ROLLBACK_20260818.sql',
  'data-brain/supabase/GRAPH_OUTBOX_POSTCHECK_20260818.sql',
  'data-brain/supabase/GRAPH_OUTBOX_PRECHECK_20260818.sql',
  'data-brain/supabase/migrations/20260818083632_graph_outbox_foundation.sql',
];

const EXCLUDED_DIRECTORY_NAMES = new Set([
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

const EXCLUDED_FILE_PATTERNS = [
  /(^|\/)\.env(?:\..+)?$/,
  /\.dump$/i,
  /\.log$/i,
  /\.sql\.gz$/i,
  /\.tsbuildinfo$/i,
  /\.xlsx$/i,
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
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

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

function resolveInsideRepository(relativePath) {
  const absolutePath = path.resolve(repositoryRoot, relativePath);
  const safeRelativePath = path.relative(repositoryRoot, absolutePath);
  if (!safeRelativePath || safeRelativePath.startsWith('..') || path.isAbsolute(safeRelativePath)) {
    throw new Error(`Path escapes repository: ${relativePath}`);
  }
  return absolutePath;
}

function isExcluded(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const segments = normalized.split('/');
  const isExampleEnvironment = /(^|\/)\.env\.example$/i.test(normalized);
  return segments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))
    || (!isExampleEnvironment && EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(normalized)));
}

function walkFiles(relativeRoot, collected) {
  if (isExcluded(relativeRoot)) return;
  const absoluteRoot = resolveInsideRepository(relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return;
  const stat = fs.lstatSync(absoluteRoot);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link in release core: ${relativeRoot}`);
  if (stat.isFile()) {
    collected.add(normalizeRelativePath(relativeRoot));
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    walkFiles(path.join(relativeRoot, entry.name), collected);
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function fileRecord(relativePath, extra = {}) {
  const absolutePath = resolveInsideRepository(relativePath);
  if (!fs.existsSync(absolutePath)) return { path: relativePath, present: false, ...extra };
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Release input must be a regular file: ${relativePath}`);
  }
  const content = fs.readFileSync(absolutePath);
  return {
    path: relativePath,
    present: true,
    bytes: content.byteLength,
    sha256: sha256(content),
    ...extra,
  };
}

const trackedPaths = run('git', ['ls-files', '-z'], { encoding: 'buffer' })
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .map(normalizeRelativePath)
  .sort((left, right) => left.localeCompare(right, 'en'));
const trackedSet = new Set(trackedPaths);

const untrackedSet = new Set(
  run('git', ['ls-files', '-z', '--others', '--exclude-standard'], { encoding: 'buffer' })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(normalizeRelativePath),
);

const trackedFiles = trackedPaths.map((relativePath) => fileRecord(relativePath));

const corePathSet = new Set();
for (const relativeRoot of CORE_ROOTS) walkFiles(relativeRoot, corePathSet);
for (const relativePath of CORE_ROOT_FILES) walkFiles(relativePath, corePathSet);
const corePaths = [...corePathSet].sort((left, right) => left.localeCompare(right, 'en'));

const missingRequiredCorePaths = REQUIRED_CORE_PATHS.filter(
  (relativePath) => !corePathSet.has(relativePath) || !fs.existsSync(resolveInsideRepository(relativePath)),
);
if (missingRequiredCorePaths.length > 0) {
  throw new Error(`Missing required release core paths: ${missingRequiredCorePaths.join(', ')}`);
}

const coreFiles = corePaths.map((relativePath) => fileRecord(relativePath, {
  gitState: trackedSet.has(relativePath)
    ? 'tracked'
    : untrackedSet.has(relativePath)
      ? 'untracked'
      : 'ignored-or-outside-index',
}));
const criticalUntrackedCoreFiles = coreFiles
  .filter((entry) => entry.gitState !== 'tracked')
  .map((entry) => entry.path);

const statusLines = run('git', ['status', '--short', '--untracked-files=all'])
  .split(/\r?\n/)
  .filter(Boolean);
const statusCounts = {};
for (const line of statusLines) {
  const code = line.slice(0, 2);
  statusCounts[code] = (statusCounts[code] || 0) + 1;
}

function readNpmVersion() {
  if (process.env.npm_execpath) return run(process.execPath, [process.env.npm_execpath, '--version']).trim();
  if (process.platform === 'win32') {
    return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd --version']).trim();
  }
  return run('npm', ['--version']).trim();
}

const trackedFilesDigest = sha256(Buffer.from(JSON.stringify(trackedFiles), 'utf8'));
const coreFilesDigest = sha256(Buffer.from(JSON.stringify(coreFiles), 'utf8'));
const manifest = {
  schemaVersion: 2,
  scope: 'tracked-files-plus-allowlisted-release-core',
  repository: {
    head: run('git', ['rev-parse', 'HEAD']).trim(),
    branch: run('git', ['branch', '--show-current']).trim() || null,
    statusEntryCount: statusLines.length,
    statusCounts,
  },
  toolchain: {
    node: process.version,
    npm: readNpmVersion(),
    platform: process.platform,
    architecture: process.arch,
  },
  policy: {
    coreRoots: CORE_ROOTS,
    coreRootFiles: CORE_ROOT_FILES,
    excludedDirectoryNames: [...EXCLUDED_DIRECTORY_NAMES].sort(),
    excludedSensitivePatterns: EXCLUDED_FILE_PATTERNS.map((pattern) => pattern.source),
    untrackedCorePolicy: 'hash-and-report; CI must reject until every core file is tracked',
  },
  trackedFiles,
  trackedFilesDigest,
  coreFiles,
  coreFilesDigest,
  criticalUntrackedCoreFiles,
  coreAllTracked: criticalUntrackedCoreFiles.length === 0,
  releaseInputsDigest: sha256(Buffer.from(JSON.stringify({ trackedFilesDigest, coreFilesDigest }), 'utf8')),
};

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
