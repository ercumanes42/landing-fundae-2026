import { createHash } from 'node:crypto';

import { env, isOutboundCapabilityEnabled } from './env';

export const HUBSPOT_CONTACT_ID_PROPERTY = 'fundae_lead_id';
export const HUBSPOT_CAMPAIGN_CONTACT_ID_PROPERTY = 'fundae_contact_id';
export const HUBSPOT_COMPANY_ID_PROPERTY = 'fundae_account_id';
export const HUBSPOT_TASK_ID_PROPERTY = 'fundae_task_idempotency_key';

export type HubSpotManifestObject = 'contacts' | 'companies' | 'tasks';

export interface HubSpotPropertyExpectation {
  name: string;
  acceptedTypes: readonly string[];
  unique: boolean;
}

const property = (
  name: string,
  acceptedTypes: readonly string[] = ['string'],
  unique = false,
): HubSpotPropertyExpectation => ({ name, acceptedTypes, unique });

/** Every HubSpot property read or written by the FUNDAE runtime. */
export const HUBSPOT_PROPERTY_MANIFEST: Readonly<Record<HubSpotManifestObject, readonly HubSpotPropertyExpectation[]>> = {
  contacts: [
    property('email'),
    property('firstname'),
    property('lastname'),
    property('company'),
    property('jobtitle'),
    property(HUBSPOT_CONTACT_ID_PROPERTY, ['string'], true),
    property(HUBSPOT_CAMPAIGN_CONTACT_ID_PROPERTY),
    property(HUBSPOT_COMPANY_ID_PROPERTY),
    property('fundae_campaign_id'),
    property('fundae_variant'),
    property('fundae_magnet'),
    property('fundae_sequence_status', ['string', 'enumeration']),
    property('fundae_company_size', ['string', 'enumeration']),
    property('fundae_reply_type', ['string', 'enumeration']),
    property('fundae_pipeline_value', ['number']),
    property('fundae_positive_reply_at', ['datetime']),
    property('fundae_suppression_scope', ['string', 'enumeration']),
    property('fundae_suppression_reason', ['string', 'enumeration']),
    property('fundae_unsubscribed_at', ['datetime']),
    property('fundae_hard_bounce_at', ['datetime']),
    property('fundae_meeting_status', ['string', 'enumeration']),
    property('fundae_opportunity_status', ['string', 'enumeration']),
  ],
  companies: [
    property('name'),
    property(HUBSPOT_COMPANY_ID_PROPERTY, ['string'], true),
    property('fundae_campaign_id'),
    property('fundae_company_size', ['string', 'enumeration']),
  ],
  tasks: [
    property(HUBSPOT_TASK_ID_PROPERTY, ['string'], true),
    property('hs_timestamp', ['datetime']),
    property('hs_task_subject'),
    property('hs_task_body'),
    property('hs_task_status', ['enumeration']),
    property('hs_task_priority', ['enumeration']),
    property('hs_task_type', ['enumeration']),
  ],
};

export type HubSpotPreflightFailureCode =
  | 'configuration_invalid'
  | 'upstream_access_denied'
  | 'upstream_partial_response'
  | 'upstream_unavailable'
  | 'portal_mismatch'
  | 'property_missing'
  | 'property_type_mismatch'
  | 'property_uniqueness_mismatch';

export type HubSpotPreflightReport =
  | {
      ok: true;
      mode: 'read_only';
      portal: { matches_expected: true };
      objects: Record<HubSpotManifestObject, { checked_properties: number }>;
    }
  | {
      ok: false;
      mode: 'read_only';
      failure_code: HubSpotPreflightFailureCode;
      check?: { object: HubSpotManifestObject; property: string };
    };

export interface HubSpotCampaignContact {
  leadId: string;
  externalContactId: string;
  externalAccountId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  jobTitle?: string;
  companySize?: string;
  campaignExternalId: string;
  variant: string;
  magnet: string;
  sequenceStatus: string;
}

export interface HubSpotSyncFailure {
  externalId: string;
  stage: 'contact' | 'company' | 'association';
  reason: 'rejected' | 'missing_result' | 'association_failed';
}

export interface HubSpotSyncResult {
  contactIds: Map<string, string>;
  companyIds: Map<string, string>;
  failures: HubSpotSyncFailure[];
}

