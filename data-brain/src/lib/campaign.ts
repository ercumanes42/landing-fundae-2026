import { buildLeadId } from './lead-id';
import { env } from './env';
import { syncHubSpotCampaignContacts, updateHubSpotContact, type HubSpotCampaignContact } from './hubspot';
import { insertRow, selectRows, updateById, upsertRows } from './supabase';

const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9_-]{3,100}$/;
const EVENT_NAMES = new Set([
  'landing_visit',
  'resource_started',
  'resource_completed',
  'checklist_downloaded',
  'calculator_completed',
  'webinar_registered',
  'review_submitted',
  'meeting_booked',
  'meeting_completed',
  'opportunity_created',
  'delivery_sent',
  'delivery_error',
  'reply_received',
  'bounce_hard',
  'unsubscribe',
  'crm_contact_updated',
]);

type JsonRecord = Record<string, unknown>;

interface CampaignRow {
  id: string;
  external_id: string;
}

interface CampaignContactRow {
  id: string;
  external_contact_id: string;
  hubspot_contact_id?: string | null;
}

export interface CampaignContactImport {
  contact_id: string;
  account_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  job_title?: string;
  company_size?: string;
  variant: 'Checklist' | 'Calculadora' | 'Webinar' | 'Revisión rápida' | string;
  magnet: string;
  lot: string;
  scheduled_at?: string;
  current_step?: number;
  sequence_status?: string;
  next_delivery_status?: string;
  parent_contact_id?: string;
  conditional_delivery?: boolean;
  contact_data?: JsonRecord;
}

export interface CampaignImportRequest {
  campaign_external_id?: string;
  campaign_name?: string;
  dry_run?: boolean;
  contacts: CampaignContactImport[];
}

export interface CampaignEventInput {
  campaign_external_id?: string;
  contact_id: string;
  event_name: string;
  occurred_at?: string;
  source_event_id?: string;
  context?: JsonRecord;
  properties?: JsonRecord;
}

export interface CampaignOperationInput extends CampaignEventInput {
  sequence_status?: string;
  next_delivery_status?: string;
  last_delivery_status?: string;
  current_step?: number;
  next_scheduled_at?: string | null;
  locked_at?: string | null;
  lock_token?: string | null;
  lock_expires_at?: string | null;
  attempt_count?: number;
  outlook_message_id?: string | null;
  outlook_conversation_id?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  reply_type?: string | null;
  deal_value?: number | null;
}

function assertExternalId(value: string, field: string): string {
  const normalized = value.trim();
  if (!EXTERNAL_ID_PATTERN.test(normalized)) {
    throw new Error(`${field} must contain only letters, numbers, underscores, or hyphens`);
  }
  return normalized;
}

function scalarProperties(input?: JsonRecord): JsonRecord {
  const blocked = new Set(['email', 'name', 'phone', 'company', 'message', 'contact', 'answers']);
  const clean: JsonRecord = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (blocked.has(key.toLowerCase()) || typeof value === 'object') continue;
    clean[key] = value;
  }
  return clean;
}

function campaignExternalId(value?: string): string {
  return assertExternalId(value || env('CAMPAIGN_DEFAULT_EXTERNAL_ID'), 'campaign_external_id');
}

async function ensureCampaign(externalId: string, name?: string): Promise<CampaignRow> {
  const existing = await selectRows<CampaignRow>(
    'campaigns',
    `select=id,external_id&external_id=eq.${encodeURIComponent(externalId)}&limit=1`,
  );
  if (existing[0]) return existing[0];

  return insertRow<CampaignRow>('campaigns', {
    external_id: externalId,
    name: name || externalId,
    timezone: 'Europe/Madrid',
    status: 'draft',
    is_active: false,
  });
}

async function getCampaignContact(
  campaignId: string,
  externalContactId: string,
): Promise<CampaignContactRow> {
  const rows = await selectRows<CampaignContactRow>(
    'campaign_contacts',
    `select=id,external_contact_id,hubspot_contact_id&campaign_id=eq.${encodeURIComponent(campaignId)}&external_contact_id=eq.${encodeURIComponent(externalContactId)}&limit=1`,
  );
  if (!rows[0]) throw new Error('Unknown campaign contact id');
  return rows[0];
}

