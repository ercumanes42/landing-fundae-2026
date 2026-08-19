import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { executeGraphDispatchOnce } from './graph-dispatch';
import { GraphOutboxRepository, type GraphRpc } from './graph-outbox-repository';
import type { GraphDraftPayload } from './graph-secure-client';
import { executeTransactionalGraphJob } from './graph-worker';
import type { TransactionalDeliveryPackage } from './transactional-delivery-package';

const dispatchId = '123e4567-e89b-42d3-a456-426614174001';
const workerId = '123e4567-e89b-42d3-a456-426614174002';
const reservationId = '123e4567-e89b-42d3-a456-426614174003';
const packageValue: TransactionalDeliveryPackage = {
  packaged: true, reasonCode: 'packaged', resource: 'calculator', templateId: 'template',
  recipient: { email: 'pilot@example.com' }, subject: 'Subject', body: '<p>Body</p>',
  contentType: 'html', attachments: [], packageHmacSha256: 'a'.repeat(64),
};

test('durable dispatch master OFF performs zero RPC, package and worker calls', async () => {
  let rpcCalls = 0;
  let packageCalls = 0;
  let workerCalls = 0;
  const repository = new GraphOutboxRepository((async () => { rpcCalls += 1; return {}; }) as GraphRpc);
  const result = await executeGraphDispatchOnce({
    repository, enabled: () => false, workerId, mailboxKeyHash: 'b'.repeat(64),
    capabilitySecret: 's'.repeat(32),
    alert: async () => undefined,
    buildPackageBySubmission: async () => { packageCalls += 1; return packageValue; },
    executeReserved: async () => { workerCalls += 1; throw new Error('must not run'); },
  });
  assert.equal(result.state, 'off');
  assert.deepEqual({ rpcCalls, packageCalls, workerCalls }, { rpcCalls: 0, packageCalls: 0, workerCalls: 0 });
});

test('durable dispatch uses exact claim-reserve-finalize shapes and package-by-submission', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const repository = new GraphOutboxRepository((async <T>(name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'claim_transactional_graph_dispatch') return {
      accepted: true, reason_code: 'claimed', lease_expires_at: '2099-01-01T00:00:00Z',
      reservation_id: null, outbox_state: null,
      recovery_required: false, resume_existing_reservation: false,
      items: [{
        dispatch_id: dispatchId, submission_id: 'submission-1', resource: 'calculator',
        payload_sha256: 'c'.repeat(64), attempt: 1, reservation_id: null,
        outbox_state: null, recovery_required: false, resume_existing_reservation: false,
        graph_draft_immutable_id: null, draft_neutralized: false,
        outcome_evidence_hash: null,
      }],
    } as T;
    if (name === 'reserve_claimed_transactional_graph_dispatch') return {
      authorized: true, duplicate: false, reason_code: 'reserved', reservation_id: reservationId,
      lease_expires_at: '2099-01-01T00:00:00Z',
    } as T;
    if (name === 'finalize_transactional_graph_dispatch') return {
      accepted: true, duplicate: false, reason_code: 'confirmed_sent',
    } as T;
    throw new Error(name);
  }) as GraphRpc);
  let packageInput: unknown;
  const result = await executeGraphDispatchOnce({
    repository, enabled: () => true, workerId, mailboxKeyHash: 'b'.repeat(64),
    capabilitySecret: 's'.repeat(32),
    alert: async () => undefined,
    buildPackageBySubmission: async (input) => { packageInput = input; return packageValue; },
    executeReserved: async (job) => {
      assert.equal(job.capability_context, dispatchId);
      return {
        state: 'confirmed_sent', reasonCode: 'confirmed_sent', reservationId,
        duplicate: false, alertAttempted: false, evidenceHash: 'd'.repeat(64),
      };
    },
  });
  assert.equal(result.state, 'confirmed_sent');
  assert.deepEqual(packageInput, {
    submission_id: 'submission-1', expected_resource: 'calculator',
    package_capability: (packageInput as { package_capability: string }).package_capability,
  });
  assert.match((packageInput as { package_capability: string }).package_capability, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(calls.map((call) => call.name), [
    'claim_transactional_graph_dispatch',
    'reserve_claimed_transactional_graph_dispatch',
    'finalize_transactional_graph_dispatch',
  ]);
  assert.equal(calls[0].args.p_limit, 1);
  assert.match(String(calls[1].args.p_opaque_marker), /^[a-f0-9]{64}$/);
  assert.equal(calls[2].args.p_evidence_hash, 'd'.repeat(64));
});

