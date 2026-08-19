import assert from 'node:assert/strict';
import test from 'node:test';

import { createHubSpotDispatchHandler } from './route';

const empty = {
  state: 'empty' as const,
  processed: 0,
  synced: 0,
  retrying: 0,
  deadLettered: 0,
};

test('unauthorized and non-empty requests perform zero worker work', async () => {
  let calls = 0;
  const unauthorized = createHubSpotDispatchHandler({
    authorize: () => false,
    execute: async () => { calls += 1; return empty; },
  });
  assert.equal((await unauthorized(new Request('https://internal.invalid'))).status, 401);
  const invalid = createHubSpotDispatchHandler({
    authorize: () => true,
    execute: async () => { calls += 1; return empty; },
  });
  assert.equal((await invalid(new Request('https://internal.invalid', {
    method: 'POST',
    body: '{}',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '2' },
  }))).status, 400);
  assert.equal(calls, 0);
});

test('OFF and retryable states remain explicit and fail closed', async () => {
  const off = createHubSpotDispatchHandler({
    authorize: () => true,
    execute: async () => ({ ...empty, state: 'off' }),
  });
  assert.equal((await off(new Request('https://internal.invalid'))).status, 409);
  const retry = createHubSpotDispatchHandler({
    authorize: () => true,
    execute: async () => ({ ...empty, state: 'retry_wait', processed: 1, retrying: 1 }),
  });
  const response = await retry(new Request('https://internal.invalid'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '30');
});

test('empty and synced ticks return only aggregate non-PII results', async () => {
  const handler = createHubSpotDispatchHandler({
    authorize: () => true,
    execute: async () => ({ ...empty, state: 'synced', processed: 2, synced: 2 }),
  });
  const response = await handler(new Request('https://internal.invalid'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    accepted: true,
    state: 'synced',
    processed: 2,
    synced: 2,
    retrying: 0,
    deadLettered: 0,
  });
});
