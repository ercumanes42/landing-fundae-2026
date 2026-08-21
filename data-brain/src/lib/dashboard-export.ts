import ExcelJS from 'exceljs';

import type { DashboardIntelligenceResponse } from '@/lib/dashboard-data';

export type DashboardExportFormat = 'csv' | 'xlsx';

export interface DashboardExportArtifact {
  body: Uint8Array;
  contentType: string;
  extension: DashboardExportFormat;
}

type Row = Record<string, unknown>;
type CellKind = 'text' | 'number' | 'integer' | 'percent' | 'currency' | 'date' | 'boolean';
interface ColumnSpec { key: string; header: string; kind?: CellKind; width?: number }

const FORBIDDEN_KEY = /^(email_address|recipient_email|full_name|phone|phone_number|raw_payload|payload|subject|body_html|body_text)$/i;
const FORMULA_PREFIX = /^[\u0000-\u0020]*[=+\-@]/;
const HEADER_FILL = 'FF20275D';
const ACCENT_FILL = 'FFFF206E';

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function safeText(value: string): string {
  const normalized = value.replace(/\u0000/g, '').slice(0, 32_000);
  return FORMULA_PREFIX.test(normalized) ? `'${normalized}` : normalized;
}

function assertNoPii(value: unknown, depth = 0): void {
  if (depth > 8 || value === null || value === undefined || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoPii(item, depth + 1);
    return;
  }
  for (const [key, nested] of Object.entries(value as Row)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error('Dashboard export contains a forbidden field.');
    assertNoPii(nested, depth + 1);
  }
}

function primitive(value: unknown, kind: CellKind = 'text'): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (kind === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return kind === 'percent' ? value / 100 : value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return safeText(value);
  return safeText(JSON.stringify(value));
}

function metricRows(source: unknown, category = 'Métrica'): Row[] {
  return Object.entries(record(source)).map(([metric, value]) => ({ category, metric, value }));
}

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: ColumnSpec[], data: Row[]): void {
  const sheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: ACCENT_FILL } } });
  sheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  sheet.columns = columns.map((column) => ({ key: column.key, header: column.header, width: column.width ?? 18 }));
  for (const item of data) {
    const output: Row = {};
    for (const column of columns) output[column.key] = primitive(item[column.key], column.kind);
    sheet.addRow(output);
  }
  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: 'middle', horizontal: 'left' };
  header.eachCell((cell) => { cell.border = { bottom: { style: 'thin', color: { argb: ACCENT_FILL } } }; });
  if (columns.length > 0) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: columns.length } };
  columns.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1);
    if (column.kind === 'percent') excelColumn.numFmt = '0.0%';
    if (column.kind === 'currency') excelColumn.numFmt = '€#,##0.00';
    if (column.kind === 'integer') excelColumn.numFmt = '#,##0';
    if (column.kind === 'number') excelColumn.numFmt = '#,##0.00';
    if (column.kind === 'date') excelColumn.numFmt = 'yyyy-mm-dd';
  });
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
    if (rowIndex % 2 === 0) sheet.getRow(rowIndex).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FC' } };
  }
}

const emailColumns: ColumnSpec[] = [
  { key: 'email_step', header: 'Email', kind: 'integer', width: 10 }, { key: 'planned', header: 'Planificados', kind: 'integer' },
  { key: 'sent', header: 'Enviados', kind: 'integer' }, { key: 'delivered', header: 'Entregados', kind: 'integer' },
  { key: 'failed', header: 'Fallidos', kind: 'integer' }, { key: 'bounced', header: 'Rebotes', kind: 'integer' },
  { key: 'clicked', header: 'Clics', kind: 'integer' }, { key: 'replied', header: 'Respuestas', kind: 'integer' },
  { key: 'positive_replies', header: 'Respuestas positivas', kind: 'integer', width: 22 }, { key: 'meetings', header: 'Reuniones', kind: 'integer' },
  { key: 'opportunities', header: 'Oportunidades', kind: 'integer' }, { key: 'delivery_rate', header: 'Tasa entrega', kind: 'percent' },
  { key: 'click_rate', header: 'Tasa clic', kind: 'percent' }, { key: 'reply_rate', header: 'Tasa respuesta', kind: 'percent' },
  { key: 'positive_reply_rate', header: 'Tasa respuesta positiva', kind: 'percent', width: 23 }, { key: 'meeting_rate', header: 'Tasa reunión', kind: 'percent' },
];

