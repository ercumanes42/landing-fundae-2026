import { NextResponse } from 'next/server';
import { importCampaignContacts, type CampaignImportRequest } from '@/lib/campaign';
import { assertEnv, env } from '@/lib/env';
import { verifySecret } from '@/lib/security';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const secret = env('CAMPAIGN_IMPORT_SECRET');
  if (!verifySecret(request.headers.get('x-campaign-import-secret'), secret)) {
    return NextResponse.json({ error: 'Campaign import is not authorized' }, { status: 401 });
  }

  try {
    assertEnv();
    const payload = (await request.json()) as CampaignImportRequest;
    const result = await importCampaignContacts(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Campaign import failed' },
      { status: 400 },
    );
  }
}
