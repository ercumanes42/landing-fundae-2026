import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const supabaseRoot = join(process.cwd(), 'supabase');
const migrationName = '20260819224739_hubspot_sync_outbox.sql';

function normalized(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n').trim();
}

test('HubSpot outbox migration is private, versioned and OFF by default', () => {
  const sql = normalized(join(supabaseRoot, 'migrations', migrationName));
  for (const contract of [
    'hubspot_enabled boolean not null default false',
    'hubspot_sync_outbox',
    'campaign_contacts_enqueue_hubspot_insert',
    'campaign_contacts_enqueue_hubspot_state',
    'for update of o skip locked',
    "status='claimed'",
    'desired_version',
    'claimed_version',
    "then 'dead_letter'",
    'enqueue_operational_alert_delivery',
    'enable row level security',
    'force row level security',
    'from public,anon,authenticated,service_role',
    'to service_role',
    'set hubspot_enabled=false',
  ]) assert.ok(sql.includes(contract), `missing HubSpot SQL contract: ${contract}`);
  assert.match(sql, /^--[\s\S]*\nbegin;[\s\S]*commit;$/i);
  assert.doesNotMatch(sql, /pg_catalog\.(?:coalesce|nullif|substring)\b/i);
  assert.doesNotMatch(sql, /master_enabled\s*=\s*true|hubspot_enabled\s*=\s*true/i);
});

test('HubSpot migration is mirrored exactly before the next canonical marker', () => {
  const migration = normalized(join(supabaseRoot, 'migrations', migrationName));
  const schema = readFileSync(join(supabaseRoot, 'schema.sql'), 'utf8').replaceAll('\r\n', '\n');
  const marker = `-- ${migrationName}`;
  const start = schema.lastIndexOf(marker);
  assert.notEqual(start, -1);
  const next = schema.indexOf('\n-- 20260819230000_', start + marker.length);
  assert.notEqual(next, -1);
  assert.equal(schema.slice(start + marker.length, next).trim(), migration);
});
