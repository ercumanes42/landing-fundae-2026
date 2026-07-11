import { config } from '../config';
import type {
  CampaignTrackingContext,
  FormType,
  LeadMagnet,
  TouchAttribution,
  TrackingContext,
  TrackingEvent,
  TrackingEventData,
} from '../types';
import { getAnalyticsConsent, hasAnalyticsConsent } from './consent';

declare global {
  interface Window {
    gtag?: (...args: [string, ...unknown[]]) => void;
    posthog?: {
      capture: (event: string, properties?: Record<string, unknown>) => void;
      identify?: (id: string, properties?: Record<string, unknown>) => void;
    };
    _linkedin_data_partner_id?: string;
    lintrk?: (action: string, data: Record<string, unknown>) => void;
  }
}

const IDENTITY_KEY = 'fundae_identity_v1';
const SESSION_KEY = 'fundae_session_v1';
const FIRST_TOUCH_KEY = 'fundae_first_touch_v1';
const LAST_TOUCH_KEY = 'fundae_last_touch_v1';
const CAMPAIGN_CONTEXT_KEY = 'fundae_campaign_context_v1';
const IDENTITY_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const EVENT_VERSION = '1.0' as const;

type IdentityPersistence = 'localStorage' | 'memory';

interface StoredIdentity {
  anonymous_id: string;
  expires_at: number;
  created_at: string;
}

interface StoredSession {
  session_id: string;
  last_seen_at: number;
  created_at: string;
}

let memoryIdentity: StoredIdentity | null = null;
let memorySession: StoredSession | null = null;

const PII_KEYS = new Set([
  'email',
  'name',
  'phone',
  'company',
  'message',
  'contact',
  'answers',
  'cid',
  'campaign_contact_id',
  'campaign_id',
]);

const CAMPAIGN_CONTACT_ID_PATTERN = /^[A-Za-z0-9_-]{3,100}$/;
const CAMPAIGN_EVENT_MAP: Partial<Record<TrackingEvent, string>> = {
  page_view: 'landing_visit',
  checklist_completed: 'resource_completed',
  calculator_completed: 'calculator_completed',
  webinar_registered: 'webinar_registered',
  diagnostic_requested: 'review_submitted',
  pdf_downloaded: 'checklist_downloaded',
};

