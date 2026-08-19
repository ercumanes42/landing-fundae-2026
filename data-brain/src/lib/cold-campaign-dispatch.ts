import { createHmac, timingSafeEqual } from 'node:crypto';

import { capabilityHash } from './mailbox-throttle';
import { sha256, type GraphOutboxState, type GraphRpc } from './graph-outbox-repository';
import type { GraphDeliveryPackage, GraphWorkerResult, TransactionalGraphJob } from './graph-worker';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

interface ColdClaimItem {
  dispatchId: string;
  campaignExecutionId: string;
  campaignExternalId: string;
  contactId: string;
  executionKey: string;
  step: number;
  reservationId: string | null;
  recoveryRequired: boolean;
  outboxState: GraphOutboxState | null;
  graphDraftImmutableId: string | null;
  draftNeutralized: boolean;
  outcomeEvidenceHash: string | null;
}

interface ColdPackage {
  recipientEmail: string;
  subject: string;
  htmlBody: string;
  payloadSha256: string;
}

export interface ColdTickResult {
  state: 'off' | 'empty' | 'deferred' | 'confirmed_sent' | 'definitive_failed' | 'suppressed_before_send' | 'ambiguous_halted';
  reasonCode: string;
  dispatchId: string | null;
  reservationId: string | null;
  alertAttempted?: boolean;
  alertDelivered?: boolean | null;
}

function isColdTerminalState(state: GraphOutboxState): state is Extract<ColdTickResult['state'], 'confirmed_sent' | 'definitive_failed' | 'suppressed_before_send' | 'ambiguous_halted'> {
  return ['confirmed_sent','definitive_failed','suppressed_before_send','ambiguous_halted'].includes(state);
}

export interface ColdTickDependencies {
  rpc: GraphRpc;
  enabled: () => boolean;
  workerId: string;
  workerToken: string;
  mailboxKeyHash: string;
  capabilitySecret: string;
  alert: (event: { code: string; reservationHash: string; evidenceHash: string }) => Promise<void>;
  executeGraph: (job: TransactionalGraphJob, deliveryPackage: GraphDeliveryPackage) => Promise<GraphWorkerResult>;
}

async function attemptCriticalAlert(
  deps: ColdTickDependencies,
  code: string,
  reservationId: string,
  evidenceHash: string,
): Promise<{ alertAttempted: true; alertDelivered: boolean }> {
  try {
    await deps.alert({ code, reservationHash: sha256(reservationId), evidenceHash });
    return { alertAttempted: true, alertDelivered: true };
  } catch {
    return { alertAttempted: true, alertDelivered: false };
  }
}

function derive(secret: string, purpose: string, context: string): Buffer {
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Cold campaign capability secret is unavailable');
  return createHmac('sha256', secret).update(`fundae-graph-${purpose}-v1\0${context}`, 'utf8').digest();
}

function parseClaim(value: unknown): { accepted: boolean; reasonCode: string; leaseExpiresAt: string | null; item: ColdClaimItem | null } {
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (typeof result.accepted !== 'boolean' || typeof result.reason_code !== 'string' || !Array.isArray(result.items) || result.items.length > 1) {
    throw new Error('Cold campaign claim is invalid');
  }
  const leaseExpiresAt = typeof result.lease_expires_at === 'string' && Number.isFinite(Date.parse(result.lease_expires_at))
    ? result.lease_expires_at : null;
  if (result.items.length === 0) return { accepted: result.accepted, reasonCode: result.reason_code, leaseExpiresAt, item: null };
  const item = result.items[0] as Record<string, unknown>;
  const recoveryStates: GraphOutboxState[] = ['reserved','draft_creating','draft_created','send_submitted','confirmed_sent','definitive_failed','ambiguous_halted','suppressed_before_send'];
  const recoveryRequired = item.recovery_required === true;
  const outcomeEvidenceHash = item.outcome_evidence_hash === null ? null : String(item.outcome_evidence_hash);
  if (!UUID.test(String(item.dispatch_id)) || !UUID.test(String(item.campaign_execution_id)) ||
      typeof item.campaign_external_id !== 'string' || typeof item.contact_id !== 'string' ||
      typeof item.execution_key !== 'string' || !Number.isInteger(item.step) || Number(item.step) < 1 || Number(item.step) > 5 ||
      typeof item.recovery_required !== 'boolean' || (item.reservation_id !== null && !UUID.test(String(item.reservation_id))) || !leaseExpiresAt ||
      (recoveryRequired && (item.reservation_id === null || !recoveryStates.includes(item.outbox_state as GraphOutboxState) || typeof item.draft_neutralized !== 'boolean' ||
        (item.graph_draft_immutable_id !== null && typeof item.graph_draft_immutable_id !== 'string') ||
        (outcomeEvidenceHash !== null && !HASH.test(outcomeEvidenceHash))))) {
    throw new Error('Cold campaign claim item is invalid');
  }
  return { accepted: result.accepted, reasonCode: result.reason_code, leaseExpiresAt, item: {
    dispatchId: String(item.dispatch_id), campaignExecutionId: String(item.campaign_execution_id),
    campaignExternalId: item.campaign_external_id, contactId: item.contact_id,
    executionKey: item.execution_key, step: Number(item.step),
    reservationId: item.reservation_id === null ? null : String(item.reservation_id),
    recoveryRequired,
    outboxState: recoveryRequired ? item.outbox_state as GraphOutboxState : null,
    graphDraftImmutableId: recoveryRequired && item.graph_draft_immutable_id !== null ? String(item.graph_draft_immutable_id) : null,
    draftNeutralized: recoveryRequired ? item.draft_neutralized as boolean : false,
    outcomeEvidenceHash: recoveryRequired ? outcomeEvidenceHash : null,
  } };
}

