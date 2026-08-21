import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  dashboardDatasetsForRole,
  normalizeDashboardWindow,
  parseDashboardCampaignInsights,
  parseDashboardIntelligence,
  parseDashboardSample,
  parseDashboardSummary,
} from './dashboard-data';

test('dashboard role matrix limits samples before the RPC boundary', () => {
  assert.deepEqual(dashboardDatasetsForRole('read_only'), []);
  assert.deepEqual(dashboardDatasetsForRole('operator'), [
    'reservations', 'transactional_events', 'campaign_executions', 'graph_events',
  ]);
  assert.ok(dashboardDatasetsForRole('auditor').includes('audit'));
  assert.ok(dashboardDatasetsForRole('admin').includes('leads'));
});

test('campaign insights parser requires Madrid timezone and explicit no-PII contract', () => {
  const value = {
    by_variant: {}, performance_by_email: {}, events_by_hour: {},
    engagement_by_action: {}, conversions: {},
    metric_contract: { timezone: 'Europe/Madrid', opens_quality: 'directional', pii_included: false },
  };
  assert.deepEqual(parseDashboardCampaignInsights(value).conversions, {});
  assert.throws(() => parseDashboardCampaignInsights({
    ...value, metric_contract: { ...value.metric_contract, pii_included: true },
  }));
});

test('intelligence parser enforces v2, bounded arrays and no PII', () => {
  const value = {
    meta: {
      role: 'admin', generated_at: '2026-08-21T12:00:00Z',
      from: '2026-08-01T00:00:00Z', to: '2026-08-21T00:00:00Z',
      campaign_id: null, filters: {}, timezone: 'Europe/Madrid', pii_included: false,
    },
    overview: {}, funnel: [], by_email: [], by_copy: [], by_campaign: [], by_variant: [], by_hour: [], time_series: [],
    cohorts: {}, traffic: {}, tools: [], abandonment_by_section: [], high_intent_contacts: [], journey: {},
    pipeline: { totals: {}, by_stage: [], by_source: [], by_campaign: [], by_outcome_reason: [] },
    quality: {}, anomalies: [], recommendations: [], available_filters: {},
    metric_contract: {
      version: '2.0', timezone: 'Europe/Madrid', pii_included: false,
      external_crm_required: false,
    },
  };
  assert.equal(parseDashboardIntelligence(value).meta.role, 'admin');
  assert.throws(() => parseDashboardIntelligence({
    ...value, overview: { recipient_email: 'hidden@example.invalid' },
  }));
  assert.throws(() => parseDashboardIntelligence({
    ...value, metric_contract: { ...value.metric_contract, version: '1.0' },
  }));
});

test('dashboard window is bounded and rejects unsafe pagination', () => {
  const now = new Date('2026-08-19T12:00:00Z');
  const normalized = normalizeDashboardWindow({
    from: '2026-08-01', to: '2026-08-19', page: '2', dataset: 'graph_events',
    view: 'campaign', email_step: '3', variant: 'Checklist_A', lot: 'B',
    hour: '9', company_size: '50-249', tool: 'calculator', copy_key: 'email_3:Checklist_A',
  }, now);
  assert.equal(normalized.page, 2);
  assert.equal(normalized.dataset, 'graph_events');
  assert.equal(normalized.from, '2026-08-01T00:00:00.000Z');
  assert.equal(normalized.to, now.toISOString());
  assert.equal(normalized.view, 'campaign');
  assert.deepEqual(normalized.filters, {
    emailStep: 3,
    variant: 'Checklist_A',
    lot: 'B',
    hour: 9,
    companySize: '50-249',
    tool: 'calculator',
    copyKey: 'email_3:Checklist_A',
  });

  const bounded = normalizeDashboardWindow({
    from: '2020-01-01', to: '2026-08-20', page: '999999', dataset: 'private',
    view: 'private', email_step: '6', variant: '../../unsafe', hour: '24',
  }, now);
  assert.equal(bounded.page, 1);
  assert.equal(bounded.dataset, 'reservations');
  assert.equal(bounded.view, 'summary');
  assert.equal(bounded.filters.emailStep, null);
  assert.equal(bounded.filters.variant, null);
  assert.equal(bounded.filters.hour, null);
  assert.equal(Date.parse(bounded.to) - Date.parse(bounded.from), 30 * 86_400_000);
  assert.ok(Date.parse(bounded.to) <= now.getTime() + 5 * 60_000);
});

