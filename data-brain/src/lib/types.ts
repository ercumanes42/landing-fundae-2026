export type FormType =
  | 'checklist'
  | 'interactive_checklist'
  | 'calculator'
  | 'webinar'
  | 'diagnostic';

export type LeadMagnet =
  | 'calculator'
  | 'checklist'
  | 'interactive_checklist'
  | 'webinar'
  | 'diagnostic'
  | 'unknown';

export type LeadClassification = 'cold' | 'warm' | 'hot' | 'priority';

export type FundaeCalculationMode =
  | 'fp_quota'
  | 'other_contributions_base'
  | 'no_data';

export interface FundaeCreditEstimate {
  amount: number | null;
  currency: 'EUR';
  calculation_mode: FundaeCalculationMode;
  calculation_source: 'minimum_credit' | 'fp_quota' | 'other_contributions_base' | 'insufficient_data';
  applied_percentage: number;
  requires_manual_review: boolean;
}

export interface TouchAttribution {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  referrer: string;
  lead_magnet: LeadMagnet;
  source_url: string;
  captured_at: string;
}

export interface TrackingContext {
  event_id: string;
  event_version: '2.0';
  occurred_at: string;
  journey_id: string;
  anonymous_id: string;
  session_id: string;
  identity_persistence: 'localStorage' | 'memory';
  storage_available: boolean;
  first_touch: TouchAttribution;
  last_touch: TouchAttribution;
  lead_magnet: LeadMagnet;
  section?: string;
  source_url: string;
  referrer: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  partner?: string;
  device_type: 'desktop' | 'tablet' | 'mobile' | 'unknown';
  viewport_width: number;
  consent_state: 'accepted';
  consent_version: string;
}

export interface CampaignTrackingContext {
  campaign_external_id: string;
  contact_id: string;
}

export interface LeadJourneyInput {
  sections_viewed?: string[];
  scroll_depth?: number;
  time_on_page_seconds?: number;
  video_played?: boolean;
  form_steps_completed?: number;
  repeat_visit?: boolean;
}

export interface LeadScoringInput {
  employee_range?: string;
  used_fundae_before?: string;
  knows_credit?: string;
  training_area?: string;
  form_type: FormType;
  urgency?: string;
  sector?: string;
  province?: string;
  role?: string;
  risk_level?: string;
  calendly_click?: boolean;
  journey?: LeadJourneyInput;
  answers?: Record<string, string>;
}

export interface LeadScoreBreakdown {
  fit: number;
  intent: number;
  engagement: number;
  urgency: number;
  total: number;
  classification: LeadClassification;
}

export interface AISummary {
  ai_summary: string;
  priority_reason: string;
  recommended_action:
    | 'llamar_inmediato'
    | 'nutrir_email'
    | 'invitar_webinar'
    | 'enviar_checklist'
    | 'revisar_manual';
  sales_angle: string;
  risk_notes: string;
  confidence: number;
}

export interface LeadPayload {
  submission_id: string;
  event_version: '1.0';
  form_type: FormType;
  lead_magnet: LeadMagnet;
  created_at: string;
  source_url: string;
  journey_id?: string;
  anonymous_id?: string;
  session_id?: string;
  lead_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  referrer?: string;
  first_touch?: TouchAttribution;
  last_touch?: TouchAttribution;
  tracking_context?: TrackingContext;
  campaign_context?: CampaignTrackingContext;
  lead_score: number;
  lead_status: string;
  lead_classification: LeadClassification;
  scoring: LeadScoreBreakdown;
  contact: {
    name: string;
    email: string;
    phone?: string;
    company: string;
    role?: string;
  };
  company?: {
    province?: string;
    sector?: string;
    employee_range?: string;
    used_fundae_before?: string;
    knows_credit?: string;
    current_training_provider?: string;
    credit_calculation_mode?: FundaeCalculationMode;
    prior_year_fp_quota?: number;
    prior_year_other_contributions_base?: number;
    special_situation?: 'no' | 'yes' | 'unknown';
  };
  interest?: {
    training_area?: string;
    urgency?: string;
    message?: string;
  };
  interactive_checklist?: {
    score: number;
    risk_level: string;
    answers: Record<string, string>;
  };
  credit_estimate?: FundaeCreditEstimate;
  journey?: LeadJourneyInput;
  consent: {
    privacy_accepted: boolean;
    marketing_accepted: boolean;
  };
  ai_summary?: AISummary;
  delivery_status?: 'captured' | 'queued' | 'delivered' | 'retrying' | 'dead_letter';
  accepted_by_make_at?: string;
  email_delivery_status?: 'pending' | 'email_sent' | 'email_failed';
  checklist_pdf_url?: string;
}

