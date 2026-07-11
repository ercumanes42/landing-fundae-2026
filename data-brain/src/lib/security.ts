import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

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
    'Access-Control-Allow-Headers': 'Content-Type, X-Make-Signature, X-HubSpot-Signature-V3',
    Vary: 'Origin',
  };
}

export function verifyHmacSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const normalized = signature.replace(/^sha256=/i, '');

  if (normalized.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(normalized), Buffer.from(expected));
}

export function verifySecret(value: string | null, secret: string): boolean {
  if (!value || !secret || value.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(secret));
}

function requestUrlForHubSpot(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');

  if (forwardedHost) url.host = forwardedHost.split(',')[0].trim();
  if (forwardedProto) url.protocol = `${forwardedProto.split(',')[0].trim()}:`;

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

export function limitRequest(
  request: Request,
  scope: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const address = forwardedFor.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  const key = `${scope}:${address}`;
  const now = Date.now();
  const current = rateLimitStore.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (current.count >= maxRequests) {
    return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
  }

  current.count += 1;
  rateLimitStore.set(key, current);
  return { allowed: true };
}
