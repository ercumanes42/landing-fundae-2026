import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';

import { hubSpotPropertiesForOperation, recordCampaignOperation, recordHubSpotContactEvent } from './campaign';
import { buildLeadId } from './lead-id';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const LEAD_ID = 'a'.repeat(64);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://supabase.invalid',
    SUPABASE_ANON_KEY: 'anon-test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    LEAD_HASH_SECRET: 'lead-test-secret',
    DATA_BRAIN_ADMIN_USER: 'admin',
    DATA_BRAIN_ADMIN_PASSWORD: 'password',
    CAMPAIGN_DEFAULT_EXTERNAL_ID: 'FUNDAE_2026',
    OUTBOUND_MASTER_ENABLED: 'true',
    HUBSPOT_SYNC_ENABLED: 'true',
    HUBSPOT_ACCESS_TOKEN: 'hubspot-test-token',
    HUBSPOT_API_VERSION: '2026-03',
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test('unsubscribe, opposition, hard bounce and positive reply produce convergent partial CRM patches', () => {
  const occurredAt = '2026-08-19T09:00:00.000Z';
  assert.deepEqual(hubSpotPropertiesForOperation('unsubscribe', { sequence_status: 'stopped' }, occurredAt), {
    fundae_sequence_status: 'stopped',
    fundae_suppression_scope: 'all',
    fundae_suppression_reason: 'unsubscribe',
    fundae_unsubscribed_at: occurredAt,
  });
  assert.deepEqual(hubSpotPropertiesForOperation('bounce_hard', {}, occurredAt), {
    fundae_sequence_status: 'stopped',
    fundae_suppression_scope: 'marketing',
    fundae_suppression_reason: 'hard_bounce',
    fundae_hard_bounce_at: occurredAt,
  });
  assert.deepEqual(hubSpotPropertiesForOperation('opposition', {}, occurredAt), {
    fundae_sequence_status: 'stopped',
    fundae_suppression_scope: 'marketing',
    fundae_suppression_reason: 'opposition',
  });
  assert.deepEqual(hubSpotPropertiesForOperation('positive_reply', {}, occurredAt), {
    fundae_sequence_status: 'stopped',
    fundae_reply_type: 'positive',
    fundae_positive_reply_at: occurredAt,
  });
});

