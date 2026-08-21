import { createHmac } from 'node:crypto';
import type {
  DashboardAggregates,
  DashboardEventSample,
  DashboardLeadSample,
  DashboardPaginationState,
  LeadClassification,
  LeadMagnet,
} from './types';

type JsonRecord = Record<string, unknown>;

export interface DashboardLeadSourceRow {
  id: string;
  anonymous_id: string | null;
  lead_classification: string | null;
  lead_magnet: string | null;
  lead_score: number | null;
  created_at: string;
  delivery_status: string | null;
  first_utm_source: string | null;
  first_utm_medium: string | null;
  first_utm_campaign: string | null;
  payload: JsonRecord | null;
}

export interface DashboardEventSourceRow {
  id: string;
  event_name: string;
  anonymous_id: string | null;
  session_id: string | null;
  lead_magnet: string | null;
  occurred_at: string;
  context: JsonRecord | null;
  properties: JsonRecord | null;
}

export interface DashboardQueueSourceRow {
  status: string | null;
}

export interface DashboardCampaignSourceRow {
  id: string;
  external_id: string;
  name: string;
  status: string;
}

export interface DashboardCampaignContactSourceRow {
  id: string;
  campaign_id: string;
  external_contact_id: string;
  variant: string;
  magnet: string;
  lot: string;
  company_size: string | null;
  sequence_status: string;
  next_delivery_status: string;
  cold_sequence_status: string | null;
  transactional_status: string | null;
  intent_sequence_status: string | null;
  marketing_lane: string | null;
  suppression_scope: string | null;
  current_step: number | null;
  next_scheduled_at: string | null;
  stopped_at: string | null;
  stopped_reason: string | null;
  last_delivery_status: string | null;
  reply_type: string | null;
  deal_value: number | null;
  conditional_delivery: boolean;
  locked_at: string | null;
  lock_expires_at: string | null;
  last_error_code: string | null;
}

export interface DashboardCampaignEventSourceRow {
  id: string;
  campaign_id: string;
  campaign_contact_id: string;
  execution_id: string | null;
  event_name: string;
  occurred_at: string;
  channel: string | null;
  capture_method: string | null;
  metric_quality: string | null;
  properties: JsonRecord | null;
}

export interface DashboardCampaignExecutionSourceRow {
  id: string;
  campaign_id: string;
  campaign_contact_id: string;
  channel: string;
  capture_method: string;
  action_name: string;
  step: number | null;
  status: string;
  scheduled_for: string | null;
  planned_at: string | null;
  actual_at: string | null;
  failed_at: string | null;
  stopped_at: string | null;
  failure_code: string | null;
  stop_reason: string | null;
  created_at: string;
}

export interface PaginatedRows<T> {
  rows: T[];
  pagination: DashboardPaginationState;
}

const EVENT_PROPERTY_ALLOWLIST = new Set([
  'active_seconds',
  'cta_name',
  'depth_pct',
  'device_type',
  'idle_seconds',
  'lead_magnet',
  'play_percent',
  'question_id',
  'seconds_watched',
  'section',
  'section_name',
  'step',
  'time_spent_seconds',
  'utm_campaign',
  'utm_medium',
  'utm_source',
  'video_id',
]);
const CAMPAIGN_EVENT_PROPERTY_ALLOWLIST = new Set([
  'current_step',
  'channel',
  'content_id',
  'delivery_status',
  'error_code',
  'last_delivery_status',
  'marketing_lane',
  'next_delivery_status',
  'journey_stage',
  'link_name',
  'reason',
  'reply_type',
  'scheduled_at',
  'status',
  'sequence_step',
  'step',
  'stop_reason',
]);


function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function cleanString(value: unknown, maxLength = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim().slice(0, maxLength);
  return cleaned || undefined;
}

function readString(record: JsonRecord, ...path: string[]): string | undefined {
  let value: unknown = record;
  for (const key of path) value = asRecord(value)[key];
  return cleanString(value);
}

