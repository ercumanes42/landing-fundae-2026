import { createHash, createHmac, randomUUID } from 'node:crypto';

import type { GraphDispatchRunResult } from './graph-dispatch';

export const TRANSACTIONAL_GRAPH_PILOT_RESOURCES = [
  'calculator',
  'interactive_checklist',
  'checklist',
  'webinar',
] as const;
export const TRANSACTIONAL_GRAPH_PILOT_LIVE_CONFIRMATION =
  'SEND_4_INTERNAL_TRANSACTIONAL_EMAILS_WITH_GRAPH_V1';

type PilotResource = typeof TRANSACTIONAL_GRAPH_PILOT_RESOURCES[number];
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SUBMISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/;

export class TransactionalGraphPilotError extends Error {
  constructor(public readonly reasonCode: string) {
    super(reasonCode);
  }
}

export interface TransactionalGraphPilotRequest {
  schema_version: 'fundae-transactional-graph-pilot-v1';
  run_id: string;
  authorization_id: string;
  confirmation?: string;
  submissions: Array<{ resource: PilotResource; submission_id: string }>;
}

export interface TransactionalGraphPilotControlResult {
  accepted: boolean;
  reasonCode: string;
  runId: string | null;
  candidateCount: number;
  outboundOff: boolean;
  expiresAt?: string | null;
}

export interface TransactionalGraphPilotLedgerRow {
  resource: PilotResource;
  status: 'confirmed_sent';
  dispatchIdHash: string;
  reservationIdHash: string;
  draftImmutableIdHash: string;
  internetMessageIdHash: string;
  evidenceHash: string;
}

interface TransactionalGraphPilotDependencies {
  prepare(input: {
    runId: string;
    actorHash: string;
    expectedLeadIdHash: string;
    submissions: TransactionalGraphPilotRequest['submissions'];
    ttlSeconds: number;
    apply: boolean;
  }): Promise<TransactionalGraphPilotControlResult>;
  executeOnce(): Promise<GraphDispatchRunResult>;
  readLedger(runId: string): Promise<TransactionalGraphPilotLedgerRow[]>;
  finish(input: {
    runId: string;
    actorHash: string;
    outcome: 'completed' | 'halted';
    evidenceHash: string;
  }): Promise<TransactionalGraphPilotControlResult>;
  emergencyHalt(input: {
    actorHash: string;
    reason: string;
  }): Promise<TransactionalGraphPilotControlResult>;
}

export interface TransactionalGraphPilotSummary {
  status: 'validated' | 'confirmed_sent';
  mode: 'dry_run' | 'live';
  run_id_hash: string;
  resources: 4;
  confirmed: 0 | 4;
  outbound_off: true;
  evidence: TransactionalGraphPilotLedgerRow[];
}

export interface TransactionalGraphPilotGrantRequest {
  schema_version: 'fundae-transactional-graph-pilot-grant-v1';
  run_id: string;
  actor_hash: string;
  authorization_nonce_hash: string;
  allowed_lead_id: string;
  submission_ids: string[];
  submission_set_hash: string;
  max_ttl_seconds: number;
  expires_at: string;
}

