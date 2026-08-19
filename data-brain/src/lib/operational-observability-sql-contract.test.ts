import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../../supabase/migrations/20260819183000_operational_observability.sql', import.meta.url),
  'utf8',
);

test('observability tables are private, forced-RLS and exposed only through service RPCs', () => {
  for (const table of [
    'operational_heartbeats', 'operational_alerts',
    'operational_alert_receipts', 'operational_alert_audit',
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
  }
  assert.match(migration, /revoke all privileges on table public\.operational_heartbeats,[\s\S]*from public, anon, authenticated, service_role/i);
  for (const rpc of [
    'record_operational_heartbeat', 'get_operational_observability_snapshot',
    'reconcile_operational_alerts', 'transition_operational_alert',
  ]) {
    assert.match(migration, new RegExp(`security definer[\\s\\S]{0,80}set search_path = ''`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]{0,180}to service_role`, 'i'));
  }
});

test('alert replay, dedupe, lifecycle and audit are durable', () => {
  assert.match(migration, /dedupe_key text not null unique/);
  assert.match(migration, /primary key \(evaluation_key, dedupe_key\)/);
  assert.match(migration, /lifecycle in \('open', 'acknowledged', 'resolved'\)/);
  assert.match(migration, /operational_alert_audit_replay_key/);
  assert.match(migration, /action in \('detected', 'reopened', 'acknowledged', 'resolved'\)/);
});

test('aggregate is bounded/indexed and returns counts without message or contact payloads', () => {
  assert.match(migration, /campaign_events_operational_signal_idx/);
  assert.match(migration, /occurred_at >= v_now - interval '24 hours'/);
  assert.match(migration, /quota_send_day = v_day/);
  assert.doesNotMatch(migration, /select\s+(?:[^;]*,)?\s*(?:recipient_email|html_body|subject|contact_data|cursor_value)\b/i);
  assert.match(migration, /operational_metrics_are_safe/);
});
