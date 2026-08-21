import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationName = '20260819234000_campaign_terminal_suppression_hardening.sql';
const migration = readFileSync(
  new URL(`../../supabase/migrations/${migrationName}`, import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
  .replaceAll('\r\n', '\n');
const postcheck = readFileSync(
  new URL('../../supabase/FUNDAE_RELEASE_POSTCHECK_20260819.sql', import.meta.url),
  'utf8',
);
const smoke = readFileSync(
  new URL('../../supabase/CAMPAIGN_SUPPRESSION_SMOKE_20260819.sql', import.meta.url),
  'utf8',
);

test('every terminal campaign event materializes one global suppression with deterministic precedence', () => {
  assert.match(migration, /after insert on public\.campaign_events/);
  assert.match(migration, /new\.event_name in \('unsubscribe', 'bounce_hard', 'opposition'\)/);
  assert.match(migration, /insert into public\.campaign_suppressions/);
  assert.match(migration, /when public\.campaign_suppressions\.scope = 'all' or excluded\.scope = 'all'[\s\S]*?then 'unsubscribe'/);
  assert.match(migration, /public\.campaign_suppressions\.reason = 'hard_bounce'[\s\S]*?then 'hard_bounce'/);
  assert.match(migration, /where email_hash = v_suppression\.identity_hash/);
  assert.match(migration, /where status = 'planned' and campaign_contact_id in/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test('provisioning/import fails closed when the identity is already suppressed', () => {
  assert.match(migration, /before insert or update of email_hash, marketing_lane, suppression_scope/);
  assert.match(migration, /where identity_hash = new\.email_hash/);
  assert.match(migration, /message = 'campaign_contact_suppressed'/);
  assert.match(smoke, /suppressed_campaign_contact_was_accepted/);
  assert.match(smoke, /exception when check_violation/);
});

test('suppression helpers are private, mirrored and covered by release checks', () => {
  const marker = `-- ${migrationName}`;
  const start = schema.lastIndexOf(marker) + marker.length;
  const nextMarker = schema.indexOf('\n-- 20', start);
  assert.equal(schema.slice(start, nextMarker === -1 ? undefined : nextMarker).trim(), migration.trim());
  assert.equal((migration.match(/security definer\s+set search_path = ''/g) || []).length, 2);
  assert.match(migration, /revoke execute on function fundae_private\.enforce_campaign_terminal_suppression\(\)[\s\S]*?service_role/);
  assert.match(migration, /revoke execute on function fundae_private\.reject_suppressed_campaign_contact\(\)[\s\S]*?service_role/);
  assert.match(postcheck, /fundae_release_postcheck_suppression_helper_security_invalid/);
  assert.match(postcheck, /fundae_release_postcheck_suppression_trigger_missing/);
  assert.match(smoke, /fundae_release_campaign_suppression_smoke_ok/);
  assert.match(smoke, /rollback;\s*$/i);
  assert.doesNotMatch(migration, /master_enabled\s*=\s*true|cold_enabled\s*=\s*true|enabled\s*=\s*true/i);
});
