import { NextResponse } from 'next/server';
import { env, isInboundCapabilityEnabled } from '@/lib/env';
import { parseCalendlyInviteeCreated, processCalendlyInviteeCreated, SupabaseInboundRepository, verifyCalendlySignature } from '@/lib/inbound-reliability';
import { limitRequest } from '@/lib/security';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
  if (!isInboundCapabilityEnabled('CALENDLY_WEBHOOK_ENABLED')) return NextResponse.json({ accepted: false, reason_code: 'off' }, { status: 409, headers });
  const rate = await limitRequest(request, 'calendly-webhook', 120, 60_000, 'fail-closed');
  if (!rate.allowed) return NextResponse.json({ accepted: false, reason_code: rate.reason }, { status: rate.reason === 'unavailable' ? 503 : 429, headers });
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > 64 * 1_024) return NextResponse.json({ accepted: false, reason_code: 'payload_too_large' }, { status: 413, headers });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 64 * 1_024) return NextResponse.json({ accepted: false, reason_code: 'payload_too_large' }, { status: 413, headers });
  if (!verifyCalendlySignature(rawBody, request.headers.get('calendly-webhook-signature'), env('CALENDLY_WEBHOOK_SIGNING_KEY'))) {
    return NextResponse.json({ accepted: false, reason_code: 'invalid_signature' }, { status: 401, headers });
  }
  let input: ReturnType<typeof parseCalendlyInviteeCreated>;
  try {
    input = parseCalendlyInviteeCreated(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ accepted: false, reason_code: 'invalid_payload' }, { status: 400, headers });
  }
  try {
    const result = await processCalendlyInviteeCreated(input, new SupabaseInboundRepository());
    if (result.reason === 'busy') {
      return NextResponse.json(
        { accepted: false, ...result },
        { status: 503, headers: { ...headers, 'Retry-After': '5' } },
      );
    }
    return NextResponse.json({ accepted: true, ...result }, { headers });
  } catch {
    return NextResponse.json({ accepted: false, reason_code: 'calendly_ingest_unavailable' }, { status: 503, headers });
  }
}
