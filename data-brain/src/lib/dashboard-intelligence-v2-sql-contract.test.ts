import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260821105809_data_brain_intelligence_v2.sql', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
  .replaceAll('\r\n', '\n');

function sqlFunction(name: string): string {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} missing`);
  const end = migration.indexOf('$$;', start);
  assert.notEqual(end, -1, `${name} unterminated`);
  return migration.slice(start, end + 3);
}

test('intelligence v2 migration is mirrored and cannot enable outbound delivery', () => {
  assert.ok(schema.includes(migration.trimEnd()));
  assert.match(migration, /^-- Data Brain Intelligence v2:[\s\S]*\nbegin;/);
  assert.match(migration, /\ncommit;\s*$/);
  assert.doesNotMatch(migration, /\b(update|insert into)\s+public\.outbound_delivery_control\b/i);
  assert.doesNotMatch(migration, /\b(update|insert into)\s+public\.cold_campaign_dispatch_outbox\b/i);
});

test('internal pipeline is private, constrained, indexed and service-only through RBAC RPC', () => {
  const upsert = sqlFunction('dashboard_upsert_revenue_pipeline');
  assert.match(migration, /create table fundae_private\.campaign_revenue_pipeline/);
  assert.match(migration, /campaign_revenue_pipeline_contact_key unique/);
  assert.match(migration, /campaign_revenue_pipeline_stage_idx/);
  assert.match(migration, /campaign_revenue_pipeline_expected_close_idx[\s\S]*where expected_close_on is not null/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all privileges on table fundae_private\.campaign_revenue_pipeline[\s\S]*service_role/);
  assert.match(upsert, /security definer set search_path = ''/);
  assert.match(upsert, /array\['admin', 'operator'\]/);
  assert.match(upsert, /dashboard_pipeline_version_conflict/);
  assert.match(upsert, /dashboard_pipeline_stage_regression/);
  assert.match(upsert, /dashboard_pipeline_terminal_state/);
  assert.match(upsert, /'data-brain-contact-ref-v1:'/);
  assert.match(upsert, /'pii_included', false/);
  assert.match(migration, /grant execute on function public\.dashboard_upsert_revenue_pipeline[\s\S]*to service_role/);
});

test('intelligence RPC uses allowlisted filters and attributed campaign dimensions', () => {
  const intelligence = sqlFunction('dashboard_get_intelligence_v2');
  assert.match(intelligence, /security definer set search_path = ''/);
  assert.match(intelligence, /'email_step', 'variant', 'lot', 'hour', 'company_size', 'tool', 'copy_key'/);
  assert.match(intelligence, /e\.context ->> 'utm_campaign'/);
  assert.match(intelligence, /e\.context ->> 'utm_content'/);
  assert.match(intelligence, /left join lateral/);
  assert.match(intelligence, /order by eb\.actual_at desc, eb\.id desc limit 1/);
  assert.match(intelligence, /'email_' \|\| ex\.step::text \|\| ':' \|\| cc\.variant/);
  assert.match(intelligence, /'Europe\/Madrid'/);
  assert.match(migration, /grant execute on function public\.dashboard_get_intelligence_v2[\s\S]*to service_role/);
});

test('intelligence output includes rates, confidence, journey, quality and internal revenue', () => {
  const intelligence = sqlFunction('dashboard_get_intelligence_v2');
  for (const token of [
    "'overview'", "'funnel'", "'by_email'", "'by_copy'", "'by_campaign'", "'by_variant'", "'by_hour'", "'time_series'",
    "'tools'", "'journey'", "'pipeline'", "'quality'", "'anomalies'",
    "'recommendations'", "'cohorts'", "'traffic'", "'abandonment_by_section'", "'high_intent_contacts'",
    "'available_filters'", "'metric_contract'", "'delivery_rate'", "'bounce_rate'",
    "'click_rate'", "'reply_rate'", "'positive_reply_rate'", "'meeting_rate'",
    "'wilson_low_95'", "'wilson_high_95'", "'avg_active_seconds'",
    "'lift_percentage_points'", "'avg_hours_to_first_click'",
    "'avg_hours_to_first_reply'", "'avg_hours_to_first_meeting'", "'avg_days_email_to_sale'",
    "'avg_scroll_percent'", "'abandoned_sessions'", "'steps'",
    "'email_attribution_rate'", "'by_domain_source'", "'by_link'",
    "'production_events'", "'test_events'", "'weighted_amount'", "'win_rate'",
    "'duplicate_campaign_event_keys'", "'campaign_events_without_execution'",
    "'by_source'", "'by_outcome_reason'", "'outcome_reason'",
    "'external_crm_required', false", "'pii_included', false",
  ]) assert.ok(intelligence.includes(token), `intelligence misses ${token}`);
  assert.match(intelligence, /sent_contacts >= 30/);
  assert.match(intelligence, /1\.96 \* pg_catalog\.sqrt/);
  assert.match(intelligence, /'site_general'/);
  assert.match(intelligence, /'unattributed'/);
  assert.match(intelligence, /pipeline_source_rollup/);
  assert.match(intelligence, /pipeline_outcome_reason_rollup/);
  assert.match(intelligence, /copy_rollup/);
  assert.match(intelligence, /campaign_rollup/);
  assert.match(intelligence, /high_intent_candidates/);
  assert.match(intelligence, /'data-brain-high-intent-v1:'/);
  assert.match(intelligence, /limit 100/);
  assert.doesNotMatch(intelligence, /coalesce\(nullif\(e\.context ->> 'utm_medium', ''\), 'unknown'\)/);
  assert.match(intelligence, /time_series_rollup/);
  assert.match(intelligence, /pg_catalog\.timezone\('Europe\/Madrid', closed_at\)::date/);
  assert.match(intelligence, /'date', activity_date, 'sent', sent, 'clicked', clicked/);
  assert.match(intelligence, /'opportunities', opportunities, 'closed_amount', closed_amount/);
});

test('RPC boundary and aggregates omit raw PII and external CRM dependency', () => {
  for (const forbidden of [
    'contact_data', 'email_hash', 'recipient_email', 'first_name', 'last_name',
    'phone_number', 'postal_address', 'html_body', 'subject_line',
  ]) assert.ok(!migration.includes(forbidden), `migration exposes ${forbidden}`);
  assert.ok(!migration.toLowerCase().includes('hubspot'));
});
