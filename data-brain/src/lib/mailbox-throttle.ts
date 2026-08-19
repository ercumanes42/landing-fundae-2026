import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { env, isOutboundCapabilityEnabled } from './env';
import { callRpc } from './supabase';
import {
  buildTransactionalDeliveryPackage,
  transactionalPackageHmacSha256,
} from './transactional-delivery-package';
import type { TransactionalResource } from './transactional-delivery';

const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const DEFINITIVE_FAILURE = /^DEFINITIVE_[A-Z0-9_:-]{2,53}$/;
const AMBIGUOUS_FAILURE = /TIMEOUT|429|AMBIGUOUS|UNKNOWN|RATE_LIMIT|LEASE_EXPIRED/;

export type MailboxTerminalState = 'sent' | 'failed' | 'reconcile_required';

interface MailboxReservationRpcResult {
  authorized: boolean;
  reason_code: string;
  reservation_id?: string | null;
  lease_expires_at?: string | null;
  next_allowed_at?: string | null;
  batch_position?: number | null;
  retry_after_seconds?: number | null;
}

interface MailboxFinalizeRpcResult {
  accepted: boolean;
  duplicate: boolean;
  reason_code: string;
  reservation_id?: string | null;
  next_allowed_at?: string | null;
  mailbox_halted?: boolean;
}

function mailboxIdentityHash(): string {
  const value = env('MAILBOX_IDENTITY_HASH').trim().toLowerCase();
  if (!HASH.test(value)) throw new Error('MAILBOX_IDENTITY_HASH is not configured');
  return value;
}

export function capabilityHash(capability: string): string {
  return createHash('sha256').update(capability, 'utf8').digest('hex');
}

export function validateIntakeCapability(input: unknown): {
  intakeCapability: string;
  expectedResource: TransactionalResource;
  packageHmacSha256: string;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('mailbox reservation payload is invalid');
  }
  const allowed = new Set(['intake_capability', 'expected_resource', 'package_hmac_sha256']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`${key} is not allowed`);
  }
  const value = input as {
    intake_capability?: unknown;
    expected_resource?: unknown;
    package_hmac_sha256?: unknown;
  };
  if (typeof value.intake_capability !== 'string' || !CAPABILITY.test(value.intake_capability)) {
    throw new Error('intake_capability is invalid');
  }
  if (
    value.expected_resource !== 'calculator' &&
    value.expected_resource !== 'interactive_checklist' &&
    value.expected_resource !== 'checklist' &&
    value.expected_resource !== 'webinar'
  ) {
    throw new Error('expected_resource is invalid');
  }
  if (typeof value.package_hmac_sha256 !== 'string' || !HASH.test(value.package_hmac_sha256)) {
    throw new Error('package_hmac_sha256 is invalid');
  }
  return {
    intakeCapability: value.intake_capability,
    expectedResource: value.expected_resource,
    packageHmacSha256: value.package_hmac_sha256,
  };
}

export async function reserveTransactionalMailbox(input: unknown): Promise<{
  authorizedToSend: boolean;
  reasonCode: string;
  reservationId: string | null;
  finalizeCapability: string | null;
  leaseExpiresAt: string | null;
  nextAllowedAt: string | null;
  batchPosition: 1 | 2 | null;
  retryAfterSeconds: number;
}> {
  const { intakeCapability, expectedResource, packageHmacSha256 } = validateIntakeCapability(input);
  if (!isOutboundCapabilityEnabled('TRANSACTIONAL_OUTLOOK_ENABLED')) {
    return {
      authorizedToSend: false,
      reasonCode: 'outlook_disabled',
      reservationId: null,
      finalizeCapability: null,
      leaseExpiresAt: null,
      nextAllowedAt: null,
      batchPosition: null,
      retryAfterSeconds: 0,
    };
  }
  const deliveryPackage = await buildTransactionalDeliveryPackage({
    intake_capability: intakeCapability,
    expected_resource: expectedResource,
  });
  if (!deliveryPackage.packaged) throw new Error('delivery package is unavailable');
  const expectedPackageHmacSha256 = transactionalPackageHmacSha256(intakeCapability, {
    resource: deliveryPackage.resource,
    templateId: deliveryPackage.templateId,
    recipient: deliveryPackage.recipient,
    subject: deliveryPackage.subject,
    body: deliveryPackage.body,
    contentType: deliveryPackage.contentType,
    attachments: deliveryPackage.attachments,
  });
  if (!timingSafeEqual(
    Buffer.from(packageHmacSha256, 'hex'),
    Buffer.from(expectedPackageHmacSha256, 'hex'),
  )) {
    throw new Error('delivery package hash is invalid');
  }
  const finalizeCapability = randomBytes(32).toString('base64url');
  const result = await callRpc<MailboxReservationRpcResult>('reserve_transactional_mailbox_delivery', {
    p_mailbox_key_hash: mailboxIdentityHash(),
    p_intake_capability_hash: capabilityHash(intakeCapability),
    p_finalize_capability_hash: capabilityHash(finalizeCapability),
    p_package_hmac_sha256: packageHmacSha256,
  });
  if (!result || typeof result.authorized !== 'boolean' || typeof result.reason_code !== 'string') {
    throw new Error('mailbox reservation response is invalid');
  }
  const reservationId = typeof result.reservation_id === 'string' && UUID.test(result.reservation_id)
    ? result.reservation_id
    : null;
  if (result.authorized && !reservationId) throw new Error('mailbox reservation response is incomplete');
  const batchPosition = result.batch_position === 1 || result.batch_position === 2
    ? result.batch_position
    : null;

  return {
    authorizedToSend: result.authorized,
    reasonCode: result.reason_code,
    reservationId,
    finalizeCapability: result.authorized ? finalizeCapability : null,
    leaseExpiresAt: typeof result.lease_expires_at === 'string' ? result.lease_expires_at : null,
    nextAllowedAt: typeof result.next_allowed_at === 'string' ? result.next_allowed_at : null,
    batchPosition,
    retryAfterSeconds: Number.isFinite(result.retry_after_seconds)
      ? Math.max(0, Math.ceil(Number(result.retry_after_seconds)))
      : 0,
  };
}

