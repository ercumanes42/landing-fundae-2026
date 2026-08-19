import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  GraphDraftIntegrity,
  GraphDraftPayload,
  GraphMessageEvidence,
  SecureMicrosoftGraphClient,
} from './graph-secure-client';
import {
  GraphOutboxRepository,
  sha256,
  type GraphOutboxState,
  type GraphRpcResult,
} from './graph-outbox-repository';
import { hashInternetMessageId } from './graph-message-identity';
import { capabilityHash } from './mailbox-throttle';
import type { TransactionalResource } from './transactional-delivery';

const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export interface GraphDeliveryPackage {
  packaged: true;
  recipient: { email: string };
  subject: string;
  body: string;
  attachments: Array<{ filename: string; content_type: string; content_base64: string }>;
  packageHmacSha256: string;
}
export interface TransactionalGraphJob {
  reservation_id: string;
  finalize_capability: string;
  intake_capability: string;
  expected_resource: TransactionalResource | 'campaign';
  payload_sha256: string;
  package_hmac_sha256: string;
  lease_expires_at: string;
  capability_context?: string;
  recovery_only?: true;
  expected_outbox_state?: GraphOutboxState;
  recovery_draft_immutable_id?: string | null;
  recovery_draft_neutralized?: boolean;
  recovery_outcome_evidence_hash?: string | null;
  pre_registered?: true;
}

export interface GraphWorkerResult {
  state: 'off' | 'deferred' | 'confirmed_sent' | 'definitive_failed' |
    'ambiguous_halted' | 'suppressed_before_send';
  reasonCode: string;
  reservationId: string | null;
  duplicate: boolean;
  alertAttempted: boolean;
  evidenceHash?: string | null;
  retryAfterSeconds?: number;
}

interface GraphWorkerDependencies {
  repository: GraphOutboxRepository;
  client: Pick<SecureMicrosoftGraphClient,
    'createDraft' | 'sendDraft' | 'findByMarker' | 'getMessage' |
    'getDraftIntegrity' | 'deleteDraft' | 'getSentItemsFolderId'>;
  buildPackage: (input: unknown) => Promise<GraphDeliveryPackage | { packaged: false }>;
  enabled: () => boolean;
  capabilitySecret: string;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  markerPollAttempts?: number;
  sentPollAttempts?: number;
  pollIntervalMs?: number;
  alert: (event: { code: string; reservationHash: string; evidenceHash: string }) => Promise<void>;
}

