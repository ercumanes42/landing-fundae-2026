import type { EventPayload, TouchAttribution, TrackingContext } from './types';

export const JOURNEY_EVENT_NAMES = [
  'page_view',
  'page_abandon',
  'session_start',
  'session_ping',
  'section_view',
  'scroll_milestone',
  'cta_click',
  'tool_start',
  'tool_step',
  'tool_complete',
  'tool_abandon',
  'resource_download',
  'form_start',
  'form_step',
  'form_submit',
  'form_success',
  'form_error',
  'video_start',
  'video_quartile',
  'video_complete',
  'video_abandon',
] as const;
export type JourneyEventName = (typeof JOURNEY_EVENT_NAMES)[number];

export const JOURNEY_RETENTION_POLICY = {
  browserJourneyDays: 30,
  browserSessionIdleMinutes: 30,
  rawEventDays: 90,
  aggregateOnlyAfterRawExpiry: true,
} as const;

const JOURNEY_EVENT_SET = new Set<string>(JOURNEY_EVENT_NAMES);
const JOURNEY_CONSENT_VERSION = '2026-08-19';
const JOURNEY_ID = /^jrn_[a-f0-9]{32}$/;
const SESSION_ID = /^ses_[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/i;
const PHONE_LIKE = /(?:\+?\d[\s().-]*){8,}/;
const JOURNEY_TOP_LEVEL_KEYS = new Set(['event_name', 'context', 'properties']);
const JOURNEY_CONTEXT_KEYS = new Set([
  'event_id', 'event_version', 'occurred_at', 'journey_id', 'anonymous_id',
  'session_id', 'identity_persistence', 'storage_available', 'first_touch',
  'last_touch', 'lead_magnet', 'section', 'source_url', 'referrer', 'utm_source',
  'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'partner',
  'device_type', 'viewport_width', 'consent_state', 'consent_version',
]);
const TOUCH_KEYS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'referrer', 'lead_magnet', 'source_url', 'captured_at',
]);
const JOURNEY_PROPERTY_KEYS = new Set([
  'page_path', 'section', 'depth_percent', 'active_seconds', 'idle_seconds',
  'max_scroll_percent', 'last_section', 'reason', 'cta_id', 'location',
  'tool_id', 'step', 'step_count', 'asset_id', 'form_type', 'outcome_code',
  'video_id', 'play_session_id', 'quartile', 'current_time_seconds',
  'duration_seconds', 'is_muted', 'playback_rate', 'scroll_depth_percent',
  'lead_magnet', 'high_intent', 'score', 'classification',
]);
const JOURNEY_PII_KEYS = new Set([
  'email', 'email_address', 'name', 'first_name', 'last_name', 'phone', 'mobile',
  'company', 'company_name', 'message', 'contact', 'answers', 'address', 'ip',
  'ip_address', 'campaign_contact_id', 'contact_id',
]);
const LEAD_MAGNETS = new Set([
  'calculator', 'checklist', 'interactive_checklist', 'webinar', 'diagnostic', 'unknown',
]);

function journeyRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, allowed: Set<string>, field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) || JOURNEY_PII_KEYS.has(key.toLowerCase())) {
      throw new Error(`${field}.${key} is not allowed`);
    }
  }
}

function safeJourneyString(
  value: unknown,
  field: string,
  options: { required?: boolean; token?: boolean; maximum?: number } = {},
): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (options.required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new Error(`${field} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > (options.maximum ?? 128) ||
      EMAIL_LIKE.test(normalized) || PHONE_LIKE.test(normalized) ||
      (options.token && !SAFE_TOKEN.test(normalized))) {
    throw new Error(`${field} may contain PII or is invalid`);
  }
  return normalized;
}

function safeJourneyTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} is invalid`);
  }
  return new Date(value).toISOString();
}

