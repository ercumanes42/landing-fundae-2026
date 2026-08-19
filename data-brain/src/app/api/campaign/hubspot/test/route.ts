import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { authenticateBasicRequest, basicAuthHeaders } from '@/lib/auth';
import type { DashboardAuthResult } from '@/lib/dashboard-auth';
import { parseDashboardSummary } from '@/lib/dashboard-data';
import { testHubSpotConnection, type HubSpotPreflightReport } from '@/lib/hubspot';
import { limitRequest, type RateLimitResult } from '@/lib/security';
import { callRpc } from '@/lib/supabase';

export const runtime = 'nodejs';

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Authorization',
};

export interface HubSpotPreflightRouteDependencies {
  authenticate: (request: Request) => Promise<DashboardAuthResult>;
  authorizeAdmin: (actorHash: string) => Promise<
    { ok: true } | { ok: false; reason: 'forbidden' | 'unavailable' }
  >;
  rateLimit: (request: Request) => Promise<RateLimitResult>;
  preflight: () => Promise<HubSpotPreflightReport>;
}

type DashboardRoleRpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export async function authorizeCanonicalDashboardAdmin(
  actorHash: string,
  rpc: DashboardRoleRpc = (name, args) => callRpc(name, args),
  now = new Date(),
  requestIdentifier: string = randomUUID(),
): Promise<
  { ok: true } | { ok: false; reason: 'forbidden' | 'unavailable' }
> {
  try {
    const summary = parseDashboardSummary(await rpc('dashboard_get_summary', {
      p_actor_hash: actorHash,
      p_request_id: `hubspot-preflight-admin:${requestIdentifier}`,
      p_from: new Date(now.getTime() - 60_000).toISOString(),
      p_to: now.toISOString(),
      p_campaign_id: null,
    }));
    return summary.meta.role === 'admin'
      ? { ok: true }
      : { ok: false, reason: 'forbidden' };
  } catch (error) {
    return error instanceof Error && error.message === 'dashboard_access_denied'
      ? { ok: false, reason: 'forbidden' }
      : { ok: false, reason: 'unavailable' };
  }
}

const defaultDependencies: HubSpotPreflightRouteDependencies = {
  authenticate: authenticateBasicRequest,
  authorizeAdmin: authorizeCanonicalDashboardAdmin,
  rateLimit: (request) => limitRequest(request, 'hubspot-preflight', 5, 60_000, 'fail-closed'),
  preflight: testHubSpotConnection,
};

function unauthorizedHeaders(): Headers {
  const headers = new Headers(RESPONSE_HEADERS);
  new Headers(basicAuthHeaders()).forEach((value, key) => headers.set(key, value));
  return headers;
}

export async function processHubSpotPreflightRequest(
  request: Request,
  dependencies: HubSpotPreflightRouteDependencies = defaultDependencies,
) {
  const auth = await dependencies.authenticate(request);
  if (!auth.ok) {
    const unavailable = auth.reason === 'configuration_error';
    return NextResponse.json(
      {
        ok: false,
        failure_code: unavailable ? 'admin_auth_unavailable' : 'unauthorized',
      },
      {
        status: unavailable ? 503 : 401,
        headers: unavailable ? RESPONSE_HEADERS : unauthorizedHeaders(),
      },
    );
  }

  const rate = await dependencies.rateLimit(request);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        ok: false,
        failure_code: rate.reason === 'unavailable' ? 'rate_limit_unavailable' : 'rate_limited',
      },
      {
        status: rate.reason === 'unavailable' ? 503 : 429,
        headers: { ...RESPONSE_HEADERS, 'Retry-After': String(rate.retryAfterSeconds) },
      },
    );
  }

  const admin = await dependencies.authorizeAdmin(auth.actorHash);
  if (!admin.ok) {
    return NextResponse.json(
      {
        ok: false,
        failure_code: admin.reason === 'unavailable' ? 'admin_authorization_unavailable' : 'forbidden',
      },
      {
        status: admin.reason === 'unavailable' ? 503 : 403,
        headers: RESPONSE_HEADERS,
      },
    );
  }

  try {
    const report = await dependencies.preflight();
    return NextResponse.json(report, {
      status: report.ok ? 200 : 503,
      headers: RESPONSE_HEADERS,
    });
  } catch {
    return NextResponse.json(
      { ok: false, mode: 'read_only', failure_code: 'preflight_unavailable' },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }
}

export async function GET(request: Request) {
  return processHubSpotPreflightRequest(request);
}
