import type { LeadPayload } from './types';
import {
  provisionTransactionalPilotLeads,
  TransactionalPilotProvisionError,
  type TransactionalPilotLeadRow,
  type TransactionalPilotProvisionDependencies,
  type TransactionalPilotProvisionSummary,
} from './transactional-pilot-provision';

const SOURCE_CONFIRMATION = 'PROVISION_4_INERT_TRANSACTIONAL_OUTLOOK_E2E_LEADS';
const TARGET_CONFIRMATION = 'PROVISION_4_INERT_TRANSACTIONAL_OUTLOOK_E2E_LEADS_V2';
const TARGET_V4_CONFIRMATION = 'PROVISION_4_INERT_TRANSACTIONAL_OUTLOOK_E2E_LEADS_V3';
const LEAD_INPUT_FIELDS = new Set([
  'anonymous_id', 'session_id', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_content', 'utm_term', 'referrer', 'first_touch', 'last_touch',
  'tracking_context', 'form_type', 'lead_magnet', 'created_at', 'contact',
  'company', 'interest', 'interactive_checklist', 'credit_estimate', 'journey',
  'consent',
]);

export const OUTLOOK_V3_CLONE_CONFIRMATION = 'CLONE_PROVISION_4_OUTLOOK_V3_FROM_V2_ONCE';
export const OUTLOOK_V2_SOURCE_PREFIX = 'pilot_outlook_e2e_v1_';
export const OUTLOOK_V3_CREATED_AT = '2026-08-17T18:00:00.000Z';
export const OUTLOOK_V4_CLONE_CONFIRMATION = 'CLONE_PROVISION_4_OUTLOOK_V4_FROM_V2_ONCE';
export const OUTLOOK_V4_CREATED_AT = '2026-08-17T20:45:00.000Z';

export interface TransactionalOutlookV3CloneDependencies
  extends Omit<TransactionalPilotProvisionDependencies, 'findExisting'> {
  findSource(): Promise<unknown[]>;
  findTargetExisting(rows: TransactionalPilotLeadRow[]): Promise<unknown[]>;
}

function fail(reasonCode: string): never {
  throw new TransactionalPilotProvisionError(reasonCode);
}

function leadInputFromStoredPayload(value: unknown, createdAt?: string): LeadPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('source_cohort_invalid');
  const payload = value as Record<string, unknown>;
  const lead = Object.fromEntries(
    Object.entries(payload).filter(([key]) => LEAD_INPUT_FIELDS.has(key)),
  ) as Record<string, unknown>;
  if (createdAt !== undefined) lead.created_at = createdAt;
  return JSON.parse(JSON.stringify(lead)) as LeadPayload;
}

function sourceInput(source: unknown[]): { version: '2.0'; confirmation: string; leads: LeadPayload[] } {
  if (source.length !== 4) fail('source_cohort_invalid');
  const leads = source.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('source_cohort_invalid');
    const row = value as Record<string, unknown>;
    if (
      typeof row.submission_id !== 'string' ||
      !row.submission_id.startsWith(OUTLOOK_V2_SOURCE_PREFIX) ||
      row.delivery_status !== 'dead_letter' ||
      row.email_delivery_status !== 'pending' ||
      row.accepted_by_make_at !== null ||
      row.ai_summary !== null
    ) {
      fail('source_cohort_invalid');
    }
    const lead = leadInputFromStoredPayload(row.payload);
    if ((lead.consent as { privacy_accepted?: unknown } | undefined)?.privacy_accepted !== true) {
      fail('source_cohort_invalid');
    }
    return lead;
  });
  return { version: '2.0', confirmation: SOURCE_CONFIRMATION, leads };
}

export function parseTransactionalOutlookV3CloneArgs(args: string[]): boolean {
  if (args.length === 0) return false;
  if (args.length === 2 && args[0] === '--apply' && args[1] === OUTLOOK_V3_CLONE_CONFIRMATION) {
    return true;
  }
  fail('arguments_invalid');
}

export function parseTransactionalOutlookV4CloneArgs(args: string[]): boolean {
  if (args.length === 0) return false;
  if (args.length === 2 && args[0] === '--apply' && args[1] === OUTLOOK_V4_CLONE_CONFIRMATION) {
    return true;
  }
  fail('arguments_invalid');
}

async function validatedSourceInput(
  dependencies: TransactionalOutlookV3CloneDependencies,
): Promise<{ version: '2.0'; confirmation: string; leads: LeadPayload[] }> {
  const source = await dependencies.findSource();
  const input = sourceInput(source);
  try {
    const validation = await provisionTransactionalPilotLeads(input, false, {
      findExisting: async () => source,
      countCampaignMatches: dependencies.countCampaignMatches,
      insertAll: async () => fail('source_cohort_invalid'),
    });
    if (validation.status !== 'already_provisioned') fail('source_cohort_invalid');
    return input;
  } catch (error) {
    if (error instanceof TransactionalPilotProvisionError && error.reasonCode === 'campaign_identity_conflict') {
      throw error;
    }
    fail('source_cohort_invalid');
  }
}

export async function cloneTransactionalOutlookV3FromV2(
  apply: boolean,
  dependencies: TransactionalOutlookV3CloneDependencies,
): Promise<TransactionalPilotProvisionSummary> {
  const input = await validatedSourceInput(dependencies);

  const targetInput = {
    version: '3.0',
    confirmation: TARGET_CONFIRMATION,
    leads: input.leads.map((lead) => leadInputFromStoredPayload(lead, OUTLOOK_V3_CREATED_AT)),
  };
  return provisionTransactionalPilotLeads(targetInput, apply, {
    findExisting: dependencies.findTargetExisting,
    countCampaignMatches: dependencies.countCampaignMatches,
    insertAll: dependencies.insertAll,
  });
}

function v4Lead(lead: LeadPayload): LeadPayload {
  const resource = lead.form_type;
  const base = leadInputFromStoredPayload(lead, OUTLOOK_V4_CREATED_AT);
  if (resource === 'calculator') {
    base.credit_estimate = {
      amount: 420,
      currency: 'EUR',
      calculation_mode: 'fp_quota',
      calculation_source: 'minimum_credit',
      applied_percentage: 100,
      requires_manual_review: false,
    };
  }
  if (resource === 'interactive_checklist') {
    base.interactive_checklist = {
      score: 5,
      risk_level: 'medium',
      answers: {
        company_size: '1-5',
        credit_visibility: 'No todavía',
        training_fit: 'Tenemos una idea general',
        planning_process: 'A veces con poco margen',
        rlpt_process: 'No existe RLPT',
        evidence_tracking: 'Solo en algunos cursos',
        documentation_control: 'Sí, con un sistema claro',
        cofinancing: 'No aplica: 1-5 personas',
        review_timing: 'Esta semana',
      },
    };
  }
  return base;
}

export async function cloneTransactionalOutlookV4FromV2(
  apply: boolean,
  dependencies: TransactionalOutlookV3CloneDependencies,
): Promise<TransactionalPilotProvisionSummary> {
  const input = await validatedSourceInput(dependencies);
  return provisionTransactionalPilotLeads({
    version: '4.0',
    confirmation: TARGET_V4_CONFIRMATION,
    leads: input.leads.map(v4Lead),
  }, apply, {
    findExisting: dependencies.findTargetExisting,
    countCampaignMatches: dependencies.countCampaignMatches,
    insertAll: dependencies.insertAll,
  });
}
