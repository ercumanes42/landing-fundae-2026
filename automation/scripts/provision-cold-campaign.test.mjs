import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  applyProvisionManifest,
  buildProvisionManifest,
  evaluateProvisioningGates,
  prepareProvisionRows,
  runProvisioner,
} from './provision-cold-campaign.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const report = {
  contacts: 939, unique_contact_ids: 939, unique_emails: 939,
  lots: { A: 235, B: 235, C: 235, D: 234 }, bodies: 4695,
  identified_bodies: 4695, unsubscribe_placeholders: 4695,
  logical_dataset_sha256: 'a'.repeat(64),
  technical_evidence_sha256: 'b'.repeat(64),
};
const summary = {
  contacts: 939, lots: { A: 235, B: 235, C: 235, D: 234 },
  logicalDatasetSha256: 'a'.repeat(64), readiness: { OK: 939 },
  optOutCoverage: { totalBodies: 4695, missingBodies: 0 },
  copyCoverage: { identifiedBodies: 4695, canonicalMismatches: 0, unresolvedPlaceholderBodies: 0 },
  policyCoverage: {
    technicalEvidenceSha256: 'b'.repeat(64),
    technicalStatuses: {
      'unsubscribe status': { CLEAR: 939 }, 'opposition status': { CLEAR: 939 },
      'hard bounce status': { CLEAR: 939 }, 'suppression status': { CLEAR: 939 },
      'duplicate status': { CLEAR: 939 },
    },
    authorizations: { AUTHORIZED: 939 },
  },
};

test('default dry-run reads the controlled copy, reports every current NO-GO gate and performs zero network', async () => {
  let network = 0;
  const result = await runProvisioner({ apply: false, fetchImpl: async () => { network += 1; throw new Error('network forbidden'); } });
  assert.equal(result.ready, false);
  assert.deepEqual(result.gates, ['VALIDATION_NOT_OK','TECHNICAL_EXCLUSIONS_NOT_CLEAR','TECHNICAL_EVIDENCE_MISSING_OR_DRIFT','CAMPAIGN_NOT_AUTHORIZED']);
  assert.equal(result.summary.contacts, 939);
  assert.equal(result.summary.payloads, 4695);
  assert.equal(network, 0);
  assert.equal(JSON.stringify(result).includes('@'), false);
});

test('gate evaluator rejects hash drift, wrong count/lot and pending exclusion without identifiers', () => {
  const broken = structuredClone(summary);
  broken.contacts = 938;
  broken.lots.D = 233;
  broken.logicalDatasetSha256 = 'b'.repeat(64);
  broken.policyCoverage.technicalStatuses['hard bounce status'] = { PENDING_RECHECK: 939 };
  const gates = evaluateProvisioningGates(broken, report, true);
  for (const gate of ['CONTACT_COUNT_MISMATCH','LOT_DISTRIBUTION_MISMATCH','LOGICAL_DATASET_HASH_DRIFT','TECHNICAL_EXCLUSIONS_NOT_CLEAR']) assert.ok(gates.includes(gate));
});

test('manifest is deterministic on replay and changes on row-hash drift', () => {
  const technicalEvidenceSha256 = 'b'.repeat(64);
  const rows = Array.from({ length: 4695 }, (_, index) => ({
    campaign_external_id: 'FUNDAE_2026_EMAIL_V1',
    technical_evidence_sha256: technicalEvidenceSha256,
    row_sha256: hash(`row-${index}`),
  }));
  const first = buildProvisionManifest(rows, 'a'.repeat(64), technicalEvidenceSha256);
  const replay = buildProvisionManifest(structuredClone(rows), 'a'.repeat(64), technicalEvidenceSha256);
  assert.equal(first.manifestHash, replay.manifestHash);
  assert.deepEqual(first.batches.map((batch) => batch.hash), replay.batches.map((batch) => batch.hash));
  rows[100].row_sha256 = hash('drift');
  assert.notEqual(buildProvisionManifest(rows, 'a'.repeat(64), technicalEvidenceSha256).manifestHash, first.manifestHash);
  const campaignDrift = structuredClone(rows);
  campaignDrift[0].campaign_external_id = 'FUNDAE_2026_EMAIL_TAMPERED';
  assert.throws(() => buildProvisionManifest(campaignDrift, 'a'.repeat(64), technicalEvidenceSha256), /APPLY_MANIFEST_INPUT_INVALID/);
});

