import { createHash, randomBytes } from 'node:crypto';

import { callRpc } from './supabase';
import { env } from './env';
import { buildLeadId } from './lead-id';
import { findTransactionalLead, type TransactionalResource } from './transactional-delivery';
import {
  transactionalResourceDeliveryClaims,
  type TransactionalResourceDeliveryClaims,
} from './transactional-resources';
import type { LeadPayload } from './types';
import { validateLeadPayload } from './validation';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/;
const TRANSACTIONAL_RESOURCES = new Set<TransactionalResource>([
  'calculator',
  'interactive_checklist',
  'checklist',
  'webinar',
]);

interface IntakeClaimRpcResult {
  authorized: boolean;
  reason_code: string;
  claimed_at?: string | null;
  intake_capability_hash?: string | null;
}

function pilotRecipientAllowed(leadId: string): boolean {
  if (env('TRANSACTIONAL_PILOT_MODE').trim().toLowerCase() !== 'true') return false;
  const configured = env('TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    configured.length < 1 ||
    configured.length > 4 ||
    configured.some((value) => !/^[a-f0-9]{64}$/.test(value))
  ) {
    return false;
  }
  const allowlist = new Set(configured);
  if (allowlist.size !== configured.length) return false;
  return allowlist.has(leadId.toLowerCase());
}

export interface TransactionalIntakeClaims {
  submission_id: string;
  resource: TransactionalResource;
  event_version: '1.0';
  privacy_accepted: true;
  delivery: TransactionalResourceDeliveryClaims;
}

interface IntakeCapabilityRpcResult {
  valid: boolean;
  reason_code: string;
  submission_id?: string | null;
  resource?: TransactionalResource | null;
  payload_sha256?: string | null;
}

export function payloadSha256(rawBody: string): string {
  return createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

export async function resolveTransactionalIntakeCapability(capability: unknown): Promise<{
  valid: boolean;
  reasonCode: string;
  submissionId: string | null;
  resource: TransactionalResource | null;
  payloadSha256: string | null;
}> {
  if (typeof capability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(capability)) {
    throw new Error('intake_capability is invalid');
  }
  const result = await callRpc<IntakeCapabilityRpcResult>('resolve_transactional_intake_capability', {
    p_intake_capability_hash: createHash('sha256').update(capability, 'utf8').digest('hex'),
  });
  const resource = typeof result?.resource === 'string' && TRANSACTIONAL_RESOURCES.has(result.resource)
    ? result.resource
    : null;
  return {
    valid: result?.valid === true,
    reasonCode: typeof result?.reason_code === 'string' ? result.reason_code : 'capability_unavailable',
    submissionId: typeof result?.submission_id === 'string' ? result.submission_id : null,
    resource,
    payloadSha256: typeof result?.payload_sha256 === 'string' && /^[a-f0-9]{64}$/.test(result.payload_sha256)
      ? result.payload_sha256
      : null,
  };
}

export function validateTransactionalIntakePayload(input: unknown): LeadPayload & {
  lead_id: string;
  form_type: TransactionalResource;
  lead_magnet: TransactionalResource;
} {
  validateLeadPayload(input);
  const lead = input as LeadPayload;
  if (!TRANSACTIONAL_RESOURCES.has(lead.form_type as TransactionalResource)) {
    throw new Error('form_type is not an allowed transactional resource');
  }
  if (lead.lead_magnet !== lead.form_type) {
    throw new Error('lead_magnet must match form_type');
  }
  if (typeof lead.lead_id !== 'string' || !IDENTIFIER.test(lead.lead_id)) {
    throw new Error('lead_id is invalid');
  }
  if (buildLeadId(lead.contact.email) !== lead.lead_id) {
    throw new Error('lead identity does not match contact email');
  }
  return lead as LeadPayload & {
    lead_id: string;
    form_type: TransactionalResource;
    lead_magnet: TransactionalResource;
  };
}

export async function authorizeTransactionalIntake(rawBody: string): Promise<{
  authorized: boolean;
  reasonCode: string;
  duplicate: boolean;
  claimedAt: string | null;
  payload_sha256: string;
  claims: TransactionalIntakeClaims;
  intake_capability: string | null;
}> {
  const input = validateTransactionalIntakePayload(JSON.parse(rawBody));
  const delivery = transactionalResourceDeliveryClaims(input.form_type);
  const stored = await findTransactionalLead(input.submission_id, input.lead_id);
  if (
    stored.lead_id !== buildLeadId(input.contact.email) ||
    stored.form_type !== input.form_type ||
    stored.lead_magnet !== input.lead_magnet
  ) {
    throw new Error('stored lead does not match the intake resource');
  }

  const digest = payloadSha256(rawBody);
  const capability = randomBytes(32).toString('base64url');
  const capabilityHash = createHash('sha256').update(capability, 'utf8').digest('hex');
  const result = await callRpc<IntakeClaimRpcResult>('claim_transactional_intake', {
    p_submission_id: input.submission_id,
    p_resource: input.form_type,
    p_payload_sha256: digest,
    p_intake_capability_hash: capabilityHash,
    p_pilot_recipient_allowed: pilotRecipientAllowed(input.lead_id),
  });
  const authorized = result?.authorized === true;
  const reasonCode = typeof result?.reason_code === 'string'
    ? result.reason_code
    : 'authorization_unavailable';

  return {
    authorized,
    reasonCode,
    duplicate: reasonCode === 'replay_blocked',
    claimedAt: typeof result?.claimed_at === 'string' ? result.claimed_at : null,
    payload_sha256: digest,
    claims: {
      submission_id: input.submission_id,
      resource: input.form_type,
      event_version: '1.0',
      privacy_accepted: true,
      delivery,
    },
    intake_capability: authorized ? capability : null,
  };
}
