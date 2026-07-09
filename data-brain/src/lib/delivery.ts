import { env } from './env';
import { insertRow, selectRows, updateById } from './supabase';
import type { LeadPayload } from './types';

const RETRY_DELAYS_SECONDS = [0, 60, 300, 900, 3600, 21600];

interface DeliveryRow {
  id: string;
  lead_id: string;
  target: 'make';
  payload: LeadPayload;
  status: 'queued' | 'retrying' | 'delivered' | 'dead_letter';
  attempt_count: number;
  next_attempt_at: string;
  last_error?: string;
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

async function sendToMake(payload: LeadPayload): Promise<void> {
  const url = env('MAKE_WEBHOOK_URL');
  if (!url) return;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Make webhook failed with status ${response.status}`);
  }
}

export async function enqueueAndAttemptDelivery(
  payload: LeadPayload,
): Promise<DeliveryRow> {
  if (!payload.lead_id) {
    throw new Error('Cannot enqueue delivery without lead_id');
  }

  const row = await insertRow<DeliveryRow>('delivery_queue', {
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
  const attemptCount = row.attempt_count + 1;

  try {
    await sendToMake(row.payload);
    const updated = await updateById<DeliveryRow>('delivery_queue', row.id, {
      status: 'delivered',
      attempt_count: attemptCount,
      delivered_at: new Date().toISOString(),
      last_error: null,
    });
    return updated ?? { ...row, status: 'delivered', attempt_count: attemptCount };
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
