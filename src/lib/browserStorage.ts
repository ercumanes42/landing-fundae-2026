export type BrowserStorageArea = 'localStorage' | 'sessionStorage';
export type BrowserStorageCategory = 'preferences' | 'analytics';
export type BrowserStorageCleanup = 'consent-withdrawal' | 'policy-version-change';
export type BrowserStorageRetention =
  | 'policy-version'
  | 'fixed'
  | 'rolling'
  | 'session-idle'
  | 'session'
  | 'legacy-removal'
  | 'until-consent-withdrawal';

export interface BrowserStorageEntry {
  readonly key: string;
  readonly category: BrowserStorageCategory;
  readonly storageAreas: readonly BrowserStorageArea[];
  readonly retention: BrowserStorageRetention;
  readonly ttlMs: number | null;
  readonly cleanup: readonly BrowserStorageCleanup[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const BROWSER_STORAGE_REGISTRY = {
  analyticsConsent: {
    key: 'fundae_analytics_consent_v1',
    category: 'preferences',
    storageAreas: ['localStorage'],
    retention: 'fixed',
    ttlMs: 730 * DAY_MS,
    cleanup: ['policy-version-change'],
  },
  journey: {
    key: 'fundae_journey_v2',
    category: 'analytics',
    storageAreas: ['localStorage'],
    retention: 'rolling',
    ttlMs: 30 * DAY_MS,
    cleanup: ['consent-withdrawal', 'policy-version-change'],
  },
  session: {
    key: 'fundae_session_v2',
    category: 'analytics',
    storageAreas: ['sessionStorage'],
    retention: 'session-idle',
    ttlMs: 30 * MINUTE_MS,
    cleanup: ['consent-withdrawal', 'policy-version-change'],
  },
  firstTouch: {
    key: 'fundae_first_touch_v2',
    category: 'analytics',
    storageAreas: ['localStorage'],
    retention: 'until-consent-withdrawal',
    ttlMs: null,
    cleanup: ['consent-withdrawal', 'policy-version-change'],
  },
  lastTouch: {
    key: 'fundae_last_touch_v2',
    category: 'analytics',
    storageAreas: ['localStorage'],
    retention: 'until-consent-withdrawal',
    ttlMs: null,
    cleanup: ['consent-withdrawal', 'policy-version-change'],
  },
  campaignContext: {
    key: 'fundae_campaign_context_v1',
    category: 'analytics',
    storageAreas: ['sessionStorage'],
    retention: 'session',
    ttlMs: null,
    cleanup: ['consent-withdrawal', 'policy-version-change'],
  },
  legacyIdentity: {
    key: 'fundae_identity_v1',
    category: 'analytics',
    storageAreas: ['localStorage', 'sessionStorage'],
    retention: 'legacy-removal',
    ttlMs: null,
    cleanup: ['consent-withdrawal', 'policy-version-change'],
  },
  legacySession: {
    key: 'fundae_session_v1',
    category: 'analytics',
    storageAreas: ['localStorage', 'sessionStorage'],
    retention: 'legacy-removal',
    ttlMs: null,
    cleanup: ['consent-withdrawal', 'policy-version-change'],
  },
  legacyFirstTouch: {
    key: 'fundae_first_touch_v1',
    category: 'analytics',
    storageAreas: ['localStorage', 'sessionStorage'],
    retention: 'legacy-removal',
    ttlMs: null,
    cleanup: ['consent-withdrawal', 'policy-version-change'],
  },
  legacyLastTouch: {
    key: 'fundae_last_touch_v1',
    category: 'analytics',
    storageAreas: ['localStorage', 'sessionStorage'],
    retention: 'legacy-removal',
    ttlMs: null,
    cleanup: ['consent-withdrawal', 'policy-version-change'],
  },
} as const satisfies Record<string, BrowserStorageEntry>;

export function browserStorageEntriesForCleanup(
  trigger: BrowserStorageCleanup,
): readonly BrowserStorageEntry[] {
  return Object.values(BROWSER_STORAGE_REGISTRY).filter(
    (entry) => (entry.cleanup as readonly BrowserStorageCleanup[]).includes(trigger),
  );
}