type DataBrainPath =
  | '/api/events/ingest'
  | '/api/events/ingest/batch'
  | '/api/campaign/events';

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: 'anon' | 'sess' | 'evt'): string {
  const value =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${value}`;
}

function safeRead<T>(storage: Storage | undefined, key: string): T | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeWrite(storage: Storage | undefined, key: string, value: unknown): boolean {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function getLocalStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function getSessionStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.sessionStorage;
}

export function getCampaignTrackingContext(): CampaignTrackingContext | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const cidFromUrl = params.get('cid')?.trim() || '';
  const campaignFromUrl = params.get('campaign_id')?.trim() || '';
  const storage = getSessionStorage();
  const stored = safeRead<CampaignTrackingContext>(storage, CAMPAIGN_CONTEXT_KEY);

  if (CAMPAIGN_CONTACT_ID_PATTERN.test(cidFromUrl)) {
    const context: CampaignTrackingContext = {
      contact_id: cidFromUrl,
      campaign_external_id: campaignFromUrl || config.campaignExternalId,
    };
    safeWrite(storage, CAMPAIGN_CONTEXT_KEY, context);
    return context;
  }

  if (stored && CAMPAIGN_CONTACT_ID_PATTERN.test(stored.contact_id)) {
    return stored;
  }

  return null;
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of ['email', 'name', 'phone', 'company', 'contact']) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function getSafeCurrentUrl(): string {
  if (typeof window === 'undefined') return '';

  try {
    return sanitizeUrl(window.location.href);
  } catch {
    return window.location.origin + window.location.pathname;
  }
}

export function inferLeadMagnet(input?: {
  lead_magnet?: unknown;
  form_type?: unknown;
  section?: unknown;
}): LeadMagnet {
  const params =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();

  const explicit = String(input?.lead_magnet ?? params.get('lead_magnet') ?? '').trim();
  if (isLeadMagnet(explicit)) return explicit;

  const fromForm = String(input?.form_type ?? '').trim();
  if (isLeadMagnet(fromForm)) return fromForm;

  const section = String(input?.section ?? '').trim();
  if (section === 'calculadora') return 'calculator';
  if (section === 'checklist') return 'checklist';
  if (section === 'interactive-checklist') return 'interactive_checklist';
  if (section === 'webinar') return 'webinar';
  if (section === 'diagnostico') return 'diagnostic';

  if (typeof window !== 'undefined') {
    const path = normalizePath(window.location.pathname);
    const hash = window.location.hash.replace('#', '');
    const routeMap: Record<string, LeadMagnet> = {
      '/calculadora': 'calculator',
      '/checklist-10-errores': 'checklist',
      '/autodiagnostico': 'interactive_checklist',
      '/webinar': 'webinar',
      '/diagnostico': 'diagnostic',
    };
    if (routeMap[path]) return routeMap[path];
    if (hash === 'calculadora') return 'calculator';
    if (hash === 'checklist') return 'checklist';
    if (hash === 'interactive-checklist') return 'interactive_checklist';
    if (hash === 'webinar') return 'webinar';
    if (hash === 'diagnostico') return 'diagnostic';
  }

  return 'unknown';
}

function isLeadMagnet(value: string): value is LeadMagnet {
  return [
    'calculator',
    'checklist',
    'interactive_checklist',
    'webinar',
    'diagnostic',
    'unknown',
  ].includes(value);
}

function readAttribution(input?: TrackingEventData): TouchAttribution {
  const params =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const referrer = typeof document !== 'undefined' ? sanitizeUrl(document.referrer) : '';
  const sourceUrl = getSafeCurrentUrl();

  return {
    utm_source: params.get('utm_source') || (referrer ? 'referral' : 'direct'),
    utm_medium: params.get('utm_medium') || (referrer ? 'referral' : 'none'),
    utm_campaign: params.get('utm_campaign') || 'unattributed',
    utm_content: params.get('utm_content') || '',
    utm_term: params.get('utm_term') || '',
    referrer,
    lead_magnet: inferLeadMagnet({
      lead_magnet: input?.lead_magnet,
      form_type: input?.form_type,
      section: input?.section,
    }),
    source_url: sourceUrl,
    captured_at: nowIso(),
  };
}

function hasFreshCampaign(touch: TouchAttribution): boolean {
  return (
    touch.utm_source !== 'direct' ||
    touch.utm_medium !== 'none' ||
    touch.utm_campaign !== 'unattributed' ||
    touch.referrer !== '' ||
    touch.lead_magnet !== 'unknown'
  );
}

function getTouches(input?: TrackingEventData): {
  first_touch: TouchAttribution;
  last_touch: TouchAttribution;
} {
  const localStorage = getLocalStorage();
  const current = readAttribution(input);
  const storedFirst = safeRead<TouchAttribution>(localStorage, FIRST_TOUCH_KEY);
  const firstTouch = storedFirst ?? current;
  safeWrite(localStorage, FIRST_TOUCH_KEY, firstTouch);

  const storedLast = safeRead<TouchAttribution>(localStorage, LAST_TOUCH_KEY);
  const lastTouch = hasFreshCampaign(current) ? current : storedLast ?? current;
  safeWrite(localStorage, LAST_TOUCH_KEY, lastTouch);

  return { first_touch: firstTouch, last_touch: lastTouch };
}

function getIdentity(): {
  anonymous_id: string;
  persistence: IdentityPersistence;
  storage_available: boolean;
} {
  const localStorage = getLocalStorage();
  const now = Date.now();
  const stored = safeRead<StoredIdentity>(localStorage, IDENTITY_KEY);

  if (stored && stored.expires_at > now) {
    const renewed = { ...stored, expires_at: now + IDENTITY_TTL_MS };
    const persisted = safeWrite(localStorage, IDENTITY_KEY, renewed);
    return {
      anonymous_id: stored.anonymous_id,
      persistence: persisted ? 'localStorage' : 'memory',
      storage_available: persisted,
    };
  }

  const fresh: StoredIdentity = {
    anonymous_id: randomId('anon'),
    expires_at: now + IDENTITY_TTL_MS,
    created_at: nowIso(),
  };

  const persisted = safeWrite(localStorage, IDENTITY_KEY, fresh);
  if (!persisted) {
    memoryIdentity = memoryIdentity ?? fresh;
    return {
      anonymous_id: memoryIdentity.anonymous_id,
      persistence: 'memory',
      storage_available: false,
    };
  }

  return {
    anonymous_id: fresh.anonymous_id,
    persistence: 'localStorage',
    storage_available: true,
  };
}

function getSession(): string {
  const sessionStorage = getSessionStorage();
  const now = Date.now();
  const stored = safeRead<StoredSession>(sessionStorage, SESSION_KEY);

  if (stored && now - stored.last_seen_at <= SESSION_IDLE_MS) {
    const renewed = { ...stored, last_seen_at: now };
    if (!safeWrite(sessionStorage, SESSION_KEY, renewed)) {
      memorySession = renewed;
    }
    return stored.session_id;
  }

  const fresh: StoredSession = {
    session_id: randomId('sess'),
    last_seen_at: now,
    created_at: nowIso(),
  };

  if (!safeWrite(sessionStorage, SESSION_KEY, fresh)) {
    memorySession = fresh;
  }

  return memorySession?.session_id ?? fresh.session_id;
}

function getDeviceType(width: number): TrackingContext['device_type'] {
  if (!width) return 'unknown';
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export function buildTrackingContext(data?: TrackingEventData): TrackingContext {
  const identity = getIdentity();
  const sessionId = getSession();
  const touches = getTouches(data);
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  const lastTouch = touches.last_touch;

  return {
    event_id: randomId('evt'),
    event_version: EVENT_VERSION,
    occurred_at: nowIso(),
    anonymous_id: identity.anonymous_id,
    session_id: sessionId,
    identity_persistence: identity.persistence,
    storage_available: identity.storage_available,
    first_touch: touches.first_touch,
    last_touch: lastTouch,
    lead_magnet: lastTouch.lead_magnet,
    section: typeof data?.section === 'string' ? data.section : undefined,
    source_url: lastTouch.source_url,
    referrer: lastTouch.referrer,
    utm_source: lastTouch.utm_source,
    utm_medium: lastTouch.utm_medium,
    utm_campaign: lastTouch.utm_campaign,
    utm_content: lastTouch.utm_content,
    utm_term: lastTouch.utm_term,
    partner: typeof data?.partner === 'string' ? data.partner : undefined,
    device_type: getDeviceType(viewportWidth),
    viewport_width: viewportWidth,
    consent_state:
      data?.consent_state === 'accepted' || data?.consent_state === 'rejected'
        ? data.consent_state
        : getAnalyticsConsent(),
  };
}

function sanitizeForAnalytics(data?: TrackingEventData): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (PII_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === 'object' && value !== null) continue;
    clean[key] = value;
  }
  return clean;
}

function buildApiUrl(path: DataBrainPath): string {
  const base = config.dataBrainIngestUrl.trim();
  if (!base) return '';

  const apiMarker = base.indexOf('/api/');
  if (apiMarker >= 0) {
    return `${base.slice(0, apiMarker)}${path}`;
  }

  return `${base.replace(/\/+$/, '')}${path}`;
}

export function getCampaignAwareUrl(rawUrl: string): string {
  const campaign = getCampaignTrackingContext();
  if (!rawUrl || !campaign || typeof window === 'undefined') return rawUrl;

  try {
    const url = new URL(rawUrl, window.location.origin);
    url.searchParams.set('cid', campaign.contact_id);
    if (!url.searchParams.get('campaign_id')) {
      url.searchParams.set('campaign_id', campaign.campaign_external_id);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function analyticsAllowed(): boolean {
  return config.enableAnalytics && hasAnalyticsConsent();
}

function fireGA4(name: string, data: Record<string, unknown>): void {
  try {
    window.gtag?.('event', name, data);
  } catch {
    // Analytics must never break the landing.
  }
}

function firePostHog(name: string, data: Record<string, unknown>): void {
  try {
    if (window.posthog) {
      window.posthog.capture(name, data);
      return;
    }

    if (!config.posthogKey) return;

    fetch(`${config.posthogHost.replace(/\/+$/, '')}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        api_key: config.posthogKey,
        event: name,
        distinct_id: String(data.anonymous_id ?? 'anonymous'),
        properties: data,
      }),
    }).catch(() => undefined);
  } catch {
    // Ignore provider failures.
  }
}

