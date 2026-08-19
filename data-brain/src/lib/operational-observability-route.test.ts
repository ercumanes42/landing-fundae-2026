import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { POST } from '../app/api/internal/observability/route';

const SECRET = 'observability-secret-32-characters!';
const SPOOFED_ACTOR = 'b'.repeat(64);
const NOW = '2026-08-19T12:00:00.000Z';

const cleanSnapshot = {
  generated_at: NOW,
  heartbeats: [
    'oauth', 'mailbox', 'reply_processor', 'unsubscribe_processor',
    'hard_bounce_processor', 'hubspot_sync', 'make_scheduler', 'dashboard',
  ].map((signal_code) => ({ signal_code, status: 'healthy', observed_at: NOW, metrics: {} })),
  graph: { aged_10m: 0, aged_30m: 0, ambiguous: 0, dlq: 0, sent_unconfirmed_10m: 0 },
  inbound: { manual_review_open: 0, manual_review_oldest_seconds: 0 },
  campaign: { queued_aged_15m: 0, ambiguous: 0, in_flight: 0 },
  pacing: { cold_sent_today: 0, spacing_violations: 0 },
  events_24h: { replies_24h: 0, unsubscribes_24h: 0, hard_bounces_24h: 0 },
  alerts: { open: 0, acknowledged: 0, critical: 0 },
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

async function withRuntime(action: () => Promise<void>) {
  const keys = [
    'OPERATIONAL_OBSERVABILITY_ENABLED', 'OBSERVABILITY_WORKER_SECRET',
    'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'LEAD_HASH_SECRET',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, {
    OPERATIONAL_OBSERVABILITY_ENABLED: 'true',
    OBSERVABILITY_WORKER_SECRET: SECRET,
    SUPABASE_URL: 'https://local.invalid',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    LEAD_HASH_SECRET: 'hash-secret',
  });
  try {
    await action();
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function request(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/internal/observability', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, ...headers },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

test('evaluate ignores spoofed actor and persists only the server-derived machine actor', () => withRuntime(async () => {
  const rpcBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    rpcBodies.push(body);
    return rpcBodies.length === 1 ? json(cleanSnapshot) : json({ accepted: true });
  };
  const response = await POST(request(JSON.stringify({ action: 'evaluate' }), {
    'X-Actor-Hash': SPOOFED_ACTOR,
  }));
  assert.equal(response.status, 200);
  const expected = createHmac('sha256', SECRET).update('observability-machine-v1').digest('hex');
  assert.equal(rpcBodies[1].p_actor_hash, expected);
  assert.notEqual(rpcBodies[1].p_actor_hash, SPOOFED_ACTOR);
}));

test('chunked body without content-length is bounded at 8 KiB', () => withRuntime(async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return json({}); };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ action: 'heartbeat', padding: 'x'.repeat(9_000) })));
      controller.close();
    },
  });
  const candidate = request(stream);
  assert.equal(candidate.headers.get('content-length'), null);
  const response = await POST(candidate);
  assert.equal(response.status, 413);
  assert.equal(fetchCalls, 0);
}));

test('declared oversize body is rejected before reading or RPC', () => withRuntime(async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return json({}); };
  const response = await POST(request('{}', { 'Content-Length': '8193' }));
  assert.equal(response.status, 413);
  assert.equal(fetchCalls, 0);
}));

test('shared worker endpoint denies human acknowledge and resolve actions', () => withRuntime(async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return json({}); };
  for (const action of ['acknowledged', 'resolved']) {
    const response = await POST(request(JSON.stringify({ action, dedupe_key: 'c'.repeat(64) })));
    assert.equal(response.status, 400);
  }
  assert.equal(fetchCalls, 0);
}));

test('proxy allows exactly the observability path to reach its dedicated bearer handler', () => {
  const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  assert.match(proxy, /'\/api\/internal\/observability'/);
  assert.match(proxy, /function bypassesDashboardAuth\(pathname: string\)/);
  assert.match(proxy, /INTERNAL_MACHINE_PATHS\.has\(pathname\)/);
  assert.doesNotMatch(proxy, /pathname\.startsWith\('\/api\/internal/);
});
