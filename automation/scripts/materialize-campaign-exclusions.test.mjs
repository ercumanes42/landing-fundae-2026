import assert from 'node:assert/strict';
import test from 'node:test';

import {
  campaignExclusionSubjectSha256,
  exclusionRecordsSha256,
  EXCLUSION_SOURCES,
  materializeCampaignExclusions,
  signCampaignExclusionSnapshot,
} from './materialize-campaign-exclusions.mjs';

const now = new Date('2026-08-19T12:00:00.000Z');
const campaignId = 'FUNDAE_2026_EMAIL_V1';
const datasetSha256 = 'd'.repeat(64);
const leadHashSecret = 'l'.repeat(32);
const snapshotSecret = 's'.repeat(32);
const context = { now, campaignId, datasetSha256, leadHashSecret, snapshotSecret };
const rows = [
  { 'campaign id': campaignId, 'contact id': 'contact-alpha', 'correo electronico': 'alpha@example.invalid' },
  { 'campaign id': campaignId, 'contact id': 'contact-beta', 'correo electronico': 'beta@example.invalid' },
  { 'campaign id': campaignId, 'contact id': 'contact-gamma', 'correo electronico': 'gamma@example.invalid' },
];

function snapshot(source, records = [], overrides = {}) {
  const unsigned = {
    campaign_id: campaignId,
    source,
    snapshot_id: `snapshot-${source}`,
    key_id: 'test-key-v1',
    dataset_sha256: datasetSha256,
    captured_at: '2026-08-19T11:55:00.000Z',
    max_age_seconds: 900,
    records_sha256: exclusionRecordsSha256(records),
    records,
    ...overrides,
  };
  return { ...unsigned, signature: signCampaignExclusionSnapshot(unsigned, snapshotSecret) };
}

function completeSnapshots(overrides = {}) {
  return EXCLUSION_SOURCES.map((source) => snapshot(source, overrides[source] || []));
}

test('materialization is deterministic and applies STOP > PENDING_RECHECK > CLEAR', () => {
  const inputs = completeSnapshots({
    unsubscribe: [{ subject_sha256: campaignExclusionSubjectSha256('alpha@example.invalid', leadHashSecret), status: 'STOP' }],
    opposition: [{ subject_sha256: campaignExclusionSubjectSha256('beta@example.invalid', leadHashSecret), status: 'PENDING_RECHECK' }],
  });
  const first = materializeCampaignExclusions(rows, inputs, context);
  const replay = materializeCampaignExclusions([...rows].reverse(), [...inputs].reverse(), context);
  assert.equal(first.technicalEvidenceSha256, replay.technicalEvidenceSha256);
  const byId = new Map(first.rows.map((row) => [row['contact id'], row]));
  assert.equal(byId.get('contact-alpha')['eligibility status'], 'STOP');
  assert.equal(byId.get('contact-alpha')['habilitado envio'], 'NO');
  assert.equal(byId.get('contact-beta')['eligibility status'], 'PENDING_RECHECK');
  assert.equal(byId.get('contact-gamma')['eligibility status'], 'CLEAR');
});

test('stale snapshots retain known STOP and fail closed to PENDING_RECHECK for absent subjects', () => {
  const records = [{ subject_sha256: campaignExclusionSubjectSha256('alpha@example.invalid', leadHashSecret), status: 'STOP' }];
  const snapshots = completeSnapshots();
  snapshots[0] = snapshot('unsubscribe', records, {
    captured_at: '2026-08-18T00:00:00.000Z',
    max_age_seconds: 900,
  });
  const result = materializeCampaignExclusions(rows, snapshots, context);
  const byId = new Map(result.rows.map((row) => [row['contact id'], row]));
  assert.equal(byId.get('contact-alpha')['unsubscribe status'], 'STOP');
  assert.equal(byId.get('contact-beta')['unsubscribe status'], 'PENDING_RECHECK');
});

test('metadata, completeness, bounded age and canonical hash are mandatory', () => {
  const valid = completeSnapshots();
  assert.throws(() => materializeCampaignExclusions(rows, valid.slice(1), context), /SNAPSHOT_SET_INCOMPLETE/);
  assert.throws(() => materializeCampaignExclusions(rows, [
    { ...valid[0], records_sha256: 'a'.repeat(64) }, ...valid.slice(1),
  ], context), /SNAPSHOT_HASH_MISMATCH/);
  assert.throws(() => materializeCampaignExclusions(rows, [
    { ...valid[0], max_age_seconds: 86_401 }, ...valid.slice(1),
  ], context), /SNAPSHOT_METADATA_INVALID/);
  assert.throws(() => materializeCampaignExclusions(rows, [
    { ...valid[0], email: 'forbidden@example.invalid' }, ...valid.slice(1),
  ], context), /SNAPSHOT_METADATA_INVALID/);
  assert.throws(() => materializeCampaignExclusions(rows, [
    { ...valid[0], signature: 'a'.repeat(64) }, ...valid.slice(1),
  ], context), /SNAPSHOT_SIGNATURE_INVALID/);
  assert.throws(() => materializeCampaignExclusions(rows, valid, {
    ...context, leadHashSecret: 'weak',
  }), /LEAD_HASH_SECRET_INVALID/);
});

test('redacted report contains aggregates and evidence but no identifiers or subject hashes', () => {
  const result = materializeCampaignExclusions(rows, completeSnapshots(), context);
  const serialized = JSON.stringify(result.report);
  assert.match(result.technicalEvidenceSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.report.redacted, true);
  assert.equal(result.report.contacts, 3);
  for (const forbidden of ['contact-alpha', 'alpha@example.invalid', campaignExclusionSubjectSha256('alpha@example.invalid', leadHashSecret), '@']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
