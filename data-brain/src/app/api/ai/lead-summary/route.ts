import { NextResponse } from 'next/server';
import { basicAuthHeaders, isBasicAuthValid } from '@/lib/auth';
import { assertEnv } from '@/lib/env';
import { summarizeLead } from '@/lib/openai';
import type { LeadPayload } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertEnv();

    if (!isBasicAuthValid(request)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: basicAuthHeaders() },
      );
    }

    const lead = (await request.json()) as LeadPayload;
    if (!lead?.contact?.email || !lead?.form_type) {
      return NextResponse.json({ error: 'Invalid lead payload' }, { status: 400 });
    }

    const summary = await summarizeLead(lead);
    if (summary.confidence < 0.5) {
      summary.recommended_action = 'revisar_manual';
    }

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown AI summary error' },
      { status: 500 },
    );
  }
}
