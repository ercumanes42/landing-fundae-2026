import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  exposedForbiddenServiceRolePaths,
  FORBIDDEN_SERVICE_ROLE_SCHEMA_PATHS,
  missingGraphMigrationContracts,
  missingCampaignSchemaPaths,
  missingProductionSchemaPaths,
  REQUIRED_CAMPAIGN_SCHEMA_PATHS,
  REQUIRED_GRAPH_MIGRATION_MARKERS,
  REQUIRED_PRODUCTION_SCHEMA_PATHS,
  REQUIRED_TRANSACTIONAL_SCHEMA_PATHS,
  resolveEnvironment,
} from './production-readiness';

const graphMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260818083632_graph_outbox_foundation.sql', import.meta.url),
  'utf8',
);
const envExample = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

test('static safe-close fixture keeps HubSpot synchronization explicitly OFF', () => {
  assert.match(envExample, /^HUBSPOT_SYNC_ENABLED=false$/m);
  assert.match(envExample, /^OPERATIONAL_OBSERVABILITY_ENABLED=false$/m);
});

test('accepts an OpenAPI specification containing every required campaign table and RPC', () => {
  const paths = Object.fromEntries(REQUIRED_CAMPAIGN_SCHEMA_PATHS.map((route) => [route, {}]));
  assert.deepEqual(missingCampaignSchemaPaths({ paths }), []);
});

test('fails closed for malformed metadata and reports every missing route', () => {
  assert.deepEqual(missingCampaignSchemaPaths(null), [...REQUIRED_CAMPAIGN_SCHEMA_PATHS]);
  assert.deepEqual(
    missingCampaignSchemaPaths({ paths: { '/campaign_executions': {} } }),
    REQUIRED_CAMPAIGN_SCHEMA_PATHS.filter((route) => route !== '/campaign_executions'),
  );
});

test('accepts an OpenAPI specification containing every campaign and transactional route', () => {
  const paths = Object.fromEntries(REQUIRED_PRODUCTION_SCHEMA_PATHS.map((route) => [route, {}]));
  assert.deepEqual(missingProductionSchemaPaths({ paths }), []);
});

test('reports all transactional routes when only the campaign schema is visible', () => {
  const paths = Object.fromEntries(REQUIRED_CAMPAIGN_SCHEMA_PATHS.map((route) => [route, {}]));
  assert.deepEqual(missingProductionSchemaPaths({ paths }), [...REQUIRED_TRANSACTIONAL_SCHEMA_PATHS]);
});

test('production schema validation fails closed for malformed metadata', () => {
  assert.deepEqual(missingProductionSchemaPaths(null), [...REQUIRED_PRODUCTION_SCHEMA_PATHS]);
});

test('requires Graph controls, outbox, dispatch and current RPC contracts', () => {
  for (const route of [
    '/outbound_delivery_control',
    '/outbound_daily_usage',
    '/graph_outbox',
    '/graph_outbox_authorizations',
    '/graph_outbox_events',
    '/transactional_dispatch_outbox',
    '/rpc/reserve_cold_graph_delivery',
    '/rpc/claim_transactional_graph_dispatch',
    '/rpc/reserve_claimed_transactional_graph_dispatch',
    '/rpc/finalize_transactional_graph_dispatch',
    '/rpc/authorize_graph_draft_send',
    '/rpc/confirm_graph_sent_item',
    '/rpc/emergency_halt_outbound_delivery',
  ]) assert.ok(REQUIRED_PRODUCTION_SCHEMA_PATHS.includes(route as never), route);
});

test('fails network readiness when service_role still sees internal or legacy RPCs', () => {
  const allowedPaths = Object.fromEntries(REQUIRED_PRODUCTION_SCHEMA_PATHS.map((route) => [route, {}]));
  assert.deepEqual(exposedForbiddenServiceRolePaths({ paths: allowedPaths }), []);
  for (const forbidden of FORBIDDEN_SERVICE_ROLE_SCHEMA_PATHS) {
    assert.deepEqual(
      exposedForbiddenServiceRolePaths({ paths: { ...allowedPaths, [forbidden]: {} } }),
      [forbidden],
    );
  }
});

test('legacy cold mailbox RPCs are forbidden rather than required', () => {
  assert.ok(!REQUIRED_TRANSACTIONAL_SCHEMA_PATHS.includes('/rpc/reserve_cold_mailbox_delivery' as never));
  assert.ok(!REQUIRED_TRANSACTIONAL_SCHEMA_PATHS.includes('/rpc/finalize_cold_mailbox_delivery' as never));
  assert.ok(FORBIDDEN_SERVICE_ROLE_SCHEMA_PATHS.includes('/rpc/reserve_cold_mailbox_delivery'));
  assert.ok(FORBIDDEN_SERVICE_ROLE_SCHEMA_PATHS.includes('/rpc/finalize_cold_mailbox_delivery'));
});

test('canonical Graph migration satisfies every static readiness contract', () => {
  assert.deepEqual(missingGraphMigrationContracts(graphMigration), []);
});

test('static readiness fails closed when a Graph migration contract is absent', () => {
  assert.deepEqual(
    missingGraphMigrationContracts('').sort(),
    Object.keys(REQUIRED_GRAPH_MIGRATION_MARKERS).sort(),
  );
  const withoutOutbox = graphMigration.replace('create table public.graph_outbox (', 'create table public.missing_graph_outbox (');
  assert.ok(missingGraphMigrationContracts(withoutOutbox).includes('graphOutbox'));
});

test('static readiness requires reserved recovery and suppressed-draft neutralization contracts', () => {
  const withoutRecovery = graphMigration.replace(
    "status = 'reserved' and reservation_id is not null",
    "status = 'missing_recovery_contract'",
  );
  assert.ok(
    missingGraphMigrationContracts(withoutRecovery).includes('transactionalStaleReservationRecovery'),
  );

  const withoutNeutralization = graphMigration.replaceAll(
    'v_outbox.draft_neutralized_at is null',
    'false',
  );
  assert.ok(
    missingGraphMigrationContracts(withoutNeutralization).includes('transactionalSuppressionNeutralization'),
  );
});

test('explicit process environment overrides a stale local env file', () => {
  assert.equal(
    resolveEnvironment(
      { TRANSACTIONAL_OUTLOOK_ENABLED: 'false' },
      'TRANSACTIONAL_OUTLOOK_ENABLED=true\nLOCAL_ONLY=value',
    ).TRANSACTIONAL_OUTLOOK_ENABLED,
    'false',
  );
});
