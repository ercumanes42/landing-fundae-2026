import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { basicAuthHeaders } from '@/lib/auth';
import { authenticateDashboardAuthorization, type DashboardAuthResult } from '@/lib/dashboard-auth';
import { env, validateDashboardEnv } from '@/lib/env';
import { limitRequest, type RateLimitResult } from '@/lib/security';
import { callRpc } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const STAGES = new Set(['interested', 'qualified', 'meeting', 'opportunity', 'won', 'lost']);
const ALLOWED_KEYS = new Set([
  'campaign_id', 'campaign_contact_id', 'stage', 'estimated_amount', 'closed_amount',
  'probability_percent', 'expected_close_on', 'outcome_reason',
  'source_execution_id', 'source_tool', 'expected_version',
]);

type Payload = Record<string, unknown>;
export interface PipelineRouteDependencies {
  validateEnv: () => { ok: true } | { ok: false; missing: unknown[] };
  authenticate: (request: Request) => Promise<DashboardAuthResult>;
  rateLimit: (request: Request) => Promise<RateLimitResult>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  requestId: () => string;
}

const defaults: PipelineRouteDependencies = {
  validateEnv: validateDashboardEnv,
  authenticate: (request) => authenticateDashboardAuthorization({
    authorization: request.headers.get('authorization'),
    credentialStore: env('DATA_BRAIN_AUTH_CREDENTIALS'),
    pepper: env('DATA_BRAIN_AUTH_PEPPER'),
    legacyEnabled: env('DATA_BRAIN_LEGACY_BASIC_ENABLED'),
  }),
  rateLimit: (request) => limitRequest(request, 'dashboard-pipeline', 30, 60_000, 'fail-closed'),
  rpc: (name, args) => callRpc(name, args, { environmentScope: 'dashboard', timeoutMs: 15_000 }),
  requestId: randomUUID,
};

function numberOrNull(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return value === undefined ? undefined : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function parsePayload(raw: string): Payload | null {
  if (raw.length === 0 || raw.length > 8_192) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Payload;
  if (Object.keys(payload).some((key) => !ALLOWED_KEYS.has(key))) return null;
  if (!UUID.test(String(payload.campaign_id ?? '')) || !UUID.test(String(payload.campaign_contact_id ?? '')) ||
      !STAGES.has(String(payload.stage ?? '')) ||
      !Number.isSafeInteger(payload.expected_version) || Number(payload.expected_version) < 0) return null;
  if (payload.source_execution_id !== undefined && payload.source_execution_id !== null &&
      !UUID.test(String(payload.source_execution_id))) return null;
  if (payload.source_tool !== undefined && payload.source_tool !== null && !TOKEN.test(String(payload.source_tool))) return null;
  if (payload.outcome_reason !== undefined && payload.outcome_reason !== null &&
      (!TOKEN.test(String(payload.outcome_reason)) || String(payload.outcome_reason).length < 2)) return null;
  if (payload.expected_close_on !== undefined && payload.expected_close_on !== null &&
      !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.expected_close_on))) return null;
  const estimated = numberOrNull(payload.estimated_amount);
  const closed = numberOrNull(payload.closed_amount);
  const probability = numberOrNull(payload.probability_percent);
  if (Number.isNaN(estimated) || Number.isNaN(closed) || Number.isNaN(probability) ||
      (typeof estimated === 'number' && estimated < 0) ||
      (typeof closed === 'number' && closed < 0) ||
      (typeof probability === 'number' && (probability < 0 || probability > 100))) return null;
  if (payload.stage === 'lost' && typeof payload.outcome_reason !== 'string') return null;
  if (payload.stage !== 'won' && closed !== null && closed !== undefined) return null;
  return payload;
}

export async function processPipelineRequest(request: Request, dependencies: PipelineRouteDependencies = defaults) {
  if (!dependencies.validateEnv().ok) return NextResponse.json({ ok: false, failure_code: 'dashboard_unavailable' }, { status: 503, headers: HEADERS });
  const auth = await dependencies.authenticate(request);
  if (!auth.ok) {
    const unavailable = auth.reason === 'configuration_error';
    const headers = unavailable ? HEADERS : { ...HEADERS, ...basicAuthHeaders() };
    return NextResponse.json({ ok: false, failure_code: unavailable ? 'admin_auth_unavailable' : 'unauthorized' }, { status: unavailable ? 503 : 401, headers });
  }
  const rate = await dependencies.rateLimit(request);
  if (!rate.allowed) return NextResponse.json(
    { ok: false, failure_code: rate.reason === 'unavailable' ? 'rate_limit_unavailable' : 'rate_limited' },
    { status: rate.reason === 'unavailable' ? 503 : 429, headers: { ...HEADERS, 'Retry-After': String(rate.retryAfterSeconds) } },
  );
  const payload = parsePayload(await request.text());
  if (!payload) return NextResponse.json({ ok: false, failure_code: 'invalid_pipeline_request' }, { status: 400, headers: HEADERS });
  try {
    const result = await dependencies.rpc('dashboard_upsert_revenue_pipeline', {
      p_actor_hash: auth.actorHash,
      p_request_id: `dashboard:pipeline:${dependencies.requestId()}`,
      p_campaign_id: payload.campaign_id,
      p_campaign_contact_id: payload.campaign_contact_id,
      p_stage: payload.stage,
      p_estimated_amount: numberOrNull(payload.estimated_amount) ?? null,
      p_closed_amount: numberOrNull(payload.closed_amount) ?? null,
      p_probability_percent: numberOrNull(payload.probability_percent) ?? null,
      p_expected_close_on: payload.expected_close_on ?? null,
      p_outcome_reason: payload.outcome_reason ?? null,
      p_source_execution_id: payload.source_execution_id ?? null,
      p_source_tool: payload.source_tool ?? null,
      p_expected_version: payload.expected_version,
    });
    return NextResponse.json({ ok: true, pipeline: result }, { status: 200, headers: HEADERS });
  } catch {
    return NextResponse.json({ ok: false, failure_code: 'pipeline_write_rejected' }, { status: 409, headers: HEADERS });
  }
}

export async function POST(request: Request) { return processPipelineRequest(request); }
