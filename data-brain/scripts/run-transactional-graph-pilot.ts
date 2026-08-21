import { createHash } from 'node:crypto';

import { env } from '../src/lib/env';
import { executeConfiguredGraphDispatchOnce } from '../src/lib/graph-runtime';
import { callRpc } from '../src/lib/supabase';
import {
  readTransactionalPilotInput,
  TransactionalPilotProvisionError,
} from '../src/lib/transactional-pilot-provision';
import {
  runTransactionalGraphPilot,
  hashTransactionalGraphPilotAuthorizationId,
  TransactionalGraphPilotError,
  type TransactionalGraphPilotControlResult,
  type TransactionalGraphPilotLedgerRow,
} from '../src/lib/transactional-graph-pilot';
import {
  attemptTransactionalGraphPilotSignalHalt,
  validateTransactionalGraphPilotRuntimePreflight,
} from '../src/lib/transactional-graph-pilot-runtime';

type JsonRecord = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RESOURCES = ['calculator', 'interactive_checklist', 'checklist', 'webinar'] as const;

function fail(reasonCode: string): never {
  throw new TransactionalGraphPilotError(reasonCode);
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('pilot_rpc_invalid');
  return value as JsonRecord;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function controlsOff(value: unknown): boolean {
  const controls = record(value);
  return controls.master_enabled === false &&
    controls.transactional_enabled === false &&
    controls.cold_enabled === false;
}

function controlsLivePilot(value: unknown): boolean {
  const controls = record(value);
  return controls.master_enabled === true &&
    controls.transactional_enabled === true &&
    controls.cold_enabled === false;
}

function controlResult(value: unknown, expectedRunId: string, expectedMode: 'dry_run' | 'live'): {
  result: TransactionalGraphPilotControlResult;
  submissionSetHash: string | null;
} {
  const body = record(value);
  const runId = typeof body.run_id === 'string' ? body.run_id : null;
  const candidateCount = body.resources === 4 && body.submissions === 4 ? 4 : 0;
  const mode = body.mode;
  const off = controlsOff(body.controls);
  const live = controlsLivePilot(body.controls);
  if (body.accepted !== true || runId !== expectedRunId || !UUID.test(runId) ||
      mode !== expectedMode || candidateCount !== 4 ||
      (expectedMode === 'dry_run' ? !off : !live)) {
    fail(typeof body.reason_code === 'string' ? body.reason_code : 'pilot_rpc_invalid');
  }
  const submissionSetHash = typeof body.submission_set_hash === 'string'
    ? body.submission_set_hash
    : null;
  if (expectedMode === 'dry_run' && body.authorization_required !== true) {
    fail('pilot_authorization_contract_invalid');
  }
  return {
    result: {
      accepted: true,
      reasonCode: typeof body.reason_code === 'string' ? body.reason_code : 'pilot_ready',
      runId,
      candidateCount,
      outboundOff: off,
      expiresAt: typeof body.expires_at === 'string' ? body.expires_at : null,
    },
    submissionSetHash,
  };
}

function finishResult(value: unknown, expectedRunId: string): TransactionalGraphPilotControlResult {
  const body = record(value);
  const runId = typeof body.run_id === 'string' ? body.run_id : null;
  const accepted = body.accepted === true;
  const off = controlsOff(body.controls);
  if (!accepted || runId !== expectedRunId || !off || body.scope_active !== false) {
    return {
      accepted: false,
      reasonCode: typeof body.reason_code === 'string' ? body.reason_code : 'pilot_finish_invalid',
      runId,
      candidateCount: Number(body.confirmed_sent_count) || 0,
      outboundOff: off,
    };
  }
  return {
    accepted: true,
    reasonCode: typeof body.reason_code === 'string' ? body.reason_code : 'pilot_halted',
    runId,
    candidateCount: Number(body.confirmed_sent_count) || 0,
    outboundOff: true,
  };
}

function emergencyResult(value: unknown): TransactionalGraphPilotControlResult {
  const body = record(value);
  return {
    accepted: body.accepted === true,
    reasonCode: typeof body.reason_code === 'string' ? body.reason_code : 'halt_unavailable',
    runId: null,
    candidateCount: 0,
    outboundOff: body.accepted === true && controlsOff(body.controls),
  };
}

function parseLedger(value: unknown, expectedRunId: string): TransactionalGraphPilotLedgerRow[] {
  const body = record(value);
  if (body.accepted !== true || body.run_id_hash !== sha256(expectedRunId) || !Array.isArray(body.rows) ||
      body.rows.length !== 4) {
    fail(typeof body.reason_code === 'string' ? body.reason_code : 'pilot_ledger_invalid');
  }
  return body.rows.map((raw) => {
    const row = record(raw);
    if (!RESOURCES.includes(row.resource as typeof RESOURCES[number]) ||
        row.status !== 'confirmed_sent' ||
        typeof row.dispatch_id_hash !== 'string' || !HASH.test(row.dispatch_id_hash) ||
        typeof row.reservation_id_hash !== 'string' || !HASH.test(row.reservation_id_hash) ||
        typeof row.draft_immutable_id_hash !== 'string' || !HASH.test(row.draft_immutable_id_hash) ||
        typeof row.internet_message_id_hash !== 'string' || !HASH.test(row.internet_message_id_hash) ||
        typeof row.evidence_hash !== 'string' || !HASH.test(row.evidence_hash)) {
      fail('pilot_ledger_invalid');
    }
    return {
      resource: row.resource as TransactionalGraphPilotLedgerRow['resource'],
      status: 'confirmed_sent',
      dispatchIdHash: row.dispatch_id_hash,
      reservationIdHash: row.reservation_id_hash,
      draftImmutableIdHash: row.draft_immutable_id_hash,
      internetMessageIdHash: row.internet_message_id_hash,
      evidenceHash: row.evidence_hash,
    };
  });
}

function expectedLeadId(): string {
  const values = env('TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (values.length !== 1 || !HASH.test(values[0])) fail('pilot_identity_invalid');
  return values[0];
}

const args = process.argv.slice(2);
if (args.length > 1 || (args[0] !== undefined && !['--dry-run', '--live'].includes(args[0]))) {
  process.stdout.write(JSON.stringify({ status: 'blocked', reason_code: 'arguments_invalid' }) + '\n');
  process.exit(1);
}
const live = args[0] === '--live';
const rpcController = new AbortController();
let pilotActorHash = '';
let signalExitInProgress = false;
let rpcTimeoutMs = 10_000;

async function haltAfterSignal(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (signalExitInProgress) return;
  signalExitInProgress = true;
  rpcController.abort(new Error('pilot_interrupted'));
  await attemptTransactionalGraphPilotSignalHalt({
    live,
    actorHash: pilotActorHash,
    emergencyHalt: async () => emergencyResult(await callRpc(
      'emergency_halt_outbound_delivery',
      {
        p_actor_hash: pilotActorHash,
        p_reason: `TRANSACTIONAL_GRAPH_PILOT_SIGNAL_${signal}`,
      },
      { timeoutMs: Math.min(rpcTimeoutMs, 5_000) },
    )),
  });
  process.stdout.write(JSON.stringify({ status: 'blocked', reason_code: 'pilot_interrupted' }) + '\n');
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

const onSigint = () => { void haltAfterSignal('SIGINT'); };
const onSigterm = () => { void haltAfterSignal('SIGTERM'); };
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

try {
  const preflight = validateTransactionalGraphPilotRuntimePreflight({
    live,
    read: (key) => env(key as Parameters<typeof env>[0]),
  });
  if (!preflight.ok) fail(preflight.reasonCode);
  rpcTimeoutMs = preflight.rpcTimeoutMs;
  const rpcOptions = { timeoutMs: rpcTimeoutMs, signal: rpcController.signal };
  const raw = await readTransactionalPilotInput(process.stdin, { maxBytes: 16_384, timeoutMs: 15_000 });
  const input = JSON.parse(raw) as JsonRecord;
  const authorizationId = typeof input.authorization_id === 'string'
    ? input.authorization_id
    : '';
  const capabilitySecret = env('GRAPH_WORKER_SECRET');
  const allowedLeadId = expectedLeadId();
  const ttlSeconds = Number(env('TRANSACTIONAL_GRAPH_PILOT_TTL_SECONDS'));
  const summary = await runTransactionalGraphPilot(input, {
    live,
    liveEnabled: env('TRANSACTIONAL_GRAPH_PILOT_LIVE_ENABLED') === 'true',
    expectedLeadIdHash: allowedLeadId,
    capabilitySecret,
    ttlSeconds,
  }, {
    async prepare(candidate) {
      pilotActorHash = candidate.actorHash;
      const submissionIds = RESOURCES.map((resource) => {
        const item = candidate.submissions.find((submission) => submission.resource === resource);
        if (!item) fail('pilot_cohort_invalid');
        return item.submission_id;
      });
      const previewRaw = await callRpc('preview_transactional_graph_pilot', {
        p_run_id: candidate.runId,
        p_actor_hash: candidate.actorHash,
        p_allowed_lead_id: candidate.expectedLeadIdHash,
        p_submission_ids: submissionIds,
        p_ttl_seconds: candidate.ttlSeconds,
      }, rpcOptions);
      const preview = controlResult(previewRaw, candidate.runId, 'dry_run');
      if (!candidate.apply) return preview.result;
      if (!preview.submissionSetHash || !HASH.test(preview.submissionSetHash)) {
        fail('pilot_authorization_contract_invalid');
      }
      const authorizationNonceHash =
        hashTransactionalGraphPilotAuthorizationId(authorizationId);
      const started = await callRpc('start_transactional_graph_pilot', {
        p_run_id: candidate.runId,
        p_actor_hash: candidate.actorHash,
        p_allowed_lead_id: candidate.expectedLeadIdHash,
        p_submission_ids: submissionIds,
        p_authorization_hash: authorizationNonceHash,
        p_ttl_seconds: candidate.ttlSeconds,
      }, rpcOptions);
      return controlResult(started, candidate.runId, 'live').result;
    },
    executeOnce: executeConfiguredGraphDispatchOnce,
    async readLedger(runId) {
      if (!HASH.test(pilotActorHash)) fail('pilot_actor_invalid');
      return parseLedger(await callRpc('read_transactional_graph_pilot_ledger', {
        p_run_id: runId,
        p_actor_hash: pilotActorHash,
      }, rpcOptions), runId);
    },
    async finish(candidate) {
      return finishResult(await callRpc('finish_transactional_graph_pilot', {
        p_run_id: candidate.runId,
        p_actor_hash: candidate.actorHash,
        p_outcome: candidate.outcome,
        p_evidence_hash: candidate.evidenceHash,
      }, rpcOptions), candidate.runId);
    },
    async emergencyHalt(candidate) {
      return emergencyResult(await callRpc('emergency_halt_outbound_delivery', {
        p_actor_hash: candidate.actorHash,
        p_reason: candidate.reason,
      }, rpcOptions));
    },
  });
  process.stdout.write(JSON.stringify(summary) + '\n');
} catch (error) {
  const reasonCode = error instanceof TransactionalGraphPilotError
    ? error.reasonCode
    : error instanceof TransactionalPilotProvisionError
      ? error.reasonCode
      : error instanceof SyntaxError
        ? 'pilot_input_invalid'
        : 'pilot_unavailable';
  if (!signalExitInProgress) {
    process.stdout.write(JSON.stringify({ status: 'blocked', reason_code: reasonCode }) + '\n');
    process.exitCode = 1;
  }
} finally {
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
}
