import { createHash } from 'node:crypto';

import { env } from './env';
import { callRpc } from './supabase';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export interface CriticalOperationalAlert {
  code: string;
  reservationHash: string;
  evidenceHash: string;
}

interface RpcClient {
  <T>(name: string, args: Record<string, unknown>): Promise<T>;
}

interface ClaimedAlert {
  evaluationKey: string;
  dedupeKey: string;
  summaryCode: string;
  reservationHash: string;
  evidenceHash: string;
  attempt: number;
  claimToken: string;
}

export interface AlertDeliveryResult {
  state: 'off' | 'empty' | 'delivered' | 'retry_scheduled';
  reasonCode: string;
  evaluationKey: string | null;
  attempt?: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9_]+/g, '_').slice(0, 64);
}

function assertAlert(event: CriticalOperationalAlert): CriticalOperationalAlert {
  const code = normalizeCode(event.code);
  if (code !== event.code || !/^[A-Z][A-Z0-9_]{2,63}$/.test(code) ||
      !HASH.test(event.reservationHash) || !HASH.test(event.evidenceHash)) {
    throw new Error('critical operational alert is invalid');
  }
  return event;
}

function parseEnqueue(value: unknown): { evaluationKey: string; deliveryStatus: string } {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (row.accepted !== true || typeof row.evaluation_key !== 'string' || !HASH.test(row.evaluation_key) ||
      !['pending', 'claimed', 'delivered', 'dead_letter'].includes(String(row.delivery_status))) {
    throw new Error('durable alert enqueue was rejected');
  }
  return { evaluationKey: row.evaluation_key, deliveryStatus: String(row.delivery_status) };
}

function parseClaim(value: unknown): { reasonCode: string; item: ClaimedAlert | null } {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (row.accepted !== true || typeof row.reason_code !== 'string' || !Array.isArray(row.items) || row.items.length > 1) {
    throw new Error('durable alert claim is invalid');
  }
  if (row.items.length === 0) return { reasonCode: row.reason_code, item: null };
  const item = row.items[0] as Record<string, unknown>;
  if (typeof item.evaluation_key !== 'string' || !HASH.test(item.evaluation_key) ||
      typeof item.dedupe_key !== 'string' || !HASH.test(item.dedupe_key) ||
      typeof item.summary_code !== 'string' || !/^[A-Z][A-Z0-9_]{2,63}$/.test(item.summary_code) ||
      typeof item.reservation_hash !== 'string' || !HASH.test(item.reservation_hash) ||
      typeof item.evidence_hash !== 'string' || !HASH.test(item.evidence_hash) ||
      !Number.isSafeInteger(item.attempt) || Number(item.attempt) < 1 || Number(item.attempt) > 8 ||
      typeof item.claim_token !== 'string' || !UUID.test(item.claim_token)) {
    throw new Error('durable alert claim item is invalid');
  }
  return { reasonCode: row.reason_code, item: {
    evaluationKey: item.evaluation_key, dedupeKey: item.dedupe_key,
    summaryCode: item.summary_code, reservationHash: item.reservation_hash,
    evidenceHash: item.evidence_hash, attempt: Number(item.attempt), claimToken: item.claim_token,
  } };
}

function workerHash(purpose: string): string {
  return sha256(`fundae-operational-alert-worker-v1\x1f${purpose}`);
}

export function isOperationalAlertDeliveryEnabled(): boolean {
  return env('OPERATIONAL_ALERT_DELIVERY_ENABLED').trim().toLowerCase() === 'true';
}

export async function persistCriticalOperationalAlert(
  input: CriticalOperationalAlert,
  rpc: RpcClient = callRpc,
): Promise<{ evaluationKey: string; deliveryStatus: string }> {
  const event = assertAlert(input);
  return parseEnqueue(await rpc('enqueue_operational_alert_delivery', {
    p_summary_code: event.code,
    p_reservation_hash: event.reservationHash,
    p_evidence_hash: event.evidenceHash,
    p_actor_hash: workerHash('producer'),
  }));
}

function failureCode(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'WEBHOOK_TIMEOUT';
  if (error instanceof Error && /^WEBHOOK_HTTP_[45]XX$/.test(error.message)) return error.message;
  if (error instanceof Error && error.message === 'WEBHOOK_ENDPOINT_INVALID') return error.message;
  return 'WEBHOOK_NETWORK_ERROR';
}