test('Excel serial dates, canonical payload and unit-separator row hash are deterministic', () => {
  const excelSerial = (iso) => (Date.parse(iso) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const source = {
    'campaign id': 'FUNDAE_2026_EMAIL_V1', 'contact id': 'contact-0001', 'account id': 'account-0001',
    'correo electronico': 'Recipient@Example.invalid', 'variante nombre': 'Checklist', 'lote envio': 'A',
    'tipo de empresa': 'micro', 'validacion pre envio': 'OK', 'unsubscribe status': 'CLEAR',
    'opposition status': 'CLEAR', 'hard bounce status': 'CLEAR', 'suppression status': 'CLEAR',
    'duplicate status': 'CLEAR', 'campaign authorization': 'AUTHORIZED',
    'technical evidence sha256': 'b'.repeat(64),
  };
  const dates = ['2026-09-01T08:00:00.000Z','2026-09-15T08:00:00.000Z','2026-10-01T08:00:00.000Z','2026-10-15T08:00:00.000Z','2026-11-03T08:00:00.000Z'];
  for (let step = 1; step <= 5; step += 1) {
    source[`email${step} asunto`] = `Subject ${step}`;
    source[`email${step} cuerpo html`] = `<p>Body ${step}</p><a href="{{unsubscribe_url}}">Baja</a>`;
    source[`fecha email ${step}`] = excelSerial(dates[step - 1]);
  }
  const rows = prepareProvisionRows([source], {
    unsubscribeSecret: 'u'.repeat(32), unsubscribeBaseUrl: 'https://example.invalid/',
    leadHashSecret: 'l'.repeat(32),
  });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.toSorted((a, b) => a.step - b.step).map((row) => row.scheduled_for), dates);
  assert.ok(rows.every((row) => row.company_size === 'micro'));
  assert.ok(rows.every((row) =>
    row.email_hash === createHmac('sha256', 'l'.repeat(32)).update('recipient@example.invalid').digest('hex')));
  for (const row of rows) {
    const canonicalPayload = JSON.stringify({ recipient: row.recipient_email, subject: row.subject, body: row.html_body, attachments: [] });
    assert.equal(row.payload_sha256, hash(canonicalPayload));
    assert.equal((row.html_body.match(/u1\.[A-Za-z0-9_-]{43}/g) || []).length, 1);
    const fields = [
      row.campaign_external_id,row.contact_id,row.account_id,row.email,row.email_hash,row.variant,row.lot,String(row.step),
      row.scheduled_for,row.execution_key,row.recipient_email,row.subject,row.html_body,row.payload_sha256,row.token_hash,
      row.validation_status,row.unsubscribe_status,row.opposition_status,row.hard_bounce_status,row.suppression_status,
      row.duplicate_status,row.campaign_authorization,row.company_size,row.technical_evidence_sha256,
    ];
    assert.equal(row.row_sha256, hash(fields.join('\x1f')));
  }
});

test('provisioner rejects weak, placeholder and whitespace-drift lead secrets before processing rows', () => {
  for (const leadHashSecret of [
    'k'.repeat(31),
    'replace-with-a-long-random-secret-value',
    ` ${'k'.repeat(32)}`,
    `${'k'.repeat(32)} `,
  ]) {
    assert.throws(() => prepareProvisionRows([], {
      unsubscribeSecret: 'u'.repeat(32),
      unsubscribeBaseUrl: 'https://example.invalid/',
      leadHashSecret,
    }), /APPLY_LEAD_HASH_SECRET_INVALID/);
  }
  assert.deepEqual(prepareProvisionRows([], {
    unsubscribeSecret: 'u'.repeat(32),
    unsubscribeBaseUrl: 'https://example.invalid/',
    leadHashSecret: 'ñ'.repeat(16),
  }), []);
});
const applyInput = {
  manifest: { schemaVersion: 'cold-provision-v3', manifestHash: 'a'.repeat(64), logicalDatasetSha256: '9'.repeat(64), technicalEvidenceSha256: '8'.repeat(64), campaignExternalId: 'FUNDAE_2026_EMAIL_V1', batchCount: 2, batches: [
    { index: 0, hash: 'b'.repeat(64), rows: [{ row_sha256: 'c'.repeat(64), technical_evidence_sha256: '8'.repeat(64) }] },
    { index: 1, hash: 'd'.repeat(64), rows: [{ row_sha256: 'e'.repeat(64), technical_evidence_sha256: '8'.repeat(64) }] },
  ] },
  campaignExternalId: 'FUNDAE_2026_EMAIL_V1', actorHash: 'f'.repeat(64),
  authorizationToken: 'authorization-'.padEnd(40, 'x'),
  applyAck: 'FUNDAE_STAGING_PROVISION_APPLY_V1', provisioningEnabled: 'true',
  supabaseUrl: 'https://project.supabase.co', serviceKey: 'service-'.padEnd(40, 's'),
};

