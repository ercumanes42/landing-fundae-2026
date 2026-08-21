import { NextResponse } from 'next/server';
import { recordCanonicalTrackingEvent } from '@/lib/campaign-tracking';
import { assertEnv, env } from '@/lib/env';
import { corsHeaders, limitRequest, verifyMakeSignature } from '@/lib/security';
import type { CanonicalTrackingInput } from '@/lib/tracking-contract';

export const runtime = 'nodejs';

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  const rate = await limitRequest(request, 'campaign-tracking', 300, 60_000, 'fail-closed');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: rate.reason === 'unavailable' ? 503 : 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const rawBody = await request.text();
  if (!verifyMakeSignature(
    rawBody,
    request.headers.get('x-make-signature'),
    request.headers.get('x-make-timestamp'),
    env('MAKE_WEBHOOK_SECRET'),
  )) {
    return NextResponse.json({ error: 'Invalid Make signature' }, { status: 401, headers });
  }

  try {
    assertEnv();
    const result = await recordCanonicalTrackingEvent(JSON.parse(rawBody) as CanonicalTrackingInput);
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Campaign tracking event rejected' },
      { status: 400, headers },
    );
  }
}
