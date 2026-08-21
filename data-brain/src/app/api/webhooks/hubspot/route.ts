import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { recordHubSpotContactEvent } from '@/lib/campaign';
import { assertEnv, env } from '@/lib/env';
import { parseHubSpotWebhookEvent } from '@/lib/hubspot';
import { limitRequest, verifyHubSpotSignature } from '@/lib/security';

export const runtime = 'nodejs';

type HubSpotContactEvent = Parameters<typeof recordHubSpotContactEvent>[0];

interface HubSpotWebhookDependencies {
  assertConfigured: () => void;
  normalize: (events: unknown[]) => HubSpotContactEvent[];
  record: (event: HubSpotContactEvent) => Promise<boolean>;
}

const defaultDependencies: HubSpotWebhookDependencies = {
  assertConfigured: assertEnv,
  normalize: (events) => events.map((event) => parseHubSpotWebhookEvent(event, env('HUBSPOT_PORTAL_ID'))),
  record: recordHubSpotContactEvent,
};

export function verifyHubSpotWebhookRequest(request: Request, rawBody: string): boolean {
  if (request.headers.has('x-hubspot-signature-v3')) return verifyHubSpotSignature(request, rawBody);
  const version = request.headers.get('x-hubspot-signature-version');
  const signature = request.headers.get('x-hubspot-signature');
  const secret = env('HUBSPOT_WEBHOOK_SECRET');
  if (version !== 'v1' || !signature || !/^[a-f0-9]{64}$/.test(signature) || !secret) return false;
  const expected = createHash('sha256').update(`${secret}${rawBody}`).digest('hex');
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

export async function processVerifiedHubSpotWebhook(
  rawBody: string,
  dependencies: HubSpotWebhookDependencies = defaultDependencies,
) {
  try {
    dependencies.assertConfigured();
  } catch {
    return NextResponse.json({ error: 'HubSpot webhook processing unavailable' }, { status: 503 });
  }

  let events: unknown;
  try {
    events = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: 'Invalid HubSpot webhook payload' }, { status: 400 });
  }
  if (!Array.isArray(events) || events.length === 0 || events.length > 100) {
    return NextResponse.json({ error: 'HubSpot payload must contain 1-100 events' }, { status: 400 });
  }

  let normalized: HubSpotContactEvent[];
  try {
    normalized = dependencies.normalize(events);
  } catch {
    return NextResponse.json({ error: 'Invalid HubSpot webhook payload' }, { status: 400 });
  }

  try {
    const results: boolean[] = [];
    for (const event of normalized) results.push(await dependencies.record(event));
    return NextResponse.json({ ok: true, received: events.length, matched: results.filter(Boolean).length });
  } catch {
    return NextResponse.json({ error: 'HubSpot webhook processing unavailable' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const rate = await limitRequest(request, 'hubspot-webhook', 1_000, 60_000, 'fail-closed');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: rate.reason === 'unavailable' ? 503 : 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > 256 * 1024) {
    return NextResponse.json({ error: 'HubSpot payload is too large' }, { status: 413 });
  }
  if (!verifyHubSpotWebhookRequest(request, rawBody)) {
    return NextResponse.json({ error: 'Invalid HubSpot signature' }, { status: 401 });
  }

  return processVerifiedHubSpotWebhook(rawBody);
}
