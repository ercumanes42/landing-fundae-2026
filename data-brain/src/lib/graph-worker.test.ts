import assert from 'node:assert/strict';
import test from 'node:test';

import { GraphOutboxRepository, type GraphRpc } from './graph-outbox-repository';
import type { GraphDraftPayload } from './graph-secure-client';
import { executeTransactionalGraphJob } from './graph-worker';
import type { TransactionalDeliveryPackage } from './transactional-delivery-package';

const reservationId = '123e4567-e89b-42d3-a456-426614174000';
const job = {
  reservation_id: reservationId,
  finalize_capability: 'f'.repeat(43),
  intake_capability: 'i'.repeat(43),
  expected_resource: 'calculator' as const,
  payload_sha256: '1'.repeat(64),
  package_hmac_sha256: '2'.repeat(64),
  lease_expires_at: '2099-01-01T00:00:00.000Z',
};
const deliveryPackage: TransactionalDeliveryPackage = {
  packaged: true, reasonCode: 'packaged', resource: 'calculator', templateId: 'template',
  recipient: { email: 'pilot@example.com' }, subject: 'Subject', body: '<p>Body</p>',
  contentType: 'html', attachments: [], packageHmacSha256: job.package_hmac_sha256,
};

function rpcRepository(
  registerReason = 'reserved',
  calls: string[] = [],
): GraphOutboxRepository {
  const rpc: GraphRpc = async <T>(name: string, args: Record<string, unknown>) => {
    calls.push(name);
    const common = { duplicate: false, reason_code: name, reservation_id: reservationId };
    if (name === 'register_transactional_graph_outbox') return {
      ...common, authorized: true, duplicate: registerReason !== 'reserved', reason_code: registerReason,
    } as T;
    if (name === 'begin_graph_draft_creation') return { ...common, accepted: true } as T;
    if (name === 'bind_graph_draft_immutable_id') return { ...common, accepted: true, reason_code: 'draft_created' } as T;
    if (name === 'authorize_graph_draft_send') return {
      ...common, authorized: true, reason_code: 'send_submitted', graph_draft_immutable_id: 'DraftId',
    } as T;
    if (name === 'confirm_graph_sent_item') return { ...common, accepted: true, reason_code: 'confirmed_sent' } as T;
    if (name === 'finalize_graph_delivery_failure') return {
      ...common, accepted: true, reason_code: args.p_outcome,
    } as T;
    throw new Error(`unexpected RPC ${name}`);
  };
  return new GraphOutboxRepository(rpc);
}

function client(options: {
  createThrows?: boolean;
  sendThrows?: boolean;
  markerMatches?: 0 | 1 | 2;
  sentSequence?: Array<'missing' | 'draft' | 'sent'>;
  draftIdentity?: {
    from?: string | null;
    sender?: string | null;
    replyTo?: string[] | null;
  };
} = {}) {
  let payload: GraphDraftPayload | null = null;
  let createCalls = 0;
  let sendCalls = 0;
  let deleteCalls = 0;
  const sentSequence = [...(options.sentSequence ?? ['sent'])];
  return {
    stats: () => ({ createCalls, sendCalls, deleteCalls }),
    api: {
      createDraft: async (value: typeof payload) => {
        createCalls += 1; payload = value;
        if (options.createThrows) throw new Error('timeout');
        return { id: 'DraftId', changeKey: 'Change1', isDraft: true, parentFolderId: 'Drafts', internetMessageId: null, sentDateTime: null };
      },
      sendDraft: async () => { sendCalls += 1; if (options.sendThrows) throw new Error('timeout'); },
      findByMarker: async (marker: string) => {
        payload ??= {
          recipient: deliveryPackage.recipient.email,
          subject: deliveryPackage.subject,
          htmlBody: deliveryPackage.body,
          marker,
          attachments: [],
        };
        return Array.from({ length: options.markerMatches ?? 1 }, () => ({
          id: 'DraftId', changeKey: 'Change1', isDraft: true, parentFolderId: 'Drafts',
          internetMessageId: null, sentDateTime: null, marker,
        }));
      },
      getDraftIntegrity: async () => payload ? ({
        id: 'DraftId', changeKey: 'Change1', isDraft: true, parentFolderId: 'Drafts',
        internetMessageId: null, sentDateTime: null, subject: payload.subject,
        htmlBody: payload.htmlBody, recipients: [payload.recipient], marker: payload.marker, attachments: [],
        ...(options.draftIdentity ?? {}),
      }) : ({
        id: 'DraftId', changeKey: 'Change1', isDraft: true, parentFolderId: 'Drafts',
        internetMessageId: null, sentDateTime: null, subject: deliveryPackage.subject,
        htmlBody: deliveryPackage.body, recipients: [deliveryPackage.recipient.email], marker: '', attachments: [],
      }),
      getSentItemsFolderId: async () => 'SentFolder',
      getMessage: async () => {
        const state = sentSequence.shift() ?? 'sent';
        if (state === 'missing') return null;
        return state === 'draft'
          ? { id: 'DraftId', changeKey: 'Change1', isDraft: true, parentFolderId: 'Drafts', internetMessageId: null, sentDateTime: null }
          : { id: 'DraftId', changeKey: 'Change2', isDraft: false, parentFolderId: 'SentFolder', internetMessageId: '<id@example>', sentDateTime: '2026-08-18T10:00:00Z' };
      },
      deleteDraft: async () => { deleteCalls += 1; },
    },
  };
}

