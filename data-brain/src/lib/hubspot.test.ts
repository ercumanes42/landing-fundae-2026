import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  HUBSPOT_CONTACT_ID_PROPERTY,
  HUBSPOT_TASK_ID_PROPERTY,
  hubSpotContactProperties,
  parseHubSpotWebhookEvent,
  syncHubSpotCampaignContacts,
  updateHubSpotContact,
  upsertPositiveReplyTask,
  type HubSpotCampaignContact,
} from './hubspot';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

const contact = (overrides: Partial<HubSpotCampaignContact> = {}): HubSpotCampaignContact => ({
  externalContactId: 'lead_001',
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
      return json({ results: [{ id: '101', objectWriteTraceId: 'lead_001' }] });
    }
    if (url.includes('/companies/batch/upsert')) {
      return json({ results: [{ id: '201', objectWriteTraceId: 'account_001' }] });
    }
    if (url.includes('/associations/')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request ${url}`);
  };

  const result = await syncHubSpotCampaignContacts([contact()]);
  assert.equal(result.contactIds.get('lead_001'), '101');
  assert.deepEqual(result.failures, []);
  const upsert = calls.find((call) => call.url.includes('/contacts/batch/upsert'))!;
  const input = (upsert.body as { inputs: Array<Record<string, unknown>> }).inputs[0];
  assert.equal(input.id, 'lead_001');
  assert.equal(input.idProperty, HUBSPOT_CONTACT_ID_PROPERTY);
  assert.notEqual(input.idProperty, 'email');
  assert.equal((input.properties as Record<string, string>).fundae_contact_id, 'lead_001');
  assert.ok(!('firstname' in (input.properties as Record<string, string>)));
  assert.ok(!('lastname' in (input.properties as Record<string, string>)));
});

test('replay is deterministic and conflicting duplicate lead identities fail before network', async () => {
  const bodies: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.body) bodies.push(String(init.body));
    if (url.includes('/contacts/')) return json({ results: [{ id: '101', objectWriteTraceId: 'lead_001' }] });
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

test('a 207 response preserves correlated successes and reports only the failed input', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/contacts/')) return json({
      status: 'COMPLETE',
      results: [{ id: '101', objectWriteTraceId: 'lead_001' }],
      errors: [{ category: 'VALIDATION_ERROR', context: { objectWriteTraceId: ['lead_002'] } }],
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
    contact({ externalContactId: 'lead_002', externalAccountId: 'account_002', email: 'two@example.com' }),
  ]);
  assert.equal(result.contactIds.get('lead_001'), '101');
  assert.equal(result.contactIds.has('lead_002'), false);
  assert.ok(result.failures.some((failure) => failure.externalId === 'lead_002' && failure.stage === 'contact'));
});

test('uncorrelated or contradictory batch outcomes fail closed', async () => {
  globalThis.fetch = async () => json({ results: [{ id: '101', objectWriteTraceId: 'unexpected' }] });
  await assert.rejects(syncHubSpotCampaignContacts([contact()]), /correlation failed/);

  globalThis.fetch = async () => json({
    results: [{ id: '101', objectWriteTraceId: 'lead_001' }],
    errors: [{ context: { objectWriteTraceId: ['lead_001'] } }],
  }, 207);
  await assert.rejects(syncHubSpotCampaignContacts([contact()]), /outcome collision/);
});

test('partial contact updates use the custom unique id and omit undefined or null fields', async () => {
  let request: { url: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), body: JSON.parse(String(init?.body)) };
    return json({ id: '101' });
  };
  await updateHubSpotContact('lead_001', {
    fundae_sequence_status: 'stopped',
    fundae_reply_type: undefined,
    fundae_pipeline_value: null,
  });
  assert.match(request!.url, /contacts\/lead_001\?idProperty=fundae_contact_id$/);
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
    externalContactId: 'lead_001',
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
  assert.equal(properties.fundae_contact_id, 'lead_001');
});
