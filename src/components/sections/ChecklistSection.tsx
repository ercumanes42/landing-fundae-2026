import * as React from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { config } from "../../config";
import { trackFormStart, trackPdfDownload } from "../../lib/tracking";

export function ChecklistSection() {
  const { state, error, submit, reset } = useFormSubmit();
  const hasTrackedStart = React.useRef(false);

  const trackStartOnce = () => {
    if (!hasTrackedStart.current) {
      hasTrackedStart.current = true;
      trackFormStart("checklist");
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const privacyAccepted = formData.get("privacy_accepted") === "on";
    const data = {
      ...Object.fromEntries(formData.entries()),
      privacy_accepted: privacyAccepted,
    };
    
    await submit("checklist", data);
    
    // Auto trigger download
    const pdfUrl = config.checklistPdfUrl;
    if (pdfUrl) {
      trackPdfDownload();
      window.open(pdfUrl, "_blank");
    }
  };

  return (
    <section className="py-24 bg-blue-950 text-white relative overflow-hidden" id="checklist">
      <div className="absolute top-0 right-0 -mt-20 -mr-20 w-96 h-96 bg-blue-900 rounded-full blur-[100px] opacity-70"></div>
      <div className="container relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl mb-6">
              Checklist gratuito: 10 errores que pueden hacerte perder tu crédito FUNDAE
            </h2>
            <p className="text-lg text-slate-200 mb-8 leading-relaxed">
              Una guía rápida para saber qué revisar antes de planificar formación bonificada en tu empresa. Evita sanciones y maximiza tu cotización.
            </p>
            <ul className="space-y-4 text-slate-100">
              <li className="flex items-center gap-3">
                <svg className="h-5 w-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Descubre por qué se pierde el 48% del crédito anual.</span>
              </li>
              <li className="flex items-center gap-3">
                <svg className="h-5 w-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Identifica problemas de cofinanciación encubiertos.</span>
              </li>
              <li className="flex items-center gap-3">
                <svg className="h-5 w-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Aprende a planificar antes de final de año.</span>
              </li>
            </ul>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-2xl text-slate-900 border border-slate-200">
            {state === "success" ? (
              <div className="text-center py-8">
                <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-6">
                  <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold mb-2">¡Descarga Iniciada!</h3>
                <p className="text-slate-600 mb-8">Tu checklist se está descargando. Si no ocurre automáticamente, haz clic en el botón de abajo.</p>
                <div className="flex flex-col gap-4">
                  <Button 
                    onClick={() => {
                      trackPdfDownload();
                      window.open(config.checklistPdfUrl, "_blank");
                    }}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 shadow-lg shadow-emerald-200"
                  >
                    📥 Descargar PDF Manualmente
                  </Button>
                  <button onClick={reset} className="text-sm text-slate-500 underline mt-2 hover:text-slate-700">
                    Volver al formulario
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} onFocusCapture={trackStartOnce} className="space-y-4">
                <h3 className="text-xl font-bold mb-6 text-slate-900">Descarga tu checklist ahora</h3>
                
                {state === "error" && (
                  <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">
                    {error || "Ha ocurrido un error al enviar el formulario."}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Nombre</label>
                  <Input name="name" required />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Email corporativo</label>
                  <Input type="email" name="email" required />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Empresa</label>
                  <Input name="company" required />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Nº de trabajadores</label>
                  <Select name="employee_range" required>
                    <option value="">Selecciona</option>
                    <option value="1-5">1-5</option>
                    <option value="6-9">6-9</option>
                    <option value="10-49">10-49</option>
                    <option value="50-249">50-249</option>
                    <option value="+249">+249</option>
                  </Select>
                </div>
                <div className="flex items-start gap-2 mt-4">
                  <input type="checkbox" id="privacyA_checklist" name="privacy_accepted" required className="mt-1" />
                  <label htmlFor="privacyA_checklist" className="text-xs text-slate-600">
                    He leído y acepto la política de privacidad.
                  </label>
                </div>
                <div className="pt-2">
                  <Button type="submit" variant="primary" className="w-full" disabled={state === "loading"}>
                    {state === "loading" ? "Procesando solicitud..." : "Descargar checklist corporativo"}
                  </Button>
                </div>
                <p className="text-xs text-slate-500 text-center mt-4">
                  *Tus datos están protegidos según normativa RGPD.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
