import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';

import type { DashboardIntelligenceResponse } from '@/lib/dashboard-data';
import { exportDashboardCsv, exportDashboardXlsx } from '@/lib/dashboard-export';

function intelligence(): DashboardIntelligenceResponse {
  return {
    meta: { role: 'admin', generated_at: '2026-08-21T10:00:00Z', from: '2026-08-01T00:00:00Z', to: '2026-08-21T10:00:00Z', campaign_id: null, filters: {}, timezone: 'Europe/Madrid', pii_included: false },
    overview: { sent: 10, note: '=HYPERLINK("https://evil.invalid")' },
    funnel: [{ stage: 'sent', count: 10 }], by_email: [{ email_step: 1, sent: 10, click_rate: 12.5 }],
    by_copy: [{ copy_key: 'email_1:A', sent: 10, qualified_rate: 20 }],
    by_campaign: [{ campaign: 'fundae-2026', contacts: 10, sent: 10, closed_amount: 0 }],
    by_variant: [{ variant: 'A', sent_contacts: 10, conversion_rate: 20 }], by_hour: [{ hour: 9, sent: 10 }], cohorts: {}, traffic: {},
    tools: [{ tool: 'calculator', sessions: 4, completion_rate: 50 }], abandonment_by_section: [{ tool: 'calculator', section: 'step_2', abandoned: 1, sessions: 1 }],
    high_intent_contacts: [{ contact_ref: 'a'.repeat(64), intent_score: 70, confirmed_signals: 2, dominant_tool: 'calculator', last_activity_at: '2026-08-21T10:00:00Z' }], journey: { sessions: 4 },
    pipeline: { totals: { closed_amount: 0 }, by_stage: [{ stage: 'open', opportunities: 1, estimated_amount: 1000 }], by_source: [{ source: 'email', records: 1 }], by_campaign: [{ campaign: 'fundae-2026', records: 1 }], by_outcome_reason: [{ outcome_reason: 'pending', outcomes: 1 }] },
    quality: { campaign_attribution_rate: 100 }, anomalies: [{ code: 'none', severity: 'info' }], recommendations: ['@unsafe'],
    available_filters: {}, metric_contract: { version: '2.0', timezone: 'Europe/Madrid', pii_included: false, external_crm_required: false },
    time_series: [{ date: '2026-08-21', sent: 10, closed_amount: 0 }],
  } as DashboardIntelligenceResponse;
}

test('CSV is UTF-8 BOM encoded and neutralizes spreadsheet formulas', () => {
  const bytes = exportDashboardCsv(intelligence());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder().decode(bytes);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'@unsafe/);
  assert.doesNotMatch(csv, /,"[=+\-@]/);
});

test('XLSX contains the business sheets, typed numbers and no formulas', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await exportDashboardXlsx(intelligence())) as never);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    'Metadatos', 'Resumen', 'Emails', 'Copies', 'Campañas', 'Variantes', 'Horas', 'Herramientas', 'Abandonos', 'Alta intención', 'Tráfico', 'Enlaces', 'Embudo', 'Pipeline', 'Orígenes', 'Resultados', 'Calidad', 'Serie temporal',
  ]);
  assert.equal(workbook.getWorksheet('Emails')?.getCell('C2').type, ExcelJS.ValueType.Number);
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.views[0]?.state, 'frozen');
    assert.ok(sheet.autoFilter);
    sheet.eachRow((row) => row.eachCell((cell) => {
      assert.notEqual(cell.type, ExcelJS.ValueType.Formula);
      assert.equal(typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value, false);
    }));
  }
});

test('export rejects forbidden PII fields even if parser is bypassed', async () => {
  const unsafe = intelligence() as unknown as Record<string, unknown>;
  unsafe.overview = { email_address: 'hidden@example.invalid' };
  await assert.rejects(exportDashboardXlsx(unsafe as unknown as DashboardIntelligenceResponse), /forbidden field/);
});