export interface HubSpotWebhookEvent {
  sourceEventId: string;
  hubspotContactId: string;
  propertyName: string;
  propertyValue: string;
  occurredAt: string;
}

type HubSpotBatchResult = {
  id?: string;
  objectWriteTraceId?: string;
};

type HubSpotBatchError = {
  category?: string;
  context?: { objectWriteTraceId?: string[] };
};

type HubSpotBatchResponse = {
  status?: string;
  numErrors?: number;
  results?: HubSpotBatchResult[];
  errors?: HubSpotBatchError[];
};

type HubSpotPropertyResponse = {
  name?: string;
  type?: string;
  hasUniqueValue?: boolean;
};

class HubSpotRequestError extends Error {
  constructor(readonly status: number) {
    super('HubSpot request failed');
  }
}

type BatchOutcome = {
  ids: Map<string, string>;
  rejected: Set<string>;
};

function apiVersion(): string {
  const value = env('HUBSPOT_API_VERSION').trim();
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error('HUBSPOT_API_VERSION is invalid');
  return value;
}

export function isHubSpotSyncEnabled(): boolean {
  return isOutboundCapabilityEnabled('HUBSPOT_SYNC_ENABLED');
}

function assertHubSpotConfigured(): void {
  if (!env('HUBSPOT_ACCESS_TOKEN')) throw new Error('HUBSPOT_ACCESS_TOKEN is not configured');
}

function assertHubSpotWriteEnabled(): void {
  if (!isHubSpotSyncEnabled()) throw new Error('HUBSPOT_SYNC_ENABLED is false');
  assertHubSpotConfigured();
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

async function requestHubSpot<T>(
  path: string,
  init: RequestInit,
  access: 'read' | 'write' = 'write',
): Promise<T> {
  if (access === 'read') assertHubSpotConfigured();
  else assertHubSpotWriteEnabled();
  const response = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env('HUBSPOT_ACCESS_TOKEN')}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    category?: string;
    correlationId?: string;
  };
  const accepted = access === 'read'
    ? response.status === 200
    : response.ok || response.status === 207;
  if (!accepted) {
    throw new HubSpotRequestError(response.status);
  }
  return body;
}

function definedProperties(
  entries: Record<string, string | null | undefined>,
): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!/^[a-z][a-z0-9_]{0,99}$/.test(key)) throw new Error('Invalid HubSpot property name');
    if (value !== undefined && value !== null) properties[key] = value;
  }
  return properties;
}

export function hubSpotContactProperties(record: HubSpotCampaignContact): Record<string, string> {
  return definedProperties({
    email: record.email,
    firstname: record.firstName,
    lastname: record.lastName,
    company: record.companyName,
    jobtitle: record.jobTitle,
    fundae_campaign_id: record.campaignExternalId,
    [HUBSPOT_CONTACT_ID_PROPERTY]: record.leadId,
    [HUBSPOT_CAMPAIGN_CONTACT_ID_PROPERTY]: record.externalContactId,
    [HUBSPOT_COMPANY_ID_PROPERTY]: record.externalAccountId,
    fundae_variant: record.variant,
    fundae_magnet: record.magnet,
    fundae_sequence_status: record.sequenceStatus,
    fundae_company_size: record.companySize,
  });
}

function deduplicateContacts(records: HubSpotCampaignContact[]): HubSpotCampaignContact[] {
  const unique = new Map<string, HubSpotCampaignContact>();
  for (const record of records) {
    if (!/^[a-f0-9]{64}$/.test(record.leadId)) throw new Error('Invalid canonical lead identity');
    const existing = unique.get(record.leadId);
    if (existing && existing.email.trim().toLowerCase() !== record.email.trim().toLowerCase()) {
      throw new Error('Conflicting contact identity');
    }
    if (!existing ||
        `${record.campaignExternalId}\0${record.externalContactId}` <
        `${existing.campaignExternalId}\0${existing.externalContactId}`) {
      unique.set(record.leadId, record);
    }
  }
  return [...unique.values()].sort((left, right) => left.leadId.localeCompare(right.leadId));
}

