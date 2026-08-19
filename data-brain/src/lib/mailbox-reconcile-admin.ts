import { createHmac } from 'node:crypto';

import { env } from './env';
import { providerMessageHash } from './mailbox-throttle';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const CONFIRMATION = 'APPLY_TRANSACTIONAL_MAILBOX_RECONCILIATION';
const INPUT_FIELDS = new Set([
  'reservation_id',
  'expected_state',
  'resolution',
  'provider_message_id',
  'evidence',
  'confirmation',
]);

export type MailboxReconciliationResolution = 'confirmed_sent' | 'confirmed_not_sent';

export class MailboxReconcileAdminError extends Error {
  constructor(public readonly reasonCode: string) {
    super(reasonCode);
  }
}

export interface MailboxReconcileAdminInput {
  reservation_id: string;
  expected_state: 'reconcile_required';
  resolution: MailboxReconciliationResolution;
  provider_message_id?: string;
  evidence: string;
  confirmation?: string;
}

interface ReservationSnapshot {
  id: string;
  mailbox_key_hash: string;
  lane: string;
  status: string;
  reconciliation_resolution: string | null;
  reconciliation_evidence_hash: string | null;
  provider_message_hash: string | null;
}

interface MailboxSnapshot {
  active_reservation_id: string | null;
  blocked_reservation_id: string | null;
}

interface ReconciliationRpcResult {
  accepted: boolean;
  duplicate: boolean;
  reason_code: string;
  mailbox_halted: boolean;
}

export interface MailboxReconcileAdminDependencies {
  findReservation(reservationId: string): Promise<ReservationSnapshot | null>;
  findMailbox(mailboxKeyHash: string): Promise<MailboxSnapshot | null>;
  reconcile(args: {
    reservationId: string;
    resolution: MailboxReconciliationResolution;
    providerMessageHash: string | null;
    evidenceHash: string;
  }): Promise<ReconciliationRpcResult>;
}

export interface MailboxReconcileAdminSummary {
  status: 'validated' | 'reconciled' | 'already_reconciled';
  resolution: MailboxReconciliationResolution;
  writes: 0 | 1;
  mailbox_halted: boolean;
}

function fail(reasonCode: string): never {
  throw new MailboxReconcileAdminError(reasonCode);
}

function safeOpaqueText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

export function reconciliationEvidenceHash(evidence: string): string {
  return createHmac('sha256', env('LEAD_HASH_SECRET'))
    .update(`transactional-reconciliation-evidence-v1\0${evidence}`, 'utf8')
    .digest('hex');
}

export function validateMailboxReconcileAdminInput(
  input: unknown,
  apply: boolean,
): MailboxReconcileAdminInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('input_invalid');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !INPUT_FIELDS.has(key))) fail('input_invalid');
  if (typeof value.reservation_id !== 'string' || !UUID.test(value.reservation_id)) fail('input_invalid');
  if (value.expected_state !== 'reconcile_required') fail('input_invalid');
  if (value.resolution !== 'confirmed_sent' && value.resolution !== 'confirmed_not_sent') fail('input_invalid');
  if (!safeOpaqueText(value.evidence, 2_048)) fail('evidence_invalid');
  if (value.resolution === 'confirmed_sent') {
    if (!safeOpaqueText(value.provider_message_id, 512)) fail('provider_message_id_invalid');
  } else if (value.provider_message_id !== undefined) {
    fail('provider_message_id_invalid');
  }
  if (apply && value.confirmation !== CONFIRMATION) fail('confirmation_required');
  if (!apply && value.confirmation !== undefined) fail('confirmation_not_allowed');
  return value as unknown as MailboxReconcileAdminInput;
}

export async function reconcileTransactionalMailboxAdmin(
  input: unknown,
  apply: boolean,
  dependencies: MailboxReconcileAdminDependencies,
): Promise<MailboxReconcileAdminSummary> {
  const value = validateMailboxReconcileAdminInput(input, apply);
  const reservation = await dependencies.findReservation(value.reservation_id);
  if (!reservation || reservation.id !== value.reservation_id || reservation.lane !== 'transactional') {
    fail('reservation_unavailable');
  }
  if (!HASH.test(reservation.mailbox_key_hash)) fail('reservation_state_invalid');
  const mailbox = await dependencies.findMailbox(reservation.mailbox_key_hash);
  if (!mailbox) fail('mailbox_unavailable');

  if (reservation.reconciliation_resolution !== null) {
    const expectedProviderHash = value.provider_message_id
      ? providerMessageHash(value.provider_message_id)
      : null;
    if (
      reservation.reconciliation_resolution !== value.resolution ||
      reservation.reconciliation_evidence_hash !== reconciliationEvidenceHash(value.evidence) ||
      reservation.provider_message_hash !== expectedProviderHash
    ) fail('reconciliation_conflict');
    return {
      status: 'already_reconciled',
      resolution: value.resolution,
      writes: 0,
      mailbox_halted: mailbox.blocked_reservation_id !== null,
    };
  }
  if (
    reservation.status !== 'reconcile_required' ||
    mailbox.blocked_reservation_id !== reservation.id ||
    mailbox.active_reservation_id !== null
  ) {
    fail('reconciliation_state_invalid');
  }
  if (!apply) {
    return { status: 'validated', resolution: value.resolution, writes: 0, mailbox_halted: true };
  }

  const result = await dependencies.reconcile({
    reservationId: value.reservation_id,
    resolution: value.resolution,
    providerMessageHash: value.provider_message_id
      ? providerMessageHash(value.provider_message_id)
      : null,
    evidenceHash: reconciliationEvidenceHash(value.evidence),
  });
  if (!result || result.accepted !== true) fail('reconciliation_rejected');
  return {
    status: result.duplicate ? 'already_reconciled' : 'reconciled',
    resolution: value.resolution,
    writes: result.duplicate ? 0 : 1,
    mailbox_halted: result.mailbox_halted === true,
  };
}