function readNumber(record: JsonRecord, ...path: string[]): number | null {
  let value: unknown = record;
  for (const key of path) value = asRecord(value)[key];
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function pseudonymize(value: string | null | undefined, secret: string, prefix: string): string | undefined {
  if (!value) return undefined;
  const digest = createHmac('sha256', secret).update(value).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

function countBy<T>(rows: T[], keyFor: (row: T) => string | null | undefined): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const key = cleanString(keyFor(row)) ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function safeLeadClassification(value: string | null): LeadClassification {
  return value === 'warm' || value === 'hot' || value === 'priority' ? value : 'cold';
}

function safeLeadMagnet(value: string | null): LeadMagnet {
  return value === 'calculator' ||
    value === 'checklist' ||
    value === 'interactive_checklist' ||
    value === 'webinar' ||
    value === 'diagnostic'
    ? value
    : 'unknown';
}

function leadDimension(row: DashboardLeadSourceRow, dimension: string): string | undefined {
  const payload = asRecord(row.payload);
  const company = asRecord(payload.company);
  const tracking = asRecord(payload.tracking_context);

  switch (dimension) {
    case 'source':
      return cleanString(row.first_utm_source) ?? cleanString(payload.utm_source) ?? cleanString(tracking.utm_source);
    case 'medium':
      return cleanString(row.first_utm_medium) ?? cleanString(payload.utm_medium) ?? cleanString(tracking.utm_medium);
    case 'campaign':
      return cleanString(row.first_utm_campaign) ?? cleanString(payload.utm_campaign) ?? cleanString(tracking.utm_campaign);
    case 'province':
      return cleanString(company.province);
    case 'sector':
      return cleanString(company.sector);
    case 'companySize':
      return cleanString(company.employee_range);
    default:
      return undefined;
  }
}

export function paginateRows<T>(rows: T[], requestedPage: number, pageSize: number): PaginatedRows<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(rows.length / safePageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(requestedPage)));
  const offset = (page - 1) * safePageSize;

  return {
    rows: rows.slice(offset, offset + safePageSize),
    pagination: {
      page,
      pageSize: safePageSize,
      total: rows.length,
      totalPages,
      hasPrevious: page > 1,
      hasMore: page < totalPages,
    },
  };
}

export function sanitizeLead(
  row: DashboardLeadSourceRow,
  secret: string,
): DashboardLeadSample {
  const payload = asRecord(row.payload);
  const company = asRecord(payload.company);
  const tracking = asRecord(payload.tracking_context);
  const anonymousId = pseudonymize(row.anonymous_id ?? cleanString(payload.anonymous_id), secret, 'visitor');

  return {
    id: pseudonymize(row.id, secret, 'lead') ?? 'lead_unknown',
    ...(anonymousId ? { anonymous_id: anonymousId } : {}),
    lead_classification: safeLeadClassification(row.lead_classification),
    lead_magnet: safeLeadMagnet(row.lead_magnet),
    lead_score: Number.isFinite(Number(row.lead_score)) ? Number(row.lead_score) : 0,
    created_at: row.created_at,
    ...(cleanString(row.delivery_status) ? { delivery_status: cleanString(row.delivery_status) } : {}),
    ...(cleanString(row.first_utm_source) ? { first_utm_source: cleanString(row.first_utm_source) } : {}),
    ...(cleanString(row.first_utm_medium) ? { first_utm_medium: cleanString(row.first_utm_medium) } : {}),
    ...(cleanString(row.first_utm_campaign) ? { first_utm_campaign: cleanString(row.first_utm_campaign) } : {}),
    payload: {
      ...(anonymousId ? { anonymous_id: anonymousId } : {}),
      ...(cleanString(payload.utm_source) ? { utm_source: cleanString(payload.utm_source) } : {}),
      ...(cleanString(payload.utm_medium) ? { utm_medium: cleanString(payload.utm_medium) } : {}),
      ...(cleanString(payload.utm_campaign) ? { utm_campaign: cleanString(payload.utm_campaign) } : {}),
      tracking_context: {
        ...(cleanString(tracking.utm_source) ? { utm_source: cleanString(tracking.utm_source) } : {}),
        ...(cleanString(tracking.utm_medium) ? { utm_medium: cleanString(tracking.utm_medium) } : {}),
        ...(cleanString(tracking.utm_campaign) ? { utm_campaign: cleanString(tracking.utm_campaign) } : {}),
      },
      company: {
        ...(cleanString(company.province) ? { province: cleanString(company.province) } : {}),
        ...(cleanString(company.sector) ? { sector: cleanString(company.sector) } : {}),
        ...(cleanString(company.employee_range) ? { employee_range: cleanString(company.employee_range) } : {}),
        ...(cleanString(company.used_fundae_before) ? { used_fundae_before: cleanString(company.used_fundae_before) } : {}),
        ...(cleanString(company.knows_credit) ? { knows_credit: cleanString(company.knows_credit) } : {}),
      },
    },
  };
}

