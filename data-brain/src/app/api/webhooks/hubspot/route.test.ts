import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';

import { processVerifiedHubSpotWebhook, verifyHubSpotWebhookRequest } from './route';

const originalSecret = process.env.HUBSPOT_WEBHOOK_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.HUBSPOT_WEBHOOK_SECRET;
  else process.env.HUBSPOT_WEBHOOK_SECRET = originalSecret;
});

test('accepts exact CRM v1 signatures and rejects malformed signatures', () => {
  const secret = 'hubspot-webhook-test-secret-with-32-bytes';
  const body = '[{"eventId":1}]';
  process.env.HUBSPOT_WEBHOOK_SECRET = secret;
  const signature = createHash('sha256').update(`${secret}${body}`).digest('hex');
  const request = new Request('https://data.invalid/api/webhooks/hubspot', {
    method: 'POST',
    headers: {
      'x-hubspot-signature-version': 'v1',
      'x-hubspot-signature': signature,
    },
  });
  assert.equal(verifyHubSpotWebhookRequest(request, body), true);
  assert.equal(verifyHubSpotWebhookRequest(new Request(request.url, {
    method: 'POST',
    headers: {
      'x-hubspot-signature-version': 'v1',
      'x-hubspot-signature': '0'.repeat(64),
    },
  }), body), false);
});

test('an invalid v3 signature cannot downgrade to a valid v1 signature', () => {
  const secret = 'hubspot-webhook-test-secret-with-32-bytes';
  const body = '[{"eventId":1}]';
  process.env.HUBSPOT_WEBHOOK_SECRET = secret;
  const v1 = createHash('sha256').update(`${secret}${body}`).digest('hex');
  const request = new Request('https://data.invalid/api/webhooks/hubspot', {
    method: 'POST',
    headers: {
      'x-hubspot-signature-v3': 'invalid',
      'x-hubspot-request-timestamp': String(Date.now()),
      'x-hubspot-signature-version': 'v1',
      'x-hubspot-signature': v1,
    },
  });
  assert.equal(verifyHubSpotWebhookRequest(request, body), false);
});

test('returns 503 when a valid normalized webhook hits a transient processing failure', async () => {
  const response = await processVerifiedHubSpotWebhook('[{"eventId":1}]', {
    assertConfigured: () => undefined,
    normalize: () => [{
      hubspotContactId: '123',
      sourceEventId: 'hubspot:event:1',
      propertyName: 'fundae_suppression_reason',
      propertyValue: 'unsubscribe',
    }],
    record: async () => {
      throw new Error('Supabase temporarily unavailable');
    },
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'HubSpot webhook processing unavailable' });
});

test('keeps malformed or rejected HubSpot events as client errors', async () => {
  const malformed = await processVerifiedHubSpotWebhook('{', {
    assertConfigured: () => undefined,
    normalize: () => [],
    record: async () => true,
  });
  assert.equal(malformed.status, 400);

  const rejected = await processVerifiedHubSpotWebhook('[{}]', {
    assertConfigured: () => undefined,
    normalize: () => { throw new Error('Invalid HubSpot event'); },
    record: async () => true,
  });
  assert.equal(rejected.status, 400);
});