function fireLinkedIn(name: string): void {
  try {
    if (window._linkedin_data_partner_id && window.lintrk) {
      window.lintrk('track', { conversion_id: name });
    }
  } catch {
    // Ignore provider failures.
  }
}

function sendBehaviorEvent(
  name: TrackingEvent,
  context: TrackingContext,
  data: Record<string, unknown>,
): void {
  const url = buildApiUrl('/api/events/ingest');
  if (!url || !analyticsAllowed()) return;

  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        event_name: name,
        context,
        properties: data,
      }),
    }).catch(() => undefined);
  } catch {
    // Fire and forget.
  }
}

export function trackCampaignEvent(
  eventName: string,
  data: Record<string, unknown> = {},
  context = buildTrackingContext(),
): void {
  const campaign = getCampaignTrackingContext();
  const url = buildApiUrl('/api/campaign/events');
  if (!campaign || !url) return;

  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        campaign_external_id: campaign.campaign_external_id,
        contact_id: campaign.contact_id,
        event_name: eventName,
        occurred_at: context.occurred_at,
        source_event_id: context.event_id,
        context: {
          anonymous_id: context.anonymous_id,
          session_id: context.session_id,
          lead_magnet: context.lead_magnet,
          source_url: context.source_url,
          utm_source: context.utm_source,
          utm_medium: context.utm_medium,
          utm_campaign: context.utm_campaign,
        },
        properties: sanitizeForAnalytics(data),
      }),
    }).catch(() => undefined);
  } catch {
    // Campaign attribution is intentionally non-blocking for the visitor.
  }
}

