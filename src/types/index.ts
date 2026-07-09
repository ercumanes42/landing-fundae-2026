/**
 * Shared TypeScript types for the FUNDAE landing and Data Brain payloads.
 */

export type EmployeeRange = '1-5' | '6-9' | '10-49' | '50-249' | '+249' | '';

export type LeadStatus = 'frio' | 'templado' | 'caliente' | 'prioritario';
export type LeadClassification = 'cold' | 'warm' | 'hot' | 'priority';

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

export type FormState = 'idle' | 'loading' | 'success' | 'error';

export interface UTMParams {
  readonly utm_source: string;
  readonly utm_medium: string;
  readonly utm_campaign: string;
  readonly utm_content: string;
  readonly utm_term: string;
  readonly referrer: string;
}

export interface TouchAttribution extends UTMParams {
  readonly lead_magnet: LeadMagnet;
  readonly source_url: string;
  readonly captured_at: string;
}

export interface TrackingContext {
  readonly event_id: string;
  readonly event_version: '1.0';
  readonly occurred_at: string;
  readonly anonymous_id: string;
  readonly session_id: string;
  readonly identity_persistence: 'localStorage' | 'memory';
  readonly storage_available: boolean;
  readonly first_touch: TouchAttribution;
  readonly last_touch: TouchAttribution;
  readonly lead_magnet: LeadMagnet;
  readonly section?: string;
  readonly source_url: string;
  readonly referrer: string;
  readonly utm_source: string;
  readonly utm_medium: string;
  readonly utm_campaign: string;
  readonly utm_content: string;
  readonly utm_term: string;
  readonly partner?: string;
  readonly device_type: 'desktop' | 'tablet' | 'mobile' | 'unknown';
  readonly viewport_width: number;
  readonly consent_state: 'unknown' | 'accepted' | 'rejected';
}

export type TrackingEvent =
  | 'page_view'
  | 'section_view'
  | 'scroll_depth'
  | 'cta_click'
  | 'form_start'
  | 'form_step'
  | 'form_submit'
  | 'form_success'
  | 'form_error'
  | 'lead_created'
  | 'lead_scored'
  | 'calculator_started'
  | 'calculator_completed'
  | 'checklist_completed'
  | 'webinar_registered'
  | 'diagnostic_requested'
  | 'calendly_click'
  | 'pdf_downloaded'
  | 'video_play'
  | 'video_progress'
  | 'video_complete'
  | 'faq_toggle'
  | 'exit_intent'
  | 'checklist_submit'
  | 'calculator_submit'
  | 'calculator_result'
  | 'webinar_submit'
  | 'diagnostic_submit'
  | 'calendly_redirect'
  | 'pdf_download'
  | 'checklist_interactive_open'
  | 'checklist_interactive_start'
  | 'checklist_question_answered'
  | 'checklist_interactive_completed'
  | 'checklist_result_view'
  | 'checklist_lead_submit'
  | 'checklist_pdf_download'
  | 'checklist_diagnostic_click';

export interface TrackingEventData {
  readonly [key: string]: unknown;
}

export interface ContactInfo {
  readonly name: string;
  readonly email: string;
  readonly phone?: string;
  readonly company: string;
  readonly role?: string;
}

export interface ChecklistFormData {
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly employee_range?: EmployeeRange;
  readonly privacy_accepted: boolean;
}

export interface CalculatorFormData {
  readonly employee_range: EmployeeRange;
  readonly province: string;
  readonly sector: string;
  readonly used_fundae_before: string;
  readonly knows_credit: string;
  readonly training_area: string;
  readonly name: string;
  readonly company: string;
  readonly role?: string;
  readonly email: string;
  readonly phone?: string;
  readonly privacy_accepted: boolean;
}

export interface WebinarFormData {
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly role?: string;
  readonly phone?: string;
  readonly employee_range?: EmployeeRange;
  readonly privacy_accepted: boolean;
}

export interface DiagnosticFormData {
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly phone: string;
  readonly role: string;
  readonly employee_range: EmployeeRange;
  readonly sector: string;
  readonly training_area: string;
  readonly urgency: string;
  readonly message?: string;
  readonly privacy_accepted: boolean;
  readonly marketing_accepted: boolean;
}

export interface InteractiveChecklistFormData {
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly privacy_accepted: boolean;
  readonly marketing_accepted: boolean;
  readonly score: number;
  readonly risk_level: string;
  readonly answers: Record<string, string>;
}

export type AnyFormData =
  | ChecklistFormData
  | InteractiveChecklistFormData
  | CalculatorFormData
  | WebinarFormData
  | DiagnosticFormData;

export interface LeadJourneyInput {
  readonly sections_viewed?: string[];
  readonly scroll_depth?: number;
  readonly time_on_page_seconds?: number;
  readonly video_played?: boolean;
  readonly form_steps_completed?: number;
  readonly repeat_visit?: boolean;
}

export interface LeadScoringInput {
  readonly employee_range?: string;
  readonly used_fundae_before?: string;
  readonly knows_credit?: string;
  readonly training_area?: string;
  readonly form_type: FormType;
  readonly urgency?: string;
  readonly sector?: string;
  readonly province?: string;
  readonly role?: string;
  readonly risk_level?: string;
  readonly calendly_click?: boolean;
  readonly journey?: LeadJourneyInput;
}

export interface LeadScoreBreakdown {
  readonly fit: number;
  readonly intent: number;
  readonly engagement: number;
  readonly urgency: number;
  readonly total: number;
  readonly classification: LeadClassification;
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

export interface LeadData {
  event_version: '1.0';
  form_type: FormType;
  lead_magnet: LeadMagnet;
  created_at: string;
  source_url: string;
  anonymous_id?: string;
  session_id?: string;
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
  lead_status: LeadStatus;
  lead_classification: LeadClassification;
  scoring: LeadScoreBreakdown;
  contact: ContactInfo;
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

export interface Config {
  readonly dataBrainIngestUrl: string;
  readonly checklistWebhookUrl: string;
  readonly interactiveChecklistWebhookUrl: string;
  readonly calculatorWebhookUrl: string;
  readonly webinarWebhookUrl: string;
  readonly diagnosticWebhookUrl: string;
  readonly calendlyUrl: string;
  readonly videoUrl: string;
  readonly checklistPdfUrl: string;
  readonly webinarDate: string;
  readonly webinarTime: string;
  readonly posthogKey: string;
  readonly posthogHost: string;
  readonly enableAnalytics: boolean;
  readonly linkedinPartnerId: string;
  readonly ga4Id: string;
  readonly isDev: boolean;
}

export interface SubmitResult {
  readonly success: boolean;
  readonly savedLocally: boolean;
  readonly error?: string;
}

export interface UseFormSubmitReturn {
  readonly state: FormState;
  readonly error: string | null;
  readonly submit: (formType: FormType, data: Record<string, unknown>) => Promise<void>;
  readonly reset: () => void;
}
