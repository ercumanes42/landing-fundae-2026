import { buildLeadId } from './lead-id';
import { env } from './env';
import { calculateLeadScoreBreakdown, classifyLead } from './scoring';
import type { TransactionalResource } from './transactional-delivery';
import { renderTransactionalDeliveryContent } from './transactional-delivery-package';
import type { LeadPayload, LeadScoringInput } from './types';
import { validateLeadPayload } from './validation';

const RESOURCES: TransactionalResource[] = [
  'calculator',
  'interactive_checklist',
  'checklist',
  'webinar',
];
const PROVISIONING_PROFILES = {
  '1.0': {
    confirmation: 'PROVISION_4_INERT_TRANSACTIONAL_PILOT_LEADS',
    submissionPrefix: 'pilot_gate_b_v1',
    requiresDeliverablePackage: false,
  },
  '2.0': {
    confirmation: 'PROVISION_4_INERT_TRANSACTIONAL_OUTLOOK_E2E_LEADS',
    submissionPrefix: 'pilot_outlook_e2e_v1',
    requiresDeliverablePackage: false,
  },
  '3.0': {
    confirmation: 'PROVISION_4_INERT_TRANSACTIONAL_OUTLOOK_E2E_LEADS_V2',
    submissionPrefix: 'pilot_outlook_e2e_v2',
    requiresDeliverablePackage: false,
  },
  '4.0': {
    confirmation: 'PROVISION_4_INERT_TRANSACTIONAL_OUTLOOK_E2E_LEADS_V3',
    submissionPrefix: 'pilot_outlook_e2e_v3',
    requiresDeliverablePackage: true,
  },
} as const;
const INPUT_FIELDS = new Set(['version', 'confirmation', 'leads']);
const LEAD_FIELDS = new Set([
  'anonymous_id', 'session_id', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_content', 'utm_term', 'referrer', 'first_touch', 'last_touch',
  'tracking_context', 'form_type', 'lead_magnet', 'created_at', 'contact',
  'company', 'interest', 'interactive_checklist', 'credit_estimate', 'journey',
  'consent',
]);

export class TransactionalPilotProvisionError extends Error {
  constructor(public readonly reasonCode: string) {
    super(reasonCode);
  }
}

export interface TransactionalPilotLeadRow {
  submission_id: string;
  lead_id: string;
  anonymous_id: string | null;
  session_id: string | null;
  form_type: TransactionalResource;
  lead_magnet: TransactionalResource;
  lead_score: number;
  lead_classification: string;
  fit_score: number;
  intent_score: number;
  engagement_score: number;
  urgency_score: number;
  ai_summary: null;
  delivery_status: 'dead_letter';
  accepted_by_make_at: null;
  email_delivery_status: 'pending';
  payload: LeadPayload;
  created_at: string;
}

export interface TransactionalPilotProvisionSummary {
  status: 'validated' | 'provisioned' | 'already_provisioned';
  resources: 4;
  configured_identities: number;
  used_identities: 1;
  shared_identity_mappings: 3;
  inserted: 0 | 4;
}

export interface TransactionalPilotProvisionDependencies {
  findExisting(rows: TransactionalPilotLeadRow[]): Promise<unknown[]>;
  countCampaignMatches(leadIds: string[]): Promise<number>;
  insertAll(rows: TransactionalPilotLeadRow[]): Promise<void>;
}

export function transactionalPilotSubmissionFilter(rows: TransactionalPilotLeadRow[]): string {
  const submissionIds = rows.map((row) => row.submission_id);
  if (submissionIds.length !== 4 || new Set(submissionIds).size !== 4) fail('submission_set_invalid');
  return `submission_id=in.(${submissionIds.map(encodeURIComponent).join(',')})`;
}

export function readTransactionalPilotInput(
  stream: Readable,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? 65_536;
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 2 || maxBytes > 65_536 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60_000) {
    return Promise.reject(new TransactionalPilotProvisionError('stdin_configuration_invalid'));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
    };
    const finish = (error?: TransactionalPilotProvisionError, value?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        chunks.length = 0;
        bytes = 0;
        stream.destroy();
        reject(error);
      } else {
        resolve(value ?? '');
      }
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      bytes += buffer.byteLength;
      if (bytes > maxBytes) {
        finish(new TransactionalPilotProvisionError('input_too_large'));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      if (bytes === 0) {
        finish(new TransactionalPilotProvisionError('input_empty'));
        return;
      }
      finish(undefined, Buffer.concat(chunks).toString('utf8'));
    };
    const onError = () => finish(new TransactionalPilotProvisionError('stdin_unavailable'));
    const timer = setTimeout(
      () => finish(new TransactionalPilotProvisionError('stdin_timeout')),
      timeoutMs,
    );
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
    stream.resume();
  });
}

