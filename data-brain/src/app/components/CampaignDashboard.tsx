'use client';

import { useMemo, useState } from 'react';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Legend, Tooltip);

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
  }>;
  events: Array<{
    id: string;
    campaign_id: string;
    campaign_contact_id: string;
    event_name: string;
    occurred_at: string;
  }>;
  error?: string | null;
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((totals, item) => {
    const key = getKey(item) || 'Sin dato';
    totals[key] = (totals[key] || 0) + 1;
    return totals;
  }, {});
}

function uniqueContactsForEvents(events: CampaignDashboardData['events'], eventNames: string[]): Set<string> {
  return new Set(
    events.filter((event) => eventNames.includes(event.event_name)).map((event) => event.campaign_contact_id),
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

export function CampaignDashboard({ data }: { data: CampaignDashboardData }) {
  const [campaignId, setCampaignId] = useState('all');
  const [variant, setVariant] = useState('all');
  const [lot, setLot] = useState('all');
  const [companySize, setCompanySize] = useState('all');

  const campaignOptions = data.campaigns;
  const filteredContacts = useMemo(
    () => data.contacts.filter((contact) => (
      (campaignId === 'all' || contact.campaign_id === campaignId) &&
      (variant === 'all' || contact.variant === variant) &&
      (lot === 'all' || contact.lot === lot) &&
      (companySize === 'all' || (contact.company_size || 'Sin dato') === companySize)
    )),
    [campaignId, companySize, data.contacts, lot, variant],
  );

  const contactIds = useMemo(() => new Set(filteredContacts.map((contact) => contact.id)), [filteredContacts]);
  const filteredEvents = useMemo(
    () => data.events.filter((event) => contactIds.has(event.campaign_contact_id)),
    [contactIds, data.events],
  );

  const delivered = uniqueContactsForEvents(filteredEvents, ['delivery_sent']);
  const replies = uniqueContactsForEvents(filteredEvents, ['reply_received']);
  const completedResources = uniqueContactsForEvents(filteredEvents, [
    'resource_completed',
    'checklist_downloaded',
    'calculator_completed',
    'webinar_registered',
    'review_submitted',
  ]);
  const meetings = uniqueContactsForEvents(filteredEvents, ['meeting_booked', 'meeting_completed']);
  const opportunities = uniqueContactsForEvents(filteredEvents, ['opportunity_created']);
  const pipelineValue = filteredContacts.reduce((total, contact) => total + (Number(contact.deal_value) || 0), 0);
  const variantCounts = countBy(filteredContacts, (contact) => contact.variant);
  const statusCounts = countBy(filteredContacts, (contact) => contact.sequence_status);
  const staleLocks = filteredContacts.filter((contact) => (
    contact.next_delivery_status === 'locked' &&
    contact.lock_expires_at &&
    new Date(contact.lock_expires_at).getTime() < Date.now()
  )).length;
  const failedSyncs = filteredContacts.filter((contact) => Boolean(contact.last_error_code)).length;

  const variants = Object.keys(variantCounts);
  const variantChart = {
    labels: variants,
    datasets: [{
      label: 'Contactos',
      data: variants.map((key) => variantCounts[key]),
      backgroundColor: ['#27E8FF', '#35F2A0', '#FFB84D', '#8B5CF6'],
      borderRadius: 6,
    }],
  };
  const statusChart = {
    labels: Object.keys(statusCounts),
    datasets: [{
      data: Object.values(statusCounts),
      backgroundColor: ['#348BFF', '#21D6C9', '#FFB84D', '#FF4D6D', '#8B5CF6'],
      borderWidth: 0,
    }],
  };
  const funnel = [
    ['Contactos', filteredContacts.length],
    ['Enviados confirmados', delivered.size],
    ['Respuestas', replies.size],
    ['Recursos completados', completedResources.size],
    ['Reuniones confirmadas', meetings.size],
    ['Oportunidades', opportunities.size],
  ] as const;

  if (data.error) {
    return (
      <div className="db-content">
        <div className="db-card db-full">
          <div className="db-card-title">Campana FUNDAE pendiente de migracion</div>
          <p className="campaign-empty">Aplica `data-brain/supabase/schema.sql` antes de cargar contactos. El dashboard no muestra datos simulados.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="db-content campaign-dashboard">
      <section className="db-card db-full campaign-header">
        <div>
          <p className="campaign-eyebrow">Campana y ventas</p>
          <h2>Funnel operativo FUNDAE</h2>
          <p>Datos confirmados por Google Sheets, Outlook, HubSpot y la landing.</p>
        </div>
        <div className="campaign-filters" aria-label="Filtros de campana">
          <select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
            <option value="all">Todas las campanas</option>
            {campaignOptions.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.external_id}</option>)}
          </select>
          <select value={variant} onChange={(event) => setVariant(event.target.value)}>
            <option value="all">Todos los imanes</option>
            {Array.from(new Set(data.contacts.map((contact) => contact.variant))).sort().map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={lot} onChange={(event) => setLot(event.target.value)}>
            <option value="all">Todos los lotes</option>
            {Array.from(new Set(data.contacts.map((contact) => contact.lot))).sort().map((item) => <option key={item} value={item}>Lote {item}</option>)}
          </select>
          <select value={companySize} onChange={(event) => setCompanySize(event.target.value)}>
            <option value="all">Todos los tamanos</option>
            {Array.from(new Set(data.contacts.map((contact) => contact.company_size || 'Sin dato'))).sort().map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </section>

      <section className="campaign-kpis" aria-label="Metricas principales de campana">
        <article><span>Contactos</span><strong>{filteredContacts.length}</strong><small>Universo filtrado</small></article>
        <article><span>Enviados</span><strong>{delivered.size}</strong><small>Confirmados por Outlook</small></article>
        <article><span>Respuestas</span><strong>{replies.size}</strong><small>{delivered.size ? `${((replies.size / delivered.size) * 100).toFixed(1)}% de enviados` : 'Sin denominador'}</small></article>
        <article><span>Reuniones</span><strong>{meetings.size}</strong><small>Solo confirmadas</small></article>
        <article><span>Pipeline</span><strong>{formatCurrency(pipelineValue)}</strong><small>Valor registrado</small></article>
      </section>

      <section className="campaign-grid">
        <article className="db-card campaign-chart-card">
          <div className="db-card-title">Contactos por iman</div>
          {filteredContacts.length ? <Bar data={variantChart} options={{ responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#9BAAC4' }, grid: { display: false } }, y: { ticks: { color: '#9BAAC4', precision: 0 }, grid: { color: 'rgba(80,210,255,.1)' } } } }} /> : <p className="campaign-empty">Sin contactos para estos filtros.</p>}
        </article>
        <article className="db-card campaign-chart-card">
          <div className="db-card-title">Estado de secuencia</div>
          {filteredContacts.length ? <Doughnut data={statusChart} options={{ responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#9BAAC4' } } } }} /> : <p className="campaign-empty">Sin datos operativos.</p>}
        </article>
      </section>

      <section className="campaign-grid">
        <article className="db-card">
          <div className="db-card-title">Funnel real</div>
          <ol className="campaign-funnel">
            {funnel.map(([label, count]) => {
              const percentage = filteredContacts.length ? Math.round((count / filteredContacts.length) * 100) : 0;
              return <li key={label}><span>{label}</span><div><i style={{ width: `${percentage}%` }} /><b>{count}</b></div></li>;
            })}
          </ol>
        </article>
        <article className="db-card">
          <div className="db-card-title">Calidad operativa</div>
          <dl className="campaign-quality">
            <div><dt>Bloqueos caducados</dt><dd>{staleLocks}</dd></div>
            <div><dt>Errores pendientes</dt><dd>{failedSyncs}</dd></div>
            <div><dt>Secuencias condicionadas</dt><dd>{filteredContacts.filter((contact) => contact.conditional_delivery).length}</dd></div>
            <div><dt>Eventos recibidos</dt><dd>{filteredEvents.length}</dd></div>
          </dl>
        </article>
      </section>
    </div>
  );
}
