import { NextResponse } from 'next/server';
import { authorizeGraphInternalRequest } from '@/lib/graph-runtime';
import { executeConfiguredInboundMailboxTick } from '@/lib/inbound-runtime';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
  if (!authorizeGraphInternalRequest(request)) return NextResponse.json({ accepted: false, reason_code: 'unauthorized' }, { status: 401, headers });
  if ((request.headers.get('content-length') ?? '0') !== '0') return NextResponse.json({ accepted: false, reason_code: 'invalid_request' }, { status: 400, headers });
  try {
    const result = await executeConfiguredInboundMailboxTick();
    const status = result.state === 'off' ? 409 : result.state === 'deferred' ? 503 : 200;
    return NextResponse.json({ accepted: status === 200, ...result }, {
      status,
      headers: result.state === 'deferred' ? { ...headers, 'Retry-After': '5' } : headers,
    });
  } catch {
    return NextResponse.json({ accepted: false, reason_code: 'inbound_mailbox_unavailable' }, { status: 503, headers });
  }
}
