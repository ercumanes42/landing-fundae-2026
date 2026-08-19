import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  dashboardDatasetsForRole,
  normalizeDashboardWindow,
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

test('dashboard window is bounded and rejects unsafe pagination', () => {
  const normalized = normalizeDashboardWindow({
    from: '2026-08-01', to: '2026-08-20', page: '2', dataset: 'graph_events',
  }, new Date('2026-08-19T12:00:00Z'));
  assert.equal(normalized.page, 2);
  assert.equal(normalized.dataset, 'graph_events');
  assert.equal(normalized.from, '2026-08-01T00:00:00.000Z');
  assert.equal(normalized.to, '2026-08-20T00:00:00.000Z');

  const bounded = normalizeDashboardWindow({
    from: '2020-01-01', to: '2026-08-20', page: '999999', dataset: 'private',
  }, new Date('2026-08-19T12:00:00Z'));
  assert.equal(bounded.page, 1);
  assert.equal(bounded.dataset, 'reservations');
  assert.equal(Date.parse(bounded.to) - Date.parse(bounded.from), 30 * 86_400_000);
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
  assert.match(page, /dashboard_get_sample/);
  for (const token of [
    'Claims', 'Mailbox activos', 'Reservas por estado', 'Eventos transaccionales',
    'CAMPAÑA', 'SALUD Y CONTROL', 'partialError', 'Sin datos en este periodo',
  ]) assert.ok(component.includes(token), `UI misses ${token}`);
});

test('dashboard CSS module scopes reduced-motion selectors to local roots', () => {
  const css = readFileSync(new URL('../app/components/OperationalDashboard.module.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.shell \*,\.stateShell \*/);
  assert.doesNotMatch(css, /prefers-reduced-motion:reduce\)\{\*\{/);
});
