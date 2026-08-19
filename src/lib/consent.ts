export type AnalyticsConsent = 'unknown' | 'accepted' | 'rejected';

export const ANALYTICS_CONSENT_VERSION = '2026-08-19';

const ANALYTICS_CONSENT_KEY = 'fundae_analytics_consent_v1';
const ANALYTICS_STORAGE_KEYS = [
  'fundae_identity_v1',
  'fundae_journey_v2',
  'fundae_session_v1',
  'fundae_session_v2',
  'fundae_first_touch_v1',
  'fundae_first_touch_v2',
  'fundae_last_touch_v1',
  'fundae_last_touch_v2',
  'fundae_campaign_context_v1',
] as const;

interface StoredConsent {
  state: Exclude<AnalyticsConsent, 'unknown'>;
  version: string;
  updated_at: string;
}

type ConsentListener = (state: AnalyticsConsent) => void;

let memoryConsent: AnalyticsConsent = 'unknown';
const listeners = new Set<ConsentListener>();

function isStoredConsent(value: unknown): value is StoredConsent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (record.state === 'accepted' || record.state === 'rejected') &&
    typeof record.version === 'string' &&
    typeof record.updated_at === 'string' &&
    Number.isFinite(Date.parse(record.updated_at));
}

function clearAnalyticsStorage(): void {
  if (typeof window === 'undefined') return;
  for (const key of ANALYTICS_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    } catch {
      // Storage can be unavailable in strict privacy modes.
    }
  }
}

function invalidateStoredConsent(): AnalyticsConsent {
  memoryConsent = 'unknown';
  if (typeof window === 'undefined') return memoryConsent;
  try {
    window.localStorage.removeItem(ANALYTICS_CONSENT_KEY);
  } catch {
    // Storage can be unavailable in strict privacy modes.
  }
  clearAnalyticsStorage();
  return memoryConsent;
}

function notify(state: AnalyticsConsent): void {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // Consent changes must not break the landing.
    }
  }
}

export function getAnalyticsConsent(): AnalyticsConsent {
  if (typeof window === 'undefined') return memoryConsent;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
  } catch {
    return memoryConsent;
  }
  if (!raw) return invalidateStoredConsent();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalidateStoredConsent();
  }
  if (isStoredConsent(parsed) && parsed.version === ANALYTICS_CONSENT_VERSION) {
    memoryConsent = parsed.state;
    return parsed.state;
  }
  return invalidateStoredConsent();
}

export function setAnalyticsConsent(value: Exclude<AnalyticsConsent, 'unknown'>): void {
  memoryConsent = value;
  try {
    const stored: StoredConsent = {
      state: value,
      version: ANALYTICS_CONSENT_VERSION,
      updated_at: new Date().toISOString(),
    };
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, JSON.stringify(stored));
  } catch {
    // The explicit decision remains effective in memory for the current page.
  }
  if (value === 'rejected') clearAnalyticsStorage();
  notify(value);
}

export function hasAnalyticsConsent(): boolean {
  return getAnalyticsConsent() === 'accepted';
}

export function subscribeAnalyticsConsent(listener: ConsentListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
