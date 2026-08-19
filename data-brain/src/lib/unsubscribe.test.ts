import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createUnsubscribeToken,
  hashUnsubscribeToken,
  isUnsubscribeToken,
  unsubscribePublicUrl,
  validateIssueUnsubscribeLinkInput,
} from './unsubscribe';
import { renderUnsubscribeCompleted, renderUnsubscribeConfirmation } from './unsubscribe-page';

const secret = '2F2Mv8hmc34KjPpT9Zq6wNB7eRaD1sX5';

test('opaque token is deterministic, non-enumerable and contains no campaign or contact id', () => {
  const token = createUnsubscribeToken('FUNDAE_2026_EMAIL_V1', 'F26-C-0001', 1, secret);
  assert.match(token, /^u1\.[A-Za-z0-9_-]{43}$/);
  assert.equal(token, createUnsubscribeToken('FUNDAE_2026_EMAIL_V1', 'F26-C-0001', 1, secret));
  assert.notEqual(token, createUnsubscribeToken('FUNDAE_2026_EMAIL_V1', 'F26-C-0002', 1, secret));
  assert.doesNotMatch(token, /FUNDAE|F26|0001/);
  assert.equal(isUnsubscribeToken(token), true);
  assert.match(hashUnsubscribeToken(token), /^[a-f0-9]{64}$/);
});

test('token generation rejects short and placeholder secrets', () => {
  assert.throws(() => createUnsubscribeToken('FUNDAE_2026_EMAIL_V1', 'F26-C-0001', 1, 'short'), /at least 32/);
  assert.throws(
    () => createUnsubscribeToken('FUNDAE_2026_EMAIL_V1', 'F26-C-0001', 1, 'replace-with-a-long-random-secret'),
    /placeholder/,
  );
});

test('issue input has a strict allowlist and optional bounded expiry', () => {
  const now = Date.parse('2026-08-11T10:00:00.000Z');
  assert.deepEqual(validateIssueUnsubscribeLinkInput({
    campaign_external_id: 'FUNDAE_2026_EMAIL_V1',
    contact_id: 'F26-C-0001',
  }, now), {
    campaign_external_id: 'FUNDAE_2026_EMAIL_V1',
    contact_id: 'F26-C-0001',
    token_version: 1,
    expires_at: null,
  });
  assert.throws(() => validateIssueUnsubscribeLinkInput({
    campaign_external_id: 'FUNDAE_2026_EMAIL_V1', contact_id: 'F26-C-0001', email: 'pii@example.com',
  }, now), /not allowed/);
  assert.throws(() => validateIssueUnsubscribeLinkInput({
    campaign_external_id: 'FUNDAE_2026_EMAIL_V1', contact_id: 'F26-C-0001', expires_at: '2026-08-11T10:05:00Z',
  }, now), /24 hours/);
});

test('public URL is fixed to the configured origin and never accepts redirects', () => {
  const previous = process.env.UNSUBSCRIBE_PUBLIC_BASE_URL;
  process.env.UNSUBSCRIBE_PUBLIC_BASE_URL = 'https://data.gfs.es/path?redirect=https://evil.example';
  try {
    const token = createUnsubscribeToken('FUNDAE_2026_EMAIL_V1', 'F26-C-0001', 1, secret);
    assert.equal(unsubscribePublicUrl(token), `https://data.gfs.es/baja?token=${token}`);
  } finally {
    if (previous === undefined) delete process.env.UNSUBSCRIBE_PUBLIC_BASE_URL;
    else process.env.UNSUBSCRIBE_PUBLIC_BASE_URL = previous;
  }
});

test('GET copy only asks for confirmation and POST copy is non-enumerating', () => {
  const token = createUnsubscribeToken('FUNDAE_2026_EMAIL_V1', 'F26-C-0001', 1, secret);
  const confirm = renderUnsubscribeConfirmation(token);
  const completed = renderUnsubscribeCompleted();
  assert.match(confirm, /method="post"/);
  assert.match(confirm, new RegExp(token.replace('.', '\\.')));
  assert.doesNotMatch(confirm, /procesado|aplicada/i);
  assert.match(completed, /Si el enlace era v&aacute;lido/i);
  assert.doesNotMatch(completed, /email_hash|contact_id|token_hash/);
});

test('migration atomically suppresses the identity across campaigns and protects server-only data', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260811_unsubscribe_flow.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.campaign_unsubscribe_tokens/);
  assert.match(sql, /token_hash text not null/);
  assert.doesNotMatch(sql, /token_value|raw_token/);
  assert.match(sql, /where email_hash = p_identity_hash/);
  assert.match(sql, /where status = 'planned'/);
  assert.match(sql, /locked_at = null/);
  assert.match(sql, /campaign_contacts_enforce_suppression/);
  assert.match(sql, /campaign_executions_enforce_stop_gate/);
  assert.match(sql, /for update/);
  assert.match(sql, /where suppression_scope = 'all' or suppression_reason = 'unsubscribe'/);
  assert.match(sql, /on conflict \(identity_hash\) do nothing/);
  assert.match(sql, /where campaign_unsubscribe_tokens\.revoked_at is null/);
  assert.doesNotMatch(sql, /revoked_at = null/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all privileges .* anon, authenticated/);
  assert.match(sql, /grant execute .*consume_campaign_unsubscribe_token.*service_role/);
});

test('schema bootstrap contains the same unsubscribe security invariants', () => {
  const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.campaign_suppressions/);
  assert.match(sql, /create table if not exists public\.campaign_unsubscribe_tokens/);
  assert.match(sql, /campaign_contacts_enforce_suppression/);
  assert.match(sql, /campaign_executions_enforce_stop_gate/);
  assert.match(sql, /consume_campaign_unsubscribe_token/);
  assert.match(sql, /where suppression_scope = 'all' or suppression_reason = 'unsubscribe'/);
  assert.match(sql, /enable row level security/);
});

test('proxy exposes only the exact public unsubscribe paths', () => {
  const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  assert.match(proxy, /'\/baja'/);
  assert.match(proxy, /'\/api\/campaign\/unsubscribe-link'/);
  assert.doesNotMatch(proxy, /pathname\.startsWith\('\/baja/);
  assert.doesNotMatch(proxy, /pathname\.startsWith\('\/api\/campaign\/unsubscribe/);
});