export interface EventPayload {
  event_name: string;
  context: TrackingContext;
  properties: Record<string, unknown>;
}
export type DashboardDatasetName =
  | 'leads'
  | 'events'
  | 'deliveryQueue'
  | 'campaigns'
  | 'campaignContacts'
  | 'campaignEvents'
  | 'campaignExecutions';

export interface DashboardPaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasMore: boolean;
}

export interface DashboardDatasetCoverage extends DashboardPaginationState {
  sourceTotal: number | null;
  loadedForAggregation: number;
  aggregateComplete: boolean;
  pagesFetched: number;
  sampleSize: number;
  piiIncluded: false;
  error: string | null;
}

export interface DashboardCoverage {
  leadsMayBeTruncated: boolean;
  eventsMayBeTruncated: boolean;
  contactsMayBeTruncated: boolean;
  campaignEventsMayBeTruncated: boolean;
  campaignExecutionsMayBeTruncated: boolean;
  allAggregatesComplete: boolean;
  datasets: Record<DashboardDatasetName, DashboardDatasetCoverage>;
  warnings: string[];
}

export interface DashboardLeadSample {
  id: string;
  anonymous_id?: string;
  lead_classification: LeadClassification;
  lead_magnet: LeadMagnet;
  lead_score: number;
  created_at: string;
  delivery_status?: string;
  first_utm_source?: string;
  first_utm_medium?: string;
  first_utm_campaign?: string;
  payload: {
    anonymous_id?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    tracking_context?: {
      utm_source?: string;
      utm_medium?: string;
      utm_campaign?: string;
    };
    company?: {
      province?: string;
      sector?: string;
      employee_range?: string;
      used_fundae_before?: string;
      knows_credit?: string;
    };
  };
}

export interface DashboardEventSample {
  id: string;
  event_name: string;
  anonymous_id?: string;
  session_id?: string;
  lead_magnet?: string;
  occurred_at: string;
  context: {
    lead_magnet?: string;
  };
  properties: Record<string, string | number | boolean | null>;
}

export interface DashboardAggregates {
  totals: {
    leads: number | null;
    events: number | null;
    uniqueVisitors: number | null;
    videoPlays: number | null;
    campaignContacts: number | null;
    campaignEvents: number | null;
  };
  averages: {
    scrollDepth: number | null;
    timeOnPageSeconds: number | null;
  };
  leads: {
    byClassification: Record<LeadClassification, number>;
    byMagnet: Record<LeadMagnet, number>;
    bySource: Record<string, number>;
    byMedium: Record<string, number>;
    byCampaign: Record<string, number>;
    byProvince: Record<string, number>;
    bySector: Record<string, number>;
    byCompanySize: Record<string, number>;
  };
  events: {
    byName: Record<string, number>;
  };
  deliveryQueue: {
    byStatus: Record<string, number>;
  };
  campaign: {
    contactsByVariant: Record<string, number>;
    contactsByMagnet: Record<string, number>;
    contactsByLot: Record<string, number>;
    contactsByCompanySize: Record<string, number>;
    contactsByMarketingLane: Record<string, number>;
    contactsBySuppressionScope: Record<string, number>;
    contactsByCurrentStep: Record<string, number>;
    contactsBySequenceStatus: Record<string, number>;
    contactsByDeliveryStatus: Record<string, number>;
    contactsByReplyType: Record<string, number>;
    eventsByName: Record<string, number>;
    pipelineValue: number;
  };
}

export interface DashboardAnalyticsContract {
  aggregates: DashboardAggregates;
  pagination: {
    leads: DashboardPaginationState;
    events: DashboardPaginationState;
    campaignContacts: DashboardPaginationState;
    campaignEvents: DashboardPaginationState;
  };
  coverage: DashboardCoverage;
}
