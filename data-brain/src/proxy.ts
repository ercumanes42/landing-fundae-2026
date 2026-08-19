import { NextRequest, NextResponse } from 'next/server';

import {
  AuthAttemptLimiter,
  authenticateDashboardAuthorization,
  dashboardAuthAudit,
} from './lib/dashboard-auth';

const PUBLIC_PATHS = new Set([
  '/api/leads/ingest', '/api/events/ingest', '/api/events/ingest/batch',
  '/api/campaign/events', '/api/campaign/operations', '/api/campaign/delivery-authorization',
  '/api/campaign/tracking', '/api/campaign/unsubscribe-link',
  '/api/transactional/intake-authorization', '/api/transactional/prepare',
  '/api/transactional/delivery-package', '/api/transactional/mailbox-reserve',
  '/api/transactional/interactive-checklist/pdf', '/api/transactional/checklist/pdf',
  '/api/transactional/email-callback', '/api/webhooks/hubspot', '/api/webhooks/calendly', '/baja',
]);

const INTERNAL_MACHINE_PATHS = new Set([
  '/api/internal/graph/transactional',
  '/api/internal/graph/dispatch',
  '/api/internal/graph/campaign-dispatch',
  '/api/internal/inbound/mailbox',
  '/api/internal/observability',
]);

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

const limiter = new AuthAttemptLimiter(
  boundedInteger(process.env.DATA_BRAIN_AUTH_MAX_ATTEMPTS, 5, 3, 20),
  boundedInteger(process.env.DATA_BRAIN_AUTH_WINDOW_SECONDS, 300, 30, 3_600) * 1_000,
);

function bypassesDashboardAuth(pathname: string): boolean {
  return pathname.startsWith('/_next') || pathname === '/favicon.ico' ||
    PUBLIC_PATHS.has(pathname) || INTERNAL_MACHINE_PATHS.has(pathname);
}

function trustedClientIp(request: NextRequest): string {
  const configured = (process.env.RATE_LIMIT_TRUSTED_IP_HEADER ?? '').trim().toLowerCase();
  const header = /^[a-z0-9-]{1,64}$/.test(configured) ? configured : '';
  if (header) return request.headers.get(header)?.split(',')[0]?.trim() || 'unknown';
  if (process.env.NODE_ENV !== 'production') {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') || 'development';
  }
  return 'unknown';
}

function ipIsAllowed(request: NextRequest): boolean {
  const allowed = (process.env.DATA_BRAIN_ALLOWED_IPS ?? '').split(',').map((ip) => ip.trim()).filter(Boolean);
  return allowed.length === 0 || allowed.includes(trustedClientIp(request));
}

function unauthorized(rateLimited = false): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Data Brain"',
      'Cache-Control': 'no-store',
      ...(rateLimited ? { 'Retry-After': String(boundedInteger(process.env.DATA_BRAIN_AUTH_WINDOW_SECONDS, 300, 30, 3_600)) } : {}),
    },
  });
}

export async function proxy(request: NextRequest) {
  if (bypassesDashboardAuth(request.nextUrl.pathname)) return NextResponse.next();
  if (!ipIsAllowed(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const clientKey = trustedClientIp(request);
  if (!limiter.isAllowed(clientKey)) {
    dashboardAuthAudit({ ok: false, reason: 'invalid_credentials' });
    return unauthorized(true);
  }

  const result = await authenticateDashboardAuthorization({
    authorization: request.headers.get('authorization'),
    credentialStore: process.env.DATA_BRAIN_AUTH_CREDENTIALS ?? '',
    pepper: process.env.DATA_BRAIN_AUTH_PEPPER ?? '',
    legacyEnabled: process.env.DATA_BRAIN_LEGACY_BASIC_ENABLED ?? 'false',
  });
  dashboardAuthAudit(result);
  if (!result.ok) {
    limiter.recordFailure(clientKey);
    return unauthorized();
  }
  limiter.recordSuccess(clientKey);
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
