import { NextResponse } from 'next/server';
import { recordHubSpotContactEvent } from '@/lib/campaign';
import { assertEnv } from '@/lib/env';
import { limitRequest, verifyHubSpotSignature } from '@/lib/security';

export const runtime = 'nodejs';

interface HubSpotWebhookEvent {
  eventId?: string | number;
  objectId?: string | number;
  propertyName?: string;
  propertyValue?: string;
  occurredAt?: number;
}

export async function POST(request: Request) {
  const rate = limitRequest(request, 'hubspot-webhook', 1_000, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const rawBody = await request.text();
  if (!verifyHubSpotSignature(request, rawBody)) {
    return NextResponse.json({ error: 'Invalid HubSpot signature' }, { status: 401 });
  }

  try {
    assertEnv();
    const events = JSON.parse(rawBody) as HubSpotWebhookEvent[];
    if (!Array.isArray(events)) {
      return NextResponse.json({ error: 'HubSpot payload must be an array' }, { status: 400 });
    }

    const results = await Promise.all(
      events.map((event, index) => {
        const sourceEventId = String(event.eventId ?? `hubspot_${Date.now()}_${index}`);
        return recordHubSpotContactEvent({
          hubspotContactId: String(event.objectId ?? ''),
          sourceEventId,
          propertyName: event.propertyName,
          propertyValue: event.propertyValue,
          occurredAt: event.occurredAt ? new Date(event.occurredAt).toISOString() : undefined,
        });
      }),
    );

    return NextResponse.json({ ok: true, received: events.length, matched: results.filter(Boolean).length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'HubSpot webhook rejected' },
      { status: 400 },
    );
  }
}
