import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canPassCampaignStopGate,
  canonicalizeJourneyEventInput,
  directionalMetricQuality,
  executionStatusForEvent,
  JOURNEY_RETENTION_POLICY,
  validateCanonicalTrackingInput,
} from './tracking-contract';
import {
  JourneyBodyTooLargeError,
  JourneyInvalidJsonError,
  readJourneyJson,
  recordJourneyEvent,
  recordJourneyEventBatch,
  type JourneyIngestDependencies,
} from './journey-ingest';

const base = {
  campaign_external_id: 'FUNDAE_2026_EMAIL_V1', contact_id: 'contact_001',
  source_event_id: 'make:event:001', execution_key: 'FUNDAE_2026_EMAIL_V1:contact_001:E1',
  channel: 'email' as const, capture_method: 'provider_webhook' as const,
  occurred_at: '2026-09-01T08:00:00.000Z', context: { provider: 'outlook' },
  properties: { step: 1, template_id: 'email_1' },
};

function journeyEvent(eventName = 'page_view'): any {
  const touch = {
    utm_source: 'direct', utm_medium: 'none', utm_campaign: 'unattributed',
    utm_content: '', utm_term: '', referrer: '', lead_magnet: 'calculator',
    source_url: 'https://example.test/calculadora',
    captured_at: '2026-08-19T08:00:00.000Z',
  };
  return {
    event_name: eventName,
    context: {
      event_id: '123e4567-e89b-42d3-a456-426614174010',
      event_version: '2.0', occurred_at: '2026-08-19T08:00:00.000Z',
      journey_id: 'jrn_123e4567e89b42d3a456426614174010',
      anonymous_id: 'jrn_123e4567e89b42d3a456426614174010',
      session_id: 'ses_123e4567e89b42d3a456426614174011',
      identity_persistence: 'localStorage', storage_available: true,
      first_touch: touch, last_touch: touch, lead_magnet: 'calculator',
      section: 'calculator', source_url: 'https://example.test/calculadora',
      referrer: '', utm_source: 'direct', utm_medium: 'none',
      utm_campaign: 'unattributed', utm_content: '', utm_term: '',
      device_type: 'desktop', viewport_width: 1440,
      consent_state: 'accepted', consent_version: '2026-08-19',
    },
    properties: { page_path: '/calculadora' },
  };
}

function memoryJourneyStore(): JourneyIngestDependencies {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    insert: async (row) => {
      if (rows.has(String(row.id))) throw new Error('duplicate key');
      rows.set(String(row.id), structuredClone(row));
      return structuredClone(row);
    },
    findById: async (id) => structuredClone(rows.get(id) ?? null),
  } as JourneyIngestDependencies;
}

test('journey contract requires accepted v2 pseudonyms and strips no data silently', () => {
  const value = canonicalizeJourneyEventInput(journeyEvent());
  assert.equal(value.context.journey_id, value.context.anonymous_id);
  assert.equal(value.context.consent_state, 'accepted');
  const denied = journeyEvent();
  denied.context.consent_state = 'rejected';
  assert.throws(() => canonicalizeJourneyEventInput(denied), /must be accepted/);
  const mismatched = journeyEvent();
  mismatched.context.anonymous_id = 'jrn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.throws(() => canonicalizeJourneyEventInput(mismatched), /journey_id/);
});

test('journey contract rejects PII, query strings, unknown fields and invalid quartiles', () => {
  const pii = journeyEvent();
  pii.properties = { page_path: '/calculadora', email: 'person@example.test' } as never;
  assert.throws(() => canonicalizeJourneyEventInput(pii), /not allowed/);
  const query = journeyEvent();
  query.context.source_url = 'https://example.test/calculadora?email=person%40example.test';
  assert.throws(() => canonicalizeJourneyEventInput(query), /query/);
  const quartile = journeyEvent('video_quartile');
  quartile.properties = {
    video_id: 'hero_video', play_session_id: 'vplay_123', quartile: 10,
  } as never;
  assert.throws(() => canonicalizeJourneyEventInput(quartile), /quartile/);
  quartile.properties.quartile = 25;
  assert.doesNotThrow(() => canonicalizeJourneyEventInput(quartile));
});

