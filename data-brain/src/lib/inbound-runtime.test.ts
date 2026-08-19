import assert from 'node:assert/strict';
import test from 'node:test';

import type { GraphInboundMessage } from './graph-secure-client';
import type { InboundRepository } from './inbound-reliability';
import { executeConfiguredInboundMailboxTick } from './inbound-runtime';

const message: GraphInboundMessage = {
  id: 'message-1',
  conversationId: null,
  internetMessageId: null,
  receivedDateTime: '2026-08-19T20:00:00.000Z',
  subject: 'Reply',
  bodyPreview: 'Hello',
  uniqueBody: 'Hello',
  internetMessageHeaders: [],
};

function busyRepository(duplicate: boolean): InboundRepository {
  return {
    claim: async () => ({
      accepted: false,
      duplicate,
      busy: !duplicate,
      claimToken: null,
      status: duplicate ? 'processed' : 'processing',
    }),
    finalize: async () => undefined,
    correlate: async () => [],
    correlateExternal: async () => [],
  };
}

test('busy Graph event defers the page and never advances the delta cursor', async () => {
  let advances = 0;
  const result = await executeConfiguredInboundMailboxTick({
    enabled: () => true,
    client: { listInboxDelta: async () => ({ messages: [message], nextLink: null, deltaLink: 'delta-next' }) },
    repository: busyRepository(false),
    loadCursor: async () => ({ cursor_value: 'delta-current', cursor_hash: 'a'.repeat(64) }),
    advanceCursor: async () => { advances += 1; },
  });
  assert.equal(result.state, 'deferred');
  assert.equal(result.busy, 1);
  assert.equal(advances, 0);
});

test('terminal duplicate remains replay-safe and advances the delta cursor once', async () => {
  let advances = 0;
  const result = await executeConfiguredInboundMailboxTick({
    enabled: () => true,
    client: { listInboxDelta: async () => ({ messages: [message], nextLink: null, deltaLink: 'delta-next' }) },
    repository: busyRepository(true),
    loadCursor: async () => ({ cursor_value: 'delta-current', cursor_hash: 'a'.repeat(64) }),
    advanceCursor: async () => { advances += 1; },
  });
  assert.equal(result.state, 'caught_up');
  assert.equal(result.duplicates, 1);
  assert.equal(advances, 1);
});
