import { env } from '../src/lib/env';
import {
  buildTransactionalGraphPilotGrantRequest,
  TransactionalGraphPilotError,
} from '../src/lib/transactional-graph-pilot';
import {
  readTransactionalPilotInput,
  TransactionalPilotProvisionError,
} from '../src/lib/transactional-pilot-provision';

const HASH = /^[a-f0-9]{64}$/;

function expectedLeadId(): string {
  const values = env('TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (values.length !== 1 || !HASH.test(values[0])) {
    throw new TransactionalGraphPilotError('pilot_identity_invalid');
  }
  return values[0];
}

if (process.argv.length !== 2) {
  process.stdout.write(JSON.stringify({
    status: 'blocked',
    reason_code: 'arguments_invalid',
  }) + '\n');
  process.exit(1);
}

try {
  const raw = await readTransactionalPilotInput(
    process.stdin,
    { maxBytes: 16_384, timeoutMs: 15_000 },
  );
  const result = buildTransactionalGraphPilotGrantRequest(JSON.parse(raw), {
    expectedLeadIdHash: expectedLeadId(),
    capabilitySecret: env('GRAPH_WORKER_SECRET'),
    ttlSeconds: Number(env('TRANSACTIONAL_GRAPH_PILOT_TTL_SECONDS')),
  });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  const reasonCode = error instanceof TransactionalGraphPilotError
    ? error.reasonCode
    : error instanceof TransactionalPilotProvisionError
      ? error.reasonCode
      : error instanceof SyntaxError
        ? 'pilot_input_invalid'
        : 'pilot_grant_request_unavailable';
  process.stdout.write(JSON.stringify({ status: 'blocked', reason_code: reasonCode }) + '\n');
  process.exitCode = 1;
}
