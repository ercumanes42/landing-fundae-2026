import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { env } from './env';
import { callRpc } from './supabase';

const MANAGED_SIGNAL_CODES = [
  'oauth',
  'mailbox',
  'graph_outbox',
  'graph_sent_confirmation',
  'reply_processor',
  'unsubscribe_processor',
  'hard_bounce_processor',
  'inbound_manual_review',
  'hubspot_sync',
  'make_scheduler',
  'campaign_pacing',
  'dashboard',
] as const;

const HEARTBEAT_CODES = new Set([
  'oauth', 'mailbox', 'graph_worker', 'reply_processor', 'unsubscribe_processor',
  'hard_bounce_processor', 'hubspot_sync', 'make_scheduler', 'campaign_worker', 'dashboard',
]);

export type AlertSeverity = 'warning' | 'critical';
export type HeartbeatStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown';
export type SafeMetrics = Record<string, number | boolean | null>;

export interface OperationalHeartbeat {
  signal_code: string;
  status: HeartbeatStatus;
  observed_at: string;
  metrics: SafeMetrics;
}

export interface OperationalSnapshot {
  generated_at: string;
  heartbeats: OperationalHeartbeat[];
  graph: {
    aged_10m: number;
    aged_30m: number;
    ambiguous: number;
    dlq: number;
    sent_unconfirmed_10m: number;
  };
  inbound: { manual_review_open: number; manual_review_oldest_seconds: number };
  campaign: { queued_aged_15m: number; ambiguous: number; in_flight: number };
  pacing: { cold_sent_today: number; spacing_violations: number };
  events_24h: { replies_24h: number; unsubscribes_24h: number; hard_bounces_24h: number };
  alerts: { open: number; acknowledged: number; critical: number };
}

export interface OperationalAlertObservation {
  dedupe_key: string;
  signal_code: string;
  severity: AlertSeverity;
  summary_code: string;
  metrics: SafeMetrics;
}

interface RpcClient {
  <T>(name: string, args: Record<string, unknown>): Promise<T>;
}

function finiteNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${field} is invalid`);
  return Number(value);
}

export function assertSafeMetrics(value: unknown): SafeMetrics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('metrics is invalid');
  const entries = Object.entries(value);
  if (entries.length > 32) throw new Error('metrics is invalid');
  const metrics: SafeMetrics = {};
  for (const [key, metric] of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) throw new Error('metrics is invalid');
    if (metric !== null && typeof metric !== 'boolean' &&
      !(typeof metric === 'number' && Number.isFinite(metric) && Math.abs(metric) <= Number.MAX_SAFE_INTEGER)) {
      throw new Error('metrics is invalid');
    }
    metrics[key] = metric as number | boolean | null;
  }
  return metrics;
}

export function parseOperationalHeartbeat(value: unknown): OperationalHeartbeat {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('heartbeat is invalid');
  const input = value as Record<string, unknown>;
  if (typeof input.signal_code !== 'string' || !HEARTBEAT_CODES.has(input.signal_code)) {
    throw new Error('heartbeat signal is invalid');
  }
  if (!['healthy', 'degraded', 'unavailable', 'unknown'].includes(String(input.status))) {
    throw new Error('heartbeat status is invalid');
  }
  if (typeof input.observed_at !== 'string' || !Number.isFinite(Date.parse(input.observed_at))) {
    throw new Error('heartbeat timestamp is invalid');
  }
  return {
    signal_code: input.signal_code,
    status: input.status as HeartbeatStatus,
    observed_at: new Date(input.observed_at).toISOString(),
    metrics: assertSafeMetrics(input.metrics ?? {}),
  };
}

function alert(
  signalCode: string,
  severity: AlertSeverity,
  summaryCode: string,
  metrics: SafeMetrics,
): OperationalAlertObservation {
  return {
    dedupe_key: createHash('sha256').update(`${signalCode}\0${summaryCode}`).digest('hex'),
    signal_code: signalCode,
    severity,
    summary_code: summaryCode,
    metrics,
  };
}

function heartbeatAlert(
  snapshot: OperationalSnapshot,
  signalCode: string,
  warningSeconds: number,
  criticalSeconds: number,
): OperationalAlertObservation | null {
  const heartbeat = snapshot.heartbeats.find((item) => item.signal_code === signalCode);
  const generatedAt = Date.parse(snapshot.generated_at);
  const ageSeconds = heartbeat
    ? Math.max(0, Math.floor((generatedAt - Date.parse(heartbeat.observed_at)) / 1_000))
    : criticalSeconds + 1;
  const status = heartbeat?.status ?? 'unknown';
  const metrics = { age_seconds: ageSeconds, missing: heartbeat === undefined };
  if (status === 'unavailable' || status === 'unknown' || ageSeconds > criticalSeconds) {
    return alert(signalCode, 'critical', `${signalCode.toUpperCase()}_UNAVAILABLE`, metrics);
  }
  if (status === 'degraded' || ageSeconds > warningSeconds) {
    return alert(signalCode, 'warning', `${signalCode.toUpperCase()}_DEGRADED`, metrics);
  }
  const pendingCount = heartbeat?.metrics.pending_count;
  const failureCount = heartbeat?.metrics.failure_count;
  const collisionCount = heartbeat?.metrics.collision_count;
  if (typeof collisionCount === 'number' && collisionCount > 0) {
    return alert(signalCode, 'critical', `${signalCode.toUpperCase()}_COLLISION`, { collision_count: collisionCount });
  }
  if (typeof failureCount === 'number' && failureCount > 0) {
    return alert(signalCode, 'critical', `${signalCode.toUpperCase()}_FAILURES`, { failure_count: failureCount });
  }
  if (typeof pendingCount === 'number' && pendingCount > 0) {
    return alert(signalCode, 'warning', `${signalCode.toUpperCase()}_BACKLOG`, { pending_count: pendingCount });
  }
  return null;
}

export function evaluateOperationalSnapshot(snapshot: OperationalSnapshot): OperationalAlertObservation[] {
  if (!Number.isFinite(Date.parse(snapshot.generated_at))) throw new Error('snapshot clock is invalid');
  const alerts: OperationalAlertObservation[] = [];
  const add = (observation: OperationalAlertObservation | null) => {
    if (observation) alerts.push(observation);
  };

  add(heartbeatAlert(snapshot, 'oauth', 300, 600));
  add(heartbeatAlert(snapshot, 'mailbox', 600, 900));
  add(heartbeatAlert(snapshot, 'reply_processor', 300, 900));
  add(heartbeatAlert(snapshot, 'unsubscribe_processor', 300, 900));
  add(heartbeatAlert(snapshot, 'hard_bounce_processor', 300, 900));
  add(heartbeatAlert(snapshot, 'hubspot_sync', 900, 1_800));
  add(heartbeatAlert(snapshot, 'make_scheduler', 300, 600));
  add(heartbeatAlert(snapshot, 'dashboard', 900, 1_800));

  const graph = snapshot.graph;
  if (graph.ambiguous > 0 || graph.dlq > 0) {
    add(alert('graph_outbox', 'critical', 'GRAPH_OUTBOX_HALTED', {
      ambiguous: graph.ambiguous,
      dlq: graph.dlq,
    }));
  } else if (graph.aged_30m > 0) {
    add(alert('graph_outbox', 'critical', 'GRAPH_OUTBOX_AGED_30M', { count: graph.aged_30m }));
  } else if (graph.aged_10m > 0) {
    add(alert('graph_outbox', 'warning', 'GRAPH_OUTBOX_AGED_10M', { count: graph.aged_10m }));
  }
  if (graph.sent_unconfirmed_10m > 0) {
    add(alert('graph_sent_confirmation', 'critical', 'GRAPH_SENT_CONFIRMATION_STALE', {
      count: graph.sent_unconfirmed_10m,
    }));
  }

  if (snapshot.inbound.manual_review_open > 0) {
    add(alert(
      'inbound_manual_review',
      snapshot.inbound.manual_review_oldest_seconds > 1_800 ? 'critical' : 'warning',
      'INBOUND_MANUAL_REVIEW_OPEN',
      {
        count: snapshot.inbound.manual_review_open,
        oldest_seconds: snapshot.inbound.manual_review_oldest_seconds,
      },
    ));
  }

  if (snapshot.campaign.ambiguous > 0 || snapshot.pacing.spacing_violations > 0 ||
      snapshot.pacing.cold_sent_today > 480) {
    add(alert('campaign_pacing', 'critical', 'CAMPAIGN_KILL_THRESHOLD', {
      ambiguous: snapshot.campaign.ambiguous,
      spacing_violations: snapshot.pacing.spacing_violations,
      sent_today: snapshot.pacing.cold_sent_today,
    }));
  } else if (snapshot.campaign.queued_aged_15m > 0 || snapshot.pacing.cold_sent_today >= 432) {
    add(alert('campaign_pacing', 'warning', 'CAMPAIGN_PACING_WARNING', {
      queued_aged_15m: snapshot.campaign.queued_aged_15m,
      sent_today: snapshot.pacing.cold_sent_today,
    }));
  }

  return alerts.sort((left, right) => left.dedupe_key.localeCompare(right.dedupe_key));
}

function normalizeSnapshot(value: OperationalSnapshot): OperationalSnapshot {
  const snapshot = structuredClone(value);
  for (const [group, fields] of Object.entries({
    graph: ['aged_10m', 'aged_30m', 'ambiguous', 'dlq', 'sent_unconfirmed_10m'],
    inbound: ['manual_review_open', 'manual_review_oldest_seconds'],
    campaign: ['queued_aged_15m', 'ambiguous', 'in_flight'],
    pacing: ['cold_sent_today', 'spacing_violations'],
    events_24h: ['replies_24h', 'unsubscribes_24h', 'hard_bounces_24h'],
    alerts: ['open', 'acknowledged', 'critical'],
  })) {
    const record = snapshot[group as keyof OperationalSnapshot] as unknown as Record<string, unknown>;
    for (const field of fields) record[field] = finiteNonNegativeInteger(record[field], `${group}.${field}`);
  }
  snapshot.heartbeats = snapshot.heartbeats.map(parseOperationalHeartbeat);
  return snapshot;
}

export function isOperationalObservabilityEnabled(): boolean {
  return env('OPERATIONAL_OBSERVABILITY_ENABLED').trim().toLowerCase() === 'true';
}

export function authorizeOperationalRequest(request: Request): boolean {
  const expected = env('OBSERVABILITY_WORKER_SECRET');
  const authorization = request.headers.get('authorization') ?? '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export function operationalMachineActorHash(): string {
  const secret = env('OBSERVABILITY_WORKER_SECRET');
  if (secret.length < 32) throw new Error('OBSERVABILITY_WORKER_SECRET is invalid');
  return createHmac('sha256', secret).update('observability-machine-v1').digest('hex');
}

export async function getOperationalSnapshot(rpc: RpcClient = callRpc): Promise<OperationalSnapshot> {
  if (!isOperationalObservabilityEnabled()) throw new Error('OPERATIONAL_OBSERVABILITY_ENABLED is false');
  return normalizeSnapshot(await rpc<OperationalSnapshot>('get_operational_observability_snapshot', {
    p_now: new Date().toISOString(),
  }));
}

export async function recordOperationalHeartbeat(
  heartbeat: OperationalHeartbeat,
  rpc: RpcClient = callRpc,
): Promise<void> {
  if (!isOperationalObservabilityEnabled()) throw new Error('OPERATIONAL_OBSERVABILITY_ENABLED is false');
  await rpc('record_operational_heartbeat', {
    p_signal_code: heartbeat.signal_code,
    p_status: heartbeat.status,
    p_observed_at: heartbeat.observed_at,
    p_metrics: heartbeat.metrics,
  });
}

export async function reconcileOperationalAlerts(
  snapshot: OperationalSnapshot,
  actorHash: string,
  rpc: RpcClient = callRpc,
): Promise<{ alerts: OperationalAlertObservation[]; evaluation_key: string }> {
  if (!isOperationalObservabilityEnabled()) throw new Error('OPERATIONAL_OBSERVABILITY_ENABLED is false');
  if (!/^[a-f0-9]{64}$/.test(actorHash)) throw new Error('actor hash is invalid');
  const normalized = normalizeSnapshot(snapshot);
  const alerts = evaluateOperationalSnapshot(normalized);
  const evaluationKey = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  await rpc('reconcile_operational_alerts', {
    p_evaluation_key: evaluationKey,
    p_evaluated_at: normalized.generated_at,
    p_actor_hash: actorHash,
    p_alerts: alerts,
    p_managed_signal_codes: [...MANAGED_SIGNAL_CODES],
  });
  return { alerts, evaluation_key: evaluationKey };
}

export async function transitionOperationalAlert(
  dedupeKey: string,
  action: 'acknowledged' | 'resolved',
  actorHash: string,
  rpc: RpcClient = callRpc,
): Promise<void> {
  if (!isOperationalObservabilityEnabled()) throw new Error('OPERATIONAL_OBSERVABILITY_ENABLED is false');
  if (!/^[a-f0-9]{64}$/.test(dedupeKey) || !/^[a-f0-9]{64}$/.test(actorHash)) {
    throw new Error('alert transition is invalid');
  }
  await rpc('transition_operational_alert', {
    p_dedupe_key: dedupeKey,
    p_action: action,
    p_actor_hash: actorHash,
    p_evidence: {},
  });
}
