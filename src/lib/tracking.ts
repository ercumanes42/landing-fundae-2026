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
import {
  ANALYTICS_CONSENT_VERSION,
  hasAnalyticsConsent,
  subscribeAnalyticsConsent,
} from './consent';
import { buildCampaignAwareUrl } from './campaignUrl';

declare global {
  interface Window {
    gtag?: (...args: [string, ...unknown[]]) => void;
    posthog?: { capture: (event: string, properties?: Record<string, unknown>) => void };
    _linkedin_data_partner_id?: string;
    lintrk?: (action: string, data: Record<string, unknown>) => void;
  }
}

const JOURNEY_KEY = 'fundae_journey_v2';
const SESSION_KEY = 'fundae_session_v2';
const FIRST_TOUCH_KEY = 'fundae_first_touch_v2';
const LAST_TOUCH_KEY = 'fundae_last_touch_v2';
const CAMPAIGN_CONTEXT_KEY = 'fundae_campaign_context_v1';
const JOURNEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const EVENT_VERSION = '2.0' as const;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CAMPAIGN_CONTACT_ID_PATTERN = /^[A-Za-z0-9_-]{3,100}$/;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/i;
const PHONE_LIKE = /(?:\+?\d[\s().-]*){8,}/;

interface StoredJourney {
  journey_id: string;
  expires_at: number;
  created_at: string;
}

interface StoredSession {
  session_id: string;
  last_seen_at: number;
  created_at: string;
}

type CanonicalBrowserEvent =
  | 'page_view'
  | 'page_abandon'
  | 'session_start'
  | 'session_ping'
  | 'section_view'
  | 'scroll_milestone'
  | 'cta_click'
  | 'tool_start'
  | 'tool_step'
  | 'tool_complete'
  | 'tool_abandon'
  | 'resource_download'
  | 'form_start'
  | 'form_step'
  | 'form_submit'
  | 'form_success'
  | 'form_error'
  | 'video_start'
  | 'video_quartile'
  | 'video_complete'
  | 'video_abandon';

type DataBrainPath = '/api/events/ingest' | '/api/campaign/events';

const PII_KEYS = new Set([
  'email', 'email_address', 'name', 'first_name', 'last_name', 'phone', 'mobile',
  'company', 'company_name', 'message', 'contact', 'answers', 'address', 'ip',
  'ip_address', 'campaign_contact_id',
]);

const PROPERTY_KEYS = new Set([
  'page_path', 'section', 'depth_percent', 'active_seconds', 'idle_seconds',
  'max_scroll_percent', 'last_section', 'reason', 'cta_id', 'location',
  'tool_id', 'step', 'step_count', 'asset_id', 'form_type', 'outcome_code',
  'video_id', 'play_session_id', 'quartile', 'current_time_seconds',
  'duration_seconds', 'is_muted', 'playback_rate', 'scroll_depth_percent',
  'lead_magnet', 'high_intent', 'score', 'classification',
]);

const PROPERTY_ALIASES: Record<string, string> = {
  page: 'page_path',
  cta: 'cta_id',
  section_name: 'section',
  depth_pct: 'depth_percent',
  max_scroll_depth_pct: 'max_scroll_percent',
  last_section_visible: 'last_section',
  cta_name: 'cta_id',
  active_seconds_at_click: 'active_seconds',
  video_duration_seconds: 'duration_seconds',
  play_percent: 'quartile',
  scroll_depth_at_trigger: 'scroll_depth_percent',
  question_index: 'step',
  error: 'outcome_code',
};

const COMPLETION_ALIASES = new Set([
  'calculator_completed', 'checklist_completed', 'checklist_interactive_completed',
  'checklist_result_view', 'webinar_registered', 'diagnostic_requested',
]);
const START_ALIASES = new Set([
  'calculator_started', 'checklist_interactive_open', 'checklist_interactive_start',
]);
const DOWNLOAD_ALIASES = new Set([
  'pdf_downloaded', 'pdf_download', 'checklist_pdf_download',
]);

let memoryJourney: StoredJourney | null = null;
let memorySession: StoredSession | null = null;
const activeTools = new Map<string, { lastStep: number }>();
const semanticDedupe = new Set<string>();

function nowIso(): string {
  return new Date().toISOString();
}

function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('Secure random identifiers are unavailable');
}