export function sanitizeEvent(
  row: DashboardEventSourceRow,
  secret: string,
): DashboardEventSample {
  const context = asRecord(row.context);
  const properties = Object.entries(asRecord(row.properties)).reduce<DashboardEventSample['properties']>(
    (safe, [key, value]) => {
      if (!EVENT_PROPERTY_ALLOWLIST.has(key)) return safe;
      if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        safe[key] = value;
      } else {
        const cleaned = cleanString(value);
        if (cleaned) safe[key] = cleaned;
      }
      return safe;
    },
    {},
  );
  const anonymousId = pseudonymize(row.anonymous_id, secret, 'visitor');
  const sessionId = pseudonymize(row.session_id, secret, 'session');

  return {
    id: pseudonymize(row.id, secret, 'event') ?? 'event_unknown',
    event_name: cleanString(row.event_name) ?? 'unknown',
    ...(anonymousId ? { anonymous_id: anonymousId } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(cleanString(row.lead_magnet) ? { lead_magnet: cleanString(row.lead_magnet) } : {}),
    occurred_at: row.occurred_at,
    context: {
      ...(readString(context, 'lead_magnet') ? { lead_magnet: readString(context, 'lead_magnet') } : {}),
    },
    properties,
  };
}

export function sanitizeCampaignRows(
  campaigns: DashboardCampaignSourceRow[],
  contacts: DashboardCampaignContactSourceRow[],
  events: DashboardCampaignEventSourceRow[],
  executions: DashboardCampaignExecutionSourceRow[],
  secret: string,
) {
  return {
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      id: pseudonymize(campaign.id, secret, 'campaign') ?? 'campaign_unknown',
    })),
    contacts: contacts.map((contact) => ({
      ...contact,
      id: pseudonymize(contact.id, secret, 'contact') ?? 'contact_unknown',
      campaign_id: pseudonymize(contact.campaign_id, secret, 'campaign') ?? 'campaign_unknown',
      external_contact_id: pseudonymize(contact.external_contact_id, secret, 'external') ?? 'external_unknown',
    })),
    events: events.map((event) => {
      const properties = Object.entries(asRecord(event.properties)).reduce<Record<string, string | number | boolean | null>>(
        (safe, [key, value]) => {
          if (!CAMPAIGN_EVENT_PROPERTY_ALLOWLIST.has(key)) return safe;
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
            safe[key] = typeof value === 'string' ? value.slice(0, 120) : value;
          }
          return safe;
        },
        {},
      );
      return {
        ...event,
        properties,
        id: pseudonymize(event.id, secret, 'campaign_event') ?? 'campaign_event_unknown',
        campaign_id: pseudonymize(event.campaign_id, secret, 'campaign') ?? 'campaign_unknown',
        campaign_contact_id: pseudonymize(event.campaign_contact_id, secret, 'contact') ?? 'contact_unknown',
        execution_id: event.execution_id
          ? pseudonymize(event.execution_id, secret, 'execution')
          : null,
      };
    }),
    executions: executions.map((execution) => ({
      ...execution,
      id: pseudonymize(execution.id, secret, 'execution') ?? 'execution_unknown',
      campaign_id: pseudonymize(execution.campaign_id, secret, 'campaign') ?? 'campaign_unknown',
      campaign_contact_id: pseudonymize(execution.campaign_contact_id, secret, 'contact') ?? 'contact_unknown',
    })),
  };
}

