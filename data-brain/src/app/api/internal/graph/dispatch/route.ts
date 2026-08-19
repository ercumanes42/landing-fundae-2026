import { NextResponse } from 'next/server';

import {
  authorizeGraphInternalRequest,
  executeConfiguredGraphDispatchOnce,
} from '@/lib/graph-runtime';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
  if (!authorizeGraphInternalRequest(request)) {
    return NextResponse.json({ accepted: false, reason_code: 'unauthorized' }, { status: 401, headers });
  }
  if ((request.headers.get('content-length') ?? '0') !== '0') {
    return NextResponse.json({ accepted: false, reason_code: 'invalid_request' }, { status: 400, headers });
  }
  try {
    const result = await executeConfiguredGraphDispatchOnce();
    const status = result.state === 'ambiguous_halted' ? 503
      : result.state === 'off' || result.state === 'deferred' ? 409
        : 200;
    return NextResponse.json({
      accepted: result.state === 'confirmed_sent' || result.state === 'empty',
      state: result.state,
      reason_code: result.reasonCode,
      dispatch_id: result.dispatchId,
      reservation_id: result.reservationId,
      alert_attempted: result.alertAttempted ?? false,
      alert_delivered: result.alertDelivered ?? null,
    }, { status, headers });
  } catch {
    return NextResponse.json(
      { accepted: false, reason_code: 'graph_dispatch_unavailable' },
      { status: 503, headers },
    );
  }
}