export async function exportDashboardXlsx(data: DashboardIntelligenceResponse): Promise<Uint8Array> {
  assertNoPii(data);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GFS Data Brain';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = false;
  addSheet(workbook, 'Metadatos', [{ key: 'metric', header: 'Campo', width: 28 }, { key: 'value', header: 'Valor', width: 42 }], metricRows(data.meta, 'Metadato'));
  addSheet(workbook, 'Resumen', [{ key: 'metric', header: 'Indicador', width: 34 }, { key: 'value', header: 'Valor', width: 22 }], [...metricRows(data.overview), ...metricRows(data.journey, 'Journey')]);
  addSheet(workbook, 'Emails', emailColumns, rows(data.by_email));
  addSheet(workbook, 'Copies', [
    { key: 'copy_key', header: 'Copy', width: 28 }, { key: 'sent', header: 'Enviados', kind: 'integer' },
    { key: 'clicked', header: 'Clics', kind: 'integer' }, { key: 'replied', header: 'Respuestas', kind: 'integer' },
    { key: 'positive_replies', header: 'Respuestas positivas', kind: 'integer' }, { key: 'meetings', header: 'Reuniones', kind: 'integer' },
    { key: 'opportunities', header: 'Oportunidades', kind: 'integer' }, { key: 'click_rate', header: 'Tasa clic', kind: 'percent' },
    { key: 'qualified_rate', header: 'Tasa cualificación', kind: 'percent' }, { key: 'minimum_sample_reached', header: 'Muestra mínima', kind: 'boolean' },
  ], rows(data.by_copy));
  addSheet(workbook, 'Campañas', [
    { key: 'campaign', header: 'Campaña', width: 28 }, { key: 'contacts', header: 'Contactos', kind: 'integer' },
    { key: 'sent', header: 'Enviados', kind: 'integer' }, { key: 'clicked', header: 'Clics', kind: 'integer' },
    { key: 'replied', header: 'Respuestas', kind: 'integer' }, { key: 'meetings', header: 'Reuniones', kind: 'integer' },
    { key: 'opportunities', header: 'Oportunidades', kind: 'integer' }, { key: 'closed_amount', header: 'Ingresos cerrados', kind: 'currency' },
  ], rows(data.by_campaign));
  addSheet(workbook, 'Variantes', [
    { key: 'variant', header: 'Variante' }, { key: 'sent_contacts', header: 'Contactos enviados', kind: 'integer' }, { key: 'clicked_contacts', header: 'Contactos con clic', kind: 'integer' },
    { key: 'qualified_contacts', header: 'Contactos cualificados', kind: 'integer' }, { key: 'conversion_rate', header: 'Conversión', kind: 'percent' },
    { key: 'lift_percentage_points', header: 'Lift (pp)', kind: 'number' }, { key: 'wilson_low_95', header: 'IC 95% inferior', kind: 'percent' },
    { key: 'wilson_high_95', header: 'IC 95% superior', kind: 'percent' }, { key: 'minimum_sample_reached', header: 'Muestra mínima', kind: 'boolean' },
  ], rows(data.by_variant));
  addSheet(workbook, 'Horas', [
    { key: 'hour', header: 'Hora (Madrid)', kind: 'integer' }, { key: 'sent', header: 'Enviados', kind: 'integer' }, { key: 'clicked', header: 'Clics', kind: 'integer' },
    { key: 'replied', header: 'Respuestas', kind: 'integer' }, { key: 'qualified', header: 'Cualificados', kind: 'integer' }, { key: 'click_rate', header: 'Tasa clic', kind: 'percent' },
    { key: 'qualified_rate', header: 'Tasa cualificación', kind: 'percent' },
  ], rows(data.by_hour));
  addSheet(workbook, 'Herramientas', [
    { key: 'tool', header: 'Herramienta', width: 24 }, { key: 'events', header: 'Eventos', kind: 'integer' }, { key: 'sessions', header: 'Sesiones', kind: 'integer' },
    { key: 'started', header: 'Iniciadas', kind: 'integer' }, { key: 'completed', header: 'Completadas', kind: 'integer' }, { key: 'abandoned', header: 'Abandonadas', kind: 'integer' },
    { key: 'completion_rate', header: 'Tasa finalización', kind: 'percent' }, { key: 'abandonment_rate', header: 'Tasa abandono', kind: 'percent' },
    { key: 'avg_active_seconds', header: 'Tiempo activo medio (s)', kind: 'number', width: 24 }, { key: 'avg_scroll_percent', header: 'Scroll medio', kind: 'percent' },
  ], rows(data.tools));
  addSheet(workbook, 'Abandonos', [
    { key: 'tool', header: 'Herramienta', width: 24 }, { key: 'section', header: 'Sección', width: 28 },
    { key: 'abandoned', header: 'Abandonos', kind: 'integer' }, { key: 'sessions', header: 'Sesiones', kind: 'integer' },
  ], rows(data.abandonment_by_section));
  addSheet(workbook, 'Alta intención', [
    { key: 'contact_ref', header: 'Referencia seudónima', width: 68 }, { key: 'intent_score', header: 'Score', kind: 'integer' },
    { key: 'confirmed_signals', header: 'Señales confirmadas', kind: 'integer' }, { key: 'dominant_tool', header: 'Herramienta', width: 24 },
    { key: 'last_activity_at', header: 'Última actividad', width: 26 },
  ], rows(data.high_intent_contacts));
  const traffic = record(data.traffic);
  addSheet(workbook, 'Tráfico', [
    { key: 'domain', header: 'Dominio', width: 28 }, { key: 'source', header: 'Fuente', width: 24 },
    { key: 'events', header: 'Eventos', kind: 'integer' }, { key: 'sessions', header: 'Sesiones', kind: 'integer' },
    { key: 'conversions', header: 'Conversiones', kind: 'integer' },
  ], rows(traffic.by_domain_source));
  addSheet(workbook, 'Enlaces', [
    { key: 'link', header: 'Enlace', width: 32 }, { key: 'clicks', header: 'Clics', kind: 'integer' },
    { key: 'sessions', header: 'Sesiones', kind: 'integer' },
  ], rows(traffic.by_link));
  addSheet(workbook, 'Embudo', [{ key: 'stage', header: 'Etapa', width: 28 }, { key: 'count', header: 'Contactos', kind: 'integer' }], rows(data.funnel));
  const pipeline = record(data.pipeline);
  const pipelineColumns: ColumnSpec[] = [{ key: 'stage', header: 'Etapa', width: 24 }, { key: 'opportunities', header: 'Oportunidades', kind: 'integer' }, { key: 'estimated_amount', header: 'Importe estimado', kind: 'currency' }, { key: 'weighted_amount', header: 'Importe ponderado', kind: 'currency' }, { key: 'closed_amount', header: 'Ingresos cerrados', kind: 'currency' }];
  addSheet(workbook, 'Pipeline', pipelineColumns, rows(pipeline.by_stage));
  addSheet(workbook, 'Orígenes', [{ key: 'source', header: 'Origen', width: 28 }, { key: 'records', header: 'Registros', kind: 'integer' }, { key: 'estimated_amount', header: 'Importe estimado', kind: 'currency' }, { key: 'weighted_amount', header: 'Importe ponderado', kind: 'currency' }, { key: 'closed_amount', header: 'Ingresos cerrados', kind: 'currency' }], rows(pipeline.by_source));
  addSheet(workbook, 'Resultados', [{ key: 'outcome_reason', header: 'Resultado', width: 32 }, { key: 'outcomes', header: 'Casos', kind: 'integer' }, { key: 'won', header: 'Ganados', kind: 'integer' }, { key: 'lost', header: 'Perdidos', kind: 'integer' }, { key: 'closed_amount', header: 'Ingresos cerrados', kind: 'currency' }], rows(pipeline.by_outcome_reason));
  const quality = [...metricRows(data.quality, 'Calidad'), ...rows(data.anomalies).map((item) => ({ category: 'Anomalía', metric: item.code, value: item.severity })), ...data.recommendations.map((value, index) => ({ category: 'Recomendación', metric: index + 1, value }))];
  addSheet(workbook, 'Calidad', [{ key: 'category', header: 'Categoría', width: 20 }, { key: 'metric', header: 'Indicador', width: 36 }, { key: 'value', header: 'Valor', width: 42 }], quality);
  const timeSeries = rows((data as unknown as Row).time_series);
  if (timeSeries.length > 0) addSheet(workbook, 'Serie temporal', [{ key: 'date', header: 'Fecha', kind: 'date' }, { key: 'sent', header: 'Enviados', kind: 'integer' }, { key: 'clicked', header: 'Clics', kind: 'integer' }, { key: 'replied', header: 'Respuestas', kind: 'integer' }, { key: 'meetings', header: 'Reuniones', kind: 'integer' }, { key: 'opportunities', header: 'Oportunidades', kind: 'integer' }, { key: 'closed_amount', header: 'Ingresos cerrados', kind: 'currency' }], timeSeries);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function csvCell(value: unknown): string {
  const normalized = primitive(value);
  const text = normalized instanceof Date ? normalized.toISOString().slice(0, 10) : normalized === null ? '' : String(normalized);
  return `"${safeText(text).replace(/"/g, '""')}"`;
}

export function exportDashboardCsv(data: DashboardIntelligenceResponse): Uint8Array {
  assertNoPii(data);
  const output: unknown[][] = [['Sección', 'Registro', 'Campo', 'Valor']];
  const appendObject = (section: string, source: unknown, entry: unknown = '') => {
    for (const [key, value] of Object.entries(record(source))) output.push([section, entry, key, value]);
  };
  appendObject('Metadatos', data.meta);
  appendObject('Resumen', data.overview);
  const appendRows = (section: string, source: unknown) => rows(source).forEach((item, index) => appendObject(section, item, index + 1));
  appendRows('Emails', data.by_email); appendRows('Copies', data.by_copy); appendRows('Campañas', data.by_campaign);
  appendRows('Variantes', data.by_variant); appendRows('Horas', data.by_hour);
  appendRows('Herramientas', data.tools); appendRows('Embudo', data.funnel);
  appendRows('Abandonos', data.abandonment_by_section); appendRows('Alta intención', data.high_intent_contacts);
  const traffic = record(data.traffic); appendRows('Tráfico', traffic.by_domain_source); appendRows('Enlaces', traffic.by_link);
  const pipeline = record(data.pipeline);
  appendRows('Pipeline', pipeline.by_stage); appendRows('Orígenes', pipeline.by_source); appendRows('Resultados', pipeline.by_outcome_reason);
  appendObject('Calidad', data.quality); appendRows('Anomalías', data.anomalies);
  data.recommendations.forEach((value, index) => output.push(['Recomendaciones', index + 1, 'recomendación', value]));
  appendRows('Serie temporal', (data as unknown as Row).time_series);
  return new TextEncoder().encode(`\uFEFF${output.map((line) => line.map(csvCell).join(',')).join('\r\n')}`);
}

export async function buildDashboardExport(data: DashboardIntelligenceResponse, format: DashboardExportFormat): Promise<DashboardExportArtifact> {
  if (format === 'csv') return { body: exportDashboardCsv(data), contentType: 'text/csv; charset=utf-8', extension: 'csv' };
  return { body: await exportDashboardXlsx(data), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
}
