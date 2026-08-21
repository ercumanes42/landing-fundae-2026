import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';

import { OperationalDashboard } from './components/OperationalDashboard';
import {
  dashboardDatasetsForRole,
  normalizeDashboardWindow,
  parseDashboardCampaignInsights,
  parseDashboardIntelligence,
  parseDashboardSample,
  parseDashboardSummary,
  type DashboardIntelligenceResponse,
  type DashboardSampleResponse,
} from '@/lib/dashboard-data';
import {
  calculateSafeRate,
  generateCampaignRecommendations,
} from '@/lib/campaign-intelligence';
import { authenticateDashboardAuthorization } from '@/lib/dashboard-auth';
import { env, optionalIntegrationStatus, validateDashboardEnv } from '@/lib/env';
import { callRpc } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const SAMPLE_SIZE = 25;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function campaignId(value: string | undefined): string | null {
  return value && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
    ? value
    : null;
}

function requestId(kind: string): string {
  return `dashboard:${kind}:${randomUUID()}`;
}

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord =>
    item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function rate(successes: unknown, total: unknown): number | null {
  return calculateSafeRate(number(successes), number(total))?.percentage ?? null;
}

function buildIntelligenceViewModel(raw: DashboardIntelligenceResponse): JsonRecord {
  const overview = object(raw.overview);
  const journey = object(raw.journey);
  const pipeline = raw.pipeline;
  const pipelineTotals = object(pipeline.totals);
  const variantRows = rows(raw.by_variant);
  const copyRows = rows(raw.by_copy);
  const hourRows = rows(raw.by_hour);
  const baselineSuccesses = variantRows.reduce((sum, item) => sum + number(item.qualified_contacts), 0);
  const baselineTotal = variantRows.reduce((sum, item) => sum + number(item.sent_contacts), 0);
  const copyBaselineSuccesses = copyRows.reduce((sum, item) => sum + Math.max(
    number(item.positive_replies), number(item.meetings), number(item.opportunities),
  ), 0);
  const copyBaselineTotal = copyRows.reduce((sum, item) => sum + number(item.sent), 0);
  const hourBaselineSuccesses = hourRows.reduce((sum, item) => sum + number(item.qualified), 0);
  const hourBaselineTotal = hourRows.reduce((sum, item) => sum + number(item.sent), 0);
  const candidateRows = [
    ...variantRows.map((item, index) => ({
      key: String(item.variant ?? `variant-${index}`),
      label: String(item.variant ?? `Variante ${index + 1}`),
      dimension: 'variant',
      successes: number(item.qualified_contacts),
      total: number(item.sent_contacts),
      baselineSuccesses,
      baselineTotal,
    })),
    ...copyRows.map((item, index) => ({
      key: String(item.copy_key ?? `copy-${index}`),
      label: String(item.copy_key ?? `Copy ${index + 1}`),
      dimension: 'copy',
      successes: Math.max(
        number(item.positive_replies), number(item.meetings), number(item.opportunities),
      ),
      total: number(item.sent),
      baselineSuccesses: copyBaselineSuccesses,
      baselineTotal: copyBaselineTotal,
    })),
    ...hourRows.map((item, index) => ({
      key: `hour-${String(item.hour ?? index)}`,
      label: `${String(item.hour ?? index)}:00`,
      dimension: 'hour',
      successes: number(item.qualified),
      total: number(item.sent),
      baselineSuccesses: hourBaselineSuccesses,
      baselineTotal: hourBaselineTotal,
    })),
  ];
  const statisticalRecommendations = generateCampaignRecommendations(candidateRows).map((item) => ({
    title: item.title,
    detail: item.explanation,
    priority: item.priority,
    evidence: item.evidence,
  }));
  const operationalRecommendations = raw.recommendations
    .filter((item): item is string => typeof item === 'string')
    .map((item) => ({ title: 'Revisión operativa', detail: item, priority: 2 }));

  return {
    ...raw,
    overview: {
      ...overview,
      attributed_sessions: number(journey.sessions),
      delivery_rate: rate(overview.delivered, overview.sent),
      click_rate: rate(overview.clicked, overview.delivered),
      positive_reply_rate: rate(overview.positive_replies, overview.delivered),
      meeting_rate: rate(overview.meetings, overview.delivered),
    },
    revenue: {
      estimated_value: number(pipelineTotals.estimated_amount),
      expected_value: number(pipelineTotals.weighted_amount),
      closed_won_value: number(pipelineTotals.closed_amount),
      opportunity_rate: rate(overview.opportunities, overview.delivered),
      by_source: pipeline.by_source ?? [],
      by_outcome_reason: pipeline.by_outcome_reason ?? [],
    },
    pipeline_by_stage: pipeline.by_stage,
    recommendations: [...statisticalRecommendations, ...operationalRecommendations].slice(0, 8),
  };
}