function pseudonym(prefix: 'jrn' | 'ses'): string {
  return `${prefix}_${randomUuid().replaceAll('-', '')}`;
}

function safeRead<T>(storage: Storage | undefined, key: string): T | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function safeWrite(storage: Storage | undefined, key: string, value: unknown): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function localStorageOrUndefined(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function sessionStorageOrUndefined(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.sessionStorage;
}

function stripQueryAndFragment(value: string): string {
  try {
    const url = new URL(value, typeof window === 'undefined' ? 'https://invalid.local' : window.location.origin);
    return `${url.origin === 'https://invalid.local' ? '' : url.origin}${url.pathname}`;
  } catch {
    return '/';
  }
}

function safePagePath(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname.replace(/\/{2,}/g, '/').slice(0, 256) || '/';
}

function safeReferrerOrigin(): string {
  if (typeof document === 'undefined' || !document.referrer) return '';
  try {
    return new URL(document.referrer).origin;
  } catch {
    return '';
  }
}

function safeAttributionToken(value: string | null, fallback: string): string {
  const normalized = (value ?? '').trim();
  if (!normalized) return fallback;
  if (normalized.length > 128 || EMAIL_LIKE.test(normalized) || PHONE_LIKE.test(normalized)) {
    return fallback;
  }
  return SAFE_TOKEN.test(normalized) ? normalized : fallback;
}

function isLeadMagnet(value: string): value is LeadMagnet {
  return ['calculator', 'checklist', 'interactive_checklist', 'webinar', 'diagnostic', 'unknown']
    .includes(value);
}

export function inferLeadMagnet(input?: {
  lead_magnet?: unknown;
  form_type?: unknown;
  section?: unknown;
}): LeadMagnet {
  const params = typeof window === 'undefined'
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
  const explicit = String(input?.lead_magnet ?? params.get('lead_magnet') ?? '').trim();
  if (isLeadMagnet(explicit)) return explicit;
  const formType = String(input?.form_type ?? '').trim();
  if (isLeadMagnet(formType)) return formType;
  const section = String(input?.section ?? '').trim();
  const sectionMap: Record<string, LeadMagnet> = {
    calculadora: 'calculator',
    calculator: 'calculator',
    checklist: 'checklist',
    'interactive-checklist': 'interactive_checklist',
    interactive_checklist: 'interactive_checklist',
    webinar: 'webinar',
    diagnostico: 'diagnostic',
    diagnostic: 'diagnostic',
  };
  if (sectionMap[section]) return sectionMap[section];
  if (typeof window !== 'undefined') {
    const routeMap: Record<string, LeadMagnet> = {
      '/calculadora': 'calculator',
      '/checklist-10-errores': 'checklist',
      '/autodiagnostico': 'interactive_checklist',
      '/webinar': 'webinar',
      '/diagnostico': 'diagnostic',
    };
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (routeMap[path]) return routeMap[path];
  }
  return 'unknown';
}

function readAttribution(input?: TrackingEventData): TouchAttribution {
  const params = typeof window === 'undefined'
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
  const referrer = safeReferrerOrigin();
  return {
    utm_source: safeAttributionToken(params.get('utm_source'), referrer ? 'referral' : 'direct'),
    utm_medium: safeAttributionToken(params.get('utm_medium'), referrer ? 'referral' : 'none'),
    utm_campaign: safeAttributionToken(params.get('utm_campaign'), 'unattributed'),
    utm_content: safeAttributionToken(params.get('utm_content'), ''),
    utm_term: safeAttributionToken(params.get('utm_term'), ''),
    referrer,
    lead_magnet: inferLeadMagnet(input),
    source_url: stripQueryAndFragment(typeof window === 'undefined' ? '/' : window.location.href),
    captured_at: nowIso(),
  };
}

function hasFreshAttribution(touch: TouchAttribution): boolean {
  return touch.utm_source !== 'direct' || touch.utm_medium !== 'none' ||
    touch.utm_campaign !== 'unattributed' || touch.referrer !== '' ||
    touch.lead_magnet !== 'unknown';
}

function getTouches(input?: TrackingEventData): {
  first_touch: TouchAttribution;
  last_touch: TouchAttribution;
} {
  const current = readAttribution(input);
  const storage = localStorageOrUndefined();
  const storedFirst = safeRead<TouchAttribution>(storage, FIRST_TOUCH_KEY);
  const storedLast = safeRead<TouchAttribution>(storage, LAST_TOUCH_KEY);
  const firstTouch = storedFirst ?? current;
  const lastTouch = hasFreshAttribution(current) ? current : storedLast ?? current;
  safeWrite(storage, FIRST_TOUCH_KEY, firstTouch);
  safeWrite(storage, LAST_TOUCH_KEY, lastTouch);
  return { first_touch: firstTouch, last_touch: lastTouch };
}

function getJourney(): { id: string; persisted: boolean } {
  const now = Date.now();
  const storage = localStorageOrUndefined();
  const stored = safeRead<StoredJourney>(storage, JOURNEY_KEY);
  if (stored && stored.expires_at > now && SAFE_TOKEN.test(stored.journey_id)) {
    const renewed = { ...stored, expires_at: now + JOURNEY_TTL_MS };
    const persisted = safeWrite(storage, JOURNEY_KEY, renewed);
    memoryJourney = renewed;
    return { id: renewed.journey_id, persisted };
  }
  const fresh: StoredJourney = {
    journey_id: pseudonym('jrn'),
    expires_at: now + JOURNEY_TTL_MS,
    created_at: nowIso(),
  };
  const persisted = safeWrite(storage, JOURNEY_KEY, fresh);
  memoryJourney = fresh;
  return { id: fresh.journey_id, persisted };
}

function getSession(): string {
  const now = Date.now();
  const storage = sessionStorageOrUndefined();
  const stored = safeRead<StoredSession>(storage, SESSION_KEY);
  if (stored && now - stored.last_seen_at <= SESSION_IDLE_MS && SAFE_TOKEN.test(stored.session_id)) {
    const renewed = { ...stored, last_seen_at: now };
    safeWrite(storage, SESSION_KEY, renewed);
    memorySession = renewed;
    return renewed.session_id;
  }
  const fresh: StoredSession = {
    session_id: pseudonym('ses'),
    last_seen_at: now,
    created_at: nowIso(),
  };
  safeWrite(storage, SESSION_KEY, fresh);
  memorySession = fresh;
  return fresh.session_id;
}

function deviceType(width: number): TrackingContext['device_type'] {
  if (!width) return 'unknown';
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export function buildTrackingContext(data?: TrackingEventData): TrackingContext | null {
  if (!hasAnalyticsConsent()) return null;
  const journey = getJourney();
  const touches = getTouches(data);
  const viewportWidth = typeof window === 'undefined' ? 0 : Math.max(1, window.innerWidth);
  return {
    event_id: randomUuid(),
    event_version: EVENT_VERSION,
    occurred_at: nowIso(),
    journey_id: journey.id,
    anonymous_id: journey.id,
    session_id: getSession(),
    identity_persistence: journey.persisted ? 'localStorage' : 'memory',
    storage_available: journey.persisted,
    first_touch: touches.first_touch,
    last_touch: touches.last_touch,
    lead_magnet: touches.last_touch.lead_magnet,
    section: typeof data?.section === 'string' && SAFE_TOKEN.test(data.section)
      ? data.section
      : undefined,
    source_url: touches.last_touch.source_url,
    referrer: touches.last_touch.referrer,
    utm_source: touches.last_touch.utm_source,
    utm_medium: touches.last_touch.utm_medium,
    utm_campaign: touches.last_touch.utm_campaign,
    utm_content: touches.last_touch.utm_content,
    utm_term: touches.last_touch.utm_term,
    partner: typeof data?.partner === 'string' && SAFE_TOKEN.test(data.partner)
      ? data.partner
      : undefined,
    device_type: deviceType(viewportWidth),
    viewport_width: viewportWidth,
    consent_state: 'accepted',
    consent_version: ANALYTICS_CONSENT_VERSION,
  };
}

function finiteNumber(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function sanitizedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || EMAIL_LIKE.test(normalized) || PHONE_LIKE.test(normalized)) {
    return undefined;
  }
  return normalized;
}

export function sanitizeTrackingProperties(data?: TrackingEventData): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(data ?? {})) {
    const lower = rawKey.toLowerCase();
    if (PII_KEYS.has(lower) || (typeof value === 'object' && value !== null)) continue;
    const key = PROPERTY_ALIASES[lower] ?? lower;
    if (!PROPERTY_KEYS.has(key)) continue;
    if (key === 'page_path') {
      const path = sanitizedString(value);
      if (path) clean[key] = stripQueryAndFragment(path);
      continue;
    }
    if (typeof value === 'string') {
      const safe = sanitizedString(value);
      if (safe) clean[key] = safe;
      continue;
    }
    if (typeof value === 'boolean') {
      clean[key] = value;
      continue;
    }
    if (typeof value === 'number') {
      const safe = finiteNumber(value, 0, 86_400);
      if (safe !== undefined) clean[key] = safe;
    }
  }
  return clean;
}

