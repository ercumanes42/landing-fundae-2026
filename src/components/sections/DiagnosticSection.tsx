import * as React from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { config } from "../../config";
import { SECTORS } from "../../config/constants";
import { getCampaignAwareUrl, trackCalendlyRedirect, trackFormStart } from "../../lib/tracking";

export function DiagnosticSection() {
  const { state, error, submit } = useFormSubmit();
  const hasTrackedStart = React.useRef(false);

  const trackStartOnce = () => {
    if (!hasTrackedStart.current) {
      hasTrackedStart.current = true;
      trackFormStart("diagnostic");
    }
  };

  React.useEffect(() => {
    if (state === "success") {
      const calendlyUrl = getCampaignAwareUrl(config.calendlyUrl);
      if (calendlyUrl) {
        trackCalendlyRedirect("diagnostic");
        window.location.href = calendlyUrl;
      }
    }
  }, [state]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const privacyAccepted = formData.get("privacy_accepted") === "on";
    const marketingAccepted = formData.get("marketing_accepted") === "on";
    
    const data = {
      ...Object.fromEntries(formData.entries()),
      privacy_accepted: privacyAccepted,
      marketing_accepted: marketingAccepted,
    };
    
    await submit("diagnostic", data);
  };

  return (
    <section className="py-24 bg-slate-50" id="diagnostico">
      <div className="container mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl mb-4">
            Solicita un diagnóstico FUNDAE gratuito
          </h2>
          <p className="text-lg text-gray-600">
            En 15 minutos revisamos si tu empresa puede aprovechar su crédito de formación y qué opciones tendrían más sentido.
          </p>
        </div>

        <div className="bg-white rounded-3xl p-8 md:p-12 shadow-xl border border-gray-100 relative overflow-hidden">
          {/* Form decorative background */}
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-blue-50 rounded-full blur-3xl opacity-50 pointer-events-none" />
          
          {state === "success" ? (
            <div className="text-center py-16 relative z-10">
              <div className="mx-auto w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                <svg className="h-10 w-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-3xl font-bold mb-4 text-gray-900">Solicitud recibida correctamente</h3>
              <p className="text-lg text-gray-600 mb-8 max-w-lg mx-auto">
                Tu información ha sido registrada. Si no has sido redirigido automáticamente al calendario, puedes escoger tu cita ahora.
              </p>
              {config.calendlyUrl && (
                <Button
                  size="lg"
                  onClick={() => {
                    trackCalendlyRedirect("diagnostic");
                    window.location.href = getCampaignAwareUrl(config.calendlyUrl);
                  }}
                >
                  Ir al calendario
                </Button>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} onFocusCapture={trackStartOnce} className="space-y-6 relative z-10">
              
              {state === "error" && (
                <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">
                  {error || "Ha ocurrido un error al enviar el formulario."}
                </div>
              )}

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nombre y apellidos *</label>
                  <Input name="name" required placeholder="Tu nombre" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cargo *</label>
                  <Input name="role" required placeholder="Ej. Director de RRHH" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Empresa *</label>
                  <Input name="company" required placeholder="Nombre de tu empresa" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email corporativo *</label>
                  <Input type="email" name="email" required placeholder="nombre@empresa.com" />
                </div>
              </div>
              
              <div className="border-t border-gray-200 pt-6 mt-6 space-y-4">
                <div className="flex items-start gap-2">
                  <input type="checkbox" id="privacyA_diagnostic" name="privacy_accepted" required className="mt-1" />
                  <label htmlFor="privacyA_diagnostic" className="text-xs text-gray-500">
                    He leído y acepto la política de privacidad. Consiento el tratamiento de mis datos para agendar la sesión.
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <input type="checkbox" id="marketing_accepted_diagnostic" name="marketing_accepted" className="mt-1" />
                  <label htmlFor="marketing_accepted_diagnostic" className="text-xs text-gray-500">
                    Acepto recibir comunicaciones comerciales sobre formación y novedades. (Opcional)
                  </label>
                </div>
                
                <div className="flex justify-end pt-4">
                  <Button type="submit" size="lg" disabled={state === "loading"} className="w-full md:w-auto">
                    {state === "loading" ? "Enviando..." : "Agendar diagnóstico"}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
