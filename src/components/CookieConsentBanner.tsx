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
      className="fixed bottom-4 left-4 right-4 z-[60] border border-slate-200 bg-white p-4 shadow-2xl sm:left-auto sm:right-6 sm:w-[25rem]"
      aria-label="Preferencias de cookies"
    >
      <p className="text-sm leading-6 text-slate-700">
        Usamos analitica opcional para entender el rendimiento de la landing. Los formularios y las solicitudes comerciales siguen funcionando aunque la rechaces.
      </p>
      <div className="mt-3 flex gap-2">
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
          Aceptar analitica
        </button>
      </div>
    </aside>
  );
}
