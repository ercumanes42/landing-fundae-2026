import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = path.join(projectRoot, 'scripts', 'run-transactional-graph-pilot.ts');
const source = readFileSync(scriptPath, 'utf8');

test('pilot CLI uses only the scoped Graph RPCs and canonical dispatcher', () => {
  for (const token of [
    'preview_transactional_graph_pilot',
    'start_transactional_graph_pilot',
    'read_transactional_graph_pilot_ledger',
    'finish_transactional_graph_pilot',
    'emergency_halt_outbound_delivery',
    'executeConfiguredGraphDispatchOnce',
    'TRANSACTIONAL_GRAPH_PILOT_LIVE_ENABLED',
    'validateTransactionalGraphPilotRuntimePreflight',
    'attemptTransactionalGraphPilotSignalHalt',
    'rpcOptions',
    "process.once('SIGINT'",
    "process.once('SIGTERM'",
  ]) {
    assert.ok(source.includes(token), `missing CLI contract token: ${token}`);
  }
  assert.doesNotMatch(source, /make\.com|MAKE_API_TOKEN|createAndSendAMessage|MAKE_WEBHOOK_URL/);
  assert.ok(
    source.indexOf('const preflight = validateTransactionalGraphPilotRuntimePreflight') <
      source.indexOf('const raw = await readTransactionalPilotInput'),
    'live preflight must run before stdin and all database work',
  );
  assert.ok(
    (source.match(/}, rpcOptions\)/g) ?? []).length >= 5,
    'all normal pilot RPCs must use the bounded abortable options',
  );
  assert.match(
    source,
    /emergency_halt_outbound_delivery'[\s\S]*Math\.min\(rpcTimeoutMs, 5_000\)/,
  );
});

test('pilot CLI rejects extra arguments before stdin, config, database or Graph work', () => {
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    scriptPath,
    '--live',
    '--extra',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      GRAPH_CLIENT_SECRET: '',
      GRAPH_WORKER_SECRET: '',
      TRANSACTIONAL_GRAPH_PILOT_LIVE_ENABLED: 'false',
    },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'blocked',
    reason_code: 'arguments_invalid',
  });
});