test('dispatch wrapper alerts fail-closed when terminal finalization is rejected', async () => {
  const repository = new GraphOutboxRepository((async <T>(name: string) => {
    if (name === 'claim_transactional_graph_dispatch') return {
      accepted: true, reason_code: 'claimed', lease_expires_at: '2099-01-01T00:00:00Z',
      reservation_id: null, outbox_state: null, recovery_required: false,
      resume_existing_reservation: false,
      items: [{
        dispatch_id: dispatchId, submission_id: 'submission-1', resource: 'calculator',
        payload_sha256: 'c'.repeat(64), attempt: 1, reservation_id: null,
        outbox_state: null, recovery_required: false, resume_existing_reservation: false,
        graph_draft_immutable_id: null, draft_neutralized: false, outcome_evidence_hash: null,
      }],
    } as T;
    if (name === 'reserve_claimed_transactional_graph_dispatch') return {
      authorized: true, duplicate: false, reason_code: 'reserved', reservation_id: reservationId,
      lease_expires_at: '2099-01-01T00:00:00Z',
    } as T;
    if (name === 'finalize_transactional_graph_dispatch') return {
      accepted: false, duplicate: false, reason_code: 'finalize_rejected',
    } as T;
    throw new Error(name);
  }) as GraphRpc);
  let alertCode = '';
  const result = await executeGraphDispatchOnce({
    repository, enabled: () => true, workerId, mailboxKeyHash: 'b'.repeat(64),
    capabilitySecret: 's'.repeat(32),
    alert: async (event) => { alertCode = event.code; throw new Error('alert unavailable'); },
    buildPackageBySubmission: async () => packageValue,
    executeReserved: async () => ({
      state: 'confirmed_sent', reasonCode: 'confirmed_sent', reservationId,
      duplicate: false, alertAttempted: false, evidenceHash: 'd'.repeat(64),
    }),
  });
  assert.equal(result.state, 'ambiguous_halted');
  assert.equal(result.reasonCode, 'dispatch_finalize_rejected');
  assert.equal(result.alertAttempted, true);
  assert.equal(result.alertDelivered, false);
  assert.equal(alertCode, 'AMBIGUOUS_DISPATCH_FINALIZE_REJECTED');
});

function workerRepository(authorizeReason: 'send_cadence' | 'draft_neutralization_required') {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const repository = new GraphOutboxRepository((async <T>(name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const common = { duplicate: false, reason_code: name, reservation_id: reservationId };
    if (name === 'register_transactional_graph_outbox') return { ...common, authorized: true, reason_code: 'reserved' } as T;
    if (name === 'begin_graph_draft_creation' || name === 'bind_graph_draft_immutable_id') return { ...common, accepted: true } as T;
    if (name === 'authorize_graph_draft_send') return {
      ...common, authorized: false, reason_code: authorizeReason, retry_after_seconds: 37,
    } as T;
    if (name === 'confirm_graph_draft_neutralized') return {
      ...common, accepted: true, reason_code: 'draft_neutralized',
    } as T;
    if (name === 'finalize_graph_delivery_failure') return {
      ...common, accepted: true, reason_code: 'ambiguous_halted',
    } as T;
    throw new Error(name);
  }) as GraphRpc);
  return { repository, calls };
}

