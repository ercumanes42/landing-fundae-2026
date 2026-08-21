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
const powerShell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const sqlRoot = join(root, 'data-brain', 'supabase');
const sqlFiles = [
  'FUNDAE_RELEASE_PRECHECK_20260819.sql',
  'FUNDAE_RELEASE_POSTCHECK_20260819.sql',
  'FUNDAE_RELEASE_BEHAVIOR_SMOKE_20260819.sql',
  'TRANSACTIONAL_GRAPH_PILOT_SMOKE_20260819.sql',
  'FUNDAE_RELEASE_FORWARD_ROLLBACK_20260819.sql',
  'FUNDAE_RELEASE_POST_ROLLBACK_20260819.sql',
  'CAMPAIGN_SUPPRESSION_SMOKE_20260819.sql',
  'HUBSPOT_SYNC_OUTBOX_SMOKE_20260820.sql',
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
  '20260819224739_hubspot_sync_outbox.sql',
  '20260819230000_durable_operational_alert_delivery.sql',
  '20260819233000_transactional_graph_pilot_scope.sql',
  '20260819234000_campaign_terminal_suppression_hardening.sql',
  '20260819234100_campaign_contact_suppression_insert_gate.sql',
  '20260819234200_transactional_graph_pilot_authorization_fk_index.sql',
  '20260819234300_transactional_graph_pilot_alert_hardening.sql',
  '20260819234400_campaign_conditional_delivery_hardening.sql',
  '20260821123000_dashboard_campaign_insights.sql',
];

