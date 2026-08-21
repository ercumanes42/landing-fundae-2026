import assert from 'node:assert/strict';
import { test } from 'node:test';

import { processPipelineRequest, type PipelineRouteDependencies } from './route';

const campaignId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const payload = { campaign_id: campaignId, campaign_contact_id: contactId, stage: 'opportunity', estimated_amount: 12000, probability_percent: 70, expected_version: 0 };
function request(body: unknown = payload) { return new Request('https://data.example.invalid/api/dashboard/pipeline', { method: 'POST', headers: { authorization: 'Basic redacted' }, body: JSON.stringify(body) }); }
function deps(overrides: Partial<PipelineRouteDependencies> = {}): PipelineRouteDependencies {
  return {
    validateEnv: () => ({ ok: true }),
    authenticate: async () => ({ ok: true, actorHash: 'a'.repeat(64), credentialKeyId: 'key' }),
    rateLimit: async () => ({ allowed: true }),
    rpc: async () => ({ contact_ref: 'b'.repeat(64), stage: 'opportunity', version: 1, pii_included: false }),
    requestId: () => 'request-1', ...overrides,
  };
}

test('unauthorized pipeline request performs no rate-limit or RPC work', async () => {
  let effects = 0;
  const response = await processPipelineRequest(request(), deps({
    authenticate: async () => ({ ok: false, reason: 'invalid_credentials' }),
    rateLimit: async () => { effects += 1; return { allowed: true }; },
    rpc: async () => { effects += 1; return {}; },
  }));
  assert.equal(response.status, 401); assert.equal(effects, 0);
});

test('pipeline request is rate-limited before parsing or RPC', async () => {
  let calls = 0;
  const response = await processPipelineRequest(request(), deps({
    rateLimit: async () => ({ allowed: false, reason: 'limited', retryAfterSeconds: 30 }),
    rpc: async () => { calls += 1; return {}; },
  }));
  assert.equal(response.status, 429); assert.equal(calls, 0);
});

test('invalid fields, regressions and unsafe amounts fail before RPC', async () => {
  let calls = 0;
  const d = deps({ rpc: async () => { calls += 1; return {}; } });
  assert.equal((await processPipelineRequest(request({ ...payload, email: 'private@example.com' }), d)).status, 400);
  assert.equal((await processPipelineRequest(request({ ...payload, probability_percent: 101 }), d)).status, 400);
  assert.equal((await processPipelineRequest(request({ ...payload, stage: 'lost', outcome_reason: null }), d)).status, 400);
  assert.equal(calls, 0);
});

test('valid pipeline write calls the RBAC RPC once and returns redacted state', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const response = await processPipelineRequest(request(), deps({ rpc: async (name, args) => {
    calls.push({ name, args }); return { contact_ref: 'b'.repeat(64), stage: 'opportunity', version: 1, pii_included: false };
  } }));
  assert.equal(response.status, 200); assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'dashboard_upsert_revenue_pipeline');
  assert.equal(calls[0].args.p_campaign_contact_id, contactId);
  assert.equal(calls[0].args.p_expected_version, 0);
  assert.equal((await response.json()).pipeline.contact_ref, 'b'.repeat(64));
});

test('RPC denial is a stable conflict without internal details', async () => {
  const response = await processPipelineRequest(request(), deps({ rpc: async () => { throw new Error('private SQL detail'); } }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { ok: false, failure_code: 'pipeline_write_rejected' });
});
