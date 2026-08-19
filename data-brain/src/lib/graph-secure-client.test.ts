import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GRAPH_IMMUTABLE_ID_PREFERENCE,
  GraphRequestError,
  SecureMicrosoftGraphClient,
} from './graph-secure-client';

const token = async () => 'x'.repeat(32);

test('Graph draft POST is attempted once on a network timeout', async () => {
  let calls = 0;
  const client = new SecureMicrosoftGraphClient({
    mailboxUserId: 'mailbox@example.com',
    accessToken: token,
    fetchImpl: (async () => { calls += 1; throw new Error('timeout'); }) as typeof fetch,
    requestTimeoutMs: 250,
  });
  await assert.rejects(() => client.createDraft({
    recipient: 'pilot@example.com', subject: 'subject', htmlBody: '<p>body</p>',
    marker: 'a'.repeat(64), attachments: [],
  }), (error: unknown) => error instanceof GraphRequestError && error.ambiguous);
  assert.equal(calls, 1);
});

test('Graph reads honor Retry-After without retrying early', async () => {
  const sleeps: number[] = [];
  const headers: string[] = [];
  let calls = 0;
  const client = new SecureMicrosoftGraphClient({
    mailboxUserId: 'mailbox@example.com', accessToken: token,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    maxRetryDelayMs: 5_000,
    fetchImpl: (async (_url, init) => {
      calls += 1;
      headers.push(new Headers(init?.headers).get('prefer') ?? '');
      return calls === 1
        ? new Response('', { status: 429, headers: { 'Retry-After': '2' } })
        : Response.json({ value: [] });
    }) as typeof fetch,
  });
  assert.deepEqual(await client.findByMarker('b'.repeat(64)), []);
  assert.deepEqual(sleeps, [2_000]);
  assert.deepEqual(headers, [GRAPH_IMMUTABLE_ID_PREFERENCE, GRAPH_IMMUTABLE_ID_PREFERENCE]);
});

test('Graph read defers when Retry-After exceeds the worker budget', async () => {
  let calls = 0;
  const client = new SecureMicrosoftGraphClient({
    mailboxUserId: 'mailbox@example.com', accessToken: token, maxRetryDelayMs: 1_000,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('', { status: 429, headers: { 'Retry-After': '30' } });
    }) as typeof fetch,
  });
  await assert.rejects(() => client.findByMarker('c'.repeat(64)), GraphRequestError);
  assert.equal(calls, 1);
});

test('Graph send POST is never retried and 202 is only submission', async () => {
  let calls = 0;
  let prefer = '';
  const client = new SecureMicrosoftGraphClient({
    mailboxUserId: 'mailbox@example.com', accessToken: token,
    fetchImpl: (async (_url, init) => {
      calls += 1;
      prefer = new Headers(init?.headers).get('prefer') ?? '';
      return new Response('', { status: 202 });
    }) as typeof fetch,
  });
  await client.sendDraft('CaseSensitiveId');
  assert.equal(calls, 1);
  assert.equal(prefer, GRAPH_IMMUTABLE_ID_PREFERENCE);
});

test('Inbox delta is created-only, bounded by explicit bootstrap and keeps immutable IDs', async () => {
  let requestedUrl = '';
  let prefer = '';
  const client = new SecureMicrosoftGraphClient({
    mailboxUserId: 'mailbox@example.com', accessToken: token,
    fetchImpl: (async (url, init) => {
      requestedUrl = String(url);
      prefer = new Headers(init?.headers).get('prefer') ?? '';
      return Response.json({
        value: [{
          id: 'immutable-inbound', conversationId: 'conversation', internetMessageId: '<reply@example.test>',
          receivedDateTime: '2026-08-19T08:00:00Z', subject: 'Re', bodyPreview: 'Reply',
          uniqueBody: { contentType: 'text', content: 'Reply only' },
          internetMessageHeaders: [{ name: 'In-Reply-To', value: '<sent@example.test>' }],
        }],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/users/mailbox%40example.com/mailFolders/inbox/messages/delta?$deltatoken=opaque',
      });
    }) as typeof fetch,
  });
  const page = await client.listInboxDelta(null, '2026-08-19T07:00:00Z');
  assert.equal(page.messages.length, 1);
  assert.match(prefer, /IdType="ImmutableId"/);
  assert.match(prefer, /outlook\.body-content-type="text"/);
  assert.match(requestedUrl, /changeType=created/);
  assert.match(requestedUrl, /receivedDateTime/);
  await assert.rejects(
    () => client.listInboxDelta('https://evil.example/v1.0/users/mailbox/messages/delta'),
    GraphRequestError,
  );
});
