import { createHash } from 'node:crypto';
import type {
  CampaignTrackingContext,
  EventPayload,
  FormType,
  LeadPayload,
  TouchAttribution,
  TrackingContext,
} from './types';
import {
  canonicalizeJourneyContext,
  canonicalizeJourneyEventInput,
  JOURNEY_EVENT_NAMES,
} from './tracking-contract';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const MAX_TEXT_LENGTH = 500;
const MAX_URL_LENGTH = 2_048;
export const MAX_LEAD_BODY_BYTES = 64 * 1_024;

const PROFESSIONAL_EMAIL_FORM_TYPES = new Set<FormType>([
  'calculator',
  'interactive_checklist',
]);

const PERSONAL_EMAIL_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'gmx.com',
  'gmx.es',
  'googlemail.com',
  'hotmail.com',
  'hotmail.es',
  'icloud.com',
  'live.com',
  'live.es',
  'mac.com',
  'mail.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'outlook.es',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
  'yahoo.es',
]);

export const PUBLIC_EVENT_NAMES = new Set<string>(JOURNEY_EVENT_NAMES);

const FORM_TYPES = new Set<FormType>([
  'checklist',
  'interactive_checklist',
  'calculator',
  'webinar',
  'diagnostic',
]);

const LEAD_INPUT_KEYS = new Set([
  'submission_id', 'event_version', 'form_type', 'lead_magnet', 'created_at', 'source_url',
  'journey_id',
  'anonymous_id', 'session_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
  'utm_term', 'referrer', 'first_touch', 'last_touch', 'tracking_context', 'campaign_context',
  'lead_score', 'lead_status', 'lead_classification', 'scoring', 'contact', 'company', 'interest',
  'interactive_checklist', 'credit_estimate', 'journey', 'consent', 'delivery_status',
  'checklist_pdf_url',
]);
const SERVER_OWNED_LEAD_KEYS = new Set([
  'lead_id', 'ai_summary', 'accepted_by_make_at', 'email_delivery_status',
]);
const CHECKLIST_ANSWER_KEYS = new Set([
  'company_size', 'credit_visibility', 'training_fit', 'planning_process', 'rlpt_process',
  'evidence_tracking', 'documentation_control', 'cofinancing', 'review_timing',
]);

export class PayloadTooLargeError extends Error {
  constructor() {
    super(`Lead payload exceeds ${MAX_LEAD_BODY_BYTES} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} is invalid`);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${field}.${key} is not allowed`);
  }
}

function normalizedString(
  value: unknown,
  field: string,
  options: { required?: boolean; max?: number; allowEmpty?: boolean } = {},
): string | undefined {
  const { required = false, max = MAX_TEXT_LENGTH, allowEmpty = false } = options;
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new Error(`${field} is invalid`);
  const normalized = value.trim();
  if ((!normalized && required && !allowEmpty) || normalized.length > max) {
    throw new Error(!normalized && required ? `${field} is required` : `${field} is invalid`);
  }
  return normalized;
}

function normalizedUrl(value: unknown, field: string, required = false): string | undefined {
  const normalized = normalizedString(value, field, { required, max: MAX_URL_LENGTH });
  if (normalized === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${field} is invalid`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${field} is invalid`);
  }
  return parsed.toString();
}

function optionalIdentifier(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  assertIdentifier(value, field);
  return String(value).trim();
}

function finiteNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  required = false,
): number | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} is invalid`);
  return value;
}

