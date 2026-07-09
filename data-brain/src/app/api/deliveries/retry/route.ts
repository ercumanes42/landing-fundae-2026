import { NextResponse } from 'next/server';
import { basicAuthHeaders, isBasicAuthValid } from '@/lib/auth';
import { assertEnv } from '@/lib/env';
import { retryDueDeliveries } from '@/lib/delivery';
import { selectRows, updateById } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertEnv();

    if (!isBasicAuthValid(request)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: basicAuthHeaders() },
      );
    }

    const body = await request.json().catch(() => ({}));
    if (body.retryDead) {
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
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown retry error' },
      { status: 500 },
    );
  }
}
