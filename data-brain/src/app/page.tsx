import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';

import { OperationalDashboard } from './components/OperationalDashboard';
import {
  dashboardDatasetsForRole,
  normalizeDashboardWindow,
  parseDashboardSample,
  parseDashboardSummary,
  type DashboardSampleResponse,
} from '@/lib/dashboard-data';
import { authenticateDashboardAuthorization } from '@/lib/dashboard-auth';
import { env, optionalIntegrationStatus, validateEnv } from '@/lib/env';
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

export default async function DataBrainHome({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  const window = normalizeDashboardWindow(params);
  const validation = validateEnv();
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
    const summary = parseDashboardSummary(await callRpc('dashboard_get_summary', {
      p_actor_hash: actor.actorHash,
      p_request_id: requestId('summary'),
      p_from: window.from,
      p_to: window.to,
      p_campaign_id: campaignId(first(params.campaign)),
    }));

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
        }));
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
    />;
  } catch (error) {
    console.warn('[Dashboard] aggregate RPC unavailable', error instanceof Error ? error.message : 'unknown');
    return <OperationalDashboard state="access_or_data_error" />;
  }
}