test('apply replay accepts idempotent batches and finalizes only after all batches', async () => {
  const calls = [];
  const result = await applyProvisionManifest(applyInput, async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ accepted: true, duplicate: calls.length <= 2 }) };
  });
  assert.equal(result.accepted, true);
  assert.equal(calls.length, 3);
  assert.ok(calls[2].endsWith('/finalize_cold_campaign_provision'));
});

test('partial batch or row collision aborts before finalize', async () => {
  const calls = [];
  await assert.rejects(() => applyProvisionManifest(applyInput, async (url) => {
    calls.push(url);
    return calls.length === 2
      ? { ok: false, json: async () => ({ accepted: false, reason_code: 'row_collision' }) }
      : { ok: true, json: async () => ({ accepted: true }) };
  }), /APPLY_RPC_REJECTED/);
  assert.equal(calls.some((url) => url.endsWith('/finalize_cold_campaign_provision')), false);
});

test('apply double gate rejects before network', async () => {
  let calls = 0;
  await assert.rejects(() => applyProvisionManifest({ ...applyInput, applyAck: 'wrong' }, async () => { calls += 1; throw new Error('network forbidden'); }), /APPLY_DOUBLE_GATE_CLOSED/);
  assert.equal(calls, 0);
});

test('apply rejects v2 and technical-evidence drift before network', async () => {
  let calls = 0;
  const noNetwork = async () => { calls += 1; throw new Error('network forbidden'); };
  await assert.rejects(() => applyProvisionManifest({
    ...applyInput, manifest: { ...applyInput.manifest, schemaVersion: 'cold-provision-v2' },
  }, noNetwork), /APPLY_MANIFEST_V3_REQUIRED/);
  const drifted = structuredClone(applyInput);
  drifted.manifest.batches[1].rows[0].technical_evidence_sha256 = '7'.repeat(64);
  await assert.rejects(() => applyProvisionManifest(drifted, noNetwork), /APPLY_DOUBLE_GATE_CLOSED/);
  assert.equal(calls, 0);
});

test('SQL import contract is OFF, private, idempotent and collision-safe', () => {
  const sql = readFileSync(new URL('../../data-brain/supabase/migrations/20260819200000_cold_campaign_provisioning.sql', import.meta.url), 'utf8').toLowerCase();
  for (const marker of [
    'enabled boolean not null default false', 'where singleton for update',
    "not v_control.enabled", 'v_outbound.master_enabled or v_outbound.cold_enabled',
    'on conflict (manifest_hash,batch_index)', 'batch_hash<>p_batch_hash',
    "message='row_collision'", 'campaign_id=v_manifest.campaign_id)<>939', 'campaign_id=v_manifest.campaign_id)<>4695',
    "set is_active=true,status='pilot'", "set is_active=false,status='draft'",
    "pg_catalog.chr(31)", "v_row->>'campaign_authorization',v_row->>'company_size'",
    "v_row->>'recipient_email'<>v_row->>'email'", 'provision_unsubscribe_binding_invalid',
    'provision_payload_hash_invalid', "strpos(v_row->>'html_body','{{unsubscribe_url}}')>0",
    'cold-provision-v2', 'logical_dataset_hash', 'campaign_external_id', 'row_hashes',
    "message='provision_manifest_hash_invalid'", 'p_logical_dataset_hash',
    'alter table public.cold_campaign_provision_control force row level security',
    'revoke execute on function public.apply_cold_campaign_provision_batch',
  ]) assert.ok(sql.includes(marker), `missing provisioning contract: ${marker}`);
});

