import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { HUBSPOT_PROPERTY_MANIFEST, type HubSpotPreflightReport } from '@/lib/hubspot';
import {
  authorizeCanonicalDashboardAdmin,
  processHubSpotPreflightRequest,
  type HubSpotPreflightRouteDependencies,
} from './route';

const originalFetch = globalThis.fetch;
const request = () => new Request('https://data.example.invalid/api/campaign/hubspot/test', {
  headers: { authorization: 'Basic redacted' },
});

const successReport: HubSpotPreflightReport = {
  ok: true,
  mode: 'read_only',
  portal: { matches_expected: true },
  objects: {
    contacts: { checked_properties: HUBSPOT_PROPERTY_MANIFEST.contacts.length },
    companies: { checked_properties: HUBSPOT_PROPERTY_MANIFEST.companies.length },
    tasks: { checked_properties: HUBSPOT_PROPERTY_MANIFEST.tasks.length },
  },
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function dashboardSummary(role: 'admin' | 'operator' | 'read_only') {
  return {
    meta: {
      role,
      generated_at: '2026-08-19T12:00:00.000Z',
      from: '2026-08-19T11:59:00.000Z',
      to: '2026-08-19T12:00:00.000Z',
      aggregate_complete: true,
      pii_included: false,
    },
    funnel: { leads: 0 },
    journey: {},
    transactional: {},
    campaign: {},
    health: {},
  };
}

test('canonical HubSpot admin capability resolves role through dashboard RBAC', async () => {
  for (const role of ['read_only', 'operator', 'admin'] as const) {
    let calls = 0;
    const result = await authorizeCanonicalDashboardAdmin(
      'a'.repeat(64),
      async (name, args) => {
        calls += 1;
        assert.equal(name, 'dashboard_get_summary');
        assert.equal(args.p_actor_hash, 'a'.repeat(64));
        assert.equal(args.p_request_id, 'hubspot-preflight-admin:fixed-request');
        return dashboardSummary(role);
      },
      new Date('2026-08-19T12:00:00.000Z'),
      'fixed-request',
    );
    assert.equal(calls, 1);
    assert.deepEqual(result, role === 'admin' ? { ok: true } : { ok: false, reason: 'forbidden' });
  }
});

test('unauthorized HubSpot preflight performs zero rate-limit, preflight or fetch work', async () => {
  let authorizationCalls = 0;
  let rateCalls = 0;
  let preflightCalls = 0;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('unauthorized request must not fetch');
  };
  const dependencies: HubSpotPreflightRouteDependencies = {
    authenticate: async () => ({ ok: false, reason: 'invalid_credentials' }),
    authorizeAdmin: async () => {
      authorizationCalls += 1;
      return { ok: true };
    },
    rateLimit: async () => {
      rateCalls += 1;
      await fetch('https://rate-limit.example.invalid');
      return { allowed: true };
    },
    preflight: async () => {
      preflightCalls += 1;
      await fetch('https://api.hubapi.com');
      return successReport;
    },
  };

  const response = await processHubSpotPreflightRequest(request(), dependencies);
  assert.equal(response.status, 401);
  assert.equal(authorizationCalls, 0);
  assert.equal(rateCalls, 0);
  assert.equal(preflightCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.match(response.headers.get('www-authenticate') ?? '', /^Basic /);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.deepEqual(await response.json(), { ok: false, failure_code: 'unauthorized' });
});

for (const role of ['read_only', 'operator'] as const) {
  test(`${role} HubSpot preflight is forbidden after one limiter check and before upstream or fetch work`, async () => {
    let rateCalls = 0;
    let preflightCalls = 0;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('non-admin request must not fetch upstream');
    };
    const dependencies: HubSpotPreflightRouteDependencies = {
      authenticate: async () => ({ ok: true, actorHash: role === 'read_only' ? 'b'.repeat(64) : 'c'.repeat(64), credentialKeyId: 'test' }),
      authorizeAdmin: async () => ({ ok: false, reason: 'forbidden' }),
      rateLimit: async () => {
        rateCalls += 1;
        return { allowed: true };
      },
      preflight: async () => {
        preflightCalls += 1;
        return successReport;
      },
    };

    const response = await processHubSpotPreflightRequest(request(), dependencies);
    assert.equal(response.status, 403);
    assert.equal(rateCalls, 1);
    assert.equal(preflightCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.deepEqual(await response.json(), { ok: false, failure_code: 'forbidden' });
  });
}

test('authorized HubSpot preflight is rate-limited fail-closed before upstream work', async () => {
  let authorizationCalls = 0;
  let preflightCalls = 0;
  const dependencies: HubSpotPreflightRouteDependencies = {
    authenticate: async () => ({ ok: true, actorHash: 'a'.repeat(64), credentialKeyId: 'test' }),
    authorizeAdmin: async () => {
      authorizationCalls += 1;
      return { ok: true };
    },
    rateLimit: async () => ({ allowed: false, retryAfterSeconds: 60, reason: 'unavailable' }),
    preflight: async () => {
      preflightCalls += 1;
      return successReport;
    },
  };

  const response = await processHubSpotPreflightRequest(request(), dependencies);
  assert.equal(response.status, 503);
  assert.equal(authorizationCalls, 0);
  assert.equal(preflightCalls, 0);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.deepEqual(await response.json(), { ok: false, failure_code: 'rate_limit_unavailable' });
});

test('authorized HubSpot preflight returns only the redacted read-only report with no-store', async () => {
  const dependencies: HubSpotPreflightRouteDependencies = {
    authenticate: async () => ({ ok: true, actorHash: 'a'.repeat(64), credentialKeyId: 'test' }),
    authorizeAdmin: async () => ({ ok: true }),
    rateLimit: async () => ({ allowed: true }),
    preflight: async () => successReport,
  };

  const response = await processHubSpotPreflightRequest(request(), dependencies);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /private/);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(response.headers.get('vary'), 'Authorization');
  assert.deepEqual(body, successReport);
  assert.doesNotMatch(JSON.stringify(body), /token|portal.?id|correlation|error/i);
});
