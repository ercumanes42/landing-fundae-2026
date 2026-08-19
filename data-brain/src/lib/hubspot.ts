import { createHash } from 'node:crypto';

import { env, isOutboundCapabilityEnabled } from './env';

export const HUBSPOT_CONTACT_ID_PROPERTY = 'fundae_contact_id';
export const HUBSPOT_COMPANY_ID_PROPERTY = 'fundae_account_id';
export const HUBSPOT_TASK_ID_PROPERTY = 'fundae_task_idempotency_key';

export interface HubSpotCampaignContact {
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
  results?: HubSpotBatchResult[];
  errors?: HubSpotBatchError[];
};

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

function assertHubSpotEnabled(): void {
  if (!isHubSpotSyncEnabled()) throw new Error('HUBSPOT_SYNC_ENABLED is false');
  if (!env('HUBSPOT_ACCESS_TOKEN')) throw new Error('HUBSPOT_ACCESS_TOKEN is not configured');
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

async function requestHubSpot<T>(path: string, init: RequestInit): Promise<T> {
  assertHubSpotEnabled();
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
  if (!response.ok && response.status !== 207) {
    const category = typeof body.category === 'string' ? body.category : 'HTTP_ERROR';
    throw new Error(`HubSpot ${category} (${response.status})`);
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
    [HUBSPOT_CONTACT_ID_PROPERTY]: record.externalContactId,
    [HUBSPOT_COMPANY_ID_PROPERTY]: record.externalAccountId,
    fundae_variant: record.variant,
    fundae_magnet: record.magnet,
    fundae_sequence_status: record.sequenceStatus,
    fundae_company_size: record.companySize,
  });
}

function deduplicateRecords(
  records: HubSpotCampaignContact[],
  idOf: (record: HubSpotCampaignContact) => string,
  propertiesOf: (record: HubSpotCampaignContact) => Record<string, string>,
  label: string,
): HubSpotCampaignContact[] {
  const unique = new Map<string, { record: HubSpotCampaignContact; fingerprint: string }>();
  for (const record of records) {
    const id = idOf(record);
    const fingerprint = JSON.stringify(propertiesOf(record));
    const existing = unique.get(id);
    if (existing && existing.fingerprint !== fingerprint) throw new Error(`Conflicting ${label} identity`);
    if (!existing) unique.set(id, { record, fingerprint });
  }
  return [...unique.values()].map(({ record }) => record);
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

  for (const result of response.results ?? []) {
    const traceId = result.objectWriteTraceId;
    if (!traceId || !result.id || !expected.has(traceId)) {
      throw new Error('HubSpot batch result correlation failed');
    }
    const previous = ids.get(traceId);
    if (previous && previous !== result.id) throw new Error('HubSpot batch result collision');
    ids.set(traceId, result.id);
  }

  for (const error of response.errors ?? []) {
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
  const unique = deduplicateRecords(
    records,
    (record) => record.externalContactId,
    hubSpotContactProperties,
    'contact',
  );
  const ids = new Map<string, string>();
  const failures: HubSpotSyncFailure[] = [];
  for (const group of chunk(unique, 100)) {
    const traceIds = group.map((record) => record.externalContactId);
    const response = await requestHubSpot<HubSpotBatchResponse>(
      `/crm/objects/${apiVersion()}/contacts/batch/upsert`,
      {
        method: 'POST',
        body: JSON.stringify({
          inputs: group.map((record) => ({
            id: record.externalContactId,
            idProperty: HUBSPOT_CONTACT_ID_PROPERTY,
            objectWriteTraceId: record.externalContactId,
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
  const unique = deduplicateRecords(
    records,
    (record) => record.externalAccountId,
    companyProperties,
    'company',
  );
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
    const contactId = contactIds.get(record.externalContactId);
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
      await requestHubSpot(`/crm/associations/${apiVersion()}/contacts/companies/batch/create`, {
        method: 'POST',
        body: JSON.stringify({ inputs: group.map(({ from, to }) => ({ from, to })) }),
      });
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
  assertHubSpotEnabled();
  const contacts = await upsertContacts(records);
  const companies = await upsertCompanies(records);
  const companyFailures = new Set(companies.failures.map((failure) => failure.externalId));
  const missingCompanyAssociations = records
    .filter((record) => companyFailures.has(record.externalAccountId) && contacts.ids.has(record.externalContactId))
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
  externalContactId: string,
  properties: Record<string, string | null | undefined>,
): Promise<void> {
  const patch = definedProperties(properties);
  if (Object.keys(patch).length === 0) return;
  await requestHubSpot(
    `/crm/objects/${apiVersion()}/contacts/${encodeURIComponent(externalContactId)}?idProperty=${HUBSPOT_CONTACT_ID_PROPERTY}`,
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

async function verifyUniqueProperty(objectType: string, propertyName: string): Promise<void> {
  const property = await requestHubSpot<{ name?: string; hasUniqueValue?: boolean }>(
    `/crm/properties/${apiVersion()}/${objectType}/${propertyName}`,
    { method: 'GET' },
  );
  if (property.name !== propertyName || property.hasUniqueValue !== true) {
    throw new Error(`HubSpot unique property missing for ${objectType}`);
  }
}

export async function testHubSpotConnection(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await verifyUniqueProperty('contacts', HUBSPOT_CONTACT_ID_PROPERTY);
    await verifyUniqueProperty('companies', HUBSPOT_COMPANY_ID_PROPERTY);
    await verifyUniqueProperty('tasks', HUBSPOT_TASK_ID_PROPERTY);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown HubSpot error' };
  }
}