function fail(reasonCode: string): never {
  throw new TransactionalGraphPilotError(reasonCode);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function derive(secret: string, purpose: string, value: string): string {
  if (Buffer.byteLength(secret, 'utf8') < 32) fail('pilot_secret_invalid');
  return createHmac('sha256', secret)
    .update(`fundae-transactional-graph-pilot-${purpose}-v1\0${value}`, 'utf8')
    .digest('hex');
}

export function hashTransactionalGraphPilotAuthorizationId(authorizationId: string): string {
  if (!UUID.test(authorizationId)) fail('pilot_live_authorization_required');
  return sha256(
    `fundae-transactional-graph-pilot-authorization:v1:${authorizationId.toLowerCase()}`,
  );
}

export function deriveTransactionalGraphPilotActorHash(
  capabilitySecret: string,
  authorizationId: string,
): string {
  if (!UUID.test(authorizationId)) fail('pilot_live_authorization_required');
  return derive(capabilitySecret, 'actor', authorizationId.toLowerCase());
}

function parseRequest(value: unknown): TransactionalGraphPilotRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('pilot_input_invalid');
  const input = value as Partial<TransactionalGraphPilotRequest>;
  const keys = Object.keys(input);
  if (keys.some((key) => !['schema_version', 'run_id', 'authorization_id', 'confirmation', 'submissions'].includes(key)) ||
      input.schema_version !== 'fundae-transactional-graph-pilot-v1' ||
      typeof input.run_id !== 'string' || !UUID.test(input.run_id) ||
      typeof input.authorization_id !== 'string' || !UUID.test(input.authorization_id) ||
      (input.confirmation !== undefined && typeof input.confirmation !== 'string') ||
      !Array.isArray(input.submissions) || input.submissions.length !== 4) {
    fail('pilot_input_invalid');
  }
  const seenResources = new Set<string>();
  const seenSubmissions = new Set<string>();
  for (const item of input.submissions) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some((key) => !['resource', 'submission_id'].includes(key))) {
      fail('pilot_input_invalid');
    }
    const candidate = item as { resource?: unknown; submission_id?: unknown };
    if (typeof candidate.resource !== 'string' ||
        !TRANSACTIONAL_GRAPH_PILOT_RESOURCES.includes(candidate.resource as PilotResource) ||
        typeof candidate.submission_id !== 'string' || !SUBMISSION_ID.test(candidate.submission_id) ||
        seenResources.has(candidate.resource) || seenSubmissions.has(candidate.submission_id)) {
      fail('pilot_cohort_invalid');
    }
    seenResources.add(candidate.resource);
    seenSubmissions.add(candidate.submission_id);
  }
  if (TRANSACTIONAL_GRAPH_PILOT_RESOURCES.some((resource) => !seenResources.has(resource))) {
    fail('pilot_cohort_invalid');
  }
  return input as TransactionalGraphPilotRequest;
}

function validateLedger(rows: TransactionalGraphPilotLedgerRow[], expectedCount: number): void {
  if (!Array.isArray(rows) || rows.length !== expectedCount) fail('pilot_ledger_invalid');
  const resources = new Set<string>();
  const dispatches = new Set<string>();
  const reservations = new Set<string>();
  const drafts = new Set<string>();
  for (const row of rows) {
    if (!row || !TRANSACTIONAL_GRAPH_PILOT_RESOURCES.includes(row.resource) ||
        row.status !== 'confirmed_sent' ||
        !HASH.test(row.dispatchIdHash) || !HASH.test(row.reservationIdHash) ||
        !HASH.test(row.draftImmutableIdHash) || !HASH.test(row.internetMessageIdHash) ||
        !HASH.test(row.evidenceHash) ||
        resources.has(row.resource) || dispatches.has(row.dispatchIdHash) ||
        reservations.has(row.reservationIdHash) || drafts.has(row.draftImmutableIdHash)) {
      fail('pilot_ledger_invalid');
    }
    resources.add(row.resource);
    dispatches.add(row.dispatchIdHash);
    reservations.add(row.reservationIdHash);
    drafts.add(row.draftImmutableIdHash);
  }
  if (expectedCount === 4 &&
      TRANSACTIONAL_GRAPH_PILOT_RESOURCES.some((resource) => !resources.has(resource))) {
    fail('pilot_ledger_invalid');
  }
}

export function buildTransactionalGraphPilotGrantRequest(
  rawInput: unknown,
  options: {
    expectedLeadIdHash: string;
    capabilitySecret: string;
    ttlSeconds?: number;
    now?: Date;
  },
): TransactionalGraphPilotGrantRequest {
  const request = parseRequest(rawInput);
  if (!HASH.test(options.expectedLeadIdHash)) fail('pilot_identity_invalid');
  const ttlSeconds = options.ttlSeconds ?? 600;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 120 || ttlSeconds > 900) {
    fail('pilot_ttl_invalid');
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) fail('pilot_grant_time_invalid');
  const submissionIds = request.submissions
    .map((submission) => submission.submission_id)
    .sort((left, right) => left.localeCompare(right));
  return {
    schema_version: 'fundae-transactional-graph-pilot-grant-v1',
    run_id: request.run_id,
    actor_hash: deriveTransactionalGraphPilotActorHash(
      options.capabilitySecret,
      request.authorization_id,
    ),
    authorization_nonce_hash:
      hashTransactionalGraphPilotAuthorizationId(request.authorization_id),
    allowed_lead_id: options.expectedLeadIdHash,
    submission_ids: submissionIds,
    submission_set_hash: sha256(submissionIds.join(String.fromCharCode(31))),
    max_ttl_seconds: ttlSeconds,
    expires_at: new Date(now.getTime() + (ttlSeconds + 120) * 1_000).toISOString(),
  };
}