test('tool abandon and retention policy are explicit and bounded', () => {
  const abandon = journeyEvent('tool_abandon');
  abandon.properties = { tool_id: 'calculator', step: 2, reason: 'pagehide' } as never;
  assert.doesNotThrow(() => canonicalizeJourneyEventInput(abandon));
  abandon.properties.reason = 'guessed';
  assert.throws(() => canonicalizeJourneyEventInput(abandon), /reason/);
  assert.deepEqual(JOURNEY_RETENTION_POLICY, {
    browserJourneyDays: 30,
    browserSessionIdleMinutes: 30,
    rawEventDays: 90,
    aggregateOnlyAfterRawExpiry: true,
  });
});

test('event UUID replay is idempotent and a conflicting replay is rejected', async () => {
  const dependencies = memoryJourneyStore();
  assert.deepEqual(await recordJourneyEvent(journeyEvent(), dependencies), {
    id: '123e4567-e89b-42d3-a456-426614174010', duplicate: false,
  });
  assert.deepEqual(await recordJourneyEvent(journeyEvent(), dependencies), {
    id: '123e4567-e89b-42d3-a456-426614174010', duplicate: true,
  });
  const collision = journeyEvent();
  collision.properties.page_path = '/other';
  await assert.rejects(() => recordJourneyEvent(collision, dependencies), /event_id collision/);
});

test('batch replay reports duplicates without mutating existing events', async () => {
  const dependencies = memoryJourneyStore();
  const first = journeyEvent();
  const second = journeyEvent('tool_start');
  second.context.event_id = '123e4567-e89b-42d3-a456-426614174012';
  second.properties = { tool_id: 'calculator' } as never;
  assert.deepEqual(await recordJourneyEventBatch([first, second], dependencies), {
    count: 2, duplicates: 0,
  });
  assert.deepEqual(await recordJourneyEventBatch([first, second], dependencies), {
    count: 2, duplicates: 2,
  });
});

test('journey JSON reader distinguishes invalid JSON from oversized input', async () => {
  await assert.rejects(
    () => readJourneyJson(new Request('https://example.test', { method: 'POST', body: '{' }), 128),
    JourneyInvalidJsonError,
  );
  await assert.rejects(
    () => readJourneyJson(new Request('https://example.test', {
      method: 'POST',
      headers: { 'content-length': '129' },
      body: '{}',
    }), 128),
    JourneyBodyTooLargeError,
  );
});

test('accepts canonical PII-free events and requires schedules', () => {
  assert.doesNotThrow(() => validateCanonicalTrackingInput({ ...base, event_name: 'delivery_delivered' }));
  assert.throws(() => validateCanonicalTrackingInput({ ...base, event_name: 'delivery_scheduled' }), /scheduled_for/);
  assert.doesNotThrow(() => validateCanonicalTrackingInput({ ...base, event_name: 'delivery_scheduled', scheduled_for: '2026-09-01T09:00:00+02:00' }));
});

test('strict allowlists reject top-level extras, PII, unknown and nested metadata', () => {
  assert.throws(() => validateCanonicalTrackingInput({ ...base, event_name: 'link_clicked', extra: true }), /not allowed/);
  assert.throws(() => validateCanonicalTrackingInput({ ...base, event_name: 'link_clicked', properties: { email: 'a@b.es' } }), /not allowed/);
  assert.throws(() => validateCanonicalTrackingInput({ ...base, event_name: 'link_clicked', properties: { link_id: 'a@b.es' } }), /may contain PII/);
  assert.throws(() => validateCanonicalTrackingInput({ ...base, event_name: 'tool_completed', properties: { tool_id: { id: 'calculator' } } }), /scalar/);
});