export function buildDashboardAggregates(input: {
  leads: DashboardLeadSourceRow[];
  events: DashboardEventSourceRow[];
  queue: DashboardQueueSourceRow[];
  campaignContacts: DashboardCampaignContactSourceRow[];
  campaignEvents: DashboardCampaignEventSourceRow[];
}): DashboardAggregates {
  const { leads, events, queue, campaignContacts, campaignEvents } = input;
  const byClassification: Record<LeadClassification, number> = { cold: 0, warm: 0, hot: 0, priority: 0 };
  const byMagnet: Record<LeadMagnet, number> = {
    calculator: 0,
    checklist: 0,
    interactive_checklist: 0,
    webinar: 0,
    diagnostic: 0,
    unknown: 0,
  };

  for (const lead of leads) {
    byClassification[safeLeadClassification(lead.lead_classification)] += 1;
    byMagnet[safeLeadMagnet(lead.lead_magnet)] += 1;
  }

  const uniqueVisitors = new Set(
    events.map((event) => cleanString(event.anonymous_id)).filter((value): value is string => Boolean(value)),
  ).size;
  const scrollValues = leads.map((lead) => readNumber(asRecord(lead.payload), 'journey', 'scroll_depth'));
  const timeValues = leads.map((lead) => readNumber(asRecord(lead.payload), 'journey', 'time_on_page_seconds'));

  return {
    totals: {
      leads: leads.length,
      events: events.length,
      uniqueVisitors,
      videoPlays: events.filter((event) => event.event_name === 'video_play').length,
      campaignContacts: campaignContacts.length,
      campaignEvents: campaignEvents.length,
    },
    averages: {
      scrollDepth: average(scrollValues),
      timeOnPageSeconds: average(timeValues),
    },
    leads: {
      byClassification,
      byMagnet,
      bySource: countBy(leads, (lead) => leadDimension(lead, 'source')),
      byMedium: countBy(leads, (lead) => leadDimension(lead, 'medium')),
      byCampaign: countBy(leads, (lead) => leadDimension(lead, 'campaign')),
      byProvince: countBy(leads, (lead) => leadDimension(lead, 'province')),
      bySector: countBy(leads, (lead) => leadDimension(lead, 'sector')),
      byCompanySize: countBy(leads, (lead) => leadDimension(lead, 'companySize')),
    },
    events: {
      byName: countBy(events, (event) => event.event_name),
    },
    deliveryQueue: {
      byStatus: countBy(queue, (item) => item.status),
    },
    campaign: {
      contactsByVariant: countBy(campaignContacts, (contact) => contact.variant),
      contactsByMagnet: countBy(campaignContacts, (contact) => contact.magnet),
      contactsByLot: countBy(campaignContacts, (contact) => contact.lot),
      contactsByCompanySize: countBy(campaignContacts, (contact) => contact.company_size),
      contactsBySequenceStatus: countBy(campaignContacts, (contact) => contact.sequence_status),
      contactsByDeliveryStatus: countBy(campaignContacts, (contact) => contact.next_delivery_status),
      contactsByReplyType: countBy(campaignContacts, (contact) => contact.reply_type),
      eventsByName: countBy(campaignEvents, (event) => event.event_name),
      contactsByMarketingLane: countBy(campaignContacts, (contact) => contact.marketing_lane),
      contactsBySuppressionScope: countBy(campaignContacts, (contact) => contact.suppression_scope),
      contactsByCurrentStep: countBy(campaignContacts, (contact) => String(contact.current_step ?? 'unknown')),
      pipelineValue: campaignContacts.reduce((sum, contact) => sum + (Number(contact.deal_value) || 0), 0),
    },
  };
}

export type DashboardRole = 'admin' | 'operator' | 'auditor' | 'read_only';
export type DashboardSampleDataset =
  | 'leads'
  | 'events'
  | 'reservations'
  | 'transactional_events'
  | 'campaign_executions'
  | 'graph_events'
  | 'audit';

export interface DashboardActor {
  actorHash: string;
  username: string;
}

export interface DashboardSummaryResponse {
  meta: {
    role: DashboardRole;
    generated_at: string;
    from: string;
    to: string;
    campaign_id: string | null;
    freshness_target_seconds: number;
    aggregate_complete: boolean;
    pii_included: false;
  };
  funnel: JsonRecord;
  journey: JsonRecord;
  transactional: JsonRecord;
  campaign: JsonRecord;
  health: JsonRecord;
}

export interface DashboardSampleResponse {
  dataset: DashboardSampleDataset;
  role: DashboardRole;
  offset: number;
  limit: number;
  total: number;
  has_more: boolean;
  pii_included: false;
  rows: JsonRecord[];
}

export interface DashboardWindow {
  from: string;
  to: string;
  page: number;
  dataset: DashboardSampleDataset;
}

const DASHBOARD_DATASETS = new Set<DashboardSampleDataset>([
  'leads', 'events', 'reservations', 'transactional_events',
  'campaign_executions', 'graph_events', 'audit',
]);
const DASHBOARD_ROLES = new Set<DashboardRole>([
  'admin', 'operator', 'auditor', 'read_only',
]);

