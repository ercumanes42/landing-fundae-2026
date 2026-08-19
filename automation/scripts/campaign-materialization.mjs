import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_CONTACTS = 939;
export const EXPECTED_BODIES = EXPECTED_CONTACTS * 5;
export const OPT_OUT_PLACEHOLDER = '{{unsubscribe_url}}';
export const CAMPAIGN_POLICY_VERSION = 'FUNDAE_CUSTOMER_SIMILAR_SERVICES_2026_V1';
export const TECHNICAL_STATUS_FIELDS = [
  'unsubscribe status',
  'opposition status',
  'hard bounce status',
  'suppression status',
  'duplicate status',
];
export const CONTROLLED_COLUMNS = [
  'campaign policy version',
  ...TECHNICAL_STATUS_FIELDS,
  'campaign authorization',
  'eligibility status',
];

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const COPY_MATRIX_PATH = path.resolve(MODULE_DIRECTORY, '../make/fundae_copy_matrix_v1.json');
const POLICY_PATH = path.resolve(MODULE_DIRECTORY, '../make/fundae_campaign_policy_v1.json');
const ALLOWED_PLACEHOLDERS = new Set([
  'first_name',
  'company_name',
  'resource_url',
  'calendly_url',
  'webinar_date',
  'webinar_time',
  'unsubscribe_url',
]);
const REQUIRED_STOP_RULES = [
  'reply_human',
  'unsubscribe',
  'opposition',
  'hard_bounce',
  'marketing_or_global_suppression',
  'duplicate_contact',
  'calendly_meeting',
];

export function normalizeCampaignHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function readCampaignPolicy() {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  if (policy.policy_version !== CAMPAIGN_POLICY_VERSION) {
    throw new Error('Campaign policy version does not match the implementation');
  }
  if (policy.scope?.individual_legal_evidence_gate_required !== false || policy.scope?.new_consent_gate_required !== false) {
    throw new Error('Campaign policy reintroduced an unapproved individual evidence or consent gate');
  }
  for (const rule of REQUIRED_STOP_RULES) {
    if (policy.stop_rules?.[rule] !== true) throw new Error(`Campaign policy is missing stop rule: ${rule}`);
  }
  if (Object.values(policy.switches || {}).some((enabled) => enabled !== false)) {
    throw new Error('Campaign policy switches must remain false in the controlled copy');
  }
  return policy;
}

export function readCopyMatrix() {
  const matrix = JSON.parse(fs.readFileSync(COPY_MATRIX_PATH, 'utf8'));
  if (!Array.isArray(matrix.variants) || matrix.variants.length !== 4) {
    throw new Error('Copy matrix must contain four variants');
  }
  for (const variant of matrix.variants) {
    if (!Array.isArray(variant.emails) || variant.emails.length !== 5) {
      throw new Error(`Copy matrix variant ${variant.name || '(unknown)'} must contain five emails`);
    }
    for (const email of variant.emails) {
      const placeholders = `${email.subject}\n${email.body}`.match(/\{\{([a-z_]+)\}\}/g) || [];
      for (const placeholder of placeholders) {
        const name = placeholder.slice(2, -2);
        if (!ALLOWED_PLACEHOLDERS.has(name)) throw new Error(`Unsupported copy placeholder: ${placeholder}`);
      }
      if (!email.body.includes(OPT_OUT_PLACEHOLDER) || !email.body.includes(matrix.sender_name)) {
        throw new Error(`Copy matrix variant ${variant.name} step ${email.step} lacks identity or unsubscribe`);
      }
    }
  }
  return matrix;
}

function safeInline(value, fallback, maxLength) {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return fallback;
  if (normalized.includes('{{') || normalized.includes('}}')) throw new Error('Personalization value contains template syntax');
  return normalized.slice(0, maxLength);
}

function safeCampaignUrl(value, contactId) {
  const raw = String(value || '').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Campaign personalization URL is invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Campaign personalization URL must be credential-free HTTPS');
  }
  if (url.searchParams.get('cid') !== contactId) throw new Error('Campaign URL cid does not match the contact');
  return url.toString();
}

function interpolateCopy(template, values) {
  return String(template).replace(/\{\{([a-z_]+)\}\}/g, (placeholder, name) => {
    if (name === 'unsubscribe_url') return OPT_OUT_PLACEHOLDER;
    if (!(name in values)) throw new Error(`Missing personalization value for ${placeholder}`);
    return values[name];
  });
}

export function materializeCampaignCopies(row, getText, matrix = readCopyMatrix()) {
  const variantName = getText(row, 'variante nombre');
  const variant = matrix.variants.find((item) => item.name === variantName);
  if (!variant) throw new Error(`Copy matrix has no variant named ${variantName || '(empty)'}`);
  const contactId = getText(row, 'contact id');
  const values = {
    first_name: safeInline(getText(row, 'nombre'), 'equipo', 80),
    company_name: safeInline(getText(row, 'organizacion'), 'tu empresa', 160),
    resource_url: safeCampaignUrl(getText(row, 'enlace recurso utm'), contactId),
    calendly_url: safeCampaignUrl(getText(row, 'enlace calendly utm'), contactId),
    webinar_date: '01/10/2026',
    webinar_time: '12:00 h',
  };
  return variant.emails.map((email) => {
    const subject = interpolateCopy(email.subject, values);
    const body = interpolateCopy(email.body, values);
    if (/\{\{(?!unsubscribe_url\}\})/.test(`${subject}\n${body}`)) throw new Error('Copy contains an unresolved placeholder');
    if (subject.includes('\r') || subject.includes('\n')) throw new Error('Materialized subject contains a line break');
    if ((body.match(/\{\{unsubscribe_url\}\}/g) || []).length !== 1) throw new Error('Materialized body must contain exactly one unsubscribe placeholder');
    if (!body.includes(matrix.sender_name)) throw new Error('Materialized body lacks sender identification');
    return { step: email.step, subject, body };
  });
}

export function controlledFieldDefaults() {
  return {
    'campaign policy version': CAMPAIGN_POLICY_VERSION,
    'unsubscribe status': 'PENDING_RECHECK',
    'opposition status': 'PENDING_RECHECK',
    'hard bounce status': 'PENDING_RECHECK',
    'suppression status': 'PENDING_RECHECK',
    'duplicate status': 'CLEAR',
    'campaign authorization': 'PENDING',
    'eligibility status': 'PENDING_TECHNICAL_GATES',
  };
}

export function logicalDatasetHash(rows, getText) {
  const canonicalDay = (value) => {
    const raw = String(value || '').trim();
    const excelSerial = /^\d{4,5}(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
    const date = excelSerial !== null
      ? new Date(Date.UTC(1899, 11, 30) + Math.floor(excelSerial) * 86_400_000)
      : new Date(raw);
    if (Number.isNaN(date.getTime())) throw new Error('Dataset hash encountered an invalid campaign date');
    return date.toISOString().slice(0, 10);
  };
  const canonical = rows
    .map((row) => ({
      contactId: getText(row, 'contact id'),
      accountId: getText(row, 'account id'),
      emailHash: createHash('sha256').update(getText(row, 'correo electronico').toLowerCase()).digest('hex'),
      variant: getText(row, 'variante nombre'),
      lot: getText(row, 'lote envio'),
      dates: [1, 2, 3, 4, 5].map((step) => canonicalDay(getText(row, `fecha email ${step}`))),
      copies: [1, 2, 3, 4, 5].flatMap((step) => [
        getText(row, `email${step} asunto`),
        getText(row, `email${step} cuerpo html`),
      ]),
    }))
    .sort((left, right) => left.contactId.localeCompare(right.contactId));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