test('LinkedIn supports only manual or official API capture', () => {
  assert.throws(() => validateCanonicalTrackingInput({ ...base, event_name: 'link_clicked', channel: 'linkedin', capture_method: 'automation' }), /manual or official_api/);
  assert.doesNotThrow(() => validateCanonicalTrackingInput({ ...base, event_name: 'reply_received', channel: 'linkedin', capture_method: 'official_api' }));
});

test('opens are directional and execution states are unambiguous', () => {
  assert.equal(directionalMetricQuality('email_opened'), 'directional');
  assert.equal(directionalMetricQuality('link_clicked'), 'confirmed');
  assert.equal(executionStatusForEvent('delivery_scheduled'), 'planned');
  assert.equal(executionStatusForEvent('delivery_sent'), 'executed');
  assert.equal(executionStatusForEvent('transactional_delivery_sent'), 'executed');
  assert.equal(executionStatusForEvent('delivery_failed'), 'failed');
  assert.equal(executionStatusForEvent('transactional_delivery_failed'), 'failed');
  assert.equal(executionStatusForEvent('bounce_hard'), 'failed');
  assert.equal(executionStatusForEvent('unsubscribe'), 'stopped');
});

test('stop gate blocks outbound sends but keeps inbound facts recordable', () => {
  const eligible = { eventName: 'delivery_scheduled', campaignActive: true, campaignStatus: 'pilot', suppressionScope: 'none' as const, marketingLane: 'cold' as const, coldSequenceStatus: 'active', intentSequenceStatus: 'not_eligible' };
  assert.equal(canPassCampaignStopGate(eligible), true);
  assert.equal(canPassCampaignStopGate({ ...eligible, suppressionScope: 'marketing' }), false);
  assert.equal(canPassCampaignStopGate({ ...eligible, coldSequenceStatus: 'stopped' }), false);
  assert.equal(canPassCampaignStopGate({ ...eligible, eventName: 'delivery_scheduled', campaignActive: false }), false);
  assert.equal(canPassCampaignStopGate({ ...eligible, eventName: 'delivery_sent', campaignActive: false }), true);
  assert.equal(canPassCampaignStopGate({ ...eligible, eventName: 'unsubscribe', campaignActive: false, campaignStatus: 'paused', suppressionScope: 'all', marketingLane: 'none' }), true);
});

test('migration uses the real trigger, RPC transaction, reconciliation, idempotency and RLS', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260811_tracking_control.sql', import.meta.url), 'utf8');
  assert.match(sql, /execute function public\.touch_updated_at\(\)/);
  assert.doesNotMatch(sql, /touch_campaign_updated_at/);
  assert.match(sql, /create unique index if not exists campaign_executions_idempotency_idx/);
  assert.match(sql, /for update/);
  assert.match(sql, /v_existing_contact_id <> v_contact.id or v_existing_event_name <> p_event_name/);
  assert.match(sql, /v_existing_execution_key <> p_execution_key/);
  assert.match(sql, /when campaign_executions.status='executed' or excluded.status='executed' then 'executed'/);
  assert.match(sql, /where campaign_contact_id=v_contact.id and status='planned'/);
  assert.match(sql, /Reconciliation is intentionally reapplied on retries/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all privileges .* anon, authenticated/);
  assert.match(sql, /grant execute .* service_role/);
});

test('schema bootstrap contains the final hardening and tracking model', () => {
  const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
  assert.match(schema, /submission_id text/);
  assert.match(schema, /intent_enabled boolean/);
  assert.match(schema, /create table if not exists public\.campaign_executions/);
  assert.match(schema, /record_campaign_tracking_event/);
});

test('proxy exposes exactly the signed tracking endpoint, not a campaign prefix', () => {
  const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  assert.match(proxy, /'\/api\/campaign\/tracking'/);
  assert.match(proxy, /PUBLIC_PATHS\.has\(pathname\)/);
  assert.doesNotMatch(proxy, /pathname\.startsWith\('\/api\/campaign/);
});
