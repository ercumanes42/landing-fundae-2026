import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateDeliveryAuthorizationInput } from './delivery-authorization';

test('authorization contract accepts exactly campaign, contact and execution identifiers', () => {
  assert.deepEqual(validateDeliveryAuthorizationInput({
    campaign_external_id: 'FUNDAE_2026_EMAIL_V1',
    contact_id: 'F26-C-0001',
    execution_key: 'FUNDAE_2026_EMAIL_V1:F26-C-0001:E1',
  }), {
    campaign_external_id: 'FUNDAE_2026_EMAIL_V1',
    contact_id: 'F26-C-0001',
    execution_key: 'FUNDAE_2026_EMAIL_V1:F26-C-0001:E1',
  });
  assert.throws(() => validateDeliveryAuthorizationInput({
    campaign_external_id: 'FUNDAE_2026_EMAIL_V1', contact_id: 'F26-C-0001',
    execution_key: 'FUNDAE_2026_EMAIL_V1:F26-C-0001:E1', email: 'pii@example.com',
  }), /not allowed/);
});

test('JIT authorization locks the contact and fails closed on global or local suppression', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260811_unsubscribe_flow.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function public\.authorize_campaign_delivery/);
  assert.match(sql, /for update/);
  assert.match(sql, /campaign_suppressions/);
  assert.match(sql, /suppression_scope <> 'none'/);
  assert.match(sql, /v_execution\.status <> 'planned'/);
  assert.match(sql, /lock_expires_at = v_lock_expires_at/);
  assert.match(sql, /grant execute on function public\.authorize_campaign_delivery.*service_role/);
});

test('schema bootstrap contains the JIT authorization RPC', () => {
  const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function public\.authorize_campaign_delivery/);
  assert.match(sql, /grant execute on function public\.authorize_campaign_delivery.*service_role/);
});

test('proxy publishes only the exact signed authorization path', () => {
  const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  assert.match(proxy, /'\/api\/campaign\/delivery-authorization'/);
  assert.doesNotMatch(proxy, /pathname\.startsWith\('\/api\/campaign\/delivery/);
});
