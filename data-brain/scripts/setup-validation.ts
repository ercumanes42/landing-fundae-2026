import { parseDashboardCredentialStore } from '../src/lib/dashboard-auth';
import { isValidLeadHashSecret } from '../src/lib/env';

export type Environment = Record<string, string | undefined>;

export interface SetupIssue {
  severity: 'p0' | 'warning';
  key: string;
  message: string;
}

export interface SetupValidationResult {
  ready: boolean;
  production: boolean;
  checkedKeys: string[];
  optionalConfigured: string[];
  issues: SetupIssue[];
}

const CORE_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LEAD_HASH_SECRET',
  'DATA_BRAIN_AUTH_CREDENTIALS',
  'DATA_BRAIN_AUTH_PEPPER',
  'DATA_BRAIN_LEGACY_BASIC_ENABLED',
  'LANDING_ALLOWED_ORIGINS',
  'CAMPAIGN_IMPORT_SECRET',
  'MAKE_WEBHOOK_SECRET',
  'UNSUBSCRIBE_TOKEN_SECRET',
  'UNSUBSCRIBE_PUBLIC_BASE_URL',
  'MAILBOX_IDENTITY_HASH',
  'OUTBOUND_MASTER_ENABLED',
  'LEGACY_MAKE_DELIVERY_ENABLED',
  'LEGACY_DELIVERY_RETRY_ENABLED',
  'TRANSACTIONAL_OUTLOOK_ENABLED',
  'COLD_CAMPAIGN_ENABLED',
  'COLD_CAMPAIGN_PROVISIONING_ENABLED',
  'HUBSPOT_SYNC_ENABLED',
  'OPERATIONAL_OBSERVABILITY_ENABLED',
  'TRANSACTIONAL_PILOT_MODE',
  'TRANSACTIONAL_GRAPH_PILOT_LIVE_ENABLED',
  'TRANSACTIONAL_GRAPH_PILOT_TTL_SECONDS',
  'TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS',
  'TRANSACTIONAL_LANDING_ORIGIN',
  'TRANSACTIONAL_WEBINAR_TITLE',
  'TRANSACTIONAL_WEBINAR_START_AT',
  'TRANSACTIONAL_WEBINAR_DURATION_MINUTES',
  'TRANSACTIONAL_WEBINAR_TIMEZONE',
  'TRANSACTIONAL_WEBINAR_ACCESS_NOTE',
] as const;

const STRONG_SECRET_KEYS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'LEAD_HASH_SECRET',
  'DATA_BRAIN_AUTH_PEPPER',
  'CAMPAIGN_IMPORT_SECRET',
  'MAKE_WEBHOOK_SECRET',
  'UNSUBSCRIBE_TOKEN_SECRET',
] as const;

const OPTIONAL_KEYS = [
  'OPENAI_API_KEY',
  'AIRTABLE_API_KEY',
  'AIRTABLE_BASE_ID',
  'POSTHOG_PROJECT_API_KEY',
  'NOTIFICATION_WEBHOOK_URL',
  'HUBSPOT_WEBHOOK_SECRET',
  'HUBSPOT_ACCESS_TOKEN',
  'HUBSPOT_PORTAL_ID',
] as const;

const PLACEHOLDER_PATTERN = /(?:replace[-_ ]?with|change[-_ ]?me|changeme|placeholder|example|xxxxx|your[-_ ]?(?:key|secret|password)|tu[-_ ]?(?:clave|secreto)|secret[-_ ]?here|^todo$)/i;
const SECURE_RATE_LIMIT_HEADERS = new Set([
  'x-vercel-forwarded-for',
  'cf-connecting-ip',
]);

function valueOf(environment: Environment, key: string): string {
  return environment[key]?.trim() ?? '';
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value);
}

function isLocalHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname.toLowerCase());
}

function validateHttpUrl(value: string, key: string, production: boolean, issues: SetupIssue[], originOnly = false): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    issues.push({ severity: 'p0', key, message: `${key} no es una URL valida.` });
    return;
  }

  if (parsed.username || parsed.password) {
    issues.push({ severity: 'p0', key, message: `${key} no puede incluir credenciales.` });
  }

  const localDevelopmentHttp = !production && parsed.protocol === 'http:' && isLocalHostname(parsed.hostname);
  if (parsed.protocol !== 'https:' && !localDevelopmentHttp) {
    issues.push({
      severity: 'p0',
      key,
      message: production
        ? `${key} debe usar HTTPS en produccion.`
        : `${key} debe usar HTTPS; HTTP solo se permite para localhost en desarrollo.`,
    });
  }

  if (originOnly && (parsed.pathname !== '/' || parsed.search || parsed.hash)) {
    issues.push({ severity: 'p0', key, message: `${key} debe contener solo un origen, sin ruta, query ni fragmento.` });
  }
}

