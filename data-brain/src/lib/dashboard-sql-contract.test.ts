import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260819120000_dashboard_aggregates_rbac.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');

function fn(sql: string, name: string): string {
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} missing`);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, `${name} unterminated`);
  return sql.slice(start, end + 3).replaceAll('\r\n', '\n');
}

test('dashboard summary and sample functions are mirrored', () => {
  for (const name of ['dashboard_require_role', 'dashboard_get_summary', 'dashboard_get_sample']) {
    assert.equal(fn(migration, name), fn(schema, name));
  }
});

test('RBAC is fail-closed, audited and least-privilege', () => {
  assert.match(migration, /role in \('admin', 'operator', 'auditor', 'read_only'\)/);
  assert.match(migration, /v_role not in \('admin', 'auditor'\)/);
  assert.match(migration, /array\['admin', 'operator', 'auditor'\]/);
  assert.match(migration, /dashboard_audit_is_append_only/);
  assert.match(migration, /force row level security/g);
  assert.match(migration, /revoke all privileges on table public\.dashboard_principals[\s\S]*service_role/);
  assert.match(migration, /security definer set search_path = ''/g);
  assert.match(migration, /grant execute on function public\.dashboard_get_summary[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant (select|insert|update|delete|all).*dashboard_(principals|audit_log)/i);
});

test('aggregates are server-side and samples remain bounded without PII', () => {
  const summary = fn(migration, 'dashboard_get_summary');
  const sample = fn(migration, 'dashboard_get_sample');
  assert.match(summary, /count\(\*\)/);
  assert.match(summary, /group by/);
  assert.doesNotMatch(summary, /select \*|jsonb_agg/);
  assert.doesNotMatch(summary, /payload|contact_data|email_hash|graph_draft_immutable_id/);
  assert.match(sample, /p_offset > 100000/);
  assert.match(sample, /then 100 else 50 end/);
  assert.match(sample, /offset p_offset limit v_limit/g);
  assert.match(sample, /'pii_included', false/);
  assert.doesNotMatch(sample, /contact_data|email_hash|payload|internet_message_id_hash/);
});

test('summary exposes all five operational domains and freshness control', () => {
  const summary = fn(migration, 'dashboard_get_summary');
  for (const token of [
    "'funnel'", "'journey'", "'transactional'", "'campaign'", "'health'",
    "'dispatch_by_status'", "'claims_total'", "'reservations_by_status'",
    "'tx_events_by_name'", "'mailboxes_blocked'", "'control'",
  ]) assert.ok(summary.includes(token), `summary misses ${token}`);
  assert.match(summary, /p_to - p_from > interval '366 days'/);
});