function canonicalTouch(value: unknown, field: string): TouchAttribution {
  const record = asRecord(value, field);
  assertAllowedKeys(record, new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer',
    'lead_magnet', 'source_url', 'captured_at',
  ]), field);
  const leadMagnet = record.lead_magnet;
  if (typeof leadMagnet !== 'string' || !FORM_TYPES.has(leadMagnet as FormType)) {
    throw new Error(`${field}.lead_magnet is invalid`);
  }
  const capturedAt = normalizedString(record.captured_at, `${field}.captured_at`, { required: true, max: 64 })!;
  if (!isIsoDate(capturedAt)) throw new Error(`${field}.captured_at is invalid`);
  return {
    utm_source: normalizedString(record.utm_source, `${field}.utm_source`, { required: true, allowEmpty: true })!,
    utm_medium: normalizedString(record.utm_medium, `${field}.utm_medium`, { required: true, allowEmpty: true })!,
    utm_campaign: normalizedString(record.utm_campaign, `${field}.utm_campaign`, { required: true, allowEmpty: true })!,
    utm_content: normalizedString(record.utm_content, `${field}.utm_content`, { required: true, allowEmpty: true })!,
    utm_term: normalizedString(record.utm_term, `${field}.utm_term`, { required: true, allowEmpty: true })!,
    referrer: normalizedString(record.referrer, `${field}.referrer`, { required: true, allowEmpty: true, max: MAX_URL_LENGTH })!,
    lead_magnet: leadMagnet as FormType,
    source_url: normalizedUrl(record.source_url, `${field}.source_url`, true)!,
    captured_at: new Date(capturedAt).toISOString(),
  };
}

function canonicalTrackingContext(value: unknown): TrackingContext {
  return canonicalizeJourneyContext(value);
}

function canonicalCampaignContext(value: unknown): CampaignTrackingContext {
  const record = asRecord(value, 'campaign_context');
  assertAllowedKeys(record, new Set(['campaign_external_id', 'contact_id']), 'campaign_context');
  const campaignExternalId = normalizedString(record.campaign_external_id, 'campaign_context.campaign_external_id', {
    required: true,
    max: 128,
  })!;
  const contactId = normalizedString(record.contact_id, 'campaign_context.contact_id', {
    required: true,
    max: 100,
  })!;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,127}$/.test(campaignExternalId)) {
    throw new Error('campaign_context.campaign_external_id is invalid');
  }
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(contactId)) {
    throw new Error('campaign_context.contact_id is invalid');
  }
  return { campaign_external_id: campaignExternalId, contact_id: contactId };
}

function canonicalOptionalRecord(
  value: unknown,
  field: string,
  allowed: ReadonlySet<string>,
  textFields: readonly string[],
): Record<string, string | undefined> | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, field);
  assertAllowedKeys(record, allowed, field);
  return Object.fromEntries(textFields.map((key) => [
    key,
    normalizedString(record[key], `${field}.${key}`),
  ]));
}

function canonicalJourney(value: unknown): LeadPayload['journey'] {
  if (value === undefined) return undefined;
  const record = asRecord(value, 'journey');
  assertAllowedKeys(record, new Set([
    'sections_viewed', 'scroll_depth', 'time_on_page_seconds', 'video_played',
    'form_steps_completed', 'repeat_visit',
  ]), 'journey');
  let sectionsViewed: string[] | undefined;
  if (record.sections_viewed !== undefined) {
    if (!Array.isArray(record.sections_viewed) || record.sections_viewed.length > 64) {
      throw new Error('journey.sections_viewed is invalid');
    }
    sectionsViewed = record.sections_viewed.map((item, index) =>
      normalizedString(item, `journey.sections_viewed[${index}]`, { required: true, max: 128 })!);
  }
  return {
    sections_viewed: sectionsViewed,
    scroll_depth: finiteNumber(record.scroll_depth, 'journey.scroll_depth', 0, 100),
    time_on_page_seconds: finiteNumber(record.time_on_page_seconds, 'journey.time_on_page_seconds', 0, 86_400),
    video_played: record.video_played === undefined ? undefined : booleanValue(record.video_played, 'journey.video_played'),
    form_steps_completed: finiteNumber(record.form_steps_completed, 'journey.form_steps_completed', 0, 100),
    repeat_visit: record.repeat_visit === undefined ? undefined : booleanValue(record.repeat_visit, 'journey.repeat_visit'),
  };
}

