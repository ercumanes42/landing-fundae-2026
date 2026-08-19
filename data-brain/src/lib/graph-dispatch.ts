import { createHmac } from 'node:crypto';

import { capabilityHash } from './mailbox-throttle';
import { sha256, type GraphOutboxRepository } from './graph-outbox-repository';
import type { TransactionalDeliveryPackage } from './transactional-delivery-package';
import type { GraphWorkerResult, TransactionalGraphJob } from './graph-worker';

export interface GraphDispatchRunResult {
  state: 'off' | 'empty' | 'deferred' | 'confirmed_sent' | 'definitive_failed' |
    'ambiguous_halted' | 'suppressed_before_send';
  reasonCode: string;
  dispatchId: string | null;
  reservationId: string | null;
  alertAttempted?: boolean;
  alertDelivered?: boolean | null;
}

interface GraphDispatchDependencies {
  repository: GraphOutboxRepository;
  enabled: () => boolean;
  workerId: string;
  mailboxKeyHash: string;
  capabilitySecret: string;
  alert: (event: { code: string; reservationHash: string; evidenceHash: string }) => Promise<void>;
  leaseSeconds?: number;
  buildPackageBySubmission: (input: unknown) => Promise<TransactionalDeliveryPackage>;
  executeReserved: (
    job: TransactionalGraphJob,
    deliveryPackage: TransactionalDeliveryPackage,
  ) => Promise<GraphWorkerResult>;
}

async function attemptCriticalAlert(
  deps: GraphDispatchDependencies,
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
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Graph capability secret is unavailable');
  return createHmac('sha256', secret)
    .update(`fundae-graph-${purpose}-v1\0${context}`, 'utf8')
    .digest();
}

export async function executeGraphDispatchOnce(
  deps: GraphDispatchDependencies,
): Promise<GraphDispatchRunResult> {
  if (!deps.enabled()) {
    return { state: 'off', reasonCode: 'master_or_lane_disabled', dispatchId: null, reservationId: null };
  }
  const claim = await deps.repository.claimDispatch(deps.workerId, deps.leaseSeconds ?? 90);
  if (!claim.accepted) {
    return { state: 'deferred', reasonCode: claim.reasonCode, dispatchId: null, reservationId: null };
  }
  const item = claim.items[0];
  if (!item) return { state: 'empty', reasonCode: claim.reasonCode, dispatchId: null, reservationId: null };

  const finalizeCapability = derive(deps.capabilitySecret, 'finalize-capability', item.dispatchId).toString('base64url');
  const sendCapability = derive(deps.capabilitySecret, 'send-capability', item.dispatchId).toString('base64url');
  const packageCapability = derive(deps.capabilitySecret, 'package-capability', item.dispatchId).toString('base64url');
  const marker = derive(deps.capabilitySecret, 'marker', item.dispatchId).toString('hex');
  let deliveryPackage: TransactionalDeliveryPackage;
  try {
    deliveryPackage = await deps.buildPackageBySubmission({
      submission_id: item.submissionId,
      expected_resource: item.resource,
      package_capability: packageCapability,
    });
  } catch {
    const evidenceHash = sha256(`dispatch-package-unavailable-v1\0${item.dispatchId}`);
    await deps.repository.finalizeDispatch({
      dispatchId: item.dispatchId,
      workerId: deps.workerId,
      outcome: 'deferred',
      evidenceHash,
    });
    return { state: 'deferred', reasonCode: 'package_unavailable', dispatchId: item.dispatchId, reservationId: null };
  }

  let reservationId: string;
  let leaseExpiresAt: string;
  if (item.recoveryRequired) {
    if (!item.resumeExistingReservation || !item.reservationId ||
        !item.outboxState || !item.leaseExpiresAt) {
      throw new Error('Graph dispatch recovery claim is invalid');
    }
    reservationId = item.reservationId;
    leaseExpiresAt = item.leaseExpiresAt;
  } else {
    const reserved = await deps.repository.reserveDispatch({
      dispatchId: item.dispatchId,
      workerId: deps.workerId,
      mailboxKeyHash: deps.mailboxKeyHash,
      finalizeCapabilityHash: capabilityHash(finalizeCapability),
      packageHmacSha256: deliveryPackage.packageHmacSha256,
      sendCapabilityHash: capabilityHash(sendCapability),
      opaqueMarker: marker,
    });
    if (!reserved.authorized || !reserved.reservationId || !reserved.leaseExpiresAt) {
      const evidenceHash = sha256(`dispatch-reserve-deferred-v1\0${item.dispatchId}\0${reserved.reasonCode}`);
      const finalized = await deps.repository.finalizeDispatch({
        dispatchId: item.dispatchId,
        workerId: deps.workerId,
        outcome: 'deferred',
        evidenceHash,
      });
      return {
        state: 'deferred',
        reasonCode: finalized.accepted ? reserved.reasonCode : 'dispatch_finalize_rejected',
        dispatchId: item.dispatchId,
        reservationId: reserved.reservationId,
      };
    }
    reservationId = reserved.reservationId;
    leaseExpiresAt = reserved.leaseExpiresAt;
  }

  const workerResult = await deps.executeReserved({
    reservation_id: reservationId,
    finalize_capability: finalizeCapability,
    intake_capability: packageCapability,
    expected_resource: item.resource,
    payload_sha256: item.payloadSha256,
    package_hmac_sha256: deliveryPackage.packageHmacSha256,
    lease_expires_at: leaseExpiresAt,
    capability_context: item.dispatchId,
    ...(item.recoveryRequired ? {
      recovery_only: true as const,
      expected_outbox_state: item.outboxState!,
      recovery_draft_immutable_id: item.graphDraftImmutableId,
      recovery_draft_neutralized: item.draftNeutralized,
      recovery_outcome_evidence_hash: item.outcomeEvidenceHash,
    } : {}),
  }, deliveryPackage);

  if (
    (workerResult.state === 'confirmed_sent' || workerResult.state === 'definitive_failed' ||
      workerResult.state === 'ambiguous_halted' ||
      workerResult.state === 'suppressed_before_send') && workerResult.evidenceHash
  ) {
    const finalized = await deps.repository.finalizeDispatch({
      dispatchId: item.dispatchId,
      workerId: deps.workerId,
      outcome: workerResult.state,
      evidenceHash: workerResult.evidenceHash,
    });
    if (!finalized.accepted) {
      const alert = await attemptCriticalAlert(
        deps,
        'AMBIGUOUS_DISPATCH_FINALIZE_REJECTED',
        reservationId,
        workerResult.evidenceHash,
      );
      return {
        state: 'ambiguous_halted', reasonCode: 'dispatch_finalize_rejected',
        dispatchId: item.dispatchId, reservationId,
        ...alert,
      };
    }
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
