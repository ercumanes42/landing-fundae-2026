import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, POST } from '../app/baja/route';
import { createUnsubscribeToken } from './unsubscribe';

const token = createUnsubscribeToken(
  'FUNDAE_2026_EMAIL_V1',
  'F26-C-0001',
  1,
  '2F2Mv8hmc34KjPpT9Zq6wNB7eRaD1sX5',
);

test('GET only renders confirmation and never calls Supabase', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('unexpected fetch'); };
  try {
    const response = await GET(new Request(`https://data.gfs.es/baja?token=${token}`, {
      headers: { 'x-forwarded-for': '192.0.2.20' },
    }));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Confirmar baja/);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid, unknown and RFC one-click POSTs expose the same generic response', async () => {
  const originalFetch = globalThis.fetch;
  const previous = new Map<string, string | undefined>();
  const required = {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_ANON_KEY: 'anon-test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    LEAD_HASH_SECRET: 'unsubscribe-route-hash-test'.padEnd(32, 'q'),
    UNSUBSCRIBE_TOKEN_SECRET: 'Z7fL3xP8vN2qR6mK9cD4wH1sB5tY0gUa',
    DATA_BRAIN_ADMIN_USER: 'admin-test',
    DATA_BRAIN_ADMIN_PASSWORD: 'password-test',
    MAKE_WEBHOOK_SECRET: 'M4k3-HMAC-Only-9xQ2vR7sN5cP8dL1Z',
  };
  for (const [key, value] of Object.entries(required)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  let rpcBody = '';
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/rest\/v1\/rpc\/consume_campaign_unsubscribe_token$/);
    rpcBody = String(init?.body ?? '');
    return new Response(JSON.stringify({ accepted: false, duplicate: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const invalid = await POST(new Request('https://data.gfs.es/baja', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '192.0.2.21' },
      body: 'token=invalid',
    }));
    const oneClick = await POST(new Request(`https://data.gfs.es/baja?token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '192.0.2.22' },
      body: 'List-Unsubscribe=One-Click',
    }));

    assert.equal(invalid.status, 200);
    assert.equal(oneClick.status, 200);
    assert.equal(await invalid.text(), await oneClick.text());
    assert.doesNotMatch(rpcBody, new RegExp(token.replace('.', '\\.')));
    assert.match(rpcBody, /p_token_hash/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
