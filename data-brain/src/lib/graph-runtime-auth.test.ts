import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { authorizeGraphInternalRequest } from './graph-runtime';

test('internal Graph machine routes accept only the dedicated Bearer secret', () => {
  const before = process.env.GRAPH_WORKER_SECRET;
  process.env.GRAPH_WORKER_SECRET = 'g'.repeat(32);
  try {
    assert.equal(authorizeGraphInternalRequest(new Request('http://localhost', {
      headers: { Authorization: `Bearer ${'g'.repeat(32)}` },
    })), true);
    assert.equal(authorizeGraphInternalRequest(new Request('http://localhost', {
      headers: { Authorization: `Basic ${Buffer.from('admin:legacy-password').toString('base64')}` },
    })), false);
    assert.equal(authorizeGraphInternalRequest(new Request('http://localhost')), false);
  } finally {
    if (before === undefined) delete process.env.GRAPH_WORKER_SECRET;
    else process.env.GRAPH_WORKER_SECRET = before;
  }
});
test('proxy bypasses dashboard auth only for exact machine paths while handlers retain Bearer auth', () => {
  const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  for (const path of [
    '/api/internal/graph/transactional', '/api/internal/graph/dispatch',
    '/api/internal/graph/campaign-dispatch', '/api/internal/inbound/mailbox',
    '/api/internal/observability',
  ]) assert.ok(proxy.includes(`'${path}'`), `missing exact machine path ${path}`);
  assert.match(proxy, /INTERNAL_MACHINE_PATHS\.has\(pathname\)/);
  assert.doesNotMatch(proxy, /pathname\.startsWith\(['"]\/api\/internal/);
  const route = readFileSync(new URL('../app/api/internal/graph/campaign-dispatch/route.ts', import.meta.url), 'utf8');
  assert.match(route, /authorizeGraphWorkerBearerRequest\(request\)/);
  assert.match(route, /content-length/);
});

test('environment example exposes inbound and Calendly gates fail-closed', () => {
  const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.match(example, /^INBOUND_MAILBOX_ENABLED=false$/m);
  assert.match(example, /^INBOUND_MAILBOX_BOOTSTRAP_FROM=""$/m);
  assert.match(example, /^CALENDLY_WEBHOOK_ENABLED=false$/m);
  assert.match(example, /^CALENDLY_WEBHOOK_SIGNING_KEY=""$/m);
  assert.match(example, /^GRAPH_MAILBOX_ADDRESS=""$/m);
});

test('Graph runtime requires a separate mailbox address and never derives it from user id', () => {
  const runtime = readFileSync(new URL('./graph-runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /required\('GRAPH_MAILBOX_ADDRESS'\)/);
  assert.match(runtime, /mailboxAddress,/);
  assert.match(runtime, /expectedMailboxAddress: mailboxAddress/);
  assert.doesNotMatch(runtime, /mailboxUserId\.includes\('@'\)/);
  assert.match(
    runtime,
    /executeConfiguredTransactionalGraphJob[\s\S]+if \(!enabled\(\)\)[\s\S]+const tenantId = required/,
  );
});

test('private Graph routes expose alert delivery separately from alert attempt', () => {
  for (const relative of [
    '../app/api/internal/graph/transactional/route.ts',
    '../app/api/internal/graph/dispatch/route.ts',
    '../app/api/internal/graph/campaign-dispatch/route.ts',
  ]) {
    const route = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.match(route, /alert_attempted/);
    assert.match(route, /alert_delivered/);
  }
});