function eventPatch(eventName: string, occurredAt: string): JsonRecord {
  const patch: JsonRecord = { last_event_at: occurredAt };
  if (eventName === 'resource_started') patch.resource_started_at = occurredAt;
  if (['resource_completed', 'checklist_downloaded', 'calculator_completed', 'webinar_registered', 'review_submitted'].includes(eventName)) {
    patch.resource_completed_at = occurredAt;
  }
  if (eventName === 'meeting_booked') patch.meeting_booked_at = occurredAt;
  if (eventName === 'meeting_completed') patch.meeting_completed_at = occurredAt;
  if (eventName === 'opportunity_created') patch.opportunity_created_at = occurredAt;
  if (eventName === 'reply_received') patch.sequence_status = 'stopped';
  if (eventName === 'bounce_hard') patch.sequence_status = 'stopped';
  if (eventName === 'unsubscribe') patch.sequence_status = 'stopped';
  return patch;
}

export async function recordCampaignEvent(input: CampaignEventInput): Promise<{ id: string }> {
  const eventName = input.event_name.trim();
  if (!EVENT_NAMES.has(eventName)) throw new Error('Unsupported campaign event');

  const externalId = campaignExternalId(input.campaign_external_id);
  const contactId = assertExternalId(input.contact_id, 'contact_id');
  const sourceEventId = input.source_event_id?.trim() || null;

  if (sourceEventId) {
    const duplicate = await selectRows<{ id: string }>(
      'campaign_events',
      `select=id&source_event_id=eq.${encodeURIComponent(sourceEventId)}&limit=1`,
    );
    if (duplicate[0]) return duplicate[0];
  }

  const campaign = await ensureCampaign(externalId);
  const contact = await getCampaignContact(campaign.id, contactId);
  const occurredAt = input.occurred_at || new Date().toISOString();
  const event = await insertRow<{ id: string }>('campaign_events', {
    campaign_id: campaign.id,
    campaign_contact_id: contact.id,
    source_event_id: sourceEventId,
    event_name: eventName,
    occurred_at: occurredAt,
    context: scalarProperties(input.context),
    properties: scalarProperties(input.properties),
  });

  await updateById('campaign_contacts', contact.id, eventPatch(eventName, occurredAt));
  return event;
}

function operationPatch(input: CampaignOperationInput): JsonRecord {
  const patch: JsonRecord = eventPatch(input.event_name, input.occurred_at || new Date().toISOString());
  const allowedKeys: Array<keyof CampaignOperationInput> = [
    'sequence_status',
    'next_delivery_status',
    'last_delivery_status',
    'current_step',
    'next_scheduled_at',
    'locked_at',
    'lock_token',
    'lock_expires_at',
    'attempt_count',
    'outlook_message_id',
    'outlook_conversation_id',
    'last_error_code',
    'last_error_message',
    'reply_type',
    'deal_value',
  ];
  for (const key of allowedKeys) {
    const value = input[key];
    if (value !== undefined) patch[key] = value;
  }
  return patch;
}

export async function recordCampaignOperation(input: CampaignOperationInput): Promise<{ id: string }> {
  const event = await recordCampaignEvent(input);
  const externalId = campaignExternalId(input.campaign_external_id);
  const campaign = await ensureCampaign(externalId);
  const contact = await getCampaignContact(campaign.id, assertExternalId(input.contact_id, 'contact_id'));
  const patch = operationPatch(input);
  await updateById('campaign_contacts', contact.id, patch);

  if (contact.hubspot_contact_id) {
    const hubSpotProperties: Record<string, string> = {};
    if (typeof patch.sequence_status === 'string') hubSpotProperties.fundae_sequence_status = patch.sequence_status;
    if (typeof patch.reply_type === 'string') hubSpotProperties.fundae_reply_type = patch.reply_type;
    if (typeof patch.deal_value === 'number') hubSpotProperties.fundae_pipeline_value = String(patch.deal_value);
    if (Object.keys(hubSpotProperties).length) {
      await updateHubSpotContact(contact.hubspot_contact_id, hubSpotProperties);
    }
  }

  return event;
}

function toHubSpotContact(
  contact: CampaignContactImport,
  externalId: string,
): HubSpotCampaignContact {
  return {
    externalContactId: contact.contact_id,
    externalAccountId: contact.account_id,
    email: contact.email.trim().toLowerCase(),
    firstName: contact.first_name,
    lastName: contact.last_name,
    companyName: contact.company_name,
    jobTitle: contact.job_title,
    companySize: contact.company_size,
    campaignExternalId: externalId,
    variant: contact.variant,
    magnet: contact.magnet,
    sequenceStatus: contact.sequence_status || 'pending',
  };
}

