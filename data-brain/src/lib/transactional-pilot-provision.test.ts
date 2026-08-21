import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

import { buildLeadId } from './lead-id';
import { insertRowsWithoutRepresentation } from './supabase';
import {
  prepareTransactionalPilotLeadRows,
  provisionTransactionalPilotLeads,
  provisionTransactionalPilotLeadsFromJson,
  readTransactionalPilotInput,
  transactionalPilotSubmissionFilter,
  TransactionalPilotProvisionError,
  type TransactionalPilotLeadRow,
} from './transactional-pilot-provision';

const secret = 'pilot-test-secret-that-is-long-enough';
const sharedEmail = 'shared@example.test';
const interactiveEmail = 'interactive@example.test';
const unusedEmail = 'unused@example.test';
const secondUnusedEmail = 'unused-two@example.test';

function input(version: '1.0' | '2.0' | '3.0' = '1.0') {
  const createdAt = '2026-08-17T10:00:00.000Z';
  const lead = (resource: string, email: string) => ({
    form_type: resource,
    lead_magnet: resource,
    created_at: createdAt,
    contact: { name: 'Internal pilot', email, company: 'Internal' },
    consent: { privacy_accepted: true, marketing_accepted: false },
  });
  return {
    version,
    confirmation: {
      '1.0': 'PROVISION_4_INERT_TRANSACTIONAL_PILOT_LEADS',
      '2.0': 'PROVISION_4_INERT_TRANSACTIONAL_OUTLOOK_E2E_LEADS',
      '3.0': 'PROVISION_4_INERT_TRANSACTIONAL_OUTLOOK_E2E_LEADS_V2',
    }[version],
    leads: [
      lead('calculator', sharedEmail),
      lead('interactive_checklist', sharedEmail),
      lead('checklist', sharedEmail),
      lead('webinar', sharedEmail),
    ],
  };
}

async function withEnv(callback: () => void | Promise<void>): Promise<void> {
  const previousSecret = process.env.LEAD_HASH_SECRET;
  const previousAllowlist = process.env.TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS;
  process.env.LEAD_HASH_SECRET = secret;
  process.env.TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS = [
    buildLeadId(sharedEmail),
    buildLeadId(interactiveEmail),
    buildLeadId(unusedEmail),
    buildLeadId(secondUnusedEmail),
  ].join(',');
  try {
    await callback();
  } finally {
    if (previousSecret === undefined) delete process.env.LEAD_HASH_SECRET;
    else process.env.LEAD_HASH_SECRET = previousSecret;
    if (previousAllowlist === undefined) delete process.env.TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS;
    else process.env.TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS = previousAllowlist;
  }
}

test('prepares exactly four inert resources with the approved single-identity mapping', async () => {
  await withEnv(() => {
    const rows = prepareTransactionalPilotLeadRows(input());
    assert.equal(rows.length, 4);
    assert.equal(new Set(rows.map((row) => row.form_type)).size, 4);
    assert.equal(new Set(rows.map((row) => row.lead_id)).size, 1);
    assert.equal(rows.find((row) => row.form_type === 'calculator')?.lead_id, rows.find((row) => row.form_type === 'webinar')?.lead_id);
    assert.equal(rows.find((row) => row.form_type === 'interactive_checklist')?.lead_id, rows.find((row) => row.form_type === 'checklist')?.lead_id);
    assert.equal(new Set(rows.map((row) => row.submission_id)).size, 4);
    assert.ok(rows.every((row) =>
      row.delivery_status === 'dead_letter' &&
      row.email_delivery_status === 'pending' &&
      row.accepted_by_make_at === null &&
      row.payload.delivery_status === 'dead_letter'
    ));
    assert.doesNotMatch(JSON.stringify({
      resources: rows.length,
      identities: new Set(rows.map((row) => row.lead_id)).size,
    }), /@|example\.test/i);
  });
});

