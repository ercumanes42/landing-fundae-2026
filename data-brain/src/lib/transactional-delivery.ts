import { insertRow, selectRows, updateById } from './supabase';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/;
const HASH = /^[a-f0-9]{64}$/;

export type TransactionalEmailEvent = 'email_sent' | 'email_failed';

export interface TransactionalEmailCallbackInput {
  submission_id: string;
  lead_id: string;
  event_name: TransactionalEmailEvent;
  source_event_id: string;
  occurred_at: string;
  provider_message_hash?: string;
  failure_code?: string;
}

interface LeadRow {
  id: string;
  submission_id: string;
  lead_id: string;
  form_type: string;
  lead_magnet: string;
}

export type TransactionalResource =
  | 'calculator'
  | 'interactive_checklist'
  | 'checklist'
  | 'webinar';

const TRANSACTIONAL_RESOURCES = new Set<TransactionalResource>([
  'calculator',
  'interactive_checklist',
  'checklist',
  'webinar',
]);

interface EventRow {
  id: string;
  submission_id: string;
  lead_id: string;
  event_name: TransactionalEmailEvent;
  source_event_id: string;
}

function eventMatchesInput(event: EventRow, input: TransactionalEmailCallbackInput): boolean {
  return event.submission_id === input.submission_id &&
    event.lead_id === input.lead_id &&
    event.event_name === input.event_name &&
    event.source_event_id === input.source_event_id;
}

async function applyEmailDeliveryState(leadId: string, input: TransactionalEmailCallbackInput): Promise<void> {
  await updateById('leads', leadId, {
    email_delivery_status: input.event_name,
    email_delivery_updated_at: input.occurred_at,
  });
}

export function validateTransactionalEmailCallback(input: unknown): asserts input is TransactionalEmailCallbackInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('callback payload is invalid');
  const value = input as Partial<TransactionalEmailCallbackInput>;
  const allowedFields = new Set(['submission_id', 'lead_id', 'event_name', 'source_event_id', 'occurred_at', 'provider_message_hash', 'failure_code']);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) throw new Error(`callback field ${field} is not allowed`);
  }
  for (const [field, content] of [['submission_id', value.submission_id], ['lead_id', value.lead_id], ['source_event_id', value.source_event_id]]) {
    if (typeof content !== 'string' || !IDENTIFIER.test(content)) throw new Error(`${field} is invalid`);
  }
  if (value.event_name !== 'email_sent' && value.event_name !== 'email_failed') throw new Error('event_name is invalid');
  if (typeof value.occurred_at !== 'string' || !Number.isFinite(Date.parse(value.occurred_at))) throw new Error('occurred_at is invalid');
  if (value.provider_message_hash !== undefined && !HASH.test(value.provider_message_hash)) throw new Error('provider_message_hash is invalid');
  if (value.failure_code !== undefined && (typeof value.failure_code !== 'string' || !/^[A-Z0-9_:-]{2,64}$/.test(value.failure_code))) throw new Error('failure_code is invalid');
  if (value.event_name === 'email_sent' && !value.provider_message_hash) throw new Error('provider_message_hash is required for email_sent');
  if (value.event_name === 'email_sent' && value.failure_code) throw new Error('failure_code is not allowed for email_sent');
}

export async function findTransactionalLead(submissionId: string, leadId: string): Promise<LeadRow & { payload: Record<string, unknown> }> {
  if (!IDENTIFIER.test(submissionId) || !IDENTIFIER.test(leadId)) throw new Error('lead identifiers are invalid');
  const rows = await selectRows<LeadRow & { payload: Record<string, unknown> }>('leads', `select=id,submission_id,lead_id,form_type,lead_magnet,payload&submission_id=eq.${encodeURIComponent(submissionId)}&lead_id=eq.${encodeURIComponent(leadId)}&limit=2`);
  if (rows.length !== 1) throw new Error('transactional lead was not found');
  if (!TRANSACTIONAL_RESOURCES.has(rows[0].form_type as TransactionalResource) || rows[0].lead_magnet !== rows[0].form_type) {
    throw new Error('lead is not an allowed transactional resource');
  }
  return rows[0];
}

export async function findTransactionalLeadBySubmission(submissionId: string): Promise<LeadRow & { payload: Record<string, unknown> }> {
  if (!IDENTIFIER.test(submissionId)) throw new Error('submission_id is invalid');
  const rows = await selectRows<LeadRow & { payload: Record<string, unknown> }>('leads', `select=id,submission_id,lead_id,form_type,lead_magnet,payload&submission_id=eq.${encodeURIComponent(submissionId)}&limit=2`);
  if (rows.length !== 1) throw new Error('transactional lead was not found');
  if (!TRANSACTIONAL_RESOURCES.has(rows[0].form_type as TransactionalResource) || rows[0].lead_magnet !== rows[0].form_type) {
    throw new Error('lead is not an allowed transactional resource');
  }
  return rows[0];
}

export async function findInteractiveChecklistLead(submissionId: string, leadId: string): Promise<LeadRow & { payload: Record<string, unknown> }> {
  const lead = await findTransactionalLead(submissionId, leadId);
  if (lead.form_type !== 'interactive_checklist') throw new Error('lead is not an interactive checklist submission');
  return lead;
}

export async function recordTransactionalEmailCallback(input: unknown): Promise<{ duplicate: boolean; eventId: string }> {
  validateTransactionalEmailCallback(input);
  const lead = await findTransactionalLead(input.submission_id, input.lead_id);
  const existing = await selectRows<EventRow>('transactional_email_events', `select=id,submission_id,lead_id,event_name,source_event_id&source_event_id=eq.${encodeURIComponent(input.source_event_id)}&limit=1`);
  if (existing[0]) {
    if (!eventMatchesInput(existing[0], input)) throw new Error('source_event_id conflicts with an existing callback');
    await applyEmailDeliveryState(lead.id, input);
    return { duplicate: true, eventId: existing[0].id };
  }

  let event: EventRow;
  try {
    event = await insertRow<EventRow>('transactional_email_events', {
      submission_id: input.submission_id,
      lead_id: input.lead_id,
      event_name: input.event_name,
      source_event_id: input.source_event_id,
      occurred_at: input.occurred_at,
      provider_message_hash: input.provider_message_hash ?? null,
      failure_code: input.failure_code ?? null,
    });
  } catch (error) {
    const concurrent = await selectRows<EventRow>('transactional_email_events', `select=id,submission_id,lead_id,event_name,source_event_id&source_event_id=eq.${encodeURIComponent(input.source_event_id)}&limit=1`);
    if (concurrent[0]) {
      if (!eventMatchesInput(concurrent[0], input)) throw new Error('source_event_id conflicts with an existing callback');
      await applyEmailDeliveryState(lead.id, input);
      return { duplicate: true, eventId: concurrent[0].id };
    }
    throw error;
  }
  await applyEmailDeliveryState(lead.id, input);
  return { duplicate: false, eventId: event.id };
}
