import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  authorizeTransactionalIntake,
  payloadSha256,
  validateTransactionalIntakePayload,
} from './transactional-intake';

const leadHashSecretFixture = 'transactional-intake-hash-test'.padEnd(32, 'q');
const canonicalLeadId = createHmac('sha256', leadHashSecretFixture)
  .update('internal@example.test')
  .digest('hex');

const requiredEnv = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_ANON_KEY: 'anon-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  LEAD_HASH_SECRET: leadHashSecretFixture,
  UNSUBSCRIBE_TOKEN_SECRET: 'unsubscribe-test',
  DATA_BRAIN_ADMIN_USER: 'admin-test',
  DATA_BRAIN_ADMIN_PASSWORD: 'password-test',
  MAKE_WEBHOOK_SECRET: 'M4k3-HMAC-Only-9xQ2vR7sN5cP8dL1Z',
  TRANSACTIONAL_PILOT_MODE: 'true',
  TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS: canonicalLeadId,
  TRANSACTIONAL_LANDING_ORIGIN: 'https://landing.example.test',
};

const lead = {
  submission_id: 'calculator_01JTEST123',
  event_version: '1.0',
  form_type: 'calculator',
  lead_magnet: 'calculator',
  created_at: '2026-08-13T08:00:00.000Z',
  source_url: 'https://landing.example.test/#calculadora',
  lead_id: canonicalLeadId,
  lead_score: 50,
  lead_status: 'templado',
  lead_classification: 'warm',
  scoring: { fit: 10, intent: 20, engagement: 10, urgency: 10, total: 50, classification: 'warm' },
  contact: { name: 'Persona interna', email: 'internal@example.test', company: 'GFS' },
  consent: { privacy_accepted: true, marketing_accepted: false },
};

