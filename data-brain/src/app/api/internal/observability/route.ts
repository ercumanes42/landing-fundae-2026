import { NextResponse } from 'next/server';

import {
  authorizeOperationalRequest,
  getOperationalSnapshot,
  isOperationalObservabilityEnabled,
  operationalMachineActorHash,
  parseOperationalHeartbeat,
  reconcileOperationalAlerts,
  recordOperationalHeartbeat,
} from '@/lib/operational-observability';

export const runtime = 'nodejs';

const RESPONSE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };
const MAX_BODY_BYTES = 8_192;

class BodyTooLargeError extends Error {}

async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('content length is invalid');
    if (length > MAX_BODY_BYTES) throw new BodyTooLargeError('body is too large');
  }
  if (!request.body) throw new Error('body is required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new BodyTooLargeError('body is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body is invalid');
  return parsed as Record<string, unknown>;
}

function guard(request: Request): NextResponse | null {
  if (!authorizeOperationalRequest(request)) {
    return NextResponse.json({ accepted: false, reason_code: 'unauthorized' }, { status: 401, headers: RESPONSE_HEADERS });
  }
  if (!isOperationalObservabilityEnabled()) {
    return NextResponse.json({ accepted: false, reason_code: 'observability_off' }, { status: 409, headers: RESPONSE_HEADERS });
  }
  return null;
}

export async function GET(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const snapshot = await getOperationalSnapshot();
    return NextResponse.json(snapshot, { status: 200, headers: RESPONSE_HEADERS });
  } catch {
    return NextResponse.json({ accepted: false, reason_code: 'observability_unavailable' }, { status: 503, headers: RESPONSE_HEADERS });
  }
}

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const body = await readBoundedJson(request);
    if (body.action === 'heartbeat') {
      await recordOperationalHeartbeat(parseOperationalHeartbeat(body.heartbeat));
    } else if (body.action === 'evaluate') {
      const snapshot = await getOperationalSnapshot();
      const result = await reconcileOperationalAlerts(snapshot, operationalMachineActorHash());
      return NextResponse.json({ accepted: true, alert_count: result.alerts.length, evaluation_key: result.evaluation_key }, { headers: RESPONSE_HEADERS });
    } else {
      throw new Error('action is invalid');
    }
    return NextResponse.json({ accepted: true }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return NextResponse.json({ accepted: false, reason_code: 'body_too_large' }, { status: 413, headers: RESPONSE_HEADERS });
    }
    return NextResponse.json({ accepted: false, reason_code: 'invalid_request' }, { status: 400, headers: RESPONSE_HEADERS });
  }
}
