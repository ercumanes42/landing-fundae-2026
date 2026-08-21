import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260821123000_dashboard_campaign_insights.sql', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

test('campaign insights migration is mirrored and remains read-only/service-only', () => {
  assert.ok(schema.includes(migration));
  assert.match(migration, /security definer set search_path = ''/);
  assert.match(migration, /grant execute on function public\.dashboard_get_campaign_insights[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /\b(update|delete|truncate)\s+public\.campaign_/i);
});

test('campaign insights expose requested decision dimensions without PII', () => {
  for (const token of [
    "'by_variant'", "'performance_by_email'", "'events_by_hour'",
    "'engagement_by_action'", "'conversions'", "'Europe/Madrid'",
    "'opens_quality'", "'directional'", "'pii_included'",
  ]) assert.ok(migration.includes(token), `insights misses ${token}`);
  assert.doesNotMatch(migration, /contact_data|email_hash|recipient_email|html_body|subject/);
});
