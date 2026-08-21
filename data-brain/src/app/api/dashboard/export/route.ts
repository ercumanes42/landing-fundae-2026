import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { basicAuthHeaders } from '@/lib/auth';
import { authenticateDashboardAuthorization, type DashboardAuthResult } from '@/lib/dashboard-auth';
import { normalizeDashboardWindow, parseDashboardIntelligence, type DashboardIntelligenceResponse } from '@/lib/dashboard-data';
import { buildDashboardExport, type DashboardExportArtifact, type DashboardExportFormat } from '@/lib/dashboard-export';
import { env, validateDashboardEnv } from '@/lib/env';
import { limitRequest, type RateLimitResult } from '@/lib/security';
import { callRpc } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
};
const ALLOWED_QUERY = new Set(['format', 'from', 'to', 'campaign', 'email_step', 'variant', 'lot', 'hour', 'company_size', 'tool', 'copy_key']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-z0-9][a-z0-9_.:-]{0,79}$/i;

export interface DashboardExportRouteDependencies {
  validateEnv: () => { ok: true } | { ok: false; missing: unknown[] };
  authenticate: (request: Request) => Promise<DashboardAuthResult>;
  rateLimit: (request: Request) => Promise<RateLimitResult>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  createExport: (data: DashboardIntelligenceResponse, format: DashboardExportFormat) => Promise<DashboardExportArtifact>;
  now: () => Date;
  requestId: () => string;
}

const defaultDependencies: DashboardExportRouteDependencies = {
  validateEnv: validateDashboardEnv,
  authenticate: (request) => authenticateDashboardAuthorization({
    authorization: request.headers.get('authorization'),
    credentialStore: env('DATA_BRAIN_AUTH_CREDENTIALS'),
    pepper: env('DATA_BRAIN_AUTH_PEPPER'),
    legacyEnabled: env('DATA_BRAIN_LEGACY_BASIC_ENABLED'),
  }),
  rateLimit: (request) => limitRequest(request, 'dashboard-export', 6, 60_000, 'fail-closed'),
  rpc: (name, args) => callRpc(name, args, { environmentScope: 'dashboard', timeoutMs: 15_000 }),
  createExport: buildDashboardExport,
  now: () => new Date(),
  requestId: randomUUID,
};

function unauthorizedHeaders(): Headers {
  const headers = new Headers(RESPONSE_HEADERS);
  new Headers(basicAuthHeaders()).forEach((value, key) => headers.set(key, value));
  return headers;
}

function invalidRequest() {
  return NextResponse.json({ ok: false, failure_code: 'invalid_export_request' }, { status: 400, headers: RESPONSE_HEADERS });
}

function parseQuery(request: Request, now: Date): { format: DashboardExportFormat; campaignId: string | null; window: ReturnType<typeof normalizeDashboardWindow> } | null {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) if (!ALLOWED_QUERY.has(key) || params.getAll(key).length !== 1) return null;
  const format = params.get('format');
  if (format !== 'csv' && format !== 'xlsx') return null;
  const campaign = params.get('campaign');
  if (campaign && !UUID.test(campaign)) return null;
  for (const key of ['variant', 'lot', 'company_size', 'tool', 'copy_key']) {
    const value = params.get(key);
    if (value !== null && !TOKEN.test(value)) return null;
  }
  const emailStep = params.get('email_step');
  if (emailStep !== null && !/^[1-5]$/.test(emailStep)) return null;
  const hour = params.get('hour');
  if (hour !== null && (!/^\d{1,2}$/.test(hour) || Number(hour) > 23)) return null;
  for (const key of ['from', 'to']) {
    const value = params.get(key);
    if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  }
  const raw = Object.fromEntries([...params.entries()].filter(([key]) => key !== 'format' && key !== 'campaign'));
  const window = normalizeDashboardWindow(raw, now);
  if (params.get('from') && !window.from.startsWith(params.get('from')!)) return null;
  if (params.get('to') && !window.to.startsWith(params.get('to')!)) return null;
  return { format, campaignId: campaign || null, window };
}

export async function processDashboardExportRequest(
  request: Request,
  dependencies: DashboardExportRouteDependencies = defaultDependencies,
) {
  if (!dependencies.validateEnv().ok) {
    return NextResponse.json({ ok: false, failure_code: 'dashboard_unavailable' }, { status: 503, headers: RESPONSE_HEADERS });
  }
  const auth = await dependencies.authenticate(request);
  if (!auth.ok) {
    const unavailable = auth.reason === 'configuration_error';
    return NextResponse.json(
      { ok: false, failure_code: unavailable ? 'admin_auth_unavailable' : 'unauthorized' },
      { status: unavailable ? 503 : 401, headers: unavailable ? RESPONSE_HEADERS : unauthorizedHeaders() },
    );
  }
  const rate = await dependencies.rateLimit(request);
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, failure_code: rate.reason === 'unavailable' ? 'rate_limit_unavailable' : 'rate_limited' },
      { status: rate.reason === 'unavailable' ? 503 : 429, headers: { ...RESPONSE_HEADERS, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }
  const query = parseQuery(request, dependencies.now());
  if (!query) return invalidRequest();
  const filters = {
    email_step: query.window.filters.emailStep,
    variant: query.window.filters.variant,
    lot: query.window.filters.lot,
    hour: query.window.filters.hour,
    company_size: query.window.filters.companySize,
    tool: query.window.filters.tool,
    copy_key: query.window.filters.copyKey,
  };
  try {
    const intelligence = parseDashboardIntelligence(await dependencies.rpc('dashboard_get_intelligence_v2', {
      p_actor_hash: auth.actorHash,
      p_request_id: `dashboard:export:${dependencies.requestId()}`,
      p_from: query.window.from,
      p_to: query.window.to,
      p_campaign_id: query.campaignId,
      p_filters: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null)),
    }));
    const artifact = await dependencies.createExport(intelligence, query.format);
    const date = dependencies.now().toISOString().slice(0, 10).replace(/-/g, '');
    return new Response(Buffer.from(artifact.body), {
      status: 200,
      headers: {
        ...RESPONSE_HEADERS,
        'Content-Type': artifact.contentType,
        'Content-Disposition': `attachment; filename="fundae-data-brain-${date}.${artifact.extension}"`,
      },
    });
  } catch {
    return NextResponse.json({ ok: false, failure_code: 'export_unavailable' }, { status: 503, headers: RESPONSE_HEADERS });
  }
}

export async function GET(request: Request) {
  return processDashboardExportRequest(request);
}
