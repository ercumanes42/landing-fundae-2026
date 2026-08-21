type EnvKey =
  | 'SUPABASE_URL'
  | 'SUPABASE_ANON_KEY'
  | 'SUPABASE_SERVICE_ROLE_KEY'
  | 'LEAD_HASH_SECRET'
  | 'OPENAI_API_KEY'
  | 'OPENAI_MODEL_SUMMARY'
  | 'OPENAI_MODEL_ANALYST'
  | 'DATA_BRAIN_ADMIN_USER'
  | 'DATA_BRAIN_ADMIN_PASSWORD'
  | 'DATA_BRAIN_AUTH_CREDENTIALS'
  | 'DATA_BRAIN_AUTH_PEPPER'
  | 'DATA_BRAIN_LEGACY_BASIC_ENABLED'
  | 'DATA_BRAIN_AUTH_MAX_ATTEMPTS'
  | 'DATA_BRAIN_AUTH_WINDOW_SECONDS'
  | 'DATA_BRAIN_AUTH_EDGE_RATE_LIMITED'
  | 'DATA_BRAIN_ALLOWED_IPS'
  | 'LANDING_ALLOWED_ORIGINS'
  | 'CAMPAIGN_IMPORT_SECRET'
  | 'MAKE_WEBHOOK_SECRET'
  | 'UNSUBSCRIBE_TOKEN_SECRET'
  | 'UNSUBSCRIBE_PUBLIC_BASE_URL'
  | 'HUBSPOT_WEBHOOK_SECRET'
  | 'CAMPAIGN_DEFAULT_EXTERNAL_ID'
  | 'HUBSPOT_ACCESS_TOKEN'
  | 'HUBSPOT_PORTAL_ID'
  | 'HUBSPOT_API_VERSION'
  | 'HUBSPOT_SYNC_ENABLED'
  | 'HUBSPOT_WORKER_SECRET'
  | 'HUBSPOT_SYNC_WORKER_ID'
  | 'OPERATIONAL_OBSERVABILITY_ENABLED'
  | 'OPERATIONAL_ALERT_DELIVERY_ENABLED'
  | 'OBSERVABILITY_WORKER_SECRET'
  | 'MAKE_WEBHOOK_URL'
  | 'OUTBOUND_MASTER_ENABLED'
  | 'LEGACY_MAKE_DELIVERY_ENABLED'
  | 'LEGACY_DELIVERY_RETRY_ENABLED'
  | 'MAILBOX_IDENTITY_HASH'
  | 'TRANSACTIONAL_OUTLOOK_ENABLED'
  | 'COLD_CAMPAIGN_ENABLED'
  | 'COLD_CAMPAIGN_WORKER_ID'
  | 'GRAPH_TENANT_ID'
  | 'GRAPH_CLIENT_ID'
  | 'GRAPH_CLIENT_SECRET'
  | 'GRAPH_MAILBOX_USER_ID'
  | 'GRAPH_MAILBOX_ADDRESS'
  | 'GRAPH_WORKER_SECRET'
  | 'GRAPH_DISPATCH_WORKER_ID'
  | 'GRAPH_OUTBOX_CAPABILITY_SECRET'
  | 'GRAPH_REQUEST_TIMEOUT_MS'
  | 'GRAPH_READ_MAX_ATTEMPTS'
  | 'GRAPH_MAX_RETRY_DELAY_MS'
  | 'GRAPH_MARKER_POLL_ATTEMPTS'
  | 'GRAPH_SENT_POLL_ATTEMPTS'
  | 'GRAPH_POLL_INTERVAL_MS'
  | 'INBOUND_MAILBOX_ENABLED'
  | 'INBOUND_MAILBOX_BOOTSTRAP_FROM'
  | 'CALENDLY_WEBHOOK_ENABLED'
  | 'CALENDLY_WEBHOOK_SIGNING_KEY'
  | 'TRANSACTIONAL_PILOT_MODE'
  | 'TRANSACTIONAL_GRAPH_PILOT_LIVE_ENABLED'
  | 'TRANSACTIONAL_GRAPH_PILOT_TTL_SECONDS'
  | 'TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS'
  | 'TRANSACTIONAL_LANDING_ORIGIN'
  | 'TRANSACTIONAL_WEBINAR_TITLE'
  | 'TRANSACTIONAL_WEBINAR_START_AT'
  | 'TRANSACTIONAL_WEBINAR_DURATION_MINUTES'
  | 'TRANSACTIONAL_WEBINAR_TIMEZONE'
  | 'TRANSACTIONAL_WEBINAR_ACCESS_NOTE'
  | 'AIRTABLE_API_KEY'
  | 'AIRTABLE_BASE_ID'
  | 'POSTHOG_PROJECT_API_KEY'
  | 'NOTIFICATION_WEBHOOK_URL'
  | 'RATE_LIMIT_TRUSTED_IP_HEADER';