async function withMockedSupabase(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  callback: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(requiredEnv)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  globalThis.fetch = handler;
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('intake accepts only the four matching resources with privacy consent', () => {
  const previous = process.env.LEAD_HASH_SECRET;
  process.env.LEAD_HASH_SECRET = requiredEnv.LEAD_HASH_SECRET;
  try {
    assert.equal(validateTransactionalIntakePayload(lead).form_type, 'calculator');
    assert.throws(
      () => validateTransactionalIntakePayload({ ...lead, form_type: 'diagnostic', lead_magnet: 'diagnostic' }),
      /not an allowed transactional resource/,
    );
    assert.throws(
      () => validateTransactionalIntakePayload({ ...lead, lead_magnet: 'webinar' }),
      /must match/,
    );
    assert.throws(
      () => validateTransactionalIntakePayload({ ...lead, consent: { ...lead.consent, privacy_accepted: false } }),
      /privacy consent/,
    );
  } finally {
    if (previous === undefined) delete process.env.LEAD_HASH_SECRET;
    else process.env.LEAD_HASH_SECRET = previous;
  }
});

test('intake hashes the exact textual body', () => {
  const compact = JSON.stringify(lead);
  const spaced = JSON.stringify(lead, null, 2);
  assert.match(payloadSha256(compact), /^[a-f0-9]{64}$/);
  assert.notEqual(payloadSha256(compact), payloadSha256(spaced));
});

test('intake rejects a mutated recipient identity before every Supabase call', async () => {
  const mutated = {
    ...lead,
    contact: { ...lead.contact, email: 'changed@example.test' },
  };
  let calls = 0;
  await withMockedSupabase(async () => {
    calls += 1;
    throw new Error('unexpected Supabase call');
  }, async () => {
    await assert.rejects(
      () => authorizeTransactionalIntake(JSON.stringify(mutated)),
      /identity does not match/,
    );
  });
  assert.equal(calls, 0);
});

test('authorization returns only non-PII claims and the exact payload hash', async () => {
  const rawBody = JSON.stringify(lead);
  const calls: string[] = [];
  await withMockedSupabase(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${new URL(url).pathname}`);
    if (method === 'GET' && url.includes('/rest/v1/leads?')) {
      return Response.json([{
        id: 'lead-row',
        submission_id: lead.submission_id,
        lead_id: lead.lead_id,
        form_type: lead.form_type,
        lead_magnet: lead.lead_magnet,
        payload: lead,
      }]);
    }
    if (method === 'POST' && url.endsWith('/rest/v1/rpc/claim_transactional_intake')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.p_submission_id, lead.submission_id);
      assert.equal(body.p_resource, 'calculator');
      assert.equal(body.p_payload_sha256, payloadSha256(rawBody));
      assert.match(String(body.p_intake_capability_hash), /^[a-f0-9]{64}$/);
      assert.equal(body.p_pilot_recipient_allowed, true);
      return Response.json({ authorized: true, reason_code: 'claimed', claimed_at: '2026-08-13T08:00:01.000Z' });
    }
    throw new Error(`unexpected Supabase request: ${method} ${url}`);
  }, async () => {
    const result = await authorizeTransactionalIntake(rawBody);
    assert.equal(result.authorized, true);
    assert.equal(result.reasonCode, 'claimed');
    assert.equal(result.duplicate, false);
    assert.equal(result.claimedAt, '2026-08-13T08:00:01.000Z');
    assert.equal(result.payload_sha256, payloadSha256(rawBody));
    assert.deepEqual(result.claims, {
      submission_id: lead.submission_id,
      resource: 'calculator',
      event_version: '1.0',
      privacy_accepted: true,
      delivery: {
        template_id: 'calculator_result_v1',
        resource_url: 'https://landing.example.test/#calculadora',
      },
    });
    assert.match(result.intake_capability ?? '', /^[A-Za-z0-9_-]{43}$/);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /internal@example\.test|Persona interna|contact|company/i);
  });
  assert.deepEqual(calls, ['GET /rest/v1/leads', 'POST /rest/v1/rpc/claim_transactional_intake']);
});

test('a repeated intake claim is blocked and marked duplicate', async () => {
  const rawBody = JSON.stringify(lead);
  await withMockedSupabase(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET') return Response.json([{ id: 'lead-row', ...lead, payload: lead }]);
    return Response.json({ authorized: false, reason_code: 'replay_blocked', claimed_at: '2026-08-13T08:00:01.000Z' });
  }, async () => {
    const result = await authorizeTransactionalIntake(rawBody);
    assert.equal(result.authorized, false);
    assert.equal(result.duplicate, true);
  });
});

test('authorization rejects a stored lead identity mismatch before claim RPC', async () => {
  let postCalls = 0;
  await withMockedSupabase(async (input, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      return Response.json([{
        id: 'lead-row',
        ...lead,
        lead_id: 'f'.repeat(64),
        payload: lead,
      }]);
    }
    postCalls += 1;
    throw new Error('unexpected claim RPC');
  }, async () => {
    await assert.rejects(
      () => authorizeTransactionalIntake(JSON.stringify(lead)),
      /stored lead does not match/,
    );
  });
  assert.equal(postCalls, 0);
});

test('pilot allowlist fails closed when disabled, malformed, duplicated or larger than four', async () => {
  const rawBody = JSON.stringify(lead);
  for (const configured of [
    { mode: 'false', allowlist: lead.lead_id },
    { mode: 'true', allowlist: 'invalid' },
    { mode: 'true', allowlist: `${lead.lead_id},${lead.lead_id}` },
    { mode: 'true', allowlist: ['a', 'b', 'c', 'd', 'e'].map((value) => value.repeat(64)).join(',') },
  ]) {
    await withMockedSupabase(async (input, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return Response.json([{ id: 'lead-row', ...lead, payload: lead }]);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.p_pilot_recipient_allowed, false);
      return Response.json({ authorized: true, reason_code: 'claimed' });
    }, async () => {
      process.env.TRANSACTIONAL_PILOT_MODE = configured.mode;
      process.env.TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS = configured.allowlist;
      await authorizeTransactionalIntake(rawBody);
    });
  }
});
