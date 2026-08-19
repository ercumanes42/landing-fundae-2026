import assert from 'node:assert/strict';
import { createHmac, pbkdf2Sync } from 'node:crypto';
import test from 'node:test';

import {
  AuthAttemptLimiter,
  authenticateDashboardAuthorization,
  dashboardAuthAudit,
  parseDashboardCredentialStore,
} from './dashboard-auth';

const pepper = `pepper-${'p'.repeat(40)}`;
const password = 'correct horse battery staple';

function credential(keyId: string, saltByte: number, secret = password) {
  const salt = Buffer.alloc(16, saltByte);
  return {
    key_id: keyId,
    salt: salt.toString('base64url'),
    digest: pbkdf2Sync(secret, salt, 600_000, 32, 'sha256').toString('base64url'),
  };
}

function store(identities = ['admin', 'operator', 'auditor', 'read_only'].map((username, index) => ({
  username,
  credentials: [credential(`${username}-v1`, index + 1)],
}))) {
  return JSON.stringify({
    version: 1,
    kdf: { name: 'PBKDF2-SHA256', iterations: 600_000 },
    identities,
  });
}

function basic(username: string, secret: string): string {
  return `Basic ${Buffer.from(`${username}:${secret}`, 'utf8').toString('base64')}`;
}

test('authenticates separate admin/operator/auditor/read_only identities without assigning roles in env', async () => {
  const raw = store();
  assert.equal(raw.includes('"role"'), false);
  const hashes = new Set<string>();
  for (const username of ['admin', 'operator', 'auditor', 'read_only']) {
    const result = await authenticateDashboardAuthorization({
      authorization: basic(username, password), credentialStore: raw, pepper, legacyEnabled: 'false',
    });
    assert.equal(result.ok, true);
    if (result.ok) hashes.add(result.actorHash);
  }
  assert.equal(hashes.size, 4);
});

test('wrong username and wrong password are externally indistinguishable', async () => {
  const raw = store();
  const wrongUser = await authenticateDashboardAuthorization({
    authorization: basic('unknown', password), credentialStore: raw, pepper, legacyEnabled: 'false',
  });
  const wrongPassword = await authenticateDashboardAuthorization({
    authorization: basic('admin', 'incorrect'), credentialStore: raw, pepper, legacyEnabled: 'false',
  });
  assert.deepEqual(wrongUser, { ok: false, reason: 'invalid_credentials' });
  assert.deepEqual(wrongPassword, wrongUser);
});

test('rejects malformed stores, duplicate identities and credential collisions', () => {
  assert.throws(() => parseDashboardCredentialStore('{'));
  assert.throws(() => parseDashboardCredentialStore(store().replace('600000', '599999')));
  const repeated = { username: 'admin', credentials: [credential('v1', 9)] };
  assert.throws(() => parseDashboardCredentialStore(store([repeated, repeated])));
  assert.throws(() => parseDashboardCredentialStore(store([
    { username: 'admin', credentials: [credential('v1', 7)] },
    { username: 'auditor', credentials: [credential('v2', 7)] },
  ])));
});

test('accepts an overlapping two-key rotation and maps actor deterministically', async () => {
  const rotating = store([{ username: 'operator', credentials: [
    credential('old', 21, 'old password'), credential('new', 22, 'new password'),
  ] }]);
  for (const [secret, keyId] of [['old password', 'old'], ['new password', 'new']] as const) {
    const result = await authenticateDashboardAuthorization({
      authorization: basic('operator', secret), credentialStore: rotating, pepper, legacyEnabled: 'false',
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.credentialKeyId, keyId);
      assert.equal(result.actorHash, createHmac('sha256', pepper).update('dashboard-actor-v1\0operator').digest('hex'));
    }
  }
});

test('fails closed for legacy mode or malformed configuration', async () => {
  const raw = store();
  for (const input of [
    { credentialStore: raw, pepper, legacyEnabled: 'true' },
    { credentialStore: '{}', pepper, legacyEnabled: 'false' },
    { credentialStore: raw, pepper: 'short', legacyEnabled: 'false' },
  ]) {
    assert.deepEqual(await authenticateDashboardAuthorization({
      authorization: basic('admin', password), ...input,
    }), { ok: false, reason: 'configuration_error' });
  }
});

test('audit events and limiter never expose supplied credentials', async () => {
  const messages: string[] = [];
  const logger = { info: (value: string) => messages.push(value), warn: (value: string) => messages.push(value) };
  const result = await authenticateDashboardAuthorization({
    authorization: basic('admin', password), credentialStore: store(), pepper, legacyEnabled: 'false',
  });
  dashboardAuthAudit(result, logger);
  assert.equal(messages.join('').includes(password), false);
  assert.equal(messages.join('').includes('admin'), false);

  const limiter = new AuthAttemptLimiter(3, 1_000);
  limiter.recordFailure('client'); limiter.recordFailure('client'); limiter.recordFailure('client');
  assert.equal(limiter.isAllowed('client'), false);
  assert.equal(limiter.isAllowed('client', Date.now() + 1_001), true);
});
