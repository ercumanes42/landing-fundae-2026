import { NextResponse } from 'next/server';

import { authorizeCampaignDelivery } from '@/lib/delivery-authorization';
import { env } from '@/lib/env';
import { corsHeaders, limitRequest, verifyMakeSignature } from '@/lib/security';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 4_096;

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'no-store' };
  const rate = await limitRequest(request, 'delivery-authorization', 300, 60_000, 'fail-closed');
  if (!rate.allowed) {
    return NextResponse.json(
      { authorized: false, reason_code: rate.reason === 'unavailable' ? 'authorization_unavailable' : 'rate_limited' },
      { status: rate.reason === 'unavailable' ? 503 : 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ authorized: false, reason_code: 'invalid_request' }, { status: 413, headers });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ authorized: false, reason_code: 'invalid_request' }, { status: 413, headers });
  }
  if (!verifyMakeSignature(
    rawBody,
    request.headers.get('x-make-signature'),
    request.headers.get('x-make-timestamp'),
    env('MAKE_WEBHOOK_SECRET'),
  )) {
    return NextResponse.json({ authorized: false, reason_code: 'invalid_signature' }, { status: 401, headers });
  }

  try {
    const result = await authorizeCampaignDelivery(JSON.parse(rawBody));
    return NextResponse.json({
      authorized: result.authorized,
      reason_code: result.reasonCode,
      lock_expires_at: result.lockExpiresAt,
    }, { headers });
  } catch (error) {
    const invalidRequest = error instanceof SyntaxError ||
      (error instanceof Error && /invalid|not allowed|must be an object/i.test(error.message));
    return NextResponse.json(
      { authorized: false, reason_code: invalidRequest ? 'invalid_request' : 'authorization_unavailable' },
      { status: invalidRequest ? 400 : 503, headers },
    );
  }
}
