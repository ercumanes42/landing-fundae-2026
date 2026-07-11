import { NextResponse } from 'next/server';
import { assertEnv } from '@/lib/env';
import { insertRows } from '@/lib/supabase';
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
  const rate = limitRequest(request, 'event-batch', 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  try {
    assertEnv();
    const body = await request.json();
    const events = body.events || [];

    if (!Array.isArray(events)) {
      return NextResponse.json(
        { error: 'Invalid batch payload' },
        { status: 400, headers }
      );
    }
    if (events.length > 50) {
      return NextResponse.json({ error: 'Batch limit is 50 events' }, { status: 400, headers });
    }

    const rows = events.map((e: any) => {
      const properties = sanitizeProperties(e.properties ?? {});
      return {
        event_name: e.event_name,
        anonymous_id: e.anonymous_id || e.context?.anonymous_id,
        session_id: e.session_id || e.context?.session_id,
        lead_magnet: e.lead_magnet || e.context?.lead_magnet,
        occurred_at: e.occurred_at || e.context?.occurred_at || new Date().toISOString(),
        context: e.context || {},
        properties,
      };
    });

    if (rows.length > 0) {
      await insertRows('events', rows);
    }

    return NextResponse.json({ ok: true, count: rows.length }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown event ingest error' },
      { status: 500, headers },
    );
  }
}
