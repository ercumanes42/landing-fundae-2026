import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../../supabase/migrations/20260819143000_inbound_reliability.sql', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('./inbound-runtime.ts', import.meta.url), 'utf8');

test('inbound ledger has leased claims, terminal manual review, service-only grants and CAS cursor', () => {
  assert.match(migration, /primary key \(provider, source_event_hash\)/i);
  assert.match(migration, /lease_expires_at>v_now/i);
  assert.match(migration, /status in \('processing','processed','manual_review','rejected'\)/i);
  assert.match(migration, /insert into public\.inbound_alerts/i);
  assert.match(migration, /alter table public\.inbound_event_ledger force row level security/i);
  assert.match(migration, /alter table public\.inbound_sync_cursors force row level security/i);
  assert.match(migration, /alter table public\.inbound_alerts force row level security/i);
  assert.match(migration, /v_row\.cursor_hash is distinct from p_expected_cursor_hash/i);
  assert.match(migration, /revoke all on public\.inbound_event_ledger, public\.inbound_sync_cursors, public\.inbound_alerts from public, anon, authenticated/i);
});

test('claim refreshes its clock after the row lock before evaluating the lease', () => {
  const lockIndex = migration.indexOf('for update;');
  const refreshIndex = migration.indexOf('v_now := pg_catalog.clock_timestamp();', lockIndex);
  const leaseIndex = migration.indexOf('v_row.lease_expires_at>v_now', lockIndex);
  assert.ok(lockIndex > 0 && refreshIndex > lockIndex && leaseIndex > refreshIndex);
});

test('cursor advances only after every page event is durably processed', () => {
  const processIndex = runtime.indexOf('processGraphInboundMessage(message, repository)');
  const advanceIndex = runtime.indexOf("callRpc('advance_inbound_cursor'");
  assert.ok(processIndex > 0 && advanceIndex > processIndex);
});
