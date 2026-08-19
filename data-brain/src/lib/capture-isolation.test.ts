import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import test from 'node:test';

import { POST as retryLegacyDelivery } from '../app/api/deliveries/retry/route';
import { POST as ingestLead } from '../app/api/leads/ingest/route';
import type { LeadPayload } from './types';

const adminPassword = 'password-test';
const adminSalt = Buffer.alloc(16, 17);
const dashboardCredentialStore = JSON.stringify({
  version: 1,
  kdf: { name: 'PBKDF2-SHA256', iterations: 600_000 },
  identities: [{
    username: 'admin-test',
    credentials: [{
      key_id: 'capture-isolation-v1',
      salt: adminSalt.toString('base64url'),
      digest: pbkdf2Sync(adminPassword, adminSalt, 600_000, 32, 'sha256').toString('base64url'),
    }],
  }],
});

const environment = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_ANON_KEY: 'anon-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  LEAD_HASH_SECRET: 'capture-isolation-secret'.padEnd(32, 'q'),
  DATA_BRAIN_ADMIN_USER: 'admin-test',
  DATA_BRAIN_ADMIN_PASSWORD: adminPassword,
  DATA_BRAIN_AUTH_CREDENTIALS: dashboardCredentialStore,
  DATA_BRAIN_AUTH_PEPPER: `capture-isolation-${'p'.repeat(32)}`,
  DATA_BRAIN_LEGACY_BASIC_ENABLED: 'false',
  LANDING_ALLOWED_ORIGINS: 'http://localhost:3001',
  MAKE_WEBHOOK_SECRET: 'M4k3-HMAC-Only-9xQ2vR7sN5cP8dL1Z',
  MAKE_WEBHOOK_URL: 'https://make.test/legacy-hook',
  NOTIFICATION_WEBHOOK_URL: 'https://notify.test/legacy-hook',
  OUTBOUND_MASTER_ENABLED: 'true',
  LEGACY_MAKE_DELIVERY_ENABLED: 'true',
  LEGACY_DELIVERY_RETRY_ENABLED: 'true',
};

function leadPayload(): LeadPayload {
  return {
    submission_id: 'calculator_capture_isolation_01',
    event_version: '1.0',
    form_type: 'calculator',
    lead_magnet: 'calculator',
    created_at: '2026-08-18T08:00:00.000Z',
    source_url: 'http://localhost:3001/calculadora',
    lead_score: 0,
    lead_status: 'new',
    lead_classification: 'cold',
    scoring: { fit: 0, intent: 0, engagement: 0, urgency: 0, total: 0, classification: 'cold' },
    contact: {
      name: 'Persona Test',
      email: 'persona@empresa.test',
      company: 'Empresa Test',
    },
    consent: { privacy_accepted: true, marketing_accepted: false },
  };
}

async function withEnvironment(run: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(environment)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
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

function adminAuthorization(): string {
  return `Basic ${Buffer.from(`admin-test:${adminPassword}`).toString('base64')}`;
}

test('ingest captures without touching Make, notifications or delivery_queue even when legacy flags are on', () => withEnvironment(async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });

    if (url.startsWith('https://make.test/') || url.startsWith('https://notify.test/')) {
      throw new Error('legacy outbound must not be called by ingest');
    }
    if (url.includes('/rest/v1/delivery_queue')) {
      throw new Error('legacy queue must not be read or written by ingest');
    }
    if (url.endsWith('/rest/v1/leads') && method === 'POST') {
      assert.equal(body.delivery_status, 'captured');
      assert.equal(body.email_delivery_status, 'pending');
      assert.equal(body.accepted_by_make_at, null);
      return Response.json([{ ...body, id: 'lead-row-01' }]);
    }
    if (url.includes('/rest/v1/leads?id=eq.lead-row-01') && method === 'PATCH') {
      return Response.json([{ ...body, id: 'lead-row-01' }]);
    }
    if (url === 'https://api.openai.com/v1/chat/completions') {
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              ai_summary: 'Lead capturado para revisión.',
              priority_reason: 'Sin señales suficientes.',
              recommended_action: 'revisar_manual',
              sales_angle: 'Revisión consultiva.',
              risk_notes: 'Datos limitados.',
              confidence: 0.4,
            }),
          },
        }],
      });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const response = await ingestLead(new Request('https://data.test/api/leads/ingest', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3001',
      'x-forwarded-for': '192.0.2.70',
    },
    body: JSON.stringify(leadPayload()),
  }));
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.capture_status, 'captured');
  assert.equal(body.delivery_status, 'captured');
  assert.equal(body.email_delivery_status, 'pending');
  assert.equal(body.transactional_dispatch_status, 'queued_off');
  assert.equal(calls.some((call) => /make\.test|notify\.test|delivery_queue/.test(call.url)), false);
  assert.equal(calls.some((call) => /\/rpc\//.test(call.url)), false);
}));