function parsePackage(value: unknown): ColdPackage {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (item.packaged !== true || typeof item.recipient_email !== 'string' || !/^\S+@\S+\.\S+$/.test(item.recipient_email) ||
      typeof item.subject !== 'string' || item.subject.length < 1 || item.subject.length > 200 || /[\r\n]/.test(item.subject) ||
      typeof item.html_body !== 'string' ||
      typeof item.payload_sha256 !== 'string' || !HASH.test(item.payload_sha256)) {
    throw new Error('Cold campaign package is unavailable');
  }
  return { recipientEmail: item.recipient_email, subject: item.subject, htmlBody: item.html_body, payloadSha256: item.payload_sha256 };
}

export async function executeColdCampaignTick(deps: ColdTickDependencies): Promise<ColdTickResult> {
  if (!deps.enabled()) return { state: 'off', reasonCode: 'master_or_lane_disabled', dispatchId: null, reservationId: null };
  const claim = parseClaim(await deps.rpc('claim_cold_campaign_dispatch', {
    p_worker_id: deps.workerId, p_worker_token: deps.workerToken, p_lease_seconds: 120,
  }));
  if (!claim.accepted || !claim.item) {
    return { state: claim.reasonCode === 'empty' ? 'empty' : 'deferred', reasonCode: claim.reasonCode, dispatchId: null, reservationId: null };
  }
  const item = claim.item;
  const stored = parsePackage(await deps.rpc('get_claimed_cold_campaign_package', {
    p_dispatch_id: item.dispatchId, p_worker_id: deps.workerId, p_worker_token: deps.workerToken,
  }));
  const finalizeCapability = derive(deps.capabilitySecret, 'finalize-capability', item.dispatchId).toString('base64url');
  const intakeCapability = derive(deps.capabilitySecret, 'package-capability', item.dispatchId).toString('base64url');
  const sendCapabilityHash = capabilityHash(derive(deps.capabilitySecret, 'send-capability', item.dispatchId).toString('base64url'));
  const marker = derive(deps.capabilitySecret, 'marker', item.dispatchId).toString('hex');
  const canonical = JSON.stringify({ recipient: stored.recipientEmail.toLowerCase(), subject: stored.subject, body: stored.htmlBody, attachments: [] });
  const actualPayloadSha256 = sha256(canonical);
  if (!stored.htmlBody.includes('/baja?token=') ||
      !timingSafeEqual(Buffer.from(actualPayloadSha256, 'hex'), Buffer.from(stored.payloadSha256, 'hex'))) {
    const evidenceHash = sha256(`cold-payload-drift-v1\0${item.dispatchId}\0${actualPayloadSha256}\0${stored.payloadSha256}`);
    await deps.rpc('halt_cold_campaign_dispatch', {
      p_dispatch_id: item.dispatchId, p_worker_id: deps.workerId, p_worker_token: deps.workerToken,
      p_reason_code: 'PAYLOAD_BINDING_MISMATCH', p_evidence_hash: evidenceHash,
    });
    const alert = await attemptCriticalAlert(
      deps, 'AMBIGUOUS_COLD_PAYLOAD_BINDING_MISMATCH', item.reservationId ?? item.dispatchId, evidenceHash,
    );
    return { state: 'ambiguous_halted', reasonCode: 'payload_binding_mismatch', dispatchId: item.dispatchId, reservationId: item.reservationId, ...alert };
  }
  const packageHmacSha256 = createHmac('sha256', intakeCapability).update(canonical, 'utf8').digest('hex');
  const deliveryPackage: GraphDeliveryPackage = {
    packaged: true, recipient: { email: stored.recipientEmail }, subject: stored.subject,
    body: stored.htmlBody, attachments: [], packageHmacSha256,
  };
  let reservationId: string;
  if (item.recoveryRequired) {
    // Claim already proved the existing reservation/outbox binding under lock.
    // Recovery must not enter the reservation creation path again.
    reservationId = item.reservationId!;
  } else {
    const reserved = await deps.rpc<Record<string, unknown>>('bind_cold_campaign_reservation', {
      p_dispatch_id: item.dispatchId, p_worker_id: deps.workerId, p_worker_token: deps.workerToken,
      p_mailbox_key_hash: deps.mailboxKeyHash, p_message_key_hash: sha256(`cold:${item.campaignExecutionId}`),
      p_payload_sha256: stored.payloadSha256, p_finalize_capability_hash: capabilityHash(finalizeCapability),
      p_send_capability_hash: sendCapabilityHash, p_opaque_marker: marker,
    });
    if (reserved.authorized !== true || typeof reserved.reservation_id !== 'string' || !UUID.test(reserved.reservation_id)) {
      return { state: 'deferred', reasonCode: typeof reserved.reason_code === 'string' ? reserved.reason_code : 'reservation_unavailable', dispatchId: item.dispatchId, reservationId: null };
    }
    reservationId = reserved.reservation_id;
  }
  if (item.recoveryRequired && item.outboxState && isColdTerminalState(item.outboxState) &&
      (item.outboxState !== 'suppressed_before_send' || item.draftNeutralized)) {
    if (!item.outcomeEvidenceHash) {
      const evidenceHash = sha256(`cold-recovery-evidence-missing-v1\0${item.dispatchId}`);
      await deps.rpc('halt_cold_campaign_dispatch', {
        p_dispatch_id: item.dispatchId, p_worker_id: deps.workerId, p_worker_token: deps.workerToken,
        p_reason_code: 'RECOVERY_EVIDENCE_MISSING', p_evidence_hash: evidenceHash,
      });
      const alert = await attemptCriticalAlert(
        deps, 'AMBIGUOUS_COLD_RECOVERY_EVIDENCE_MISSING', reservationId, evidenceHash,
      );
      return { state: 'ambiguous_halted', reasonCode: 'recovery_evidence_missing', dispatchId: item.dispatchId, reservationId, ...alert };
    }
    const finalized = await deps.rpc<Record<string, unknown>>('finalize_cold_campaign_dispatch', {
      p_dispatch_id: item.dispatchId, p_worker_id: deps.workerId, p_worker_token: deps.workerToken,
      p_outcome: item.outboxState, p_evidence_hash: item.outcomeEvidenceHash,
    });
    if (finalized.accepted !== true) {
      const alert = await attemptCriticalAlert(
        deps, 'AMBIGUOUS_COLD_RECOVERY_FINALIZE_REJECTED', reservationId, item.outcomeEvidenceHash,
      );
      return { state: 'ambiguous_halted', reasonCode: 'finalize_rejected', dispatchId: item.dispatchId, reservationId, ...alert };
    }
    return { state: item.outboxState, reasonCode: 'terminal_recovered', dispatchId: item.dispatchId, reservationId };
  }
  const workerResult = await deps.executeGraph({
    reservation_id: reservationId, finalize_capability: finalizeCapability,
    intake_capability: intakeCapability, expected_resource: 'campaign', payload_sha256: stored.payloadSha256,
    package_hmac_sha256: packageHmacSha256, lease_expires_at: claim.leaseExpiresAt!,
    capability_context: item.dispatchId, pre_registered: true,
    ...(item.recoveryRequired ? {
      recovery_only: true as const,
      expected_outbox_state: item.outboxState!,
      recovery_draft_immutable_id: item.graphDraftImmutableId,
      recovery_draft_neutralized: item.draftNeutralized,
      recovery_outcome_evidence_hash: item.outcomeEvidenceHash,
    } : {}),
  }, deliveryPackage);
  if (!['confirmed_sent','definitive_failed','suppressed_before_send','ambiguous_halted'].includes(workerResult.state) || !workerResult.evidenceHash) {
    return { state: 'deferred', reasonCode: workerResult.reasonCode, dispatchId: item.dispatchId, reservationId };
  }
  const finalized = await deps.rpc<Record<string, unknown>>('finalize_cold_campaign_dispatch', {
    p_dispatch_id: item.dispatchId, p_worker_id: deps.workerId, p_worker_token: deps.workerToken,
    p_outcome: workerResult.state, p_evidence_hash: workerResult.evidenceHash,
  });
  if (finalized.accepted !== true) {
    const alert = await attemptCriticalAlert(
      deps, 'AMBIGUOUS_COLD_FINALIZE_REJECTED', reservationId, workerResult.evidenceHash,
    );
    return { state: 'ambiguous_halted', reasonCode: 'finalize_rejected', dispatchId: item.dispatchId, reservationId, ...alert };
  }
  return {
    state: workerResult.state,
    reasonCode: workerResult.reasonCode,
    dispatchId: item.dispatchId,
    reservationId,
    alertAttempted: workerResult.alertAttempted,
    alertDelivered: workerResult.alertDelivered ?? null,
  };
}
