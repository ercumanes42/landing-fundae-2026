import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260819220000_advisor_index_hardening.sql', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const postcheck = readFileSync(
  new URL('../../supabase/FUNDAE_RELEASE_POSTCHECK_20260819.sql', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

const expectedIndexes = [
  'cold_dispatch_reservation_fk_idx',
  'cold_provision_manifest_campaign_fk_idx',
  'cold_scheduler_alert_dispatch_fk_idx',
  'events_campaign_fk_idx',
  'graph_outbox_mailbox_reservation_fk_idx',
  'inbound_ledger_contact_fk_idx',
  'inbound_ledger_campaign_fk_idx',
  'mailbox_state_active_reservation_fk_idx',
  'mailbox_state_blocked_reservation_fk_idx',
  'operational_alert_receipts_dedupe_fk_idx',
];

test('advisor FK indexes are additive, mirrored and postchecked', () => {
  assert.match(migration, /begin;[\s\S]*commit;\s*$/);
  assert.doesNotMatch(migration, /\b(?:delete|drop|truncate|update)\b/i);
  for (const index of expectedIndexes) {
    assert.match(migration, new RegExp(`create index if not exists ${index}\\b`));
    assert.match(postcheck, new RegExp(`'${index}'`));
  }
  assert.ok(schema.includes(migration.trim()), 'schema.sql must embed the exact advisor migration');
});
