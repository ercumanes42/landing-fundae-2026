import { useState, useEffect } from 'react';
import type { UTMParams } from '../types';

/**
 * Captures UTM parameters from the current URL on mount.
 * Also records `document.referrer`.
 *
 * The values are read once and memoised — subsequent renders return
 * the same object reference.
 */
export function useUTM(): UTMParams {
  const [params] = useState<UTMParams>(() => {
    const search = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : '',
    );

    return {
      utm_source: search.get('utm_source') ?? '',
      utm_medium: search.get('utm_medium') ?? '',
      utm_campaign: search.get('utm_campaign') ?? '',
      utm_content: search.get('utm_content') ?? '',
      utm_term: search.get('utm_term') ?? '',
      referrer: typeof document !== 'undefined' ? document.referrer : '',
    };
  });

  // Optionally persist to sessionStorage so other non-React code can
  // access the UTMs (e.g. webhooks.ts which reads them independently).
  useEffect(() => {
    try {
      sessionStorage.setItem('fundae_utm', JSON.stringify(params));
    } catch {
      // Storage may be unavailable (private browsing, full quota, etc.)
    }
  }, [params]);

  return params;
}