async function runAuthorizeFault(reason: 'send_cadence' | 'draft_neutralization_required') {
  const { repository, calls } = workerRepository(reason);
  let draft: GraphDraftPayload | null = null;
  let deleteCalls = 0;
  let sendCalls = 0;
  const result = await executeTransactionalGraphJob({
    reservation_id: reservationId, finalize_capability: 'f'.repeat(43),
    intake_capability: 'i'.repeat(43), expected_resource: 'calculator',
    payload_sha256: 'c'.repeat(64), package_hmac_sha256: packageValue.packageHmacSha256,
    lease_expires_at: '2099-01-01T00:00:00Z',
  }, {
    repository,
    enabled: () => true,
    capabilitySecret: 's'.repeat(32),
    buildPackage: async () => packageValue,
    sleep: async () => undefined,
    alert: async () => undefined,
    client: {
      createDraft: async (value) => {
        draft = value;
        return { id: 'DraftId', changeKey: 'Change1', isDraft: true, parentFolderId: 'Drafts', internetMessageId: null, sentDateTime: null };
      },
      getDraftIntegrity: async () => ({
        id: 'DraftId', changeKey: 'Change1', isDraft: true, parentFolderId: 'Drafts',
        internetMessageId: null, sentDateTime: null, subject: draft!.subject,
        htmlBody: draft!.htmlBody, recipients: [draft!.recipient], marker: draft!.marker, attachments: [],
      }),
      deleteDraft: async () => { deleteCalls += 1; },
      getMessage: async () => null,
      sendDraft: async () => { sendCalls += 1; },
      findByMarker: async () => [],
      getSentItemsFolderId: async () => 'Sent',
    },
  });
  return { result, calls, deleteCalls, sendCalls };
}

test('fresh cadence response defers the same bound draft without delete or send', async () => {
  const value = await runAuthorizeFault('send_cadence');
  assert.equal(value.result.state, 'deferred');
  assert.equal(value.result.retryAfterSeconds, 37);
  assert.deepEqual({ deleteCalls: value.deleteCalls, sendCalls: value.sendCalls }, { deleteCalls: 0, sendCalls: 0 });
});

test('neutralization is verified and persisted before reporting suppressed_before_send', async () => {
  const value = await runAuthorizeFault('draft_neutralization_required');
  assert.equal(value.result.state, 'suppressed_before_send');
  assert.deepEqual({ deleteCalls: value.deleteCalls, sendCalls: value.sendCalls }, { deleteCalls: 1, sendCalls: 0 });
  const confirmation = value.calls.find((call) => call.name === 'confirm_graph_draft_neutralized');
  assert.match(String(confirmation?.args.p_neutralization_evidence_hash), /^[a-f0-9]{64}$/);
});

test('lease-expired post-reserve recovery never reserves or creates a draft and halts closed', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const repository = new GraphOutboxRepository((async <T>(name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'claim_transactional_graph_dispatch') return {
      accepted: true, reason_code: 'reserved_recovery',
      lease_expires_at: '2099-01-01T00:00:00Z', reservation_id: reservationId,
      outbox_state: 'reserved', recovery_required: true, resume_existing_reservation: true,
      items: [{
        dispatch_id: dispatchId, submission_id: 'submission-1', resource: 'calculator',
        payload_sha256: 'c'.repeat(64), attempt: 2, reservation_id: reservationId,
        outbox_state: 'reserved', recovery_required: true, resume_existing_reservation: true,
        lease_expires_at: '2099-01-01T00:00:00Z',
        graph_draft_immutable_id: null, draft_neutralized: false,
        outcome_evidence_hash: null,
      }],
    } as T;
    if (name === 'register_transactional_graph_outbox') return {
      authorized: true, duplicate: true, reason_code: 'reserved', reservation_id: reservationId,
    } as T;
    if (name === 'finalize_graph_delivery_failure') return {
      accepted: true, duplicate: false, reason_code: 'ambiguous_halted',
      reservation_id: reservationId,
    } as T;
    if (name === 'finalize_transactional_graph_dispatch') return {
      accepted: true, duplicate: false, reason_code: 'ambiguous_halted',
    } as T;
    throw new Error(`unexpected RPC ${name}`);
  }) as GraphRpc);
  let createCalls = 0;
  let sendCalls = 0;
  const result = await executeGraphDispatchOnce({
    repository, enabled: () => true, workerId, mailboxKeyHash: 'b'.repeat(64),
    capabilitySecret: 's'.repeat(32),
    alert: async () => undefined,
    buildPackageBySubmission: async () => packageValue,
    executeReserved: async (job, deliveryPackage) => executeTransactionalGraphJob(job, {
      repository,
      enabled: () => true,
      capabilitySecret: 's'.repeat(32),
      buildPackage: async () => deliveryPackage,
      sleep: async () => undefined,
      alert: async () => undefined,
      client: {
        createDraft: async () => { createCalls += 1; throw new Error('must not create'); },
        sendDraft: async () => { sendCalls += 1; },
        findByMarker: async () => [],
        getMessage: async () => null,
        getDraftIntegrity: async () => null,
        deleteDraft: async () => undefined,
        getSentItemsFolderId: async () => 'Sent',
      },
    }),
  });
  assert.equal(result.state, 'ambiguous_halted');
  assert.deepEqual({ createCalls, sendCalls }, { createCalls: 0, sendCalls: 0 });
  assert.equal(calls.some((call) => call.name === 'reserve_claimed_transactional_graph_dispatch'), false);
  assert.equal(calls.some((call) => call.name === 'begin_graph_draft_creation'), false);
  assert.deepEqual(calls.map((call) => call.name), [
    'claim_transactional_graph_dispatch',
    'register_transactional_graph_outbox',
    'finalize_graph_delivery_failure',
    'finalize_transactional_graph_dispatch',
  ]);
});

