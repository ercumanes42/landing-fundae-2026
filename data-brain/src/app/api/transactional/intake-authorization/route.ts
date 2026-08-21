import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { corsHeaders, verifyMakeSignature } from '@/lib/security';
import { authorizeTransactionalIntake } from '@/lib/transactional-intake';
import { TransactionalResourceConfigurationError } from '@/lib/transactional-resources';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 65_536;

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'no-store' };
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { authorized: false, reason_code: 'invalid_request' },
      { status: 413, headers },
    );
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') < 2 || Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json(
      { authorized: false, reason_code: 'invalid_request' },
      { status: 413, headers },
    );
  }
  if (!verifyMakeSignature(
    rawBody,
    request.headers.get('x-make-signature'),
    request.headers.get('x-make-timestamp'),
    env('MAKE_WEBHOOK_SECRET'),
  )) {
    return NextResponse.json(
      { authorized: false, reason_code: 'invalid_signature' },
      { status: 401, headers },
    );
  }

  try {
    const result = await authorizeTransactionalIntake(rawBody);
    return NextResponse.json({
      authorized: result.authorized,
      reason_code: result.reasonCode,
      duplicate: result.duplicate,
      claimed_at: result.claimedAt,
      payload_sha256: result.payload_sha256,
      claims: result.claims,
      intake_capability: result.intake_capability,
    }, { headers });
  } catch (error) {
    if (error instanceof TransactionalResourceConfigurationError) {
      return NextResponse.json(
        { authorized: false, reason_code: 'resource_unavailable' },
        { status: 503, headers },
      );
    }
    const invalidRequest = error instanceof SyntaxError ||
      (error instanceof Error && /invalid|required|not allowed|must match|not found|does not match/i.test(error.message));
    return NextResponse.json(
      { authorized: false, reason_code: invalidRequest ? 'invalid_request' : 'authorization_unavailable' },
      { status: invalidRequest ? 400 : 503, headers },
    );
  }
}
