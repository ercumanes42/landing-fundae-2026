import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enqueueAndAttemptDelivery,
  LegacyDeliveryDisabledError,
  retryDueDeliveries,
} from './delivery';
import type { LeadPayload } from './types';

const requiredEnv = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_ANON_KEY: 'anon-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  LEAD_HASH_SECRET: 'delivery-hash-test'.padEnd(32, 'q'),
  UNSUBSCRIBE_TOKEN_SECRET: 'Z7fL3xP8vN2qR6mK9cD4wH1sB5tY0gUa',
  DATA_BRAIN_ADMIN_USER: 'admin-test',
  DATA_BRAIN_ADMIN_PASSWORD: 'password-test',
  MAKE_WEBHOOK_SECRET: 'M4k3-HMAC-Only-9xQ2vR7sN5cP8dL1Z',
  OUTBOUND_MASTER_ENABLED: 'true',
  LEGACY_MAKE_DELIVERY_ENABLED: 'true',
  LEGACY_DELIVERY_RETRY_ENABLED: 'true',
};

function payload(): LeadPayload {
  return {
    submission_id: 'calculator_01JTEST123',
    event_version: '1.0',
    form_type: 'calculator',
    lead_magnet: 'calculator',
    created_at: '2026-08-11T10:00:00.000Z',
    source_url: 'https://example.test/calculadora',
    lead_id: 'lead_01JTEST123',
    lead_score: 21,
    lead_status: 'new',
    lead_classification: 'cold',
    scoring: { fit: 0, intent: 17, engagement: 0, urgency: 4, total: 21, classification: 'cold' },
    contact: { name: '', email: 'persona@example.com', company: '' },
    consent: { privacy_accepted: true, marketing_accepted: false },
  };
}

function row(status: 'queued' | 'retrying' | 'delivered' | 'dead_letter' = 'queued') {
  return {
    id: 'queue_01JTEST123',
    lead_id: 'lead_01JTEST123',
    submission_id: 'calculator_01JTEST123',
    target: 'make' as const,
    payload: payload(),
    status,
    attempt_count: status === 'delivered' ? 1 : 0,
    next_attempt_at: '2026-08-11T10:00:00.000Z',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function withDeliveryEnvironment(run: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(requiredEnv)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  previous.set('MAKE_WEBHOOK_URL', process.env.MAKE_WEBHOOK_URL);
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('delivered submission is idempotent and is not enqueued or sent again', () => withDeliveryEnvironment(async () => {
  process.env.MAKE_WEBHOOK_URL = 'https://make.test/hook';
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    assert.equal(method, 'GET');
    assert.match(url, /delivery_queue\?select=/);
    return json([row('delivered')]);
  };

  const result = await enqueueAndAttemptDelivery(payload());
  assert.equal(result.status, 'delivered');
  assert.equal(calls.length, 1);
}));

test('legacy delivery fails closed before database access when switches are absent', () => withDeliveryEnvironment(async () => {
  delete process.env.OUTBOUND_MASTER_ENABLED;
  delete process.env.LEGACY_MAKE_DELIVERY_ENABLED;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('unexpected network call');
  };

  await assert.rejects(
    enqueueAndAttemptDelivery(payload()),
    (error: unknown) => (
      error instanceof LegacyDeliveryDisabledError &&
      error.code === 'LEGACY_MAKE_DELIVERY_DISABLED'
    ),
  );
  assert.equal(calls, 0);
}));

test('master kill switch dominates lane flags and retry remains inert', () => withDeliveryEnvironment(async () => {
  process.env.OUTBOUND_MASTER_ENABLED = 'false';
  process.env.LEGACY_MAKE_DELIVERY_ENABLED = 'true';
  process.env.LEGACY_DELIVERY_RETRY_ENABLED = 'true';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('unexpected network call');
  };

  await assert.rejects(
    retryDueDeliveries(),
    (error: unknown) => (
      error instanceof LegacyDeliveryDisabledError &&
      error.code === 'LEGACY_MAKE_DELIVERY_DISABLED'
    ),
  );
  assert.equal(calls, 0);
}));

test('non-boolean switch values never enable legacy delivery', () => withDeliveryEnvironment(async () => {
  process.env.OUTBOUND_MASTER_ENABLED = '1';
  process.env.LEGACY_MAKE_DELIVERY_ENABLED = 'true';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('unexpected network call');
  };

  await assert.rejects(enqueueAndAttemptDelivery(payload()), LegacyDeliveryDisabledError);
  assert.equal(calls, 0);
}));

test('missing Make configuration becomes a retry, never a false delivery', () => withDeliveryEnvironment(async () => {
  delete process.env.MAKE_WEBHOOK_URL;
  const queued = row('queued');
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (method === 'GET') return json([queued]);
    if (method === 'PATCH') {
      const patch = JSON.parse(String(init?.body));
      return json([{ ...queued, ...patch }]);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const result = await enqueueAndAttemptDelivery(payload());
  assert.equal(result.status, 'retrying');
  assert.equal(result.attempt_count, 1);
  assert.match(result.last_error ?? '', /MAKE_WEBHOOK_URL is not configured/);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'PATCH']);
}));

test('new submission is queued once and marked delivered after Make succeeds', () => withDeliveryEnvironment(async () => {
  process.env.MAKE_WEBHOOK_URL = 'https://make.test/hook';
  const queued = row('queued');
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });

    if (url.startsWith('https://make.test/')) return new Response(null, { status: 204 });
    if (method === 'GET') return json([]);
    if (method === 'POST') return json([queued]);
    if (method === 'PATCH') {
      const patch = JSON.parse(String(init?.body));
      return json([{ ...queued, ...patch }]);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const result = await enqueueAndAttemptDelivery(payload());
  assert.equal(result.status, 'delivered', JSON.stringify({ result, calls }));
  assert.equal(result.attempt_count, 1);
  assert.ok(result.accepted_by_make_at);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'POST', 'PATCH']);
  assert.equal(calls.filter((call) => call.url.startsWith('https://make.test/')).length, 1);
}));
