import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260818083632_graph_outbox_foundation.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');

function extractFunction(sql: string, name: string): string {
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, `unterminated function ${name}`);
  return sql.slice(start, end + 3).replaceAll('\r\n', '\n');
}

test('Graph SQL forward contract is mirrored and fail-closed', () => {
  for (const token of [
    'transactional_dispatch_outbox',
    'claim_transactional_graph_dispatch',
    'reserve_claimed_transactional_graph_dispatch',
    'finalize_transactional_graph_dispatch',
    'confirm_graph_draft_neutralized',
    'p_observed_change_key_hash',
    'last_graph_send_authorized_at',
    'graph_managed',
    'graph_outbox_terminal_evidence_required',
    'draft_neutralization_required',
    'reserved_recovery',
    'resume_existing_reservation',
    'terminal_recovered',
    'suppressed_before_send',
  ]) {
    assert.ok(migration.includes(token), `migration misses ${token}`);
    assert.ok(schema.includes(token), `schema mirror misses ${token}`);
  }
  assert.match(migration, /p_opaque_marker !~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(migration, /p_limit <> 1/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /revoke execute on function public\.finalize_transactional_mailbox_delivery_legacy_20260818/);
  assert.match(migration, /not v_control\.master_enabled or not v_control\.transactional_enabled/);
  assert.match(
    migration,
    /where status = 'reserved' and reservation_id is not null[\s\S]*for update skip locked/,
  );
  assert.match(
    migration,
    /'reason_code', 'terminal_recovered'[\s\S]*'items', '\[\]'::jsonb/,
  );
  assert.match(
    migration,
    /when 'suppressed_before_send' then 'definitive_failed'/,
  );
  assert.match(
    migration,
    /'graph_draft_immutable_id', v_outbox\.graph_draft_immutable_id[\s\S]*'draft_neutralized'/,
  );
});

test('authorize exposes only the four-argument forward boundary', () => {
  const forward = migration.slice(
    migration.lastIndexOf('drop function if exists public.authorize_graph_draft_send'),
  );
  assert.match(forward, /authorize_graph_draft_send\(uuid,text,text,text\)/);
  assert.doesNotMatch(
    forward,
    /grant execute on function public\.authorize_graph_draft_send\(uuid,text,text\)\s+to service_role/,
  );
});

test('transactional recovery resumes one existing reservation without a second draft', () => {
  const claim = extractFunction(migration, 'claim_transactional_graph_dispatch');
  assert.equal(claim, extractFunction(schema, 'claim_transactional_graph_dispatch'));
  assert.match(claim, /status = 'reserved' and reservation_id is not null/);
  assert.match(claim, /claim_expires_at <= v_now/);
  assert.match(claim, /for update skip locked/);
  assert.match(claim, /where reservation_id = v_item\.reservation_id for update/);
  assert.match(claim, /transactional_dispatch_id is distinct from v_item\.id/);
  assert.match(claim, /'reason_code', 'reserved_recovery'/);
  assert.match(claim, /'reason_code', 'terminal_recovered'/);
  assert.match(claim, /'recovery_required', true/);
  assert.match(claim, /'resume_existing_reservation', true/);
  assert.match(claim, /'graph_draft_immutable_id'/);
  assert.match(claim, /'outcome_evidence_hash'/);
  assert.doesNotMatch(
    claim.slice(claim.indexOf("where status = 'reserved'")),
    /insert into public\.(graph_outbox|mailbox_delivery_reservations)/,
  );
});

test('suppressed draft finalization is evidence-bound and maps to a safe dispatch terminal', () => {
  const finalize = extractFunction(migration, 'finalize_transactional_graph_dispatch');
  assert.equal(finalize, extractFunction(schema, 'finalize_transactional_graph_dispatch'));
  assert.match(finalize, /'suppressed_before_send', 'deferred'/);
  assert.match(finalize, /when 'suppressed_before_send' then 'definitive_failed'/);
  assert.match(finalize, /v_outbox\.draft_neutralized_at is null/);
  assert.match(finalize, /v_outbox\.neutralization_evidence_hash is null/);
  assert.match(finalize, /set status = v_dispatch_outcome/);
  assert.match(finalize, /'dispatch_outcome', v_dispatch_outcome/);
  assert.match(finalize, /'graph_outbox_state', v_outbox\.state/);
});