function validateImportContact(contact: CampaignContactImport): void {
  assertExternalId(contact.contact_id, 'contact_id');
  assertExternalId(contact.account_id, 'account_id');
  if (!/^\S+@\S+\.\S+$/.test(contact.email.trim())) throw new Error('email is invalid');
  if (!contact.variant || !contact.magnet || !contact.lot) throw new Error('variant, magnet, and lot are required');
}

export async function importCampaignContacts(request: CampaignImportRequest): Promise<{
  imported: number;
  hubspotSynced: number;
  dryRun: boolean;
}> {
  if (!Array.isArray(request.contacts) || request.contacts.length === 0 || request.contacts.length > 100) {
    throw new Error('contacts must contain between 1 and 100 records');
  }

  const externalId = campaignExternalId(request.campaign_external_id);
  request.contacts.forEach(validateImportContact);
  if (request.dry_run) {
    return { imported: request.contacts.length, hubspotSynced: 0, dryRun: true };
  }

  const campaign = await ensureCampaign(externalId, request.campaign_name);
  const rows = request.contacts.map((contact) => ({
    campaign_id: campaign.id,
    external_contact_id: contact.contact_id,
    external_account_id: contact.account_id,
    email_hash: buildLeadId(contact.email),
    variant: contact.variant,
    magnet: contact.magnet,
    lot: contact.lot,
    company_size: contact.company_size || null,
    current_step: contact.current_step || 1,
    sequence_status: contact.sequence_status || 'pending',
    next_delivery_status: contact.next_delivery_status || 'pending',
    parent_external_contact_id: contact.parent_contact_id || null,
    conditional_delivery: Boolean(contact.conditional_delivery),
    next_scheduled_at: contact.scheduled_at || null,
    contact_data: {
      email: contact.email.trim().toLowerCase(),
      first_name: contact.first_name || '',
      last_name: contact.last_name || '',
      company_name: contact.company_name || '',
      job_title: contact.job_title || '',
      ...(contact.contact_data ?? {}),
    },
  }));
  const stored = await upsertRows<CampaignContactRow>(
    'campaign_contacts',
    rows,
    'campaign_id,external_contact_id',
  );

  let hubspotSynced = 0;
  if (env('HUBSPOT_ACCESS_TOKEN')) {
    const sync = await syncHubSpotCampaignContacts(request.contacts.map((contact) => toHubSpotContact(contact, externalId)));
    for (const storedContact of stored) {
      const hubspotContactId = sync.contactIds.get(storedContact.external_contact_id);
      if (hubspotContactId) {
        await updateById('campaign_contacts', storedContact.id, {
          hubspot_contact_id: hubspotContactId,
          hubspot_sync_status: 'synced',
          hubspot_synced_at: new Date().toISOString(),
        });
        hubspotSynced += 1;
      }
    }
  }

  return { imported: stored.length, hubspotSynced, dryRun: false };
}

export async function recordHubSpotContactEvent(input: {
  hubspotContactId: string;
  sourceEventId: string;
  propertyName?: string;
  propertyValue?: string;
  occurredAt?: string;
}): Promise<boolean> {
  const contacts = await selectRows<CampaignContactRow & { campaign_id: string }>(
    'campaign_contacts',
    `select=id,external_contact_id,hubspot_contact_id,campaign_id&hubspot_contact_id=eq.${encodeURIComponent(input.hubspotContactId)}&limit=1`,
  );
  const contact = contacts[0];
  if (!contact) return false;

  const campaigns = await selectRows<CampaignRow>(
    'campaigns',
    `select=id,external_id&id=eq.${encodeURIComponent(contact.campaign_id)}&limit=1`,
  );
  const campaign = campaigns[0];
  if (!campaign) return false;

  const value = (input.propertyValue || '').toLowerCase();
  const property = (input.propertyName || '').toLowerCase();
  let eventName = 'crm_contact_updated';
  if (property.includes('meeting') && value.includes('book')) eventName = 'meeting_booked';
  if (property.includes('opportunity') || value === 'opportunity') eventName = 'opportunity_created';

  await recordCampaignEvent({
    campaign_external_id: campaign.external_id,
    contact_id: contact.external_contact_id,
    event_name: eventName,
    occurred_at: input.occurredAt,
    source_event_id: input.sourceEventId,
    properties: {
      crm_property: input.propertyName || '',
      crm_value: input.propertyValue || '',
    },
  });
  return true;
}