function canonicalInteractiveChecklist(value: unknown): LeadPayload['interactive_checklist'] {
  const record = asRecord(value, 'interactive_checklist');
  assertAllowedKeys(record, new Set(['score', 'risk_level', 'answers']), 'interactive_checklist');
  const answersRecord = asRecord(record.answers, 'interactive_checklist.answers');
  assertAllowedKeys(answersRecord, CHECKLIST_ANSWER_KEYS, 'interactive_checklist.answers');
  const answers: Record<string, string> = {};
  for (const [key, answer] of Object.entries(answersRecord)) {
    answers[key] = normalizedString(answer, `interactive_checklist.answers.${key}`, {
      required: true,
      max: 200,
    })!;
  }
  return {
    score: finiteNumber(record.score, 'interactive_checklist.score', 0, 14, true)!,
    risk_level: normalizedString(record.risk_level, 'interactive_checklist.risk_level', {
      required: true,
      max: 32,
    })!,
    answers,
  };
}

function canonicalCreditEstimate(value: unknown): LeadPayload['credit_estimate'] {
  if (value === undefined) return undefined;
  const record = asRecord(value, 'credit_estimate');
  assertAllowedKeys(record, new Set([
    'amount', 'currency', 'calculation_mode', 'calculation_source', 'applied_percentage',
    'requires_manual_review',
  ]), 'credit_estimate');
  const amount = record.amount === null
    ? null
    : finiteNumber(record.amount, 'credit_estimate.amount', 0, 1_000_000_000, true)!;
  if (record.currency !== 'EUR') throw new Error('credit_estimate.currency is invalid');
  if (!['fp_quota', 'other_contributions_base', 'no_data'].includes(String(record.calculation_mode))) {
    throw new Error('credit_estimate.calculation_mode is invalid');
  }
  if (!['minimum_credit', 'fp_quota', 'other_contributions_base', 'insufficient_data'].includes(String(record.calculation_source))) {
    throw new Error('credit_estimate.calculation_source is invalid');
  }
  return {
    amount,
    currency: 'EUR',
    calculation_mode: record.calculation_mode as NonNullable<LeadPayload['credit_estimate']>['calculation_mode'],
    calculation_source: record.calculation_source as NonNullable<LeadPayload['credit_estimate']>['calculation_source'],
    applied_percentage: finiteNumber(record.applied_percentage, 'credit_estimate.applied_percentage', 0, 100, true)!,
    requires_manual_review: booleanValue(record.requires_manual_review, 'credit_estimate.requires_manual_review'),
  };
}

function validateClientScoring(record: Record<string, unknown>): void {
  const scoring = asRecord(record.scoring, 'scoring');
  assertAllowedKeys(scoring, new Set([
    'fit', 'intent', 'engagement', 'urgency', 'total', 'classification',
  ]), 'scoring');
  for (const field of ['fit', 'intent', 'engagement', 'urgency', 'total']) {
    finiteNumber(scoring[field], `scoring.${field}`, 0, 100, true);
  }
  if (!['cold', 'warm', 'hot', 'priority'].includes(String(scoring.classification))) {
    throw new Error('scoring.classification is invalid');
  }
  finiteNumber(record.lead_score, 'lead_score', 0, 100, true);
  normalizedString(record.lead_status, 'lead_status', { required: true, max: 64 });
  if (!['cold', 'warm', 'hot', 'priority'].includes(String(record.lead_classification))) {
    throw new Error('lead_classification is invalid');
  }
}

export async function readBoundedJsonBody(
  request: Request,
  maximumBytes = MAX_LEAD_BODY_BYTES,
): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new Error('Content-Length is invalid');
    }
    if (parsedLength > maximumBytes) throw new PayloadTooLargeError();
  }
  if (!request.body) throw new Error('Lead payload is required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new Error('Lead payload is not valid UTF-8');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Lead payload is not valid JSON');
  }
}

