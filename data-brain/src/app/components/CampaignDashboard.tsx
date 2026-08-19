'use client';

import { useMemo, useState } from 'react';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import styles from './CampaignDashboard.module.css';
import { CampaignJourneyPanels } from './CampaignJourneyPanels';

ChartJS.register(BarElement, CategoryScale, LinearScale, Legend, Tooltip);

type FunnelCode = 'A' | 'B' | 'C' | 'D';

export interface CampaignDashboardData {
  campaigns: Array<{ id: string; external_id: string; name: string; status: string }>;
  contacts: Array<{
    id: string;
    campaign_id: string;
    external_contact_id: string;
    variant: string;
    magnet: string;
    lot: string;
    company_size: string | null;
    sequence_status: string;
    next_delivery_status: string;
    last_delivery_status: string | null;
    reply_type: string | null;
    deal_value: number | null;
    conditional_delivery: boolean;
    locked_at: string | null;
    lock_expires_at: string | null;
    last_error_code: string | null;
    cold_sequence_status?: string | null;
    transactional_status?: string | null;
    intent_sequence_status?: string | null;
    marketing_lane?: string | null;
    suppression_scope?: string | null;
    current_step?: number | null;
  }>;
  events: Array<{
    id: string;
    campaign_id: string;
    campaign_contact_id: string;
    event_name: string;
    occurred_at: string;
    properties?: Record<string, string | number | boolean | null>;
  }>;
  executions: Array<{
    id: string;
    campaign_id: string;
    campaign_contact_id: string;
    channel: string;
    capture_method: string;
    action_name: string;
    step: number | null;
    status: string;
    scheduled_for: string | null;
    planned_at: string | null;
    actual_at: string | null;
    failed_at: string | null;
    stopped_at: string | null;
    failure_code: string | null;
    stop_reason: string | null;
    created_at: string;
  }>;
  coverage?: {
    contactsComplete?: boolean;
    eventsComplete?: boolean;
    executionsComplete?: boolean;
    contactsLoaded?: number;
    eventsLoaded?: number;
    executionsLoaded?: number;
    contactsTotal?: number;
    eventsTotal?: number;
    executionsTotal?: number;
  };
  error?: string | null;
}

const FUNNELS: Array<{ code: FunnelCode; name: string; color: string }> = [
  { code: 'A', name: 'Checklist', color: '#302B7B' },
  { code: 'B', name: 'Calculadora', color: '#FF206E' },
  { code: 'C', name: 'Webinar', color: '#2F7D65' },
  { code: 'D', name: 'Autoevaluación', color: '#D69B2D' },
];

const RESOURCE_EVENTS = [
  'resource_completed',
  'checklist_downloaded',
  'calculator_completed',
  'webinar_registered',
  'review_submitted',
  'tool_completed',
  'pdf_downloaded',
];
const MEETING_EVENTS = ['meeting_booked', 'meeting_completed'];
const KNOWN_EVENTS = new Set([
  'landing_visit', 'resource_started', ...RESOURCE_EVENTS, ...MEETING_EVENTS,
  'opportunity_created', 'delivery_sent', 'delivery_error', 'reply_received',
  'bounce_hard', 'unsubscribe', 'crm_contact_updated', 'diagnostic_intent',
  'diagnostic_requested', 'positive_reply', 'transactional_delivery_sent',
  'delivery_scheduled', 'delivery_delivered', 'email_opened', 'link_clicked',
  'tool_started', 'tool_completed', 'pdf_downloaded',
]);

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function funnelForContact(contact: CampaignDashboardData['contacts'][number]): FunnelCode | null {
  const value = normalize(`${contact.variant} ${contact.magnet}`);
  if (value.includes('checklist')) return 'A';
  if (value.includes('calculadora') || value.includes('calculator')) return 'B';
  if (value.includes('webinar')) return 'C';
  if (value.includes('autoevaluacion') || value.includes('interactive_checklist') || value.includes('revision rapida')) return 'D';
  return null;
}

