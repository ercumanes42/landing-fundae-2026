import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSetup, type Environment } from './setup-validation';
const validAuthStore = JSON.stringify({
  version: 1,
  kdf: { name: 'PBKDF2-SHA256', iterations: 600_000 },
  identities: [{
    username: 'admin',
    credentials: [{
      key_id: 'initial',
      salt: Buffer.alloc(16, 1).toString('base64url'),
      digest: Buffer.alloc(32, 2).toString('base64url'),
    }],
  }],
});

const validEnvironment = (overrides: Environment = {}): Environment => ({
  NODE_ENV: 'development',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${'s'.repeat(40)}`,
  LEAD_HASH_SECRET: `lead-${'a'.repeat(40)}`,
  DATA_BRAIN_AUTH_CREDENTIALS: validAuthStore,
  DATA_BRAIN_AUTH_PEPPER: 'auth-' + 'z'.repeat(40),
  DATA_BRAIN_LEGACY_BASIC_ENABLED: 'false',
  DATA_BRAIN_AUTH_MAX_ATTEMPTS: '5',
  DATA_BRAIN_AUTH_WINDOW_SECONDS: '300',
  LANDING_ALLOWED_ORIGINS: 'https://landing.example.com,http://localhost:3001',
  CAMPAIGN_IMPORT_SECRET: `import-${'b'.repeat(40)}`,
  MAKE_WEBHOOK_SECRET: `make-${'c'.repeat(40)}`,
  UNSUBSCRIBE_TOKEN_SECRET: `unsubscribe-${'d'.repeat(40)}`,
  UNSUBSCRIBE_PUBLIC_BASE_URL: 'http://localhost:3005',
  MAILBOX_IDENTITY_HASH: 'e'.repeat(64),
  OUTBOUND_MASTER_ENABLED: 'false',
  LEGACY_MAKE_DELIVERY_ENABLED: 'false',
  LEGACY_DELIVERY_RETRY_ENABLED: 'false',
  TRANSACTIONAL_OUTLOOK_ENABLED: 'false',
  COLD_CAMPAIGN_ENABLED: 'false',
  COLD_CAMPAIGN_PROVISIONING_ENABLED: 'false',
  HUBSPOT_SYNC_ENABLED: 'false',
  OPERATIONAL_OBSERVABILITY_ENABLED: 'false',
  TRANSACTIONAL_PILOT_MODE: 'true',
  TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS: 'f'.repeat(64),
  TRANSACTIONAL_LANDING_ORIGIN: 'https://landing.example.com',
  TRANSACTIONAL_WEBINAR_TITLE: 'Webinar interno de prueba',
  TRANSACTIONAL_WEBINAR_START_AT: '2026-09-01T10:00:00+02:00',
  TRANSACTIONAL_WEBINAR_DURATION_MINUTES: '45',
  TRANSACTIONAL_WEBINAR_TIMEZONE: 'Europe/Madrid',
  TRANSACTIONAL_WEBINAR_ACCESS_NOTE: 'El acceso se comunicara por el canal interno autorizado.',
  ...overrides,
});

test('accepts a complete development configuration without OpenAI', () => {
  const result = validateSetup(validEnvironment());
  assert.equal(result.ready, true);
  assert.equal(result.issues.length, 0);
  assert.equal(result.optionalConfigured.includes('OPENAI_API_KEY'), false);
});

test('requires the anon key only for a legacy service-role JWT', () => {
  const missingAnon = validateSetup(validEnvironment({ SUPABASE_SERVICE_ROLE_KEY: `${'e'.repeat(32)}.${'f'.repeat(32)}.${'g'.repeat(32)}` }));
  assert.equal(missingAnon.ready, false);
  assert.ok(missingAnon.issues.some((issue) => issue.key === 'SUPABASE_ANON_KEY'));
  const withAnon = validateSetup(validEnvironment({
    SUPABASE_SERVICE_ROLE_KEY: `${'e'.repeat(32)}.${'f'.repeat(32)}.${'g'.repeat(32)}`,
    SUPABASE_ANON_KEY: 'public-anon-key',
  }));
  assert.equal(withAnon.ready, true);
});

test('rejects weak, placeholder and repeated critical secrets', () => {
  const shared = `shared-${'q'.repeat(40)}`;
  const result = validateSetup(validEnvironment({
    LEAD_HASH_SECRET: 'short',
    CAMPAIGN_IMPORT_SECRET: 'replace-with-a-long-random-secret',
    MAKE_WEBHOOK_SECRET: shared,
    UNSUBSCRIBE_TOKEN_SECRET: shared,
  }));
  assert.equal(result.ready, false);
  assert.ok(result.issues.some((issue) => issue.key === 'LEAD_HASH_SECRET'));
  assert.ok(result.issues.some((issue) => issue.key === 'CAMPAIGN_IMPORT_SECRET'));
  assert.ok(result.issues.some((issue) => issue.key.includes('MAKE_WEBHOOK_SECRET')));
});

test('rejects malformed auth stores and legacy mode', () => {
  const malformed = validateSetup(validEnvironment({ DATA_BRAIN_AUTH_CREDENTIALS: '{}' }));
  assert.equal(malformed.ready, false);
  assert.ok(malformed.issues.some((issue) => issue.key === 'DATA_BRAIN_AUTH_CREDENTIALS'));
  const legacy = validateSetup(validEnvironment({ DATA_BRAIN_LEGACY_BASIC_ENABLED: 'true' }));
  assert.equal(legacy.ready, false);
  assert.ok(legacy.issues.some((issue) => issue.key === 'DATA_BRAIN_LEGACY_BASIC_ENABLED'));
});

test('allows localhost HTTP only in development', () => {
  assert.equal(validateSetup(validEnvironment()).ready, true);
  const production = validateSetup(validEnvironment({ NODE_ENV: 'production' }));
  assert.equal(production.ready, false);
  assert.ok(production.issues.some((issue) => issue.key === 'UNSUBSCRIBE_PUBLIC_BASE_URL'));
  assert.ok(production.issues.some((issue) => issue.key === 'LANDING_ALLOWED_ORIGINS'));
});

test('production requires a trusted edge-owned rate-limit IP header', () => {
  const missing = validateSetup(validEnvironment({
    NODE_ENV: 'production',
    UNSUBSCRIBE_PUBLIC_BASE_URL: 'https://landing.example.com',
    LANDING_ALLOWED_ORIGINS: 'https://landing.example.com',
    RATE_LIMIT_TRUSTED_IP_HEADER: '',
  }));
  assert.equal(missing.ready, false);
  assert.ok(missing.issues.some((issue) => issue.key === 'RATE_LIMIT_TRUSTED_IP_HEADER'));

  const spoofable = validateSetup(validEnvironment({
    NODE_ENV: 'production',
    UNSUBSCRIBE_PUBLIC_BASE_URL: 'https://landing.example.com',
    LANDING_ALLOWED_ORIGINS: 'https://landing.example.com',
    RATE_LIMIT_TRUSTED_IP_HEADER: 'x-forwarded-for',
  }));
  assert.equal(spoofable.ready, false);

  const trusted = validateSetup(validEnvironment({
    NODE_ENV: 'production',
    UNSUBSCRIBE_PUBLIC_BASE_URL: 'https://landing.example.com',
    LANDING_ALLOWED_ORIGINS: 'https://landing.example.com',
    RATE_LIMIT_TRUSTED_IP_HEADER: 'x-vercel-forwarded-for',
    DATA_BRAIN_AUTH_EDGE_RATE_LIMITED: 'true',
  }));
  assert.equal(trusted.ready, true);
});

test('rejects wildcards, paths and non-local HTTP origins', () => {
  assert.equal(validateSetup(validEnvironment({ LANDING_ALLOWED_ORIGINS: '*' })).ready, false);
  const result = validateSetup(validEnvironment({ LANDING_ALLOWED_ORIGINS: 'https://landing.example.com/path,http://intranet.example.com' }));
  assert.equal(result.ready, false);
  assert.ok(result.issues.filter((issue) => issue.key === 'LANDING_ALLOWED_ORIGINS').length >= 2);
});

test('reports an invalid optional OpenAI key as a warning, not a P0', () => {
  const result = validateSetup(validEnvironment({ OPENAI_API_KEY: 'example-key' }));
  assert.equal(result.ready, true);
  assert.ok(result.issues.some((issue) => issue.key === 'OPENAI_API_KEY' && issue.severity === 'warning'));
});

test('never returns configuration values in issues', () => {
  const sensitiveValue = 'replace-with-a-super-sensitive-secret';
  const result = validateSetup(validEnvironment({ MAKE_WEBHOOK_SECRET: sensitiveValue }));
  assert.equal(JSON.stringify(result.issues).includes(sensitiveValue), false);
});

test('fails closed unless the transactional pilot remains in no-send mode', () => {
  for (const overrides of [
    { OUTBOUND_MASTER_ENABLED: 'true' },
    { LEGACY_MAKE_DELIVERY_ENABLED: 'true' },
    { LEGACY_DELIVERY_RETRY_ENABLED: 'true' },
    { OUTBOUND_MASTER_ENABLED: 'False' },
    { TRANSACTIONAL_OUTLOOK_ENABLED: 'true' },
    { COLD_CAMPAIGN_ENABLED: 'true' },
    { COLD_CAMPAIGN_PROVISIONING_ENABLED: 'true' },
    { HUBSPOT_SYNC_ENABLED: 'true' },
    { HUBSPOT_SYNC_ENABLED: 'False' },
    { OPERATIONAL_OBSERVABILITY_ENABLED: 'true' },
    { OPERATIONAL_OBSERVABILITY_ENABLED: 'False' },
    { TRANSACTIONAL_PILOT_MODE: 'false' },
    { MAKE_WEBHOOK_URL: 'https://hook.example.com/intake' },
  ]) {
    const result = validateSetup(validEnvironment(overrides));
    assert.equal(result.ready, false);
  }
});

test('requires every transactional readiness variable without exposing its value', () => {
  const result = validateSetup(validEnvironment({
    MAILBOX_IDENTITY_HASH: '',
    TRANSACTIONAL_WEBINAR_ACCESS_NOTE: '',
  }));
  assert.equal(result.ready, false);
  assert.ok(result.issues.some((issue) => issue.key === 'MAILBOX_IDENTITY_HASH'));
  assert.ok(result.issues.some((issue) => issue.key === 'TRANSACTIONAL_WEBINAR_ACCESS_NOTE'));
});

test('rejects malformed mailbox and pilot allowlist hashes', () => {
  const duplicateHash = 'a'.repeat(64);
  const result = validateSetup(validEnvironment({
    MAILBOX_IDENTITY_HASH: 'A'.repeat(64),
    TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS: `${duplicateHash},${duplicateHash}`,
  }));
  assert.equal(result.ready, false);
  assert.ok(result.issues.some((issue) => issue.key === 'MAILBOX_IDENTITY_HASH'));
  assert.ok(result.issues.some((issue) => issue.key === 'TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS'));

  const tooMany = validateSetup(validEnvironment({
    TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS: ['1', '2', '3', '4', '5'].map((digit) => digit.repeat(64)).join(','),
  }));
  assert.equal(tooMany.ready, false);
});

test('rejects unsafe transactional origin and invalid webinar metadata', () => {
  const result = validateSetup(validEnvironment({
    TRANSACTIONAL_LANDING_ORIGIN: 'http://localhost:3001/path',
    TRANSACTIONAL_WEBINAR_START_AT: 'not-a-date',
    TRANSACTIONAL_WEBINAR_DURATION_MINUTES: '0',
    TRANSACTIONAL_WEBINAR_TIMEZONE: 'Invalid/Timezone',
  }));
  assert.equal(result.ready, false);
  for (const key of [
    'TRANSACTIONAL_LANDING_ORIGIN',
    'TRANSACTIONAL_WEBINAR_START_AT',
    'TRANSACTIONAL_WEBINAR_DURATION_MINUTES',
    'TRANSACTIONAL_WEBINAR_TIMEZONE',
  ]) {
    assert.ok(result.issues.some((issue) => issue.key === key));
  }
});
