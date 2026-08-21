import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  HUBSPOT_CONTACT_ID_PROPERTY,
  HUBSPOT_PROPERTY_MANIFEST,
  HUBSPOT_TASK_ID_PROPERTY,
  hubSpotContactProperties,
  parseHubSpotWebhookEvent,
  syncHubSpotCampaignContacts,
  testHubSpotConnection,
  updateHubSpotContact,
  upsertPositiveReplyTask,
  type HubSpotCampaignContact,
} from './hubspot';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const LEAD_ID = 'a'.repeat(64);
const SECOND_LEAD_ID = 'b'.repeat(64);

const contact = (overrides: Partial<HubSpotCampaignContact> = {}): HubSpotCampaignContact => ({
  leadId: LEAD_ID,
  externalContactId: 'campaign_contact_001',
  externalAccountId: 'account_001',
  email: 'person@example.com',
  campaignExternalId: 'FUNDAE_2026',
  variant: 'Checklist',
  magnet: 'checklist',
  sequenceStatus: 'pending',
  ...overrides,
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  process.env.OUTBOUND_MASTER_ENABLED = 'true';
  process.env.HUBSPOT_SYNC_ENABLED = 'true';
  process.env.HUBSPOT_ACCESS_TOKEN = 'test-token-never-sent';
  process.env.HUBSPOT_PORTAL_ID = '9001';
  process.env.HUBSPOT_API_VERSION = '2026-03';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test('contact upsert uses the custom unique lead id and omits unwritten optional fields', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes('/contacts/batch/upsert')) {
      return json({ results: [{ id: '101', objectWriteTraceId: LEAD_ID }] });
    }
    if (url.includes('/companies/batch/upsert')) {
      return json({ results: [{ id: '201', objectWriteTraceId: 'account_001' }] });
    }
    if (url.includes('/associations/')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request ${url}`);
  };

  const result = await syncHubSpotCampaignContacts([contact()]);
  assert.equal(result.contactIds.get(LEAD_ID), '101');
  assert.deepEqual(result.failures, []);
  const upsert = calls.find((call) => call.url.includes('/contacts/batch/upsert'))!;
  const input = (upsert.body as { inputs: Array<Record<string, unknown>> }).inputs[0];
  assert.equal(input.id, LEAD_ID);
  assert.equal(input.idProperty, HUBSPOT_CONTACT_ID_PROPERTY);
  assert.notEqual(input.idProperty, 'email');
  assert.equal((input.properties as Record<string, string>).fundae_lead_id, LEAD_ID);
  assert.equal((input.properties as Record<string, string>).fundae_contact_id, 'campaign_contact_001');
  const association = calls.find((call) => call.url.endsWith('/contacts/companies/batch/associate/default'))!;
  assert.equal(association.method, 'POST');
  assert.deepEqual(association.body, {
    inputs: [{ from: { id: '101' }, to: { id: '201' } }],
  });
  assert.ok(!('firstname' in (input.properties as Record<string, string>)));
  assert.ok(!('lastname' in (input.properties as Record<string, string>)));
});

test('replay is deterministic and conflicting duplicate lead identities fail before network', async () => {
  const bodies: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.body) bodies.push(String(init.body));
    if (url.includes('/contacts/')) return json({ results: [{ id: '101', objectWriteTraceId: LEAD_ID }] });
    if (url.includes('/companies/')) return json({ results: [{ id: '201', objectWriteTraceId: 'account_001' }] });
    return new Response(null, { status: 204 });
  };
  await syncHubSpotCampaignContacts([contact()]);
  const first = [...bodies];
  bodies.length = 0;
  await syncHubSpotCampaignContacts([contact()]);
  assert.deepEqual(bodies, first);

  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return json({}); };
  await assert.rejects(
    syncHubSpotCampaignContacts([contact(), contact({ email: 'different@example.com' })]),
    /Conflicting contact identity/,
  );
  assert.equal(calls, 0);
});

test('two campaign external ids for the same lead upsert exactly one HubSpot contact', async () => {
  let contactInputs: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/contacts/batch/upsert')) {
      const body = JSON.parse(String(init?.body)) as { inputs: Array<Record<string, unknown>> };
      contactInputs = body.inputs;
      return json({ results: [{ id: '101', objectWriteTraceId: LEAD_ID }] });
    }
    if (url.includes('/companies/batch/upsert')) {
      return json({ results: [{ id: '201', objectWriteTraceId: 'account_001' }] });
    }
    if (url.includes('/associations/')) return json({ results: [], numErrors: 0 });
    throw new Error(`Unexpected request ${url}`);
  };

  const result = await syncHubSpotCampaignContacts([
    contact(),
    contact({
      externalContactId: 'campaign_contact_999',
      campaignExternalId: 'FUNDAE_2027',
      variant: 'Webinar',
      magnet: 'webinar',
      sequenceStatus: 'active',
      companySize: 'large',
    }),
  ]);
  assert.equal(contactInputs.length, 1);
  assert.equal(contactInputs[0].id, LEAD_ID);
  assert.equal(result.contactIds.size, 1);
  assert.equal(result.contactIds.get(LEAD_ID), '101');
});

test('association 200 with embedded errors fails every correlated campaign record closed', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/contacts/batch/upsert')) {
      return json({ results: [{ id: '101', objectWriteTraceId: LEAD_ID }] });
    }
    if (url.includes('/companies/batch/upsert')) {
      return json({ results: [{ id: '201', objectWriteTraceId: 'account_001' }] });
    }
    if (url.includes('/associations/')) {
      return json({ numErrors: 1, errors: [{ category: 'VALIDATION_ERROR' }] });
    }
    throw new Error(`Unexpected request ${url}`);
  };

  const result = await syncHubSpotCampaignContacts([contact()]);
  assert.ok(result.failures.some((failure) =>
    failure.externalId === 'campaign_contact_001' &&
    failure.stage === 'association' &&
    failure.reason === 'association_failed'));
});

test('association PENDING or non-numeric numErrors never reports a successful correlation', async () => {
  for (const associationResponse of [
    { status: 'PENDING', numErrors: 0 },
    { status: 'COMPLETE', numErrors: '0' },
  ]) {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/contacts/batch/upsert')) {
        return json({ results: [{ id: '101', objectWriteTraceId: LEAD_ID }] });
      }
      if (url.includes('/companies/batch/upsert')) {
        return json({ results: [{ id: '201', objectWriteTraceId: 'account_001' }] });
      }
      if (url.includes('/associations/')) return json(associationResponse);
      throw new Error(`Unexpected request ${url}`);
    };

    const result = await syncHubSpotCampaignContacts([contact()]);
    assert.deepEqual(result.failures, [{
      externalId: 'campaign_contact_001',
      stage: 'association',
      reason: 'association_failed',
    }]);
  }
});

test('a 207 response preserves correlated successes and reports only the failed input', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/contacts/')) return json({
      status: 'COMPLETE',
      results: [{ id: '101', objectWriteTraceId: LEAD_ID }],
      errors: [{ category: 'VALIDATION_ERROR', context: { objectWriteTraceId: [SECOND_LEAD_ID] } }],
    }, 207);
    if (url.includes('/companies/')) return json({
      results: [
        { id: '201', objectWriteTraceId: 'account_001' },
        { id: '202', objectWriteTraceId: 'account_002' },
      ],
    });
    return new Response(null, { status: 204 });
  };
  const result = await syncHubSpotCampaignContacts([
    contact(),
    contact({ leadId: SECOND_LEAD_ID, externalContactId: 'campaign_contact_002', externalAccountId: 'account_002', email: 'two@example.com' }),
  ]);
  assert.equal(result.contactIds.get(LEAD_ID), '101');
  assert.equal(result.contactIds.has(SECOND_LEAD_ID), false);
  assert.ok(result.failures.some((failure) => failure.externalId === SECOND_LEAD_ID && failure.stage === 'contact'));
});

test('uncorrelated or contradictory batch outcomes fail closed', async () => {
  globalThis.fetch = async () => json({ results: [{ id: '101', objectWriteTraceId: 'unexpected' }] });
  await assert.rejects(syncHubSpotCampaignContacts([contact()]), /correlation failed/);

  globalThis.fetch = async () => json({
    results: [{ id: '101', objectWriteTraceId: LEAD_ID }],
    errors: [{ context: { objectWriteTraceId: [LEAD_ID] } }],
  }, 207);
  await assert.rejects(syncHubSpotCampaignContacts([contact()]), /outcome collision/);

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/contacts/')) {
      return json({ numErrors: 1, results: [{ id: '101', objectWriteTraceId: LEAD_ID }] });
    }
    return json({});
  };
  await assert.rejects(syncHubSpotCampaignContacts([contact()]), /error correlation failed/);
});

test('partial contact updates use the custom unique id and omit undefined or null fields', async () => {
  let request: { url: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), body: JSON.parse(String(init?.body)) };
    return json({ id: '101' });
  };
  await updateHubSpotContact(LEAD_ID, {
    fundae_sequence_status: 'stopped',
    fundae_reply_type: undefined,
    fundae_pipeline_value: null,
  });
  assert.match(request!.url, new RegExp(`contacts/${LEAD_ID}\\?idProperty=fundae_lead_id$`));
  assert.deepEqual(request!.body, { properties: { fundae_sequence_status: 'stopped' } });
});

test('positive reply task replay upserts one deterministic key and reuses its association', async () => {
  const taskBodies: Array<{ inputs: Array<Record<string, unknown>> }> = [];
  const associations: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/tasks/batch/upsert')) {
      const body = JSON.parse(String(init?.body));
      taskBodies.push(body);
      const trace = body.inputs[0].objectWriteTraceId;
      return json({ results: [{ id: '301', objectWriteTraceId: trace }] });
    }
    if (url.includes('/tasks/301/associations/contacts/101/task_to_contact')) {
      associations.push(url);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const input = {
    campaignExternalId: 'FUNDAE_2026',
    externalContactId: 'campaign_contact_001',
    hubspotContactId: '101',
    sourceEventId: 'reply:event:001',
    occurredAt: '2026-08-19T09:00:00.000Z',
  };
  const first = await upsertPositiveReplyTask(input);
  const replay = await upsertPositiveReplyTask(input);
  assert.equal(first.taskId, '301');
  assert.equal(replay.idempotencyKey, first.idempotencyKey);
  assert.equal(taskBodies.length, 2);
  assert.deepEqual(taskBodies[1], taskBodies[0]);
  assert.equal(taskBodies[0].inputs[0].idProperty, HUBSPOT_TASK_ID_PROPERTY);
  assert.equal(taskBodies[0].inputs[0].id, first.idempotencyKey);
  assert.equal(associations.length, 2);
});

test('HubSpot flag and outbound master independently dominate before any network call', async () => {
  for (const disabled of [
    { OUTBOUND_MASTER_ENABLED: 'true', HUBSPOT_SYNC_ENABLED: 'false' },
    { OUTBOUND_MASTER_ENABLED: 'false', HUBSPOT_SYNC_ENABLED: 'true' },
    { OUTBOUND_MASTER_ENABLED: 'true', HUBSPOT_SYNC_ENABLED: 'False' },
  ]) {
    Object.assign(process.env, disabled);
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return json({}); };
    await assert.rejects(syncHubSpotCampaignContacts([contact()]), /HUBSPOT_SYNC_ENABLED is false/);
    assert.equal(calls, 0);
  }
});

function propertyCatalog(objectType: keyof typeof HUBSPOT_PROPERTY_MANIFEST) {
  return {
    results: HUBSPOT_PROPERTY_MANIFEST[objectType].map((expected) => ({
      name: expected.name,
      type: expected.acceptedTypes[0],
      hasUniqueValue: expected.unique,
    })),
  };
}

test('read-only preflight verifies expected portal and the complete property manifest with flags off', async () => {
  process.env.OUTBOUND_MASTER_ENABLED = 'false';
  process.env.HUBSPOT_SYNC_ENABLED = 'false';
  const requests: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method || 'GET' });
    if (url.endsWith('/account-info/2026-03/details')) return json({ portalId: 9001 });
    const objectType = url.split('/').at(-1) as keyof typeof HUBSPOT_PROPERTY_MANIFEST;
    return json(propertyCatalog(objectType));
  };
  assert.deepEqual(await testHubSpotConnection(), {
    ok: true,
    mode: 'read_only',
    portal: { matches_expected: true },
    objects: {
      contacts: { checked_properties: HUBSPOT_PROPERTY_MANIFEST.contacts.length },
      companies: { checked_properties: HUBSPOT_PROPERTY_MANIFEST.companies.length },
      tasks: { checked_properties: HUBSPOT_PROPERTY_MANIFEST.tasks.length },
    },
  });
  assert.equal(requests.length, 4);
  assert.ok(requests.every(({ method }) => method === 'GET'));
  assert.ok(requests.some(({ url }) => url.endsWith('/crm/properties/2026-03/contacts')));

  delete process.env.HUBSPOT_ACCESS_TOKEN;
  assert.deepEqual(await testHubSpotConnection(), {
    ok: false,
    mode: 'read_only',
    failure_code: 'configuration_invalid',
  });
});

test('read-only preflight reports missing and wrong-type properties without upstream content', async () => {
  for (const expectedFailure of ['property_missing', 'property_type_mismatch'] as const) {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/account-info/2026-03/details')) return json({ portalId: 9001 });
      const objectType = url.split('/').at(-1) as keyof typeof HUBSPOT_PROPERTY_MANIFEST;
      const catalog = propertyCatalog(objectType);
      if (objectType === 'contacts') {
        if (expectedFailure === 'property_missing') {
          catalog.results = catalog.results.filter(({ name }) => name !== HUBSPOT_CONTACT_ID_PROPERTY);
        } else {
          const target = catalog.results.find(({ name }) => name === HUBSPOT_CONTACT_ID_PROPERTY)!;
          target.type = 'number';
        }
      }
      return json(catalog);
    };
    const report = await testHubSpotConnection();
    assert.deepEqual(report, {
      ok: false,
      mode: 'read_only',
      failure_code: expectedFailure,
      check: { object: 'contacts', property: HUBSPOT_CONTACT_ID_PROPERTY },
    });
    assert.doesNotMatch(JSON.stringify(report), /portalId|test-token|correlation/i);
  }
});

test('read-only preflight rejects a different portal without reading property catalogs', async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return json({ portalId: 9002 });
  };
  const report = await testHubSpotConnection();
  assert.deepEqual(report, { ok: false, mode: 'read_only', failure_code: 'portal_mismatch' });
  assert.equal(requests, 1);
  assert.doesNotMatch(JSON.stringify(report), /9001|9002|portalId/);
});

test('read-only preflight redacts denied and partial upstream responses', async () => {
  for (const [status, failureCode] of [
    [403, 'upstream_access_denied'],
    [207, 'upstream_partial_response'],
  ] as const) {
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return json({
        message: 'sensitive upstream detail',
        correlationId: 'do-not-return',
      }, status);
    };
    const report = await testHubSpotConnection();
    assert.deepEqual(report, { ok: false, mode: 'read_only', failure_code: failureCode });
    assert.equal(requests, 1);
    assert.doesNotMatch(JSON.stringify(report), /sensitive|correlation|do-not-return/i);
  }
});

test('webhook correlation does not trust eventId alone and fails closed on missing or mismatched identity', () => {
  const base = {
    eventId: 77,
    objectId: 101,
    subscriptionId: 5,
    portalId: 9001,
    appId: 42,
    occurredAt: 1787126400000,
    subscriptionType: 'contact.propertyChange',
    propertyName: 'fundae_meeting_status',
    propertyValue: 'booked',
  };
  const first = parseHubSpotWebhookEvent(base, '9001');
  const second = parseHubSpotWebhookEvent({ ...base, objectId: 102 }, '9001');
  const differentValue = parseHubSpotWebhookEvent({ ...base, propertyValue: 'confirmed' }, '9001');
  assert.notEqual(first.sourceEventId, second.sourceEventId);
  assert.notEqual(first.sourceEventId, differentValue.sourceEventId);
  assert.match(first.sourceEventId, /^hs:[a-f0-9]{64}$/);
  assert.throws(() => parseHubSpotWebhookEvent({ ...base, portalId: 2 }, '9001'), /portal mismatch/);
  assert.throws(() => parseHubSpotWebhookEvent({ ...base, subscriptionId: undefined }, '9001'), /Incomplete/);
  assert.throws(() => parseHubSpotWebhookEvent({ ...base, eventType: 'contact.creation' }, '9001'), /type collision/);
  assert.throws(() => parseHubSpotWebhookEvent({ ...base, propertyValue: 'unknown' }, '9001'), /Unsupported/);
});

test('pure contact property builder never clears missing optional fields', () => {
  const properties = hubSpotContactProperties(contact({ firstName: undefined, companySize: undefined }));
  assert.ok(!('firstname' in properties));
  assert.ok(!('fundae_company_size' in properties));
  assert.equal(properties.fundae_lead_id, LEAD_ID);
  assert.equal(properties.fundae_contact_id, 'campaign_contact_001');
});
