/**
 * Centralized configuration — reads all VITE_ environment variables.
 *
 * Every value has a sensible default so the app can run in dev without a
 * .env file (webhooks simply log to console, tracking is skipped, etc.).
 */

export interface AppConfig {
  // ── Webhook URLs ──────────────────────────────────────────────────────
  readonly checklistWebhookUrl: string;
  readonly interactiveChecklistWebhookUrl: string;
  readonly calculatorWebhookUrl: string;
  readonly webinarWebhookUrl: string;
  readonly diagnosticWebhookUrl: string;
  readonly dataBrainIngestUrl: string;
  readonly campaignExternalId: string;

  // ── External links ────────────────────────────────────────────────────
  readonly calendlyUrl: string;
  readonly videoUrl: string;
  readonly checklistPdfUrl: string;

  // ── Webinar schedule ──────────────────────────────────────────────────
  readonly webinarDate: string;
  readonly webinarTime: string;

  // ── Analytics / tracking ──────────────────────────────────────────────
  readonly posthogKey: string;
  readonly posthogHost: string;
  readonly enableAnalytics: boolean;
  readonly linkedinPartnerId: string;
  readonly ga4Id: string;

  // ── Meta ───────────────────────────────────────────────────────────────
  readonly isDev: boolean;
}

function env(key: string, fallback = ''): string {
  return (import.meta.env[key] as string | undefined) ?? fallback;
}

function envBool(key: string, fallback = true): boolean {
  const raw = env(key, String(fallback));
  return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase());
}

export const config: AppConfig = {
  // Webhooks
  checklistWebhookUrl: env('VITE_CHECKLIST_WEBHOOK_URL'),
  interactiveChecklistWebhookUrl: env('VITE_INTERACTIVE_CHECKLIST_WEBHOOK_URL', env('VITE_CHECKLIST_WEBHOOK_URL')),
  calculatorWebhookUrl: env('VITE_CALCULATOR_WEBHOOK_URL'),
  webinarWebhookUrl: env('VITE_WEBINAR_WEBHOOK_URL'),
  diagnosticWebhookUrl: env('VITE_DIAGNOSTIC_WEBHOOK_URL'),
  dataBrainIngestUrl: env('VITE_DATA_BRAIN_INGEST_URL'),
  campaignExternalId: env('VITE_CAMPAIGN_EXTERNAL_ID', 'FUNDAE_2026_EMAIL_V1'),

  // External links
  calendlyUrl: env('VITE_CALENDLY_URL'),
  videoUrl: env('VITE_VIDEO_URL'),
  checklistPdfUrl: env('VITE_CHECKLIST_PDF_URL'),

  // Webinar schedule
  webinarDate: env('VITE_WEBINAR_DATE', '2026-07-15'),
  webinarTime: env('VITE_WEBINAR_TIME', '10:00'),

  // Analytics
  posthogKey: env('VITE_POSTHOG_KEY'),
  posthogHost: env('VITE_POSTHOG_HOST', 'https://eu.i.posthog.com'),
  enableAnalytics: envBool('VITE_ENABLE_ANALYTICS', true),
  linkedinPartnerId: env('VITE_LINKEDIN_PARTNER_ID'),
  ga4Id: env('VITE_GA4_ID'),

  // Meta
  isDev: import.meta.env.DEV === true,
} as const;

/**
 * Returns the webhook URL for a given form type.
 */
export function getWebhookUrl(
  formType: 'checklist' | 'interactive_checklist' | 'calculator' | 'webinar' | 'diagnostic',
): string {
  const map: Record<typeof formType, string> = {
    checklist: config.checklistWebhookUrl,
    interactive_checklist: config.interactiveChecklistWebhookUrl,
    calculator: config.calculatorWebhookUrl,
    webinar: config.webinarWebhookUrl,
    diagnostic: config.diagnosticWebhookUrl,
  };
  return map[formType];
}