export async function runTransactionalGraphPilot(
  rawInput: unknown,
  options: {
    live: boolean;
    liveEnabled: boolean;
    expectedLeadIdHash: string;
    capabilitySecret: string;
    ttlSeconds?: number;
    runId?: string;
  },
  dependencies: TransactionalGraphPilotDependencies,
): Promise<TransactionalGraphPilotSummary> {
  const request = parseRequest(rawInput);
  if (!HASH.test(options.expectedLeadIdHash)) fail('pilot_identity_invalid');
  if (options.live && (!options.liveEnabled ||
      request.confirmation !== TRANSACTIONAL_GRAPH_PILOT_LIVE_CONFIRMATION)) {
    fail('pilot_live_authorization_required');
  }
  const runId = options.runId ?? request.run_id ?? randomUUID();
  if (options.runId && request.run_id !== options.runId) fail('pilot_run_id_invalid');
  if (!UUID.test(runId)) fail('pilot_run_id_invalid');
  const ttlSeconds = options.ttlSeconds ?? 600;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 120 || ttlSeconds > 900) {
    fail('pilot_ttl_invalid');
  }
  const actorHash = deriveTransactionalGraphPilotActorHash(
    options.capabilitySecret,
    request.authorization_id,
  );
  const emergencyOff = async (reason: string): Promise<boolean> => {
    try {
      const halted = await dependencies.emergencyHalt({ actorHash, reason });
      return halted.accepted && halted.outboundOff;
    } catch {
      return false;
    }
  };
  let prepared: TransactionalGraphPilotControlResult;
  try {
    prepared = await dependencies.prepare({
      runId,
      actorHash,
      expectedLeadIdHash: options.expectedLeadIdHash,
      submissions: request.submissions,
      ttlSeconds,
      apply: options.live,
    });
  } catch (error) {
    if (options.live && !await emergencyOff('TRANSACTIONAL_GRAPH_PILOT_START_AMBIGUOUS')) {
      fail('pilot_finally_halt_failed');
    }
    if (error instanceof TransactionalGraphPilotError) throw error;
    fail('pilot_prepare_unavailable');
  }
  if (!prepared.accepted || prepared.runId !== runId || prepared.candidateCount !== 4) {
    if (options.live && !await emergencyOff('TRANSACTIONAL_GRAPH_PILOT_START_REJECTED')) {
      fail('pilot_finally_halt_failed');
    }
    fail(prepared.reasonCode || 'pilot_prepare_rejected');
  }
  if (!options.live) {
    if (!prepared.outboundOff) fail('pilot_dry_run_mutated_outbound');
    return {
      status: 'validated',
      mode: 'dry_run',
      run_id_hash: sha256(runId),
      resources: 4,
      confirmed: 0,
      outbound_off: true,
      evidence: [],
    };
  }
  if (prepared.outboundOff) {
    if (!await emergencyOff('TRANSACTIONAL_GRAPH_PILOT_START_NOT_ENABLED')) {
      fail('pilot_finally_halt_failed');
    }
    fail('pilot_start_not_enabled');
  }

  let failure: TransactionalGraphPilotError | null = null;
  let evidence: TransactionalGraphPilotLedgerRow[] = [];
  try {
    for (let sent = 1; sent <= 4; sent += 1) {
      const result = await dependencies.executeOnce();
      if (result.state !== 'confirmed_sent' || !result.dispatchId || !result.reservationId) {
        fail(`pilot_dispatch_${result.reasonCode || result.state}`);
      }
    }
    evidence = await dependencies.readLedger(runId);
    validateLedger(evidence, 4);
  } catch (error) {
    failure = error instanceof TransactionalGraphPilotError
      ? error
      : new TransactionalGraphPilotError('pilot_execution_unavailable');
  }

  let outboundOff = false;
  try {
    const closed = await dependencies.finish({
      runId,
      actorHash,
      outcome: failure ? 'halted' : 'completed',
      evidenceHash: failure
        ? sha256(`pilot-aborted-v1\0${runId}\0${failure.reasonCode}`)
        : sha256(JSON.stringify(evidence)),
    });
    outboundOff = closed.accepted && closed.outboundOff;
  } catch {
    outboundOff = false;
  }
  if (!outboundOff) {
    outboundOff = await emergencyOff('TRANSACTIONAL_GRAPH_PILOT_FINALLY_HALT');
  }
  if (!outboundOff) fail('pilot_finally_halt_failed');
  if (failure) throw failure;
  validateLedger(evidence, 4);
  return {
    status: 'confirmed_sent',
    mode: 'live',
    run_id_hash: sha256(runId),
    resources: 4,
    confirmed: 4,
    outbound_off: true,
    evidence,
  };
}
