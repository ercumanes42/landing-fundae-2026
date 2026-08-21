import { NextResponse } from 'next/server';

import { reserveTransactionalMailbox } from '@/lib/mailbox-throttle';
import { corsHeaders, limitRequest } from '@/lib/security';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 1_024;

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'no-store' };
  const rate = await limitRequest(request, 'transactional-mailbox-reserve', 120, 60_000, 'fail-closed');
  if (!rate.allowed) {
    return NextResponse.json(
      { authorized_to_send: false, reason_code: rate.reason === 'unavailable' ? 'gate_unavailable' : 'rate_limited' },
      { status: rate.reason === 'unavailable' ? 503 : 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ authorized_to_send: false, reason_code: 'invalid_request' }, { status: 413, headers });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') < 2 || Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ authorized_to_send: false, reason_code: 'invalid_request' }, { status: 413, headers });
  }

  try {
    const result = await reserveTransactionalMailbox(JSON.parse(rawBody));
    return NextResponse.json({
      authorized_to_send: result.authorizedToSend,
      reason_code: result.reasonCode,
      reservation_id: result.reservationId,
      finalize_capability: result.finalizeCapability,
      lease_expires_at: result.leaseExpiresAt,
      next_allowed_at: result.nextAllowedAt,
      batch_position: result.batchPosition,
      retry_after_seconds: result.retryAfterSeconds,
    }, { headers });
  } catch (error) {
    const invalidRequest = error instanceof SyntaxError ||
      (error instanceof Error && /invalid|not allowed/i.test(error.message));
    return NextResponse.json(
      { authorized_to_send: false, reason_code: invalidRequest ? 'invalid_request' : 'gate_unavailable' },
      { status: invalidRequest ? 400 : 503, headers },
    );
  }
}
