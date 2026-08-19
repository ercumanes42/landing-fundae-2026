import assert from 'node:assert/strict';
import test from 'node:test';

import { callRpc } from './supabase';

const REQUIRED_ENV = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_ANON_KEY: 'anon-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  LEAD_HASH_SECRET: 'supabase-rpc-test-secret'.padEnd(32, 'q'),
};

async function withRpcEnvironment(run: () => Promise<void>): Promise<void> {
  const previousFetch = globalThis.fetch;
  const previous = Object.fromEntries(
    Object.keys(REQUIRED_ENV).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, REQUIRED_ENV);
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('callRpc aborts a hung request at the configured deadline', () =>
  withRpcEnvironment(async () => {
    let observedAbort = false;
    globalThis.fetch = async (_input, init) => {
      const observedSignal = init?.signal as AbortSignal;
      return await new Promise<Response>((_resolve, reject) => {
        observedSignal.addEventListener('abort', () => {
          observedAbort = observedSignal.aborted;
          reject(observedSignal.reason ?? new Error('aborted'));
        }, { once: true });
      });
    };

    await assert.rejects(
      callRpc('pilot_test', {}, { timeoutMs: 20 }),
      /Supabase RPC timed out|aborted/i,
    );
    assert.equal(observedAbort, true);
  }));

test('callRpc rejects unsafe timeout values before network work', () =>
  withRpcEnvironment(async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return new Response('{}', { status: 200 });
    };
    await assert.rejects(
      callRpc('pilot_test', {}, { timeoutMs: 60_001 }),
      /timeout is invalid/,
    );
    assert.equal(called, false);
  }));