async function postWebhook(
  item: ClaimedAlert,
  endpoint: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<void> {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('WEBHOOK_ENDPOINT_INVALID'); }
  if (url.protocol !== 'https:') throw new Error('WEBHOOK_ENDPOINT_INVALID');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'graph_outbox', severity: 'critical', code: item.summaryCode,
        reservationHash: item.reservationHash, evidenceHash: item.evidenceHash,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`WEBHOOK_HTTP_${response.status >= 500 ? '5XX' : '4XX'}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function deliverOperationalAlertOnce(options: {
  rpc?: RpcClient;
  fetchImpl?: typeof fetch;
  endpoint: string;
  workerPurpose: string;
  targetEvaluationKey?: string;
  timeoutMs?: number;
}): Promise<AlertDeliveryResult> {
  const rpc = options.rpc ?? callRpc;
  const worker = workerHash(options.workerPurpose);
  const claim = parseClaim(await rpc('claim_operational_alert_delivery', {
    p_worker_hash: worker,
    p_lease_seconds: 30,
    p_evaluation_key: options.targetEvaluationKey ?? null,
  }));
  if (!claim.item) return {
    state: claim.reasonCode === 'already_delivered' ? 'delivered' : 'empty',
    reasonCode: claim.reasonCode, evaluationKey: options.targetEvaluationKey ?? null,
  };
  const item = claim.item;
  try {
    await postWebhook(item, options.endpoint, options.fetchImpl ?? fetch, options.timeoutMs ?? 5_000);
  } catch (error) {
    const code = failureCode(error);
    const attemptEvidence = sha256(`alert-delivery-failure-v1\x1f${item.evaluationKey}\x1f${code}`);
    await rpc('finalize_operational_alert_delivery', {
      p_evaluation_key: item.evaluationKey, p_dedupe_key: item.dedupeKey,
      p_worker_hash: worker, p_claim_token: item.claimToken, p_outcome: 'retry',
      p_attempt_evidence_hash: attemptEvidence, p_failure_code: code,
    });
    return { state: 'retry_scheduled', reasonCode: code, evaluationKey: item.evaluationKey, attempt: item.attempt };
  }
  const attemptEvidence = sha256(`alert-delivery-success-v1\x1f${item.evaluationKey}`);
  const finalized = await rpc<Record<string, unknown>>('finalize_operational_alert_delivery', {
    p_evaluation_key: item.evaluationKey, p_dedupe_key: item.dedupeKey,
    p_worker_hash: worker, p_claim_token: item.claimToken, p_outcome: 'delivered',
    p_attempt_evidence_hash: attemptEvidence, p_failure_code: null,
  });
  if (finalized.accepted !== true || finalized.delivery_status !== 'delivered') {
    throw new Error('durable alert delivery finalize was rejected');
  }
  return { state: 'delivered', reasonCode: 'delivered', evaluationKey: item.evaluationKey, attempt: item.attempt };
}

export async function persistAndAttemptCriticalOperationalAlert(
  event: CriticalOperationalAlert,
  options: { rpc?: RpcClient; fetchImpl?: typeof fetch; endpoint?: string; enabled?: boolean } = {},
): Promise<void> {
  const persisted = await persistCriticalOperationalAlert(event, options.rpc ?? callRpc);
  const enabled = options.enabled ?? isOperationalAlertDeliveryEnabled();
  if (!enabled) throw new Error('operational alert delivery is disabled');
  const result = await deliverOperationalAlertOnce({
    rpc: options.rpc, fetchImpl: options.fetchImpl,
    endpoint: options.endpoint ?? env('NOTIFICATION_WEBHOOK_URL').trim(),
    workerPurpose: 'graph-immediate', targetEvaluationKey: persisted.evaluationKey,
  });
  if (result.state !== 'delivered') throw new Error('operational alert delivery was deferred');
}

export async function executeConfiguredOperationalAlertDeliveryOnce(): Promise<AlertDeliveryResult> {
  if (!isOperationalAlertDeliveryEnabled()) {
    return { state: 'off', reasonCode: 'alert_delivery_off', evaluationKey: null };
  }
  return deliverOperationalAlertOnce({
    endpoint: env('NOTIFICATION_WEBHOOK_URL').trim(), workerPurpose: 'observability-worker',
  });
}