function inferToolId(data: TrackingEventData = {}): string {
  const candidate = String(data.tool_id ?? data.form_type ?? data.lead_magnet ?? '').trim();
  return isLeadMagnet(candidate) && candidate !== 'unknown' ? candidate : inferLeadMagnet(data);
}

function normalizeEvent(
  name: string,
  input: TrackingEventData = {},
): { name: CanonicalBrowserEvent; properties: Record<string, unknown> } | null {
  const data: Record<string, unknown> = { ...input };
  if (START_ALIASES.has(name)) {
    data.tool_id = inferToolId(data as TrackingEventData);
    name = 'tool_start';
  } else if (COMPLETION_ALIASES.has(name)) {
    data.tool_id = inferToolId(data as TrackingEventData);
    name = 'tool_complete';
  } else if (DOWNLOAD_ALIASES.has(name)) {
    data.tool_id = inferToolId(data as TrackingEventData);
    name = 'resource_download';
  } else if (name === 'checklist_question_answered') {
    data.tool_id = 'interactive_checklist';
    name = 'tool_step';
  } else if (name === 'video_play') {
    name = 'video_start';
  } else if (name === 'video_progress') {
    name = 'video_quartile';
  } else if (name === 'calendly_click' || name === 'calendly_redirect') {
    data.cta_id = 'calendly';
    data.location = inferToolId(data as TrackingEventData);
    name = 'cta_click';
  } else if (name === 'pdf_download') {
    name = 'resource_download';
  }
  const allowed = new Set<CanonicalBrowserEvent>([
    'page_view', 'page_abandon', 'session_start', 'session_ping', 'section_view',
    'scroll_milestone', 'cta_click', 'tool_start', 'tool_step', 'tool_complete',
    'tool_abandon', 'resource_download', 'form_start', 'form_step', 'form_submit',
    'form_success', 'form_error', 'video_start', 'video_quartile',
    'video_complete', 'video_abandon',
  ]);
  if (!allowed.has(name as CanonicalBrowserEvent)) return null;
  const properties = sanitizeTrackingProperties(data as TrackingEventData);
  if (name === 'page_view' || name === 'page_abandon') properties.page_path = safePagePath();
  return { name: name as CanonicalBrowserEvent, properties };
}