test('keeps professional-email validation and rejects any unapproved identity mapping', async () => {
  await withEnv(() => {
    const personal = input();
    personal.leads[1].contact.email = 'internal@gmail.com';
    personal.leads[2].contact.email = 'internal@gmail.com';
    process.env.TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS = [
      buildLeadId(sharedEmail),
      buildLeadId('internal@gmail.com'),
      buildLeadId(unusedEmail),
      buildLeadId(secondUnusedEmail),
    ].join(',');
    assert.throws(
      () => prepareTransactionalPilotLeadRows(personal),
      (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === 'lead_invalid',
    );

    process.env.TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS = [
      buildLeadId(sharedEmail),
      buildLeadId(interactiveEmail),
      buildLeadId(unusedEmail),
      buildLeadId(secondUnusedEmail),
    ].join(',');
    const invalidMapping = input();
    invalidMapping.leads[3].contact.email = interactiveEmail;
    assert.throws(
      () => prepareTransactionalPilotLeadRows(invalidMapping),
      (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === 'identity_mapping_invalid',
    );
  });
});

test('rejects every second identity while normalizing aliases of the approved identity', async () => {
  await withEnv(() => {
    const aliased = input();
    aliased.leads[0].contact.email = '  SHARED@EXAMPLE.TEST ';
    aliased.leads[1].contact.email = ' SHARED@example.test ';
    aliased.leads[2].contact.email = 'shared@EXAMPLE.TEST';
    assert.equal(new Set(prepareTransactionalPilotLeadRows(aliased).map((row) => row.lead_id)).size, 1);

    const invalidIdentitySets = [
      [sharedEmail, sharedEmail, sharedEmail, interactiveEmail],
      [sharedEmail, interactiveEmail, interactiveEmail, unusedEmail],
      [sharedEmail, interactiveEmail, unusedEmail, secondUnusedEmail],
    ];
    for (const emails of invalidIdentitySets) {
      const invalid = input();
      invalid.leads.forEach((lead, index) => { lead.contact.email = emails[index]; });
      assert.throws(
        () => prepareTransactionalPilotLeadRows(invalid),
        (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === 'identity_mapping_invalid',
      );
    }
  });
});

test('dry-run, apply and idempotent replay expose only aggregate summaries', async () => {
  await withEnv(async () => {
    let existing: TransactionalPilotLeadRow[] = [];
    let inserts = 0;
    const dependencies = {
      async findExisting() { return existing; },
      async countCampaignMatches() { return 0; },
      async insertAll(rows: TransactionalPilotLeadRow[]) {
        inserts += 1;
        existing = structuredClone(rows);
      },
    };
    const validated = await provisionTransactionalPilotLeads(input(), false, dependencies);
    assert.deepEqual(validated, {
      status: 'validated', resources: 4, configured_identities: 4, used_identities: 1, shared_identity_mappings: 3, inserted: 0,
    });
    assert.equal(inserts, 0);
    const provisioned = await provisionTransactionalPilotLeads(input(), true, dependencies);
    assert.equal(provisioned.status, 'provisioned');
    assert.equal(provisioned.inserted, 4);
    const replay = await provisionTransactionalPilotLeads(input(), true, dependencies);
    assert.deepEqual(replay, {
      status: 'already_provisioned', resources: 4, configured_identities: 4, used_identities: 1, shared_identity_mappings: 3, inserted: 0,
    });
    assert.equal(inserts, 1);
    assert.doesNotMatch(JSON.stringify(replay), /@|lead_id|submission|payload|hash/i);
  });
});

test('creates a fresh deterministic Outlook cohort without colliding with the prior identity', async () => {
  await withEnv(async () => {
    const priorRows = prepareTransactionalPilotLeadRows(input('1.0'));
    const freshRows = prepareTransactionalPilotLeadRows(input('2.0'));
    assert.equal(new Set([...priorRows, ...freshRows].map((row) => row.submission_id)).size, 8);
    assert.equal(new Set(freshRows.map((row) => row.lead_id)).size, 1);
    assert.ok(freshRows.every((row) => row.submission_id.startsWith('pilot_outlook_e2e_v1_')));
    const selector = transactionalPilotSubmissionFilter(freshRows);
    assert.match(selector, /^submission_id=in\.\(/);
    assert.doesNotMatch(selector, /lead_id|@|example\.test/i);

    let existing: TransactionalPilotLeadRow[] = [];
    let inserts = 0;
    const dependencies = {
      async findExisting() { return existing; },
      async countCampaignMatches() { return 0; },
      async insertAll(rows: TransactionalPilotLeadRow[]) {
        inserts += 1;
        existing = structuredClone(rows);
      },
    };
    const validated = await provisionTransactionalPilotLeads(input('2.0'), false, dependencies);
    assert.equal(validated.status, 'validated');
    assert.equal(validated.inserted, 0);
    const provisioned = await provisionTransactionalPilotLeads(input('2.0'), true, dependencies);
    assert.equal(provisioned.status, 'provisioned');
    assert.equal(provisioned.inserted, 4);
    const replay = await provisionTransactionalPilotLeads(input('2.0'), true, dependencies);
    assert.equal(replay.status, 'already_provisioned');
    assert.equal(replay.inserted, 0);
    assert.equal(inserts, 1);
  });
});

test('creates version 3 as a second fresh inert Outlook cohort without colliding with v1 or v2', async () => {
  await withEnv(async () => {
    const v1 = prepareTransactionalPilotLeadRows(input('1.0'));
    const v2 = prepareTransactionalPilotLeadRows(input('2.0'));
    const v3 = prepareTransactionalPilotLeadRows(input('3.0'));
    assert.equal(new Set([...v1, ...v2, ...v3].map((row) => row.submission_id)).size, 12);
    assert.ok(v3.every((row) =>
      row.submission_id.startsWith('pilot_outlook_e2e_v2_') &&
      row.delivery_status === 'dead_letter' &&
      row.email_delivery_status === 'pending' &&
      row.accepted_by_make_at === null &&
      row.ai_summary === null
    ));
    let existing: TransactionalPilotLeadRow[] = [];
    let inserts = 0;
    const dependencies = {
      async findExisting() { return existing; },
      async countCampaignMatches() { return 0; },
      async insertAll(rows: TransactionalPilotLeadRow[]) {
        inserts += 1;
        existing = structuredClone(rows);
      },
    };
    assert.equal((await provisionTransactionalPilotLeads(input('3.0'), false, dependencies)).status, 'validated');
    assert.equal((await provisionTransactionalPilotLeads(input('3.0'), true, dependencies)).inserted, 4);
    assert.equal((await provisionTransactionalPilotLeads(input('3.0'), true, dependencies)).status, 'already_provisioned');
    assert.equal(inserts, 1);
  });
});

test('rejects a mismatched cohort confirmation before any dependency call', async () => {
  await withEnv(async () => {
    const mismatched = input('2.0');
    mismatched.confirmation = 'PROVISION_4_INERT_TRANSACTIONAL_PILOT_LEADS';
    let calls = 0;
    await assert.rejects(
      () => provisionTransactionalPilotLeads(mismatched, false, {
        async findExisting() { calls += 1; return []; },
        async countCampaignMatches() { calls += 1; return 0; },
        async insertAll() { calls += 1; },
      }),
      (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === 'input_invalid',
    );
    assert.equal(calls, 0);
  });
});

test('campaign, partial and mismatched sets abort without inserting', async () => {
  await withEnv(async () => {
    const rows = prepareTransactionalPilotLeadRows(input());
    for (const scenario of [
      { existing: [] as unknown[], campaign: 1, reason: 'campaign_identity_conflict' },
      { existing: rows.slice(0, 1), campaign: 0, reason: 'existing_set_conflict' },
      { existing: rows.slice(0, 2), campaign: 0, reason: 'existing_set_conflict' },
      { existing: rows.slice(0, 3), campaign: 0, reason: 'existing_set_conflict' },
      { existing: [{ ...rows[0], delivery_status: 'queued' }, ...rows.slice(1)], campaign: 0, reason: 'existing_set_conflict' },
    ]) {
      let inserts = 0;
      await assert.rejects(
        () => provisionTransactionalPilotLeads(input(), true, {
          async findExisting() { return scenario.existing; },
          async countCampaignMatches() { return scenario.campaign; },
          async insertAll() { inserts += 1; },
        }),
        (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === scenario.reason,
      );
      assert.equal(inserts, 0);
    }
  });
});

test('a concurrent atomic insert resolves to already_provisioned without upsert', async () => {
  await withEnv(async () => {
    let existing: TransactionalPilotLeadRow[] = [];
    let calls = 0;
    const result = await provisionTransactionalPilotLeads(input(), true, {
      async findExisting() { return existing; },
      async countCampaignMatches() { return 0; },
      async insertAll(rows) {
        calls += 1;
        existing = structuredClone(rows);
        throw new Error('sanitized conflict');
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, {
      status: 'already_provisioned', resources: 4, configured_identities: 4, used_identities: 1, shared_identity_mappings: 3, inserted: 0,
    });
  });
});

test('replay accepts equivalent PostgREST timestamp and JSONB key shapes, but not changed data', async () => {
  await withEnv(async () => {
    const rows = prepareTransactionalPilotLeadRows(input());
    const postgrestRows = rows.map((row) => ({
      ...structuredClone(row),
      created_at: row.created_at.replace(/\.000Z$/, '+00:00'),
      payload: Object.fromEntries(Object.entries(structuredClone(row.payload)).reverse()),
    }));
    const replay = await provisionTransactionalPilotLeads(input(), false, {
      async findExisting() { return postgrestRows; },
      async countCampaignMatches() { return 0; },
      async insertAll() { throw new Error('unexpected insert'); },
    });
    assert.equal(replay.status, 'already_provisioned');
    assert.equal(replay.inserted, 0);

    postgrestRows[0] = {
      ...postgrestRows[0],
      created_at: new Date(Date.parse(rows[0].created_at) + 1_000).toISOString(),
    };
    await assert.rejects(
      () => provisionTransactionalPilotLeads(input(), false, {
        async findExisting() { return postgrestRows; },
        async countCampaignMatches() { return 0; },
        async insertAll() { throw new Error('unexpected insert'); },
      }),
      (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === 'existing_set_conflict',
    );
  });
});

test('bulk insertion is one leads request with return=minimal and no response payload', async () => {
  const required = {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_ANON_KEY: 'anon-test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    LEAD_HASH_SECRET: secret,
    UNSUBSCRIBE_TOKEN_SECRET: 'unsubscribe-test',
    DATA_BRAIN_ADMIN_USER: 'admin-test',
    DATA_BRAIN_ADMIN_PASSWORD: 'password-test',
    MAKE_WEBHOOK_SECRET: 'M4k3-HMAC-Only-9xQ2vR7sN5cP8dL1Z',
  };
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(required)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (request, init) => {
    calls += 1;
    assert.equal(new URL(String(request)).pathname, '/rest/v1/leads');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('prefer'), 'return=minimal');
    assert.equal((JSON.parse(String(init?.body)) as unknown[]).length, 4);
    return new Response(null, { status: 201 });
  };
  try {
    await insertRowsWithoutRepresentation('leads', [{ row: 1 }, { row: 2 }, { row: 3 }, { row: 4 }]);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('portable stdin reader accepts chunked UTF-8 and CRLF without echoing content', async () => {
  const stream = Readable.from([
    Buffer.from('\r\n{"version":"1.0",', 'utf8'),
    Buffer.from('"leads":[]}\r\n', 'utf8'),
  ]);
  const raw = await readTransactionalPilotInput(stream, { timeoutMs: 1_000 });
  assert.equal(raw, '\r\n{"version":"1.0","leads":[]}\r\n');
});

test('stdin and JSON failures stop before every Supabase dependency', async () => {
  for (const [stream, reasonCode] of [
    [Readable.from([]), 'input_empty'],
    [Readable.from(['x'.repeat(33)]), 'input_too_large'],
  ] as const) {
    await assert.rejects(
      () => readTransactionalPilotInput(stream, { maxBytes: 32, timeoutMs: 1_000 }),
      (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === reasonCode,
    );
  }

  for (const raw of ['{', '{} trailing', '\uFEFF{}']) {
    let dependencyCalls = 0;
    await assert.rejects(
      () => provisionTransactionalPilotLeadsFromJson(raw, false, {
        async findExisting() { dependencyCalls += 1; return []; },
        async countCampaignMatches() { dependencyCalls += 1; return 0; },
        async insertAll() { dependencyCalls += 1; },
      }),
      (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === 'input_invalid',
    );
    assert.equal(dependencyCalls, 0);
  }
});

test('stdin reader fails closed on timeout', async () => {
  const stream = new Readable({ read() {} });
  await assert.rejects(
    () => readTransactionalPilotInput(stream, { timeoutMs: 10 }),
    (error: unknown) => error instanceof TransactionalPilotProvisionError && error.reasonCode === 'stdin_timeout',
  );
});