test('summary parser requires complete aggregate and explicit no-PII marker', () => {
  const value = {
    meta: {
      role: 'auditor', generated_at: '2026-08-19T12:00:00Z',
      from: '2026-08-01T00:00:00Z', to: '2026-08-20T00:00:00Z',
      campaign_id: null, freshness_target_seconds: 60,
      aggregate_complete: true, pii_included: false,
    },
    funnel: { leads: 100_000 }, journey: { events: 2_000_000 },
    transactional: {}, campaign: {}, health: {},
  };
  assert.equal(parseDashboardSummary(value).funnel.leads, 100_000);
  assert.throws(() => parseDashboardSummary({ ...value, meta: { ...value.meta, pii_included: true } }));
});

test('sample parser rejects oversized responses even for large datasets', () => {
  const base = {
    dataset: 'reservations', role: 'admin', offset: 0, limit: 100,
    total: 1_000_000, has_more: true, pii_included: false,
  };
  assert.equal(parseDashboardSample({ ...base, rows: Array.from({ length: 100 }, (_, id) => ({ id })) }).rows.length, 100);
  assert.throws(() => parseDashboardSample({ ...base, rows: Array.from({ length: 101 }, (_, id) => ({ id })) }));
});

test('page and UI contract avoid full-table loaders and expose partial states', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const component = readFileSync(new URL('../app/components/OperationalDashboard.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /selectAllRowsPaged|buildDashboardAggregates|payload&order/);
  assert.match(page, /dashboard_get_summary/);
  assert.match(page, /dashboard_get_campaign_insights/);
  assert.match(page, /dashboard_get_intelligence_v2/);
  assert.match(page, /dashboard_get_sample/);
  for (const token of [
    'Claims', 'Mailbox activos', 'Reservas por estado', 'Eventos transaccionales',
    'Resumen', 'Campaña', 'Journey', 'Revenue', 'Operaciones',
    'partialError', 'Sin datos en este periodo', 'Aplicar filtros', 'Restablecer filtros',
    'Rendimiento por email', 'Actividad por hora', 'Clics y herramientas', 'Conversiones',
    'Rendimiento por copy', 'Comparación entre campañas', 'Contactos con alta intención',
    'Abandono por sección', 'Fuentes y dominios', 'Revenue por campaña',
    'Registro comercial activo',
  ]) assert.ok(component.includes(token), `UI misses ${token}`);
  assert.match(component, /function HighIntentTable/);
  assert.match(component, /function keyedValues/);
  assert.match(component, /\['unknown', 'unattributed', 'unclassified'\]/);
  assert.match(component, /aria-current=\{view === item\.key \? 'page'/);
  assert.match(component, /type="hidden" name="view"/);
  assert.match(component, /view === 'summary'/);
  assert.match(component, /view === 'operations'/);
});

test('dashboard CSS module scopes reduced-motion selectors to local roots', () => {
  const css = readFileSync(new URL('../app/components/OperationalDashboard.module.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.shell \*,\.stateShell \*/);
  assert.doesNotMatch(css, /prefers-reduced-motion:reduce\)\{\*\{/);
});

test('dashboard visualizations are native, accessible and evidence-gated', () => {
  const component = readFileSync(new URL('../app/components/OperationalDashboard.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/components/OperationalDashboard.module.css', import.meta.url), 'utf8');
  for (const token of [
    'function BarChart', 'function FunnelChart', 'function DonutChart',
    'function LineChart', 'function RadarChart', '<figcaption>',
    'role="img"', 'ChartEmpty', 'segments.length >= 2',
    'candidates.length >= 3', 'intelligence.timeline',
  ]) assert.ok(component.includes(token), `visualization contract misses ${token}`);
  assert.doesNotMatch(component, /from ['"](?:chart\.js|react-chartjs-2|recharts|d3)['"]/);
  assert.match(css, /prefers-reduced-motion:reduce\)[^{]*\{[^}]*\.chartTrack span/);
  assert.match(css, /\.chartsGrid\{display:grid/);
});

test('dashboard export links preserve the active period and intelligence filters', () => {
  const component = readFileSync(new URL('../app/components/OperationalDashboard.tsx', import.meta.url), 'utf8');
  assert.match(component, /function exportHref\(window: DashboardWindow, format: 'csv' \| 'xlsx'\)/);
  assert.match(component, /\/api\/dashboard\/export\?/);
  for (const token of [
    'Exportar CSV', 'Exportar Excel', 'email_step', 'variant', 'lot',
    'hour', 'company_size', 'tool', 'copy_key',
  ]) assert.ok(component.includes(token), `export contract misses ${token}`);
  assert.match(component, /valueKeys=\{\['sent'\]\}/);
});

test('global document styles keep long operational dashboards vertically scrollable', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const documentRule = css.match(/html, body\s*\{[\s\S]*?\}/)?.[0] ?? '';
  assert.match(documentRule, /overflow-y:\s*auto/);
  assert.doesNotMatch(documentRule, /overflow:\s*hidden/);
});
