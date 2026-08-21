import Link from 'next/link';

import type { DashboardSampleResponse, DashboardSummaryResponse, DashboardWindow } from '@/lib/dashboard-data';
import { dashboardDatasetsForRole } from '@/lib/dashboard-data';
import styles from './OperationalDashboard.module.css';

type IntegrationState = { make: boolean; legacyRetry: boolean; outboundMaster: boolean; airtable: boolean; posthog: boolean; hubspot: boolean };
type Props =
  | { state: 'configuration_error'; missing: string[] }
  | { state: 'access_denied' }
  | { state: 'access_or_data_error' }
  | { state: 'ready'; summary: DashboardSummaryResponse; sample: DashboardSampleResponse | null; window: DashboardWindow; integrations: IntegrationState; partialError: string | null; intelligence?: unknown };
type ViewKey = 'summary' | 'campaign' | 'journey' | 'revenue' | 'operations';

const VIEWS: Array<{ key: ViewKey; label: string; description: string }> = [
  { key: 'summary', label: 'Resumen', description: 'Decisiones y señales' },
  { key: 'campaign', label: 'Campaña', description: 'Emails y horarios' },
  { key: 'journey', label: 'Journey', description: 'Landing y abandono' },
  { key: 'revenue', label: 'Revenue', description: 'Pipeline e ingresos' },
  { key: 'operations', label: 'Operaciones', description: 'Salud y auditoría' },
];
const ROLE_LABELS = { admin: 'Administrador', operator: 'Operador', auditor: 'Auditor', read_only: 'Solo lectura' } as const;
const DATASET_LABELS = {
  leads: 'Leads seudonimizados', events: 'Journey consentido', reservations: 'Reservas mailbox',
  transactional_events: 'Eventos transaccionales', campaign_executions: 'Ejecuciones campaña',
  graph_events: 'Eventos Graph', audit: 'Auditoría de acceso',
} as const;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function records(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(record) : []; }
function count(section: Record<string, unknown>, key: string): number {
  const value = section[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return new Intl.NumberFormat('es-ES').format(value);
  if (typeof value === 'string') {
    if (['unknown', 'unattributed', 'unclassified'].includes(value.toLowerCase())) return 'Sin atribuir';
    return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  }
  return JSON.stringify(value);
}
function percentage(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Sin datos';
  return `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(value)} %`;
}
function currency(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Sin datos';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}
function valueFrom(section: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (section[key] !== undefined && section[key] !== null) return section[key];
  return null;
}
function keyedValues(value: unknown, labelKey: string, metricKey: string): Record<string, unknown> {
  return Object.fromEntries(records(value).map((row, index) => [
    String(row[labelKey] ?? `${labelKey}-${index + 1}`), row[metricKey],
  ]));
}
function Breakdown({ title, value }: { title: string; value: unknown }) {
  const rows = Object.entries(record(value)).sort(([, a], [, b]) => Number(b) - Number(a));
  const maximum = Math.max(1, ...rows.map(([, amount]) => Number(amount) || 0));
  return <article className={styles.card}><h3>{title}</h3>
    {rows.length ? <dl className={styles.breakdown}>{rows.map(([key, amount]) =>
      <div key={key} className={styles.metricRow}><dt>{key.replaceAll('_', ' ')}</dt><dd>{display(amount)}</dd>
        <span className={styles.metricTrack} aria-hidden="true"><span style={{ width: `${Math.max(2, (Number(amount) || 0) / maximum * 100)}%` }} /></span>
      </div>)}</dl> : <p className={styles.empty}>No hay registros. Amplía las fechas o revisa los filtros.</p>}
  </article>;
}
function RateCard({ label, value, detail }: { label: string; value: unknown; detail: string }) {
  return <article className={styles.rateCard}><span>{label}</span><strong>{percentage(value)}</strong><small>{detail}</small></article>;
}
function RateTable({ title, rows, dimension }: { title: string; rows: Record<string, unknown>[]; dimension: 'email' | 'copy' | 'campaign' | 'variant' | 'hour' | 'tool' }) {
  const labels = { email: ['email_step', 'email', 'step'], copy: ['copy_key'], campaign: ['campaign'], variant: ['variant', 'copy_variant'], hour: ['hour', 'hour_madrid'], tool: ['tool', 'tool_key', 'resource'] }[dimension];
  const first = dimension === 'email' ? 'Email' : dimension === 'copy' ? 'Copy' : dimension === 'campaign' ? 'Campaña' : dimension === 'hour' ? 'Hora Madrid' : dimension === 'tool' ? 'Herramienta' : 'Variante';
  const columns = {
    email: [
      { label: 'Enviados', keys: ['sent'], format: display },
      { label: 'Entrega', keys: ['delivery_rate'], format: percentage },
      { label: 'Clic', keys: ['click_rate'], format: percentage },
      { label: 'Respuesta', keys: ['reply_rate'], format: percentage },
      { label: 'Reunión', keys: ['meeting_rate'], format: percentage },
    ],
    variant: [
      { label: 'Enviados', keys: ['sent_contacts'], format: display },
      { label: 'Clics', keys: ['clicked_contacts'], format: display },
      { label: 'Calificados', keys: ['qualified_contacts'], format: display },
      { label: 'Conversión', keys: ['conversion_rate'], format: percentage },
      { label: 'Muestra suficiente', keys: ['minimum_sample_reached'], format: display },
    ],
    copy: [
      { label: 'Enviados', keys: ['sent'], format: display },
      { label: 'Clic', keys: ['click_rate'], format: percentage },
      { label: 'Respuestas', keys: ['replied'], format: display },
      { label: 'Reuniones', keys: ['meetings'], format: display },
      { label: 'Tasa calificada', keys: ['qualified_rate'], format: percentage },
    ],
    campaign: [
      { label: 'Contactos', keys: ['contacts', 'records'], format: display },
      { label: 'Enviados', keys: ['sent'], format: display },
      { label: 'Clic', keys: ['click_rate'], format: percentage },
      { label: 'Oportunidades', keys: ['opportunities'], format: display },
      { label: 'Ingresos', keys: ['closed_amount'], format: currency },
    ],
    hour: [
      { label: 'Enviados', keys: ['sent'], format: display },
      { label: 'Clics', keys: ['clicked'], format: display },
      { label: 'Respuestas', keys: ['replied'], format: display },
      { label: 'Calificados', keys: ['qualified'], format: display },
      { label: 'Tasa calificada', keys: ['qualified_rate'], format: percentage },
    ],
    tool: [
      { label: 'Sesiones', keys: ['sessions'], format: display },
      { label: 'Inicios', keys: ['started'], format: display },
      { label: 'Completados', keys: ['completed'], format: display },
      { label: 'Abandono', keys: ['abandonment_rate'], format: percentage },
      { label: 'Tiempo activo', keys: ['avg_active_seconds'], format: (value: unknown) => typeof value === 'number' ? `${display(value)} s` : 'Sin datos' },
    ],
  }[dimension];
  return <article className={`${styles.card} ${styles.wideCard}`}><h3>{title}</h3>
    {rows.length ? <div className={styles.compactTableWrap}><table className={styles.compactTable}>
      <thead><tr><th>{first}</th>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${dimension}-${index}`}>
        <th scope="row">{display(valueFrom(row, ...labels))}</th>
        {columns.map((column) => <td key={column.label}>{column.format(valueFrom(row, ...column.keys))}</td>)}
      </tr>)}</tbody>
    </table></div> : <p className={styles.empty}>Se mostrará al existir una muestra atribuida suficiente.</p>}
  </article>;
}

function HighIntentTable({ rows }: { rows: Record<string, unknown>[] }) {
  return <article className={`${styles.card} ${styles.wideCard}`}><h3>Contactos con alta intención</h3>
    {rows.length ? <div className={styles.compactTableWrap}><table className={styles.compactTable}>
      <thead><tr><th>Referencia seudónima</th><th>Score</th><th>Señales confirmadas</th><th>Herramienta</th><th>Última actividad</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={String(row.contact_ref ?? index)}>
        <th scope="row">{display(row.contact_ref)}</th><td>{display(row.intent_score)}</td>
        <td>{display(row.confirmed_signals)}</td><td>{display(row.dominant_tool)}</td><td>{display(row.last_activity_at)}</td>
      </tr>)}</tbody>
    </table></div> : <p className={styles.empty}>Aparecerán cuando existan señales confirmadas de intención en producción.</p>}
  </article>;
}

type ChartDatum = { label: string; value: number };

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function chartData(rows: Record<string, unknown>[], labelKeys: string[], valueKeys: string[]): ChartDatum[] {
  return rows.flatMap((row) => {
    const label = valueFrom(row, ...labelKeys);
    const value = numeric(valueFrom(row, ...valueKeys));
    return label !== null && label !== undefined && value !== null
      ? [{ label: String(label), value }]
      : [];
  });
}

function formatChartValue(value: number, kind: 'count' | 'percentage' | 'currency'): string {
  if (kind === 'percentage') return percentage(value);
  if (kind === 'currency') return currency(value);
  return display(value);
}

function ChartEmpty({ detail }: { detail: string }) {
  return <p className={styles.chartEmpty}>Visualización no disponible: {detail}</p>;
}

function BarChart({
  id, title, caption, data, kind = 'count',
}: {
  id: string; title: string; caption: string; data: ChartDatum[]; kind?: 'count' | 'percentage' | 'currency';
}) {
  const valid = data.filter((item) => Number.isFinite(item.value) && item.value >= 0);
  const maximum = Math.max(0, ...valid.map((item) => item.value));
  return <figure className={styles.chart} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{title}</h3>
    {valid.length && maximum > 0 ? <ol className={styles.barChart}>
      {valid.map((item) => <li key={item.label}>
        <div><span>{item.label}</span><strong>{formatChartValue(item.value, kind)}</strong></div>
        <span className={styles.chartTrack} aria-hidden="true"><span style={{ width: `${Math.max(2, item.value / maximum * 100)}%` }} /></span>
      </li>)}
    </ol> : <ChartEmpty detail="faltan valores positivos comparables" />}
    <figcaption>{caption}</figcaption>
  </figure>;
}

function FunnelChart({ id, title, rows }: { id: string; title: string; rows: Record<string, unknown>[] }) {
  const data = chartData(rows, ['stage'], ['count', 'opportunities']).filter((item) => item.value > 0);
  const maximum = Math.max(0, ...data.map((item) => item.value));
  return <figure className={styles.chart} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{title}</h3>
    {data.length >= 2 && maximum > 0 ? <ol className={styles.funnelChart}>
      {data.map((item) => <li key={item.label} style={{ width: `${Math.max(28, item.value / maximum * 100)}%` }}>
        <span>{item.label.replaceAll('_', ' ')}</span><strong>{display(item.value)}</strong>
      </li>)}
    </ol> : <ChartEmpty detail="el embudo necesita al menos 2 etapas con base real" />}
    <figcaption>Volumen observado por etapa. La tabla y los contadores conservan los valores exactos.</figcaption>
  </figure>;
}

const CHART_COLORS = ['#ff3f84', '#8b7cff', '#55d6be', '#ffc857', '#54a7ff'];

function DonutChart({ id, title, caption, data }: { id: string; title: string; caption: string; data: ChartDatum[] }) {
  const valid = data.filter((item) => item.value > 0);
  const total = valid.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;
  const segments = valid.map((item, index) => {
    const share = item.value / total * 100;
    const segment = { ...item, share, offset, color: CHART_COLORS[index % CHART_COLORS.length] };
    offset += share;
    return segment;
  });
  return <figure className={styles.chart} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{title}</h3>
    {segments.length >= 2 && total > 0 ? <div className={styles.donutLayout}>
      <svg className={styles.donut} viewBox="0 0 120 120" role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <desc id={`${id}-description`}>{caption}</desc>
        <circle className={styles.donutBase} cx="60" cy="60" r="44" />
        {segments.map((item) => <circle key={item.label} cx="60" cy="60" r="44" pathLength="100"
          fill="none" stroke={item.color} strokeWidth="16"
          strokeDasharray={`${item.share} ${100 - item.share}`}
          strokeDashoffset={-item.offset} />)}
        <text x="60" y="57" textAnchor="middle">Total</text>
        <text className={styles.donutTotal} x="60" y="73" textAnchor="middle">{display(total)}</text>
      </svg>
      <ul className={styles.chartLegend}>{segments.map((item) => <li key={item.label}><span style={{ backgroundColor: item.color }} aria-hidden="true" /><span>{item.label}</span><strong>{percentage(item.share)}</strong></li>)}</ul>
    </div> : <ChartEmpty detail="la composición necesita al menos 2 categorías con valor real" />}
    <figcaption>{caption}</figcaption>
  </figure>;
}

function LineChart({ id, title, rows, valueKeys = ['value'], kind = 'count' }: { id: string; title: string; rows: Record<string, unknown>[]; valueKeys?: string[]; kind?: 'count' | 'percentage' | 'currency' }) {
  const data = chartData(rows, ['date', 'day', 'period', 'timestamp'], valueKeys);
  const maximum = Math.max(0, ...data.map((item) => item.value));
  const points = maximum > 0 ? data.map((item, index) => ({
    ...item,
    x: data.length === 1 ? 50 : 8 + index / (data.length - 1) * 84,
    y: 88 - item.value / maximum * 72,
  })) : [];
  return <figure className={styles.chart} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{title}</h3>
    {points.length >= 2 ? <svg className={styles.lineChart} viewBox="0 0 100 100" role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <desc id={`${id}-description`}>Evolución temporal de {points.length} periodos con valores entre 0 y {formatChartValue(maximum, kind)}.</desc>
      <line x1="8" y1="88" x2="92" y2="88" />
      <line x1="8" y1="16" x2="8" y2="88" />
      <polyline points={points.map((item) => `${item.x},${item.y}`).join(' ')} />
      {points.map((item) => <g key={item.label}><circle cx={item.x} cy={item.y} r="2.2" /><title>{item.label}: {formatChartValue(item.value, kind)}</title></g>)}
    </svg> : <ChartEmpty detail="no existe una serie temporal con 2 o más periodos" />}
    <figcaption>La línea aparece únicamente cuando el RPC entrega una serie temporal real.</figcaption>
  </figure>;
}

function RadarChart({ id, title, rows }: { id: string; title: string; rows: Record<string, unknown>[] }) {
  const candidates = rows.flatMap((row) => {
    const tool = valueFrom(row, 'tool', 'tool_key', 'resource');
    const completion = numeric(row.completion_rate);
    const abandonment = numeric(row.abandonment_rate);
    const scroll = numeric(row.avg_scroll_percent);
    return tool !== null && completion !== null && abandonment !== null && scroll !== null
      ? [{ label: String(tool), values: [Math.min(100, completion), Math.max(0, 100 - Math.min(100, abandonment)), Math.min(100, scroll)] }]
      : [];
  }).slice(0, 5);
  const center = 60;
  const radius = 42;
  const axes = [
    { label: 'Finalización', angle: -Math.PI / 2 },
    { label: 'Retención', angle: Math.PI / 6 },
    { label: 'Scroll', angle: Math.PI * 5 / 6 },
  ];
  const point = (value: number, angle: number) => {
    const distance = radius * value / 100;
    return `${center + Math.cos(angle) * distance},${center + Math.sin(angle) * distance}`;
  };
  return <figure className={styles.chart} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{title}</h3>
    {candidates.length >= 3 ? <div className={styles.radarLayout}>
      <svg className={styles.radar} viewBox="0 0 120 120" role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <desc id={`${id}-description`}>Comparación normalizada de finalización, retención y scroll para {candidates.length} herramientas.</desc>
        {[25, 50, 75, 100].map((level) => <polygon key={level} className={styles.radarGrid} points={axes.map((axis) => point(level, axis.angle)).join(' ')} />)}
        {axes.map((axis) => <line key={axis.label} className={styles.radarGrid} x1={center} y1={center} x2={point(100, axis.angle).split(',')[0]} y2={point(100, axis.angle).split(',')[1]} />)}
        {candidates.map((tool, index) => <polygon key={tool.label} className={styles.radarSeries} stroke={CHART_COLORS[index]} fill={CHART_COLORS[index]}
          points={tool.values.map((value, axisIndex) => point(value, axes[axisIndex].angle)).join(' ')}><title>{tool.label}: finalización {percentage(tool.values[0])}, retención {percentage(tool.values[1])}, scroll {percentage(tool.values[2])}</title></polygon>)}
      </svg>
      <ul className={styles.chartLegend}>{candidates.map((tool, index) => <li key={tool.label}><span style={{ backgroundColor: CHART_COLORS[index] }} aria-hidden="true" /><span>{tool.label}</span></li>)}</ul>
    </div> : <ChartEmpty detail="se requieren 3 herramientas con métricas normalizadas comparables" />}
    <figcaption>Escala común 0-100: finalización, retención (100 menos abandono) y profundidad de scroll.</figcaption>
  </figure>;
}
function currentView(window: DashboardWindow): ViewKey {
  const value = (window as DashboardWindow & { view?: string }).view;
  return VIEWS.some((item) => item.key === value) ? value as ViewKey : 'summary';
}
function queryHref(window: DashboardWindow, updates: Record<string, string | number>): string {
  const query = new URLSearchParams({ from: window.from.slice(0, 10), to: window.to.slice(0, 10), dataset: window.dataset });
  const filters = {
    email_step: window.filters.emailStep, variant: window.filters.variant, lot: window.filters.lot,
    hour: window.filters.hour, company_size: window.filters.companySize, tool: window.filters.tool,
    copy_key: window.filters.copyKey,
  };
  for (const [key, value] of Object.entries(filters)) if (value !== null) query.set(key, String(value));
  for (const [key, value] of Object.entries(updates)) query.set(key, String(value));
  return `/?${query.toString()}`;
}
function exportHref(window: DashboardWindow, format: 'csv' | 'xlsx'): string {
  const query = new URLSearchParams({
    format,
    from: window.from.slice(0, 10),
    to: window.to.slice(0, 10),
  });
  const filters = {
    email_step: window.filters.emailStep,
    variant: window.filters.variant,
    lot: window.filters.lot,
    hour: window.filters.hour,
    company_size: window.filters.companySize,
    tool: window.filters.tool,
    copy_key: window.filters.copyKey,
  };
  for (const [key, value] of Object.entries(filters)) {
    if (value !== null) query.set(key, String(value));
  }
  return `/api/dashboard/export?${query.toString()}`;
}
function StateCard({ title, detail }: { title: string; detail: string }) {
  return <main className={styles.stateShell}><section className={styles.stateCard}><span>GFS · DATA BRAIN</span><h1>{title}</h1><p>{detail}</p></section></main>;
}

export function OperationalDashboard(props: Props) {
  if (props.state === 'configuration_error') return <StateCard title="Configuración incompleta" detail={`Faltan estas variables o no son válidas: ${props.missing.join(', ')}. Configúralas y vuelve a cargar la página.`} />;
  if (props.state === 'access_denied') return <StateCard title="Acceso no autorizado" detail="No pudimos validar tu acceso. Comprueba la cuenta autorizada y vuelve a intentarlo." />;
  if (props.state === 'access_or_data_error') return <StateCard title="Dashboard no disponible" detail="No pudimos cargar los datos. Comprueba el rol y la migración RPC y vuelve a intentarlo." />;

  const { summary, sample, window, integrations } = props;
  const view = currentView(window);
  const funnel = record(summary.funnel);
  const journey = record(summary.journey);
  const transactional = record(summary.transactional);
  const campaign = record(summary.campaign);
  const health = record(summary.health);
  const control = record(health.control);
  const intelligence = record(props.intelligence);
  const overview = record(intelligence.overview);
  const revenue = record(intelligence.revenue);
  const quality = record(intelligence.quality);
  const recommendations = records(intelligence.recommendations);
  const availableFilters = record(intelligence.available_filters);
  const filterOptions = (key: string): string[] => Array.isArray(availableFilters[key])
    ? availableFilters[key].filter((value): value is string | number => typeof value === 'string' || typeof value === 'number').map(String)
    : [];
  const freshnessSeconds = Math.max(0, Math.round((Date.now() - Date.parse(summary.meta.generated_at)) / 1_000));
  const fresh = freshnessSeconds <= summary.meta.freshness_target_seconds;
  const coreTotal = count(funnel, 'leads') + count(journey, 'events') + count(campaign, 'contacts');
  const allowedDatasets = dashboardDatasetsForRole(summary.meta.role);
  const headers = sample?.rows.length ? Array.from(new Set<string>(sample.rows.flatMap((row: Record<string, unknown>) => Object.keys(row)))).slice(0, 10) : [];
  const pageHref = (page: number) => queryHref(window, { view, page });

  return <><a className={styles.skipLink} href="#main-content">Ir al contenido principal</a><main id="main-content" className={styles.shell}>
    <header className={styles.hero}>
      <div><span>GFS · DATA BRAIN</span><h1>Inteligencia de campaña FUNDAE</h1><p>Decisiones de campaña, journey y revenue con trazabilidad y control operativo.</p></div>
      <div className={styles.statuses}><strong>{ROLE_LABELS[summary.meta.role]}</strong><small className={fresh ? styles.ok : styles.warn}>{fresh ? 'Datos frescos' : 'Frescura degradada'} · {freshnessSeconds}s</small></div>
    </header>
    <nav className={styles.viewNav} aria-label="Áreas de Data Brain">
      {VIEWS.map((item) => <Link key={item.key} href={queryHref(window, { view: item.key })} aria-current={view === item.key ? 'page' : undefined}><strong>{item.label}</strong><small>{item.description}</small></Link>)}
    </nav>
    <form className={styles.filters} method="get" aria-label="Filtros del dashboard">
      <input type="hidden" name="view" value={view} />
      <label>Fecha inicial<input type="date" name="from" defaultValue={window.from.slice(0, 10)} /></label>
      <label>Fecha final (sin incluir)<input type="date" name="to" defaultValue={window.to.slice(0, 10)} /></label>
      <label>Email<select name="email_step" defaultValue={window.filters.emailStep ?? ''}><option value="">Todos</option>{filterOptions('email_steps').map((value) => <option key={value} value={value}>Email {value}</option>)}</select></label>
      <label>Variante<select name="variant" defaultValue={window.filters.variant ?? ''}><option value="">Todas</option>{filterOptions('variants').map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Lote<select name="lot" defaultValue={window.filters.lot ?? ''}><option value="">Todos</option>{filterOptions('lots').map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Hora Madrid<select name="hour" defaultValue={window.filters.hour ?? ''}><option value="">Todas</option>{filterOptions('hours').map((value) => <option key={value} value={value}>{value}:00</option>)}</select></label>
      <label>Tamaño de empresa<select name="company_size" defaultValue={window.filters.companySize ?? ''}><option value="">Todos</option>{filterOptions('company_sizes').map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Herramienta<select name="tool" defaultValue={window.filters.tool ?? ''}><option value="">Todas</option>{filterOptions('tools').map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Copy<select name="copy_key" defaultValue={window.filters.copyKey ?? ''}><option value="">Todos</option>{filterOptions('copy_keys').map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      {summary.meta.role !== 'read_only' && <label>Tabla de detalle<select name="dataset" defaultValue={window.dataset}>{allowedDatasets.map((key) => <option key={key} value={key}>{DATASET_LABELS[key]}</option>)}</select></label>}
      <div className={styles.filterActions}>
        <Link className={styles.exportAction} href={exportHref(window, 'csv')}>Exportar CSV</Link>
        <Link className={styles.exportAction} href={exportHref(window, 'xlsx')}>Exportar Excel</Link>
        <Link className={styles.secondaryAction} href={`/?view=${view}`}>Restablecer filtros</Link>
        <button type="submit">Aplicar filtros</button>
      </div>
    </form>
    {props.partialError && <section className={styles.partial} role="status" aria-live="polite">No pudimos cargar todos los datos. {props.partialError} Revisa la conexión y vuelve a aplicar los filtros.</section>}
    {!fresh && <section className={styles.partial} role="status" aria-live="polite">Los datos superan el objetivo de actualización de 60 segundos. Actualiza la vista o revisa la conexión.</section>}
    {coreTotal === 0 && <section className={styles.emptyState}><h2>Sin datos en este periodo</h2><p>Amplía las fechas o restablece los filtros.</p></section>}

    {view === 'summary' && <section className={styles.workspace} aria-labelledby="summary-title">
      <header className={styles.sectionHeader}><div><span>RESUMEN EJECUTIVO</span><h2 id="summary-title">Qué está funcionando y qué requiere atención</h2></div><p>Las tasas solo aparecen cuando existe un denominador verificable.</p></header>
      <div className={styles.chartsGrid}>
        <FunnelChart id="summary-funnel" title="Embudo de campaña" rows={records(intelligence.funnel)} />
        <LineChart id="summary-timeline" title="Envíos por día" rows={records(intelligence.timeline ?? intelligence.time_series)} valueKeys={['sent']} />
        <DonutChart id="summary-data-composition" title="Composición de eventos" caption="Distribución real entre eventos de producción y de prueba."
          data={chartData([
            { label: 'Producción', value: quality.production_events },
            { label: 'Prueba', value: quality.test_events },
          ], ['label'], ['value'])} />
      </div>
      <div className={styles.kpis}>
        <article><span>Contactos de campaña</span><strong>{display(campaign.contacts)}</strong><small>Base disponible en servidor</small></article>
        <article><span>Ejecuciones previstas</span><strong>{display(valueFrom(overview, 'planned', 'planned_executions') ?? record(campaign.executions_by_status).planned)}</strong><small>Campaña planificada</small></article>
        <article><span>Sesiones atribuidas</span><strong>{display(valueFrom(overview, 'attributed_sessions', 'sessions'))}</strong><small>Vínculo email a landing</small></article>
        <article><span>Pipeline esperado</span><strong>{currency(valueFrom(revenue, 'expected_value', 'weighted_pipeline_value'))}</strong><small>Importe ponderado</small></article>
      </div>
      <div className={styles.rateGrid}>
        <RateCard label="Entrega" value={valueFrom(overview, 'delivery_rate')} detail="Entregados / enviados" />
        <RateCard label="Clic" value={valueFrom(overview, 'click_rate')} detail="Contactos con clic / entregados" />
        <RateCard label="Respuesta positiva" value={valueFrom(overview, 'positive_reply_rate')} detail="Positivas / entregados" />
        <RateCard label="Reunión" value={valueFrom(overview, 'meeting_rate')} detail="Reuniones / alcanzados" />
      </div>
      <div className={styles.decisionGrid}>
        <article className={styles.card}><h3>Recomendaciones</h3>{recommendations.length ? <ol className={styles.recommendations}>{recommendations.slice(0, 5).map((item, index) => <li key={index}><strong>{display(valueFrom(item, 'title', 'signal'))}</strong><span>{display(valueFrom(item, 'detail', 'recommendation'))}</span></li>)}</ol> : <p className={styles.empty}>Las recomendaciones aparecerán cuando exista una muestra suficiente.</p>}</article>
        <article className={styles.card}><h3>Calidad del dato</h3><dl className={styles.breakdown}>
          <div><dt>Atribución al email</dt><dd>{percentage(valueFrom(quality, 'email_attribution_rate', 'campaign_attribution_rate'))}</dd></div>
          <div><dt>Eventos reales</dt><dd>{display(valueFrom(quality, 'production_events', 'real_events'))}</dd></div>
          <div><dt>Eventos de prueba</dt><dd>{display(quality.test_events)}</dd></div>
          <div><dt>Registros incompletos</dt><dd>{display(valueFrom(quality, 'incomplete_records', 'unattributed_events'))}</dd></div>
        </dl></article>
      </div>
      <HighIntentTable rows={records(intelligence.high_intent_contacts)} />
    </section>}

    {view === 'campaign' && <section className={styles.workspace} aria-labelledby="campaign-title">
      <header className={styles.sectionHeader}><div><span>CAMPAÑA</span><h2 id="campaign-title">Emails, variantes y momento de envío</h2></div><p>Comparación con volumen y muestra visible; no declara ganadores prematuros.</p></header>
      <div className={styles.kpis}>
        <article><span>Contactos</span><strong>{display(campaign.contacts)}</strong><small>Base cargada</small></article>
        <article><span>Suprimidos</span><strong>{display(campaign.suppressed)}</strong><small>Baja, oposición, rebote o stop</small></article>
        <article><span>Bloqueos vencidos</span><strong>{display(health.expired_contact_locks)}</strong><small>Proceso de campaña</small></article>
      </div>
      <div className={styles.chartsGrid}>
        <BarChart id="email-performance-chart" title="Clic por email" caption="Tasa de clic sobre entregados por paso de la secuencia." kind="percentage"
          data={chartData(records(intelligence.by_email), ['email_step'], ['click_rate'])} />
        <BarChart id="variant-performance-chart" title="Conversión por variante" caption="Tasa de contactos cualificados por variante; interpreta junto al intervalo de confianza de la tabla." kind="percentage"
          data={chartData(records(intelligence.by_variant), ['variant'], ['conversion_rate'])} />
        <BarChart id="hour-performance-chart" title="Cualificación por hora" caption="Tasa de cualificación por hora de envío en Europe/Madrid." kind="percentage"
          data={chartData(records(intelligence.by_hour), ['hour'], ['qualified_rate'])} />
        <BarChart id="copy-performance-chart" title="Cualificación por copy" caption="Comparación por copy con muestra mínima visible en la tabla." kind="percentage"
          data={chartData(records(intelligence.by_copy), ['copy_key'], ['qualified_rate'])} />
      </div>
      <div className={styles.analysisGrid}>
        <RateTable title="Rendimiento por email" rows={records(intelligence.by_email)} dimension="email" />
        <RateTable title="Rendimiento por copy" rows={records(intelligence.by_copy)} dimension="copy" />
        <RateTable title="Rendimiento por variante" rows={records(intelligence.by_variant)} dimension="variant" />
        <RateTable title="Actividad por hora (Madrid)" rows={records(intelligence.by_hour)} dimension="hour" />
        <RateTable title="Comparación entre campañas" rows={records(intelligence.by_campaign)} dimension="campaign" />
      </div>
      <div className={styles.grid}>
        <Breakdown title="Email 1-5" value={campaign.by_step} /><Breakdown title="Variantes" value={campaign.by_variant} /><Breakdown title="Lotes" value={campaign.by_lot} />
        <Breakdown title="Rendimiento por email" value={campaign.performance_by_email} /><Breakdown title="Actividad por hora" value={campaign.events_by_hour} /><Breakdown title="Clics y herramientas" value={campaign.engagement_by_action} />
        <Breakdown title="Conversiones" value={campaign.conversions} /><Breakdown title="Eventos campaña" value={campaign.events_by_name} />
      </div>
      <p className={styles.disclaimer}>Las aperturas son orientativas. Clics, descargas, respuestas, reuniones y conversiones usan evidencia confirmada cuando está disponible.</p>
    </section>}

    {view === 'journey' && <section className={styles.workspace} aria-labelledby="journey-title">
      <header className={styles.sectionHeader}><div><span>JOURNEY Y HERRAMIENTAS</span><h2 id="journey-title">Dónde avanza y dónde abandona cada contacto</h2></div><p>Comportamiento agregado y consentido; sin exponer datos personales.</p></header>
      <div className={styles.kpis}>
        <article><span>Visitantes únicos</span><strong>{display(journey.unique_visitors)}</strong><small>Identidad seudónima disponible</small></article>
        <article><span>Sesiones únicas</span><strong>{display(journey.unique_sessions)}</strong><small>Periodo filtrado</small></article>
        <article><span>Eventos journey</span><strong>{display(journey.events)}</strong><small>Eventos disponibles</small></article>
        <article><span>Tiempo activo medio</span><strong>{display(valueFrom(record(intelligence.journey), 'average_active_seconds', 'avg_active_seconds'))} s</strong><small>Excluye tiempo inactivo</small></article>
      </div>
      <div className={styles.chartsGrid}>
        <BarChart id="tool-completion-chart" title="Finalización por herramienta" caption="Tasa de finalización sobre sesiones iniciadas para cada herramienta." kind="percentage"
          data={chartData(records(intelligence.tools), ['tool'], ['completion_rate'])} />
        <RadarChart id="tool-radar-chart" title="Perfil comparado de herramientas" rows={records(intelligence.tools)} />
      </div>
      <RateTable title="Inicio, finalización y abandono por herramienta" rows={records(intelligence.tools)} dimension="tool" />
      <div className={styles.grid}>
        <Breakdown title="Abandono por sección" value={Object.fromEntries(records(intelligence.abandonment_by_section).map((row) => [`${display(row.tool)} · ${display(row.section)}`, row.abandoned]))} />
        <Breakdown title="Fuentes y dominios" value={Object.fromEntries(records(record(intelligence.traffic).by_domain_source).map((row) => [`${display(row.domain)} · ${display(row.source)}`, row.sessions]))} />
        <Breakdown title="Clics por enlace" value={Object.fromEntries(records(record(intelligence.traffic).by_link).map((row) => [String(row.link ?? 'unattributed'), row.clicks]))} />
        <Breakdown title="Acciones en landing" value={funnel.events_by_name} /><Breakdown title="Interacción por herramienta" value={journey.by_magnet} /><Breakdown title="Leads por magnet" value={funnel.by_magnet} /><Breakdown title="Scoring 0-39 / 40-59 / 60-79 / 80+" value={funnel.by_score_band} />
      </div>
    </section>}

    {view === 'revenue' && <section className={styles.workspace} aria-labelledby="revenue-title">
      <header className={styles.sectionHeader}><div><span>PIPELINE Y REVENUE</span><h2 id="revenue-title">De la interacción al resultado comercial</h2></div><p>El pipeline interno es la fuente operativa; un CRM externo no es requisito.</p></header>
      <div className={styles.kpis}>
        <article><span>Pipeline estimado</span><strong>{currency(valueFrom(revenue, 'estimated_value', 'pipeline_value') ?? campaign.pipeline_value)}</strong><small>Importe abierto</small></article>
        <article><span>Pipeline esperado</span><strong>{currency(valueFrom(revenue, 'expected_value', 'weighted_pipeline_value'))}</strong><small>Importe × probabilidad</small></article>
        <article><span>Ingresos cerrados</span><strong>{currency(valueFrom(revenue, 'closed_won_value', 'revenue'))}</strong><small>Oportunidades ganadas</small></article>
        <article><span>Conversión a oportunidad</span><strong>{percentage(revenue.opportunity_rate)}</strong><small>Oportunidades / alcanzados</small></article>
      </div>
      <div className={styles.chartsGrid}>
        <FunnelChart id="pipeline-funnel" title="Embudo comercial" rows={records(intelligence.pipeline_by_stage)} />
        <DonutChart id="pipeline-composition" title="Composición del pipeline" caption="Distribución real de oportunidades registradas por etapa."
          data={chartData(records(intelligence.pipeline_by_stage), ['stage'], ['opportunities'])} />
      </div>
      <div className={styles.grid}>
        <Breakdown title="Pipeline por etapa" value={keyedValues(intelligence.pipeline_by_stage, 'stage', 'opportunities')} />
        <Breakdown title="Conversiones" value={campaign.conversions} />
        <Breakdown title="Origen de oportunidades" value={keyedValues(revenue.by_source, 'source', 'weighted_amount')} />
        <Breakdown title="Motivos de cierre" value={keyedValues(revenue.by_outcome_reason, 'outcome_reason', 'outcomes')} />
      </div>
      <RateTable title="Revenue por campaña" rows={records(intelligence.by_campaign)} dimension="campaign" />
      <section className={styles.contextNotice}><h3>Registro comercial activo</h3><p>El pipeline interno acepta etapas, importes, probabilidad, fecha prevista y motivo mediante un endpoint auditado para administradores y operadores.</p></section>
    </section>}

    {view === 'operations' && <section className={styles.workspace} aria-labelledby="operations-title">
      <header className={styles.sectionHeader}><div><span>OPERACIONES</span><h2 id="operations-title">Salud, seguridad y trazabilidad</h2></div><p>Estado técnico separado de los indicadores comerciales.</p></header>
      <div className={styles.kpis}>
        <article><span>Claims</span><strong>{display(transactional.claims_total)}</strong><small>{display(transactional.claims_unconsumed)} sin consumir</small></article>
        <article><span>Mailbox activos</span><strong>{display(health.mailboxes_active)}</strong><small>{display(health.mailboxes_blocked)} bloqueados</small></article>
        <article><span>Reservas vencidas</span><strong>{display(health.expired_reservation_leases)}</strong><small>Requieren recuperación</small></article>
        <article><span>Envíos Graph ambiguos</span><strong>{display(health.outbox_ambiguous)}</strong><small>{display(health.outbox_in_flight)} en vuelo</small></article>
      </div>
      <div className={styles.grid}>
        <Breakdown title="Dispatch por estado" value={transactional.dispatch_by_status} /><Breakdown title="Reservas por estado" value={transactional.reservations_by_status} /><Breakdown title="Outbox Graph por estado" value={transactional.graph_by_state} /><Breakdown title="Eventos transaccionales" value={transactional.tx_events_by_name} /><Breakdown title="Cola legacy" value={health.queue_by_status} />
        <article className={styles.card}><h3>Interruptores de seguridad</h3><dl className={styles.breakdown}><div><dt>Envío general</dt><dd>{display(control.master_enabled)}</dd></div><div><dt>Transaccional</dt><dd>{display(control.transactional_enabled)}</dd></div><div><dt>Campaña fría</dt><dd>{display(control.cold_enabled)}</dd></div><div><dt>Cadencia mínima</dt><dd>{display(control.minimum_spacing_seconds)} s</dd></div><div><dt>Límite diario</dt><dd>{display(control.cold_daily_limit)}</dd></div></dl></article>
        <article className={styles.card}><h3>Integraciones configuradas</h3><dl className={styles.breakdown}>{Object.entries(integrations).map(([key, enabled]) => <div key={key}><dt>{key}</dt><dd>{enabled ? 'Configurada según flag' : 'OFF o sin configurar'}</dd></div>)}</dl></article>
        <article className={styles.card}><h3>RBAC y auditoría</h3><p>Rol efectivo: <strong>{ROLE_LABELS[summary.meta.role]}</strong>.</p><p>El acceso registra actor seudónimo, alcance y request ID.</p></article>
      </div>
      {summary.meta.role !== 'read_only' && <section className={styles.sampleSection}><header><span>DETALLE AUDITABLE</span><h3>{sample ? DATASET_LABELS[sample.dataset] : 'Detalle no disponible'}</h3></header>
        {sample?.rows.length ? <div className={styles.tableWrap}><table><thead><tr>{headers.map((header) => <th key={header}>{header.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{sample.rows.map((row, index) => <tr key={`${sample.dataset}-${index}`}>{headers.map((header) => <td key={header}>{display(row[header])}</td>)}</tr>)}</tbody></table></div> : <p className={styles.empty}>Sin filas para la página solicitada.</p>}
        {sample && <nav className={styles.pagination} aria-label="Paginación de muestra">{sample.offset > 0 ? <Link href={pageHref(Math.max(1, window.page - 1))}>Página anterior</Link> : <span />}<span>{sample.offset + 1}-{Math.min(sample.offset + sample.rows.length, sample.total)} de {sample.total}</span>{sample.has_more ? <Link href={pageHref(window.page + 1)}>Página siguiente</Link> : <span />}</nav>}
      </section>}
    </section>}
  </main></>;
}
