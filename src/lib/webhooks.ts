import type {
  FormType,
  LeadData,
  LeadJourneyInput,
  LeadScoringInput,
  SubmitResult,
  TrackingEvent,
} from '../types';
import {
  calculateLeadScoreBreakdown,
  classifyLead,
  getLeadStatus,
} from './leadScoring';
import { getCurrentTrackingContext, inferLeadMagnet, trackEvent } from './tracking';
import { config, getWebhookUrl } from '../config';

const TIMEOUT_MS = 10_000;
const LOCAL_STORAGE_KEY = 'fundae_pending_leads';

function getString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getBool(data: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = data[key];
  return typeof value === 'boolean' ? value : fallback;
}

function getJourney(data: Record<string, unknown>): LeadJourneyInput | undefined {
  const raw = data.journey;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    const formStepsCompleted = data.form_steps_completed;
    return typeof formStepsCompleted === 'number'
      ? { form_steps_completed: formStepsCompleted }
      : undefined;
  }
  return raw as LeadJourneyInput;
}

function buildDataBrainUrl(): string {
  const base = config.dataBrainIngestUrl.trim();
  if (!base) return '';

  if (base.endsWith('/api/leads/ingest')) return base;
  if (base.endsWith('/api/events/ingest')) {
    return base.replace('/api/events/ingest', '/api/leads/ingest');
  }

  return `${base.replace(/\/+$/, '')}/api/leads/ingest`;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function saveToLocalStorage(payload: LeadData): void {
  try {
    const existing = localStorage.getItem(LOCAL_STORAGE_KEY);
    const queue: LeadData[] = existing ? (JSON.parse(existing) as LeadData[]) : [];
    queue.push(payload);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(queue));
  } catch {
    console.warn('[Data Brain] localStorage fallback failed');
  }
}

async function deliverLead(payload: LeadData): Promise<boolean> {
  const dataBrainUrl = buildDataBrainUrl();
  const fallbackWebhookUrl = getWebhookUrl(payload.form_type);
  const url = dataBrainUrl || fallbackWebhookUrl;
  if (!url) return false;

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    TIMEOUT_MS,
  );

  return response.ok;
}

export async function flushPendingLeads(): Promise<void> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return;

    const queue: LeadData[] = JSON.parse(raw) as LeadData[];
    const remaining: LeadData[] = [];

    for (const payload of queue) {
      try {
        const delivered = await deliverLead(payload);
        if (!delivered) remaining.push(payload);
      } catch {
        remaining.push(payload);
      }
    }

    if (remaining.length > 0) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(remaining));
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  } catch {
    // Best effort only.
  }
}

function formCompletionEvent(formType: FormType): TrackingEvent {
  const map: Record<FormType, TrackingEvent> = {
    checklist: 'checklist_completed',
    interactive_checklist: 'checklist_completed',
    calculator: 'calculator_completed',
    webinar: 'webinar_registered',
    diagnostic: 'diagnostic_requested',
  };
  return map[formType];
}

function buildPayload(formType: FormType, data: Record<string, unknown>): LeadData {
  const journey = getJourney(data);
  const trackingContext = getCurrentTrackingContext({
    form_type: formType,
    consent_state: getBool(data, 'privacy_accepted') ? 'accepted' : 'unknown',
  });

  const scoringInput: LeadScoringInput = {
    employee_range: getString(data, 'employee_range'),
    used_fundae_before: getString(data, 'used_fundae_before'),
    knows_credit: getString(data, 'knows_credit'),
    training_area: getString(data, 'training_area'),
    urgency: getString(data, 'urgency'),
    sector: getString(data, 'sector'),
    province: getString(data, 'province'),
    role: getString(data, 'role'),
    risk_level: getString(data, 'risk_level'),
    form_type: formType,
    journey,
  };

  const scoring = calculateLeadScoreBreakdown(scoringInput);
  const score = scoring.total;
  const classification = classifyLead(score);

  return {
    event_version: '1.0',
    form_type: formType,
    lead_magnet: inferLeadMagnet({ form_type: formType }),
    created_at: new Date().toISOString(),
    source_url: trackingContext.source_url,
    anonymous_id: trackingContext.anonymous_id,
    session_id: trackingContext.session_id,
    utm_source: trackingContext.utm_source,
    utm_medium: trackingContext.utm_medium,
    utm_campaign: trackingContext.utm_campaign,
    utm_content: trackingContext.utm_content,
    utm_term: trackingContext.utm_term,
    referrer: trackingContext.referrer,
    first_touch: trackingContext.first_touch,
    last_touch: trackingContext.last_touch,
    tracking_context: trackingContext,
    lead_score: score,
    lead_status: getLeadStatus(score),
    lead_classification: classification,
    scoring,
    contact: {
      name: getString(data, 'name') ?? '',
      email: getString(data, 'email') ?? '',
      phone: getString(data, 'phone'),
      company: getString(data, 'company') ?? '',
      role: getString(data, 'role'),
    },
    company: {
      province: getString(data, 'province'),
      sector: getString(data, 'sector'),
      employee_range: getString(data, 'employee_range'),
      used_fundae_before: getString(data, 'used_fundae_before'),
      knows_credit: getString(data, 'knows_credit'),
      current_training_provider: getString(data, 'current_training_provider'),
    },
    interest: {
      training_area: getString(data, 'training_area'),
      urgency: getString(data, 'urgency'),
      message: getString(data, 'message'),
    },
    interactive_checklist:
      formType === 'interactive_checklist'
        ? {
            score: typeof data.score === 'number' ? data.score : 0,
            risk_level: getString(data, 'risk_level') ?? '',
            answers:
              typeof data.answers === 'object' && data.answers !== null
                ? (data.answers as Record<string, string>)
                : {},
          }
        : undefined,
    journey,
    consent: {
      privacy_accepted: getBool(data, 'privacy_accepted', true),
      marketing_accepted: getBool(data, 'marketing_accepted'),
    },
    delivery_status: 'queued',
    checklist_pdf_url: formType === 'checklist'
      ? (typeof window !== 'undefined' ? (window.location.origin + config.checklistPdfUrl) : config.checklistPdfUrl)
      : undefined,
  };
}

export async function submitLead(
  formType: FormType,
  data: Record<string, unknown>,
): Promise<SubmitResult> {
  const payload = buildPayload(formType, data);
  const eventProperties = {
    form_type: formType,
    lead_magnet: payload.lead_magnet,
    lead_score: payload.lead_score,
    lead_status: payload.lead_status,
    lead_classification: payload.lead_classification,
    fit_score: payload.scoring.fit,
    intent_score: payload.scoring.intent,
    engagement_score: payload.scoring.engagement,
    urgency_score: payload.scoring.urgency,
  };

  trackEvent('form_submit', eventProperties);
  trackEvent(formCompletionEvent(formType), eventProperties);
  trackEvent('lead_scored', eventProperties);
  trackEvent('lead_created', eventProperties);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const delivered = await deliverLead(payload);
      if (delivered) {
        if (config.isDev) {
          console.log('[Data Brain] Lead delivered', {
            form_type: formType,
            lead_score: payload.lead_score,
            lead_classification: payload.lead_classification,
          });
        }

        flushPendingLeads().catch(() => undefined);
        return { success: true, savedLocally: false };
      }
    } catch (err) {
      if (attempt === 1 && config.isDev) {
        console.warn('[Data Brain] Lead delivery failed', err);
      }
    }
  }

  saveToLocalStorage(payload);
  return {
    success: false,
    savedLocally: true,
    error: 'No se pudo enviar el formulario. Se ha guardado localmente.',
  };
}
