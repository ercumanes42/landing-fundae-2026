import Link from 'next/link';

import type {
  DashboardSampleResponse,
  DashboardSummaryResponse,
  DashboardWindow,
} from '@/lib/dashboard-data';
import { dashboardDatasetsForRole } from '@/lib/dashboard-data';
import styles from './OperationalDashboard.module.css';

type IntegrationState = {
  make: boolean;
  legacyRetry: boolean;
  outboundMaster: boolean;
  airtable: boolean;
  posthog: boolean;
  hubspot: boolean;
};

type Props =
  | { state: 'configuration_error'; missing: string[] }
  | { state: 'access_denied' }
  | { state: 'access_or_data_error' }
  | {
      state: 'ready';
      summary: DashboardSummaryResponse;
      sample: DashboardSampleResponse | null;
      window: DashboardWindow;
      integrations: IntegrationState;
      partialError: string | null;
    };

const ROLE_LABELS = {
  admin: 'Administrador',
  operator: 'Operador',
  auditor: 'Auditor',
  read_only: 'Solo lectura',
} as const;
const DATASET_LABELS = {
  leads: 'Leads seudonimizados',
  events: 'Journey consentido',
  reservations: 'Reservas mailbox',
  transactional_events: 'Eventos transaccionales',
  campaign_executions: 'Ejecuciones campaña',
  graph_events: 'Eventos Graph',
  audit: 'Auditoría de acceso',
} as const;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function count(section: Record<string, unknown>, key: string): number {
  const value = section[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return new Intl.NumberFormat('es-ES').format(value);
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  return JSON.stringify(value);
}

function Breakdown({ title, value }: { title: string; value: unknown }) {
  const rows = Object.entries(record(value)).sort(([, a], [, b]) => Number(b) - Number(a));
  return <article className={styles.card}>
    <h3>{title}</h3>
    {rows.length ? <dl className={styles.breakdown}>{rows.map(([key, amount]) =>
      <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{display(amount)}</dd></div>,
    )}</dl> : <p className={styles.empty}>Sin registros para el periodo.</p>}
  </article>;
}

function pageHref(window: DashboardWindow, page: number): string {
  const query = new URLSearchParams({
    from: window.from.slice(0, 10),
    to: window.to.slice(0, 10),
    dataset: window.dataset,
    page: String(page),
  });
  return `/?${query.toString()}`;
}

function StateCard({ title, detail }: { title: string; detail: string }) {
  return <main className={styles.stateShell}>
    <section className={styles.stateCard}><span>GFS · DATA BRAIN</span><h1>{title}</h1><p>{detail}</p></section>
  </main>;
}

export function OperationalDashboard(props: Props) {
  if (props.state === 'configuration_error') {
    return <StateCard title="Configuración incompleta" detail={`Variables requeridas ausentes o inválidas: ${props.missing.join(', ')}.`} />;
  }
  if (props.state === 'access_denied') {
    return <StateCard title="Acceso no autorizado" detail="La identidad del dashboard no pudo validarse. No se consultó ningún dataset." />;
  }
  if (props.state === 'access_or_data_error') {
    return <StateCard title="Dashboard no disponible" detail="El rol no está provisionado o el RPC agregado no está disponible. El fallo permanece cerrado." />;
  }

  const { summary, sample, window, integrations } = props;
  const funnel = record(summary.funnel);
  const journey = record(summary.journey);
  const transactional = record(summary.transactional);
  const campaign = record(summary.campaign);
  const health = record(summary.health);
  const control = record(health.control);
  const freshnessSeconds = Math.max(0, Math.round((Date.now() - Date.parse(summary.meta.generated_at)) / 1_000));
  const fresh = freshnessSeconds <= summary.meta.freshness_target_seconds;
  const coreTotal = count(funnel, 'leads') + count(journey, 'events') + count(campaign, 'contacts');
  const allowedDatasets = dashboardDatasetsForRole(summary.meta.role);
  const headers: string[] = sample?.rows.length
    ? Array.from(new Set<string>(sample.rows.flatMap((row: Record<string, unknown>) => Object.keys(row)))).slice(0, 10)
    : [];

  return <main className={styles.shell}>
    <header className={styles.hero}>
      <div><span>GFS · DATA BRAIN</span><h1>Control operativo FUNDAE</h1><p>Agregados server-side, muestras acotadas y acceso auditado.</p></div>
      <div className={styles.statuses}>
        <strong>{ROLE_LABELS[summary.meta.role]}</strong>
        <small className={fresh ? styles.ok : styles.warn}>{fresh ? 'Datos frescos' : 'Frescura degradada'} · {freshnessSeconds}s</small>
      </div>
    </header>

    <form className={styles.filters} method="get">
      <label>Desde<input type="date" name="from" defaultValue={window.from.slice(0, 10)} /></label>
      <label>Hasta exclusivo<input type="date" name="to" defaultValue={window.to.slice(0, 10)} /></label>
      {summary.meta.role !== 'read_only' && <label>Muestra<select name="dataset" defaultValue={window.dataset}>
        {allowedDatasets.map((key) => <option key={key} value={key}>{DATASET_LABELS[key]}</option>)}
      </select></label>}
      <button type="submit">Actualizar</button>
    </form>

    {props.partialError && <section className={styles.partial} role="status">{props.partialError}</section>}
    {!fresh && <section className={styles.partial} role="status">La frescura supera el objetivo de 60 segundos; no se oculta la degradación.</section>}
    {coreTotal === 0 && <section className={styles.emptyState}><h2>Sin datos en este periodo</h2><p>No se sustituyen ausencias por ceros inferidos.</p></section>}

    <section className={styles.kpis} aria-label="Resumen ejecutivo">
      <article><span>Leads</span><strong>{display(funnel.leads)}</strong><small>Fuente: leads · periodo filtrado</small></article>
      <article><span>Eventos journey</span><strong>{display(journey.events)}</strong><small>Denominador: eventos consentidos disponibles</small></article>
      <article><span>Contactos campaña</span><strong>{display(campaign.contacts)}</strong><small>Universo server-side</small></article>
      <article><span>Pipeline</span><strong>{display(campaign.pipeline_value)} €</strong><small>Solo contactos con oportunidad</small></article>
    </section>

    <section className={styles.section}><header><span>FUNNEL Y JOURNEY</span><h2>Cobertura y comportamiento</h2></header>
      <div className={styles.grid}>
        <Breakdown title="Leads por magnet" value={funnel.by_magnet} />
        <Breakdown title="Clasificación" value={funnel.by_classification} />
        <Breakdown title="Scoring 0–39 / 40–59 / 60–79 / 80+" value={funnel.by_score_band} />
        <article className={styles.card}><h3>Journey consentido</h3><dl className={styles.breakdown}>
          <div><dt>Visitantes únicos</dt><dd>{display(journey.unique_visitors)}</dd></div>
          <div><dt>Sesiones únicas</dt><dd>{display(journey.unique_sessions)}</dd></div>
          <div><dt>Eventos consentidos</dt><dd>{display(journey.consented_events)}</dd></div>
          <div><dt>Último evento</dt><dd>{display(journey.latest_event_at)}</dd></div>
        </dl></article>
      </div>
    </section>

    <section className={styles.section}><header><span>TRANSACCIONAL</span><h2>Claims, mailbox, reservas y eventos</h2></header>
      <div className={styles.kpis}>
        <article><span>Claims</span><strong>{display(transactional.claims_total)}</strong><small>{display(transactional.claims_unconsumed)} sin consumir</small></article>
        <article><span>Mailbox activos</span><strong>{display(health.mailboxes_active)}</strong><small>{display(health.mailboxes_blocked)} bloqueados</small></article>
        <article><span>Leases vencidos</span><strong>{display(health.expired_reservation_leases)}</strong><small>Reservas que requieren recuperación</small></article>
        <article><span>Graph ambiguo</span><strong>{display(health.outbox_ambiguous)}</strong><small>{display(health.outbox_in_flight)} en vuelo</small></article>
      </div>
      <div className={styles.grid}>
        <Breakdown title="Dispatch por estado" value={transactional.dispatch_by_status} />
        <Breakdown title="Reservas por estado" value={transactional.reservations_by_status} />
        <Breakdown title="Outbox Graph por estado" value={transactional.graph_by_state} />
        <Breakdown title="Eventos transaccionales" value={transactional.tx_events_by_name} />
      </div>
    </section>

    <section className={styles.section}><header><span>CAMPAÑA</span><h2>Cadencia, stops y CRM</h2></header>
      <div className={styles.kpis}>
        <article><span>Suprimidos</span><strong>{display(campaign.suppressed)}</strong><small>Baja/oposición/rebote/stop</small></article>
        <article><span>HubSpot sin vincular</span><strong>{display(campaign.hubspot_unlinked)}</strong><small>Sin interpretar como sincronizado</small></article>
        <article><span>Locks vencidos</span><strong>{display(health.expired_contact_locks)}</strong><small>Worker campaña</small></article>
      </div>
      <div className={styles.grid}>
        <Breakdown title="Carriles" value={campaign.by_lane} />
        <Breakdown title="Lotes" value={campaign.by_lot} />
        <Breakdown title="Email 1–5" value={campaign.by_step} />
        <Breakdown title="Ejecuciones" value={campaign.executions_by_status} />
        <Breakdown title="Eventos campaña" value={campaign.events_by_name} />
      </div>
    </section>

    <section className={styles.section}><header><span>SALUD Y CONTROL</span><h2>Fail-closed y dependencias</h2></header>
      <div className={styles.grid}>
        <Breakdown title="Cola legacy" value={health.queue_by_status} />
        <article className={styles.card}><h3>Kill switches</h3><dl className={styles.breakdown}>
          <div><dt>Master</dt><dd>{display(control.master_enabled)}</dd></div>
          <div><dt>Transaccional</dt><dd>{display(control.transactional_enabled)}</dd></div>
          <div><dt>Campaña fría</dt><dd>{display(control.cold_enabled)}</dd></div>
          <div><dt>Cadencia mínima</dt><dd>{display(control.minimum_spacing_seconds)} s</dd></div>
          <div><dt>Límite diario</dt><dd>{display(control.cold_daily_limit)}</dd></div>
        </dl></article>
        <article className={styles.card}><h3>Integraciones configuradas</h3><dl className={styles.breakdown}>
          {Object.entries(integrations).map(([key, enabled]) => <div key={key}><dt>{key}</dt><dd>{enabled ? 'Configurada/activa según flag' : 'OFF o sin configurar'}</dd></div>)}
        </dl></article>
        <article className={styles.card}><h3>RBAC y auditoría</h3><p>Rol efectivo: <strong>{ROLE_LABELS[summary.meta.role]}</strong>.</p><p>Todo acceso agregado o de muestra registra actor seudónimo, alcance y request ID.</p></article>
      </div>
    </section>

    {summary.meta.role !== 'read_only' && <section className={styles.section}><header><span>MUESTRA ACOTADA</span><h2>{sample ? DATASET_LABELS[sample.dataset] : 'Muestra no disponible'}</h2></header>
      {sample?.rows.length ? <div className={styles.tableWrap}><table><thead><tr>{headers.map((header) => <th key={header}>{header.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{sample.rows.map((row, index) => <tr key={`${sample.dataset}-${index}`}>{headers.map((header) => <td key={header}>{display(row[header])}</td>)}</tr>)}</tbody></table></div>
        : <p className={styles.empty}>Sin filas para la página solicitada.</p>}
      {sample && <nav className={styles.pagination} aria-label="Paginación de muestra">
        {sample.offset > 0 ? <Link href={pageHref(window, Math.max(1, window.page - 1))}>Anterior</Link> : <span />}
        <span>{sample.offset + 1}–{Math.min(sample.offset + sample.rows.length, sample.total)} de {sample.total}</span>
        {sample.has_more ? <Link href={pageHref(window, window.page + 1)}>Siguiente</Link> : <span />}
      </nav>}
    </section>}
  </main>;
}
