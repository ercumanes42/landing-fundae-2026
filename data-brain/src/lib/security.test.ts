import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validatePublicCampaignEvent } from './campaign';
import { createMakeSignature, limitRequest, rateLimitAddress, verifyMakeSignature } from './security';

const body = JSON.stringify({ event: 'calculator_completed', lead_id: 'lead_01JTEST123' });
const secret = 'M4k3-HMAC-Only-9xQ2vR7sN5cP8dL1Z';
const now = Date.parse('2026-08-11T10:00:00.000Z');
const timestamp = String(Math.floor(now / 1000));

function signature(value = body, at = timestamp): string {
  return createHmac('sha256', secret).update(`${at}.${value}`).digest('hex');
}

test('Make signature accepts a valid timestamped payload', () => {
  assert.equal(verifyMakeSignature(body, signature(), timestamp, secret, now), true);
});

test('Make signature rejects expired and future timestamps outside five minutes', () => {
  const expired = String(Math.floor((now - 5 * 60_000) / 1000) - 1);
  const future = String(Math.floor((now + 5 * 60_000) / 1000) + 1);
  assert.equal(verifyMakeSignature(body, signature(body, expired), expired, secret, now), false);
  assert.equal(verifyMakeSignature(body, signature(body, future), future, secret, now), false);
});

test('Make signature rejects tampering, malformed signatures and absent inputs', () => {
  assert.equal(verifyMakeSignature(`${body}x`, signature(), timestamp, secret, now), false);
  assert.equal(verifyMakeSignature(body, 'wrong', timestamp, secret, now), false);
  assert.equal(verifyMakeSignature(body, signature().toUpperCase(), timestamp, secret, now), false);
  assert.equal(verifyMakeSignature(body, `sha256=${signature()}`, timestamp, secret, now), false);
  assert.equal(verifyMakeSignature(body, '\u00e9'.repeat(64), timestamp, secret, now), false);
  assert.equal(verifyMakeSignature(body, null, timestamp, secret, now), false);
  assert.equal(verifyMakeSignature(body, signature(), 'not-a-number', secret, now), false);
  assert.equal(verifyMakeSignature(body, signature(), timestamp, '', now), false);
});

test('Make signature requires Unix timestamps in seconds', () => {
  const timestampMilliseconds = String(now);
  assert.equal(verifyMakeSignature(body, signature(), timestamp, secret, now), true);
  assert.equal(
    verifyMakeSignature(body, signature(body, timestampMilliseconds), timestampMilliseconds, secret, now),
    false,
  );
});

test('Make HMAC rejects short and predictable placeholder secrets', () => {
  const placeholder = 'replace-with-a-long-random-secret';
  assert.equal(verifyMakeSignature(body, signature(body, timestamp), timestamp, 'short', now), false);
  assert.equal(verifyMakeSignature(body, signature(body, timestamp), timestamp, placeholder, now), false);
  assert.throws(() => createMakeSignature(body, timestamp, placeholder), /non-placeholder/);
});

test('rate limit identity ignores spoofable forwarding headers unless a trusted proxy header is configured', () => {
  const previous = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  process.env.RATE_LIMIT_TRUSTED_IP_HEADER = 'cf-connecting-ip';
  try {
    const request = new Request('https://data.example.test/api', {
      headers: {
        'x-forwarded-for': '203.0.113.99',
        'cf-connecting-ip': '192.0.2.44',
      },
    });
    assert.equal(rateLimitAddress(request), '192.0.2.44');
    assert.equal(
      rateLimitAddress(new Request('https://data.example.test/api', {
        headers: { 'cf-connecting-ip': 'not-an-ip' },
      })),
      'unattributed',
    );
  } finally {
    if (previous === undefined) delete process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
    else process.env.RATE_LIMIT_TRUSTED_IP_HEADER = previous;
  }
});

test('development memory fallback enforces the configured limit', async () => {
  const previous = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  process.env.RATE_LIMIT_TRUSTED_IP_HEADER = 'cf-connecting-ip';
  const request = new Request('http://localhost/api', {
    headers: { 'cf-connecting-ip': '198.51.100.77' },
  });
  const scope = `test-${Date.now()}`;
  try {
    assert.deepEqual(await limitRequest(request, scope, 1, 1_000, 'fail-closed'), { allowed: true });
    const rejected = await limitRequest(request, scope, 1, 1_000, 'fail-closed');
    assert.equal(rejected.allowed, false);
    if (!rejected.allowed) assert.equal(rejected.reason, 'limited');
  } finally {
    if (previous === undefined) delete process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
    else process.env.RATE_LIMIT_TRUSTED_IP_HEADER = previous;
  }
});

test('public campaign route accepts only harmless browser telemetry', () => {
  for (const eventName of ['landing_visit', 'resource_started']) {
    assert.doesNotThrow(() => validatePublicCampaignEvent({
      campaign_external_id: 'FUNDAE_2026_EMAIL_V1',
      contact_id: 'F26-C-0001',
      event_name: eventName,
      source_event_id: `evt_${eventName}`,
    }));
  }

  for (const eventName of [
    'resource_completed',
    'checklist_downloaded',
    'calculator_completed',
    'webinar_registered',
    'review_submitted',
    'diagnostic_intent',
    'diagnostic_requested',
    'positive_reply',
    'meeting_booked',
    'meeting_completed',
    'opportunity_created',
    'delivery_sent',
    'transactional_delivery_sent',
    'delivery_error',
    'reply_received',
    'bounce_hard',
    'unsubscribe',
    'crm_contact_updated',
  ]) {
    assert.throws(() => validatePublicCampaignEvent({
      campaign_external_id: 'FUNDAE_2026_EMAIL_V1',
      contact_id: 'F26-C-0001',
      event_name: eventName,
    }), /signed endpoint/);
  }
});

test('public and signed campaign routes use separate writers', () => {
  const publicRoute = readFileSync(new URL('../app/api/campaign/events/route.ts', import.meta.url), 'utf8');
  const signedRoute = readFileSync(new URL('../app/api/campaign/operations/route.ts', import.meta.url), 'utf8');

  assert.match(publicRoute, /recordPublicCampaignEvent\(payload\)/);
  assert.doesNotMatch(publicRoute, /recordCampaignEvent\(payload\)/);
  assert.match(signedRoute, /verifyMakeSignature/);
  assert.match(signedRoute, /recordCampaignOperation\(payload\)/);
});
