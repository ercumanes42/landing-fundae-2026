import * as React from "react";
import { 
  Building2, 
  User, 
  Calculator, 
  ArrowRight, 
  CheckCircle2, 
  ChevronRight, 
  Activity 
} from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { 
  EMPLOYEE_RANGES, 
  PROVINCES, 
  SECTORS, 
  CALCULATOR_RESULTS 
} from "../../config/constants";
import { config } from "../../config";
import { getCampaignAwareUrl, trackCalendlyRedirect, trackEvent, trackFormStart, trackFormStep } from "../../lib/tracking";

export function CalculatorSection() {
  const [step, setStep] = React.useState(1);
  const { state, error, submit } = useFormSubmit();
  const hasTrackedStart = React.useRef(false);
  
  const [formData, setFormData] = React.useState({
    company: "",
    employee_range: "",
    sector: "",
    province: "",
    name: "",
    role: "",
    email: "",
    phone: "",
    training_area: "Otro",
    used_fundae_before: "No lo sé",
    knows_credit: "No lo sé",
    privacy_accepted: false
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (!hasTrackedStart.current) {
      hasTrackedStart.current = true;
      trackEvent("calculator_started", { form_type: "calculator", section: "calculadora" });
      trackFormStart("calculator");
    }

    const { name, value, type } = e.target;
    const val = type === "checkbox" ? (e.target as HTMLInputElement).checked : value;
    setFormData((prev) => ({ ...prev, [name]: val }));
  };

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    trackFormStep("calculator", 1);
    setStep(2);
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    await submit("calculator", { ...formData, form_steps_completed: 2 });
    setStep(3);
  };

  return (
    <section className="py-24 bg-white" id="calculadora">
      <div className="container mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl mb-4">
            Calculadora rápida de oportunidad FUNDAE
          </h2>
          <p className="text-lg text-gray-600">
            Descubre si tu empresa está en posición de aprovechar su crédito formativo.
          </p>
        </div>

        <div className="bg-slate-50 rounded-3xl p-8 md:p-12 border border-gray-200 shadow-sm">
          
          {/* Progress Bar */}
          <div className="mb-10">
            <div className="flex items-center justify-between max-w-xl mx-auto relative">
              <div className="absolute top-5 left-0 w-full h-1 bg-gray-200 -z-10 rounded-full"></div>
              <div 
                className="absolute top-5 left-0 h-1 bg-blue-600 transition-all duration-300 ease-in-out -z-10 rounded-full" 
                style={{ width: `${((step - 1) / 2) * 100}%` }}
              ></div>

              {[
                { id: 1, label: "Empresa", icon: Building2 },
                { id: 2, label: "Contacto", icon: User },
                { id: 3, label: "Resultado", icon: Calculator },
              ].map((s) => {
                const Icon = s.icon;
                const isActive = step >= s.id;
                return (
                  <div key={s.id} className="flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors duration-300 bg-white ${isActive ? 'border-blue-600 text-blue-600' : 'border-gray-300 text-gray-400'}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className={`text-xs mt-2 font-medium ${isActive ? 'text-blue-900' : 'text-gray-500'}`}>
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {step === 1 && (
            <form onSubmit={handleNext} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Nombre de la empresa *</label>
                  <Input name="company" required value={formData.company} onChange={handleChange} placeholder="Tu empresa" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Número de trabajadores *</label>
                  <Select name="employee_range" required value={formData.employee_range} onChange={handleChange}>
                    <option value="">Selecciona una opción</option>
                    {EMPLOYEE_RANGES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Sector *</label>
                  <Select name="sector" required value={formData.sector} onChange={handleChange}>
                    <option value="">Selecciona un sector</option>
                    {SECTORS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Provincia *</label>
                  <Select name="province" required value={formData.province} onChange={handleChange}>
                    <option value="">Selecciona una provincia</option>
                    {PROVINCES.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="pt-4 flex justify-end">
                <Button type="submit" className="flex items-center gap-2">
                  Siguiente paso
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl mx-auto">
              <h3 className="text-xl font-bold mb-6 text-center">Datos de contacto para enviarte el resultado</h3>
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Nombre completo *</label>
                  <Input name="name" required value={formData.name} onChange={handleChange} placeholder="Tu nombre" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Cargo / Rol *</label>
                  <Input name="role" required value={formData.role} onChange={handleChange} placeholder="Ej. RRHH, CEO..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email corporativo *</label>
                  <Input type="email" name="email" required value={formData.email} onChange={handleChange} placeholder="nombre@empresa.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono (opcional)</label>
                  <Input type="tel" name="phone" value={formData.phone} onChange={handleChange} placeholder="+34 600 000 000" />
                </div>
              </div>
              
              <div className="flex items-start gap-2 pt-2">
                <input 
                  type="checkbox" 
                  id="privacy_calc" 
                  name="privacy_accepted" 
                  required 
                  checked={formData.privacy_accepted} 
                  onChange={handleChange} 
                  className="mt-1 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500" 
                />
                <label htmlFor="privacy_calc" className="text-sm text-gray-600">
                  Acepto la <a href="/privacidad" className="text-blue-600 hover:underline">política de privacidad</a>.
                </label>
              </div>

              {error && (
                <div className="p-4 rounded-md bg-red-50 text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div className="pt-4 flex justify-between">
                <Button type="button" variant="ghost" onClick={() => setStep(1)}>Volver</Button>
                <Button type="submit" disabled={state === 'loading'} className="flex items-center gap-2">
                  {state === 'loading' ? (
                    <>
                      <Activity className="h-4 w-4 animate-spin" />
                      Calculando...
                    </>
                  ) : (
                    <>
                      Ver resultado
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="max-w-3xl mx-auto py-4">
              <div className="text-center mb-8">
                <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mb-4 shadow-inner">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h3 className="text-3xl font-extrabold text-gray-900">Análisis completado</h3>
                <p className="text-gray-500 mt-2">Basado en los datos de tu plantilla ({formData.employee_range} empleados)</p>
              </div>

              {(() => {
                const result = CALCULATOR_RESULTS.find((r) => r.range === formData.employee_range);
                if (!result) return null;

                return (
                  <div className="bg-white rounded-3xl border border-gray-200 shadow-[0_8px_30px_rgba(0,0,0,0.06)] overflow-hidden mb-8">
                    <div className="bg-gradient-to-br from-blue-900 to-indigo-900 p-8 text-center text-white relative overflow-hidden">
                      {/* Decorative blobs */}
                      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                      <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
                      
                      <p className="text-blue-200 text-sm font-bold tracking-wider uppercase mb-2 relative z-10">
                        Crédito estimado disponible
                      </p>
                      <div className="text-4xl md:text-5xl font-extrabold tracking-tight relative z-10 mb-2">
                        {result.range === '1-5' ? (
                          <span className="text-emerald-400">420 €</span>
                        ) : result.range === '+249' ? (
                          <>Más de <span className="text-emerald-400">21.000 €</span></>
                        ) : (
                          <>Entre <span className="text-emerald-400">{result.min} €</span> y <span className="text-emerald-400">{result.max} €</span></>
                        )}
                      </div>
                      <p className="text-blue-100 text-sm relative z-10 opacity-80">
                        Cifra orientativa anual basada en la media nacional salarial.
                      </p>
                    </div>
                    
                    <div className="p-8 bg-white">
                      <div className="flex items-start gap-4 mb-6 pb-6 border-b border-gray-100">
                        <div className="p-3 bg-blue-50 text-blue-600 rounded-xl shrink-0">
                          <Calculator className="w-6 h-6" />
                        </div>
                        <div>
                          <h4 className="text-lg font-bold text-gray-900 mb-1">¿Cómo hemos calculado esto?</h4>
                          <p className="text-gray-600 leading-relaxed text-sm">
                            Tu empresa cotiza mensualmente un 0,7% de su masa salarial a la Seguridad Social en concepto de <strong>Formación Profesional</strong>. Por ley, tienes derecho a bonificar (recuperar) un porcentaje de ese dinero si lo inviertes en formar a tu equipo.
                          </p>
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4 mb-6">
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                          <span className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Tu plantilla</span>
                          <span className="text-xl font-bold text-gray-900">{formData.employee_range} trabajadores</span>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                          <span className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Tu % de Bonificación</span>
                          <span className="text-xl font-bold text-emerald-600">{result.bonusPercentage} de lo cotizado</span>
                        </div>
                      </div>

                      <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl">
                        <p className="text-amber-900 text-sm leading-relaxed">
                          <strong>Conclusión:</strong> {result.message}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="text-center space-y-4">
                <Button
                  size="lg"
                  className="w-full sm:w-auto px-8 py-6 text-lg shadow-lg shadow-blue-200"
                  onClick={() => {
                    trackCalendlyRedirect("calculator");
                    window.open(getCampaignAwareUrl(config.calendlyUrl), "_blank");
                  }}
                >
                  Agendar Diagnóstico Gratuito para calcular la cifra exacta
                </Button>
                <p className="text-xs text-gray-500 max-w-lg mx-auto">
                  El cálculo definitivo lo debe realizar un consultor especializado revisando los recibos de liquidación de cotizaciones oficiales de tu empresa emitidos por la TGSS.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