function schemaMigrationMirror(schema, migrationName) {
  const marker = `-- ${migrationName}`;
  const start = schema.lastIndexOf(marker);
  assert.notEqual(start, -1, `missing schema marker ${marker}`);
  const nextMarker = schema.indexOf('\n-- 20', start + marker.length);
  return schema.slice(start + marker.length, nextMarker === -1 ? undefined : nextMarker).trim();
}

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
    return spawnSync(powerShell, [
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
  const pilotSmoke = readFileSync(join(sqlRoot, sqlFiles[3]), 'utf8');
  assert.match(pilotSmoke, /pilot_scope_escape_not_halted/);
  assert.match(pilotSmoke, /pilot_ledger_redaction_failed/);
  assert.match(pilotSmoke, /rollback;\s*$/i);
  assert.match(readFileSync(join(sqlRoot, sqlFiles[4]), 'utf8'), /Preserves rows and evidence/i);
  assert.doesNotMatch(readFileSync(join(sqlRoot, sqlFiles[4]), 'utf8'), /\bdelete\s+from\b/i);
  assert.doesNotMatch(readFileSync(join(sqlRoot, sqlFiles[4]), 'utf8'), /\bdrop\s+(table|schema)\b/i);
  const suppressionSmoke = readFileSync(join(sqlRoot, sqlFiles[6]), 'utf8');
  assert.match(suppressionSmoke, /fundae_release_campaign_suppression_smoke_ok/);
  assert.match(suppressionSmoke, /fundae_release_campaign_provision_v3_smoke_ok/);
  assert.match(suppressionSmoke, /campaign_contact_suppressed/);
  assert.match(suppressionSmoke, /campaign_provision_v2_manifest_was_accepted/);
  assert.match(suppressionSmoke, /campaign_provision_manifest_without_evidence_was_accepted/);
  assert.match(suppressionSmoke, /rollback;\s*$/i);
  assert.doesNotMatch(suppressionSmoke, /master_enabled\s*=\s*true/i);
  assert.doesNotMatch(suppressionSmoke, /enabled\s*=\s*true/i);
  const hubspotSmoke = readFileSync(join(sqlRoot, sqlFiles[7]), 'utf8');
  assert.match(hubspotSmoke, /fundae_release_hubspot_sync_smoke_ok/);
  assert.match(hubspotSmoke, /hubspot_stale_finalize_not_requeued/);
  assert.match(hubspotSmoke, /hubspot_master_dominance_failed/);
  assert.match(hubspotSmoke, /rollback;\s*$/i);
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

test('the transactional Graph pilot SQL is exact-scoped, redacted and mirrored', () => {
  const migrationName = '20260819233000_transactional_graph_pilot_scope.sql';
  const migration = readFileSync(join(sqlRoot, 'migrations', migrationName), 'utf8').replaceAll('\r\n', '\n').trim();
  const schema = readFileSync(join(sqlRoot, 'schema.sql'), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(schemaMigrationMirror(schema, migrationName), migration);
  for (const markerText of [
    'preview_transactional_graph_pilot', 'start_transactional_graph_pilot',
    'finish_transactional_graph_pilot', 'read_transactional_graph_pilot_ledger',
    'transactional_graph_pilot_authorization_grants',
    'register_transactional_graph_pilot_grant',
    'enforce_transactional_graph_pilot_deadline',
    'fundae-transactional-graph-pilot-watchdog',
    'authorization_required',
    'consumed_at is null and revoked_at is null',
    'claim_transactional_graph_dispatch_pre_pilot_20260819',
    'reserve_claimed_transactional_graph_dispatch_pre_pilot_20260819',
    'authorize_graph_draft_send_pre_pilot_20260819',
    'pilot_scope_violation', 'draft_neutralization_required',
    "l.form_type in ('calculator', 'interactive_checklist', 'checklist', 'webinar')",
    'g.sent_items_evidence_hash = d.outcome_evidence_hash',
    'pg_catalog.count(distinct g.graph_draft_immutable_id)',
    "'draft_immutable_id_hash'", "'internet_message_id_hash'", "'evidence_hash'",
  ]) assert.match(migration, new RegExp(markerText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(migration, /pg_catalog\.(?:coalesce|substring)\b/i);
  assert.doesNotMatch(migration, /required_authorization_hash|fundae-transactional-graph-pilot:v1:/i);
  assert.match(migration, /revoke all privileges on table public\.transactional_graph_pilot_runs\s+from public, anon, authenticated, service_role/i);
  assert.match(migration, /revoke all privileges on table\s+fundae_private\.transactional_graph_pilot_authorization_grants\s+from public, anon, authenticated, service_role/i);
  assert.match(migration, /revoke execute on function fundae_private\.register_transactional_graph_pilot_grant\([\s\S]*?service_role/i);
  assert.match(migration, /select cron\.schedule\([\s\S]*?fundae-transactional-graph-pilot-watchdog[\s\S]*?enforce_transactional_graph_pilot_deadline/i);
  assert.match(migration, /grant execute on function public\.read_transactional_graph_pilot_ledger\(text,text\)\s+to service_role/i);
  const ledger = migration.slice(migration.indexOf('create or replace function public.read_transactional_graph_pilot_ledger('), migration.indexOf('alter table public.transactional_graph_pilot_runs enable row level security;'));
  assert.doesNotMatch(ledger, /'submission_id'|'allowed_lead_id'|'graph_draft_immutable_id'\s*,/i);
});

test('terminal campaign suppression hardening is centralized, private and mirrored', () => {
  const migrationName = '20260819234000_campaign_terminal_suppression_hardening.sql';
  const migration = readFileSync(join(sqlRoot, 'migrations', migrationName), 'utf8').replaceAll('\r\n', '\n').trim();
  const schema = readFileSync(join(sqlRoot, 'schema.sql'), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(schemaMigrationMirror(schema, migrationName), migration);
  for (const markerText of [
    'campaign_events_terminal_suppression',
    'campaign_contacts_suppression_gate',
    'enforce_campaign_terminal_suppression',
    'reject_suppressed_campaign_contact',
    "new.event_name not in ('unsubscribe', 'bounce_hard', 'opposition')",
    'insert into public.campaign_suppressions',
    'where email_hash = v_suppression.identity_hash',
    'where identity_hash = new.email_hash',
    'pg_advisory_xact_lock',
    'cold_campaign_v2_state_present',
    'technical_evidence_hash',
    "hash_domain = 'cold-provision-v3'",
    "v_row->>'technical_evidence_sha256'",
    "'cold-provision-v3',v_manifest.logical_dataset_hash",
    'v_manifest.technical_evidence_hash,v_manifest.campaign_external_id',
    'provision_technical_evidence_invalid',
  ]) assert.ok(migration.includes(markerText), `missing suppression contract: ${markerText}`);
  assert.match(migration, /security definer\s+set search_path = ''/gi);
  assert.match(migration, /revoke execute on function fundae_private\.enforce_campaign_terminal_suppression\(\)[\s\S]*?service_role/);
  const v3Apply = migration.slice(
    migration.lastIndexOf('create or replace function public.apply_cold_campaign_provision_batch('),
    migration.lastIndexOf('create or replace function public.finalize_cold_campaign_provision('),
  );
  const v3Finalize = migration.slice(
    migration.lastIndexOf('create or replace function public.finalize_cold_campaign_provision('),
    migration.lastIndexOf('-- Applying the contract never activates outbound or provisioning.'),
  );
  assert.doesNotMatch(v3Apply, /cold-provision-v2/i);
  assert.doesNotMatch(v3Finalize, /cold-provision-v2/i);
  assert.ok(
    v3Apply.indexOf("v_computed_row_hash<>v_row->>'row_sha256'") <
      v3Apply.indexOf("'reason_code','batch_replayed'"),
    'v3 must recompute each row before accepting a replay',
  );
  assert.doesNotMatch(migration, /master_enabled\s*=\s*true|cold_enabled\s*=\s*true|enabled\s*=\s*true/i);
});

test('suppressed campaign identities are rejected on every new contact insert', () => {
  const migrationName = '20260819234100_campaign_contact_suppression_insert_gate.sql';
  const migration = readFileSync(join(sqlRoot, 'migrations', migrationName), 'utf8').replaceAll('\r\n', '\n').trim();
  const schema = readFileSync(join(sqlRoot, 'schema.sql'), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(schemaMigrationMirror(schema, migrationName), migration);
  assert.match(migration, /if tg_op <> 'INSERT' and/i);
  assert.match(migration, /where identity_hash = new\.email_hash/i);
  assert.match(migration, /message = 'campaign_contact_suppressed'/i);
  assert.match(migration, /security definer[\s\S]*?set search_path = ''/i);
  assert.match(migration, /revoke execute[\s\S]*?service_role/i);
});

test('pilot authorization foreign key has an exact covering index', () => {
  const migrationName = '20260819234200_transactional_graph_pilot_authorization_fk_index.sql';
  const migration = readFileSync(join(sqlRoot, 'migrations', migrationName), 'utf8').replaceAll('\r\n', '\n').trim();
  const schema = readFileSync(join(sqlRoot, 'schema.sql'), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(schemaMigrationMirror(schema, migrationName), migration);
  assert.match(migration, /transactional_graph_pilot_authorization_fk_idx/i);
  assert.match(migration, /transactional_graph_pilot_runs \(authorization_hash\)/i);
});

test('pilot watchdog alerts durably and unscoped authorization fails closed', () => {
  const migrationName = '20260819234300_transactional_graph_pilot_alert_hardening.sql';
  const migration = readFileSync(join(sqlRoot, 'migrations', migrationName), 'utf8').replaceAll('\r\n', '\n').trim();
  const schema = readFileSync(join(sqlRoot, 'schema.sql'), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(schemaMigrationMirror(schema, migrationName), migration);
  assert.match(migration, /authorize_graph_draft_send_pre_alert_20260819/i);
  assert.match(migration, /TRANSACTIONAL_GRAPH_PILOT_UNSCOPED_AUTHORIZATION/i);
  assert.match(migration, /enforce_transactional_graph_pilot_deadline_pre_alert_20260819/i);
  assert.match(migration, /perform public\.enqueue_operational_alert_delivery\(/i);
  assert.match(migration, /exception when others then[\s\S]*?v_alert_enqueued := false/i);
  assert.match(migration, /master_enabled = false[\s\S]*?transactional_enabled = false[\s\S]*?cold_enabled = false/i);
  assert.match(migration, /revoke execute[\s\S]*?pre_alert_20260819[\s\S]*?service_role/i);
  assert.doesNotMatch(migration, /pg_catalog\.(?:coalesce|substring)\b/i);
});

test('conditional contacts bind their parent and are stopped at claim and JIT authorization', () => {
  const migrationName = '20260819234400_campaign_conditional_delivery_hardening.sql';
  const migration = readFileSync(join(sqlRoot, 'migrations', migrationName), 'utf8').replaceAll('\r\n', '\n').trim();
  const schema = readFileSync(join(sqlRoot, 'schema.sql'), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(schemaMigrationMirror(schema, migrationName), migration);
  assert.match(migration, /jsonb_object_keys\(v_row\)\)<>27/i);
  assert.match(migration, /parent_contact_id[\s\S]*?conditional_delivery[\s\S]*?row_sha256/i);
  assert.match(migration, /parent_external_contact_id,conditional_delivery/i);
  assert.match(migration, /conditional_delivery\)<>104/i);
  assert.match(migration, /claim_cold_campaign_dispatch_pre_conditional_20260819/i);
  assert.match(migration, /authorize_graph_draft_send_pre_conditional_20260819/i);
  assert.match(migration, /conditional_parent_stopped/i);
  assert.match(migration, /draft_neutralization_required/i);
  assert.match(migration, /CONDITIONAL_GRAPH_INVALID/i);
  assert.match(migration, /master_enabled=false[\s\S]*?transactional_enabled=false[\s\S]*?cold_enabled=false/i);
  assert.match(migration, /revoke execute[\s\S]*?pre_conditional_20260819[\s\S]*?service_role/i);
});

test('campaign insight analytics are read-only, private and mirrored', () => {
  const migrationName = '20260821123000_dashboard_campaign_insights.sql';
  const migration = readFileSync(join(sqlRoot, 'migrations', migrationName), 'utf8').replaceAll('\r\n', '\n').trim();
  const schema = readFileSync(join(sqlRoot, 'schema.sql'), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(schemaMigrationMirror(schema, migrationName), migration);
  assert.match(migration, /dashboard_get_campaign_insights/i);
  assert.match(migration, /security definer set search_path = ''/i);
  assert.match(migration, /'pii_included', false/i);
  assert.match(migration, /revoke all[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant execute[\s\S]*?to service_role/i);
  assert.doesNotMatch(migration, /\b(insert|update|delete)\s+into\s+public\.(campaign_contacts|campaign_events|campaign_executions)\b/i);
});

test('the npm entrypoint selects a platform PowerShell without embedding credentials', () => {
  const wrapper = readFileSync(join(releaseDir, 'run-supabase-static-gates.mjs'), 'utf8');
  assert.match(wrapper, /process\.platform === 'win32' \? 'powershell\.exe' : 'pwsh'/);
  assert.match(wrapper, /'-Mode',[\s\S]*'Static'/);
  assert.doesNotMatch(wrapper, /PGPASSWORD|postgres(?:ql)?:\/\//i);
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
