import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DashboardIntelligenceResponse } from '@/lib/dashboard-data';
import type { DashboardExportArtifact } from '@/lib/dashboard-export';
import { processDashboardExportRequest, type DashboardExportRouteDependencies } from './route';

function intelligence(): DashboardIntelligenceResponse {
  return {
    meta: { role: 'admin', generated_at: '2026-08-21T10:00:00Z', from: '2026-08-01T00:00:00Z', to: '2026-08-21T10:00:00Z', campaign_id: null, filters: {}, timezone: 'Europe/Madrid', pii_included: false },
    overview: {}, funnel: [], by_email: [], by_copy: [], by_campaign: [], by_variant: [], by_hour: [], time_series: [], cohorts: {}, traffic: {}, tools: [], abandonment_by_section: [], high_intent_contacts: [], journey: {},
    pipeline: { totals: {}, by_stage: [], by_source: [], by_campaign: [], by_outcome_reason: [] }, quality: {}, anomalies: [], recommendations: [], available_filters: {},
    metric_contract: { version: '2.0', timezone: 'Europe/Madrid', pii_included: false, external_crm_required: false },
  };
}

function dependencies(overrides: Partial<DashboardExportRouteDependencies> = {}): DashboardExportRouteDependencies {
  return {
    validateEnv: () => ({ ok: true }),
    authenticate: async () => ({ ok: true, actorHash: 'a'.repeat(64), credentialKeyId: 'key-1' }),
    rateLimit: async () => ({ allowed: true }),
    rpc: async () => intelligence(),
    createExport: async (): Promise<DashboardExportArtifact> => ({ body: new TextEncoder().encode('safe'), contentType: 'text/csv; charset=utf-8', extension: 'csv' }),
    now: () => new Date('2026-08-21T10:00:00.000Z'), requestId: () => 'request-1', ...overrides,
  };
}

const request = (query = 'format=csv') => new Request(`https://data.example.invalid/api/dashboard/export?${query}`, { headers: { authorization: 'Basic redacted' } });

test('401 performs no rate-limit, RPC or export work', async () => {
  let sideEffects = 0;
  const response = await processDashboardExportRequest(request(), dependencies({
    authenticate: async () => ({ ok: false, reason: 'invalid_credentials' }),
    rateLimit: async () => { sideEffects += 1; return { allowed: true }; },
    rpc: async () => { sideEffects += 1; return intelligence(); },
    createExport: async () => { sideEffects += 1; throw new Error('unexpected'); },
  }));
  assert.equal(response.status, 401); assert.equal(sideEffects, 0); assert.match(response.headers.get('www-authenticate') ?? '', /Basic/);
});

test('429 is fail-closed and performs no RPC', async () => {
  let rpcCalls = 0;
  const response = await processDashboardExportRequest(request(), dependencies({
    rateLimit: async () => ({ allowed: false, reason: 'limited', retryAfterSeconds: 42 }),
    rpc: async () => { rpcCalls += 1; return intelligence(); },
  }));
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '42'); assert.equal(rpcCalls, 0);
});

test('400 rejects unknown or malformed filters before RPC', async () => {
  let rpcCalls = 0;
  const deps = dependencies({ rpc: async () => { rpcCalls += 1; return intelligence(); } });
  assert.equal((await processDashboardExportRequest(request('format=pdf'), deps)).status, 400);
  assert.equal((await processDashboardExportRequest(request('format=csv&email_step=9'), deps)).status, 400);
  assert.equal((await processDashboardExportRequest(request('format=csv&secret=x'), deps)).status, 400);
  assert.equal(rpcCalls, 0);
});

test('200 calls the intelligence RPC once with allowlisted filters and returns attachment', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const response = await processDashboardExportRequest(request('format=csv&from=2026-08-01&to=2026-08-20&email_step=2&variant=A&copy_key=email_2:A'), dependencies({
    rpc: async (name, args) => { calls.push({ name, args }); return intelligence(); },
  }));
  assert.equal(response.status, 200); assert.equal(await response.text(), 'safe'); assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'dashboard_get_intelligence_v2');
  assert.deepEqual(calls[0].args.p_filters, { email_step: 2, variant: 'A', copy_key: 'email_2:A' });
  assert.match(response.headers.get('content-disposition') ?? '', /attachment; filename="fundae-data-brain-20260821\.csv"/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0'); assert.equal(response.headers.get('vary'), 'Authorization');
});
