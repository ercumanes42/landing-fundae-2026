import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLeadId } from './lead-id';
import {
  cloneTransactionalOutlookV3FromV2,
  cloneTransactionalOutlookV4FromV2,
  OUTLOOK_V3_CLONE_CONFIRMATION,
  OUTLOOK_V3_CREATED_AT,
  OUTLOOK_V4_CLONE_CONFIRMATION,
  OUTLOOK_V4_CREATED_AT,
  parseTransactionalOutlookV3CloneArgs,
  parseTransactionalOutlookV4CloneArgs,
} from './transactional-outlook-v3-clone';
import { renderTransactionalDeliveryContent } from './transactional-delivery-package';
import {
  prepareTransactionalPilotLeadRows,
  TransactionalPilotProvisionError,
  type TransactionalPilotLeadRow,
} from './transactional-pilot-provision';

const secret = 'clone-test-secret-that-is-long-enough';
const email = 'shared@example.test';

function sourceRows(): TransactionalPilotLeadRow[] {
  const lead = (resource: string) => ({
    form_type: resource,
    lead_magnet: resource,
    created_at: '2026-08-17T10:00:00.000Z',
    contact: { name: 'Internal pilot', email, company: 'Internal' },
    consent: { privacy_accepted: true, marketing_accepted: false },
  });
  return prepareTransactionalPilotLeadRows({
    version: '2.0',
    confirmation: 'PROVISION_4_INERT_TRANSACTIONAL_OUTLOOK_E2E_LEADS',
    leads: ['calculator', 'interactive_checklist', 'checklist', 'webinar'].map(lead),
  });
}

