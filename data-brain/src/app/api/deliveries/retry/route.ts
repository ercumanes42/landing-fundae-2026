import { NextResponse } from 'next/server';
import { basicAuthHeaders, isBasicAuthValid } from '@/lib/auth';
import { assertEnv, isOutboundCapabilityEnabled } from '@/lib/env';
import { LegacyDeliveryDisabledError, retryDueDeliveries } from '@/lib/delivery';
import { selectRows, updateById } from '@/lib/supabase';

export const runtime = 'nodejs';

const RETRY_CONFIRMATION = 'RETRY_LEGACY_DELIVERIES';
const DEAD_LETTER_CONFIRMATION = 'REQUEUE_LEGACY_DEAD_LETTERS';

function legacyRetryEnabled(): boolean {
  return (
    isOutboundCapabilityEnabled('LEGACY_MAKE_DELIVERY_ENABLED') &&
    isOutboundCapabilityEnabled('LEGACY_DELIVERY_RETRY_ENABLED')
  );
}

export async function POST(request: Request) {
  try {
    assertEnv();

    if (!(await isBasicAuthValid(request))) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: basicAuthHeaders() },
      );
    }

    if (!legacyRetryEnabled()) {
      return NextResponse.json(
        { ok: false, error: 'Legacy delivery retry is disabled', code: 'LEGACY_DELIVERY_RETRY_DISABLED' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || body.confirmation !== RETRY_CONFIRMATION) {
      return NextResponse.json(
        { ok: false, error: 'Explicit legacy retry confirmation is required' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (body.retryDead) {
      if (body.deadLetterConfirmation !== DEAD_LETTER_CONFIRMATION) {
        return NextResponse.json(
          { ok: false, error: 'Explicit dead-letter replay confirmation is required' },
          { status: 400, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      const deadLetters = await selectRows<{ id: string }>('delivery_queue', 'status=eq.dead_letter');
      for (const row of deadLetters) {
        await updateById('delivery_queue', row.id, {
          status: 'queued',
          attempt_count: 0,
          next_attempt_at: new Date().toISOString(),
        });
      }
    }

    const result = await retryDueDeliveries();
    return NextResponse.json(
      { ok: true, handoff: 'make_accepted_only', ...result },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof LegacyDeliveryDisabledError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown retry error' },
      { status: 500 },
    );
  }
}
