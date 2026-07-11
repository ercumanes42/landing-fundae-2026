import { NextResponse } from 'next/server';
import { recordCampaignOperation, type CampaignOperationInput } from '@/lib/campaign';
import { assertEnv, env } from '@/lib/env';
import { corsHeaders, limitRequest, verifyHmacSignature } from '@/lib/security';

export const runtime = 'nodejs';

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  const rate = limitRequest(request, 'campaign-operations', 300, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const rawBody = await request.text();
  if (!verifyHmacSignature(rawBody, request.headers.get('x-make-signature'), env('MAKE_WEBHOOK_SECRET'))) {
    return NextResponse.json({ error: 'Invalid Make signature' }, { status: 401, headers });
  }

  try {
    assertEnv();
    const payload = JSON.parse(rawBody) as CampaignOperationInput;
    const result = await recordCampaignOperation(payload);
    return NextResponse.json({ ok: true, id: result.id }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Campaign operation rejected' },
      { status: 400, headers },
    );
  }
}