function validateAllowedOrigins(rawOrigins: string, production: boolean, issues: SetupIssue[]): void {
  const origins = rawOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) {
    issues.push({ severity: 'p0', key: 'LANDING_ALLOWED_ORIGINS', message: 'LANDING_ALLOWED_ORIGINS no contiene origenes.' });
    return;
  }

  for (const origin of origins) {
    if (origin.includes('*')) {
      issues.push({ severity: 'p0', key: 'LANDING_ALLOWED_ORIGINS', message: 'LANDING_ALLOWED_ORIGINS no admite comodines.' });
      continue;
    }
    validateHttpUrl(origin, 'LANDING_ALLOWED_ORIGINS', production, issues, true);
  }
}

function validateOptionalConfiguration(environment: Environment, issues: SetupIssue[]): string[] {
  const configured = OPTIONAL_KEYS.filter((key) => Boolean(valueOf(environment, key)));
  const openAiKey = valueOf(environment, 'OPENAI_API_KEY');
  if (openAiKey && (openAiKey.length < 20 || isPlaceholder(openAiKey))) {
    issues.push({ severity: 'warning', key: 'OPENAI_API_KEY', message: 'OPENAI_API_KEY esta configurada, pero parece invalida.' });
  }

  const airtableKey = valueOf(environment, 'AIRTABLE_API_KEY');
  const airtableBase = valueOf(environment, 'AIRTABLE_BASE_ID');
  if (Boolean(airtableKey) !== Boolean(airtableBase)) {
    issues.push({ severity: 'warning', key: 'AIRTABLE', message: 'Airtable requiere AIRTABLE_API_KEY y AIRTABLE_BASE_ID juntos.' });
  }

  return configured;
}