function isIsoDate(value: string): boolean {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}

function assertShortText(value: unknown, field: string, required = false): void {
  if (value == null || value === '') {
    if (required) throw new Error(`${field} is required`);
    return;
  }
  if (typeof value !== 'string') {
    throw new Error(`${field} is invalid`);
  }
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > MAX_TEXT_LENGTH) {
    throw new Error(required && !normalized ? `${field} is required` : `${field} is invalid`);
  }
}

export function isProfessionalEmailAddress(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized) || normalized.length > 254) return false;
  const domain = normalized.slice(normalized.lastIndexOf('@') + 1);
  return !PERSONAL_EMAIL_DOMAINS.has(domain);
}

export function canonicalizeLeadPayload(input: unknown): LeadPayload {
  const record = asRecord(input, 'Lead payload');
  assertAllowedKeys(record, LEAD_INPUT_KEYS, 'lead');
  assertIdentifier(record.submission_id, 'submission_id');
  if (typeof record.form_type !== 'string' || !FORM_TYPES.has(record.form_type as FormType)) {
    throw new Error('form_type is invalid');
  }
  const formType = record.form_type as FormType;
  if (record.event_version !== '1.0') throw new Error('event_version is invalid');
  if (record.lead_magnet !== formType) throw new Error('lead_magnet must match form_type');
  const createdAt = normalizedString(record.created_at, 'created_at', { required: true, max: 64 })!;
  if (!isIsoDate(createdAt)) throw new Error('created_at is invalid');
  validateClientScoring(record);

  const contactRecord = asRecord(record.contact, 'contact');
  assertAllowedKeys(contactRecord, new Set(['name', 'email', 'phone', 'company', 'role']), 'contact');
  const email = normalizedString(contactRecord.email, 'contact.email', { required: true, max: 254 })!.toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error('contact.email is invalid');
  const requiresProfessionalIdentity = PROFESSIONAL_EMAIL_FORM_TYPES.has(formType);
  const name = normalizedString(contactRecord.name, 'contact.name', {
    required: requiresProfessionalIdentity,
  }) ?? '';
  if (requiresProfessionalIdentity && !isProfessionalEmailAddress(email)) {
    throw new Error('contact.email must be a professional email address');
  }

  const companyRecord = record.company === undefined ? undefined : asRecord(record.company, 'company');
  if (companyRecord) {
    assertAllowedKeys(companyRecord, new Set([
      'province', 'sector', 'employee_range', 'used_fundae_before', 'knows_credit',
      'current_training_provider', 'credit_calculation_mode', 'prior_year_fp_quota',
      'prior_year_other_contributions_base', 'special_situation',
    ]), 'company');
    if (
      companyRecord.credit_calculation_mode !== undefined &&
      !['fp_quota', 'other_contributions_base', 'no_data'].includes(String(companyRecord.credit_calculation_mode))
    ) throw new Error('company.credit_calculation_mode is invalid');
    if (
      companyRecord.special_situation !== undefined &&
      !['no', 'yes', 'unknown'].includes(String(companyRecord.special_situation))
    ) throw new Error('company.special_situation is invalid');
  }

  const interest = canonicalOptionalRecord(
    record.interest,
    'interest',
    new Set(['training_area', 'urgency', 'message']),
    ['training_area', 'urgency', 'message'],
  ) as LeadPayload['interest'];

  if (record.interactive_checklist !== undefined && formType !== 'interactive_checklist') {
    throw new Error('interactive_checklist is not allowed for this form_type');
  }
  const interactiveChecklist = formType === 'interactive_checklist'
    ? canonicalInteractiveChecklist(record.interactive_checklist)
    : undefined;
  if (interactiveChecklist && !['low', 'medium', 'high'].includes(interactiveChecklist.risk_level)) {
    throw new Error('interactive_checklist.risk_level is invalid');
  }

  const consentRecord = asRecord(record.consent, 'consent');
  assertAllowedKeys(consentRecord, new Set(['privacy_accepted', 'marketing_accepted']), 'consent');
  if (consentRecord.privacy_accepted !== true) throw new Error('privacy consent is required');
  const marketingAccepted = booleanValue(consentRecord.marketing_accepted, 'consent.marketing_accepted');

  if (record.delivery_status !== undefined && record.delivery_status !== 'captured') {
    throw new Error('delivery_status is invalid');
  }

  const scoringRecord = record.scoring as Record<string, unknown>;
  const leadClassification = record.lead_classification as LeadPayload['lead_classification'];
  const trackingContext = record.tracking_context === undefined
    ? undefined
    : canonicalTrackingContext(record.tracking_context);
  const journeyId = optionalIdentifier(record.journey_id, 'journey_id');
  const anonymousId = optionalIdentifier(record.anonymous_id, 'anonymous_id');
  const sessionId = optionalIdentifier(record.session_id, 'session_id');
  if (!trackingContext && (
    journeyId || anonymousId || sessionId || record.first_touch !== undefined ||
    record.last_touch !== undefined || record.campaign_context !== undefined
  )) {
    throw new Error('journey identifiers require accepted tracking_context');
  }
  if (trackingContext && (
    journeyId !== trackingContext.journey_id ||
    anonymousId !== trackingContext.journey_id ||
    sessionId !== trackingContext.session_id
  )) {
    throw new Error('journey identifiers do not match tracking_context');
  }
  const canonical: LeadPayload = {
    submission_id: String(record.submission_id).trim(),
    event_version: '1.0',
    form_type: formType,
    lead_magnet: formType,
    created_at: new Date(createdAt).toISOString(),
    source_url: normalizedUrl(record.source_url, 'source_url', true)!,
    journey_id: journeyId,
    anonymous_id: anonymousId,
    session_id: sessionId,
    utm_source: normalizedString(record.utm_source, 'utm_source'),
    utm_medium: normalizedString(record.utm_medium, 'utm_medium'),
    utm_campaign: normalizedString(record.utm_campaign, 'utm_campaign'),
    utm_content: normalizedString(record.utm_content, 'utm_content'),
    utm_term: normalizedString(record.utm_term, 'utm_term'),
    referrer: normalizedString(record.referrer, 'referrer', { max: MAX_URL_LENGTH }),
    first_touch: record.first_touch === undefined ? undefined : canonicalTouch(record.first_touch, 'first_touch'),
    last_touch: record.last_touch === undefined ? undefined : canonicalTouch(record.last_touch, 'last_touch'),
    tracking_context: trackingContext,
    campaign_context: record.campaign_context === undefined
      ? undefined
      : canonicalCampaignContext(record.campaign_context),
    lead_score: Number(record.lead_score),
    lead_status: normalizedString(record.lead_status, 'lead_status', { required: true, max: 64 })!,
    lead_classification: leadClassification,
    scoring: {
      fit: Number(scoringRecord.fit),
      intent: Number(scoringRecord.intent),
      engagement: Number(scoringRecord.engagement),
      urgency: Number(scoringRecord.urgency),
      total: Number(scoringRecord.total),
      classification: scoringRecord.classification as LeadPayload['lead_classification'],
    },
    contact: {
      name,
      email,
      phone: normalizedString(contactRecord.phone, 'contact.phone'),
      company: normalizedString(contactRecord.company, 'contact.company') ?? '',
      role: normalizedString(contactRecord.role, 'contact.role'),
    },
    company: companyRecord
      ? {
          province: normalizedString(companyRecord.province, 'company.province'),
          sector: normalizedString(companyRecord.sector, 'company.sector'),
          employee_range: normalizedString(companyRecord.employee_range, 'company.employee_range'),
          used_fundae_before: normalizedString(companyRecord.used_fundae_before, 'company.used_fundae_before'),
          knows_credit: normalizedString(companyRecord.knows_credit, 'company.knows_credit'),
          current_training_provider: normalizedString(
            companyRecord.current_training_provider,
            'company.current_training_provider',
          ),
          credit_calculation_mode: companyRecord.credit_calculation_mode as LeadPayload['company'] extends infer T
            ? T extends { credit_calculation_mode?: infer M } ? M : never
            : never,
          prior_year_fp_quota: finiteNumber(
            companyRecord.prior_year_fp_quota,
            'company.prior_year_fp_quota',
            0,
            1_000_000_000,
          ),
          prior_year_other_contributions_base: finiteNumber(
            companyRecord.prior_year_other_contributions_base,
            'company.prior_year_other_contributions_base',
            0,
            1_000_000_000,
          ),
          special_situation: companyRecord.special_situation as 'no' | 'yes' | 'unknown' | undefined,
        }
      : undefined,
    interest,
    interactive_checklist: interactiveChecklist,
    credit_estimate: canonicalCreditEstimate(record.credit_estimate),
    journey: canonicalJourney(record.journey),
    consent: {
      privacy_accepted: true,
      marketing_accepted: marketingAccepted,
    },
    delivery_status: 'captured',
    checklist_pdf_url: record.checklist_pdf_url === undefined
      ? undefined
      : normalizedUrl(record.checklist_pdf_url, 'checklist_pdf_url', true),
  };
  return canonical;
}