function uniqueFor(events: CampaignDashboardData['events'], names: string[]): Set<string> {
  return new Set(events.filter((event) => names.includes(event.event_name)).map((event) => event.campaign_contact_id));
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

function metricRate(numerator: number, denominator: number): string {
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : '—';
}

function stepFromEvent(event: CampaignDashboardData['events'][number]): number | null {
  const propertyStep = Number(
    event.properties?.step ??
    event.properties?.current_step ??
    event.properties?.sent_step,
  );
  if (Number.isInteger(propertyStep) && propertyStep >= 1 && propertyStep <= 5) return propertyStep;

  const match = event.event_name.match(/(?:email|step|paso)[_-]?([1-5])/i);
  return match ? Number(match[1]) : null;
}

export function CampaignDashboard({ data }: { data: CampaignDashboardData }) {
  const [campaignId, setCampaignId] = useState('all');
  const [funnel, setFunnel] = useState<'all' | FunnelCode>('all');
  const [lot, setLot] = useState('all');
  const [companySize, setCompanySize] = useState('all');

  const cohortContacts = useMemo(() => data.contacts.filter((contact) => (
    (campaignId === 'all' || contact.campaign_id === campaignId) &&
    (lot === 'all' || contact.lot === lot) &&
    (companySize === 'all' || (contact.company_size || 'Sin dato') === companySize)
  )), [campaignId, companySize, data.contacts, lot]);
  const filteredContacts = useMemo(
    () => cohortContacts.filter((contact) => funnel === 'all' || funnelForContact(contact) === funnel),
    [cohortContacts, funnel],
  );

  const filteredContactIds = useMemo(() => new Set(filteredContacts.map((contact) => contact.id)), [filteredContacts]);
  const allContactIds = useMemo(() => new Set(data.contacts.map((contact) => contact.id)), [data.contacts]);
  const filteredEvents = useMemo(
    () => data.events.filter((event) => filteredContactIds.has(event.campaign_contact_id)),
    [data.events, filteredContactIds],
  );

  const delivered = uniqueFor(filteredEvents, ['delivery_delivered']);
  const replies = uniqueFor(filteredEvents, ['reply_received', 'positive_reply']);
  const resources = uniqueFor(filteredEvents, RESOURCE_EVENTS);
  const meetings = uniqueFor(filteredEvents, MEETING_EVENTS);
  const opportunities = uniqueFor(filteredEvents, ['opportunity_created']);
  filteredContacts
    .filter((contact) => Number(contact.deal_value) > 0)
    .forEach((contact) => opportunities.add(contact.id));
  const intent = uniqueFor(filteredEvents, ['diagnostic_intent', 'diagnostic_requested']);
  const transactional = uniqueFor(filteredEvents, ['transactional_delivery_sent']);
  filteredContacts
    .filter((contact) => normalize(contact.transactional_status || '') === 'sent')
    .forEach((contact) => transactional.add(contact.id));
  const stopped = filteredContacts.filter((contact) => ['stopped', 'detenida'].includes(normalize(contact.cold_sequence_status || contact.sequence_status))).length;
  const pipelineValue = filteredContacts
    .filter((contact) => opportunities.has(contact.id) || Number(contact.deal_value) > 0)
    .reduce((total, contact) => total + (Number(contact.deal_value) || 0), 0);

  const staleLocks = filteredContacts.filter((contact) => (
    normalize(contact.next_delivery_status) === 'locked' && contact.lock_expires_at &&
    new Date(contact.lock_expires_at).getTime() < Date.now()
  )).length;
  const errors = filteredContacts.filter((contact) => Boolean(contact.last_error_code)).length;
  const orphanEvents = data.events.filter((event) => !allContactIds.has(event.campaign_contact_id)).length;
  const unmappedContacts = filteredContacts.filter((contact) => !funnelForContact(contact)).length;
  const profileFields = filteredContacts.length * 3;
  const completedProfileFields = filteredContacts.reduce((total, contact) => (
    total + Number(Boolean(contact.variant)) + Number(Boolean(contact.lot)) + Number(Boolean(contact.company_size))
  ), 0);
  const profileCoverage = profileFields ? Math.round((completedProfileFields / profileFields) * 100) : 0;
  const recognizedEvents = filteredEvents.filter((event) => KNOWN_EVENTS.has(event.event_name) || stepFromEvent(event)).length;
  const eventCoverage = filteredEvents.length
    ? Math.round((recognizedEvents / filteredEvents.length) * 100)
    : null;

  const comparison = FUNNELS.map((definition) => {
    const contacts = cohortContacts.filter((contact) => funnelForContact(contact) === definition.code);
    const ids = new Set(contacts.map((contact) => contact.id));
    const events = data.events.filter((event) => ids.has(event.campaign_contact_id));
    return {
      ...definition,
      contacts: contacts.length,
      delivered: uniqueFor(events, ['delivery_delivered']).size,
      replies: uniqueFor(events, ['reply_received', 'positive_reply']).size,
      resources: uniqueFor(events, RESOURCE_EVENTS).size,
      meetings: uniqueFor(events, MEETING_EVENTS).size,
    };
  });

  const chartData = {
    labels: comparison.map((item) => `${item.code} · ${item.name}`),
    datasets: [
      { label: 'Contactos', data: comparison.map((item) => item.contacts), backgroundColor: '#302B7B', borderRadius: 5 },
      { label: 'Recursos', data: comparison.map((item) => item.resources), backgroundColor: '#FF206E', borderRadius: 5 },
      { label: 'Reuniones', data: comparison.map((item) => item.meetings), backgroundColor: '#2F7D65', borderRadius: 5 },
    ],
  };

  const steps = [1, 2, 3, 4, 5].map((step) => {
    const events = filteredEvents.filter((event) => stepFromEvent(event) === step);
    return { step, contacts: new Set(events.map((event) => event.campaign_contact_id)).size, measured: events.length > 0 };
  });
  const anyStepMeasured = steps.some((step) => step.measured);
  const contactsComplete = data.coverage?.contactsComplete === true;
  const eventsComplete = data.coverage?.eventsComplete === true;
  const dataComplete = contactsComplete && eventsComplete;
  const contactValue = (value: number): number | string => contactsComplete ? value : '>=' + value;
  const eventValue = (value: number): number | string => dataComplete ? value : '>=' + value;
  const pipelineDisplay = dataComplete ? formatCurrency(pipelineValue) : '>= ' + formatCurrency(pipelineValue);

  if (data.error) {
    return (
      <div className={styles.canvas}>
        <section className={styles.stateCard} role="alert">
          <strong>Datos de campaña no disponibles</strong>
          <p>{data.error}. No se muestran datos simulados.</p>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.canvas}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>GFS · DATA BRAIN</p>
          <h2>Control integral de campaña FUNDAE 2026</h2>
          <p>Cuatro funnels comparables, cinco emails y diagnóstico separado como intención comercial.</p>
        </div>
        <div className={dataComplete ? styles.healthOk : styles.healthWarn}>
          <span aria-hidden="true" />
          {dataComplete ? 'Cobertura completa' : 'Cobertura parcial'}
        </div>
      </header>

      <section className={styles.filters} aria-label="Filtros globales de campaña">
        <label>Campaña<select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="all">Todas</option>{data.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.external_id}</option>)}</select></label>
        <label>Funnel<select value={funnel} onChange={(event) => setFunnel(event.target.value as 'all' | FunnelCode)}><option value="all">A–D</option>{FUNNELS.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></label>
        <label>Lote<select value={lot} onChange={(event) => setLot(event.target.value)}><option value="all">Todos</option>{Array.from(new Set(data.contacts.map((contact) => contact.lot))).filter(Boolean).sort().map((item) => <option key={item} value={item}>Lote {item}</option>)}</select></label>
        <label>Tamaño<select value={companySize} onChange={(event) => setCompanySize(event.target.value)}><option value="all">Todos</option>{Array.from(new Set(data.contacts.map((contact) => contact.company_size || 'Sin dato'))).sort().map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </section>

      {!filteredContacts.length ? (
        <section className={styles.stateCard}><strong>Sin contactos para estos filtros</strong><p>Cambia uno o más filtros. No se sustituyen ausencias por ceros.</p></section>
      ) : (
        <>
          <section className={styles.kpis} aria-label="Resumen ejecutivo">
            {[
              ['Contactos', contactValue(filteredContacts.length), 'Universo filtrado'],
              ['Entregados', eventValue(delivered.size), `${metricRate(delivered.size, filteredContacts.length)} de contactos`],
              ['Respuestas', eventValue(replies.size), `${metricRate(replies.size, delivered.size)} de entregados`],
              ['Recursos', eventValue(resources.size), `${metricRate(resources.size, delivered.size)} de entregados`],
              ['Reuniones', eventValue(meetings.size), `${metricRate(meetings.size, resources.size)} de recursos`],
              ['Oportunidades', eventValue(opportunities.size), `${metricRate(opportunities.size, meetings.size)} de reuniones`],
              ['Pipeline', pipelineDisplay, 'Solo oportunidades registradas'],
            ].map(([label, value, note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}
          </section>

          <section className={styles.lanes} aria-label="Carriles operativos">
            <article><span className={styles.laneTag}>COLD</span><h3>Secuencia fría</h3><strong>{eventValue(delivered.size)} entregados</strong><p>{eventValue(replies.size)} respuestas · {contactValue(stopped)} detenidos</p></article>
            <article><span className={styles.laneTag}>TRANSACCIONAL</span><h3>Entrega de recurso</h3><strong>{transactional.size ? eventValue(transactional.size) : '—'}</strong><p>{transactional.size ? `${eventValue(transactional.size)} confirmados` : 'No medido aún'} · {eventValue(resources.size)} recursos completados</p></article>
            <article><span className={styles.laneTag}>INTENCIÓN</span><h3>Diagnóstico separado</h3><strong>{eventValue(intent.size)}</strong><p>{eventValue(meetings.size)} reuniones · {eventValue(opportunities.size)} oportunidades</p></article>
          </section>

          <CampaignJourneyPanels
            contacts={filteredContacts}
            events={filteredEvents}
            executions={data.executions}
            eventsComplete={eventsComplete}
            executionsComplete={data.coverage?.executionsComplete === true}
          />

          <section className={styles.twoColumns}>
            <article className={styles.card}>
              <div className={styles.cardTitle}><div><span>COMPARACIÓN JUSTA</span><h3>Rendimiento A–D</h3></div><small>Misma cohorte y filtros</small></div>
              <Bar data={chartData} options={{ responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#4D4968' } } }, scales: { x: { grid: { display: false }, ticks: { color: '#4D4968' } }, y: { beginAtZero: true, ticks: { precision: 0, color: '#4D4968' }, grid: { color: '#ECEAF3' } } } }} />
            </article>
            <article className={styles.card}>
              <div className={styles.cardTitle}><div><span>CADENCIA</span><h3>Email 1–5</h3></div><small>Contactos únicos</small></div>
              <ol className={styles.steps}>{steps.map((item) => <li key={item.step}><span>Email {item.step}</span><strong>{item.measured ? eventValue(item.contacts) : '—'}</strong><small>{item.measured ? 'registrados' : 'No medido'}</small></li>)}</ol>
              {!anyStepMeasured && <p className={styles.notice}>Cada envío debe registrar el paso 1–5. La ausencia de instrumentación no se interpreta como cero.</p>}
            </article>
          </section>

          <section className={styles.card}>
            <div className={styles.cardTitle}><div><span>FUNNELS</span><h3>Tabla ejecutiva A–D</h3></div><small>Conversión = recurso / entregados</small></div>
            <div className={styles.tableWrap}><table><thead><tr><th>Funnel</th><th>Contactos</th><th>Entregados</th><th>Respuestas</th><th>Recursos</th><th>Reuniones</th><th>Conversión</th></tr></thead><tbody>{comparison.map((item) => <tr key={item.code}><th><i style={{ background: item.color }} />{item.code} · {item.name}</th><td>{contactValue(item.contacts)}</td><td>{eventValue(item.delivered)}</td><td>{eventValue(item.replies)}</td><td>{eventValue(item.resources)}</td><td>{eventValue(item.meetings)}</td><td>{metricRate(item.resources, item.delivered)}</td></tr>)}</tbody></table></div>
          </section>

          <section className={styles.twoColumns}>
            <article className={styles.card}><div className={styles.cardTitle}><div><span>OPERACIONES</span><h3>Salud y excepciones</h3></div></div><dl className={styles.quality}><div><dt>Errores pendientes</dt><dd>{contactValue(errors)}</dd></div><div><dt>Locks caducados</dt><dd>{contactValue(staleLocks)}</dd></div><div><dt>Eventos huérfanos</dt><dd>{eventValue(orphanEvents)}</dd></div><div><dt>Contactos condicionados</dt><dd>{contactValue(filteredContacts.filter((contact) => contact.conditional_delivery).length)}</dd></div></dl></article>
            <article className={styles.card}><div className={styles.cardTitle}><div><span>CALIDAD</span><h3>Cobertura del dato</h3></div></div><dl className={styles.quality}><div><dt>Perfil operativo</dt><dd>{profileCoverage}%{contactsComplete ? '' : ' (parcial)'}</dd></div><div><dt>Eventos reconocidos</dt><dd>{eventCoverage === null ? '—' : `${eventCoverage}%${eventsComplete ? '' : ' (parcial)'}`}</dd></div><div><dt>Contactos sin A–D</dt><dd>{contactValue(unmappedContacts)}</dd></div><div><dt>Eventos cargados</dt><dd>{data.coverage?.eventsLoaded ?? data.events.length}{data.coverage?.eventsTotal !== undefined ? ` / ${data.coverage.eventsTotal}` : ''}</dd></div></dl>{!dataComplete && <p className={styles.notice}>Los totales permanecen marcados como parciales hasta completar las agregaciones server-side.</p>}</article>
          </section>
        </>
      )}
    </div>
  );
}