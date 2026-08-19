import { createHmac, timingSafeEqual } from 'node:crypto';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/;
const BACKEND_TOKEN_PATTERN = /^u1\.[A-Za-z0-9_-]{43}$/;
const OPT_OUT_MARKER_PATTERN = /<p\b[^>]*\bdata-gfs-opt-out=["']1["'][^>]*>[\s\S]*?<\/p>/i;
const OPT_OUT_URL_PATTERN = /https:\/\/[^\s"'<>]+\/baja\?token=u1\.[A-Za-z0-9_-]{43}/gi;

function validateId(value, label) {
  const normalized = String(value || '').trim();
  if (!ID_PATTERN.test(normalized)) throw new Error(`${label} must be a pseudonymous ID`);
  return normalized;
}

function validateSecret(value) {
  const secret = String(value || '');
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('MAKE_WEBHOOK_SECRET must contain at least 32 bytes');
  }
  if (/change[-_ ]?me|replace|example|placeholder|tu[-_ ]?secret/i.test(secret)) {
    throw new Error('MAKE_WEBHOOK_SECRET cannot be an example or placeholder value');
  }
  return secret;
}

export function buildUnsubscribeLinkRequest({ campaignId, contactId, tokenVersion = 1, expiresAt }) {
  if (!Number.isInteger(tokenVersion) || tokenVersion < 1 || tokenVersion > 100_000) {
    throw new Error('tokenVersion is invalid');
  }
  const payload = {
    campaign_external_id: validateId(campaignId, 'campaignId'),
    contact_id: validateId(contactId, 'contactId'),
    token_version: tokenVersion,
  };
  if (expiresAt) {
    const expiry = new Date(expiresAt);
    if (Number.isNaN(expiry.getTime())) throw new Error('expiresAt is invalid');
    payload.expires_at = expiry.toISOString();
  }
  return payload;
}

export function buildDeliveryAuthorizationRequest({ campaignId, contactId, executionKey }) {
  return {
    campaign_external_id: validateId(campaignId, 'campaignId'),
    contact_id: validateId(contactId, 'contactId'),
    execution_key: validateId(executionKey, 'executionKey'),
  };
}

export function createMakeSignature(rawBody, secret, timestamp) {
  const normalizedTimestamp = String(timestamp || '').trim();
  if (!/^\d{10}$/.test(normalizedTimestamp)) throw new Error('timestamp must be Unix seconds');
  return createHmac('sha256', validateSecret(secret))
    .update(`${normalizedTimestamp}.${String(rawBody)}`)
    .digest('hex');
}

export function verifyMakeSignature(rawBody, secret, timestamp, receivedSignature) {
  const expected = Buffer.from(createMakeSignature(rawBody, secret, timestamp), 'hex');
  const receivedValue = String(receivedSignature || '');
  if (!/^[a-f0-9]{64}$/.test(receivedValue)) return false;
  const received = Buffer.from(receivedValue, 'hex');
  return timingSafeEqual(expected, received);
}

export function validateBackendUnsubscribeUrl(rawValue, expectedOrigin) {
  let url;
  try {
    url = new URL(String(rawValue || '').trim());
  } catch {
    throw new Error('Backend unsubscribe URL is invalid');
  }
  const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocalHttp) throw new Error('Backend unsubscribe URL must use HTTPS');
  if (url.username || url.password || url.hash || url.pathname !== '/baja') {
    throw new Error('Backend unsubscribe URL must be the fixed /baja route');
  }
  const queryKeys = [...url.searchParams.keys()];
  if (queryKeys.length !== 1 || queryKeys[0] !== 'token') {
    throw new Error('Backend unsubscribe URL may contain only the token query');
  }
  if (!BACKEND_TOKEN_PATTERN.test(url.searchParams.get('token') || '')) {
    throw new Error('Backend unsubscribe token is invalid');
  }
  if (expectedOrigin && url.origin !== new URL(expectedOrigin).origin) {
    throw new Error('Backend unsubscribe URL origin is not allowed');
  }
  return url.toString();
}

export function validateUnsubscribeLinkResponse(input, expectedOrigin) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.ok !== true) {
    throw new Error('Backend unsubscribe response is invalid');
  }
  return validateBackendUnsubscribeUrl(input.unsubscribe_url, expectedOrigin);
}

export function injectOptOutFooter(html, unsubscribeUrl = '{{unsubscribe_url}}') {
  const source = String(html || '').trim();
  if (!source) throw new Error('Cannot inject opt-out into an empty email body');
  const target = String(unsubscribeUrl || '').trim();
  if (!(target === '{{unsubscribe_url}}' || target.startsWith('https://') || target.startsWith('http://localhost'))) {
    throw new Error('unsubscribeUrl must be the placeholder or a validated backend URL');
  }
  if (target !== '{{unsubscribe_url}}') validateBackendUnsubscribeUrl(target);

  const footer = `<p data-gfs-opt-out="1" style="margin-top:24px;font-size:12px;line-height:1.5;color:#667085">Este correo forma parte de la campaña informativa FUNDAE de GFS Consulting Group. Si no deseas recibir más comunicaciones, <a href="${target}" style="color:#302b7b;text-decoration:underline">date de baja aquí</a>.</p>`;
  if (OPT_OUT_MARKER_PATTERN.test(source)) return source.replace(OPT_OUT_MARKER_PATTERN, footer);
  const withoutPlaceholder = source.replaceAll('{{unsubscribe_url}}', target);
  const withoutLegacyUrl = withoutPlaceholder.replace(OPT_OUT_URL_PATTERN, target);
  const bodyClose = /<\/body\s*>/i;
  if (bodyClose.test(withoutLegacyUrl)) return withoutLegacyUrl.replace(bodyClose, `${footer}</body>`);
  return `${withoutLegacyUrl}\n${footer}`;
}
