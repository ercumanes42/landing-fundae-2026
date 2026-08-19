import { createHash } from 'node:crypto';

import { callRpc } from './supabase';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export interface GraphRpcResult {
  accepted?: boolean;
  authorized?: boolean;
  duplicate: boolean;
  reasonCode: string;
  reservationId: string | null;
  opaqueMarker: string | null;
  payloadSha256: string | null;
  graphDraftImmutableId: string | null;
  mailboxHalted: boolean;
  leaseExpiresAt: string | null;
  retryAfterSeconds: number;
}

export type GraphRpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;

function parseResult(value: unknown): GraphRpcResult {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (typeof item.reason_code !== 'string' || item.reason_code.length > 128) {
    throw new Error('Graph outbox RPC response is invalid');
  }
  return {
    accepted: typeof item.accepted === 'boolean' ? item.accepted : undefined,
    authorized: typeof item.authorized === 'boolean' ? item.authorized : undefined,
    duplicate: item.duplicate === true,
    reasonCode: item.reason_code,
    reservationId: typeof item.reservation_id === 'string' && UUID.test(item.reservation_id)
      ? item.reservation_id
      : null,
    opaqueMarker: typeof item.opaque_marker === 'string' ? item.opaque_marker : null,
    payloadSha256: typeof item.payload_sha256 === 'string' && HASH.test(item.payload_sha256)
      ? item.payload_sha256
      : null,
    graphDraftImmutableId: typeof item.graph_draft_immutable_id === 'string'
      ? item.graph_draft_immutable_id
      : null,
    mailboxHalted: item.mailbox_halted === true,
    leaseExpiresAt: typeof item.lease_expires_at === 'string' ? item.lease_expires_at : null,
    retryAfterSeconds: Number.isFinite(item.retry_after_seconds)
      ? Math.max(0, Math.ceil(Number(item.retry_after_seconds)))
      : 0,
  };
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export type GraphOutboxState =
  | 'reserved'
  | 'draft_creating'
  | 'draft_created'
  | 'send_submitted'
  | 'confirmed_sent'
  | 'definitive_failed'
  | 'ambiguous_halted'
  | 'suppressed_before_send';

const GRAPH_OUTBOX_STATES = new Set<GraphOutboxState>([
  'reserved', 'draft_creating', 'draft_created', 'send_submitted',
  'confirmed_sent', 'definitive_failed', 'ambiguous_halted',
  'suppressed_before_send',
]);

export interface GraphDispatchItem {
  dispatchId: string;
  submissionId: string;
  resource: 'calculator' | 'interactive_checklist' | 'checklist' | 'webinar';
  payloadSha256: string;
  attempt: number;
  reservationId: string | null;
  outboxState: GraphOutboxState | null;
  recoveryRequired: boolean;
  resumeExistingReservation: boolean;
  leaseExpiresAt: string | null;
  graphDraftImmutableId: string | null;
  draftNeutralized: boolean;
  outcomeEvidenceHash: string | null;
}

export interface GraphDispatchClaimResult {
  accepted: boolean;
  reasonCode: string;
  leaseExpiresAt: string | null;
  reservationId: string | null;
  outboxState: GraphOutboxState | null;
  recoveryRequired: boolean;
  resumeExistingReservation: boolean;
  items: GraphDispatchItem[];
}

function parseDispatchClaim(value: unknown): GraphDispatchClaimResult {
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (typeof result.accepted !== 'boolean' || typeof result.reason_code !== 'string' ||
      (result.recovery_required !== undefined && typeof result.recovery_required !== 'boolean') ||
      (result.resume_existing_reservation !== undefined &&
        typeof result.resume_existing_reservation !== 'boolean') ||
      !Array.isArray(result.items) || result.items.length > 1) {
    throw new Error('Graph dispatch claim response is invalid');
  }
  const recoveryRequired = result.recovery_required === true;
  const resumeExistingReservation = result.resume_existing_reservation === true;
  const reservationId = typeof result.reservation_id === 'string' && UUID.test(result.reservation_id)
    ? result.reservation_id
    : null;
  const outboxState = typeof result.outbox_state === 'string' &&
    GRAPH_OUTBOX_STATES.has(result.outbox_state as GraphOutboxState)
    ? result.outbox_state as GraphOutboxState
    : null;
  const leaseExpiresAt = typeof result.lease_expires_at === 'string' &&
    Number.isFinite(Date.parse(result.lease_expires_at))
    ? result.lease_expires_at
    : null;
  const items = result.items.map((entry) => {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const itemReservationId = typeof item.reservation_id === 'string' && UUID.test(item.reservation_id)
      ? item.reservation_id
      : null;
    const itemOutboxState = typeof item.outbox_state === 'string' &&
      GRAPH_OUTBOX_STATES.has(item.outbox_state as GraphOutboxState)
      ? item.outbox_state as GraphOutboxState
      : null;
    const itemLeaseExpiresAt = typeof item.lease_expires_at === 'string' &&
      Number.isFinite(Date.parse(item.lease_expires_at))
      ? item.lease_expires_at
      : null;
    const graphDraftImmutableId = typeof item.graph_draft_immutable_id === 'string' &&
      item.graph_draft_immutable_id.length > 0
      ? item.graph_draft_immutable_id
      : null;
    const draftNeutralized = item.draft_neutralized === true;
    const outcomeEvidenceHash = typeof item.outcome_evidence_hash === 'string' &&
      HASH.test(item.outcome_evidence_hash)
      ? item.outcome_evidence_hash
      : null;
    if (typeof item.dispatch_id !== 'string' || !UUID.test(item.dispatch_id) ||
        typeof item.submission_id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(item.submission_id) ||
        !['calculator', 'interactive_checklist', 'checklist', 'webinar'].includes(String(item.resource)) ||
        typeof item.payload_sha256 !== 'string' || !HASH.test(item.payload_sha256) ||
        !Number.isSafeInteger(item.attempt) || Number(item.attempt) < 1 ||
        typeof item.recovery_required !== 'boolean' ||
        typeof item.resume_existing_reservation !== 'boolean' ||
        !('graph_draft_immutable_id' in item) ||
        typeof item.draft_neutralized !== 'boolean' ||
        !('outcome_evidence_hash' in item)) {
      throw new Error('Graph dispatch claim item is invalid');
    }
    const itemRecoveryRequired = item.recovery_required;
    const itemResumeExistingReservation = item.resume_existing_reservation;
    const recoveryShapeIsValid = itemRecoveryRequired && itemResumeExistingReservation &&
      itemReservationId !== null && itemOutboxState !== null && itemLeaseExpiresAt !== null;
    const freshShapeIsValid = !itemRecoveryRequired && !itemResumeExistingReservation &&
      itemReservationId === null && itemOutboxState === null;
    if ((!recoveryShapeIsValid && !freshShapeIsValid) ||
        itemRecoveryRequired !== recoveryRequired ||
        itemResumeExistingReservation !== resumeExistingReservation ||
        (recoveryRequired && (
          itemReservationId !== reservationId || itemOutboxState !== outboxState ||
          itemLeaseExpiresAt !== leaseExpiresAt
        ))) {
      throw new Error('Graph dispatch recovery claim is invalid');
    }
    return {
      dispatchId: item.dispatch_id,
      submissionId: item.submission_id,
      resource: item.resource as GraphDispatchItem['resource'],
      payloadSha256: item.payload_sha256,
      attempt: Number(item.attempt),
      reservationId: itemReservationId,
      outboxState: itemOutboxState,
      recoveryRequired: itemRecoveryRequired,
      resumeExistingReservation: itemResumeExistingReservation,
      leaseExpiresAt: itemLeaseExpiresAt,
      graphDraftImmutableId,
      draftNeutralized,
      outcomeEvidenceHash,
    };
  });
  if (result.accepted && items.length === 0 && result.reason_code !== 'terminal_recovered' &&
      (recoveryRequired || resumeExistingReservation ||
        reservationId !== null || outboxState !== null)) {
    throw new Error('Graph dispatch empty claim is invalid');
  }
  if (items.length > 0 && recoveryRequired &&
      (result.reason_code !== 'reserved_recovery' || reservationId === null ||
        outboxState === null || leaseExpiresAt === null)) {
    throw new Error('Graph dispatch recovery claim is invalid');
  }
  return {
    accepted: result.accepted,
    reasonCode: result.reason_code,
    leaseExpiresAt,
    reservationId,
    outboxState,
    recoveryRequired,
    resumeExistingReservation,
    items,
  };
}

export class GraphOutboxRepository {
  constructor(private readonly rpc: GraphRpc = callRpc) {}

  async registerTransactional(input: {
    reservationId: string;
    finalizeCapabilityHash: string;
    payloadSha256: string;
    sendCapabilityHash: string;
    opaqueMarker: string;
  }): Promise<GraphRpcResult> {
    return parseResult(await this.rpc('register_transactional_graph_outbox', {
      p_reservation_id: input.reservationId,
      p_finalize_capability_hash: input.finalizeCapabilityHash,
      p_payload_sha256: input.payloadSha256,
      p_send_capability_hash: input.sendCapabilityHash,
      p_opaque_marker: input.opaqueMarker,
    }));
  }

  async beginDraft(reservationId: string, finalizeCapabilityHash: string): Promise<GraphRpcResult> {
    return parseResult(await this.rpc('begin_graph_draft_creation', {
      p_reservation_id: reservationId,
      p_finalize_capability_hash: finalizeCapabilityHash,
    }));
  }

  async bindDraft(input: {
    reservationId: string;
    finalizeCapabilityHash: string;
    immutableId: string;
    changeKeyHash: string;
  }): Promise<GraphRpcResult> {
    return parseResult(await this.rpc('bind_graph_draft_immutable_id', {
      p_reservation_id: input.reservationId,
      p_finalize_capability_hash: input.finalizeCapabilityHash,
      p_graph_draft_immutable_id: input.immutableId,
      p_graph_change_key_hash: input.changeKeyHash,
    }));
  }

  async authorizeSend(input: {
    reservationId: string;
    sendCapabilityHash: string;
    stopSnapshotHash: string;
    observedChangeKeyHash: string;
  }): Promise<GraphRpcResult> {
    return parseResult(await this.rpc('authorize_graph_draft_send', {
      p_reservation_id: input.reservationId,
      p_send_capability_hash: input.sendCapabilityHash,
      p_stop_snapshot_hash: input.stopSnapshotHash,
      p_observed_change_key_hash: input.observedChangeKeyHash,
    }));
  }

  async confirmSent(input: {
    reservationId: string;
    finalizeCapabilityHash: string;
    immutableId: string;
    internetMessageIdHash: string;
    sentItemsEvidenceHash: string;
  }): Promise<GraphRpcResult> {
    return parseResult(await this.rpc('confirm_graph_sent_item', {
      p_reservation_id: input.reservationId,
      p_finalize_capability_hash: input.finalizeCapabilityHash,
      p_graph_draft_immutable_id: input.immutableId,
      p_internet_message_id_hash: input.internetMessageIdHash,
      p_sent_items_evidence_hash: input.sentItemsEvidenceHash,
    }));
  }

  async fail(input: {
    reservationId: string;
    finalizeCapabilityHash: string;
    outcome: 'definitive_failed' | 'ambiguous_halted';
    failureCode: string;
    evidenceHash: string;
  }): Promise<GraphRpcResult> {
    return parseResult(await this.rpc('finalize_graph_delivery_failure', {
      p_reservation_id: input.reservationId,
      p_finalize_capability_hash: input.finalizeCapabilityHash,
      p_outcome: input.outcome,
      p_failure_code: input.failureCode,
      p_evidence_hash: input.evidenceHash,
    }));
  }

  async confirmNeutralized(input: {
    reservationId: string;
    finalizeCapabilityHash: string;
    immutableId: string;
    neutralizationEvidenceHash: string;
  }): Promise<GraphRpcResult> {
    return parseResult(await this.rpc('confirm_graph_draft_neutralized', {
      p_reservation_id: input.reservationId,
      p_finalize_capability_hash: input.finalizeCapabilityHash,
      p_graph_draft_immutable_id: input.immutableId,
      p_neutralization_evidence_hash: input.neutralizationEvidenceHash,
    }));
  }

  async claimDispatch(workerId: string, leaseSeconds = 90): Promise<GraphDispatchClaimResult> {
    return parseDispatchClaim(await this.rpc('claim_transactional_graph_dispatch', {
      p_worker_id: workerId,
      p_limit: 1,
      p_lease_seconds: leaseSeconds,
    }));
  }

  async reserveDispatch(input: {
    dispatchId: string;
    workerId: string;
    mailboxKeyHash: string;
    finalizeCapabilityHash: string;
    packageHmacSha256: string;
    sendCapabilityHash: string;
    opaqueMarker: string;
  }): Promise<GraphRpcResult> {
    return parseResult(await this.rpc('reserve_claimed_transactional_graph_dispatch', {
      p_dispatch_id: input.dispatchId,
      p_worker_id: input.workerId,
      p_mailbox_key_hash: input.mailboxKeyHash,
      p_finalize_capability_hash: input.finalizeCapabilityHash,
      p_package_hmac_sha256: input.packageHmacSha256,
      p_send_capability_hash: input.sendCapabilityHash,
      p_opaque_marker: input.opaqueMarker,
    }));
  }

  async finalizeDispatch(input: {
    dispatchId: string;
    workerId: string;
    outcome: 'confirmed_sent' | 'definitive_failed' | 'ambiguous_halted' | 'suppressed_before_send' | 'deferred';
    evidenceHash: string;
  }): Promise<GraphRpcResult> {
    return parseResult(await this.rpc('finalize_transactional_graph_dispatch', {
      p_dispatch_id: input.dispatchId,
      p_worker_id: input.workerId,
      p_outcome: input.outcome,
      p_evidence_hash: input.evidenceHash,
    }));
  }
}
