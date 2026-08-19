import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { env } from './env';
import { callRpc } from './supabase';

export type RateLimitFailurePolicy = 'fail-closed' | 'fail-open';
export type RateLimitResult =
  | { allowed: true; degraded?: boolean }
  | { allowed: false; retryAfterSeconds: number; reason: 'limited' | 'unavailable' };

interface RateLimitRpcResult {
  allowed: boolean;
  retry_after_seconds: number;
}

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function allowedOrigins(): string[] {
  return env('LANDING_ALLOWED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function isAllowedLandingOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')?.replace(/\/+$/, '');
  return Boolean(origin && allowedOrigins().includes(origin));
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin')?.replace(/\/+$/, '');
  if (!origin || !allowedOrigins().includes(origin)) {
    return { Vary: 'Origin' };
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Make-Signature, X-Make-Timestamp, X-HubSpot-Signature-V3',
    Vary: 'Origin',
  };
}

export function isStrongSharedSecret(secret: string): boolean {
  return Buffer.byteLength(secret, 'utf8') >= 32 &&
    !/replace|change.?me|placeholder|example|xxxxx/i.test(secret);
}

export function createMakeSignature(rawBody: string, timestamp: string, secret: string): string {
  if (!isStrongSharedSecret(secret)) {
    throw new Error('MAKE_WEBHOOK_SECRET must be a non-placeholder secret of at least 32 bytes');
  }
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifyMakeSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secret: string,
  now = Date.now(),
): boolean {
  if (!signature || !timestamp || !isStrongSharedSecret(secret)) return false;
  if (!/^\d{9,11}$/.test(timestamp)) return false;
  const numericTimestamp = Number(timestamp);
  if (!Number.isSafeInteger(numericTimestamp)) return false;
  const timestampMs = numericTimestamp * 1000;
  if (Math.abs(now - timestampMs) > 5 * 60_000) return false;

  const expected = createMakeSignature(rawBody, timestamp, secret);
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

export function verifySecret(value: string | null, secret: string): boolean {
  if (!value || !secret || value.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(secret));
}

function requestUrlForHubSpot(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');

  const trustForwardingHeaders = Boolean(env('RATE_LIMIT_TRUSTED_IP_HEADER').trim());
  if (trustForwardingHeaders && forwardedHost) url.host = forwardedHost.split(',')[0].trim();
  if (trustForwardingHeaders && forwardedProto) url.protocol = `${forwardedProto.split(',')[0].trim()}:`;

  try {
    return decodeURIComponent(url.toString());
  } catch {
    return url.toString();
  }
}

export function verifyHubSpotSignature(request: Request, rawBody: string): boolean {
  const signature = request.headers.get('x-hubspot-signature-v3');
  const timestamp = request.headers.get('x-hubspot-request-timestamp');
  const secret = env('HUBSPOT_WEBHOOK_SECRET');
  if (!signature || !timestamp || !secret) return false;

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) {
    return false;
  }

  const requestUrl = requestUrlForHubSpot(request);
  const source = `${request.method}${requestUrl}${rawBody}${timestamp}`;
  const expected = createHmac('sha256', secret).update(source).digest('base64');
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function validHeaderName(value: string): boolean {
  return /^[a-z0-9-]{1,64}$/i.test(value);
}

export function rateLimitAddress(request: Request): string {
  const configuredHeader = env('RATE_LIMIT_TRUSTED_IP_HEADER').trim().toLowerCase();
  let raw = '';

  if (configuredHeader && validHeaderName(configuredHeader)) {
    raw = request.headers.get(configuredHeader)?.split(',')[0]?.trim() ?? '';
  } else if (process.env.NODE_ENV !== 'production') {
    raw = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')?.trim()
      || '';
  }

  return isIP(raw) ? raw : 'unattributed';
}

function memoryLimit(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const current = rateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (current.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      reason: 'limited',
    };
  }
  current.count += 1;
  return { allowed: true };
}

export async function limitRequest(
  request: Request,
  scope: string,
  maxRequests: number,
  windowMs: number,
  failurePolicy: RateLimitFailurePolicy,
): Promise<RateLimitResult> {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/i.test(scope) ||
      !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 100_000 ||
      !Number.isSafeInteger(windowMs) || windowMs < 1_000 || windowMs > 86_400_000) {
    throw new Error('Invalid rate limit configuration');
  }

  const address = rateLimitAddress(request);
  const keyHash = createHash('sha256').update(`${scope}\0${address}`).digest('hex');

  if (process.env.NODE_ENV !== 'production') {
    return memoryLimit(keyHash, maxRequests, windowMs);
  }

  try {
    const result = await callRpc<RateLimitRpcResult>('consume_rate_limit', {
      p_key_hash: keyHash,
      p_limit: maxRequests,
      p_window_seconds: Math.ceil(windowMs / 1000),
    });
    if (typeof result?.allowed !== 'boolean' || !Number.isFinite(result.retry_after_seconds)) {
      throw new Error('Invalid rate limit RPC response');
    }
    return result.allowed
      ? { allowed: true }
      : {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(result.retry_after_seconds)),
          reason: 'limited',
        };
  } catch {
    return failurePolicy === 'fail-open'
      ? { allowed: true, degraded: true }
      : { allowed: false, retryAfterSeconds: 60, reason: 'unavailable' };
  }
}
