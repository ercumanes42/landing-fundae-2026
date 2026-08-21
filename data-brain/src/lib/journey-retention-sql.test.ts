import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260819190000_journey_retention_control.sql', import.meta.url),
  'utf8',
);

test('journey retention is 90 days, disabled by default and dry-run by default', () => {
  assert.match(sql, /raw_event_days integer not null default 90/i);
  assert.match(sql, /purge_enabled boolean not null default false/i);
  assert.match(sql, /p_before timestamptz,[\s\S]*p_apply boolean default false/i);
  assert.match(sql, /if not p_apply then[\s\S]*'reason_code', 'dry_run'/i);
  assert.doesNotMatch(sql, /pg_cron|cron\.schedule/i);
});

test('journey purge refreshes the clock after the policy lock and deletes only a bounded locked batch', () => {
  assert.match(sql, /journey_retention_control[\s\S]*for update;\s*v_now := pg_catalog\.clock_timestamp\(\)/i);
  assert.match(sql, /p_before > v_eligible_before[\s\S]*cutoff_too_recent/i);
  assert.match(sql, /from public\.events[\s\S]*occurred_at < p_before[\s\S]*for update skip locked[\s\S]*limit p_limit/i);
  assert.match(sql, /delete from public\.events event[\s\S]*event\.id = candidates\.id/i);
});

test('retention control and audit are force-RLS and only the service role can execute the RPC', () => {
  for (const table of ['journey_retention_control', 'journey_retention_runs']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all privileges on table public\\.${table}[^;]+service_role`, 'i'));
  }
  assert.match(sql, /revoke execute on function public\.purge_expired_journey_events[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.purge_expired_journey_events[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /cold_campaign_message_payloads|cold_campaign_dispatch_outbox|campaign_events/i);
});
