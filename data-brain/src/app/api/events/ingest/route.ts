import { NextResponse } from 'next/server';
import { assertEnv } from '@/lib/env';
import { insertRow } from '@/lib/supabase';
import type { EventPayload } from '@/lib/types';
import { corsHeaders, isAllowedLandingOrigin, limitRequest } from '@/lib/security';

export const runtime = 'nodejs';

const PII_KEYS = new Set(['email', 'name', 'phone', 'company', 'message', 'contact']);

function sanitizeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (PII_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === 'object' && value !== null) continue;
    clean[key] = value;
  }
  return clean;
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  if (!isAllowedLandingOrigin(request)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403, headers });
  }
  const rate = limitRequest(request, 'event-ingest', 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  try {
    assertEnv();
    const payload = (await request.json()) as EventPayload;
    if (!payload.event_name || !payload.context?.anonymous_id) {
      return NextResponse.json(
        { error: 'Invalid event payload' },
        { status: 400, headers },
      );
    }

    const properties = sanitizeProperties(payload.properties ?? {});
    const row = await insertRow('events', {
      event_name: payload.event_name,
      anonymous_id: payload.context.anonymous_id,
      session_id: payload.context.session_id,
      lead_magnet: payload.context.lead_magnet,
      occurred_at: payload.context.occurred_at,
      context: payload.context,
      properties,
    });

    return NextResponse.json({ ok: true, id: row.id }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown event ingest error' },
      { status: 500, headers },
    );
  }
}
