'use client';

import { useMemo, useState } from 'react';
import styles from './CampaignJourneyPanels.module.css';

interface JourneyContact {
  id: string;
  external_contact_id: string;
  variant: string;
  magnet: string;
  lot: string;
}

interface JourneyEvent {
  id: string;
  campaign_contact_id: string;
  event_name: string;
  occurred_at: string;
  properties?: Record<string, string | number | boolean | null>;
}

interface JourneyExecution {
  id: string;
  campaign_contact_id: string;
  channel: string;
  action_name: string;
  step: number | null;
  status: string;
  scheduled_for: string | null;
  planned_at: string | null;
  actual_at: string | null;
  failed_at: string | null;
  stopped_at: string | null;
  created_at: string;
}

const STAGES = [
  { label: 'Enviado', events: ['delivery_sent'] },
  { label: 'Entregado', events: ['delivery_delivered'] },
  { label: 'Clic', events: ['link_clicked'] },
  { label: 'Herramienta iniciada', events: ['tool_started', 'resource_started'] },
  { label: 'Recurso completado', events: ['tool_completed', 'resource_completed', 'checklist_downloaded', 'calculator_completed', 'webinar_registered', 'review_submitted'] },
  { label: 'Reunión', events: ['meeting_booked', 'meeting_completed'] },
] as const;

const EVENT_LABELS: Record<string, string> = {
  delivery_scheduled: 'Envío programado',
  delivery_sent: 'Correo enviado',
  delivery_delivered: 'Correo entregado',
  email_opened: 'Apertura orientativa',
  link_clicked: 'Clic registrado',
  reply_received: 'Respuesta recibida',
  bounce_hard: 'Rebote definitivo',
  unsubscribe: 'Baja solicitada',
  tool_started: 'Herramienta iniciada',
  resource_started: 'Herramienta iniciada',
  tool_completed: 'Herramienta completada',
  resource_completed: 'Recurso completado',
  checklist_downloaded: 'Checklist descargado',
  calculator_completed: 'Calculadora completada',
  webinar_registered: 'Webinar registrado',
  review_submitted: 'Autoevaluación completada',
  pdf_downloaded: 'PDF descargado',
  meeting_booked: 'Reunión reservada',
  meeting_completed: 'Reunión realizada',
  opportunity_created: 'Oportunidad creada',
};

const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  linkedin: 'LinkedIn',
  manual: 'Manual',
};

function shortContact(contact: JourneyContact): string {
  const suffix = contact.external_contact_id.slice(-7);
  return `Contacto …${suffix} · ${contact.variant || contact.magnet || 'Sin funnel'} · lote ${contact.lot || '—'}`;
}

function isoDay(value: string): string {
  return value.slice(0, 10);
}