function parseJob(input: unknown): TransactionalGraphJob {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Graph job is invalid');
  const value = input as Partial<TransactionalGraphJob>;
  const allowed = new Set([
    'reservation_id', 'finalize_capability', 'intake_capability', 'expected_resource',
    'payload_sha256', 'package_hmac_sha256', 'lease_expires_at', 'capability_context',
    'recovery_only', 'expected_outbox_state', 'recovery_draft_immutable_id',
    'recovery_draft_neutralized', 'recovery_outcome_evidence_hash', 'pre_registered',
  ]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${key} is not allowed`);
  if (typeof value.reservation_id !== 'string' || !UUID.test(value.reservation_id) ||
      typeof value.finalize_capability !== 'string' || !CAPABILITY.test(value.finalize_capability) ||
      typeof value.intake_capability !== 'string' || !CAPABILITY.test(value.intake_capability) ||
      typeof value.payload_sha256 !== 'string' || !HASH.test(value.payload_sha256) ||
      typeof value.package_hmac_sha256 !== 'string' || !HASH.test(value.package_hmac_sha256) ||
      typeof value.lease_expires_at !== 'string' || !Number.isFinite(Date.parse(value.lease_expires_at)) ||
      !['calculator', 'interactive_checklist', 'checklist', 'webinar', 'campaign'].includes(value.expected_resource ?? '')) {
    throw new Error('Graph job is invalid');
  }
  if (value.capability_context !== undefined &&
      (typeof value.capability_context !== 'string' || !UUID.test(value.capability_context))) {
    throw new Error('Graph capability context is invalid');
  }
  if ((value.recovery_only !== undefined || value.expected_outbox_state !== undefined) &&
      (value.recovery_only !== true ||
        !['reserved', 'draft_creating', 'draft_created', 'send_submitted',
          'confirmed_sent', 'definitive_failed', 'ambiguous_halted',
          'suppressed_before_send'].includes(value.expected_outbox_state ?? ''))) {
    throw new Error('Graph recovery context is invalid');
  }
  if (value.recovery_only === true && (
    !('recovery_draft_immutable_id' in value) ||
    (value.recovery_draft_immutable_id !== null &&
      (typeof value.recovery_draft_immutable_id !== 'string' ||
        value.recovery_draft_immutable_id.length === 0 ||
        value.recovery_draft_immutable_id.length > 2048)) ||
    typeof value.recovery_draft_neutralized !== 'boolean' ||
    !('recovery_outcome_evidence_hash' in value) ||
    (value.recovery_outcome_evidence_hash !== null &&
      (typeof value.recovery_outcome_evidence_hash !== 'string' ||
        !HASH.test(value.recovery_outcome_evidence_hash)))
  )) {
    throw new Error('Graph recovery evidence is invalid');
  }
  if (value.recovery_only === true && value.expected_outbox_state === 'suppressed_before_send' &&
      (value.recovery_draft_immutable_id === null ||
        value.recovery_draft_neutralized !== false ||
        value.recovery_outcome_evidence_hash === null)) {
    throw new Error('Graph suppressed recovery evidence is invalid');
  }
  if (value.recovery_only === true &&
      ['draft_created', 'send_submitted'].includes(value.expected_outbox_state ?? '') &&
      value.recovery_draft_immutable_id === null) {
    throw new Error('Graph recovered draft identity is invalid');
  }
  if (value.pre_registered !== undefined && (value.pre_registered !== true || value.expected_resource !== 'campaign' || !value.capability_context)) {
    throw new Error('Graph pre-registered context is invalid');
  }
  return value as TransactionalGraphJob;
}

function derive(secret: string, purpose: string, reservationId: string): Buffer {
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Graph capability secret is unavailable');
  return createHmac('sha256', secret)
    .update(`fundae-graph-${purpose}-v1\0${reservationId}`, 'utf8')
    .digest();
}

function graphPayload(deliveryPackage: GraphDeliveryPackage, marker: string): GraphDraftPayload {
  return {
    recipient: deliveryPackage.recipient.email,
    subject: deliveryPackage.subject,
    htmlBody: deliveryPackage.body,
    marker,
    attachments: deliveryPackage.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.content_type,
      contentBase64: attachment.content_base64,
    })),
  };
}

function sameAttachments(left: GraphDraftIntegrity['attachments'], right: GraphDraftPayload['attachments']): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item.filename === right[index].filename &&
    item.contentType === right[index].contentType &&
    timingSafeEqual(
      Buffer.from(sha256(item.contentBase64), 'hex'),
      Buffer.from(sha256(right[index].contentBase64), 'hex'),
    ));
}

function draftMatches(
  draft: GraphDraftIntegrity,
  expected: GraphDraftPayload,
  immutableId: string,
  expectedChangeKeyHash: string,
): boolean {
  return draft.id === immutableId && draft.isDraft === true && draft.marker === expected.marker &&
    draft.recipients.length === 1 &&
    draft.recipients[0].trim().toLowerCase() === expected.recipient.trim().toLowerCase() &&
    draft.subject === expected.subject && draft.htmlBody === expected.htmlBody &&
    draft.changeKey !== null && sha256(draft.changeKey) === expectedChangeKeyHash &&
    sameAttachments(draft.attachments, expected.attachments);
}

function isLeaseFresh(job: TransactionalGraphJob, now: () => number): boolean {
  return Date.parse(job.lease_expires_at) > now() + 1_000;
}

function terminalRegistration(result: GraphRpcResult): GraphWorkerResult | null {
  if (result.reasonCode === 'confirmed_sent') {
    return { state: 'confirmed_sent', reasonCode: result.reasonCode, reservationId: result.reservationId, duplicate: true, alertAttempted: false };
  }
  if (result.reasonCode === 'definitive_failed') {
    return { state: 'definitive_failed', reasonCode: result.reasonCode, reservationId: result.reservationId, duplicate: true, alertAttempted: false };
  }
  if (result.reasonCode === 'suppressed_before_send') {
    return { state: 'suppressed_before_send', reasonCode: result.reasonCode, reservationId: result.reservationId, duplicate: true, alertAttempted: false };
  }
  return null;
}

async function recoverMarker(
  client: GraphWorkerDependencies['client'],
  marker: string,
  attempts: number,
  sleep: (milliseconds: number) => Promise<void>,
  interval: number,
): Promise<{ kind: 'one'; message: GraphMessageEvidence } | { kind: 'zero' | 'multiple' }> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const matches = await client.findByMarker(marker);
    if (matches.length > 1) return { kind: 'multiple' };
    if (matches.length === 1) return { kind: 'one', message: matches[0] };
    if (attempt < attempts) await sleep(interval);
  }
  return { kind: 'zero' };
}

async function executeAlert(
  deps: GraphWorkerDependencies,
  job: TransactionalGraphJob,
  code: string,
  evidenceHash: string,
): Promise<boolean> {
  try {
    await deps.alert({
      code,
      reservationHash: sha256(job.reservation_id),
      evidenceHash,
    });
  } catch {
    return true;
  }
  return true;
}

async function halt(
  deps: GraphWorkerDependencies,
  job: TransactionalGraphJob,
  finalizeCapabilityHash: string,
  code: string,
  detail: string,
): Promise<GraphWorkerResult> {
  const evidenceHash = sha256(`graph-halt-v1\0${job.reservation_id}\0${code}\0${detail}`);
  const result = await deps.repository.fail({
    reservationId: job.reservation_id,
    finalizeCapabilityHash,
    outcome: 'ambiguous_halted',
    failureCode: code,
    evidenceHash,
  });
  return {
    state: 'ambiguous_halted',
    reasonCode: result.reasonCode,
    reservationId: result.reservationId,
    duplicate: result.duplicate,
    alertAttempted: await executeAlert(deps, job, code, evidenceHash),
    evidenceHash,
  };
}

async function confirmIfSent(
  deps: GraphWorkerDependencies,
  job: TransactionalGraphJob,
  finalizeCapabilityHash: string,
  immutableId: string,
  marker: string,
  deliveryPackage: GraphDeliveryPackage,
): Promise<GraphWorkerResult | null> {
  const sleep = deps.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const attempts = Math.min(30, Math.max(1, deps.sentPollAttempts ?? 10));
  const interval = Math.max(0, deps.pollIntervalMs ?? 2_000);
  const sentFolderId = await deps.client.getSentItemsFolderId();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const message = await deps.client.getMessage(immutableId);
    if (message && message.id !== immutableId) {
      return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_ID_MISMATCH', sha256(message.id));
    }
    if (message?.isDraft === false && message.parentFolderId === sentFolderId &&
        message.internetMessageId && message.sentDateTime) {
      const matches = await deps.client.findByMarker(marker);
      if (matches.length !== 1 || matches[0].id !== immutableId) {
        return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_MARKER_MATCHES', String(matches.length));
      }
      const internetMessageIdHash = hashInternetMessageId(message.internetMessageId);
      const sentItemsEvidenceHash = sha256(JSON.stringify({
        reservationId: job.reservation_id,
        immutableId,
        internetMessageIdHash,
        sentDateTime: message.sentDateTime,
        parentFolderId: message.parentFolderId,
        packageHmacSha256: deliveryPackage.packageHmacSha256,
        marker,
      }));
      const confirmed = await deps.repository.confirmSent({
        reservationId: job.reservation_id,
        finalizeCapabilityHash,
        immutableId,
        internetMessageIdHash,
        sentItemsEvidenceHash,
      });
      if (!confirmed.accepted) {
        return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_CONFIRM_REJECTED', confirmed.reasonCode);
      }
      return {
        state: 'confirmed_sent',
        reasonCode: confirmed.reasonCode,
        reservationId: confirmed.reservationId,
        duplicate: confirmed.duplicate,
        alertAttempted: false,
        evidenceHash: sentItemsEvidenceHash,
      };
    }
    if (attempt < attempts) await sleep(interval);
  }
  return null;
}

async function neutralizeDraft(
  deps: GraphWorkerDependencies,
  immutableId: string,
): Promise<string | null> {
  try {
    await deps.client.deleteDraft(immutableId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await deps.client.getMessage(immutableId) === null) {
        return sha256(`graph-neutralized-v1\0${immutableId}`);
      }
      if (attempt < 2) await (deps.sleep ?? (async () => undefined))(deps.pollIntervalMs ?? 2_000);
    }
    return null;
  } catch {
    return null;
  }
}

export async function executeTransactionalGraphJob(
  input: unknown,
  deps: GraphWorkerDependencies,
): Promise<GraphWorkerResult> {
  const job = parseJob(input);
  if (!deps.enabled()) {
    return { state: 'off', reasonCode: 'master_or_lane_disabled', reservationId: null, duplicate: false, alertAttempted: false };
  }
  const now = deps.now ?? Date.now;
  if (!isLeaseFresh(job, now)) {
    return { state: 'deferred', reasonCode: 'lease_expired_before_graph', reservationId: job.reservation_id, duplicate: false, alertAttempted: false };
  }
  const deliveryPackage = await deps.buildPackage({
    intake_capability: job.intake_capability,
    expected_resource: job.expected_resource,
  });
  if (!deliveryPackage.packaged) throw new Error('Graph package is unavailable');
  if (!timingSafeEqual(
    Buffer.from(job.package_hmac_sha256, 'hex'),
    Buffer.from(deliveryPackage.packageHmacSha256, 'hex'),
  )) throw new Error('Graph package binding is invalid');

  const finalizeCapabilityHash = capabilityHash(job.finalize_capability);
  const capabilityContext = job.capability_context ?? job.reservation_id;
  const sendCapability = derive(deps.capabilitySecret, 'send-capability', capabilityContext).toString('base64url');
  const sendCapabilityHash = capabilityHash(sendCapability);
  const marker = derive(deps.capabilitySecret, 'marker', capabilityContext).toString('hex');
  const expectedDraft = graphPayload(deliveryPackage, marker);
  const registered: GraphRpcResult = job.pre_registered
    ? { authorized: true, duplicate: true,
        reasonCode: job.recovery_only ? job.expected_outbox_state! : 'reserved',
        reservationId: job.reservation_id, opaqueMarker: marker, payloadSha256: job.payload_sha256,
        graphDraftImmutableId: job.recovery_only ? job.recovery_draft_immutable_id ?? null : null,
        mailboxHalted: job.expected_outbox_state === 'ambiguous_halted',
        leaseExpiresAt: job.lease_expires_at, retryAfterSeconds: 0 }
    : await deps.repository.registerTransactional({
        reservationId: job.reservation_id,
        finalizeCapabilityHash,
        payloadSha256: job.payload_sha256,
        sendCapabilityHash,
        opaqueMarker: marker,
      });
  if (!registered.authorized) {
    return { state: 'deferred', reasonCode: registered.reasonCode, reservationId: registered.reservationId, duplicate: registered.duplicate, alertAttempted: false };
  }
  if (job.recovery_only && (
    !registered.duplicate || registered.reasonCode !== job.expected_outbox_state
  )) {
    return halt(
      deps,
      job,
      finalizeCapabilityHash,
      'AMBIGUOUS_RECOVERY_STATE_MISMATCH',
      `${job.expected_outbox_state ?? 'missing'}:${registered.reasonCode}`,
    );
  }
  if (job.recovery_only && registered.reasonCode === 'suppressed_before_send') {
    const recovery = await recoverMarker(
      deps.client,
      marker,
      Math.min(10, Math.max(1, deps.markerPollAttempts ?? 4)),
      deps.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
      Math.max(0, deps.pollIntervalMs ?? 2_000),
    );
    if (recovery.kind !== 'one' || recovery.message.id !== job.recovery_draft_immutable_id ||
        recovery.message.isDraft !== true) {
      return halt(
        deps,
        job,
        finalizeCapabilityHash,
        recovery.kind === 'multiple'
          ? 'AMBIGUOUS_MULTIPLE_MARKERS'
          : 'AMBIGUOUS_SUPPRESSED_DRAFT_RECOVERY',
        recovery.kind === 'one' ? sha256(recovery.message.id) : recovery.kind,
      );
    }
    const neutralizationEvidenceHash = await neutralizeDraft(
      deps,
      job.recovery_draft_immutable_id,
    );
    if (!neutralizationEvidenceHash) {
      return halt(
        deps,
        job,
        finalizeCapabilityHash,
        'AMBIGUOUS_DRAFT_NEUTRALIZE',
        sha256(job.recovery_draft_immutable_id),
      );
    }
    const neutralized = await deps.repository.confirmNeutralized({
      reservationId: job.reservation_id,
      finalizeCapabilityHash,
      immutableId: job.recovery_draft_immutable_id,
      neutralizationEvidenceHash,
    });
    if (!neutralized.accepted) {
      return halt(
        deps,
        job,
        finalizeCapabilityHash,
        'AMBIGUOUS_NEUTRALIZE_CONFIRM',
        neutralized.reasonCode,
      );
    }
    return {
      state: 'suppressed_before_send',
      reasonCode: neutralized.reasonCode,
      reservationId: neutralized.reservationId,
      duplicate: neutralized.duplicate,
      alertAttempted: false,
      evidenceHash: job.recovery_outcome_evidence_hash,
    };
  }
  const terminal = terminalRegistration(registered);
  if (terminal) return terminal;
  if (job.recovery_only && registered.reasonCode === 'reserved') {
    return halt(
      deps,
      job,
      finalizeCapabilityHash,
      'AMBIGUOUS_RECOVERY_WITHOUT_DRAFT',
      sha256(job.reservation_id),
    );
  }

  const sleep = deps.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const markerAttempts = Math.min(10, Math.max(1, deps.markerPollAttempts ?? 4));
  const interval = Math.max(0, deps.pollIntervalMs ?? 2_000);
  let immutableId: string;
  let changeKeyHash: string;
  let alreadySubmitted = registered.reasonCode === 'send_submitted' || registered.reasonCode === 'ambiguous_halted';

  if (registered.duplicate && registered.reasonCode !== 'reserved') {
    const recovery = await recoverMarker(deps.client, marker, markerAttempts, sleep, interval);
    if (recovery.kind !== 'one') {
      return halt(deps, job, finalizeCapabilityHash,
        recovery.kind === 'multiple' ? 'AMBIGUOUS_MULTIPLE_MARKERS' : 'AMBIGUOUS_MARKER_ZERO', recovery.kind);
    }
    if (job.recovery_only && job.recovery_draft_immutable_id !== null &&
        recovery.message.id !== job.recovery_draft_immutable_id) {
      return halt(
        deps,
        job,
        finalizeCapabilityHash,
        'AMBIGUOUS_RECOVERY_ID_MISMATCH',
        sha256(recovery.message.id),
      );
    }
    immutableId = recovery.message.id;
    changeKeyHash = recovery.message.changeKey ? sha256(recovery.message.changeKey) : '';
    if (alreadySubmitted) {
      const sent = await confirmIfSent(deps, job, finalizeCapabilityHash, immutableId, marker, deliveryPackage);
      return sent ?? halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_SENT_POLL_TIMEOUT', sha256(immutableId));
    }
    if (!HASH.test(changeKeyHash)) {
      return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_CHANGE_KEY_MISSING', sha256(immutableId));
    }
    if (registered.reasonCode === 'draft_creating') {
      const rebound = await deps.repository.bindDraft({
        reservationId: job.reservation_id,
        finalizeCapabilityHash,
        immutableId,
        changeKeyHash,
      });
      if (!rebound.accepted) {
        return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_DRAFT_BIND_REJECTED', rebound.reasonCode);
      }
    } else if (registered.reasonCode !== 'draft_created') {
      return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_OUTBOX_STATE', registered.reasonCode);
    }
  } else {
    const begun = await deps.repository.beginDraft(job.reservation_id, finalizeCapabilityHash);
    if (!begun.accepted) {
      return { state: 'deferred', reasonCode: begun.reasonCode, reservationId: begun.reservationId, duplicate: begun.duplicate, alertAttempted: false };
    }
    if (begun.duplicate) {
      const recovery = await recoverMarker(deps.client, marker, markerAttempts, sleep, interval);
      if (recovery.kind !== 'one') {
        return halt(deps, job, finalizeCapabilityHash,
          recovery.kind === 'multiple' ? 'AMBIGUOUS_MULTIPLE_MARKERS' : 'AMBIGUOUS_MARKER_ZERO', recovery.kind);
      }
      immutableId = recovery.message.id;
      changeKeyHash = recovery.message.changeKey ? sha256(recovery.message.changeKey) : '';
    } else {
      let created: GraphMessageEvidence;
      try {
        created = await deps.client.createDraft(expectedDraft);
      } catch (error) {
        const recovery = await recoverMarker(deps.client, marker, markerAttempts, sleep, interval);
        if (recovery.kind !== 'one') {
          return halt(deps, job, finalizeCapabilityHash,
            recovery.kind === 'multiple' ? 'AMBIGUOUS_MULTIPLE_MARKERS' : 'AMBIGUOUS_CREATE_TIMEOUT', recovery.kind);
        }
        created = recovery.message;
      }
      immutableId = created.id;
      changeKeyHash = created.changeKey ? sha256(created.changeKey) : '';
    }
    if (!HASH.test(changeKeyHash)) {
      return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_CHANGE_KEY_MISSING', sha256(immutableId));
    }
    const bound = await deps.repository.bindDraft({
      reservationId: job.reservation_id,
      finalizeCapabilityHash,
      immutableId,
      changeKeyHash,
    });
    if (!bound.accepted) return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_DRAFT_BIND_REJECTED', bound.reasonCode);
  }

  const observed = await deps.client.getDraftIntegrity(immutableId);
  if (!observed || !draftMatches(observed, expectedDraft, immutableId, changeKeyHash)) {
    return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_DRAFT_INTEGRITY', sha256(immutableId));
  }
  if (!deps.enabled() || !isLeaseFresh(job, now)) {
    const neutralizationEvidenceHash = await neutralizeDraft(deps, immutableId);
    if (!neutralizationEvidenceHash) {
      return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_DRAFT_NEUTRALIZE', sha256(immutableId));
    }
    const terminalEvidenceHash = neutralizationEvidenceHash;
    const stopped = await deps.repository.fail({
      reservationId: job.reservation_id,
      finalizeCapabilityHash,
      outcome: 'definitive_failed',
      failureCode: 'DEFINITIVE_STOP_BEFORE_SEND',
      evidenceHash: terminalEvidenceHash,
    });
    return { state: 'definitive_failed', reasonCode: stopped.reasonCode, reservationId: stopped.reservationId, duplicate: stopped.duplicate, alertAttempted: false, evidenceHash: terminalEvidenceHash };
  }

  const stopSnapshotHash = sha256(JSON.stringify({
    reservationId: job.reservation_id,
    payloadSha256: job.payload_sha256,
    packageHmacSha256: job.package_hmac_sha256,
    marker,
    observedChangeKeyHash: changeKeyHash,
  }));
  const authorized = await deps.repository.authorizeSend({
    reservationId: job.reservation_id,
    sendCapabilityHash,
    stopSnapshotHash,
    observedChangeKeyHash: changeKeyHash,
  });
  if (!authorized.authorized) {
    if (authorized.reasonCode === 'replay_blocked') {
      const sent = await confirmIfSent(deps, job, finalizeCapabilityHash, immutableId, marker, deliveryPackage);
      return sent ?? halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_SENT_POLL_TIMEOUT', sha256(immutableId));
    }
    if (authorized.reasonCode === 'send_cadence') {
      return {
        state: 'deferred', reasonCode: authorized.reasonCode,
        reservationId: authorized.reservationId, duplicate: authorized.duplicate,
        alertAttempted: false, retryAfterSeconds: authorized.retryAfterSeconds,
      };
    }
    if (authorized.reasonCode === 'change_key_mismatch_ambiguous_halted') {
      await executeAlert(deps, job, 'AMBIGUOUS_CHANGE_KEY_MISMATCH', stopSnapshotHash);
      return {
        state: 'ambiguous_halted', reasonCode: authorized.reasonCode,
        reservationId: authorized.reservationId, duplicate: authorized.duplicate,
        alertAttempted: true, evidenceHash: stopSnapshotHash,
      };
    }
    const neutralizationEvidenceHash = await neutralizeDraft(deps, immutableId);
    if (!neutralizationEvidenceHash) {
      return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_DRAFT_NEUTRALIZE', sha256(immutableId));
    }
    if (authorized.reasonCode === 'draft_neutralization_required') {
      const neutralized = await deps.repository.confirmNeutralized({
        reservationId: job.reservation_id,
        finalizeCapabilityHash,
        immutableId,
        neutralizationEvidenceHash,
      });
      if (!neutralized.accepted) {
        return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_NEUTRALIZE_CONFIRM', neutralized.reasonCode);
      }
      return {
        state: 'suppressed_before_send', reasonCode: neutralized.reasonCode,
        reservationId: neutralized.reservationId, duplicate: neutralized.duplicate,
        alertAttempted: false, evidenceHash: stopSnapshotHash,
      };
    }
    return { state: 'deferred', reasonCode: authorized.reasonCode, reservationId: authorized.reservationId, duplicate: authorized.duplicate, alertAttempted: false };
  }
  if (authorized.graphDraftImmutableId !== immutableId || !deps.enabled() || !isLeaseFresh(job, now)) {
    return halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_POST_AUTHORIZE_GUARD', sha256(immutableId));
  }

  try {
    await deps.client.sendDraft(immutableId);
  } catch {
    const sent = await confirmIfSent(deps, job, finalizeCapabilityHash, immutableId, marker, deliveryPackage);
    return sent ?? halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_SEND_OUTCOME', sha256(immutableId));
  }
  const sent = await confirmIfSent(deps, job, finalizeCapabilityHash, immutableId, marker, deliveryPackage);
  return sent ?? halt(deps, job, finalizeCapabilityHash, 'AMBIGUOUS_SENT_POLL_TIMEOUT', sha256(immutableId));
}