export default async function DataBrainHome({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  const window = normalizeDashboardWindow(params);
  const validation = validateDashboardEnv();
  if (!validation.ok) {
    return <OperationalDashboard state="configuration_error" missing={validation.missing} />;
  }

  const requestHeaders = await headers();
  const actor = await authenticateDashboardAuthorization({
    authorization: requestHeaders.get('authorization'),
    credentialStore: env('DATA_BRAIN_AUTH_CREDENTIALS'),
    pepper: env('DATA_BRAIN_AUTH_PEPPER'),
    legacyEnabled: env('DATA_BRAIN_LEGACY_BASIC_ENABLED'),
  });
  if (!actor.ok) return <OperationalDashboard state="access_denied" />;

  try {
    const selectedCampaignId = campaignId(first(params.campaign));
    const intelligenceFilters = Object.fromEntries(Object.entries({
      email_step: window.filters.emailStep,
      variant: window.filters.variant,
      lot: window.filters.lot,
      hour: window.filters.hour,
      company_size: window.filters.companySize,
      tool: window.filters.tool,
      copy_key: window.filters.copyKey,
    }).filter(([, value]) => value !== null));
    const [baseSummary, campaignInsights, rawIntelligence] = await Promise.all([
      callRpc('dashboard_get_summary', {
        p_actor_hash: actor.actorHash,
        p_request_id: requestId('summary'),
        p_from: window.from,
        p_to: window.to,
        p_campaign_id: selectedCampaignId,
      }, { environmentScope: 'dashboard' }).then(parseDashboardSummary),
      callRpc('dashboard_get_campaign_insights', {
        p_actor_hash: actor.actorHash,
        p_request_id: requestId('campaign-insights'),
        p_from: window.from,
        p_to: window.to,
        p_campaign_id: selectedCampaignId,
      }, { environmentScope: 'dashboard' }).then(parseDashboardCampaignInsights),
      callRpc('dashboard_get_intelligence_v2', {
        p_actor_hash: actor.actorHash,
        p_request_id: requestId('intelligence-v2'),
        p_from: window.from,
        p_to: window.to,
        p_campaign_id: selectedCampaignId,
        p_filters: intelligenceFilters,
      }, { environmentScope: 'dashboard' }).then(parseDashboardIntelligence),
    ]);
    const summary = {
      ...baseSummary,
      campaign: { ...baseSummary.campaign, ...campaignInsights },
    };
    const intelligence = buildIntelligenceViewModel(rawIntelligence);

    let sample: DashboardSampleResponse | null = null;
    let partialError: string | null = null;
    const allowedDatasets = dashboardDatasetsForRole(summary.meta.role);
    const selectedDataset = allowedDatasets.includes(window.dataset)
      ? window.dataset
      : allowedDatasets[0] ?? window.dataset;
    const effectiveWindow = { ...window, dataset: selectedDataset };
    if (summary.meta.role !== 'read_only') {
      try {
        sample = parseDashboardSample(await callRpc('dashboard_get_sample', {
          p_actor_hash: actor.actorHash,
          p_request_id: requestId(`sample-${selectedDataset}`),
          p_dataset: selectedDataset,
          p_from: window.from,
          p_to: window.to,
          p_offset: (window.page - 1) * SAMPLE_SIZE,
          p_limit: SAMPLE_SIZE,
        }, { environmentScope: 'dashboard' }));
      } catch (error) {
        console.warn('[Dashboard] bounded sample unavailable', error instanceof Error ? error.message : 'unknown');
        partialError = 'La muestra paginada no está disponible; los agregados siguen siendo válidos.';
      }
    }

    return <OperationalDashboard
      state="ready"
      summary={summary}
      sample={sample}
      window={effectiveWindow}
      integrations={optionalIntegrationStatus()}
      partialError={partialError}
      intelligence={intelligence}
    />;
  } catch (error) {
    console.warn('[Dashboard] aggregate RPC unavailable', error instanceof Error ? error.message : 'unknown');
    return <OperationalDashboard state="access_or_data_error" />;
  }
}