function displayDay(value: string): string {
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`));
}

function displayDateTime(value: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

export function CampaignJourneyPanels({
  contacts,
  events,
  executions,
  eventsComplete,
  executionsComplete,
}: {
  contacts: JourneyContact[];
  events: JourneyEvent[];
  executions: JourneyExecution[];
  eventsComplete: boolean;
  executionsComplete: boolean;
}) {
  const contactIds = useMemo(() => new Set(contacts.map((contact) => contact.id)), [contacts]);
  const scopedExecutions = useMemo(
    () => executions.filter((execution) => contactIds.has(execution.campaign_contact_id)),
    [contactIds, executions],
  );
  const [selectedContactId, setSelectedContactId] = useState(contacts[0]?.id ?? '');
  const selectedContact = contacts.find((contact) => contact.id === selectedContactId) ?? contacts[0];

  const stageCounts = useMemo(() => {
    let eligible = new Set(contacts.map((contact) => contact.id));
    return STAGES.map((stage) => {
      const observed = new Set(
        events
          .filter((event) => stage.events.some((name) => name === event.event_name))
          .map((event) => event.campaign_contact_id),
      );
      eligible = new Set([...eligible].filter((id) => observed.has(id)));
      return { label: stage.label, count: eligible.size };
    });
  }, [contacts, events]);

  const activityByDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) counts.set(isoDay(event.occurred_at), (counts.get(isoDay(event.occurred_at)) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14);
  }, [events]);
  const maxActivity = Math.max(1, ...activityByDay.map(([, count]) => count));
  const linePoints = activityByDay.map(([, count], index) => {
    const x = activityByDay.length <= 1 ? 50 : (index / (activityByDay.length - 1)) * 100;
    const y = 92 - (count / maxActivity) * 80;
    return `${x},${y}`;
  }).join(' ');

  const calendarRows = useMemo(() => {
    const days = new Map<string, Record<string, Record<string, number>>>();
    for (const execution of scopedExecutions) {
      const date = execution.scheduled_for || execution.planned_at || execution.actual_at || execution.failed_at || execution.stopped_at;
      if (!date) continue;
      const day = isoDay(date);
      const byChannel = days.get(day) ?? {};
      const byStatus = byChannel[execution.channel] ?? {};
      byStatus[execution.status] = (byStatus[execution.status] ?? 0) + 1;
      byChannel[execution.channel] = byStatus;
      days.set(day, byChannel);
    }
    return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14);
  }, [scopedExecutions]);

  const contactTimeline = useMemo(() => {
    if (!selectedContact) return [];
    const eventItems = events
      .filter((event) => event.campaign_contact_id === selectedContact.id)
      .map((event) => ({
        id: `event-${event.id}`,
        at: event.occurred_at,
        label: EVENT_LABELS[event.event_name] ?? event.event_name,
        note: event.event_name === 'email_opened' ? 'Dato orientativo' : 'Evento confirmado',
      }));
    const executionItems = scopedExecutions
      .filter((execution) => execution.campaign_contact_id === selectedContact.id && execution.status !== 'planned')
      .map((execution) => ({
        id: `execution-${execution.id}`,
        at: execution.actual_at || execution.failed_at || execution.stopped_at || execution.planned_at || execution.created_at,
        label: `${CHANNEL_LABELS[execution.channel] ?? execution.channel} · ${execution.action_name}`,
        note: `${execution.status}${execution.step ? ` · email ${execution.step}` : ''}`,
      }));
    return [...eventItems, ...executionItems].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-16);
  }, [events, scopedExecutions, selectedContact]);

  const lastMeasuredPoint = contactTimeline.at(-1)?.label ?? 'Sin actividad registrada';

  return (
    <section className={styles.grid} aria-label="Seguimiento de campaña y puntos de abandono">
      <article className={styles.card}>
        <header><div><span>EMBUDO SECUENCIAL</span><h3>Dónde avanza y dónde se detiene</h3></div><small>Denominador: etapa anterior</small></header>
        {events.length ? (
          <ol className={styles.funnel}>
            {stageCounts.map((stage, index) => {
              const previous = index === 0 ? contacts.length : stageCounts[index - 1].count;
              const rate = previous > 0 ? Math.round((stage.count / previous) * 100) : 0;
              const width = contacts.length ? Math.max(12, (stage.count / contacts.length) * 100) : 12;
              return <li key={stage.label} style={{ width: `${width}%` }}><span>{stage.label}</span><strong>{eventsComplete ? stage.count : `≥${stage.count}`}</strong><small>{rate}% de la etapa anterior</small></li>;
            })}
          </ol>
        ) : <p className={styles.empty}>Sin eventos suficientes. No se infiere abandono.</p>}
        <p className={styles.note}>La apertura no determina abandono: es una señal orientativa y puede estar alterada por el cliente de correo.</p>
      </article>

      <article className={styles.card}>
        <header><div><span>EVOLUCIÓN</span><h3>Actividad diaria registrada</h3></div><small>Últimos 14 días con actividad</small></header>
        {activityByDay.length ? (
          <>
            <svg className={styles.lineChart} viewBox="0 0 100 100" role="img" aria-label={`Actividad diaria: ${activityByDay.map(([day, count]) => `${displayDay(day)}, ${count}`).join('; ')}`} preserveAspectRatio="none">
              <line x1="0" y1="92" x2="100" y2="92" />
              <polyline points={linePoints} />
              {activityByDay.map(([day, count], index) => {
                const [x, y] = linePoints.split(' ')[index].split(',');
                return <circle key={day} cx={x} cy={y} r="1.8"><title>{displayDay(day)}: {count}</title></circle>;
              })}
            </svg>
            <div className={styles.axis}><span>{displayDay(activityByDay[0][0])}</span><span>{displayDay(activityByDay.at(-1)![0])}</span></div>
          </>
        ) : <p className={styles.empty}>Sin actividad temporal disponible.</p>}
      </article>

      <article className={`${styles.card} ${styles.wide}`}>
        <header><div><span>CALENDARIO DE CONTROL</span><h3>Previsto y ejecutado por canal</h3></div><small>{executionsComplete ? 'Cobertura completa' : 'Cobertura parcial'}</small></header>
        {calendarRows.length ? (
          <div className={styles.tableWrap}><table><thead><tr><th>Fecha</th>{['email', 'linkedin', 'manual'].map((channel) => <th key={channel}>{CHANNEL_LABELS[channel]}</th>)}</tr></thead><tbody>
            {calendarRows.map(([day, channels]) => <tr key={day}><th>{displayDay(day)}</th>{['email', 'linkedin', 'manual'].map((channel) => {
              const statuses = channels[channel] ?? {};
              const total = Object.values(statuses).reduce((sum, value) => sum + value, 0);
              const statusText = Object.entries(statuses).map(([status, count]) => `${status}: ${count}`).join(' · ');
              return <td key={channel} className={total ? styles.activeCell : styles.emptyCell}><strong>{total || '—'}</strong><small>{statusText || 'Sin registro'}</small></td>;
            })}</tr>)}
          </tbody></table></div>
        ) : <p className={styles.empty}>El calendario se completará cuando Make/Outlook o una acción manual autorizada registre ejecuciones. No hay envíos simulados.</p>}
      </article>

      <article className={`${styles.card} ${styles.wide}`}>
        <header><div><span>DRILL-DOWN</span><h3>Cronología por contacto</h3></div><small>Identificador seudonimizado</small></header>
        {contacts.length ? (
          <>
            <label className={styles.contactPicker}>Contacto<select value={selectedContact?.id ?? ''} onChange={(event) => setSelectedContactId(event.target.value)}>{contacts.slice(0, 250).map((contact) => <option key={contact.id} value={contact.id}>{shortContact(contact)}</option>)}</select></label>
            <p className={styles.currentPoint}><strong>Último punto medido:</strong> {lastMeasuredPoint}. No se infiere la causa del abandono.</p>
            {contactTimeline.length ? <ol className={styles.timeline}>{contactTimeline.map((item) => <li key={item.id}><time dateTime={item.at}>{displayDateTime(item.at)}</time><strong>{item.label}</strong><small>{item.note}</small></li>)}</ol> : <p className={styles.empty}>Este contacto todavía no tiene actividad registrada.</p>}
          </>
        ) : <p className={styles.empty}>Sin contactos para los filtros activos.</p>}
      </article>
    </section>
  );
}