function validateTransactionalNoSendConfiguration(environment: Environment, issues: SetupIssue[]): void {
  const coldEnabled = valueOf(environment, 'COLD_CAMPAIGN_ENABLED');
  if (coldEnabled !== 'false') issues.push({ severity: 'p0', key: 'COLD_CAMPAIGN_ENABLED', message: 'COLD_CAMPAIGN_ENABLED debe permanecer exactamente false durante no-send.' });
  const mailboxIdentityHash = valueOf(environment, 'MAILBOX_IDENTITY_HASH');
  if (mailboxIdentityHash && !/^[a-f0-9]{64}$/.test(mailboxIdentityHash)) {
    issues.push({
      severity: 'p0',
      key: 'MAILBOX_IDENTITY_HASH',
      message: 'MAILBOX_IDENTITY_HASH debe ser un SHA-256 hexadecimal minusculo de 64 caracteres.',
    });
  }

  if (valueOf(environment, 'TRANSACTIONAL_OUTLOOK_ENABLED') !== 'false') {
    issues.push({
      severity: 'p0',
      key: 'TRANSACTIONAL_OUTLOOK_ENABLED',
      message: 'TRANSACTIONAL_OUTLOOK_ENABLED debe ser exactamente false durante la verificacion no-send.',
    });
  }
  for (const key of [
    'OUTBOUND_MASTER_ENABLED',
    'COLD_CAMPAIGN_PROVISIONING_ENABLED',
    'LEGACY_MAKE_DELIVERY_ENABLED',
    'LEGACY_DELIVERY_RETRY_ENABLED',
    'HUBSPOT_SYNC_ENABLED',
    'OPERATIONAL_OBSERVABILITY_ENABLED',
    'TRANSACTIONAL_GRAPH_PILOT_LIVE_ENABLED',
  ] as const) {
    if (valueOf(environment, key) !== 'false') {
      issues.push({
        severity: 'p0',
        key,
        message: `${key} debe ser exactamente false durante la verificacion no-send.`,
      });
    }
  }
  if (valueOf(environment, 'TRANSACTIONAL_PILOT_MODE') !== 'true') {
    issues.push({
      severity: 'p0',
      key: 'TRANSACTIONAL_PILOT_MODE',
      message: 'TRANSACTIONAL_PILOT_MODE debe ser exactamente true durante el piloto.',
    });
  }
  const pilotTtl = Number(valueOf(environment, 'TRANSACTIONAL_GRAPH_PILOT_TTL_SECONDS'));
  if (!Number.isSafeInteger(pilotTtl) || pilotTtl < 120 || pilotTtl > 900) {
    issues.push({
      severity: 'p0',
      key: 'TRANSACTIONAL_GRAPH_PILOT_TTL_SECONDS',
      message: 'TRANSACTIONAL_GRAPH_PILOT_TTL_SECONDS debe ser un entero entre 120 y 900.',
    });
  }
  if (valueOf(environment, 'MAKE_WEBHOOK_URL')) {
    issues.push({
      severity: 'p0',
      key: 'MAKE_WEBHOOK_URL',
      message: 'MAKE_WEBHOOK_URL debe permanecer ausente durante la verificacion no-send.',
    });
  }

  const allowlistValue = valueOf(environment, 'TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS');
  if (allowlistValue) {
    const allowlist = allowlistValue.split(',').map((value) => value.trim()).filter(Boolean);
    const uniqueAllowlist = new Set(allowlist);
    if (
      allowlist.length < 1
      || allowlist.length > 4
      || uniqueAllowlist.size !== allowlist.length
      || allowlist.some((value) => !/^[a-f0-9]{64}$/.test(value))
    ) {
      issues.push({
        severity: 'p0',
        key: 'TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS',
        message: 'TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS debe contener entre 1 y 4 hashes SHA-256 minusculos y unicos.',
      });
    }
  }

  const landingOrigin = valueOf(environment, 'TRANSACTIONAL_LANDING_ORIGIN');
  if (landingOrigin) validateHttpUrl(landingOrigin, 'TRANSACTIONAL_LANDING_ORIGIN', true, issues, true);

  const webinarTitle = valueOf(environment, 'TRANSACTIONAL_WEBINAR_TITLE');
  if (webinarTitle && webinarTitle.length > 200) {
    issues.push({ severity: 'p0', key: 'TRANSACTIONAL_WEBINAR_TITLE', message: 'TRANSACTIONAL_WEBINAR_TITLE supera 200 caracteres.' });
  }

  const webinarStart = valueOf(environment, 'TRANSACTIONAL_WEBINAR_START_AT');
  if (webinarStart && (webinarStart.length > 64 || !Number.isFinite(Date.parse(webinarStart)))) {
    issues.push({ severity: 'p0', key: 'TRANSACTIONAL_WEBINAR_START_AT', message: 'TRANSACTIONAL_WEBINAR_START_AT debe ser una fecha ISO valida.' });
  }

  const webinarDuration = valueOf(environment, 'TRANSACTIONAL_WEBINAR_DURATION_MINUTES');
  if (webinarDuration) {
    const parsedDuration = Number(webinarDuration);
    if (!Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 480) {
      issues.push({
        severity: 'p0',
        key: 'TRANSACTIONAL_WEBINAR_DURATION_MINUTES',
        message: 'TRANSACTIONAL_WEBINAR_DURATION_MINUTES debe ser un entero entre 1 y 480.',
      });
    }
  }

  const webinarTimezone = valueOf(environment, 'TRANSACTIONAL_WEBINAR_TIMEZONE');
  if (webinarTimezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: webinarTimezone }).format();
    } catch {
      issues.push({ severity: 'p0', key: 'TRANSACTIONAL_WEBINAR_TIMEZONE', message: 'TRANSACTIONAL_WEBINAR_TIMEZONE debe ser una zona IANA valida.' });
    }
  }

  const webinarAccessNote = valueOf(environment, 'TRANSACTIONAL_WEBINAR_ACCESS_NOTE');
  if (webinarAccessNote && webinarAccessNote.length > 300) {
    issues.push({ severity: 'p0', key: 'TRANSACTIONAL_WEBINAR_ACCESS_NOTE', message: 'TRANSACTIONAL_WEBINAR_ACCESS_NOTE supera 300 caracteres.' });
  }
}