function fail(reasonCode: string): never {
  throw new TransactionalPilotProvisionError(reasonCode);
}

function scoringInput(lead: LeadPayload): LeadScoringInput {
  return {
    employee_range: lead.company?.employee_range,
    used_fundae_before: lead.company?.used_fundae_before,
    knows_credit: lead.company?.knows_credit,
    training_area: lead.interest?.training_area,
    form_type: lead.form_type,
    urgency: lead.interest?.urgency,
    sector: lead.company?.sector,
    province: lead.company?.province,
    role: lead.contact?.role,
    risk_level: lead.interactive_checklist?.risk_level,
    journey: lead.journey,
    answers: lead.interactive_checklist?.answers,
  };
}

function statusFromScore(score: number): string {
  return {
    cold: 'frio',
    warm: 'templado',
    hot: 'caliente',
    priority: 'prioritario',
  }[classifyLead(score)];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function comparableStoredRow(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const row = { ...(value as Record<string, unknown>) };
  if (typeof row.created_at === 'string') {
    const timestamp = new Date(row.created_at);
    if (!Number.isFinite(timestamp.getTime())) return value;
    row.created_at = timestamp.toISOString();
  }
  return row;
}

function configuredAllowlist(): Set<string> {
  const values = env('TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const unique = new Set(values);
  if (
    values.length < 1 ||
    values.length > 4 ||
    unique.size !== values.length ||
    values.some((value) => !/^[a-f0-9]{64}$/.test(value))
  ) {
    fail('allowlist_invalid');
  }
  return unique;
}

export function prepareTransactionalPilotLeadRows(input: unknown): TransactionalPilotLeadRow[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('input_invalid');
  const object = input as Record<string, unknown>;
  if (Object.keys(object).some((key) => !INPUT_FIELDS.has(key))) fail('input_invalid');
  const profile = typeof object.version === 'string'
    ? PROVISIONING_PROFILES[object.version as keyof typeof PROVISIONING_PROFILES]
    : undefined;
  if (!profile || object.confirmation !== profile.confirmation || !Array.isArray(object.leads) || object.leads.length !== 4) {
    fail('input_invalid');
  }

  const allowlist = configuredAllowlist();
  const rows = object.leads.map((rawLead) => {
    if (!rawLead || typeof rawLead !== 'object' || Array.isArray(rawLead)) fail('lead_invalid');
    const draft = rawLead as Record<string, unknown>;
    if (Object.keys(draft).some((key) => !LEAD_FIELDS.has(key))) fail('lead_invalid');
    const resource = draft.form_type;
    if (!RESOURCES.includes(resource as TransactionalResource) || draft.lead_magnet !== resource) fail('resource_invalid');
    const email = (draft.contact as { email?: unknown } | undefined)?.email;
    if (typeof email !== 'string') fail('lead_invalid');
    const leadId = buildLeadId(email);
    if (!allowlist.has(leadId)) fail('identity_not_allowlisted');
    const submissionId = `${profile.submissionPrefix}_${resource}_${leadId}`;
    const candidate = {
      ...draft,
      submission_id: submissionId,
      lead_id: leadId,
      lead_score: 0,
      lead_status: 'frio',
      lead_classification: 'cold',
      scoring: { fit: 0, intent: 0, engagement: 0, urgency: 0, total: 0, classification: 'cold' },
      delivery_status: 'dead_letter',
      email_delivery_status: 'pending',
    } as LeadPayload;
    try {
      validateLeadPayload(candidate);
    } catch {
      fail('lead_invalid');
    }
    const scoring = calculateLeadScoreBreakdown(scoringInput(candidate));
    const payload = JSON.parse(JSON.stringify({
      ...candidate,
      scoring,
      lead_score: scoring.total,
      lead_status: statusFromScore(scoring.total),
      lead_classification: scoring.classification,
      delivery_status: 'dead_letter',
      email_delivery_status: 'pending',
    })) as LeadPayload;
    return {
      submission_id: submissionId,
      lead_id: leadId,
      anonymous_id: payload.anonymous_id ?? null,
      session_id: payload.session_id ?? null,
      form_type: resource as TransactionalResource,
      lead_magnet: resource as TransactionalResource,
      lead_score: scoring.total,
      lead_classification: scoring.classification,
      fit_score: scoring.fit,
      intent_score: scoring.intent,
      engagement_score: scoring.engagement,
      urgency_score: scoring.urgency,
      ai_summary: null,
      delivery_status: 'dead_letter' as const,
      accepted_by_make_at: null,
      email_delivery_status: 'pending' as const,
      payload,
      created_at: payload.created_at,
    };
  });

  const byResource = new Map(rows.map((row) => [row.form_type, row]));
  if (byResource.size !== 4 || RESOURCES.some((resource) => !byResource.has(resource))) fail('resource_set_invalid');
  const calculator = byResource.get('calculator')!;
  const webinar = byResource.get('webinar')!;
  const interactive = byResource.get('interactive_checklist')!;
  const checklist = byResource.get('checklist')!;
  const identities = new Set(rows.map((row) => row.lead_id));
  if (
    identities.size !== 1 ||
    calculator.lead_id !== webinar.lead_id ||
    interactive.lead_id !== checklist.lead_id ||
    interactive.lead_id !== calculator.lead_id
  ) {
    fail('identity_mapping_invalid');
  }
  if (new Set(rows.map((row) => row.submission_id)).size !== 4) fail('submission_set_invalid');
  if (profile.requiresDeliverablePackage) {
    try {
      for (const row of rows) renderTransactionalDeliveryContent(row.payload, row.form_type);
    } catch {
      fail('delivery_payload_invalid');
    }
  }
  return rows;
}

function existingMatches(existing: unknown[], rows: TransactionalPilotLeadRow[]): boolean {
  if (existing.length !== 4) return false;
  const expected = new Map(rows.map((row) => [
    row.submission_id,
    stable(comparableStoredRow(row)),
  ]));
  return existing.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Record<string, unknown>;
    return typeof row.submission_id === 'string' &&
      expected.get(row.submission_id) === stable(comparableStoredRow(row));
  });
}

