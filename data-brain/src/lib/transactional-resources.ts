import { env } from './env';
import type { TransactionalResource } from './transactional-delivery';

export class TransactionalResourceConfigurationError extends Error {}

export interface TransactionalResourceDeliveryClaims {
  template_id: string;
  resource_url: string;
  attachment?: {
    endpoint_path: string;
    filename: string;
  };
  webinar?: {
    title: string;
    date: string;
    time: string;
    timezone: string;
    duration: string;
    access_delivery_note: string;
    calendar_url: string;
  };
}

function landingOrigin(): URL {
  const raw = env('TRANSACTIONAL_LANDING_ORIGIN').trim();
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('invalid origin');
    }
    return url;
  } catch {
    throw new TransactionalResourceConfigurationError('transactional landing origin is unavailable');
  }
}

function landingUrl(path: string): string {
  return new URL(path, landingOrigin()).toString();
}

function requiredText(key: Parameters<typeof env>[0], maxLength: number): string {
  const value = env(key).trim();
  if (!value || value.length > maxLength) {
    throw new TransactionalResourceConfigurationError(`${key} is unavailable`);
  }
  return value;
}

function calendarTimestamp(value: Date): string {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function webinarClaims(): NonNullable<TransactionalResourceDeliveryClaims['webinar']> {
  const title = requiredText('TRANSACTIONAL_WEBINAR_TITLE', 200);
  const startRaw = requiredText('TRANSACTIONAL_WEBINAR_START_AT', 64);
  const accessNote = requiredText('TRANSACTIONAL_WEBINAR_ACCESS_NOTE', 300);
  const timezone = requiredText('TRANSACTIONAL_WEBINAR_TIMEZONE', 64);
  const durationMinutes = Number(requiredText('TRANSACTIONAL_WEBINAR_DURATION_MINUTES', 4));
  const start = new Date(startRaw);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480 || !Number.isFinite(start.getTime())) {
    throw new TransactionalResourceConfigurationError('transactional webinar schedule is unavailable');
  }
  try {
    new Intl.DateTimeFormat('es-ES', { timeZone: timezone }).format(start);
  } catch {
    throw new TransactionalResourceConfigurationError('transactional webinar timezone is unavailable');
  }
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const calendar = new URL('https://calendar.google.com/calendar/render');
  calendar.searchParams.set('action', 'TEMPLATE');
  calendar.searchParams.set('text', title);
  calendar.searchParams.set('dates', `${calendarTimestamp(start)}/${calendarTimestamp(end)}`);
  calendar.searchParams.set('ctz', timezone);
  calendar.searchParams.set('details', accessNote);

  return {
    title,
    date: new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: timezone,
    }).format(start),
    time: new Intl.DateTimeFormat('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    }).format(start),
    timezone,
    duration: `${durationMinutes} minutos`,
    access_delivery_note: accessNote,
    calendar_url: calendar.toString(),
  };
}

export function transactionalResourceDeliveryClaims(
  resource: TransactionalResource,
): TransactionalResourceDeliveryClaims {
  switch (resource) {
    case 'calculator':
      return {
        template_id: 'calculator_result_v1',
        resource_url: landingUrl('/#calculadora'),
      };
    case 'interactive_checklist':
      return {
        template_id: 'interactive_checklist_result_v1',
        resource_url: landingUrl('/#interactive-checklist'),
        attachment: {
          endpoint_path: '/api/transactional/interactive-checklist/pdf',
          filename: 'Resumen_Orientativo_FUNDAE.pdf',
        },
      };
    case 'checklist':
      return {
        template_id: 'checklist_delivery_v1',
        resource_url: landingUrl('/checklist_fundae_10_errores.pdf'),
        attachment: {
          endpoint_path: '/api/transactional/checklist/pdf',
          filename: 'Checklist_10_Controles_FUNDAE.pdf',
        },
      };
    case 'webinar':
      return {
        template_id: 'webinar_confirmation_v1',
        resource_url: landingUrl('/#webinar'),
        webinar: webinarClaims(),
      };
  }
}

export function canonicalChecklistPdfUrl(): string {
  return landingUrl('/checklist_fundae_10_errores.pdf');
}