test('dispatch finalizes a verified neutralization with literal suppressed_before_send', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const repository = new GraphOutboxRepository((async <T>(name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'claim_transactional_graph_dispatch') return {
      accepted: true, reason_code: 'claimed', lease_expires_at: '2099-01-01T00:00:00Z',
      reservation_id: null, outbox_state: null,
      recovery_required: false, resume_existing_reservation: false,
      items: [{
        dispatch_id: dispatchId, submission_id: 'submission-1', resource: 'calculator',
        payload_sha256: 'c'.repeat(64), attempt: 1, reservation_id: null,
        outbox_state: null, recovery_required: false, resume_existing_reservation: false,
        graph_draft_immutable_id: null, draft_neutralized: false,
        outcome_evidence_hash: null,
      }],
    } as T;
    if (name === 'reserve_claimed_transactional_graph_dispatch') return {
      authorized: true, duplicate: false, reason_code: 'reserved',
      reservation_id: reservationId, lease_expires_at: '2099-01-01T00:00:00Z',
    } as T;
    if (name === 'finalize_transactional_graph_dispatch') return {
      accepted: true, duplicate: false, reason_code: 'suppressed_before_send',
    } as T;
    throw new Error(name);
  }) as GraphRpc);
  const evidenceHash = 'e'.repeat(64);
  const result = await executeGraphDispatchOnce({
    repository, enabled: () => true, workerId, mailboxKeyHash: 'b'.repeat(64),
    capabilitySecret: 's'.repeat(32),
    alert: async () => undefined,
    buildPackageBySubmission: async () => packageValue,
    executeReserved: async () => ({
      state: 'suppressed_before_send', reasonCode: 'draft_neutralized',
      reservationId, duplicate: false, alertAttempted: false, evidenceHash,
    }),
  });
  assert.equal(result.state, 'suppressed_before_send');
  const finalized = calls.find((call) => call.name === 'finalize_transactional_graph_dispatch');
  assert.equal(finalized?.args.p_outcome, 'suppressed_before_send');
  assert.equal(finalized?.args.p_evidence_hash, evidenceHash);
});