const REQUIRED_ENV: EnvKey[] = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LEAD_HASH_SECRET',
];

const DASHBOARD_REQUIRED_ENV: EnvKey[] = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATA_BRAIN_AUTH_CREDENTIALS',
  'DATA_BRAIN_AUTH_PEPPER',
];

const LEAD_HASH_SECRET_PLACEHOLDER_PATTERN = /(?:replace[-_ ]?with|change[-_ ]?me|changeme|placeholder|example|xxxxx|your[-_ ]?(?:key|secret|password)|tu[-_ ]?(?:clave|secreto)|secret[-_ ]?here|^todo$)/i;
export const LEAD_HASH_SECRET_INVALID = 'LEAD_HASH_SECRET_INVALID';

const DEFAULTS: Partial<Record<EnvKey, string>> = {
  OPENAI_MODEL_SUMMARY: 'gpt-4o-mini',
  OPENAI_MODEL_ANALYST: 'gpt-4o',
  HUBSPOT_API_VERSION: '2026-03',
  HUBSPOT_SYNC_ENABLED: 'false',
  OPERATIONAL_OBSERVABILITY_ENABLED: 'false',
  OPERATIONAL_ALERT_DELIVERY_ENABLED: 'false',
  CAMPAIGN_DEFAULT_EXTERNAL_ID: 'FUNDAE_2026_EMAIL_V1',
  LANDING_ALLOWED_ORIGINS: 'http://localhost:3001',
  OUTBOUND_MASTER_ENABLED: 'false',
  LEGACY_MAKE_DELIVERY_ENABLED: 'false',
  LEGACY_DELIVERY_RETRY_ENABLED: 'false',
  TRANSACTIONAL_OUTLOOK_ENABLED: 'false',
  COLD_CAMPAIGN_ENABLED: 'false',
  GRAPH_REQUEST_TIMEOUT_MS: '10000',
  GRAPH_READ_MAX_ATTEMPTS: '4',
  GRAPH_MAX_RETRY_DELAY_MS: '30000',
  GRAPH_MARKER_POLL_ATTEMPTS: '4',
  GRAPH_SENT_POLL_ATTEMPTS: '10',
  GRAPH_POLL_INTERVAL_MS: '2000',
  INBOUND_MAILBOX_ENABLED: 'false',
  CALENDLY_WEBHOOK_ENABLED: 'false',
  TRANSACTIONAL_PILOT_MODE: 'true',
  TRANSACTIONAL_GRAPH_PILOT_LIVE_ENABLED: 'false',
  TRANSACTIONAL_GRAPH_PILOT_TTL_SECONDS: '600',
  TRANSACTIONAL_WEBINAR_TIMEZONE: 'Europe/Madrid',
  DATA_BRAIN_LEGACY_BASIC_ENABLED: 'false',
  DATA_BRAIN_AUTH_MAX_ATTEMPTS: '5',
  DATA_BRAIN_AUTH_WINDOW_SECONDS: '300',
  DATA_BRAIN_AUTH_EDGE_RATE_LIMITED: 'false',
};

export function env(key: EnvKey): string {
  return process.env[key] || DEFAULTS[key] || '';
}

/**
 * Lead identities are stable HMACs. Accept only an untrimmed, non-placeholder
 * secret with at least 32 UTF-8 bytes so every runtime path fails closed.
 */
