import { env, isOutboundCapabilityEnabled } from './env';
import { insertRow, selectRows, updateById } from './supabase';
import type { LeadPayload } from './types';
import { createMakeSignature } from './security';

const RETRY_DELAYS_SECONDS = [0, 60, 300, 900, 3600, 21600];

export class LegacyDeliveryDisabledError extends Error {
  readonly code: 'LEGACY_MAKE_DELIVERY_DISABLED' | 'LEGACY_DELIVERY_RETRY_DISABLED';

  constructor(code: LegacyDeliveryDisabledError['code']) {
    super(code === 'LEGACY_MAKE_DELIVERY_DISABLED'
      ? 'Legacy Make delivery is disabled'
      : 'Legacy delivery retries are disabled');
    this.name = 'LegacyDeliveryDisabledError';
    this.code = code;
  }
}

interface DeliveryRow {
  id: string;
  lead_id: string;
  submission_id: string;
  target: 'make';
  payload: LeadPayload;
  status: 'queued' | 'retrying' | 'delivered' | 'dead_letter';
  attempt_count: number;
  next_attempt_at: string;
  last_error?: string;
  accepted_by_make_at?: string;
}

function secondsFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function nextStatus(attemptCount: number): {
  status: DeliveryRow['status'];
  next_attempt_at: string | null;
} {
  if (attemptCount >= RETRY_DELAYS_SECONDS.length) {
    return { status: 'dead_letter', next_attempt_at: null };
  }

  return {
    status: 'retrying',
    next_attempt_at: secondsFromNow(RETRY_DELAYS_SECONDS[attemptCount]),
  };
}

function assertLegacyMakeDeliveryEnabled(): void {
  if (!isOutboundCapabilityEnabled('LEGACY_MAKE_DELIVERY_ENABLED')) {
    throw new LegacyDeliveryDisabledError('LEGACY_MAKE_DELIVERY_DISABLED');
  }
}

function assertLegacyRetryEnabled(): void {
  assertLegacyMakeDeliveryEnabled();
  if (!isOutboundCapabilityEnabled('LEGACY_DELIVERY_RETRY_ENABLED')) {
    throw new LegacyDeliveryDisabledError('LEGACY_DELIVERY_RETRY_DISABLED');
  }
}

async function sendToMake(payload: LeadPayload): Promise<void> {
  assertLegacyMakeDeliveryEnabled();
  const url = env('MAKE_WEBHOOK_URL');
  if (!url) throw new Error('MAKE_WEBHOOK_URL is not configured');

  const secret = env('MAKE_WEBHOOK_SECRET');
  if (!secret) throw new Error('MAKE_WEBHOOK_SECRET is not configured');
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createMakeSignature(body, timestamp, secret);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Make-Signature': signature,
      'X-Make-Timestamp': timestamp,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Make webhook failed with status ${response.status}`);
  }
}

export async function enqueueAndAttemptDelivery(
  payload: LeadPayload,
): Promise<DeliveryRow> {
  assertLegacyMakeDeliveryEnabled();
  if (!payload.lead_id) {
    throw new Error('Cannot enqueue delivery without lead_id');
  }

  const existing = await selectRows<DeliveryRow>(
    'delivery_queue',
    `select=*&submission_id=eq.${encodeURIComponent(payload.submission_id)}&target=eq.make&limit=1`,
  );
  if (existing[0]) {
    if (existing[0].status === 'queued' || existing[0].status === 'retrying') {
      return attemptDelivery(existing[0]);
    }
    return existing[0];
  }

  const row = await insertRow<DeliveryRow>('delivery_queue', {
    submission_id: payload.submission_id,
    lead_id: payload.lead_id,
    target: 'make',
    payload,
    status: 'queued',
    attempt_count: 0,
    next_attempt_at: new Date().toISOString(),
  });

  return attemptDelivery(row);
}

export async function attemptDelivery(row: DeliveryRow): Promise<DeliveryRow> {
  assertLegacyMakeDeliveryEnabled();
  const attemptCount = row.attempt_count + 1;

  try {
    await sendToMake(row.payload);
    const acceptedAt = new Date().toISOString();
    const updated = await updateById<DeliveryRow>('delivery_queue', row.id, {
      status: 'delivered',
      attempt_count: attemptCount,
      delivered_at: acceptedAt,
      accepted_by_make_at: acceptedAt,
      last_error: null,
    });
    return updated ?? { ...row, status: 'delivered', attempt_count: attemptCount, accepted_by_make_at: acceptedAt };
  } catch (error) {
    const next = nextStatus(attemptCount);
    const updated = await updateById<DeliveryRow>('delivery_queue', row.id, {
      status: next.status,
      attempt_count: attemptCount,
      next_attempt_at: next.next_attempt_at,
      last_error: error instanceof Error ? error.message : 'Unknown delivery error',
    });

    return (
      updated ?? {
        ...row,
        status: next.status,
        attempt_count: attemptCount,
        next_attempt_at: next.next_attempt_at ?? row.next_attempt_at,
      }
    );
  }
}

export async function retryDueDeliveries(): Promise<{
  processed: number;
  delivered: number;
  dead_letter: number;
}> {
  assertLegacyRetryEnabled();
  const due = await selectRows<DeliveryRow>(
    'delivery_queue',
    `status=in.(queued,retrying)&next_attempt_at=lte.${encodeURIComponent(
      new Date().toISOString(),
    )}&order=next_attempt_at.asc&limit=50`,
  );

  let delivered = 0;
  let deadLetter = 0;

  for (const row of due) {
    const result = await attemptDelivery(row);
    if (result.status === 'delivered') delivered += 1;
    if (result.status === 'dead_letter') deadLetter += 1;
  }

  return {
    processed: due.length,
    delivered,
    dead_letter: deadLetter,
  };
}