export function dashboardDatasetsForRole(role: DashboardRole): DashboardSampleDataset[] {
  if (role === 'read_only') return [];
  if (role === 'operator') {
    return ['reservations', 'transactional_events', 'campaign_executions', 'graph_events'];
  }
  return [...DASHBOARD_DATASETS];
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

export function normalizeDashboardWindow(
  raw: Record<string, string | string[] | undefined>,
  now = new Date(),
): DashboardWindow {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const defaultTo = new Date(now);
  const defaultFrom = new Date(defaultTo.getTime() - 30 * 86_400_000);
  const requestedFrom = dateOnly(first(raw.from));
  const requestedTo = dateOnly(first(raw.to));
  const today = defaultTo.toISOString().slice(0, 10);
  const normalizedFrom = requestedFrom
    ? `${requestedFrom}T00:00:00.000Z`
    : defaultFrom.toISOString();
  const normalizedTo = !requestedTo || requestedTo === today
    ? defaultTo.toISOString()
    : `${requestedTo}T00:00:00.000Z`;
  const fromMs = Date.parse(normalizedFrom);
  const toMs = Date.parse(normalizedTo);
  const validWindow =
    toMs > fromMs &&
    toMs <= defaultTo.getTime() + 5 * 60_000 &&
    toMs - fromMs <= 366 * 86_400_000;
  const pageValue = Number(first(raw.page));
  const datasetValue = first(raw.dataset);
  return {
    from: validWindow ? normalizedFrom : defaultFrom.toISOString(),
    to: validWindow ? normalizedTo : defaultTo.toISOString(),
    page: Number.isSafeInteger(pageValue) && pageValue > 0 && pageValue <= 4_001
      ? pageValue
      : 1,
    dataset: DASHBOARD_DATASETS.has(datasetValue as DashboardSampleDataset)
      ? datasetValue as DashboardSampleDataset
      : 'reservations',
  };
}

function finiteCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid dashboard count: ${field}`);
  }
  return value;
}

export function parseDashboardSummary(value: unknown): DashboardSummaryResponse {
  const root = asRecord(value);
  const meta = asRecord(root.meta);
  if (!DASHBOARD_ROLES.has(meta.role as DashboardRole) ||
      typeof meta.generated_at !== 'string' ||
      typeof meta.from !== 'string' || typeof meta.to !== 'string' ||
      meta.aggregate_complete !== true || meta.pii_included !== false) {
    throw new Error('Invalid dashboard summary contract');
  }
  for (const section of ['funnel', 'journey', 'transactional', 'campaign', 'health']) {
    if (root[section] === null || typeof root[section] !== 'object' ||
        Array.isArray(root[section])) throw new Error(`Invalid dashboard section: ${section}`);
  }
  finiteCount(asRecord(root.funnel).leads, 'funnel.leads');
  return root as unknown as DashboardSummaryResponse;
}

export function parseDashboardCampaignInsights(value: unknown): JsonRecord {
  const root = asRecord(value);
  for (const section of ['by_variant', 'performance_by_email', 'events_by_hour', 'engagement_by_action', 'conversions']) {
    if (root[section] === null || typeof root[section] !== 'object' || Array.isArray(root[section])) {
      throw new Error(`Invalid campaign insights section: ${section}`);
    }
  }
  const contract = asRecord(root.metric_contract);
  if (contract.pii_included !== false || contract.timezone !== 'Europe/Madrid' || contract.opens_quality !== 'directional') {
    throw new Error('Invalid campaign insights metric contract');
  }
  return root;
}

export function parseDashboardSample(value: unknown): DashboardSampleResponse {
  const root = asRecord(value);
  if (!DASHBOARD_DATASETS.has(root.dataset as DashboardSampleDataset) ||
      !DASHBOARD_ROLES.has(root.role as DashboardRole) ||
      root.pii_included !== false || !Array.isArray(root.rows)) {
    throw new Error('Invalid dashboard sample contract');
  }
  const limit = finiteCount(root.limit, 'sample.limit');
  const offset = finiteCount(root.offset, 'sample.offset');
  const total = finiteCount(root.total, 'sample.total');
  if (limit < 1 || limit > 100 || root.rows.length > limit || offset > 100_000 ||
      typeof root.has_more !== 'boolean' ||
      root.rows.some((row) => row === null || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Dashboard sample exceeded its bounded contract');
  }
  return { ...root, limit, offset, total } as unknown as DashboardSampleResponse;
}