function deduplicateCompanies(records: HubSpotCampaignContact[]): HubSpotCampaignContact[] {
  const unique = new Map<string, HubSpotCampaignContact>();
  for (const record of records) {
    const existing = unique.get(record.externalAccountId);
    const currentName = record.companyName?.trim().toLowerCase();
    const existingName = existing?.companyName?.trim().toLowerCase();
    if (existing && currentName && existingName && currentName !== existingName) {
      throw new Error('Conflicting company identity');
    }
    if (!existing ||
        `${record.campaignExternalId}\0${record.externalContactId}` <
        `${existing.campaignExternalId}\0${existing.externalContactId}`) {
      unique.set(record.externalAccountId, record);
    }
  }
  return [...unique.values()].sort((left, right) =>
    left.externalAccountId.localeCompare(right.externalAccountId));
}

function batchOutcome(
  response: HubSpotBatchResponse,
  expectedTraceIds: readonly string[],
): BatchOutcome {
  if (response.status && !['COMPLETE', 'COMPLETED'].includes(response.status.toUpperCase())) {
    throw new Error('HubSpot batch did not complete synchronously');
  }
  const expected = new Set(expectedTraceIds);
  const ids = new Map<string, string>();
  const rejected = new Set<string>();
  const errors = response.errors ?? [];
  if (response.numErrors !== undefined &&
      (!Number.isSafeInteger(response.numErrors) || response.numErrors < 0 ||
       (response.numErrors > 0 && errors.length === 0) ||
       (response.numErrors === 0 && errors.length > 0))) {
    throw new Error('HubSpot batch error correlation failed');
  }

  for (const result of response.results ?? []) {
    const traceId = result.objectWriteTraceId;
    if (!traceId || !result.id || !expected.has(traceId)) {
      throw new Error('HubSpot batch result correlation failed');
    }
    const previous = ids.get(traceId);
    if (previous && previous !== result.id) throw new Error('HubSpot batch result collision');
    ids.set(traceId, result.id);
  }

  for (const error of errors) {
    const traceIds = error.context?.objectWriteTraceId;
    if (!Array.isArray(traceIds) || traceIds.length === 0) {
      throw new Error('HubSpot batch error correlation failed');
    }
    for (const traceId of traceIds) {
      if (!expected.has(traceId)) throw new Error('HubSpot batch error correlation failed');
      rejected.add(traceId);
    }
  }

  for (const traceId of expected) {
    if (!ids.has(traceId) && !rejected.has(traceId)) rejected.add(traceId);
    if (ids.has(traceId) && rejected.has(traceId)) throw new Error('HubSpot batch outcome collision');
  }
  return { ids, rejected };
}

async function upsertContacts(
  records: HubSpotCampaignContact[],
): Promise<{ ids: Map<string, string>; failures: HubSpotSyncFailure[] }> {
  const unique = deduplicateContacts(records);
  const ids = new Map<string, string>();
  const failures: HubSpotSyncFailure[] = [];
  for (const group of chunk(unique, 100)) {
    const traceIds = group.map((record) => record.leadId);
    const response = await requestHubSpot<HubSpotBatchResponse>(
      `/crm/objects/${apiVersion()}/contacts/batch/upsert`,
      {
        method: 'POST',
        body: JSON.stringify({
          inputs: group.map((record) => ({
            id: record.leadId,
            idProperty: HUBSPOT_CONTACT_ID_PROPERTY,
            objectWriteTraceId: record.leadId,
            properties: hubSpotContactProperties(record),
          })),
        }),
      },
    );
    const outcome = batchOutcome(response, traceIds);
    for (const [traceId, id] of outcome.ids) ids.set(traceId, id);
    for (const externalId of outcome.rejected) failures.push({ externalId, stage: 'contact', reason: 'rejected' });
  }
  return { ids, failures };
}

function companyProperties(record: HubSpotCampaignContact): Record<string, string> {
  return definedProperties({
    name: record.companyName ?? record.externalAccountId,
    [HUBSPOT_COMPANY_ID_PROPERTY]: record.externalAccountId,
    fundae_campaign_id: record.campaignExternalId,
    fundae_company_size: record.companySize,
  });
}

