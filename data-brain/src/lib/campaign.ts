import { buildLeadId } from './lead-id';
import { env } from './env';
import {
  isHubSpotSyncEnabled,
  syncHubSpotCampaignContacts,
  updateHubSpotContact,
  upsertPositiveReplyTask,
  type HubSpotCampaignContact,
} from './hubspot';
import { callRpc, insertRow, selectRows, updateById, upsertRows } from './supabase';
import { campaignStateForEvent } from './campaign-state';

const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9_-]{3,100}$/;
const EVENT_NAMES = new Set([
  'landing_visit',
  'resource_started',
  'resource_completed',
  'checklist_downloaded',
  'calculator_completed',
  'webinar_registered',
  'review_submitted',
  'diagnostic_intent',
  'diagnostic_requested',
  'positive_reply',
  'meeting_booked',
  'meeting_completed',
  'opportunity_created',
  'delivery_sent',
  'transactional_delivery_sent',
  'delivery_error',
  'reply_received',
  'bounce_hard',
  'unsubscribe',
  'opposition',
  'crm_contact_updated',
]);

const PUBLIC_BROWSER_EVENT_NAMES = new Set([
  'landing_visit',
  'resource_started',
]);

type JsonRecord = Record<string, unknown>;

interface CampaignRow {
  id: string;
  external_id: string;
}

interface CampaignContactRow {
  id: string;
  external_contact_id: string;
  email_hash: string;
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

export function validatePublicCampaignEvent(input: CampaignEventInput): CampaignEventInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Campaign event payload must be an object');
  }
  if (typeof input.event_name !== 'string' || !PUBLIC_BROWSER_EVENT_NAMES.has(input.event_name.trim())) {
    throw new Error('Operational campaign events require a signed endpoint');
  }
  return input;
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
    `select=id,external_contact_id,email_hash,hubspot_contact_id&campaign_id=eq.${encodeURIComponent(campaignId)}&external_contact_id=eq.${encodeURIComponent(externalContactId)}&limit=1`,
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
  const campaignState = campaignStateForEvent(eventName, occurredAt, false);
  Object.assign(patch, campaignState);
  if (campaignState.cold_sequence_status === 'stopped') {
    patch.sequence_status = 'stopped';
    patch.next_delivery_status = 'stopped';
  }
  return patch;
}

