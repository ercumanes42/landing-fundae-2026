import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const releaseDir = dirname(fileURLToPath(import.meta.url));
const root = join(releaseDir, '..', '..');
const sqlRoot = join(root, 'data-brain', 'supabase');
const sqlFiles = [
  'FUNDAE_RELEASE_PRECHECK_20260819.sql',
  'FUNDAE_RELEASE_POSTCHECK_20260819.sql',
  'FUNDAE_RELEASE_BEHAVIOR_SMOKE_20260819.sql',
  'FUNDAE_RELEASE_FORWARD_ROLLBACK_20260819.sql',
  'FUNDAE_RELEASE_POST_ROLLBACK_20260819.sql',
];
const noopMigrationName = '20260819072840_cold_campaign_scheduler.sql';
const noopMigrationPath = join(sqlRoot, 'migrations', noopMigrationName);
const noopMigrationDecisionId = 'FUNDAE-ADR-20260819-COLD-SCHEDULER-SUPERSEDED';
const noopMigrationSha256 = 'e5588fcaebd98e3d917cba8cfa2de557b908021b3171c5dea48d5b27f14e0f67';
const noopMigrationNormalized = [
  `-- EMPTY_MIGRATION_DECISION_ID: ${noopMigrationDecisionId}`,
  '-- PURPOSE: Preserve the immutable migration timestamp without duplicating schema changes.',
  '-- SUPERSEDED_BY: 20260819170000_cold_campaign_scheduler.sql',
  '-- SAFETY: This statement is deterministic, read-only and returns no rows.',
  'select 1',
  'where false;',
  '',
].join('\n');
const migrationFiles = [
  '20260818083632_graph_outbox_foundation.sql', noopMigrationName,
  '20260819120000_dashboard_aggregates_rbac.sql', '20260819143000_inbound_reliability.sql',
  '20260819155300_cold_campaign_hmac_identity.sql',
  '20260819170000_cold_campaign_scheduler.sql', '20260819183000_operational_observability.sql',
  '20260819190000_journey_retention_control.sql', '20260819200000_cold_campaign_provisioning.sql',
  '20260819210000_release_safety_barriers.sql', '20260819220000_advisor_index_hardening.sql',
];

function runStaticFixture(noopContent) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'fundae-supabase-gates-'));
  const fixtureReleaseDir = join(fixtureRoot, 'scripts', 'release');
  const fixtureSqlRoot = join(fixtureRoot, 'data-brain', 'supabase');
  const fixtureMigrationRoot = join(fixtureSqlRoot, 'migrations');
  mkdirSync(fixtureReleaseDir, { recursive: true });
  mkdirSync(fixtureMigrationRoot, { recursive: true });
  cpSync(join(releaseDir, 'run-supabase-staging-gates.ps1'), join(fixtureReleaseDir, 'run-supabase-staging-gates.ps1'));
  for (const file of sqlFiles) cpSync(join(sqlRoot, file), join(fixtureSqlRoot, file));
  for (const file of migrationFiles) cpSync(join(sqlRoot, 'migrations', file), join(fixtureMigrationRoot, file));
  writeFileSync(join(fixtureMigrationRoot, noopMigrationName), noopContent, 'utf8');
  try {
    return spawnSync('powershell.exe', [
      '-NoProfile', '-File', join(fixtureReleaseDir, 'run-supabase-staging-gates.ps1'), '-Mode', 'Static',
    ], { cwd: fixtureRoot, encoding: 'utf8', windowsHide: true });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test('the superseded timestamp is one exact audited no-op, never an arbitrary non-empty migration', () => {
  const bytes = readFileSync(noopMigrationPath);
  const sql = bytes.toString('utf8');
  assert.ok(bytes.length > 0, `${noopMigrationName} must not be empty`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), noopMigrationSha256);
  assert.equal(sql.replaceAll('\r\n', '\n'), noopMigrationNormalized);
  assert.equal(sql.match(/^-- EMPTY_MIGRATION_DECISION_ID: .+$/gm)?.length, 1);
  assert.match(sql, /^-- SUPERSEDED_BY: 20260819170000_cold_campaign_scheduler\.sql\r?$/m);
  assert.match(sql, /select 1\r?\nwhere false;/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|call|execute)\b/i);
  const attributes = readFileSync(join(root, '.gitattributes'), 'utf8');
  assert.match(attributes, /^\/data-brain\/supabase\/migrations\/20260819072840_cold_campaign_scheduler\.sql text eol=lf$/m);
});