test('concurrent duplicate re-reads the atomic winner while a different identity collides with 409', () => withEnvironment(async () => {
  const stored = new Map<string, Record<string, unknown>>();
  let insertCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (url.endsWith('/rest/v1/leads') && method === 'POST') {
      insertCount += 1;
      const submissionId = String(body.submission_id);
      if (!stored.has(submissionId)) {
        const row = { ...body, id: 'lead-row-concurrent' };
        stored.set(submissionId, row);
        return Response.json([row]);
      }
      return Response.json({ code: '23505', message: 'duplicate key value' }, { status: 409 });
    }
    if (url.includes('/rest/v1/leads?') && method === 'GET') {
      const submissionId = decodeURIComponent(url.match(/submission_id=eq\.([^&]+)/)?.[1] ?? '');
      const row = stored.get(submissionId);
      return Response.json(row ? [row] : []);
    }
    if (url.includes('/rest/v1/leads?id=eq.lead-row-concurrent') && method === 'PATCH') {
      const current = stored.get('calculator_capture_isolation_01') ?? {};
      stored.set('calculator_capture_isolation_01', { ...current, ...body });
      return Response.json([{ ...current, ...body }]);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const requestFor = (payload: LeadPayload) => new Request('https://data.test/api/leads/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3001' },
    body: JSON.stringify(payload),
  });
  const payload = leadPayload();
  const [first, duplicate] = await Promise.all([
    ingestLead(requestFor(payload)),
    ingestLead(requestFor(payload)),
  ]);
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  const responseBodies = await Promise.all([first.json(), duplicate.json()]);
  assert.equal(responseBodies.filter((body) => body.duplicate === true).length, 1);
  assert.equal(responseBodies.every((body) => body.transactional_dispatch_status === 'queued_off'), true);

  const collisionPayload = leadPayload();
  collisionPayload.contact.email = 'otra-persona@empresa.test';
  const collision = await ingestLead(requestFor(collisionPayload));
  assert.equal(collision.status, 409);
  assert.equal((await collision.json()).code, 'SUBMISSION_ID_COLLISION');

  const terminalRow = stored.get(payload.submission_id);
  assert.ok(terminalRow);
  terminalRow.delivery_status = 'delivered';
  terminalRow.email_delivery_status = 'email_sent';
  const terminalReplay = await ingestLead(requestFor(payload));
  assert.equal(terminalReplay.status, 200);
  assert.equal((await terminalReplay.json()).transactional_dispatch_status, 'email_sent');
  assert.equal(insertCount, 4);
}));

test('capture queues an OFF transactional intent only for the four resources and never sends', () => withEnvironment(async () => {
  const results: Record<string, string> = {};
  const outboundCalls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (/graph\.microsoft|make\.test|notify\.test|\/rpc\//.test(url)) {
      outboundCalls.push(url);
      throw new Error('capture must not call outbound or reservation backends');
    }
    if (url.endsWith('/rest/v1/leads') && method === 'POST') {
      return Response.json([{ ...body, id: `row-${String(body.form_type)}` }]);
    }
    if (url.includes('/rest/v1/leads?id=eq.row-') && method === 'PATCH') {
      return Response.json([{ ...body }]);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  for (const formType of ['calculator', 'interactive_checklist', 'checklist', 'webinar', 'diagnostic'] as const) {
    const payload = leadPayload();
    payload.submission_id = `${formType}_capture_intent_01`;
    payload.form_type = formType;
    payload.lead_magnet = formType;
    payload.interactive_checklist = formType === 'interactive_checklist'
      ? {
          score: 0,
          risk_level: 'low',
          answers: { company_size: '1-5' },
        }
      : undefined;
    const response = await ingestLead(new Request('https://data.test/api/leads/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3001' },
      body: JSON.stringify(payload),
    }));
    const responseBody = await response.json();
    assert.equal(response.status, 200, JSON.stringify(responseBody));
    results[formType] = responseBody.transactional_dispatch_status;
  }
  assert.equal(results.calculator, 'queued_off');
  assert.equal(results.interactive_checklist, 'queued_off');
  assert.equal(results.checklist, 'queued_off');
  assert.equal(results.webinar, 'queued_off');
  assert.equal(results.diagnostic, 'not_applicable');
  assert.deepEqual(outboundCalls, []);
}));

test('retry route requires admin auth before any queue access', () => withEnvironment(async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('unexpected queue access');
  };

  const response = await retryLegacyDelivery(new Request('https://data.test/api/deliveries/retry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmation: 'RETRY_LEGACY_DELIVERIES' }),
  }));

  assert.equal(response.status, 401);
  assert.equal(calls, 0);
}));

test('retry route fails closed when master is off and when explicit confirmation is absent', () => withEnvironment(async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('unexpected queue access');
  };

  process.env.OUTBOUND_MASTER_ENABLED = 'false';
  const disabled = await retryLegacyDelivery(new Request('https://data.test/api/deliveries/retry', {
    method: 'POST',
    headers: { authorization: adminAuthorization(), 'content-type': 'application/json' },
    body: JSON.stringify({ confirmation: 'RETRY_LEGACY_DELIVERIES' }),
  }));
  assert.equal(disabled.status, 503);

  process.env.OUTBOUND_MASTER_ENABLED = 'true';
  const unconfirmed = await retryLegacyDelivery(new Request('https://data.test/api/deliveries/retry', {
    method: 'POST',
    headers: { authorization: adminAuthorization(), 'content-type': 'application/json' },
    body: JSON.stringify({ retryDead: false }),
  }));
  assert.equal(unconfirmed.status, 400);
  assert.equal(calls, 0);
}));

test('dead-letter replay requires its second explicit confirmation', () => withEnvironment(async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('unexpected queue access');
  };

  const response = await retryLegacyDelivery(new Request('https://data.test/api/deliveries/retry', {
    method: 'POST',
    headers: { authorization: adminAuthorization(), 'content-type': 'application/json' },
    body: JSON.stringify({
      retryDead: true,
      confirmation: 'RETRY_LEGACY_DELIVERIES',
    }),
  }));

  assert.equal(response.status, 400);
  assert.equal(calls, 0);
}));
