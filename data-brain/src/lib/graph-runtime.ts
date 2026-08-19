import { createHmac, timingSafeEqual } from 'node:crypto';

import { executeColdCampaignTick } from './cold-campaign-dispatch';
import { env, isOutboundCapabilityEnabled } from './env';
import { executeGraphDispatchOnce } from './graph-dispatch';
import { SecureMicrosoftGraphClient } from './graph-secure-client';
import { GraphOutboxRepository } from './graph-outbox-repository';
import { executeTransactionalGraphJob } from './graph-worker';
import { callRpc } from './supabase';
import {
  buildTransactionalDeliveryPackage,
  buildTransactionalDeliveryPackageBySubmission,
} from './transactional-delivery-package';

function required(key: Parameters<typeof env>[0], minimum = 1): string {
  const value = env(key).trim();
  if (value.length < minimum) throw new Error('Graph runtime is not configured');
  return value;
}

function boundedInteger(key: Parameters<typeof env>[0], fallback: number, minimum: number, maximum: number): number {
  const value = Number(env(key));
  return Number.isSafeInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

export function authorizeGraphWorkerBearerRequest(request: Request): boolean {
  const authorization = request.headers.get('authorization') ?? '';
  const bearerSecret = env('GRAPH_WORKER_SECRET');
  if (!authorization.startsWith('Bearer ') || bearerSecret.length < 32) return false;
  const supplied = Buffer.from(authorization.slice(7), 'utf8');
  const expected = Buffer.from(bearerSecret, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export function authorizeGraphInternalRequest(request: Request): boolean {
  return authorizeGraphWorkerBearerRequest(request);
}

export function createGraphTokenProvider(options: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}): () => Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  return async () => {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    try {
      const body = new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      });
      const response = await fetchImpl(
        `https://login.microsoftonline.com/${encodeURIComponent(options.tenantId)}/oauth2/v2.0/token`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: controller.signal },
      );
      if (!response.ok) throw new Error('Graph token request failed');
      const value = await response.json() as Record<string, unknown>;
      if (typeof value.access_token !== 'string' || value.access_token.length < 16 ||
          typeof value.expires_in !== 'number' || value.expires_in < 60) {
        throw new Error('Graph token response is invalid');
      }
      cached = { token: value.access_token, expiresAt: now() + Math.min(86_400, value.expires_in) * 1_000 };
      return cached.token;
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function sendAlert(event: { code: string; reservationHash: string; evidenceHash: string }): Promise<void> {
  const endpoint = required('NOTIFICATION_WEBHOOK_URL', 12);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'graph_outbox', severity: 'critical', ...event }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Graph alert delivery failed');
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeConfiguredTransactionalGraphJob(input: unknown) {
  const tenantId = required('GRAPH_TENANT_ID');
  const clientId = required('GRAPH_CLIENT_ID');
  const clientSecret = required('GRAPH_CLIENT_SECRET', 16);
  const mailboxUserId = required('GRAPH_MAILBOX_USER_ID');
  const capabilitySecret = required('GRAPH_OUTBOX_CAPABILITY_SECRET', 32);
  const timeoutMs = boundedInteger('GRAPH_REQUEST_TIMEOUT_MS', 10_000, 250, 60_000);
  const client = new SecureMicrosoftGraphClient({
    mailboxUserId,
    accessToken: createGraphTokenProvider({ tenantId, clientId, clientSecret, timeoutMs }),
    requestTimeoutMs: timeoutMs,
    readMaxAttempts: boundedInteger('GRAPH_READ_MAX_ATTEMPTS', 4, 1, 8),
    maxRetryDelayMs: boundedInteger('GRAPH_MAX_RETRY_DELAY_MS', 30_000, 0, 900_000),
  });
  return executeTransactionalGraphJob(input, {
    repository: new GraphOutboxRepository(),
    client,
    buildPackage: buildTransactionalDeliveryPackage,
    enabled: () => isOutboundCapabilityEnabled('TRANSACTIONAL_OUTLOOK_ENABLED'),
    capabilitySecret,
    markerPollAttempts: boundedInteger('GRAPH_MARKER_POLL_ATTEMPTS', 4, 1, 10),
    sentPollAttempts: boundedInteger('GRAPH_SENT_POLL_ATTEMPTS', 10, 1, 30),
    pollIntervalMs: boundedInteger('GRAPH_POLL_INTERVAL_MS', 2_000, 0, 60_000),
    alert: sendAlert,
  });
}

export async function executeConfiguredGraphDispatchOnce() {
  const enabled = () => isOutboundCapabilityEnabled('TRANSACTIONAL_OUTLOOK_ENABLED');
  if (!enabled()) {
    return { state: 'off' as const, reasonCode: 'master_or_lane_disabled', dispatchId: null, reservationId: null };
  }
  const tenantId = required('GRAPH_TENANT_ID');
  const clientId = required('GRAPH_CLIENT_ID');
  const clientSecret = required('GRAPH_CLIENT_SECRET', 16);
  const mailboxUserId = required('GRAPH_MAILBOX_USER_ID');
  const capabilitySecret = required('GRAPH_OUTBOX_CAPABILITY_SECRET', 32);
  const workerId = required('GRAPH_DISPATCH_WORKER_ID');
  const mailboxKeyHash = required('MAILBOX_IDENTITY_HASH', 64);
  const timeoutMs = boundedInteger('GRAPH_REQUEST_TIMEOUT_MS', 10_000, 250, 60_000);
  const client = new SecureMicrosoftGraphClient({
    mailboxUserId,
    accessToken: createGraphTokenProvider({ tenantId, clientId, clientSecret, timeoutMs }),
    requestTimeoutMs: timeoutMs,
    readMaxAttempts: boundedInteger('GRAPH_READ_MAX_ATTEMPTS', 4, 1, 8),
    maxRetryDelayMs: boundedInteger('GRAPH_MAX_RETRY_DELAY_MS', 30_000, 0, 900_000),
  });
  const repository = new GraphOutboxRepository();
  return executeGraphDispatchOnce({
    repository,
    enabled,
    workerId,
    mailboxKeyHash,
    capabilitySecret,
    buildPackageBySubmission: buildTransactionalDeliveryPackageBySubmission,
    executeReserved: (job, deliveryPackage) => executeTransactionalGraphJob(job, {
      repository,
      client,
      buildPackage: async () => deliveryPackage,
      enabled,
      capabilitySecret,
      markerPollAttempts: boundedInteger('GRAPH_MARKER_POLL_ATTEMPTS', 4, 1, 10),
      sentPollAttempts: boundedInteger('GRAPH_SENT_POLL_ATTEMPTS', 10, 1, 30),
      pollIntervalMs: boundedInteger('GRAPH_POLL_INTERVAL_MS', 2_000, 0, 60_000),
      alert: sendAlert,
    }),
  });
}

export async function executeConfiguredColdCampaignTick() {
  const enabled = () => isOutboundCapabilityEnabled('COLD_CAMPAIGN_ENABLED');
  if (!enabled()) return { state: 'off' as const, reasonCode: 'master_or_lane_disabled', dispatchId: null, reservationId: null };
  const tenantId = required('GRAPH_TENANT_ID');
  const clientId = required('GRAPH_CLIENT_ID');
  const clientSecret = required('GRAPH_CLIENT_SECRET', 16);
  const mailboxUserId = required('GRAPH_MAILBOX_USER_ID');
  const capabilitySecret = required('GRAPH_OUTBOX_CAPABILITY_SECRET', 32);
  const workerId = required('COLD_CAMPAIGN_WORKER_ID');
  const workerSecret = required('GRAPH_WORKER_SECRET', 32);
  const mailboxKeyHash = required('MAILBOX_IDENTITY_HASH', 64);
  const workerToken = createHmac('sha256', workerSecret).update(`cold-worker-v1\0${workerId}`, 'utf8').digest('base64url');
  const timeoutMs = boundedInteger('GRAPH_REQUEST_TIMEOUT_MS', 10_000, 250, 60_000);
  const client = new SecureMicrosoftGraphClient({
    mailboxUserId,
    accessToken: createGraphTokenProvider({ tenantId, clientId, clientSecret, timeoutMs }),
    requestTimeoutMs: timeoutMs,
    readMaxAttempts: boundedInteger('GRAPH_READ_MAX_ATTEMPTS', 4, 1, 8),
    maxRetryDelayMs: boundedInteger('GRAPH_MAX_RETRY_DELAY_MS', 30_000, 0, 900_000),
  });
  const repository = new GraphOutboxRepository();
  return executeColdCampaignTick({
    rpc: callRpc, enabled, workerId, workerToken, mailboxKeyHash, capabilitySecret,
    executeGraph: (job, deliveryPackage) => executeTransactionalGraphJob(job, {
      repository, client, buildPackage: async () => deliveryPackage, enabled, capabilitySecret,
      markerPollAttempts: boundedInteger('GRAPH_MARKER_POLL_ATTEMPTS', 4, 1, 10),
      sentPollAttempts: boundedInteger('GRAPH_SENT_POLL_ATTEMPTS', 10, 1, 30),
      pollIntervalMs: boundedInteger('GRAPH_POLL_INTERVAL_MS', 2_000, 0, 60_000),
      alert: sendAlert,
    }),
  });
}
