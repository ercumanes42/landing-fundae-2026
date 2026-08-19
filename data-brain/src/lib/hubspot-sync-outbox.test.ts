import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeHubSpotWorkerRequest,
  executeHubSpotSyncTick,
  type HubSpotSyncOutboxDependencies,
} from './hubspot-sync-outbox';

const hash = 'a'.repeat(64);
const contactId = '11111111-1111-4111-8111-111111111111';
const claimToken = '22222222-2222-4222-8222-222222222222';
const workerId = '33333333-3333-4333-8333-333333333333';

function claimItem(overrides: Record<string, unknown> = {}) {
  return {
    campaign_contact_id: contactId,
    version: 1,
    payload_hash: hash,
    claim_token: claimToken,
    lead_id: hash,
    external_contact_id: 'F26-001',
    external_account_id: 'ACCOUNT-001',
    email: 'contact@example.invalid',
    first_name: null,
    last_name: null,
    company_name: null,
    job_title: null,
    company_size: 'micro',
    campaign_external_id: 'FUNDAE_2026_EMAIL_V1',
    variant: 'Checklist',
    magnet: 'Checklist',
    sequence_status: 'pending',
    ...overrides,
  };
}

test('OFF returns without claim or HubSpot network work', async () => {
  const calls: string[] = [];
  const result = await executeHubSpotSyncTick({
    enabled: () => false,
    workerId,
    rpc: async (name) => { calls.push(name); return {} as never; },
    sync: async () => { throw new Error('must not sync'); },
  });
  assert.equal(result.state, 'off');
  assert.deepEqual(calls, []);
});

test('claimed contacts sync once and finalize with the canonical HubSpot id', async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps: HubSpotSyncOutboxDependencies = {
    enabled: () => true,
    workerId,
    rpc: async <T>(name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'claim_hubspot_sync_outbox') {
        return { accepted: true, reason_code: 'claimed', items: [claimItem()] } as T;
      }
      return { accepted: true, reason_code: 'synced' } as T;
    },
    sync: async (records) => ({
      contactIds: new Map([[records[0].leadId, 'hubspot-1001']]),
      companyIds: new Map([[records[0].externalAccountId, 'hubspot-company-1']]),
      failures: [],
    }),
  };
  const result = await executeHubSpotSyncTick(deps);
  assert.equal(result.state, 'synced');
  assert.equal(result.synced, 1);
  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[1].name, 'finalize_hubspot_sync_outbox');
  assert.equal(rpcCalls[1].args.p_hubspot_contact_id, 'hubspot-1001');
  assert.equal(rpcCalls[1].args.p_outcome, 'synced');
});

test('network and partial failures finalize durably for retry without false success', async () => {
  for (const mode of ['throw', 'partial'] as const) {
    const outcomes: unknown[] = [];
    const result = await executeHubSpotSyncTick({
      enabled: () => true,
      workerId,
      rpc: async <T>(name: string, args: Record<string, unknown>) => {
        if (name === 'claim_hubspot_sync_outbox') {
          return { accepted: true, reason_code: 'claimed', items: [claimItem()] } as T;
        }
        outcomes.push(args.p_outcome);
        return { accepted: true, reason_code: 'retry_wait' } as T;
      },
      sync: async (records) => {
        if (mode === 'throw') throw new Error('timeout');
        return {
          contactIds: new Map<string, string>(),
          companyIds: new Map<string, string>(),
          failures: [{ externalId: records[0].externalContactId, stage: 'contact', reason: 'rejected' }],
        };
      },
    });
    assert.equal(result.state, 'retry_wait');
    assert.deepEqual(outcomes, ['retryable_failure']);
  }
});

test('malformed claim data fails closed before HubSpot', async () => {
  let syncCalls = 0;
  await assert.rejects(() => executeHubSpotSyncTick({
    enabled: () => true,
    workerId,
    rpc: async <T>() => ({
      accepted: true,
      reason_code: 'claimed',
      items: [claimItem({ email: 'invalid' })],
    }) as T,
    sync: async () => {
      syncCalls += 1;
      return { contactIds: new Map(), companyIds: new Map(), failures: [] };
    },
  }), /contract is invalid/);
  assert.equal(syncCalls, 0);
});

test('worker bearer authentication is constant-shape and fails closed', () => {
  const previous = process.env.HUBSPOT_WORKER_SECRET;
  process.env.HUBSPOT_WORKER_SECRET = 'w'.repeat(32);
  try {
    assert.equal(authorizeHubSpotWorkerRequest(new Request('https://internal.invalid', {
      headers: { Authorization: `Bearer ${'w'.repeat(32)}` },
    })), true);
    assert.equal(authorizeHubSpotWorkerRequest(new Request('https://internal.invalid', {
      headers: { Authorization: 'Bearer wrong' },
    })), false);
  } finally {
    if (previous === undefined) delete process.env.HUBSPOT_WORKER_SECRET;
    else process.env.HUBSPOT_WORKER_SECRET = previous;
  }
});
