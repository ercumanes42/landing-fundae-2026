import { NextResponse } from 'next/server';
import { assertEnv } from '@/lib/env';
import { insertRow } from '@/lib/supabase';
import type { EventPayload } from '@/lib/types';

export const runtime = 'nodejs';

const PII_KEYS = new Set(['email', 'name', 'phone', 'company', 'message', 'contact']);

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function sanitizeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (PII_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === 'object' && value !== null) continue;
    clean[key] = value;
  }
  return clean;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    assertEnv();
    const payload = (await request.json()) as EventPayload;
    if (!payload.event_name || !payload.context?.anonymous_id) {
      return NextResponse.json(
        { error: 'Invalid event payload' },
        { status: 400, headers: corsHeaders() },
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

    return NextResponse.json({ ok: true, id: row.id }, { headers: corsHeaders() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown event ingest error' },
      { status: 500, headers: corsHeaders() },
    );
  }
}
