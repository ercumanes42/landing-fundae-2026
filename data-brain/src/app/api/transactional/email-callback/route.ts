import { NextResponse } from 'next/server';

import { finalizeTransactionalMailbox } from '@/lib/mailbox-throttle';
import { corsHeaders, limitRequest } from '@/lib/security';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 2_048;
const OUTLOOK_UNCONFIRMED = 'OUTLOOK_RESULT_UNCONFIRMED';

export function validatePublicOutlookCallback(input: unknown): {
  finalize_capability: string;
  state: 'reconcile_required';
  failure_code: typeof OUTLOOK_UNCONFIRMED;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('callback payload is invalid');
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set(['finalize_capability', 'state', 'failure_code']);
  if (Object.keys(value).length !== allowed.size || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error('callback payload is invalid');
  }
  if (
    typeof value.finalize_capability !== 'string' ||
    value.state !== 'reconcile_required' ||
    value.failure_code !== OUTLOOK_UNCONFIRMED
  ) {
    throw new Error('callback payload is invalid');
  }
  return value as {
    finalize_capability: string;
    state: 'reconcile_required';
    failure_code: typeof OUTLOOK_UNCONFIRMED;
  };
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'no-store' };
  const rate = await limitRequest(request, 'transactional-email-callback', 300, 60_000, 'fail-closed');
  if (!rate.allowed) {
    return NextResponse.json(
      { accepted: false, reason_code: rate.reason === 'unavailable' ? 'callback_unavailable' : 'rate_limited' },
      { status: rate.reason === 'unavailable' ? 503 : 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ accepted: false, reason_code: 'invalid_request' }, { status: 413, headers });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') < 2 || Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ accepted: false, reason_code: 'invalid_request' }, { status: 413, headers });
  }

  try {
    const result = await finalizeTransactionalMailbox(
      validatePublicOutlookCallback(JSON.parse(rawBody)),
    );
    return NextResponse.json({
      accepted: result.accepted,
      duplicate: result.duplicate,
      reason_code: result.reasonCode,
      reservation_id: result.reservationId,
      next_allowed_at: result.nextAllowedAt,
      mailbox_halted: result.mailboxHalted,
    }, { headers });
  } catch (error) {
    const invalidRequest = error instanceof SyntaxError ||
      (error instanceof Error && /invalid|required|not allowed/i.test(error.message));
    return NextResponse.json(
      { accepted: false, reason_code: invalidRequest ? 'invalid_request' : 'callback_unavailable' },
      { status: invalidRequest ? 400 : 503, headers },
    );
  }
}