async function upsertCompanies(
  records: HubSpotCampaignContact[],
): Promise<{ ids: Map<string, string>; failures: HubSpotSyncFailure[] }> {
  const unique = deduplicateCompanies(records);
  const ids = new Map<string, string>();
  const failures: HubSpotSyncFailure[] = [];
  for (const group of chunk(unique, 100)) {
    const traceIds = group.map((record) => record.externalAccountId);
    const response = await requestHubSpot<HubSpotBatchResponse>(
      `/crm/objects/${apiVersion()}/companies/batch/upsert`,
      {
        method: 'POST',
        body: JSON.stringify({
          inputs: group.map((record) => ({
            id: record.externalAccountId,
            idProperty: HUBSPOT_COMPANY_ID_PROPERTY,
            objectWriteTraceId: record.externalAccountId,
            properties: companyProperties(record),
          })),
        }),
      },
    );
    const outcome = batchOutcome(response, traceIds);
    for (const [traceId, id] of outcome.ids) ids.set(traceId, id);
    for (const externalId of outcome.rejected) failures.push({ externalId, stage: 'company', reason: 'rejected' });
  }
  return { ids, failures };
}

async function associateContactsToCompanies(
  records: HubSpotCampaignContact[],
  contactIds: Map<string, string>,
  companyIds: Map<string, string>,
): Promise<HubSpotSyncFailure[]> {
  const seen = new Set<string>();
  const inputs = records.flatMap((record) => {
    const contactId = contactIds.get(record.leadId);
    const companyId = companyIds.get(record.externalAccountId);
    if (!contactId || !companyId) return [];
    const key = `${contactId}:${companyId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ record, from: { id: contactId }, to: { id: companyId } }];
  });
  const failures: HubSpotSyncFailure[] = [];
  for (const group of chunk(inputs, 2_000)) {
    try {
      const response = await requestHubSpot<HubSpotBatchResponse>(
        `/crm/associations/${apiVersion()}/contacts/companies/batch/associate/default`,
        {
          method: 'POST',
          body: JSON.stringify({ inputs: group.map(({ from, to }) => ({ from, to })) }),
        },
      );
      const errors = response.errors ?? [];
      if ((response.status && response.status.toUpperCase() !== 'COMPLETE') ||
          (response.numErrors !== undefined &&
           (!Number.isSafeInteger(response.numErrors) || response.numErrors < 0)) ||
          (response.numErrors ?? errors.length) > 0 ||
          errors.length > 0) {
        throw new Error('HubSpot association batch contained embedded errors');
      }
    } catch {
      for (const { record } of group) {
        failures.push({ externalId: record.externalContactId, stage: 'association', reason: 'association_failed' });
      }
    }
  }
  return failures;
}

export async function syncHubSpotCampaignContacts(
  records: HubSpotCampaignContact[],
): Promise<HubSpotSyncResult> {
  assertHubSpotWriteEnabled();
  const contacts = await upsertContacts(records);
  const companies = await upsertCompanies(records);
  const companyFailures = new Set(companies.failures.map((failure) => failure.externalId));
  const missingCompanyAssociations = records
    .filter((record) => companyFailures.has(record.externalAccountId) && contacts.ids.has(record.leadId))
    .map((record) => ({
      externalId: record.externalContactId,
      stage: 'association' as const,
      reason: 'association_failed' as const,
    }));
  const associationFailures = await associateContactsToCompanies(records, contacts.ids, companies.ids);
  return {
    contactIds: contacts.ids,
    companyIds: companies.ids,
    failures: [...contacts.failures, ...companies.failures, ...missingCompanyAssociations, ...associationFailures],
  };
}

export async function updateHubSpotContact(
  leadId: string,
  properties: Record<string, string | null | undefined>,
): Promise<void> {
  const patch = definedProperties(properties);
  if (Object.keys(patch).length === 0) return;
  await requestHubSpot(
    `/crm/objects/${apiVersion()}/contacts/${encodeURIComponent(leadId)}?idProperty=${HUBSPOT_CONTACT_ID_PROPERTY}`,
    { method: 'PATCH', body: JSON.stringify({ properties: patch }) },
  );
}

export async function upsertPositiveReplyTask(input: {
  campaignExternalId: string;
  externalContactId: string;
  hubspotContactId: string;
  sourceEventId: string;
  occurredAt: string;
}): Promise<{ taskId: string; idempotencyKey: string }> {
  if (!/^\d+$/.test(input.hubspotContactId)) throw new Error('HubSpot contact association is invalid');
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new Error('Positive reply timestamp is invalid');
  const idempotencyKey = createHash('sha256')
    .update(`fundae:positive-reply:v1:${input.campaignExternalId}:${input.externalContactId}:${input.sourceEventId}`)
    .digest('hex');
  const response = await requestHubSpot<HubSpotBatchResponse>(
    `/crm/objects/${apiVersion()}/tasks/batch/upsert`,
    {
      method: 'POST',
      body: JSON.stringify({
        inputs: [{
          id: idempotencyKey,
          idProperty: HUBSPOT_TASK_ID_PROPERTY,
          objectWriteTraceId: idempotencyKey,
          properties: {
            [HUBSPOT_TASK_ID_PROPERTY]: idempotencyKey,
            hs_timestamp: occurredAt.toISOString(),
            hs_task_subject: 'Follow up FUNDAE positive reply',
            hs_task_body: `Campaign ${input.campaignExternalId}; contact ${input.externalContactId}.`,
            hs_task_status: 'NOT_STARTED',
            hs_task_priority: 'HIGH',
            hs_task_type: 'TODO',
          },
        }],
      }),
    },
  );
  const outcome = batchOutcome(response, [idempotencyKey]);
  const taskId = outcome.ids.get(idempotencyKey);
  if (!taskId || outcome.rejected.size > 0) throw new Error('HubSpot task upsert was rejected');
  await requestHubSpot(
    `/crm/objects/${apiVersion()}/tasks/${encodeURIComponent(taskId)}/associations/contacts/${encodeURIComponent(input.hubspotContactId)}/task_to_contact`,
    { method: 'PUT' },
  );
  return { taskId, idempotencyKey };
}

function numericString(value: unknown): string | null {
  if ((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
      (typeof value === 'string' && /^\d+$/.test(value))) return String(value);
  return null;
}

export function parseHubSpotWebhookEvent(value: unknown, expectedPortalId: string): HubSpotWebhookEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid HubSpot webhook event');
  const event = value as Record<string, unknown>;
  const objectId = numericString(event.objectId);
  const eventId = numericString(event.eventId);
  const subscriptionId = numericString(event.subscriptionId);
  const portalId = numericString(event.portalId);
  const appId = numericString(event.appId);
  const occurredAt = numericString(event.occurredAt);
  const typeA = typeof event.subscriptionType === 'string' ? event.subscriptionType : '';
  const typeB = typeof event.eventType === 'string' ? event.eventType : '';
  const eventType = typeA || typeB;
  if (typeA && typeB && typeA !== typeB) throw new Error('HubSpot webhook type collision');
  if (!objectId || !eventId || !subscriptionId || !portalId || !appId || !occurredAt ||
      eventType !== 'contact.propertyChange') throw new Error('Incomplete HubSpot webhook correlation');
  if (!/^\d+$/.test(expectedPortalId) || portalId !== expectedPortalId) throw new Error('HubSpot portal mismatch');
  const timestamp = Number(occurredAt);
  const date = new Date(timestamp);
  if (!Number.isSafeInteger(timestamp) || Number.isNaN(date.getTime())) throw new Error('Invalid HubSpot event timestamp');
  const propertyName = typeof event.propertyName === 'string' ? event.propertyName.trim() : '';
  const propertyValue = typeof event.propertyValue === 'string' ? event.propertyValue.trim().toLowerCase() : '';
  if (!propertyName || propertyName.length > 100 || propertyValue.length > 1_000) {
    throw new Error('Invalid HubSpot property event');
  }
  const allowedPropertyValues: Record<string, Set<string>> = {
    fundae_meeting_status: new Set(['booked', 'confirmed']),
    fundae_opportunity_status: new Set(['created', 'opportunity']),
    fundae_reply_type: new Set(['positive']),
    fundae_suppression_reason: new Set(['unsubscribe', 'hard_bounce', 'bounce_hard', 'opposition']),
    fundae_sequence_status: new Set(['pending', 'active', 'stopped', 'completed']),
  };
  if (!allowedPropertyValues[propertyName]?.has(propertyValue)) {
    throw new Error('Unsupported HubSpot property event');
  }
  const propertyValueHash = createHash('sha256').update(propertyValue).digest('hex');
  const sourceEventId = `hs:${createHash('sha256').update(JSON.stringify({
    portalId, appId, subscriptionId, eventId, objectId, occurredAt, eventType, propertyName, propertyValueHash,
  })).digest('hex')}`;
  return { sourceEventId, hubspotContactId: objectId, propertyName, propertyValue, occurredAt: date.toISOString() };
}

function configuredPortalId(): string {
  const value = env('HUBSPOT_PORTAL_ID').trim();
  if (!/^[1-9]\d{0,19}$/.test(value)) throw new Error('HubSpot preflight configuration is invalid');
  return value;
}

async function readHubSpotPortalId(): Promise<string | null> {
  const details = await requestHubSpot<{ portalId?: unknown }>(
    `/account-info/${apiVersion()}/details`,
    { method: 'GET' },
    'read',
  );
  const value = typeof details.portalId === 'number' && Number.isSafeInteger(details.portalId)
    ? String(details.portalId)
    : typeof details.portalId === 'string' && /^[1-9]\d{0,19}$/.test(details.portalId)
      ? details.portalId
      : null;
  return value;
}

async function readHubSpotPropertyCatalog(
  objectType: HubSpotManifestObject,
): Promise<Map<string, HubSpotPropertyResponse> | null> {
  const body = await requestHubSpot<{ results?: unknown }>(
    `/crm/properties/${apiVersion()}/${objectType}`,
    { method: 'GET' },
    'read',
  );
  if (!Array.isArray(body.results)) return null;
  const properties = new Map<string, HubSpotPropertyResponse>();
  for (const raw of body.results) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const candidate = raw as HubSpotPropertyResponse;
    if (typeof candidate.name !== 'string' || properties.has(candidate.name)) return null;
    properties.set(candidate.name, candidate);
  }
  return properties;
}

function upstreamFailure(error: unknown): HubSpotPreflightReport {
  if (error instanceof HubSpotRequestError) {
    if (error.status === 401 || error.status === 403) {
      return { ok: false, mode: 'read_only', failure_code: 'upstream_access_denied' };
    }
    if (error.status === 207) {
      return { ok: false, mode: 'read_only', failure_code: 'upstream_partial_response' };
    }
  }
  return { ok: false, mode: 'read_only', failure_code: 'upstream_unavailable' };
}

export async function testHubSpotConnection(): Promise<HubSpotPreflightReport> {
  let expectedPortalId: string;
  try {
    assertHubSpotConfigured();
    apiVersion();
    expectedPortalId = configuredPortalId();
  } catch {
    return { ok: false, mode: 'read_only', failure_code: 'configuration_invalid' };
  }

  let observedPortalId: string | null;
  try {
    observedPortalId = await readHubSpotPortalId();
  } catch (error) {
    return upstreamFailure(error);
  }
  if (!observedPortalId) {
    return { ok: false, mode: 'read_only', failure_code: 'upstream_unavailable' };
  }
  if (observedPortalId !== expectedPortalId) {
    return { ok: false, mode: 'read_only', failure_code: 'portal_mismatch' };
  }

  const objects = {} as Record<HubSpotManifestObject, { checked_properties: number }>;
  for (const objectType of Object.keys(HUBSPOT_PROPERTY_MANIFEST) as HubSpotManifestObject[]) {
    let catalog: Map<string, HubSpotPropertyResponse> | null;
    try {
      catalog = await readHubSpotPropertyCatalog(objectType);
    } catch (error) {
      return upstreamFailure(error);
    }
    if (!catalog) {
      return { ok: false, mode: 'read_only', failure_code: 'upstream_unavailable' };
    }
    for (const expected of HUBSPOT_PROPERTY_MANIFEST[objectType]) {
      const observed = catalog.get(expected.name);
      const check = { object: objectType, property: expected.name };
      if (!observed) {
        return { ok: false, mode: 'read_only', failure_code: 'property_missing', check };
      }
      if (typeof observed.type !== 'string' || !expected.acceptedTypes.includes(observed.type)) {
        return { ok: false, mode: 'read_only', failure_code: 'property_type_mismatch', check };
      }
      if (observed.hasUniqueValue !== expected.unique) {
        return { ok: false, mode: 'read_only', failure_code: 'property_uniqueness_mismatch', check };
      }
    }
    objects[objectType] = { checked_properties: HUBSPOT_PROPERTY_MANIFEST[objectType].length };
  }
  return {
    ok: true,
    mode: 'read_only',
    portal: { matches_expected: true },
    objects,
  };
}
