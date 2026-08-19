import { NextResponse } from 'next/server';
import { assertEnv } from '@/lib/env';
import {
  JourneyBodyTooLargeError,
  JourneyInvalidJsonError,
  readJourneyJson,
  recordJourneyEvent,
} from '@/lib/journey-ingest';
import { canonicalizeJourneyEventInput } from '@/lib/tracking-contract';
import { corsHeaders, isAllowedLandingOrigin, limitRequest } from '@/lib/security';

export const runtime = 'nodejs';

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  if (!isAllowedLandingOrigin(request)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403, headers });
  }
  const rate = await limitRequest(request, 'event-ingest', 120, 60_000, 'fail-closed');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: rate.reason === 'unavailable' ? 503 : 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  try {
    assertEnv();
    const raw = await readJourneyJson(request, 32 * 1_024);
    let payload;
    try {
      payload = canonicalizeJourneyEventInput(raw);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid journey event' },
        { status: 400, headers },
      );
    }
    const result = await recordJourneyEvent(payload);
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch (error) {
    if (error instanceof JourneyBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413, headers });
    }
    if (error instanceof JourneyInvalidJsonError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers });
    }
    if (error instanceof Error && error.message === 'event_id collision') {
      return NextResponse.json({ error: error.message }, { status: 409, headers });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown event ingest error' },
      { status: 500, headers },
    );
  }
}