function buildApiUrl(path: DataBrainPath): string {
  const base = config.dataBrainIngestUrl.trim();
  if (!base) return '';
  const apiMarker = base.indexOf('/api/');
  return apiMarker >= 0
    ? `${base.slice(0, apiMarker)}${path}`
    : `${base.replace(/\/+$/, '')}${path}`;
}

function analyticsAllowed(): boolean {
  return config.enableAnalytics && hasAnalyticsConsent();
}

function sendBehaviorEvent(
  name: CanonicalBrowserEvent,
  context: TrackingContext,
  properties: Record<string, unknown>,
  useBeacon = false,
): void {
  const url = buildApiUrl('/api/events/ingest');
  if (!url || !analyticsAllowed()) return;
  const body = JSON.stringify({ event_name: name, context, properties });
  try {
    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon?.(url, body)) return;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body,
    }).catch(() => undefined);
  } catch {
    // Analytics is intentionally non-blocking.
  }
}

function fireProviders(
  name: CanonicalBrowserEvent,
  context: TrackingContext,
  properties: Record<string, unknown>,
): void {
  const payload = {
    ...properties,
    event_id: context.event_id,
    journey_id: context.journey_id,
    session_id: context.session_id,
    lead_magnet: context.lead_magnet,
  };
  try {
    window.gtag?.('event', name, payload);
  } catch {}
  try {
    if (window.posthog) {
      window.posthog.capture(name, payload);
    } else if (config.posthogKey) {
      fetch(`${config.posthogHost.replace(/\/+$/, '')}/capture/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          api_key: config.posthogKey,
          event: name,
          distinct_id: context.journey_id,
          properties: payload,
        }),
      }).catch(() => undefined);
    }
  } catch {}
  try {
    if (window._linkedin_data_partner_id && window.lintrk) {
      window.lintrk('track', { conversion_id: name });
    }
  } catch {}
}

function semanticKey(name: CanonicalBrowserEvent, properties: Record<string, unknown>): string | null {
  if (name === 'page_view') return `page_view:${properties.page_path}`;
  if (name === 'tool_start' || name === 'tool_complete') return `${name}:${properties.tool_id}`;
  if (name === 'tool_step') return `${name}:${properties.tool_id}:${properties.step}`;
  if (name === 'video_quartile') return `${name}:${properties.play_session_id}:${properties.quartile}`;
  if (name === 'video_complete') return `${name}:${properties.play_session_id}`;
  if (name === 'resource_download') return `${name}:${properties.tool_id}:${properties.asset_id ?? ''}`;
  return null;
}

function updateToolState(name: CanonicalBrowserEvent, properties: Record<string, unknown>): void {
  const toolId = typeof properties.tool_id === 'string' ? properties.tool_id : null;
  if (!toolId) return;
  if (name === 'tool_start') activeTools.set(toolId, { lastStep: 0 });
  if (name === 'tool_step') {
    const step = typeof properties.step === 'number' ? properties.step : 0;
    activeTools.set(toolId, { lastStep: Math.max(activeTools.get(toolId)?.lastStep ?? 0, step) });
  }
  if (name === 'tool_complete' || name === 'tool_abandon') activeTools.delete(toolId);
}

function emitEvent(name: string, data?: TrackingEventData, useBeacon = false): void {
  if (typeof window === 'undefined' || !analyticsAllowed()) return;
  const normalized = normalizeEvent(name, data);
  if (!normalized) return;
  const context = buildTrackingContext(data);
  if (!context) return;
  const key = semanticKey(normalized.name, normalized.properties);
  if (key && semanticDedupe.has(key)) return;
  if (key) semanticDedupe.add(key);
  updateToolState(normalized.name, normalized.properties);
  fireProviders(normalized.name, context, normalized.properties);
  sendBehaviorEvent(normalized.name, context, normalized.properties, useBeacon);
}

export function trackEvent(name: TrackingEvent | string, data?: TrackingEventData): void {
  emitEvent(name, data);
}

export function getCurrentTrackingContext(data?: TrackingEventData): TrackingContext | null {
  return buildTrackingContext(data);
}

export function getCampaignTrackingContext(): CampaignTrackingContext | null {
  if (typeof window === 'undefined' || !hasAnalyticsConsent()) return null;
  const params = new URLSearchParams(window.location.search);
  const contactId = params.get('cid')?.trim() ?? '';
  const campaignId = params.get('campaign_id')?.trim() ?? '';
  const storage = sessionStorageOrUndefined();
  const stored = safeRead<CampaignTrackingContext>(storage, CAMPAIGN_CONTEXT_KEY);
  if (CAMPAIGN_CONTACT_ID_PATTERN.test(contactId)) {
    const context = {
      contact_id: contactId,
      campaign_external_id: SAFE_TOKEN.test(campaignId)
        ? campaignId
        : config.campaignExternalId,
    };
    safeWrite(storage, CAMPAIGN_CONTEXT_KEY, context);
    return context;
  }
  return stored && CAMPAIGN_CONTACT_ID_PATTERN.test(stored.contact_id) ? stored : null;
}

export function getCampaignAwareUrl(rawUrl: string): string {
  const campaign = getCampaignTrackingContext();
  return !campaign || typeof window === 'undefined'
    ? rawUrl
    : buildCampaignAwareUrl(rawUrl, campaign, window.location.origin);
}

export function trackCampaignEvent(
  eventName: string,
  data: Record<string, unknown> = {},
  context = buildTrackingContext(),
): void {
  const campaign = getCampaignTrackingContext();
  const url = buildApiUrl('/api/campaign/events');
  if (!analyticsAllowed() || !campaign || !url || !context || !SAFE_TOKEN.test(eventName)) return;
  const properties = sanitizeTrackingProperties(data);
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
          journey_id: context.journey_id,
          session_id: context.session_id,
          lead_magnet: context.lead_magnet,
          utm_source: context.utm_source,
          utm_medium: context.utm_medium,
          utm_campaign: context.utm_campaign,
        },
        properties,
      }),
    }).catch(() => undefined);
  } catch {}
}

export function trackPageView(): void {
  trackEvent('page_view', { page_path: safePagePath() });
}

export function trackSectionView(sectionId: string): void {
  trackEvent('section_view', { section: sectionId });
}

export function trackScrollDepth(percent: number): void {
  trackEvent('scroll_milestone', { depth_percent: percent });
}

export function trackCtaClick(ctaId: string, location: string): void {
  trackEvent('cta_click', { cta_id: ctaId, location });
}

export function trackFormStart(formType: FormType): void {
  trackEvent('form_start', { form_type: formType });
  trackEvent('tool_start', { tool_id: formType });
  trackCampaignEvent('resource_started', { form_type: formType });
}

export function trackFormStep(formType: FormType, step: number): void {
  trackEvent('form_step', { form_type: formType, step });
  trackEvent('tool_step', { tool_id: formType, step });
}

export function trackFormSubmit(formType: FormType, extra?: TrackingEventData): void {
  trackEvent('form_submit', { form_type: formType, ...extra });
}

export function trackFormSuccess(formType: FormType): void {
  trackEvent('form_success', { form_type: formType });
  trackEvent('tool_complete', { tool_id: formType });
}

export function trackFormError(formType: FormType, error: string): void {
  trackEvent('form_error', { form_type: formType, outcome_code: error });
}

export function trackFaqToggle(_question: string, open: boolean): void {
  trackEvent('cta_click', { cta_id: 'faq_toggle', location: open ? 'open' : 'closed' });
}

export function trackVideoPlay(): void {
  trackEvent('video_start', { section: 'video', video_id: 'hero_explicativo_3min' });
}

export function trackVideoComplete(): void {
  trackEvent('video_complete', { section: 'video', video_id: 'hero_explicativo_3min' });
}

export function trackCalendlyRedirect(leadMagnet: LeadMagnet = inferLeadMagnet()): void {
  trackEvent('cta_click', { cta_id: 'calendly', location: leadMagnet, high_intent: true });
}

export function trackPdfDownload(leadMagnet: LeadMagnet = 'checklist'): void {
  trackEvent('resource_download', { tool_id: leadMagnet, asset_id: 'fundae_resource' });
}

export function trackLeadScored(score: number, classification: string): void {
  trackEvent('tool_complete', { tool_id: inferLeadMagnet(), score, classification });
}

export function trackExitIntent(): void {
  trackEvent('cta_click', { cta_id: 'exit_intent', location: safePagePath() });
}

export function trackActiveToolAbandons(reason: 'pagehide' | 'visibility_hidden'): void {
  for (const [toolId, state] of [...activeTools]) {
    emitEvent('tool_abandon', {
      tool_id: toolId,
      step: state.lastStep,
      reason,
    }, true);
  }
}

export function trackSessionStart(payload: TrackingEventData = {}): void {
  trackEvent('session_start', payload);
}

export function trackSessionPing(payload: TrackingEventData = {}): void {
  trackEvent('session_ping', payload);
}

export function trackScrollMilestone(payload: TrackingEventData = {}): void {
  trackEvent('scroll_milestone', payload);
}

export function trackGodModeSectionView(payload: TrackingEventData = {}): void {
  trackEvent('section_view', payload);
}

export function trackVideoImpression(payload: TrackingEventData = {}): void {
  trackEvent('video_start', payload);
}

export function trackVideoProgress(payload: TrackingEventData = {}): void {
  trackEvent('video_quartile', payload);
}

export function trackVideoAbandoned(payload: TrackingEventData = {}): void {
  emitEvent('video_abandon', payload, true);
}

export function trackGodModeCtaClick(payload: TrackingEventData = {}): void {
  trackEvent('cta_click', payload);
}

export function trackPageExit(payload: TrackingEventData = {}): void {
  emitEvent('page_abandon', payload, true);
}

subscribeAnalyticsConsent((state) => {
  if (state !== 'rejected') return;
  memoryJourney = null;
  memorySession = null;
  activeTools.clear();
  semanticDedupe.clear();
});