function trackMappedCampaignEvent(
  name: TrackingEvent,
  context: TrackingContext,
  data: Record<string, unknown>,
): void {
  const campaignEventName = CAMPAIGN_EVENT_MAP[name];
  if (campaignEventName) trackCampaignEvent(campaignEventName, data, context);
}

function logDev(name: string, data: Record<string, unknown>): void {
  if (config.isDev) {
    console.log(`[Tracking] ${name}`, data);
  }
}

export function trackEvent(name: TrackingEvent, data?: TrackingEventData): void {
  if (typeof window === 'undefined') return;

  const context = buildTrackingContext(data);
  const publicData = sanitizeForAnalytics(data);
  const enriched = {
    ...publicData,
    event_id: context.event_id,
    event_version: context.event_version,
    anonymous_id: context.anonymous_id,
    session_id: context.session_id,
    identity_persistence: context.identity_persistence,
    lead_magnet: context.lead_magnet,
    section: context.section,
    utm_source: context.utm_source,
    utm_medium: context.utm_medium,
    utm_campaign: context.utm_campaign,
    utm_content: context.utm_content,
    utm_term: context.utm_term,
    referrer: context.referrer,
    device_type: context.device_type,
    viewport_width: context.viewport_width,
  };

  logDev(name, enriched);

  trackMappedCampaignEvent(name, context, publicData);

  if (analyticsAllowed()) {
    fireGA4(name, enriched);
    firePostHog(name, enriched);
    fireLinkedIn(name);
  }

  sendBehaviorEvent(name, context, enriched);
}

export function getCurrentTrackingContext(data?: TrackingEventData): TrackingContext {
  return buildTrackingContext(data);
}

export function trackPageView(): void {
  trackEvent('page_view', {
    page: typeof window !== 'undefined' ? window.location.pathname : '',
  });
}

export function trackSectionView(sectionId: string): void {
  trackEvent('section_view', { section: sectionId });
}

export function trackScrollDepth(percent: number): void {
  trackEvent('scroll_depth', { percent });
}

export function trackCtaClick(ctaId: string, location: string): void {
  trackEvent('cta_click', { cta: ctaId, location });
}