test('suppressed recovery neutralizes the existing draft and finalizes with original terminal evidence', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const outcomeEvidenceHash = 'e'.repeat(64);
  const repository = new GraphOutboxRepository((async <T>(name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'claim_transactional_graph_dispatch') return {
      accepted: true, reason_code: 'reserved_recovery',
      lease_expires_at: '2099-01-01T00:00:00Z', reservation_id: reservationId,
      outbox_state: 'suppressed_before_send', recovery_required: true,
      resume_existing_reservation: true,
      items: [{
        dispatch_id: dispatchId, submission_id: 'submission-1', resource: 'calculator',
        payload_sha256: 'c'.repeat(64), attempt: 2, reservation_id: reservationId,
        outbox_state: 'suppressed_before_send', recovery_required: true,
        resume_existing_reservation: true, lease_expires_at: '2099-01-01T00:00:00Z',
        graph_draft_immutable_id: 'DraftId', draft_neutralized: false,
        outcome_evidence_hash: outcomeEvidenceHash,
      }],
    } as T;
    if (name === 'register_transactional_graph_outbox') return {
      authorized: true, duplicate: true, reason_code: 'suppressed_before_send',
      reservation_id: reservationId,
    } as T;
    if (name === 'confirm_graph_draft_neutralized') return {
      accepted: true, duplicate: false, reason_code: 'draft_neutralized',
      reservation_id: reservationId,
    } as T;
    if (name === 'finalize_transactional_graph_dispatch') return {
      accepted: true, duplicate: false, reason_code: 'suppressed_before_send',
    } as T;
    throw new Error(`unexpected RPC ${name}`);
  }) as GraphRpc);
  let createCalls = 0;
  let deleteCalls = 0;
  let sendCalls = 0;
  const result = await executeGraphDispatchOnce({
    repository, enabled: () => true, workerId, mailboxKeyHash: 'b'.repeat(64),
    capabilitySecret: 's'.repeat(32),
    alert: async () => undefined,
    buildPackageBySubmission: async () => packageValue,
    executeReserved: async (job, deliveryPackage) => executeTransactionalGraphJob(job, {
      repository,
      enabled: () => true,
      capabilitySecret: 's'.repeat(32),
      buildPackage: async () => deliveryPackage,
      sleep: async () => undefined,
      alert: async () => undefined,
      client: {
        createDraft: async () => { createCalls += 1; throw new Error('must not create'); },
        sendDraft: async () => { sendCalls += 1; },
        findByMarker: async () => [{
          id: 'DraftId', changeKey: 'Change1', isDraft: true,
          parentFolderId: 'Drafts', internetMessageId: null, sentDateTime: null,
        }],
        getMessage: async () => null,
        getDraftIntegrity: async () => null,
        deleteDraft: async () => { deleteCalls += 1; },
        getSentItemsFolderId: async () => 'Sent',
      },
    }),
  });
  assert.equal(result.state, 'suppressed_before_send');
  assert.deepEqual({ createCalls, deleteCalls, sendCalls }, {
    createCalls: 0, deleteCalls: 1, sendCalls: 0,
  });
  assert.equal(calls.some((call) => call.name === 'reserve_claimed_transactional_graph_dispatch'), false);
  const finalized = calls.find((call) => call.name === 'finalize_transactional_graph_dispatch');
  assert.equal(finalized?.args.p_outcome, 'suppressed_before_send');
  assert.equal(finalized?.args.p_evidence_hash, outcomeEvidenceHash);
});

test('terminal_recovered claim performs no package, reserve, worker, Graph or finalize work', async () => {
  const calls: string[] = [];
  const repository = new GraphOutboxRepository((async <T>(name: string) => {
    calls.push(name);
    if (name === 'claim_transactional_graph_dispatch') return {
      accepted: true, reason_code: 'terminal_recovered', claimed: 0,
      recovery_required: false, resume_existing_reservation: false,
      reservation_id: reservationId, outbox_state: 'confirmed_sent',
      lease_expires_at: null, outcome: 'confirmed_sent',
      dispatch_outcome: 'confirmed_sent', outcome_evidence_hash: 'f'.repeat(64),
      items: [],
    } as T;
    throw new Error(name);
  }) as GraphRpc);
  let packageCalls = 0;
  let workerCalls = 0;
  const result = await executeGraphDispatchOnce({
    repository, enabled: () => true, workerId, mailboxKeyHash: 'b'.repeat(64),
    capabilitySecret: 's'.repeat(32),
    alert: async () => undefined,
    buildPackageBySubmission: async () => { packageCalls += 1; return packageValue; },
    executeReserved: async () => {
      workerCalls += 1;
      throw new Error('must not run');
    },
  });
  assert.equal(result.state, 'empty');
  assert.equal(result.reasonCode, 'terminal_recovered');
  assert.deepEqual({ calls, packageCalls, workerCalls }, {
    calls: ['claim_transactional_graph_dispatch'], packageCalls: 0, workerCalls: 0,
  });
});

test('SQL final contract guards legacy terminal writes and refreshes cadence under lock', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20260818083632_graph_outbox_foundation.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /old\.graph_managed or new\.graph_managed/);
  assert.match(sql, /revoke execute on function public\.finalize_transactional_mailbox_delivery_legacy_20260818/);
  assert.match(sql, /v_now := pg_catalog\.clock_timestamp\(\);[\s\S]*last_graph_send_authorized_at/);
  assert.match(sql, /reason_code', 'send_cadence',[\s\S]*retry_after_seconds/);
  assert.match(sql, /confirm_graph_draft_neutralized/);
});