async function withEnv(callback: () => void | Promise<void>): Promise<void> {
  const values = {
    LEAD_HASH_SECRET: secret,
    TRANSACTIONAL_LANDING_ORIGIN: 'https://landing.example.test',
    TRANSACTIONAL_WEBINAR_TITLE: 'Webinar FUNDAE',
    TRANSACTIONAL_WEBINAR_START_AT: '2026-09-15T08:00:00.000Z',
    TRANSACTIONAL_WEBINAR_DURATION_MINUTES: '60',
    TRANSACTIONAL_WEBINAR_TIMEZONE: 'Europe/Madrid',
    TRANSACTIONAL_WEBINAR_ACCESS_NOTE: 'Acceso confirmado por canal interno.',
  };
  const previous = new Map<string, string | undefined>();
  previous.set('TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS', process.env.TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS);
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  process.env.TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS = buildLeadId(email);
  try {
    await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('parses dry-run by default and requires the exact apply confirmation', () => {
  assert.equal(parseTransactionalOutlookV3CloneArgs([]), false);
  assert.equal(parseTransactionalOutlookV3CloneArgs(['--apply', OUTLOOK_V3_CLONE_CONFIRMATION]), true);
  for (const args of [['--apply'], ['--apply', 'WRONG'], ['--dry-run'], [OUTLOOK_V3_CLONE_CONFIRMATION]]) {
    assert.throws(
      () => parseTransactionalOutlookV3CloneArgs(args),
      (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === 'arguments_invalid',
    );
  }
  assert.equal(parseTransactionalOutlookV4CloneArgs([]), false);
  assert.equal(parseTransactionalOutlookV4CloneArgs(['--apply', OUTLOOK_V4_CLONE_CONFIRMATION]), true);
  assert.throws(
    () => parseTransactionalOutlookV4CloneArgs(['--apply', OUTLOOK_V3_CLONE_CONFIRMATION]),
    /arguments_invalid/,
  );
});

test('v4 enriches calculator and interactive payloads and every resource passes the package renderer', async () => {
  await withEnv(async () => {
    const source = sourceRows();
    let target: TransactionalPilotLeadRow[] = [];
    let inserts = 0;
    const dependencies = {
      async findSource() { return structuredClone(source); },
      async findTargetExisting() { return structuredClone(target); },
      async countCampaignMatches() { return 0; },
      async insertAll(rows: TransactionalPilotLeadRow[]) {
        inserts += 1;
        target = structuredClone(rows);
      },
    };
    assert.equal((await cloneTransactionalOutlookV4FromV2(false, dependencies)).status, 'validated');
    assert.equal(inserts, 0);
    assert.equal((await cloneTransactionalOutlookV4FromV2(true, dependencies)).inserted, 4);
    assert.equal(inserts, 1);
    assert.ok(target.every((row) =>
      row.submission_id === `pilot_outlook_e2e_v3_${row.form_type}_${row.lead_id}` &&
      row.created_at === OUTLOOK_V4_CREATED_AT
    ));
    assert.equal(target.find((row) => row.form_type === 'calculator')?.payload.credit_estimate?.amount, 420);
    assert.equal(target.find((row) => row.form_type === 'interactive_checklist')?.payload.interactive_checklist?.score, 5);
    for (const row of target) assert.doesNotThrow(() => renderTransactionalDeliveryContent(row.payload, row.form_type));
    assert.equal((await cloneTransactionalOutlookV4FromV2(true, dependencies)).status, 'already_provisioned');
    assert.equal(inserts, 1);
  });
});

test('profile 4 rejects the same generic payload that caused production package_unavailable', async () => {
  await withEnv(() => {
    const source = sourceRows();
    assert.throws(
      () => prepareTransactionalPilotLeadRows({
        version: '4.0',
        confirmation: 'PROVISION_4_INERT_TRANSACTIONAL_OUTLOOK_E2E_LEADS_V3',
        leads: source.map((row) => Object.fromEntries(Object.entries(row.payload).filter(([key]) => ![
          'submission_id', 'lead_id', 'lead_score', 'lead_status', 'lead_classification',
          'scoring', 'delivery_status', 'email_delivery_status',
        ].includes(key)))),
      }),
      (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === 'delivery_payload_invalid',
    );
  });
});

test('clones the exact canonical v2 cohort into deterministic inert v3 rows', async () => {
  await withEnv(async () => {
    const source = sourceRows();
    let target: TransactionalPilotLeadRow[] = [];
    let inserts = 0;
    const dependencies = {
      async findSource() { return structuredClone(source); },
      async findTargetExisting() { return structuredClone(target); },
      async countCampaignMatches() { return 0; },
      async insertAll(rows: TransactionalPilotLeadRow[]) {
        inserts += 1;
        target = structuredClone(rows);
      },
    };

    assert.equal((await cloneTransactionalOutlookV3FromV2(false, dependencies)).status, 'validated');
    assert.equal(inserts, 0);
    const applied = await cloneTransactionalOutlookV3FromV2(true, dependencies);
    assert.equal(applied.status, 'provisioned');
    assert.equal(applied.inserted, 4);
    assert.equal(inserts, 1);
    assert.equal(new Set(target.map((row) => row.submission_id)).size, 4);
    assert.ok(target.every((row) =>
      row.submission_id === `pilot_outlook_e2e_v2_${row.form_type}_${row.lead_id}` &&
      row.created_at === OUTLOOK_V3_CREATED_AT &&
      row.payload.created_at === OUTLOOK_V3_CREATED_AT &&
      row.delivery_status === 'dead_letter' &&
      row.email_delivery_status === 'pending' &&
      row.accepted_by_make_at === null &&
      row.ai_summary === null
    ));
    const replay = await cloneTransactionalOutlookV3FromV2(true, dependencies);
    assert.deepEqual(replay, {
      status: 'already_provisioned', resources: 4, configured_identities: 1,
      used_identities: 1, shared_identity_mappings: 3, inserted: 0,
    });
    assert.equal(inserts, 1);
    assert.doesNotMatch(JSON.stringify(replay), /@|lead_id|submission|payload|hash/i);
  });
});

test('rejects invalid source cohorts and campaign conflicts without inserting', async () => {
  await withEnv(async () => {
    const canonical = sourceRows();
    const changedEmail = structuredClone(canonical);
    (changedEmail[0].payload.contact as { email: string }).email = 'different@example.test';
    const privacyRejected = structuredClone(canonical);
    privacyRejected[0].payload.consent = { privacy_accepted: false, marketing_accepted: false };
    const nonInert = structuredClone(canonical);
    nonInert[0] = { ...nonInert[0], delivery_status: 'queued' as never };
    const cases = [
      { rows: canonical.slice(0, 3), campaign: 0, reason: 'source_cohort_invalid' },
      { rows: [...canonical, canonical[0]], campaign: 0, reason: 'source_cohort_invalid' },
      { rows: changedEmail, campaign: 0, reason: 'source_cohort_invalid' },
      { rows: privacyRejected, campaign: 0, reason: 'source_cohort_invalid' },
      { rows: nonInert, campaign: 0, reason: 'source_cohort_invalid' },
      { rows: canonical, campaign: 1, reason: 'campaign_identity_conflict' },
    ];
    for (const scenario of cases) {
      let inserts = 0;
      await assert.rejects(
        () => cloneTransactionalOutlookV3FromV2(true, {
          async findSource() { return structuredClone(scenario.rows); },
          async findTargetExisting() { return []; },
          async countCampaignMatches() { return scenario.campaign; },
          async insertAll() { inserts += 1; },
        }),
        (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === scenario.reason,
      );
      assert.equal(inserts, 0);
    }
  });
});

test('target partial state aborts and never performs the bulk insert', async () => {
  await withEnv(async () => {
    const source = sourceRows();
    let targetRows: TransactionalPilotLeadRow[] = [];
    await cloneTransactionalOutlookV3FromV2(true, {
      async findSource() { return source; },
      async findTargetExisting() { return []; },
      async countCampaignMatches() { return 0; },
      async insertAll(rows) { targetRows = structuredClone(rows); },
    });
    let inserts = 0;
    await assert.rejects(
      () => cloneTransactionalOutlookV3FromV2(true, {
        async findSource() { return source; },
        async findTargetExisting() { return targetRows.slice(0, 2); },
        async countCampaignMatches() { return 0; },
        async insertAll() { inserts += 1; },
      }),
      (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === 'existing_set_conflict',
    );
    assert.equal(inserts, 0);
  });
});
