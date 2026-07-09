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
  event_version: '1.0';
  occurred_at: string;
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
  consent_state: 'unknown' | 'accepted' | 'rejected';
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
  event_version: '1.0';
  form_type: FormType;
  lead_magnet: LeadMagnet;
  created_at: string;
  source_url: string;
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
  journey?: LeadJourneyInput;
  consent: {
    privacy_accepted: boolean;
    marketing_accepted: boolean;
  };
  ai_summary?: AISummary;
  delivery_status?: 'queued' | 'delivered' | 'retrying' | 'dead_letter';
  checklist_pdf_url?: string;
}

export interface EventPayload {
  event_name: string;
  context: TrackingContext;
  properties: Record<string, unknown>;
}
