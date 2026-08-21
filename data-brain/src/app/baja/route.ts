import { NextResponse } from 'next/server';

import { limitRequest } from '@/lib/security';
import { consumeUnsubscribeToken, isUnsubscribeToken } from '@/lib/unsubscribe';
import {
  renderUnsubscribeCompleted,
  renderUnsubscribeConfirmation,
  renderUnsubscribeRetry,
  unsubscribeSecurityHeaders,
} from '@/lib/unsubscribe-page';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 4_096;

function html(body: string, status = 200, extraHeaders?: Record<string, string>): NextResponse {
  return new NextResponse(body, {
    status,
    headers: unsubscribeSecurityHeaders(extraHeaders),
  });
}

export async function GET(request: Request) {
  const rate = await limitRequest(request, 'unsubscribe-confirm', 120, 15 * 60_000, 'fail-open');
  if (!rate.allowed) {
    return html(renderUnsubscribeRetry(), 429, { 'Retry-After': String(rate.retryAfterSeconds) });
  }
  const token = new URL(request.url).searchParams.get('token') ?? '';
  return html(renderUnsubscribeConfirmation(token));
}

export async function POST(request: Request) {
  const rate = await limitRequest(request, 'unsubscribe-submit', 30, 15 * 60_000, 'fail-open');
  if (!rate.allowed) {
    return html(renderUnsubscribeRetry(), 429, { 'Retry-After': String(rate.retryAfterSeconds) });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return html(renderUnsubscribeCompleted());
  }

  const urlToken = new URL(request.url).searchParams.get('token') ?? '';
  let bodyToken = '';
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') <= MAX_BODY_BYTES) {
      bodyToken = new URLSearchParams(rawBody).get('token') ?? '';
    }
  } catch {
    return html(renderUnsubscribeCompleted());
  }

  const token = isUnsubscribeToken(urlToken) ? urlToken : bodyToken;
  if (!isUnsubscribeToken(token)) {
    // Deliberately indistinguishable from a valid or repeated request.
    return html(renderUnsubscribeCompleted());
  }

  try {
    await consumeUnsubscribeToken(token);
    // Deliberately ignore accepted/duplicate to prevent token enumeration.
    return html(renderUnsubscribeCompleted());
  } catch {
    return html(renderUnsubscribeRetry(), 503, { 'Retry-After': '120' });
  }
}