export async function provisionTransactionalPilotLeads(
  input: unknown,
  apply: boolean,
  dependencies: TransactionalPilotProvisionDependencies,
): Promise<TransactionalPilotProvisionSummary> {
  const rows = prepareTransactionalPilotLeadRows(input);
  const configuredIdentities = configuredAllowlist().size;
  if (await dependencies.countCampaignMatches([...new Set(rows.map((row) => row.lead_id))]) !== 0) {
    fail('campaign_identity_conflict');
  }
  const existing = await dependencies.findExisting(rows);
  if (existing.length === 4 && existingMatches(existing, rows)) {
    return { status: 'already_provisioned', resources: 4, configured_identities: configuredIdentities, used_identities: 1, shared_identity_mappings: 3, inserted: 0 };
  }
  if (existing.length !== 0) fail('existing_set_conflict');
  if (!apply) {
    return { status: 'validated', resources: 4, configured_identities: configuredIdentities, used_identities: 1, shared_identity_mappings: 3, inserted: 0 };
  }
  try {
    await dependencies.insertAll(rows);
  } catch {
    const concurrent = await dependencies.findExisting(rows);
    if (concurrent.length === 4 && existingMatches(concurrent, rows)) {
      return { status: 'already_provisioned', resources: 4, configured_identities: configuredIdentities, used_identities: 1, shared_identity_mappings: 3, inserted: 0 };
    }
    fail('insert_conflict');
  }
  return { status: 'provisioned', resources: 4, configured_identities: configuredIdentities, used_identities: 1, shared_identity_mappings: 3, inserted: 4 };
}

export async function provisionTransactionalPilotLeadsFromJson(
  raw: string,
  apply: boolean,
  dependencies: TransactionalPilotProvisionDependencies,
): Promise<TransactionalPilotProvisionSummary> {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    fail('input_invalid');
  }
  return provisionTransactionalPilotLeads(input, apply, dependencies);
}
import type { Readable } from 'node:stream';