export interface MailboxFinalizeInput {
  finalize_capability: string;
  state: MailboxTerminalState;
  provider_message_id?: string;
  failure_code?: string;
}

export function providerMessageHash(providerMessageId: string): string {
  return createHmac('sha256', env('LEAD_HASH_SECRET'))
    .update(`outlook-provider-message-v1\0${providerMessageId}`, 'utf8')
    .digest('hex');
}

export function validateMailboxFinalizeInput(input: unknown): MailboxFinalizeInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('mailbox finalization payload is invalid');
  }
  const allowed = new Set(['finalize_capability', 'state', 'provider_message_id', 'failure_code']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`${key} is not allowed`);
  }
  const value = input as Partial<MailboxFinalizeInput>;
  if (typeof value.finalize_capability !== 'string' || !CAPABILITY.test(value.finalize_capability)) {
    throw new Error('finalize_capability is invalid');
  }
  if (value.state !== 'sent' && value.state !== 'failed' && value.state !== 'reconcile_required') {
    throw new Error('mailbox state is invalid');
  }
  if (
    value.provider_message_id !== undefined &&
    (typeof value.provider_message_id !== 'string' ||
      value.provider_message_id.length < 1 ||
      value.provider_message_id.length > 512 ||
      /[\u0000-\u001f\u007f]/.test(value.provider_message_id))
  ) {
    throw new Error('provider_message_id is invalid');
  }
  if (value.failure_code !== undefined && !/^[A-Z0-9_:-]{2,64}$/.test(value.failure_code)) {
    throw new Error('failure_code is invalid');
  }
  if (value.state === 'sent' && !value.provider_message_id) {
    throw new Error('provider_message_id is required for sent');
  }
  if (value.state === 'sent' && value.failure_code) {
    throw new Error('failure_code is not allowed for sent');
  }
  if (value.state !== 'sent' && !value.failure_code) {
    throw new Error('failure_code is required for non-sent states');
  }
  if (
    value.state === 'failed' &&
    (!DEFINITIVE_FAILURE.test(value.failure_code ?? '') || AMBIGUOUS_FAILURE.test(value.failure_code ?? ''))
  ) {
    throw new Error('failed requires a definitive failure code');
  }
  return value as MailboxFinalizeInput;
}

export async function finalizeTransactionalMailbox(input: unknown): Promise<{
  accepted: boolean;
  duplicate: boolean;
  reasonCode: string;
  reservationId: string | null;
  nextAllowedAt: string | null;
  mailboxHalted: boolean;
}> {
  const value = validateMailboxFinalizeInput(input);
  const result = await callRpc<MailboxFinalizeRpcResult>('finalize_transactional_mailbox_delivery', {
    p_mailbox_key_hash: mailboxIdentityHash(),
    p_finalize_capability_hash: capabilityHash(value.finalize_capability),
    p_state: value.state,
    p_provider_message_hash: value.provider_message_id
      ? providerMessageHash(value.provider_message_id)
      : null,
    p_failure_code: value.failure_code ?? null,
  });
  if (!result || typeof result.accepted !== 'boolean' || typeof result.reason_code !== 'string') {
    throw new Error('mailbox finalization response is invalid');
  }
  return {
    accepted: result.accepted,
    duplicate: result.duplicate === true,
    reasonCode: result.reason_code,
    reservationId: typeof result.reservation_id === 'string' && UUID.test(result.reservation_id)
      ? result.reservation_id
      : null,
    nextAllowedAt: typeof result.next_allowed_at === 'string' ? result.next_allowed_at : null,
    mailboxHalted: result.mailbox_halted === true,
  };
}
