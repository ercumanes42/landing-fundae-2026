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
          Usamos analítica opcional para entender el rendimiento de la landing. Los formularios y las solicitudes comerciales siguen funcionando aunque la rechaces.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => choose('rejected')}
            className="min-h-10 border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={() => choose('accepted')}
            className="min-h-10 bg-blue-900 px-3 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Aceptar analítica
          </button>
        </div>
      </div>
    </aside>
  );
}