export function trackFormStart(formType: FormType): void {
  trackEvent('form_start', { form_type: formType, consent_state: 'unknown' });
  trackCampaignEvent('resource_started', { form_type: formType });
}

export function trackFormStep(formType: FormType, step: number): void {
  trackEvent('form_step', { form_type: formType, step });
}

export function trackFormSubmit(
  formType: FormType,
  extra?: TrackingEventData,
): void {
  trackEvent('form_submit', { form_type: formType, ...extra });
}

export function trackFormSuccess(formType: FormType): void {
  trackEvent('form_success', { form_type: formType });
}

export function trackFormError(formType: FormType, error: string): void {
  trackEvent('form_error', { form_type: formType, error });
}

export function trackFaqToggle(question: string, open: boolean): void {
  trackEvent('faq_toggle', { question, open });
}

export function trackVideoPlay(): void {
  trackEvent('video_play', { section: 'video' });
}

export function trackVideoComplete(): void {
  trackEvent('video_complete', { section: 'video' });
}

export function trackCalendlyRedirect(leadMagnet: LeadMagnet = inferLeadMagnet()): void {
  trackEvent('calendly_click', { lead_magnet: leadMagnet, high_intent: true });
  trackEvent('calendly_redirect', { lead_magnet: leadMagnet, high_intent: true });
}

export function trackPdfDownload(leadMagnet: LeadMagnet = 'checklist'): void {
  trackEvent('pdf_downloaded', { lead_magnet: leadMagnet });
  trackEvent('pdf_download', { lead_magnet: leadMagnet });
}

export function trackLeadScored(score: number, classification: string): void {
  trackEvent('lead_scored', { score, classification });
}

export function trackExitIntent(): void {
  trackEvent('exit_intent');
}

// ============================================================================
// ⚡ GOD MODE TELEMETRY (Motor de recolección ultra-detallada)
// ============================================================================

let godModeQueue: any[] = [];
let godModeTimeout: any = null;

function flushGodModeQueue() {
  if (godModeQueue.length === 0) return;
  const payload = [...godModeQueue];
  godModeQueue = [];
  
  const url = buildApiUrl('/api/events/ingest/batch');
  if (!url || !analyticsAllowed()) return;

  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ events: payload })
    }).catch(() => {});
  } catch {}
}

function queueGodModeEvent(name: string, data: any, forceBeacon = false) {
  if (typeof window === 'undefined' || !analyticsAllowed()) return;
  const ctx = buildTrackingContext();
  
  const eventPayload = {
    event_name: name,
    anonymous_id: ctx.anonymous_id,
    session_id: ctx.session_id,
    occurred_at: nowIso(),
    context: ctx,
    properties: data
  };

  logDev('[GOD_MODE] ' + name, eventPayload);

  if (forceBeacon) {
    const url = buildApiUrl('/api/events/ingest');
    if (url && navigator.sendBeacon) {
      navigator.sendBeacon(url, JSON.stringify({
        event_name: name,
        context: ctx,
        properties: data
      }));
    }
    return;
  }

  godModeQueue.push(eventPayload);
  if (godModeQueue.length >= 5) {
    clearTimeout(godModeTimeout);
    flushGodModeQueue();
  } else {
    if (!godModeTimeout) {
      godModeTimeout = setTimeout(() => {
        godModeTimeout = null;
        flushGodModeQueue();
      }, 5000);
    }
  }
}

export function trackSessionStart(payload: any) { queueGodModeEvent('session_start', payload); }
export function trackSessionPing(payload: any) { queueGodModeEvent('session_ping', payload); }
export function trackScrollMilestone(payload: any) { queueGodModeEvent('scroll_milestone', payload); }
export function trackGodModeSectionView(payload: any) { queueGodModeEvent('section_view', payload); }
export function trackVideoImpression(payload: any) { queueGodModeEvent('video_impression', payload); }
export function trackVideoProgress(payload: any) { queueGodModeEvent('video_progress', payload); }
export function trackVideoAbandoned(payload: any) { queueGodModeEvent('video_abandoned', payload); }
export function trackGodModeCtaClick(payload: any) { queueGodModeEvent('cta_click', payload); }
export function trackPageExit(payload: any) { queueGodModeEvent('page_exit', payload, true); }