test('SQL v3 supersedes v2 and binds technical evidence into rows and manifest', () => {
  const migration = readFileSync(new URL(
    '../../data-brain/supabase/migrations/20260819234000_campaign_terminal_suppression_hardening.sql',
    import.meta.url,
  ), 'utf8').replaceAll('\r\n', '\n');
  const schema = readFileSync(new URL('../../data-brain/supabase/schema.sql', import.meta.url), 'utf8')
    .replaceAll('\r\n', '\n');
  const marker = '-- 20260819234000_campaign_terminal_suppression_hardening.sql';
  const schemaMirror = schema.slice(schema.lastIndexOf(marker) + marker.length).trim();
  assert.equal(schemaMirror, migration.trim());
  for (const contract of [
    "hash_domain = 'cold-provision-v3'",
    'technical_evidence_hash text',
    "v_row->>'company_size',v_row->>'technical_evidence_sha256'",
    "'cold-provision-v3',v_manifest.logical_dataset_hash",
    'v_manifest.technical_evidence_hash,v_manifest.campaign_external_id',
    'v_existing_manifest.technical_evidence_hash<>v_technical_evidence_hash',
    'provision_technical_evidence_invalid',
    'cold_campaign_v2_state_present',
  ]) assert.ok(migration.includes(contract), `missing v3 binding: ${contract}`);
  const apply = migration.slice(
    migration.lastIndexOf('create or replace function public.apply_cold_campaign_provision_batch('),
    migration.lastIndexOf('create or replace function public.finalize_cold_campaign_provision('),
  );
  const finalize = migration.slice(
    migration.lastIndexOf('create or replace function public.finalize_cold_campaign_provision('),
    migration.lastIndexOf('-- Applying the contract never activates outbound or provisioning.'),
  );
  assert.equal(apply.includes('cold-provision-v2'), false);
  assert.equal(finalize.includes('cold-provision-v2'), false);
  assert.ok(
    apply.indexOf("v_computed_row_hash<>v_row->>'row_sha256'") <
      apply.indexOf("'reason_code','batch_replayed'"),
    'row hashes must be recomputed before the idempotent replay shortcut',
  );
});

test('SQL provisioning accepts HMAC identities and rejects the legacy plain-SHA predicate', () => {
  const migrationUrl = new URL('../../data-brain/supabase/migrations/20260819155300_cold_campaign_hmac_identity.sql', import.meta.url);
  const provisioningUrl = new URL('../../data-brain/supabase/migrations/20260819200000_cold_campaign_provisioning.sql', import.meta.url);
  const schemaUrl = new URL('../../data-brain/supabase/schema.sql', import.meta.url);
  const migration = readFileSync(migrationUrl, 'utf8').replaceAll('\r\n', '\n');
  const provisioning = readFileSync(provisioningUrl, 'utf8').replaceAll('\r\n', '\n');
  const schema = readFileSync(schemaUrl, 'utf8').replaceAll('\r\n', '\n');
  const legacyPredicate = "pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.lower(v_row->>'email'),'UTF8'),'sha256'),'hex')<>v_row->>'email_hash'";
  const hmacPredicate = "not fundae_private.is_cold_campaign_hmac_identity(v_row->>'email',v_row->>'email_hash')";
  const helperBlock = (sql) => sql.match(/-- HMAC_IDENTITY_HELPER_BEGIN\n[\s\S]+?-- HMAC_IDENTITY_HELPER_END/u)?.[0];
  const schemaProvisioning = schema.slice(schema.indexOf('-- 20260819200000_cold_campaign_provisioning.sql'));

  assert.ok(helperBlock(migration), 'HMAC helper block must exist in the migration');
  assert.equal(helperBlock(schema), helperBlock(migration), 'schema must mirror the private HMAC helper exactly');
  assert.ok(provisioning.includes(hmacPredicate));
  assert.ok(schemaProvisioning.includes(hmacPredicate));
  assert.equal(provisioning.includes(legacyPredicate), false);
  assert.equal(schemaProvisioning.includes(legacyPredicate), false);
});

test('adaptive HMAC migration patches one exact legacy source and fails closed on drift', () => {
  const sql = readFileSync(new URL('../../data-brain/supabase/migrations/20260819155300_cold_campaign_hmac_identity.sql', import.meta.url), 'utf8').toLowerCase();
  for (const marker of [
    'pg_catalog.to_regprocedure(v_signature)', 'pg_catalog.pg_get_functiondef(p.oid)',
    'v_occurrences<>1', 'cold_campaign_hmac_patch_source_drift',
    'cold_campaign_hmac_patch_verification_failed',
    'revoke all on schema fundae_private from public,anon,authenticated,service_role',
    'revoke all on function fundae_private.is_cold_campaign_hmac_identity',
  ]) assert.ok(sql.includes(marker), `missing adaptive HMAC marker: ${marker}`);
});
