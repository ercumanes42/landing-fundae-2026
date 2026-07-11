import { NextResponse } from 'next/server';
import { assertEnv } from '@/lib/env';
import { recordCampaignEvent, type CampaignEventInput } from '@/lib/campaign';
import { corsHeaders, isAllowedLandingOrigin, limitRequest } from '@/lib/security';

export const runtime = 'nodejs';

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  if (!isAllowedLandingOrigin(request)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403, headers });
  }

  const rate = limitRequest(request, 'campaign-events', 60, 5 * 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  try {
    assertEnv();
    const payload = (await request.json()) as CampaignEventInput;
    const event = await recordCampaignEvent(payload);
    return NextResponse.json({ ok: true, id: event.id }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Campaign event rejected' },
      { status: 400, headers },
    );
  }
}