function publicLeadInputFromStored(input: unknown): Record<string, unknown> {
  const stored = asRecord(input, 'Lead payload');
  const inputOnly: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (LEAD_INPUT_KEYS.has(key)) inputOnly[key] = value;
    else if (!SERVER_OWNED_LEAD_KEYS.has(key)) throw new Error(`lead.${key} is not allowed`);
  }
  return inputOnly;
}

function captureProjection(input: unknown): Record<string, unknown> {
  const canonical = canonicalizeLeadPayload(publicLeadInputFromStored(input));
  const {
    lead_score: _leadScore,
    lead_status: _leadStatus,
    lead_classification: _leadClassification,
    scoring: _scoring,
    delivery_status: _deliveryStatus,
    ...projection
  } = canonical;
  return projection;
}

export function leadCapturePayloadSha256(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(captureProjection(input)), 'utf8').digest('hex');
}

export function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value.trim())) {
    throw new Error(`${field} is invalid`);
  }
}

export function validateLeadPayload(input: unknown): asserts input is LeadPayload {
  if (!input || typeof input !== 'object') throw new Error('Lead payload must be an object');
  const lead = input as Partial<LeadPayload>;
  assertIdentifier(lead.submission_id, 'submission_id');
  if (!lead.form_type || !FORM_TYPES.has(lead.form_type)) throw new Error('form_type is invalid');
  if (!lead.created_at || !isIsoDate(lead.created_at)) throw new Error('created_at is invalid');
  if (!lead.contact || typeof lead.contact !== 'object') throw new Error('contact is required');
  const email = lead.contact.email?.trim().toLowerCase() ?? '';
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new Error('contact.email is invalid');
  const requiresProfessionalIdentity = PROFESSIONAL_EMAIL_FORM_TYPES.has(lead.form_type);
  assertShortText(lead.contact.name, 'contact.name', requiresProfessionalIdentity);
  if (requiresProfessionalIdentity && !isProfessionalEmailAddress(email)) {
    throw new Error('contact.email must be a professional email address');
  }
  assertShortText(lead.contact.company, 'contact.company');
  assertShortText(lead.contact.phone, 'contact.phone');
  assertShortText(lead.contact.role, 'contact.role');
  if (!lead.consent || lead.consent.privacy_accepted !== true) {
    throw new Error('privacy consent is required');
  }
}

export function validateEventPayload(input: unknown): asserts input is EventPayload {
  canonicalizeJourneyEventInput(input);
}

export function safeInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}