test('primary positive reply and its replay resolve to exactly one logical HubSpot task', async () => {
  let eventExists = false;
  const eventRpcBodies: Array<Record<string, unknown>> = [];
  const taskRequests: Array<{ url: string; body: { inputs: Array<Record<string, unknown>> } }> = [];
  const contact = {
    id: 'db-contact-1',
    external_contact_id: 'lead_001',
    email_hash: LEAD_ID,
    hubspot_contact_id: '101',
    campaign_id: 'campaign-db-1',
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://supabase.invalid/rest/v1/campaigns?')) {
      return json([{ id: 'campaign-db-1', external_id: 'FUNDAE_2026' }]);
    }
    if (url.startsWith('https://supabase.invalid/rest/v1/campaign_contacts?') && init?.method === 'GET') {
      return json([contact]);
    }
    if (url.endsWith('/rest/v1/rpc/record_campaign_event_atomic') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      eventRpcBodies.push(body);
      assert.equal(body.p_source_event_id, 'reply:event:001');
      assert.equal(body.p_contact_external_id, 'lead_001');
      assert.equal(body.p_event_name, 'positive_reply');
      const duplicate = eventExists;
      eventExists = true;
      return json({ id: 'event-db-1', duplicate });
    }
    if (url.includes('/campaign_contacts?id=eq.') && init?.method === 'PATCH') return json([contact]);
    if (url.includes(`/contacts/${LEAD_ID}?idProperty=fundae_lead_id`)) return json({ id: '101' });
    if (url.includes('/tasks/batch/upsert')) {
      const body = JSON.parse(String(init?.body));
      taskRequests.push({ url, body });
      return json({ results: [{ id: '301', objectWriteTraceId: body.inputs[0].objectWriteTraceId }] });
    }
    if (url.includes('/tasks/301/associations/contacts/101/task_to_contact')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request ${init?.method || 'GET'} ${url}`);
  };
  const input = {
    campaign_external_id: 'FUNDAE_2026',
    contact_id: 'lead_001',
    event_name: 'positive_reply',
    source_event_id: 'reply:event:001',
    occurred_at: '2026-08-19T09:00:00.000Z',
  };
  const first = await recordCampaignOperation(input);
  const replay = await recordCampaignOperation(input);
  assert.equal(first.id, 'event-db-1');
  assert.equal(replay.id, first.id);
  assert.equal(eventRpcBodies.length, 2);
  assert.deepEqual(eventRpcBodies[1], eventRpcBodies[0]);
  assert.equal(taskRequests.length, 2);
  assert.match(taskRequests[0].url, /tasks\/batch\/upsert$/);
  assert.deepEqual(taskRequests[1].body, taskRequests[0].body);
  assert.equal(new Set(taskRequests.map(({ body }) => body.inputs[0].id)).size, 1);
  assert.equal(taskRequests.some(({ url }) => url.includes('/tasks/batch/create')), false);
});

test('capture and campaign import share the same normalized HMAC buildLeadId contract', () => {
  const ingestSource = readFileSync(
    new URL('../app/api/leads/ingest/route.ts', import.meta.url),
    'utf8',
  );
  const campaignSource = readFileSync(new URL('./campaign.ts', import.meta.url), 'utf8');
  assert.match(ingestSource, /const leadId = buildLeadId\(input\.contact\.email\)/);
  assert.match(campaignSource, /email_hash: buildLeadId\(contact\.email\)/);

  const normalizedEmail = 'person@example.invalid';
  const expected = createHmac('sha256', 'lead-test-secret').update(normalizedEmail).digest('hex');
  assert.equal(buildLeadId(' Person@Example.Invalid '), expected);
});

test('ambiguous HubSpot contact mapping fails before campaign mutation', async () => {
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/campaign_contacts?') && init?.method === 'GET') {
      return json([
        { id: 'one', external_contact_id: 'lead_001', hubspot_contact_id: '101', campaign_id: 'campaign-one' },
        { id: 'two', external_contact_id: 'lead_001', hubspot_contact_id: '101', campaign_id: 'campaign-two' },
      ]);
    }
    writes += 1;
    return json([]);
  };
  await assert.rejects(recordHubSpotContactEvent({
    hubspotContactId: '101',
    sourceEventId: `hs:${'a'.repeat(64)}`,
    propertyName: 'fundae_reply_type',
    propertyValue: 'positive',
    occurredAt: '2026-08-19T09:00:00.000Z',
  }), /ambiguous/);
  assert.equal(writes, 0);
});

test('positive reply echoed from HubSpot records the fact without creating another CRM task', async () => {
  let taskRequests = 0;
  const contact = {
    id: 'db-contact-1',
    external_contact_id: 'lead_001',
    email_hash: LEAD_ID,
    hubspot_contact_id: '101',
    campaign_id: 'campaign-db-1',
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/campaign_contacts?') && init?.method === 'GET') return json([contact]);
    if (url.includes('/campaigns?') && init?.method === 'GET') {
      return json([{ id: 'campaign-db-1', external_id: 'FUNDAE_2026' }]);
    }
    if (url.endsWith('/rest/v1/rpc/record_campaign_event_atomic') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(body.p_event_name, 'positive_reply');
      assert.equal(body.p_source_event_id, `hs:${'b'.repeat(64)}`);
      return json({ id: 'event-db-1' });
    }
    if (url.includes('/tasks/')) {
      taskRequests += 1;
      return json({});
    }
    throw new Error(`Unexpected request ${init?.method || 'GET'} ${url}`);
  };

  assert.equal(await recordHubSpotContactEvent({
    hubspotContactId: '101',
    sourceEventId: `hs:${'b'.repeat(64)}`,
    propertyName: 'fundae_reply_type',
    propertyValue: 'positive',
    occurredAt: '2026-08-19T09:00:00.000Z',
  }), true);
  assert.equal(taskRequests, 0);
});

test('campaign source event replay rejects a different contact or event binding', async () => {
  const writes: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/campaigns?')) return json([{ id: 'campaign-db-1', external_id: 'FUNDAE_2026' }]);
    if (url.endsWith('/rest/v1/rpc/record_campaign_event_atomic') && init?.method === 'POST') {
      writes.push(url);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(body.p_source_event_id, 'reply:event:collision');
      return json({ message: 'Campaign source event collision' }, 409);
    }
    throw new Error(`Unexpected request after collision ${init?.method || 'GET'} ${url}`);
  };
  await assert.rejects(recordCampaignOperation({
    campaign_external_id: 'FUNDAE_2026',
    contact_id: 'lead_001',
    event_name: 'positive_reply',
    source_event_id: 'reply:event:collision',
  }), /source event collision/);
  assert.equal(writes.length, 1);
});
