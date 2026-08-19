import { useState } from 'react';
import { getAnalyticsConsent, setAnalyticsConsent } from '../lib/consent';

export function CookieConsentBanner() {
  const [consent, setConsent] = useState(getAnalyticsConsent);

  if (consent !== 'unknown') return null;

  const choose = (value: 'accepted' | 'rejected') => {
    setAnalyticsConsent(value);
    setConsent(value);
  };

  return (
    <aside
      className="border-b border-slate-200 bg-white shadow-sm"
      aria-label="Preferencias de cookies"
    >
      <div className="container mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="max-w-3xl text-sm leading-6 text-slate-700">
          Usamos analítica opcional para entender el rendimiento de la landing. Los formularios y recursos siguen funcionando aunque la rechaces. Consulta la <a href="/cookies" className="font-semibold text-blue-900 underline">política de cookies</a> y la <a href="/privacidad" className="font-semibold text-blue-900 underline">privacidad</a>.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => choose('rejected')}
            className="min-h-11 border border-slate-400 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={() => choose('accepted')}
            className="min-h-11 bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Aceptar analítica
          </button>
        </div>
      </div>
    </aside>
  );
}
