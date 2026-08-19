import type { TransactionalGraphPilotControlResult } from './transactional-graph-pilot';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const OPAQUE = /^[^\u0000-\u001f\u007f]+$/;

export interface TransactionalGraphPilotRuntimePreflight {
  ok: boolean;
  reasonCode: 'pilot_runtime_ready' | 'pilot_live_preflight_failed' | 'pilot_rpc_timeout_invalid';
  rpcTimeoutMs: number;
}

type EnvReader = (key: string) => string;

function boundedInteger(read: EnvReader, key: string, minimum: number, maximum: number): number | null {
  const value = Number(read(key));
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function exact(read: EnvReader, key: string, expected: string): boolean {
  return read(key) === expected;
}

function strongSecret(read: EnvReader, key: string, minimum: number): boolean {
  const value = read(key);
  return value === value.trim() && Buffer.byteLength(value, 'utf8') >= minimum;
}

export function validateTransactionalGraphPilotRuntimePreflight(input: {
  live: boolean;
  read: EnvReader;
}): TransactionalGraphPilotRuntimePreflight {
  const requestTimeoutMs = boundedInteger(input.read, 'GRAPH_REQUEST_TIMEOUT_MS', 250, 60_000);
  if (requestTimeoutMs === null) {
    return { ok: false, reasonCode: 'pilot_rpc_timeout_invalid', rpcTimeoutMs: 0 };
  }
  if (!input.live) {
    return { ok: true, reasonCode: 'pilot_runtime_ready', rpcTimeoutMs: requestTimeoutMs };
  }

  const supabaseUrl = input.read('SUPABASE_URL');
  let secureSupabaseUrl = false;
  try {
    const parsed = new URL(supabaseUrl);
    secureSupabaseUrl = parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    secureSupabaseUrl = false;
  }

  const graphMailboxUserId = input.read('GRAPH_MAILBOX_USER_ID');
  const valid =
    exact(input.read, 'TRANSACTIONAL_GRAPH_PILOT_LIVE_ENABLED', 'true') &&
    exact(input.read, 'TRANSACTIONAL_PILOT_MODE', 'true') &&
    exact(input.read, 'OUTBOUND_MASTER_ENABLED', 'true') &&
    exact(input.read, 'TRANSACTIONAL_OUTLOOK_ENABLED', 'true') &&
    exact(input.read, 'COLD_CAMPAIGN_ENABLED', 'false') &&
    exact(input.read, 'COLD_CAMPAIGN_PROVISIONING_ENABLED', 'false') &&
    exact(input.read, 'LEGACY_MAKE_DELIVERY_ENABLED', 'false') &&
    exact(input.read, 'LEGACY_DELIVERY_RETRY_ENABLED', 'false') &&
    secureSupabaseUrl &&
    strongSecret(input.read, 'SUPABASE_SERVICE_ROLE_KEY', 16) &&
    UUID.test(input.read('GRAPH_TENANT_ID')) &&
    UUID.test(input.read('GRAPH_CLIENT_ID')) &&
    strongSecret(input.read, 'GRAPH_CLIENT_SECRET', 16) &&
    graphMailboxUserId.length <= 320 && OPAQUE.test(graphMailboxUserId) &&
    EMAIL.test(input.read('GRAPH_MAILBOX_ADDRESS')) &&
    strongSecret(input.read, 'GRAPH_WORKER_SECRET', 32) &&
    UUID.test(input.read('GRAPH_DISPATCH_WORKER_ID')) &&
    strongSecret(input.read, 'GRAPH_OUTBOX_CAPABILITY_SECRET', 32) &&
    HASH.test(input.read('MAILBOX_IDENTITY_HASH')) &&
    boundedInteger(input.read, 'GRAPH_READ_MAX_ATTEMPTS', 1, 8) !== null &&
    boundedInteger(input.read, 'GRAPH_MAX_RETRY_DELAY_MS', 0, 900_000) !== null &&
    boundedInteger(input.read, 'GRAPH_MARKER_POLL_ATTEMPTS', 1, 10) !== null &&
    boundedInteger(input.read, 'GRAPH_SENT_POLL_ATTEMPTS', 1, 30) !== null &&
    boundedInteger(input.read, 'GRAPH_POLL_INTERVAL_MS', 0, 60_000) !== null &&
    boundedInteger(input.read, 'TRANSACTIONAL_GRAPH_PILOT_TTL_SECONDS', 120, 900) !== null;

  return valid
    ? { ok: true, reasonCode: 'pilot_runtime_ready', rpcTimeoutMs: requestTimeoutMs }
    : { ok: false, reasonCode: 'pilot_live_preflight_failed', rpcTimeoutMs: requestTimeoutMs };
}

export async function attemptTransactionalGraphPilotSignalHalt(input: {
  live: boolean;
  actorHash: string;
  emergencyHalt: () => Promise<TransactionalGraphPilotControlResult>;
}): Promise<boolean> {
  if (!input.live || !HASH.test(input.actorHash)) return false;
  try {
    const result = await input.emergencyHalt();
    return result.accepted && result.outboundOff;
  } catch {
    return false;
  }
}