export function validateSetup(environment: Environment): SetupValidationResult {
  const issues: SetupIssue[] = [];
  const production = valueOf(environment, 'NODE_ENV') === 'production' || valueOf(environment, 'VERCEL_ENV') === 'production';
  const checkedKeys = [...CORE_KEYS] as string[];

  if (production) {
    checkedKeys.push('RATE_LIMIT_TRUSTED_IP_HEADER', 'DATA_BRAIN_AUTH_EDGE_RATE_LIMITED');
    if (valueOf(environment, 'DATA_BRAIN_AUTH_EDGE_RATE_LIMITED') !== 'true') {
      issues.push({ severity: 'p0', key: 'DATA_BRAIN_AUTH_EDGE_RATE_LIMITED', message: 'Produccion exige rate limiting distribuido en el edge; el limiter en memoria es solo defensa auxiliar.' });
    }
    const trustedIpHeader = valueOf(environment, 'RATE_LIMIT_TRUSTED_IP_HEADER').toLowerCase();
    if (!SECURE_RATE_LIMIT_HEADERS.has(trustedIpHeader)) {
      issues.push({
        severity: 'p0',
        key: 'RATE_LIMIT_TRUSTED_IP_HEADER',
        message: 'RATE_LIMIT_TRUSTED_IP_HEADER debe identificar una cabecera sobrescrita por el edge confiable en produccion.',
      });
    }
  }

  for (const key of CORE_KEYS) {
    if (!valueOf(environment, key)) {
      issues.push({ severity: 'p0', key, message: `Falta la variable obligatoria ${key}.` });
    }
  }

  const serviceRole = valueOf(environment, 'SUPABASE_SERVICE_ROLE_KEY');
  if (serviceRole && !serviceRole.startsWith('sb_secret_')) {
    checkedKeys.push('SUPABASE_ANON_KEY');
    if (!valueOf(environment, 'SUPABASE_ANON_KEY')) {
      issues.push({
        severity: 'p0',
        key: 'SUPABASE_ANON_KEY',
        message: 'SUPABASE_ANON_KEY es obligatoria cuando SUPABASE_SERVICE_ROLE_KEY usa el formato JWT heredado.',
      });
    }
  }

  for (const key of STRONG_SECRET_KEYS) {
    const secret = valueOf(environment, key);
    if (!secret) continue;
    const invalid = key === 'LEAD_HASH_SECRET'
      ? !isValidLeadHashSecret(environment[key] ?? '')
      : Buffer.byteLength(secret, 'utf8') < 32 || isPlaceholder(secret);
    if (invalid) {
      issues.push({ severity: 'p0', key, message: `${key} debe ser un secreto no-placeholder de al menos 32 bytes.` });
    }
  }

  const configuredSecrets = STRONG_SECRET_KEYS
    .map((key) => ({ key, value: valueOf(environment, key) }))
    .filter(({ value }) => Boolean(value));
  for (let left = 0; left < configuredSecrets.length; left += 1) {
    for (let right = left + 1; right < configuredSecrets.length; right += 1) {
      if (configuredSecrets[left].value === configuredSecrets[right].value) {
        issues.push({
          severity: 'p0',
          key: `${configuredSecrets[left].key},${configuredSecrets[right].key}`,
          message: `${configuredSecrets[left].key} y ${configuredSecrets[right].key} deben ser distintos.`,
        });
      }
    }
  }

  const legacyBasic = valueOf(environment, 'DATA_BRAIN_LEGACY_BASIC_ENABLED');
  if (legacyBasic !== 'false') {
    issues.push({ severity: 'p0', key: 'DATA_BRAIN_LEGACY_BASIC_ENABLED', message: 'DATA_BRAIN_LEGACY_BASIC_ENABLED debe ser exactamente false; el modo heredado esta obsoleto.' });
  }
  try {
    parseDashboardCredentialStore(valueOf(environment, 'DATA_BRAIN_AUTH_CREDENTIALS'));
  } catch {
    issues.push({ severity: 'p0', key: 'DATA_BRAIN_AUTH_CREDENTIALS', message: 'DATA_BRAIN_AUTH_CREDENTIALS no cumple el contrato v1 o no contiene una identidad activa.' });
  }
  for (const [key, fallback, min, max] of [
    ['DATA_BRAIN_AUTH_MAX_ATTEMPTS', 5, 3, 20],
    ['DATA_BRAIN_AUTH_WINDOW_SECONDS', 300, 30, 3600],
  ] as const) {
    const raw = valueOf(environment, key) || String(fallback);
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      issues.push({ severity: 'p0', key, message: `${key} debe ser un entero entre ${min} y ${max}.` });
    }
  }
  const supabaseUrl = valueOf(environment, 'SUPABASE_URL');
  if (supabaseUrl) validateHttpUrl(supabaseUrl, 'SUPABASE_URL', production, issues, true);
  const unsubscribeUrl = valueOf(environment, 'UNSUBSCRIBE_PUBLIC_BASE_URL');
  if (unsubscribeUrl) validateHttpUrl(unsubscribeUrl, 'UNSUBSCRIBE_PUBLIC_BASE_URL', production, issues, true);
  const origins = valueOf(environment, 'LANDING_ALLOWED_ORIGINS');
  if (origins) validateAllowedOrigins(origins, production, issues);

  validateTransactionalNoSendConfiguration(environment, issues);

  for (const key of ['MAKE_WEBHOOK_URL', 'NOTIFICATION_WEBHOOK_URL'] as const) {
    const optionalUrl = valueOf(environment, key);
    if (optionalUrl) validateHttpUrl(optionalUrl, key, production, issues);
  }

  const optionalConfigured = validateOptionalConfiguration(environment, issues);
  return {
    ready: !issues.some((issue) => issue.severity === 'p0'),
    production,
    checkedKeys: [...new Set(checkedKeys)],
    optionalConfigured,
    issues,
  };
}