function deps(
  repository: GraphOutboxRepository,
  graphClient: ReturnType<typeof client>,
  enabled = () => true,
  options: {
    expectedMailboxAddress?: string;
    alert?: () => Promise<void>;
  } = {},
) {
  return {
    repository, client: graphClient.api, enabled, capabilitySecret: 's'.repeat(32),
    buildPackage: async () => deliveryPackage, sleep: async () => undefined,
    pollIntervalMs: 0, markerPollAttempts: 2, sentPollAttempts: 4,
    expectedMailboxAddress: options.expectedMailboxAddress,
    alert: options.alert ?? (async () => undefined),
  };
}

test('master OFF performs zero RPC and zero Graph calls', async () => {
  const rpcCalls: string[] = [];
  const graph = client();
  const result = await executeTransactionalGraphJob(job, deps(rpcRepository('reserved', rpcCalls), graph, () => false));
  assert.equal(result.state, 'off');
  assert.deepEqual(rpcCalls, []);
  assert.deepEqual(graph.stats(), { createCalls: 0, sendCalls: 0, deleteCalls: 0 });
});

test('fresh job sends the same draft once and confirms only after eventual Sent Items evidence', async () => {
  const graph = client({
    sentSequence: ['missing', 'draft', 'sent'],
    draftIdentity: {
      from: 'mailbox@example.com', sender: 'mailbox@example.com', replyTo: ['mailbox@example.com'],
    },
  });
  const result = await executeTransactionalGraphJob(job, deps(
    rpcRepository(), graph, () => true, { expectedMailboxAddress: 'mailbox@example.com' },
  ));
  assert.equal(result.state, 'confirmed_sent');
  assert.deepEqual(graph.stats(), { createCalls: 1, sendCalls: 1, deleteCalls: 0 });
});

test('create timeout with zero marker matches halts and never sends', async () => {
  const graph = client({ createThrows: true, markerMatches: 0 });
  const result = await executeTransactionalGraphJob(job, deps(rpcRepository(), graph));
  assert.equal(result.state, 'ambiguous_halted');
  assert.equal(result.alertAttempted, true);
  assert.equal(result.alertDelivered, true);
  assert.equal(graph.stats().sendCalls, 0);
});

test('missing draft mailbox identity halts before send when an expected address is configured', async () => {
  const graph = client();
  const result = await executeTransactionalGraphJob(job, deps(
    rpcRepository(), graph, () => true, { expectedMailboxAddress: 'mailbox@example.com' },
  ));
  assert.equal(result.state, 'ambiguous_halted');
  assert.equal(result.alertAttempted, true);
  assert.equal(graph.stats().sendCalls, 0);
});

test('draft mailbox identity mismatch halts and reports alert delivery failure without leaking it', async () => {
  const alertSecret = 'private-webhook-error-value';
  const graph = client({
    draftIdentity: {
      from: 'unexpected@example.com',
      sender: 'mailbox@example.com',
      replyTo: ['mailbox@example.com'],
    },
  });
  const result = await executeTransactionalGraphJob(job, deps(
    rpcRepository(),
    graph,
    () => true,
    {
      expectedMailboxAddress: 'mailbox@example.com',
      alert: async () => { throw new Error(alertSecret); },
    },
  ));
  assert.equal(result.state, 'ambiguous_halted');
  assert.equal(result.alertAttempted, true);
  assert.equal(result.alertDelivered, false);
  assert.equal(graph.stats().sendCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(alertSecret));
});

test('multiple marker matches halt and never send', async () => {
  const graph = client({ createThrows: true, markerMatches: 2 });
  const result = await executeTransactionalGraphJob(job, deps(rpcRepository(), graph));
  assert.equal(result.state, 'ambiguous_halted');
  assert.equal(graph.stats().sendCalls, 0);
});

test('send timeout is not retried and eventual Sent Items evidence confirms', async () => {
  const graph = client({ sendThrows: true, sentSequence: ['missing', 'sent'] });
  const result = await executeTransactionalGraphJob(job, deps(rpcRepository(), graph));
  assert.equal(result.state, 'confirmed_sent');
  assert.equal(graph.stats().sendCalls, 1);
});

test('draft_created recovery reconciles the existing marker and never creates a second draft', async () => {
  const rpcCalls: string[] = [];
  const graph = client({ sentSequence: ['sent'] });
  const result = await executeTransactionalGraphJob({
    ...job,
    recovery_only: true,
    expected_outbox_state: 'draft_created',
    recovery_draft_immutable_id: 'DraftId',
    recovery_draft_neutralized: false,
    recovery_outcome_evidence_hash: null,
  }, deps(rpcRepository('draft_created', rpcCalls), graph));
  assert.equal(result.state, 'confirmed_sent');
  assert.equal(graph.stats().createCalls, 0);
  assert.equal(graph.stats().sendCalls, 1);
  assert.equal(rpcCalls.includes('begin_graph_draft_creation'), false);
});

test('draft_created recovery halts when marker id differs from persisted ImmutableId', async () => {
  const graph = client();
  const result = await executeTransactionalGraphJob({
    ...job,
    recovery_only: true,
    expected_outbox_state: 'draft_created',
    recovery_draft_immutable_id: 'DifferentDraftId',
    recovery_draft_neutralized: false,
    recovery_outcome_evidence_hash: null,
  }, deps(rpcRepository('draft_created'), graph));
  assert.equal(result.state, 'ambiguous_halted');
  assert.deepEqual(graph.stats(), { createCalls: 0, sendCalls: 0, deleteCalls: 0 });
});

test('stop between draft and authorize neutralizes the exact draft and never sends', async () => {
  const graph = client({ sentSequence: ['missing'] });
  let checks = 0;
  const result = await executeTransactionalGraphJob(job, deps(rpcRepository(), graph, () => ++checks === 1));
  assert.equal(result.state, 'definitive_failed');
  assert.deepEqual(graph.stats(), { createCalls: 1, sendCalls: 0, deleteCalls: 1 });
});
