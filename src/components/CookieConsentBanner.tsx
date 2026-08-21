import { useEffect, useRef, useState } from 'react';
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
  subscribeAnalyticsConsent,
  type AnalyticsConsent,
} from '../lib/consent';

export function CookieConsentBanner() {
  const [consent, setConsent] = useState(getAnalyticsConsent);
  const [isOpen, setIsOpen] = useState(() => consent === 'unknown');
  const [isReopened, setIsReopened] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => subscribeAnalyticsConsent((state) => {
    setConsent(state);
    if (state === 'unknown') setIsOpen(true);
  }), []);

  useEffect(() => {
    if (isOpen && isReopened) panelRef.current?.focus();
    if (!isOpen && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [isOpen, isReopened]);

  const choose = (value: Exclude<AnalyticsConsent, 'unknown'>) => {
    setAnalyticsConsent(value);
    setConsent(value);
    restoreFocusRef.current = true;
    setIsOpen(false);
    setIsReopened(false);
  };

  if (!isOpen) {
    return (
      <button
        ref={triggerRef}
        type="button"
        aria-controls="privacy-preferences"
        aria-expanded="false"
        onClick={() => {
          setIsReopened(true);
          setIsOpen(true);
        }}
        className="fixed bottom-24 left-4 z-40 min-h-11 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-lg transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900 lg:bottom-4"
      >
        Preferencias de privacidad
      </button>
    );
  }

  return (
    <aside
      id="privacy-preferences"
      ref={panelRef}
      tabIndex={-1}
      className={isReopened
        ? 'fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white shadow-[0_-8px_30px_rgba(15,23,42,0.18)] focus:outline-none'
        : 'border-b border-slate-200 bg-white shadow-sm focus:outline-none'}
      aria-label="Preferencias de cookies"
    >
      <div className="container mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-sm leading-6 text-slate-700">
            Usamos analítica opcional para entender el rendimiento de la landing. Los formularios y recursos siguen funcionando aunque la rechaces. Consulta la <a href="/cookies" className="font-semibold text-blue-900 underline">política de cookies</a> y la <a href="/privacidad" className="font-semibold text-blue-900 underline">privacidad</a>.
          </p>
          {consent !== 'unknown' && (
            <p className="mt-1 text-xs font-medium text-slate-600" aria-live="polite">
              Preferencia actual: {consent === 'accepted' ? 'analítica aceptada' : 'analítica rechazada'}.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {isReopened && (
            <button
              type="button"
              onClick={() => {
                restoreFocusRef.current = true;
                setIsOpen(false);
                setIsReopened(false);
              }}
              className="min-h-11 px-3 text-sm font-semibold text-slate-600 underline hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
            >
              Cerrar
            </button>
          )}
          <button
            type="button"
            aria-pressed={consent === 'rejected'}
            onClick={() => choose('rejected')}
            className="min-h-11 border border-slate-400 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
          >
            Rechazar
          </button>
          <button
            type="button"
            aria-pressed={consent === 'accepted'}
            onClick={() => choose('accepted')}
            className="min-h-11 bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
          >
            Aceptar analítica
          </button>
        </div>
      </div>
    </aside>
  );
}
