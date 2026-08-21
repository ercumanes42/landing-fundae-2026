import { NextResponse } from 'next/server';

import {
  authorizeHubSpotWorkerRequest,
  executeConfiguredHubSpotSyncTick,
  type HubSpotSyncTickResult,
} from '@/lib/hubspot-sync-outbox';

export const runtime = 'nodejs';
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };

export function createHubSpotDispatchHandler(deps: {
  authorize(request: Request): boolean;
  execute(): Promise<HubSpotSyncTickResult>;
} = {
  authorize: authorizeHubSpotWorkerRequest,
  execute: executeConfiguredHubSpotSyncTick,
}) {
  return async function POST(request: Request) {
    if (!deps.authorize(request)) {
      return NextResponse.json(
        { accepted: false, reason_code: 'unauthorized' },
        { status: 401, headers: HEADERS },
      );
    }
    if ((request.headers.get('content-length') ?? '0') !== '0') {
      return NextResponse.json(
        { accepted: false, reason_code: 'invalid_request' },
        { status: 400, headers: HEADERS },
      );
    }
    try {
      const result = await deps.execute();
      const status = result.state === 'off' ? 409
        : result.state === 'retry_wait' || result.state === 'dead_letter' ? 503
          : 200;
      return NextResponse.json(
        { accepted: ['empty', 'synced'].includes(result.state), ...result },
        { status, headers: result.state === 'retry_wait'
          ? { ...HEADERS, 'Retry-After': '30' }
          : HEADERS },
      );
    } catch {
      return NextResponse.json(
        { accepted: false, reason_code: 'hubspot_sync_unavailable' },
        { status: 503, headers: { ...HEADERS, 'Retry-After': '30' } },
      );
    }
  };
}

export const POST = createHubSpotDispatchHandler();
