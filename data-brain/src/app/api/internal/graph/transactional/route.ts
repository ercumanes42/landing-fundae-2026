import { NextResponse } from 'next/server';

import {
  authorizeGraphInternalRequest,
  executeConfiguredTransactionalGraphJob,
} from '@/lib/graph-runtime';

export const runtime = 'nodejs';
const MAX_BODY_BYTES = 4_096;

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
  if (!authorizeGraphInternalRequest(request)) {
    return NextResponse.json({ accepted: false, reason_code: 'unauthorized' }, { status: 401, headers });
  }
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ accepted: false, reason_code: 'invalid_request' }, { status: 413, headers });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') < 2 || Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ accepted: false, reason_code: 'invalid_request' }, { status: 413, headers });
  }
  try {
    const result = await executeConfiguredTransactionalGraphJob(JSON.parse(raw));
    const status = result.state === 'off' || result.state === 'deferred' ? 409
      : result.state === 'ambiguous_halted' ? 503
        : 200;
    return NextResponse.json({
      accepted: result.state === 'confirmed_sent',
      state: result.state,
      reason_code: result.reasonCode,
      reservation_id: result.reservationId,
      duplicate: result.duplicate,
      alert_attempted: result.alertAttempted,
    }, { status, headers });
  } catch (error) {
    const invalid = error instanceof SyntaxError ||
      (error instanceof Error && /invalid|not allowed/i.test(error.message));
    return NextResponse.json(
      { accepted: false, reason_code: invalid ? 'invalid_request' : 'graph_worker_unavailable' },
      { status: invalid ? 400 : 503, headers },
    );
  }
}
