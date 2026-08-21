import { NextResponse } from 'next/server';

import { corsHeaders, limitRequest } from '@/lib/security';
import { prepareTransactionalDryRun } from '@/lib/transactional-prepare';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 1_024;

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'private, no-store, max-age=0' };
  const rate = await limitRequest(request, 'transactional-prepare', 120, 60_000, 'fail-closed');
  if (!rate.allowed) {
    return NextResponse.json(
      { prepared: false, reason_code: rate.reason === 'unavailable' ? 'prepare_unavailable' : 'rate_limited' },
      {
        status: rate.reason === 'unavailable' ? 503 : 429,
        headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) },
      },
    );
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ prepared: false, reason_code: 'invalid_request' }, { status: 413, headers });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') < 2 || Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ prepared: false, reason_code: 'invalid_request' }, { status: 413, headers });
  }

  try {
    const result = await prepareTransactionalDryRun(JSON.parse(rawBody));
    if (!result.prepared) {
      return NextResponse.json(
        { prepared: false, reason_code: result.reasonCode },
        { status: 403, headers },
      );
    }
    return NextResponse.json({
      prepared: true,
      reason_code: result.reasonCode,
      mode: result.mode,
      resource: result.resource,
      payload_sha256: result.payloadSha256,
      artifact_type: result.artifactType,
      template_id: result.templateId,
    }, { headers });
  } catch (error) {
    const invalidRequest = error instanceof SyntaxError ||
      (error instanceof Error && /invalid|not allowed/i.test(error.message));
    return NextResponse.json(
      { prepared: false, reason_code: invalidRequest ? 'invalid_request' : 'prepare_unavailable' },
      { status: invalidRequest ? 400 : 503, headers },
    );
  }
}