test('the consolidated SQL gate pack is bounded and explicit', () => {
  for (const file of sqlFiles) {
    const path = join(sqlRoot, file);
    assert.ok(statSync(path).size > 0, `${file} must not be empty`);
    const sql = readFileSync(path, 'utf8');
    assert.match(sql, /set local lock_timeout = '10s'/i);
    assert.match(sql, /set local statement_timeout/i);
    assert.match(sql, /fundae_release_/i);
  }
  assert.match(readFileSync(join(sqlRoot, sqlFiles[0]), 'utf8'), /partial_or_already_applied/);
  assert.match(readFileSync(join(sqlRoot, sqlFiles[1]), 'utf8'), /relforcerowsecurity/);
  const behaviorSmoke = readFileSync(join(sqlRoot, sqlFiles[2]), 'utf8');
  assert.match(behaviorSmoke, /rollback;\s*$/i);
  assert.doesNotMatch(behaviorSmoke, /master_enabled\s*=\s*true/i);
  assert.doesNotMatch(behaviorSmoke, /purge_enabled\s*=\s*true/i);
  assert.match(
    behaviorSmoke,
    /jsonb_build_object\(\s*'row_sha256',\s*pg_catalog\.repeat\('6',64\)/i,
  );
  assert.doesNotMatch(behaviorSmoke, /'FUNDAE_STAGING_SMOKE',\s*'\[\]'::jsonb/i);
  assert.match(readFileSync(join(sqlRoot, sqlFiles[3]), 'utf8'), /Preserves rows and evidence/i);
  assert.doesNotMatch(readFileSync(join(sqlRoot, sqlFiles[3]), 'utf8'), /\bdelete\s+from\b/i);
  assert.doesNotMatch(readFileSync(join(sqlRoot, sqlFiles[3]), 'utf8'), /\bdrop\s+(table|schema)\b/i);
});

test('the PowerShell runner is fail-closed and never embeds credentials', () => {
  const runner = readFileSync(join(releaseDir, 'run-supabase-staging-gates.ps1'), 'utf8');
  for (const marker of ['NOOP_MIGRATION_EMPTY', 'NOOP_MIGRATION_INTEGRITY_MISMATCH',
    'NOOP_MIGRATION_DECISION_MISMATCH', 'NOOP_MIGRATION_SUCCESSOR_MISMATCH',
    'NOOP_MIGRATION_DECISION_VERIFIED', noopMigrationDecisionId, noopMigrationSha256,
    'I_AUTHORIZE_STAGING_SQL_GATES', 'STAGING_HOST_FINGERPRINT_MISMATCH',
    'PGSSLMODE_MUST_REQUIRE_TLS', 'ON_ERROR_STOP=1', 'PGOPTIONS', 'Get-FileSha256']) {
    assert.match(runner, new RegExp(marker));
  }
  assert.match(runner, /'-X'/);
  assert.doesNotMatch(runner, /PGPASSWORD\s*=/i);
  assert.doesNotMatch(runner, /postgres(?:ql)?:\/\//i);
  for (const migration of migrationFiles) assert.match(runner, new RegExp(migration.replaceAll('.', '\\.'), 'u'));
});

test('the runner rejects both an empty file and arbitrary non-empty SQL with the decision marker', () => {
  const empty = runStaticFixture('');
  const emptyOutput = `${empty.stdout ?? ''}\n${empty.stderr ?? ''}\n${empty.error?.message ?? ''}`;
  assert.notEqual(empty.status, 0, emptyOutput);
  assert.match(emptyOutput, /NOOP_MIGRATION_EMPTY/);

  const arbitrary = runStaticFixture([
    `-- EMPTY_MIGRATION_DECISION_ID: ${noopMigrationDecisionId}`,
    '-- SUPERSEDED_BY: 20260819170000_cold_campaign_scheduler.sql',
    'select now();',
    '',
  ].join('\r\n'));
  const arbitraryOutput = `${arbitrary.stdout ?? ''}\n${arbitrary.stderr ?? ''}\n${arbitrary.error?.message ?? ''}`;
  assert.notEqual(arbitrary.status, 0, arbitraryOutput);
  assert.match(arbitraryOutput, /NOOP_MIGRATION_INTEGRITY_MISMATCH/);
});

test('the npm static entrypoint verifies the exact no-op and all static inputs', () => {
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd run release:supabase:gates:static']
    : ['run', 'release:supabase:gates:static'];
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /NOOP_MIGRATION_DECISION_VERIFIED/);
  assert.match(output, /FUNDAE_SUPABASE_GATE_PACK_STATIC_OK/);
  assert.doesNotMatch(output, /NOOP_MIGRATION_(?:EMPTY|INTEGRITY_MISMATCH|DECISION_MISMATCH|SUCCESSOR_MISMATCH)/);
  assert.doesNotMatch(output, /Get-FileHash/);
  assert.doesNotMatch(output, /CommandNotFoundException/);
});
