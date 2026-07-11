export type AnalyticsConsent = 'unknown' | 'accepted' | 'rejected';

const ANALYTICS_CONSENT_KEY = 'fundae_analytics_consent_v1';

export function getAnalyticsConsent(): AnalyticsConsent {
  if (typeof window === 'undefined') return 'unknown';
  try {
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === 'accepted' || value === 'rejected' ? value : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function setAnalyticsConsent(value: Exclude<AnalyticsConsent, 'unknown'>): void {
  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
  } catch {
    // Consent remains in memory for the current visit if storage is unavailable.
  }
}

export function hasAnalyticsConsent(): boolean {
  return getAnalyticsConsent() === 'accepted';
}
