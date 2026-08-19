import { NextResponse } from 'next/server';

import { corsHeaders, limitRequest } from '@/lib/security';
import {
  buildTransactionalDeliveryPackage,
  TransactionalDeliveryPackageContentError,
} from '@/lib/transactional-delivery-package';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 1_024;

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'private, no-store, max-age=0' };
  const rate = await limitRequest(request, 'transactional-delivery-package', 120, 60_000, 'fail-closed');
  if (!rate.allowed) {
    return NextResponse.json(
      { packaged: false, reason_code: rate.reason === 'unavailable' ? 'package_unavailable' : 'rate_limited' },
      {
        status: rate.reason === 'unavailable' ? 503 : 429,
        headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) },
      },
    );
  }
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ packaged: false, reason_code: 'invalid_request' }, { status: 413, headers });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') < 2 || Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ packaged: false, reason_code: 'invalid_request' }, { status: 413, headers });
  }
  try {
    const result = await buildTransactionalDeliveryPackage(JSON.parse(rawBody));
    if (!result.packaged) {
      return NextResponse.json(
        { packaged: false, reason_code: result.reasonCode },
        { status: 403, headers },
      );
    }
    return NextResponse.json({
      packaged: true,
      reason_code: result.reasonCode,
      resource: result.resource,
      template_id: result.templateId,
      recipient: result.recipient,
      subject: result.subject,
      body: result.body,
      content_type: result.contentType,
      attachments: result.attachments,
      package_hmac_sha256: result.packageHmacSha256,
    }, { headers });
  } catch (error) {
    if (error instanceof TransactionalDeliveryPackageContentError) {
      return NextResponse.json(
        { packaged: false, reason_code: 'package_not_ready' },
        { status: 422, headers },
      );
    }
    const invalidRequest = error instanceof SyntaxError ||
      (error instanceof Error && /invalid|not allowed/i.test(error.message));
    return NextResponse.json(
      { packaged: false, reason_code: invalidRequest ? 'invalid_request' : 'package_unavailable' },
      { status: invalidRequest ? 400 : 503, headers },
    );
  }
}