export async function recordCampaignEvent(input: CampaignEventInput): Promise<{ id: string }> {
  const eventName = input.event_name.trim();
  if (!EVENT_NAMES.has(eventName)) throw new Error('Unsupported campaign event');

  const externalId = campaignExternalId(input.campaign_external_id);
  const contactId = assertExternalId(input.contact_id, 'contact_id');
  const occurredAt = input.occurred_at || new Date().toISOString();
  await ensureCampaign(externalId);
  return callRpc<{ id: string }>('record_campaign_event_atomic', {
    p_campaign_external_id: externalId,
    p_contact_external_id: contactId,
    p_event_name: eventName,
    p_occurred_at: occurredAt,
    p_source_event_id: input.source_event_id?.trim() || null,
    p_context: scalarProperties(input.context),
    p_properties: scalarProperties(input.properties),
  });
}
export async function recordPublicCampaignEvent(input: CampaignEventInput): Promise<{ id: string }> {
  return recordCampaignEvent(validatePublicCampaignEvent(input));
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

export function hubSpotPropertiesForOperation(
  eventName: string,
  patch: JsonRecord,
  occurredAt: string,
): Record<string, string> {
  const properties: Record<string, string> = {};
  if (typeof patch.sequence_status === 'string') properties.fundae_sequence_status = patch.sequence_status;
  if (typeof patch.reply_type === 'string') properties.fundae_reply_type = patch.reply_type;
  if (typeof patch.deal_value === 'number') properties.fundae_pipeline_value = String(patch.deal_value);
  if (eventName === 'positive_reply') {
    properties.fundae_sequence_status = 'stopped';
    properties.fundae_reply_type = 'positive';
    properties.fundae_positive_reply_at = occurredAt;
  }
  if (eventName === 'unsubscribe') {
    properties.fundae_sequence_status = 'stopped';
    properties.fundae_suppression_scope = 'all';
    properties.fundae_suppression_reason = 'unsubscribe';
    properties.fundae_unsubscribed_at = occurredAt;
  }
  if (eventName === 'bounce_hard') {
    properties.fundae_sequence_status = 'stopped';
    properties.fundae_suppression_scope = 'marketing';
    properties.fundae_suppression_reason = 'hard_bounce';
    properties.fundae_hard_bounce_at = occurredAt;
  }
  if (eventName === 'opposition') {
    properties.fundae_sequence_status = 'stopped';
    properties.fundae_suppression_scope = 'marketing';
    properties.fundae_suppression_reason = 'opposition';
  }
  return properties;
}

export async function recordCampaignOperation(input: CampaignOperationInput): Promise<{ id: string }> {
  if (input.current_step !== undefined && (!Number.isInteger(input.current_step) || input.current_step < 1 || input.current_step > 5)) {
    throw new Error('current_step must be an integer between 1 and 5');
  }
  const occurredAt = input.occurred_at || new Date().toISOString();
  const event = await recordCampaignEvent({
    ...input,
    occurred_at: occurredAt,
    properties: {
      ...(input.properties ?? {}),
      ...(input.current_step !== undefined ? { step: input.current_step } : {}),
    },
  });
  const externalId = campaignExternalId(input.campaign_external_id);
  const campaign = await ensureCampaign(externalId);
  const contact = await getCampaignContact(campaign.id, assertExternalId(input.contact_id, 'contact_id'));
  const patch = operationPatch({ ...input, occurred_at: occurredAt });
  await updateById('campaign_contacts', contact.id, patch);

  if (isHubSpotSyncEnabled()) {
    const hubSpotProperties = hubSpotPropertiesForOperation(input.event_name, patch, occurredAt);
    if (Object.keys(hubSpotProperties).length) {
      await updateHubSpotContact(contact.email_hash, hubSpotProperties);
    }
    if (input.event_name === 'positive_reply') {
      if (!contact.hubspot_contact_id) throw new Error('Positive reply has no unambiguous HubSpot contact association');
      await upsertPositiveReplyTask({
        campaignExternalId: externalId,
        externalContactId: contact.external_contact_id,
        hubspotContactId: contact.hubspot_contact_id,
        sourceEventId: input.source_event_id?.trim() || event.id,
        occurredAt,
      });
    }
  }

  return event;
}

function toHubSpotContact(
  contact: CampaignContactImport,
  externalId: string,
  leadId: string,
): HubSpotCampaignContact {
  return {
    leadId,
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
  if (isHubSpotSyncEnabled()) {
    const storedByExternalId = new Map(stored.map((contact) => [contact.external_contact_id, contact]));
    const hubSpotContacts = request.contacts.map((contact) => {
      const storedContact = storedByExternalId.get(contact.contact_id);
      if (!storedContact?.email_hash) throw new Error('Campaign contact is missing canonical lead identity');
      return toHubSpotContact(contact, externalId, storedContact.email_hash);
    });
    const sync = await syncHubSpotCampaignContacts(hubSpotContacts);
    const failuresByContact = new Map<string, string>();
    const companyByContact = new Map(request.contacts.map((contact) => [contact.contact_id, contact.account_id]));
    const leadByContact = new Map(hubSpotContacts.map((contact) => [contact.externalContactId, contact.leadId]));
    for (const failure of sync.failures) {
      if (failure.stage === 'company') {
        for (const [contactId, accountId] of companyByContact) {
          if (accountId === failure.externalId) failuresByContact.set(contactId, 'partial');
        }
      } else if (failure.stage === 'contact') {
        for (const [contactId, leadId] of leadByContact) {
          if (leadId === failure.externalId) failuresByContact.set(contactId, 'failed');
        }
      } else {
        failuresByContact.set(failure.externalId, 'partial');
      }
    }
    const collisions: string[] = [];
    for (const storedContact of stored) {
      const hubspotContactId = sync.contactIds.get(storedContact.email_hash);
      const syncFailure = failuresByContact.get(storedContact.external_contact_id);
      if (storedContact.hubspot_contact_id && hubspotContactId && storedContact.hubspot_contact_id !== hubspotContactId) {
        collisions.push(storedContact.external_contact_id);
        await updateById('campaign_contacts', storedContact.id, { hubspot_sync_status: 'collision' });
        continue;
      }
      if (hubspotContactId) {
        await updateById('campaign_contacts', storedContact.id, {
          hubspot_contact_id: hubspotContactId,
          hubspot_sync_status: syncFailure || 'synced',
          hubspot_synced_at: new Date().toISOString(),
        });
        if (!syncFailure) hubspotSynced += 1;
      } else {
        await updateById('campaign_contacts', storedContact.id, { hubspot_sync_status: syncFailure || 'failed' });
      }
    }
    if (collisions.length > 0) throw new Error('HubSpot contact identity collision');
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
    `select=id,external_contact_id,email_hash,hubspot_contact_id,campaign_id&hubspot_contact_id=eq.${encodeURIComponent(input.hubspotContactId)}&limit=2`,
  );
  if (contacts.length > 1) throw new Error('HubSpot contact correlation is ambiguous');
  const contact = contacts[0];
  if (!contact) return false;

  const campaigns = await selectRows<CampaignRow>(
    'campaigns',
    `select=id,external_id&id=eq.${encodeURIComponent(contact.campaign_id)}&limit=1`,
  );
  const campaign = campaigns[0];
  if (!campaign) return false;

  const value = (input.propertyValue || '').trim().toLowerCase();
  const property = (input.propertyName || '').trim().toLowerCase();
  const mappings: Record<string, Record<string, string>> = {
    fundae_meeting_status: { booked: 'meeting_booked', confirmed: 'meeting_booked' },
    fundae_opportunity_status: { created: 'opportunity_created', opportunity: 'opportunity_created' },
    fundae_reply_type: { positive: 'positive_reply' },
    fundae_suppression_reason: {
      unsubscribe: 'unsubscribe',
      hard_bounce: 'bounce_hard',
      bounce_hard: 'bounce_hard',
      opposition: 'opposition',
    },
    fundae_sequence_status: {},
  };
  if (!(property in mappings)) throw new Error('Unsupported HubSpot webhook property');
  const eventName = mappings[property][value] || 'crm_contact_updated';

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
