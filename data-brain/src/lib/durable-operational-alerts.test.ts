import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  deliverOperationalAlertOnce,
  persistAndAttemptCriticalOperationalAlert,
} from './durable-operational-alerts';

const evaluationKey = 'a'.repeat(64);
const dedupeKey = 'b'.repeat(64);
const reservationHash = 'c'.repeat(64);
const evidenceHash = 'd'.repeat(64);
const claimTokens = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const event = { code: 'AMBIGUOUS_CREATE_TIMEOUT', reservationHash, evidenceHash };

test('OFF delivery persists intent first and performs zero webhook calls', async () => {
  const calls: string[] = [];
  let fetchCalls = 0;
  const rpc = async <T>(name: string) => {
    calls.push(name);
    return { accepted: true, evaluation_key: evaluationKey, delivery_status: 'pending' } as T;
  };
  await assert.rejects(() => persistAndAttemptCriticalOperationalAlert(event, {
    rpc, enabled: false, fetchImpl: async () => { fetchCalls += 1; return new Response(null, { status: 204 }); },
  }), /delivery is disabled/);
  assert.deepEqual(calls, ['enqueue_operational_alert_delivery']);
  assert.equal(fetchCalls, 0);
});

test('webhook fault schedules durable retry and replay delivers once without losing intent', async () => {
  let status: 'pending' | 'claimed' | 'delivered' = 'pending';
  let attempt = 0;
  let fetchCalls = 0;
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc = async <T>(name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === 'enqueue_operational_alert_delivery') {
      return { accepted: true, evaluation_key: evaluationKey, delivery_status: status } as T;
    }
    if (name === 'claim_operational_alert_delivery') {
      if (status === 'delivered') return { accepted: true, reason_code: 'already_delivered', items: [] } as T;
      status = 'claimed';
      attempt += 1;
      return { accepted: true, reason_code: 'claimed', items: [{
        evaluation_key: evaluationKey, dedupe_key: dedupeKey,
        summary_code: event.code, reservation_hash: reservationHash,
        evidence_hash: evidenceHash, attempt, claim_token: claimTokens[attempt - 1],
      }] } as T;
    }
    if (name === 'finalize_operational_alert_delivery') {
      status = args.p_outcome === 'delivered' ? 'delivered' : 'pending';
      return { accepted: true, duplicate: false, delivery_status: status } as T;
    }
    throw new Error(`unexpected RPC ${name}`);
  };
  const failedFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    fetchCalls += 1;
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.deepEqual(payload, { source: 'graph_outbox', severity: 'critical', code: event.code, reservationHash, evidenceHash });
    assert.equal(JSON.stringify(payload).includes('@'), false);
    return new Response(null, { status: 503 });
  };
  await assert.rejects(() => persistAndAttemptCriticalOperationalAlert(event, {
    rpc, enabled: true, endpoint: 'https://alerts.example.invalid/hook', fetchImpl: failedFetch,
  }), /delivery was deferred/);
  assert.equal(status, 'pending');
  assert.equal(rpcCalls.at(-1)?.args.p_outcome, 'retry');
  assert.equal(rpcCalls.at(-1)?.args.p_failure_code, 'WEBHOOK_HTTP_5XX');

  const replay = await deliverOperationalAlertOnce({
    rpc, endpoint: 'https://alerts.example.invalid/hook', workerPurpose: 'replay-test',
    fetchImpl: async () => { fetchCalls += 1; return new Response(null, { status: 204 }); },
  });
  assert.equal(replay.state, 'delivered');
  assert.equal(status, 'delivered');
  const duplicate = await deliverOperationalAlertOnce({
    rpc, endpoint: 'https://alerts.example.invalid/hook', workerPurpose: 'replay-test',
    fetchImpl: async () => { fetchCalls += 1; throw new Error('must not redeliver'); },
  });
  assert.equal(duplicate.state, 'delivered');
  assert.equal(duplicate.reasonCode, 'already_delivered');
  assert.equal(fetchCalls, 2);
});

test('SQL queue is private, bounded, recoverable and atomically wired to DB halts', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260819230000_durable_operational_alert_delivery.sql', import.meta.url), 'utf8').toLowerCase();
  const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8').toLowerCase();
  const schemaBlock = schema.slice(schema.indexOf('-- 20260819230000_durable_operational_alert_delivery.sql'));
  for (const marker of [
    "default 'not_requested'", "delivery_status in ('not_requested','pending','claimed','delivered','dead_letter')",
    'delivery_attempt_count between 0 and 8', 'for update of r skip locked',
    'reservation_hash is not null', 'claim_token_hash is not null',
    'p_attempt_evidence_hash is null', 'p_failure_code is null',
    "delivery_status='claimed' and claim_expires_at<=v_now", "last_failure_code='attempts_exhausted'",
    'operational_alert_receipts_delivery_pending_idx', 'operational_alert_receipts_delivery_claimed_idx',
    'graph_outbox_capture_ambiguity', 'cold_dispatch_capture_ambiguity',
    'transactional_dispatch_capture_ambiguity', 'set transactional_enabled=false', 'set cold_enabled=false',
    "last_reason_code='ambiguous_transactional_dispatch_halted'",
    'and new.outcome_evidence_hash is not null',
    'halt_transactional_graph_dispatch', 'revoke execute on function public.capture_graph_outbox_ambiguity()',
  ]) assert.ok(sql.includes(marker), `missing durable alert contract: ${marker}`);
  assert.equal(sql.includes('lead_hash_secret'), false);
  assert.equal(sql.includes('pg_catalog.coalesce'), false);
  assert.equal(schemaBlock.includes('pg_catalog.coalesce'), false);
  assert.equal(sql.includes('pg_catalog.substring'), false);
  assert.equal(schemaBlock.includes('pg_catalog.substring'), false);
  assert.ok(schemaBlock.includes(sql.trim()), 'schema must mirror the durable alert migration exactly');
});
