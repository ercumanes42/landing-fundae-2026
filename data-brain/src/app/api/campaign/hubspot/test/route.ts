import { NextResponse } from 'next/server';
import { assertEnv } from '@/lib/env';
import { testHubSpotConnection } from '@/lib/hubspot';

export const runtime = 'nodejs';

export async function GET() {
  try {
    assertEnv();
    const result = await testHubSpotConnection();
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'HubSpot test failed' },
      { status: 500 },
    );
  }
}