export function isValidLeadHashSecret(value: string): boolean {
  return value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, 'utf8') >= 32
    && !LEAD_HASH_SECRET_PLACEHOLDER_PATTERN.test(value);
}

export function leadHashSecret(): string {
  const value = env('LEAD_HASH_SECRET');
  if (!isValidLeadHashSecret(value)) throw new Error(LEAD_HASH_SECRET_INVALID);
  return value;
}

export type OutboundCapabilityFlag =
  | 'LEGACY_MAKE_DELIVERY_ENABLED'
  | 'LEGACY_DELIVERY_RETRY_ENABLED'
  | 'TRANSACTIONAL_OUTLOOK_ENABLED'
  | 'COLD_CAMPAIGN_ENABLED'
  | 'COLD_CAMPAIGN_WORKER_ID'
  | 'HUBSPOT_SYNC_ENABLED';

function strictBooleanEnv(key: EnvKey): boolean {
  return env(key).trim().toLowerCase() === 'true';
}

/**
 * All outbound lanes fail closed. A lane-specific switch can never override
 * the master kill switch, and values other than the literal `true` remain off.
 */
export function isOutboundCapabilityEnabled(capability: OutboundCapabilityFlag): boolean {
  return strictBooleanEnv('OUTBOUND_MASTER_ENABLED') && strictBooleanEnv(capability);
}

export type InboundCapabilityFlag = 'INBOUND_MAILBOX_ENABLED' | 'CALENDLY_WEBHOOK_ENABLED';

/** Inbound facts are independent from outbound delivery, but remain explicitly OFF by default. */
export function isInboundCapabilityEnabled(capability: InboundCapabilityFlag): boolean {
  return strictBooleanEnv(capability);
}

export function validateEnv(): { ok: true } | { ok: false; missing: EnvKey[] } {
  const missing = REQUIRED_ENV.filter((key) => !env(key));
  const configuredLeadHashSecret = env('LEAD_HASH_SECRET');
  if (configuredLeadHashSecret && !isValidLeadHashSecret(configuredLeadHashSecret)) {
    missing.push('LEAD_HASH_SECRET');
  }
  const uniqueMissing = [...new Set(missing)];
  return uniqueMissing.length === 0 ? { ok: true } : { ok: false, missing: uniqueMissing };
}

/** The read-only dashboard must not depend on capture or outbound secrets. */
export function validateDashboardEnv(): { ok: true } | { ok: false; missing: EnvKey[] } {
  const missing = DASHBOARD_REQUIRED_ENV.filter((key) => !env(key));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export function assertDashboardEnv(): void {
  const validation = validateDashboardEnv();
  if (!validation.ok) {
    throw new Error(
      `Data Brain missing required dashboard environment variables: ${validation.missing.join(', ')}`,
    );
  }
}

export function assertEnv(): void {
  const validation = validateEnv();
  if (!validation.ok) {
    throw new Error(
      `Data Brain missing or invalid required environment variables: ${validation.missing.join(
        ', ',
      )}`,
    );
  }
}

export function optionalIntegrationStatus(): {
  make: boolean;
  legacyRetry: boolean;
  outboundMaster: boolean;
  airtable: boolean;
  posthog: boolean;
  hubspot: boolean;
} {
  return {
    make: Boolean(
      env('MAKE_WEBHOOK_URL') &&
      isOutboundCapabilityEnabled('LEGACY_MAKE_DELIVERY_ENABLED'),
    ),
    legacyRetry:
      isOutboundCapabilityEnabled('LEGACY_MAKE_DELIVERY_ENABLED') &&
      isOutboundCapabilityEnabled('LEGACY_DELIVERY_RETRY_ENABLED'),
    outboundMaster: strictBooleanEnv('OUTBOUND_MASTER_ENABLED'),
    airtable: Boolean(env('AIRTABLE_API_KEY') && env('AIRTABLE_BASE_ID')),
    posthog: Boolean(env('POSTHOG_PROJECT_API_KEY')),
    hubspot: Boolean(env('HUBSPOT_ACCESS_TOKEN') && isOutboundCapabilityEnabled('HUBSPOT_SYNC_ENABLED')),
  };
}
