import * as React from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { Calendar, Clock, Video } from "lucide-react";
import { config } from "../../config";
import { trackFormStart } from "../../lib/tracking";

export function WebinarSection() {
  const { state, error, submit, reset } = useFormSubmit();
  const hasTrackedStart = React.useRef(false);

  const trackStartOnce = () => {
    if (!hasTrackedStart.current) {
      hasTrackedStart.current = true;
      trackFormStart("webinar");
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
    
    await submit("webinar", data);
  };

  return (
    <section className="py-24 bg-slate-50" id="webinar">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-5 gap-12">
          
          <div className="lg:col-span-3">
            <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800 mb-4">
              Próximo evento en directo
            </span>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl mb-6">
              Webinar gratuito: Cómo evitar que tu empresa pierda crédito FUNDAE antes del 31 de diciembre
            </h2>
            <p className="text-lg text-gray-600 mb-8 leading-relaxed">
              Una sesión práctica para empresas que quieren entender cómo revisar, planificar y aprovechar sus créditos de formación
            </p>

            <div className="flex gap-4 mb-10 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg border border-gray-200">
                <Calendar className="h-5 w-5 text-blue-900" />
                <span className="font-medium text-gray-800">{config.webinarDate}</span>
              </div>
              <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg border border-gray-200">
                <Clock className="h-5 w-5 text-blue-900" />
                <span className="font-medium text-gray-800">{config.webinarTime} · 45 mins + preguntas</span>
              </div>
              <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg border border-gray-200">
                <Video className="h-5 w-5 text-blue-900" />
                <span className="font-medium text-gray-800">Online en directo</span>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-4 text-lg">¿Qué veremos en la sesión?</h3>
              <ul className="grid sm:grid-cols-2 gap-4 text-gray-600">
                <li className="flex gap-2"><span className="text-green-500 font-bold">✓</span> Qué es FUNDAE explicado fácil.</li>
                <li className="flex gap-2"><span className="text-green-500 font-bold">✓</span> Por qué muchas pymes no lo usan.</li>
                <li className="flex gap-2"><span className="text-green-500 font-bold">✓</span> Qué errores debes evitar.</li>
                <li className="flex gap-2"><span className="text-green-500 font-bold">✓</span> Revisión de oportunidad en vivo.</li>
                <li className="flex gap-2"><span className="text-green-500 font-bold">✓</span> Uso en IA, productividad y liderazgo.</li>
                <li className="flex gap-2"><span className="text-green-500 font-bold">✓</span> Pasos para diagnóstico gratuito.</li>
              </ul>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl p-8 shadow-xl border border-gray-100 sticky top-24">
              {state === "success" ? (
                 <div className="text-center py-8">
                   <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-6">
                     <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                     </svg>
                   </div>
                   <h3 className="text-2xl font-bold mb-2">¡Plaza reservada!</h3>
                   <p className="text-gray-600 mb-6">Te hemos enviado un correo de confirmación. Recibirás el enlace de acceso unas horas antes del evento.</p>
                   <Button onClick={reset} variant="outline" className="mx-auto">
                     Reservar otra plaza
                   </Button>
                 </div>
              ) : (
                <form onSubmit={handleSubmit} onFocusCapture={trackStartOnce} className="space-y-5">
                  <h3 className="text-xl font-bold mb-2 text-gray-900">Reserva tu plaza</h3>
                  <p className="text-sm text-gray-500 mb-6">Plazas limitadas por la plataforma.</p>
                  
                  {state === "error" && (
                    <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">
                      {error || "Ha ocurrido un error al enviar el formulario."}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre y apellidos</label>
                    <Input name="name" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email corporativo</label>
                    <Input type="email" name="email" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Empresa</label>
                    <Input name="company" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Cargo</label>
                      <Input name="role" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nº Trab.</label>
                      <Select name="employee_range" required>
                        <option value="">Sel.</option>
                        <option value="1-5">1-5</option>
                        <option value="6-9">6-9</option>
                        <option value="10-49">10-49</option>
                        <option value="50-249">50-249</option>
                        <option value="+249">+249</option>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 mt-2">
                    <input type="checkbox" id="privacyA_webinar" name="privacy_accepted" required className="mt-1" />
                    <label htmlFor="privacyA_webinar" className="text-xs text-gray-500">
                      He leído y acepto la política de privacidad.
                    </label>
                  </div>
                  <div className="pt-2">
                    <Button type="submit" className="w-full" disabled={state === "loading"}>
                      {state === "loading" ? "Registrando..." : "Reservar plaza"}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
