import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attemptTransactionalGraphPilotSignalHalt,
  validateTransactionalGraphPilotRuntimePreflight,
} from './transactional-graph-pilot-runtime';

const HASH = 'a'.repeat(64);
const UUID = '018f1e20-7b5d-7d20-8c3a-4b5c6d7e8f90';
const liveEnvironment: Record<string, string> = {
  TRANSACTIONAL_GRAPH_PILOT_LIVE_ENABLED: 'true',
  TRANSACTIONAL_PILOT_MODE: 'true',
  OUTBOUND_MASTER_ENABLED: 'true',
  TRANSACTIONAL_OUTLOOK_ENABLED: 'true',
  COLD_CAMPAIGN_ENABLED: 'false',
  COLD_CAMPAIGN_PROVISIONING_ENABLED: 'false',
  LEGACY_MAKE_DELIVERY_ENABLED: 'false',
  LEGACY_DELIVERY_RETRY_ENABLED: 'false',
  SUPABASE_URL: 'https://staging.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(32),
  GRAPH_TENANT_ID: UUID,
  GRAPH_CLIENT_ID: UUID,
  GRAPH_CLIENT_SECRET: 'c'.repeat(32),
  GRAPH_MAILBOX_USER_ID: UUID,
  GRAPH_MAILBOX_ADDRESS: 'pilot@example.com',
  GRAPH_WORKER_SECRET: 'w'.repeat(32),
  GRAPH_DISPATCH_WORKER_ID: UUID,
  GRAPH_OUTBOX_CAPABILITY_SECRET: 'o'.repeat(32),
  MAILBOX_IDENTITY_HASH: HASH,
  GRAPH_REQUEST_TIMEOUT_MS: '10000',
  GRAPH_READ_MAX_ATTEMPTS: '4',
  GRAPH_MAX_RETRY_DELAY_MS: '30000',
  GRAPH_MARKER_POLL_ATTEMPTS: '4',
  GRAPH_SENT_POLL_ATTEMPTS: '10',
  GRAPH_POLL_INTERVAL_MS: '2000',
  TRANSACTIONAL_GRAPH_PILOT_TTL_SECONDS: '600',
};

function validate(overrides: Record<string, string> = {}, live = true) {
  const environment = { ...liveEnvironment, ...overrides };
  return validateTransactionalGraphPilotRuntimePreflight({ live, read: (key) => environment[key] ?? '' });
}

test('live preflight accepts only the complete transactional Graph runtime', () => {
  assert.deepEqual(validate(), {
    ok: true,
    reasonCode: 'pilot_runtime_ready',
    rpcTimeoutMs: 10_000,
  });
});

test('live preflight fails closed before database work for flags, identity, secrets and bounds', () => {
  const invalidOverrides: Array<Record<string, string>> = [
    { OUTBOUND_MASTER_ENABLED: 'false' },
    { TRANSACTIONAL_PILOT_MODE: 'false' },
    { TRANSACTIONAL_OUTLOOK_ENABLED: 'TRUE' },
    { COLD_CAMPAIGN_ENABLED: 'true' },
    { LEGACY_MAKE_DELIVERY_ENABLED: 'true' },
    { GRAPH_CLIENT_SECRET: 'short' },
    { GRAPH_MAILBOX_ADDRESS: 'invalid' },
    { GRAPH_DISPATCH_WORKER_ID: 'worker' },
    { MAILBOX_IDENTITY_HASH: 'A'.repeat(64) },
    { GRAPH_SENT_POLL_ATTEMPTS: '31' },
    { TRANSACTIONAL_GRAPH_PILOT_TTL_SECONDS: '901' },
  ];
  for (const override of invalidOverrides) {
    assert.equal(validate(override).reasonCode, 'pilot_live_preflight_failed');
  }
});

test('RPC timeout is bounded for dry-run and live', () => {
  assert.deepEqual(validate({ GRAPH_REQUEST_TIMEOUT_MS: '249' }, false), {
    ok: false,
    reasonCode: 'pilot_rpc_timeout_invalid',
    rpcTimeoutMs: 0,
  });
  assert.equal(validate({}, false).ok, true);
});

test('signal halt is best-effort, scoped to live and never propagates endpoint failures', async () => {
  let attempts = 0;
  assert.equal(await attemptTransactionalGraphPilotSignalHalt({
    live: true,
    actorHash: HASH,
    emergencyHalt: async () => {
      attempts += 1;
      return { accepted: true, reasonCode: 'halted', runId: null, candidateCount: 0, outboundOff: true };
    },
  }), true);
  assert.equal(attempts, 1);
  assert.equal(await attemptTransactionalGraphPilotSignalHalt({
    live: true,
    actorHash: HASH,
    emergencyHalt: async () => {
      throw new Error('endpoint unavailable');
    },
  }), false);
  assert.equal(await attemptTransactionalGraphPilotSignalHalt({
    live: false,
    actorHash: HASH,
    emergencyHalt: async () => {
      throw new Error('must not run');
    },
  }), false);
});
