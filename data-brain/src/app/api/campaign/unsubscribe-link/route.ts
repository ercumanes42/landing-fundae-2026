import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { corsHeaders, limitRequest, verifyMakeSignature } from '@/lib/security';
import { issueUnsubscribeLink } from '@/lib/unsubscribe';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 4_096;

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'no-store' };
  const rate = await limitRequest(request, 'unsubscribe-link-issue', 120, 60_000, 'fail-closed');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: rate.reason === 'unavailable' ? 503 : 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers });
  }

  if (!verifyMakeSignature(
    rawBody,
    request.headers.get('x-make-signature'),
    request.headers.get('x-make-timestamp'),
    env('MAKE_WEBHOOK_SECRET'),
  )) {
    return NextResponse.json({ error: 'Invalid Make signature' }, { status: 401, headers });
  }

  try {
    const result = await issueUnsubscribeLink(JSON.parse(rawBody), request.url);
    return NextResponse.json({ ok: true, unsubscribe_url: result.url, expires_at: result.expiresAt }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unsubscribe link could not be issued' },
      { status: 400, headers },
    );
  }
}
