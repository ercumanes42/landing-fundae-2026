import { env } from './env';

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

export interface HubSpotSyncResult {
  contactIds: Map<string, string>;
  companyIds: Map<string, string>;
}

type HubSpotBatchResponse = {
  results?: Array<{ id: string; objectWriteTraceId?: string }>;
  errors?: Array<{ message?: string; context?: Record<string, string[]> }>;
};

function configured(): boolean {
  return Boolean(env('HUBSPOT_ACCESS_TOKEN'));
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

async function requestHubSpot<T>(path: string, init: RequestInit): Promise<T> {
  if (!configured()) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is not configured');
  }

  const response = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env('HUBSPOT_ACCESS_TOKEN')}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { message?: string };

  if (!response.ok && response.status !== 207) {
    throw new Error(body.message || `HubSpot request failed with status ${response.status}`);
  }

  return body;
}

function contactProperties(record: HubSpotCampaignContact): Record<string, string> {
  return {
    email: record.email,
    firstname: record.firstName ?? '',
    lastname: record.lastName ?? '',
    company: record.companyName ?? '',
    jobtitle: record.jobTitle ?? '',
    fundae_campaign_id: record.campaignExternalId,
    fundae_contact_id: record.externalContactId,
    fundae_account_id: record.externalAccountId,
    fundae_variant: record.variant,
    fundae_magnet: record.magnet,
    fundae_sequence_status: record.sequenceStatus,
    fundae_company_size: record.companySize ?? '',
  };
}

export async function testHubSpotConnection(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requestHubSpot('/crm/objects/2026-03/contacts?limit=1', { method: 'GET' });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown HubSpot error' };
  }
}

async function upsertContacts(records: HubSpotCampaignContact[]): Promise<Map<string, string>> {
  const contactIds = new Map<string, string>();
  for (const group of chunk(records, 100)) {
    const response = await requestHubSpot<HubSpotBatchResponse>('/crm/objects/2026-03/contacts/batch/upsert', {
      method: 'POST',
      body: JSON.stringify({
        inputs: group.map((record) => ({
          id: record.email,
          idProperty: 'email',
          objectWriteTraceId: record.externalContactId,
          properties: contactProperties(record),
        })),
      }),
    });

    for (const result of response.results ?? []) {
      if (result.objectWriteTraceId) contactIds.set(result.objectWriteTraceId, result.id);
    }
    if (response.errors?.length) {
      throw new Error(response.errors.map((item) => item.message ?? 'HubSpot batch error').join('; '));
    }
  }
  return contactIds;
}

async function upsertCompanies(records: HubSpotCampaignContact[]): Promise<Map<string, string>> {
  const companyByAccount = new Map<string, HubSpotCampaignContact>();
  for (const record of records) {
    if (record.externalAccountId && !companyByAccount.has(record.externalAccountId)) {
      companyByAccount.set(record.externalAccountId, record);
    }
  }

  const companyIds = new Map<string, string>();
  for (const group of chunk([...companyByAccount.values()], 100)) {
    const response = await requestHubSpot<HubSpotBatchResponse>('/crm/objects/2026-03/companies/batch/upsert', {
      method: 'POST',
      body: JSON.stringify({
        inputs: group.map((record) => ({
          id: record.externalAccountId,
          idProperty: 'fundae_account_id',
          objectWriteTraceId: record.externalAccountId,
          properties: {
            name: record.companyName ?? record.externalAccountId,
            fundae_account_id: record.externalAccountId,
            fundae_campaign_id: record.campaignExternalId,
            fundae_company_size: record.companySize ?? '',
          },
        })),
      }),
    });

    for (const result of response.results ?? []) {
      if (result.objectWriteTraceId) companyIds.set(result.objectWriteTraceId, result.id);
    }
    if (response.errors?.length) {
      throw new Error(response.errors.map((item) => item.message ?? 'HubSpot company batch error').join('; '));
    }
  }
  return companyIds;
}

async function associateContactsToCompanies(
  records: HubSpotCampaignContact[],
  contactIds: Map<string, string>,
  companyIds: Map<string, string>,
): Promise<void> {
  const inputs = records.flatMap((record) => {
    const contactId = contactIds.get(record.externalContactId);
    const companyId = companyIds.get(record.externalAccountId);
    return contactId && companyId ? [{ from: { id: contactId }, to: { id: companyId } }] : [];
  });

  for (const group of chunk(inputs, 2000)) {
    if (!group.length) continue;
    await requestHubSpot('/crm/v3/associations/contacts/companies/batch/create', {
      method: 'POST',
      body: JSON.stringify({
        inputs: group.map((association) => ({
          ...association,
          type: 'contact_to_company',
        })),
      }),
    });
  }
}

export async function syncHubSpotCampaignContacts(records: HubSpotCampaignContact[]): Promise<HubSpotSyncResult> {
  const contactIds = await upsertContacts(records);
  const companyIds = await upsertCompanies(records);
  await associateContactsToCompanies(records, contactIds, companyIds);
  return { contactIds, companyIds };
}

export async function updateHubSpotContact(
  contactId: string,
  properties: Record<string, string>,
): Promise<void> {
  await requestHubSpot(`/crm/objects/2026-03/contacts/${encodeURIComponent(contactId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  });
}
