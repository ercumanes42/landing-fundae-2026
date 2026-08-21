import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeliveryAuthorizationRequest,
  buildUnsubscribeLinkRequest,
  createMakeSignature,
  injectOptOutFooter,
  validateBackendUnsubscribeUrl,
  validateUnsubscribeLinkResponse,
  verifyMakeSignature,
} from './unsubscribe-operations.mjs';

const secret = '4f91f3c90e24490aabf9c086454be1b7-test-only';
const payload = buildUnsubscribeLinkRequest({
  campaignId: 'FUNDAE_2026_EMAIL_V1',
  contactId: 'F26-A-0001',
});
const rawBody = JSON.stringify(payload);

test('builds the exact backend payload with pseudonymous IDs and no PII', () => {
  assert.deepEqual(payload, {
    campaign_external_id: 'FUNDAE_2026_EMAIL_V1',
    contact_id: 'F26-A-0001',
    token_version: 1,
  });
  assert.equal(rawBody.includes('@'), false);
  assert.equal(rawBody.includes('email'), false);
});

test('builds the strict JIT delivery authorization payload', () => {
  assert.deepEqual(buildDeliveryAuthorizationRequest({
    campaignId: 'FUNDAE_2026_EMAIL_V1',
    contactId: 'F26-A-0001',
    executionKey: 'FUNDAE_2026_EMAIL_V1:F26-A-0001:email:E1',
  }), {
    campaign_external_id: 'FUNDAE_2026_EMAIL_V1',
    contact_id: 'F26-A-0001',
    execution_key: 'FUNDAE_2026_EMAIL_V1:F26-A-0001:email:E1',
  });
});

test('matches the canonical Make HMAC vector', () => {
  const timestamp = '1788255000';
  const signature = createMakeSignature(rawBody, secret, timestamp);
  assert.equal(signature, '12b461d5bbc185e3380b22c07bb98f9be6d0c2f07ccf434be44c84998876cb18');
  assert.equal(verifyMakeSignature(rawBody, secret, timestamp, signature), true);
  assert.equal(verifyMakeSignature(`${rawBody} `, secret, timestamp, signature), false);
});

test('accepts only the fixed backend /baja URL and u1 token contract', () => {
  const valid = 'https://data-brain.gfs.es/baja?token=u1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
  assert.equal(validateBackendUnsubscribeUrl(valid, 'https://data-brain.gfs.es'), valid);
  assert.equal(validateUnsubscribeLinkResponse({ ok: true, unsubscribe_url: valid }, 'https://data-brain.gfs.es'), valid);
  assert.throws(() => validateBackendUnsubscribeUrl('http://data-brain.gfs.es/baja?token=u1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'), /HTTPS/);
  assert.throws(() => validateBackendUnsubscribeUrl(`${valid}&email=user@example.com`), /only the token/);
  assert.throws(() => validateBackendUnsubscribeUrl(valid.replace('/baja', '/redirect')), /fixed \/baja/);
  assert.throws(() => validateBackendUnsubscribeUrl(valid.replace('u1.', 'v1.')), /token is invalid/);
});

test('rejects invalid payloads and weak signing secrets', () => {
  assert.throws(
    () => buildUnsubscribeLinkRequest({ campaignId: 'FUNDAE', contactId: 'juan@example.com' }),
    /pseudonymous ID/,
  );
  assert.throws(() => createMakeSignature(rawBody, 'short', '1788255000'), /at least 32 bytes/);
  assert.throws(
    () => createMakeSignature(rawBody, 'replace-with-a-long-random-secret', '1788255000'),
    /placeholder value/,
  );
  assert.throws(() => createMakeSignature(rawBody, secret, 'not-a-timestamp'), /Unix seconds/);
});

test('injects one UTF-8 idempotent placeholder footer', () => {
  const first = injectOptOutFooter('<html><body><p>Mensaje</p></body></html>');
  const second = injectOptOutFooter(first);
  assert.equal((second.match(/data-gfs-opt-out="1"/g) || []).length, 1);
  assert.equal((second.match(/\{\{unsubscribe_url\}\}/g) || []).length, 1);
  assert.match(second, /campaña informativa/);
  assert.match(second, /más comunicaciones/);
  assert.match(second, /baja aquí/);
});
