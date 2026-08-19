import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { recordCampaignEvent } from './campaign';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260819210000_release_safety_barriers.sql', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const campaignSource = readFileSync(new URL('./campaign.ts', import.meta.url), 'utf8');

test('cold claim, reservation and JIT authorization share critical, heartbeat and inbound barriers', () => {
  for (const marker of [
    'cold_outbound_barrier_reason',
    "severity='critical' and lifecycle<>'resolved'",
    "('oauth',600),('mailbox',900),('reply_processor',900)",
    "('unsubscribe_processor',900),('hard_bounce_processor',900)",
    "status in ('processing','manual_review')",
    "status<>'resolved'",
    'claim_cold_campaign_dispatch_pre_safety_20260819',
    'bind_cold_campaign_reservation_pre_safety_20260819',
    'authorize_graph_draft_send_pre_safety_20260819',
    "set cold_enabled=false,halt_reason='COLD_SAFETY_BARRIER'",
  ]) assert.ok(migration.includes(marker), `missing safety barrier: ${marker}`);
  assert.match(migration, /claim_inbound_event[\s\S]*outbound_delivery_control where singleton for update/);
  assert.match(migration, /reconcile_operational_alerts[\s\S]*outbound_delivery_control where singleton for update/);
});

test('campaign event RPC reapplies stop effects on duplicate retry in one transaction', () => {
  for (const marker of [
    'record_campaign_event_atomic',
    "v_duplicate:=true",
    'update public.campaign_contacts set',
    "cold_sequence_status=case when v_stop then 'stopped'",
    "where campaign_contact_id=v_contact.id and status='planned'",
    "jsonb_build_object('id',v_event.id,'duplicate',v_duplicate)",
    "reason in ('hard_bounce','opposition')",
    "p_event_name='opposition'",
    "where email_hash=v_contact.email_hash",
  ]) assert.ok(migration.includes(marker), `missing atomic event contract: ${marker}`);
  assert.match(migration, /if not v_duplicate then[\s\S]*insert into public\.campaign_events[\s\S]*end if;[\s\S]*update public\.campaign_contacts set/);
  assert.doesNotMatch(campaignSource, /insertRow<\{ id: string \}>\('campaign_events'/);
  assert.match(campaignSource, /callRpc<\{ id: string \}>\('record_campaign_event_atomic'/);
});

test('lost RPC response after commit retries the same atomic event without direct PATCH', async () => {
  process.env.SUPABASE_URL = 'https://project.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${'s'.repeat(40)}`;
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  process.env.LEAD_HASH_SECRET = 'l'.repeat(32);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  let rpcAttempts = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url.includes('/campaigns?')) {
      return new Response(JSON.stringify([{ id: '00000000-0000-4000-8000-000000000001', external_id: 'FUNDAE_2026_EMAIL_V1' }]), { status: 200 });
    }
    if (url.endsWith('/rpc/record_campaign_event_atomic')) {
      rpcAttempts += 1;
      if (rpcAttempts === 1) throw new TypeError('response lost after commit');
      return new Response(JSON.stringify({ id: '00000000-0000-4000-8000-000000000002', duplicate: true }), { status: 200 });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  };
  try {
    const input = {
      campaign_external_id: 'FUNDAE_2026_EMAIL_V1', contact_id: 'contact_001',
      event_name: 'opposition', occurred_at: '2026-08-19T10:00:00.000Z', source_event_id: 'source_retry_001',
    };
    await assert.rejects(() => recordCampaignEvent(input), /response lost after commit/);
    const replay = await recordCampaignEvent(input);
    assert.equal(replay.id, '00000000-0000-4000-8000-000000000002');
    assert.equal(rpcAttempts, 2);
    assert.equal(calls.some((call) => call.method === 'PATCH' || call.url.includes('/campaign_events')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
