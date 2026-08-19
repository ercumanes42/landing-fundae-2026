import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSafeMetrics,
  evaluateOperationalSnapshot,
  getOperationalSnapshot,
  parseOperationalHeartbeat,
  reconcileOperationalAlerts,
  type OperationalSnapshot,
} from './operational-observability';

const NOW = '2026-08-19T12:00:00.000Z';
const ACTOR_HASH = 'a'.repeat(64);

function snapshot(overrides: Partial<OperationalSnapshot> = {}): OperationalSnapshot {
  const heartbeats = [
    'oauth', 'mailbox', 'reply_processor', 'unsubscribe_processor',
    'hard_bounce_processor', 'hubspot_sync', 'make_scheduler', 'dashboard',
  ].map((signal_code) => ({ signal_code, status: 'healthy' as const, observed_at: NOW, metrics: {} }));
  return {
    generated_at: NOW,
    heartbeats,
    graph: { aged_10m: 0, aged_30m: 0, ambiguous: 0, dlq: 0, sent_unconfirmed_10m: 0 },
    inbound: { manual_review_open: 0, manual_review_oldest_seconds: 0 },
    campaign: { queued_aged_15m: 0, ambiguous: 0, in_flight: 0 },
    pacing: { cold_sent_today: 0, spacing_violations: 0 },
    events_24h: { replies_24h: 0, unsubscribes_24h: 0, hard_bounces_24h: 0 },
    alerts: { open: 0, acknowledged: 0, critical: 0 },
    ...overrides,
  };
}

function withEnv(values: Record<string, string | undefined>, action: () => Promise<void> | void) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve(action()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('healthy fresh aggregate produces no alerts', () => {
  assert.deepEqual(evaluateOperationalSnapshot(snapshot()), []);
});

test('freshness, ambiguity, confirmation, manual review and pacing cross deterministic thresholds', () => {
  const stale = new Date(Date.parse(NOW) - 1_801_000).toISOString();
  const input = snapshot({
    heartbeats: snapshot().heartbeats.map((heartbeat) =>
      heartbeat.signal_code === 'hubspot_sync'
        ? { ...heartbeat, observed_at: stale, metrics: { failure_count: 2 } }
        : heartbeat),
    graph: { aged_10m: 3, aged_30m: 1, ambiguous: 1, dlq: 0, sent_unconfirmed_10m: 1 },
    inbound: { manual_review_open: 2, manual_review_oldest_seconds: 1_801 },
    campaign: { queued_aged_15m: 1, ambiguous: 0, in_flight: 1 },
    pacing: { cold_sent_today: 481, spacing_violations: 1 },
  });
  const alerts = evaluateOperationalSnapshot(input);
  const codes = new Set(alerts.map((item) => item.summary_code));
  for (const expected of [
    'HUBSPOT_SYNC_UNAVAILABLE', 'GRAPH_OUTBOX_HALTED', 'GRAPH_SENT_CONFIRMATION_STALE',
    'INBOUND_MANUAL_REVIEW_OPEN', 'CAMPAIGN_KILL_THRESHOLD',
  ]) assert.ok(codes.has(expected), expected);
  assert.ok(alerts.every((item) => item.severity === 'critical'));
});

test('same snapshot replay creates the same evaluation and alert keys', () => withEnv({
  OPERATIONAL_OBSERVABILITY_ENABLED: 'true',
}, async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc = async <T>(name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return { accepted: true } as T;
  };
  const input = snapshot({ graph: { aged_10m: 1, aged_30m: 0, ambiguous: 0, dlq: 0, sent_unconfirmed_10m: 0 } });
  const first = await reconcileOperationalAlerts(input, ACTOR_HASH, rpc);
  const replay = await reconcileOperationalAlerts(input, ACTOR_HASH, rpc);
  assert.equal(first.evaluation_key, replay.evaluation_key);
  assert.deepEqual(first.alerts, replay.alerts);
  assert.deepEqual(calls[0], calls[1]);
}));

test('OFF switch prevents RPC and network work', () => withEnv({
  OPERATIONAL_OBSERVABILITY_ENABLED: 'false',
}, async () => {
  let calls = 0;
  await assert.rejects(
    getOperationalSnapshot(async <T>() => { calls += 1; return snapshot() as T; }),
    /OPERATIONAL_OBSERVABILITY_ENABLED is false/,
  );
  assert.equal(calls, 0);
}));

test('heartbeat and metrics fail closed on PII, nesting and unbounded values', () => {
  assert.throws(() => assertSafeMetrics({ email: 'person@example.com' }), /metrics is invalid/);
  assert.throws(() => assertSafeMetrics({ nested: { count: 1 } }), /metrics is invalid/);
  assert.throws(() => parseOperationalHeartbeat({
    signal_code: 'mailbox', status: 'healthy', observed_at: NOW, metrics: { subject: 'private' },
  }), /metrics is invalid/);
  assert.deepEqual(assertSafeMetrics({ pending_count: 2, connected: true }), {
    pending_count: 2,
    connected: true,
  });
});