function safeJourneyUrl(value: unknown, field: string, referrerOnly = false): string {
  const normalized = safeJourneyString(value, field, { required: true, maximum: 2048 })!;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${field} is invalid`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || EMAIL_LIKE.test(url.pathname)) {
    throw new Error(`${field} must not contain credentials, query, fragment, or PII`);
  }
  if (referrerOnly && url.pathname !== '/') {
    throw new Error(`${field} must contain only an origin`);
  }
  return referrerOnly ? url.origin : `${url.origin}${url.pathname}`;
}

function canonicalJourneyTouch(value: unknown, field: string): TouchAttribution {
  const record = journeyRecord(value, field);
  assertExactKeys(record, TOUCH_KEYS, field);
  const leadMagnet = safeJourneyString(record.lead_magnet, `${field}.lead_magnet`, {
    required: true,
    token: true,
  })!;
  if (!LEAD_MAGNETS.has(leadMagnet)) throw new Error(`${field}.lead_magnet is invalid`);
  const capturedAt = safeJourneyTimestamp(record.captured_at, `${field}.captured_at`);
  const referrer = record.referrer === ''
    ? ''
    : safeJourneyUrl(record.referrer, `${field}.referrer`, true);
  return {
    utm_source: safeJourneyString(record.utm_source, `${field}.utm_source`, { required: true, token: true })!,
    utm_medium: safeJourneyString(record.utm_medium, `${field}.utm_medium`, { required: true, token: true })!,
    utm_campaign: safeJourneyString(record.utm_campaign, `${field}.utm_campaign`, { required: true, token: true })!,
    utm_content: record.utm_content === '' ? '' : safeJourneyString(record.utm_content, `${field}.utm_content`, { token: true })!,
    utm_term: record.utm_term === '' ? '' : safeJourneyString(record.utm_term, `${field}.utm_term`, { token: true })!,
    referrer,
    lead_magnet: leadMagnet as TouchAttribution['lead_magnet'],
    source_url: safeJourneyUrl(record.source_url, `${field}.source_url`),
    captured_at: capturedAt,
  };
}

export function canonicalizeJourneyContext(value: unknown): TrackingContext {
  const context = journeyRecord(value, 'context');
  assertExactKeys(context, JOURNEY_CONTEXT_KEYS, 'context');
  if (context.event_version !== '2.0') throw new Error('context.event_version is invalid');
  if (context.consent_state !== 'accepted') throw new Error('context.consent_state must be accepted');
  if (typeof context.event_id !== 'string' || !UUID.test(context.event_id)) {
    throw new Error('context.event_id is invalid');
  }
  if (typeof context.journey_id !== 'string' || !JOURNEY_ID.test(context.journey_id) ||
      context.anonymous_id !== context.journey_id) {
    throw new Error('context.journey_id is invalid');
  }
  if (typeof context.session_id !== 'string' || !SESSION_ID.test(context.session_id)) {
    throw new Error('context.session_id is invalid');
  }
  const occurredAt = safeJourneyTimestamp(context.occurred_at, 'context.occurred_at');
  if (!['localStorage', 'memory'].includes(String(context.identity_persistence)) ||
      typeof context.storage_available !== 'boolean') {
    throw new Error('context persistence is invalid');
  }
  const leadMagnet = safeJourneyString(context.lead_magnet, 'context.lead_magnet', {
    required: true,
    token: true,
  })!;
  if (!LEAD_MAGNETS.has(leadMagnet)) throw new Error('context.lead_magnet is invalid');
  if (!['desktop', 'tablet', 'mobile', 'unknown'].includes(String(context.device_type))) {
    throw new Error('context.device_type is invalid');
  }
  if (typeof context.viewport_width !== 'number' || !Number.isInteger(context.viewport_width) ||
      context.viewport_width < 1 || context.viewport_width > 20_000) {
    throw new Error('context.viewport_width is invalid');
  }
  return {
    event_id: context.event_id,
    event_version: '2.0',
    occurred_at: occurredAt,
    journey_id: context.journey_id,
    anonymous_id: context.journey_id,
    session_id: context.session_id,
    identity_persistence: context.identity_persistence as TrackingContext['identity_persistence'],
    storage_available: context.storage_available,
    first_touch: canonicalJourneyTouch(context.first_touch, 'context.first_touch'),
    last_touch: canonicalJourneyTouch(context.last_touch, 'context.last_touch'),
    lead_magnet: leadMagnet as TrackingContext['lead_magnet'],
    section: safeJourneyString(context.section, 'context.section', { token: true }),
    source_url: safeJourneyUrl(context.source_url, 'context.source_url'),
    referrer: context.referrer === '' ? '' : safeJourneyUrl(context.referrer, 'context.referrer', true),
    utm_source: safeJourneyString(context.utm_source, 'context.utm_source', { required: true, token: true })!,
    utm_medium: safeJourneyString(context.utm_medium, 'context.utm_medium', { required: true, token: true })!,
    utm_campaign: safeJourneyString(context.utm_campaign, 'context.utm_campaign', { required: true, token: true })!,
    utm_content: context.utm_content === '' ? '' : safeJourneyString(context.utm_content, 'context.utm_content', { token: true })!,
    utm_term: context.utm_term === '' ? '' : safeJourneyString(context.utm_term, 'context.utm_term', { token: true })!,
    partner: safeJourneyString(context.partner, 'context.partner', { token: true }),
    device_type: context.device_type as TrackingContext['device_type'],
    viewport_width: context.viewport_width,
    consent_state: 'accepted',
    consent_version: context.consent_version === JOURNEY_CONSENT_VERSION
      ? JOURNEY_CONSENT_VERSION
      : (() => { throw new Error('context.consent_version is invalid'); })(),
  };
}

function canonicalJourneyProperties(eventName: JourneyEventName, value: unknown): Record<string, unknown> {
  const properties = journeyRecord(value ?? {}, 'properties');
  assertExactKeys(properties, JOURNEY_PROPERTY_KEYS, 'properties');
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(properties)) {
    if (typeof item === 'string') {
      result[key] = safeJourneyString(item, `properties.${key}`, {
        required: true,
        token: key !== 'page_path',
        maximum: key === 'page_path' ? 256 : 128,
      })!;
    } else if (typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 86_400) {
      result[key] = item;
    } else if (typeof item === 'boolean') {
      result[key] = item;
    } else {
      throw new Error(`properties.${key} is invalid`);
    }
  }
  if ('page_path' in result &&
      (typeof result.page_path !== 'string' || !result.page_path.startsWith('/') ||
        /[?#@]/.test(result.page_path))) {
    throw new Error('properties.page_path is invalid');
  }
  if (['page_view', 'page_abandon'].includes(eventName) && !result.page_path) {
    throw new Error('properties.page_path is required');
  }
  if (eventName === 'page_abandon' &&
      !['pagehide', 'visibility_hidden'].includes(String(result.reason))) {
    throw new Error('properties.reason is invalid');
  }
  if (eventName.startsWith('video_')) {
    if (!result.video_id || !result.play_session_id) {
      throw new Error('video identity is required');
    }
    if (eventName === 'video_quartile' && ![25, 50, 75, 100].includes(Number(result.quartile))) {
      throw new Error('properties.quartile is invalid');
    }
  }
  if (eventName.startsWith('tool_') && !result.tool_id) {
    throw new Error('properties.tool_id is required');
  }
  if (eventName === 'tool_step' &&
      (!Number.isInteger(result.step) || Number(result.step) < 1 || Number(result.step) > 100)) {
    throw new Error('properties.step is invalid');
  }
  if (eventName === 'tool_abandon' &&
      !['pagehide', 'visibility_hidden', 'explicit'].includes(String(result.reason))) {
    throw new Error('properties.reason is invalid');
  }
  if (eventName.startsWith('form_') && !result.form_type) {
    throw new Error('properties.form_type is required');
  }
  return result;
}

export function canonicalizeJourneyEventInput(input: unknown): EventPayload {
  const payload = journeyRecord(input, 'event');
  assertExactKeys(payload, JOURNEY_TOP_LEVEL_KEYS, 'event');
  if (typeof payload.event_name !== 'string' || !JOURNEY_EVENT_SET.has(payload.event_name)) {
    throw new Error('event_name is not allowed');
  }
  return {
    event_name: payload.event_name,
    context: canonicalizeJourneyContext(payload.context),
    properties: canonicalJourneyProperties(payload.event_name as JourneyEventName, payload.properties),
  };
}

export const CAMPAIGN_CHANNELS = ['email', 'linkedin', 'manual'] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const CAMPAIGN_CAPTURE_METHODS = [
  'automation',
  'provider_webhook',
  'official_api',
  'manual',
] as const;
export type CampaignCaptureMethod = (typeof CAMPAIGN_CAPTURE_METHODS)[number];

export const CAMPAIGN_EXECUTION_STATUSES = ['planned', 'executed', 'failed', 'stopped'] as const;
export type CampaignExecutionStatus = (typeof CAMPAIGN_EXECUTION_STATUSES)[number];

export const CANONICAL_CAMPAIGN_EVENTS = [
  'delivery_scheduled',
  'delivery_sent',
  'delivery_delivered',
  'delivery_failed',
  'email_opened',
  'link_clicked',
  'reply_received',
  'bounce_hard',
  'unsubscribe',
  'tool_started',
  'tool_completed',
  'pdf_downloaded',
  'transactional_delivery_sent',
  'transactional_delivery_failed',
  'meeting_booked',
  'meeting_completed',
  'opportunity_created',
] as const;
export type CanonicalCampaignEvent = (typeof CANONICAL_CAMPAIGN_EVENTS)[number];

export interface CanonicalTrackingInput {
  campaign_external_id: string;
  contact_id: string;
  event_name: CanonicalCampaignEvent;
  source_event_id: string;
  execution_key: string;
  channel: CampaignChannel;
  capture_method: CampaignCaptureMethod;
  occurred_at?: string;
  scheduled_for?: string | null;
  execution_status?: CampaignExecutionStatus;
  context?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

export interface CampaignStopGateInput {
  eventName: string;
  campaignActive: boolean;
  campaignStatus: string;
  suppressionScope: 'none' | 'marketing' | 'all';
  marketingLane: 'cold' | 'intent' | 'none';
  coldSequenceStatus: string;
  intentSequenceStatus: string;
}

const CANONICAL_EVENT_SET = new Set<string>(CANONICAL_CAMPAIGN_EVENTS);
const CHANNEL_SET = new Set<string>(CAMPAIGN_CHANNELS);
const CAPTURE_METHOD_SET = new Set<string>(CAMPAIGN_CAPTURE_METHODS);
const EXECUTION_STATUS_SET = new Set<string>(CAMPAIGN_EXECUTION_STATUSES);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/;
const PII_VALUE_PATTERN = /(^|\s)[^\s@]+@[^\s@]+\.[^\s@]+($|\s)/i;
const OUTBOUND_GATE_EVENTS = new Set(['delivery_scheduled']);
const TOP_LEVEL_KEYS = new Set([
  'campaign_external_id', 'contact_id', 'event_name', 'source_event_id', 'execution_key',
  'channel', 'capture_method', 'occurred_at', 'scheduled_for', 'execution_status',
  'context', 'properties',
]);
const PII_KEYS = new Set([
  'email', 'email_address', 'name', 'first_name', 'last_name', 'phone', 'mobile',
  'company', 'company_name', 'job_title', 'message', 'answers', 'contact', 'address',
  'ip', 'ip_address',
]);
const CONTEXT_KEYS = new Set([
  'provider', 'provider_event_id', 'campaign_version', 'timezone', 'locale', 'source',
  'metric_quality',
]);
const PROPERTY_KEYS = new Set([
  'step', 'template_id', 'asset_id', 'link_id', 'tool_id', 'status_code', 'reason_code',
  'reply_type', 'bounce_type', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
  'platform',
]);

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value.trim())) {
    throw new Error(`${field} is invalid`);
  }
}

function validateSafeMetadata(value: unknown, allowedKeys: Set<string>, field: string): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (!allowedKeys.has(normalizedKey) || PII_KEYS.has(normalizedKey)) {
      throw new Error(`${field}.${key} is not allowed`);
    }
    if (!['string', 'number', 'boolean'].includes(typeof item) || item === null) {
      throw new Error(`${field}.${key} must be a scalar value`);
    }
    if (typeof item === 'string' && (item.length > 200 || PII_VALUE_PATTERN.test(item))) {
      throw new Error(`${field}.${key} may contain PII or is too long`);
    }
  }
}

export function isCanonicalCampaignEvent(eventName: string): eventName is CanonicalCampaignEvent {
  return CANONICAL_EVENT_SET.has(eventName);
}

export function executionStatusForEvent(eventName: CanonicalCampaignEvent): CampaignExecutionStatus {
  if (eventName === 'delivery_scheduled') return 'planned';
  if (['delivery_failed', 'transactional_delivery_failed', 'bounce_hard'].includes(eventName)) return 'failed';
  if (['unsubscribe', 'reply_received', 'meeting_booked', 'meeting_completed', 'opportunity_created'].includes(eventName)) {
    return 'stopped';
  }
  return 'executed';
}

export function validateCanonicalTrackingInput(input: unknown): asserts input is CanonicalTrackingInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Tracking payload must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) throw new Error(`${key} is not allowed`);
  }
  const event = input as Partial<CanonicalTrackingInput>;
  if (!event.event_name || !isCanonicalCampaignEvent(event.event_name)) {
    throw new Error('event_name is not a canonical campaign event');
  }
  assertIdentifier(event.campaign_external_id, 'campaign_external_id');
  assertIdentifier(event.contact_id, 'contact_id');
  assertIdentifier(event.source_event_id, 'source_event_id');
  assertIdentifier(event.execution_key, 'execution_key');
  if (!event.channel || !CHANNEL_SET.has(event.channel)) throw new Error('channel is invalid');
  if (!event.capture_method || !CAPTURE_METHOD_SET.has(event.capture_method)) {
    throw new Error('capture_method is invalid');
  }
  if (event.channel === 'linkedin' && !['manual', 'official_api'].includes(event.capture_method)) {
    throw new Error('LinkedIn tracking only supports manual or official_api capture');
  }
  if (event.channel === 'manual' && event.capture_method !== 'manual') {
    throw new Error('Manual channel requires manual capture');
  }
  if (event.event_name === 'email_opened' && event.channel !== 'email') {
    throw new Error('email_opened requires the email channel');
  }
  if (event.occurred_at !== undefined && !isIsoDate(event.occurred_at)) {
    throw new Error('occurred_at is invalid');
  }
  if (event.scheduled_for !== undefined && event.scheduled_for !== null && !isIsoDate(event.scheduled_for)) {
    throw new Error('scheduled_for is invalid');
  }
  if (event.execution_status && !EXECUTION_STATUS_SET.has(event.execution_status)) {
    throw new Error('execution_status is invalid');
  }
  const expectedStatus = executionStatusForEvent(event.event_name);
  if (event.execution_status && event.execution_status !== expectedStatus) {
    throw new Error(`execution_status must be ${expectedStatus} for ${event.event_name}`);
  }
  if (event.event_name === 'delivery_scheduled' && !event.scheduled_for) {
    throw new Error('scheduled_for is required for delivery_scheduled');
  }
  validateSafeMetadata(event.context, CONTEXT_KEYS, 'context');
  validateSafeMetadata(event.properties, PROPERTY_KEYS, 'properties');
}

export function canPassCampaignStopGate(input: CampaignStopGateInput): boolean {
  if (!OUTBOUND_GATE_EVENTS.has(input.eventName)) return true;
  if (!input.campaignActive || !['active', 'running', 'pilot'].includes(input.campaignStatus)) return false;
  if (input.suppressionScope !== 'none' || input.marketingLane === 'none') return false;
  if (input.marketingLane === 'cold') return ['pending', 'active'].includes(input.coldSequenceStatus);
  return ['pending', 'active'].includes(input.intentSequenceStatus);
}

export function directionalMetricQuality(eventName: string): 'directional' | 'confirmed' {
  return eventName === 'email_opened' ? 'directional' : 'confirmed';
}
