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
  | 'DATA_BRAIN_ALLOWED_IPS'
  | 'MAKE_WEBHOOK_URL'
  | 'AIRTABLE_API_KEY'
  | 'AIRTABLE_BASE_ID'
  | 'POSTHOG_PROJECT_API_KEY'
  | 'NOTIFICATION_WEBHOOK_URL';

const REQUIRED_ENV: EnvKey[] = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LEAD_HASH_SECRET',
  'DATA_BRAIN_ADMIN_USER',
  'DATA_BRAIN_ADMIN_PASSWORD',
];

const DEFAULTS: Partial<Record<EnvKey, string>> = {
  OPENAI_MODEL_SUMMARY: 'gpt-4o-mini',
  OPENAI_MODEL_ANALYST: 'gpt-4o',
};

export function env(key: EnvKey): string {
  return process.env[key] || DEFAULTS[key] || '';
}

export function validateEnv(): { ok: true } | { ok: false; missing: EnvKey[] } {
  const missing = REQUIRED_ENV.filter((key) => !env(key));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export function assertEnv(): void {
  const validation = validateEnv();
  if (!validation.ok) {
    throw new Error(
      `Data Brain missing required environment variables: ${validation.missing.join(
        ', ',
      )}`,
    );
  }
}

export function optionalIntegrationStatus(): { make: boolean; airtable: boolean; posthog: boolean } {
  return {
    make: Boolean(env('MAKE_WEBHOOK_URL')),
    airtable: Boolean(env('AIRTABLE_API_KEY') && env('AIRTABLE_BASE_ID')),
    posthog: Boolean(env('POSTHOG_PROJECT_API_KEY')),
  };
}
