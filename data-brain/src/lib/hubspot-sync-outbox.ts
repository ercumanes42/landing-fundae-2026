import { createHash, timingSafeEqual } from 'node:crypto';

import { env, isOutboundCapabilityEnabled } from './env';
import {
  syncHubSpotCampaignContacts,
  type HubSpotCampaignContact,
  type HubSpotSyncResult,
} from './hubspot';
import { callRpc } from './supabase';

type JsonRecord = Record<string, unknown>;
type RpcClient = <T = JsonRecord>(name: string, args: JsonRecord) => Promise<T>;

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface HubSpotSyncClaimItem {
  campaignContactId: string;
  version: number;
  payloadHash: string;
  claimToken: string;
  record: HubSpotCampaignContact;
}

interface ClaimResponse {
  accepted?: boolean;
  reason_code?: string;
  items?: unknown[];
}

interface FinalizeResponse {
  accepted?: boolean;
  reason_code?: string;
}

export interface HubSpotSyncTickResult {
  state: 'off' | 'empty' | 'synced' | 'retry_wait' | 'dead_letter';
  processed: number;
  synced: number;
  retrying: number;
  deadLettered: number;
}

export interface HubSpotSyncOutboxDependencies {
  enabled(): boolean;
  workerId: string;
  rpc: RpcClient;
  sync(records: HubSpotCampaignContact[]): Promise<HubSpotSyncResult>;
  limit?: number;
  leaseSeconds?: number;
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('HubSpot sync contract is invalid');
  }
  return value as JsonRecord;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredText(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value.trim())) {
    throw new Error('HubSpot sync contract is invalid');
  }
  return value.trim();
}

function parseClaimItem(value: unknown): HubSpotSyncClaimItem {
  const item = record(value);
  const version = Number(item.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('HubSpot sync contract is invalid');
  }
  const campaignContactId = requiredText(item.campaign_contact_id, UUID);
  const payloadHash = requiredText(item.payload_hash, HASH);
  const claimToken = requiredText(item.claim_token, UUID);
  const leadId = requiredText(item.lead_id, HASH);
  const externalContactId = requiredText(item.external_contact_id, IDENTIFIER);
  const externalAccountId = requiredText(item.external_account_id, IDENTIFIER);
  const email = requiredText(item.email, EMAIL).toLowerCase();
  const campaignExternalId = requiredText(item.campaign_external_id, IDENTIFIER);
  const variant = requiredText(item.variant, /^.{1,100}$/);
  const magnet = requiredText(item.magnet, /^.{1,100}$/);
  const sequenceStatus = requiredText(item.sequence_status, /^[a-z_]{2,40}$/);
  return {
    campaignContactId,
    version,
    payloadHash,
    claimToken,
    record: {
      leadId,
      externalContactId,
      externalAccountId,
      email,
      firstName: optionalText(item.first_name),
      lastName: optionalText(item.last_name),
      companyName: optionalText(item.company_name),
      jobTitle: optionalText(item.job_title),
      companySize: optionalText(item.company_size),
      campaignExternalId,
      variant,
      magnet,
      sequenceStatus,
    },
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function workerHash(workerId: string): string {
  if (!UUID.test(workerId)) throw new Error('HUBSPOT_SYNC_WORKER_ID is invalid');
  return sha256(`hubspot-sync-worker-v1\0${workerId.toLowerCase()}`);
}

function failureForItem(result: HubSpotSyncResult, item: HubSpotSyncClaimItem): boolean {
  const identities = new Set([
    item.record.leadId,
    item.record.externalContactId,
    item.record.externalAccountId,
  ]);
  return result.failures.some((failure) => identities.has(failure.externalId));
}

async function finalize(
  deps: HubSpotSyncOutboxDependencies,
  item: HubSpotSyncClaimItem,
  worker: string,
  outcome: 'synced' | 'retryable_failure' | 'definitive_failure',
  hubspotContactId: string | null,
  failureCode: string | null,
): Promise<string> {
  const evidenceHash = sha256([
    'hubspot-sync-finalize-v1',
    item.payloadHash,
    outcome,
    hubspotContactId ?? '',
    failureCode ?? '',
  ].join('\0'));
  const result = await deps.rpc<FinalizeResponse>('finalize_hubspot_sync_outbox', {
    p_campaign_contact_id: item.campaignContactId,
    p_worker_hash: worker,
    p_claim_token: item.claimToken,
    p_version: item.version,
    p_outcome: outcome,
    p_hubspot_contact_id: hubspotContactId,
    p_evidence_hash: evidenceHash,
    p_failure_code: failureCode,
  });
  if (result.accepted !== true || typeof result.reason_code !== 'string') {
    throw new Error('HubSpot sync finalize was rejected');
  }
  return result.reason_code;
}

export async function executeHubSpotSyncTick(
  deps: HubSpotSyncOutboxDependencies,
): Promise<HubSpotSyncTickResult> {
  if (!deps.enabled()) {
    return { state: 'off', processed: 0, synced: 0, retrying: 0, deadLettered: 0 };
  }
  const worker = workerHash(deps.workerId);
  const claim = await deps.rpc<ClaimResponse>('claim_hubspot_sync_outbox', {
    p_worker_hash: worker,
    p_limit: deps.limit ?? 50,
    p_lease_seconds: deps.leaseSeconds ?? 120,
  });
  if (claim.accepted !== true) {
    if (claim.reason_code === 'hubspot_off') {
      return { state: 'off', processed: 0, synced: 0, retrying: 0, deadLettered: 0 };
    }
    throw new Error('HubSpot sync claim was rejected');
  }
  const items = (claim.items ?? []).map(parseClaimItem);
  if (items.length === 0) {
    return { state: 'empty', processed: 0, synced: 0, retrying: 0, deadLettered: 0 };
  }

  let result: HubSpotSyncResult | null = null;
  let upstreamFailure = false;
  try {
    result = await deps.sync(items.map((item) => item.record));
  } catch {
    upstreamFailure = true;
  }
  let synced = 0;
  let retrying = 0;
  let deadLettered = 0;
  for (const item of items) {
    const hubspotContactId = result?.contactIds.get(item.record.leadId) ?? null;
    const failed = upstreamFailure || !result || failureForItem(result, item) || !hubspotContactId;
    const reason = await finalize(
      deps,
      item,
      worker,
      failed ? 'retryable_failure' : 'synced',
      failed ? null : hubspotContactId,
      failed ? (upstreamFailure ? 'hubspot_unavailable' : 'hubspot_partial_failure') : null,
    );
    if (!failed && ['synced', 'pending'].includes(reason)) synced += 1;
    else if (reason === 'dead_letter') deadLettered += 1;
    else retrying += 1;
  }
  return {
    state: deadLettered > 0 ? 'dead_letter' : retrying > 0 ? 'retry_wait' : 'synced',
    processed: items.length,
    synced,
    retrying,
    deadLettered,
  };
}

export function authorizeHubSpotWorkerRequest(request: Request): boolean {
  const expected = env('HUBSPOT_WORKER_SECRET');
  const authorization = request.headers.get('authorization') ?? '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export function executeConfiguredHubSpotSyncTick(): Promise<HubSpotSyncTickResult> {
  return executeHubSpotSyncTick({
    enabled: () => isOutboundCapabilityEnabled('HUBSPOT_SYNC_ENABLED'),
    workerId: env('HUBSPOT_SYNC_WORKER_ID'),
    rpc: callRpc,
    sync: syncHubSpotCampaignContacts,
  });
}
