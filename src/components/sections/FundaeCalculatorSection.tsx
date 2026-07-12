import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronRight,
  FileText,
  Info,
  User,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { EMPLOYEE_RANGES } from "../../config/constants";
import { config } from "../../config";
import {
  calculateFundaeCredit,
  formatEuro,
  parseSpanishAmount,
  type FundaeCreditResult,
} from "../../lib/fundaeCredit";
import type { EmployeeRange, FundaeCalculationMode } from "../../types";
import {
  getCampaignAwareUrl,
  trackCalendlyRedirect,
  trackEvent,
  trackFormStart,
  trackFormStep,
} from "../../lib/tracking";

const OFFICIAL_SIMULATOR_URL = "https://simuladorcredito.fundae.es/";

type SpecialSituation = "no" | "yes" | "unknown";

function getCalculationSourceCopy(result: FundaeCreditResult): string {
  if (result.calculation_source === "minimum_credit") {
    return "El resultado muestra el mínimo de crédito de 420 € asociado a este tramo.";
  }

  if (result.calculation_source === "fp_quota") {
    return "Hemos aplicado el porcentaje del tramo a la cuota de Formación Profesional que has indicado.";
  }

  if (result.calculation_source === "other_contributions_base") {
    return "Hemos aplicado la referencia pública: base de otras cotizaciones × 0,7% × porcentaje del tramo.";
  }

  return "Para estimar un importe necesitas la cuota de Formación Profesional o la suma de bases de otras cotizaciones del año anterior.";
}

export function FundaeCalculatorSection() {
  const [step, setStep] = React.useState(1);
  const { state, error, submit } = useFormSubmit();
  const hasTrackedStart = React.useRef(false);
  const [calculationError, setCalculationError] = React.useState<string | null>(null);
  const [formData, setFormData] = React.useState({
    employee_range: "" as EmployeeRange,
    calculation_mode: "no_data" as FundaeCalculationMode,
    prior_year_fp_quota: "",
    prior_year_other_contributions_base: "",
    special_situation: "unknown" as SpecialSituation,
    name: "",
    company: "",
    role: "",
    email: "",
    phone: "",
    privacy_accepted: false,
  });

  const employeeRange = formData.employee_range || undefined;
  const creditResult = React.useMemo(() => {
    if (!employeeRange) return null;

    return calculateFundaeCredit({
      employeeRange,
      calculationMode: formData.calculation_mode,
      priorYearFpQuota: parseSpanishAmount(formData.prior_year_fp_quota),
      priorYearOtherContributionsBase: parseSpanishAmount(formData.prior_year_other_contributions_base),
      specialSituation: formData.special_situation,
    });
  }, [
    employeeRange,
    formData.calculation_mode,
    formData.prior_year_fp_quota,
    formData.prior_year_other_contributions_base,
    formData.special_situation,
  ]);

  const requiresInput =
    formData.calculation_mode === "fp_quota" ||
    formData.calculation_mode === "other_contributions_base";

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (!hasTrackedStart.current) {
      hasTrackedStart.current = true;
      trackEvent("calculator_started", { form_type: "calculator", section: "calculadora" });
      trackFormStart("calculator");
    }

    const { name, value, type } = event.target;
    const nextValue = type === "checkbox" ? (event.target as HTMLInputElement).checked : value;
    if (name === "prior_year_fp_quota" || name === "prior_year_other_contributions_base") {
      setCalculationError(null);
    }
    setFormData((previous) => ({ ...previous, [name]: nextValue }));
  };

  const handleNext = (event: React.FormEvent) => {
    event.preventDefault();
    const amount = formData.calculation_mode === "fp_quota"
      ? parseSpanishAmount(formData.prior_year_fp_quota)
      : formData.calculation_mode === "other_contributions_base"
        ? parseSpanishAmount(formData.prior_year_other_contributions_base)
        : undefined;

    if (requiresInput && !amount) {
      setCalculationError("Introduce un importe válido, por ejemplo 4500, 4.500 o 4.500,50.");
      return;
    }

    setCalculationError(null);
    trackFormStep("calculator", 1);
    setStep(2);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!creditResult) return;

    const { rateLabel: _rateLabel, inputLabel: _inputLabel, ...creditEstimate } = creditResult;
    const result = await submit("calculator", {
      ...formData,
      prior_year_fp_quota: parseSpanishAmount(formData.prior_year_fp_quota),
      prior_year_other_contributions_base: parseSpanishAmount(formData.prior_year_other_contributions_base),
      credit_estimate: creditEstimate,
      form_steps_completed: 2,
    });

    if (result.success) {
      trackFormStep("calculator", 2);
      trackEvent("calculator_result", {
        has_credit_estimate: creditEstimate.amount !== null,
        requires_manual_review: creditEstimate.requires_manual_review,
      });
      setStep(3);
    }
  };

  const openValidation = () => {
    const calendlyUrl = getCampaignAwareUrl(config.calendlyUrl);
    if (!calendlyUrl) return;
    trackCalendlyRedirect("calculator");
    window.open(calendlyUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="bg-white py-20" id="calculadora">
      <div className="container mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase text-emerald-700">Estimación responsable</p>
          <h2 className="mb-4 text-3xl font-bold text-slate-950 sm:text-4xl">
            Calcula tu posible crédito FUNDAE
          </h2>
          <p className="text-lg leading-relaxed text-slate-600">
            Usa la cuota real de Formación Profesional si la tienes. Si no, te mostraremos el tramo aplicable y qué dato necesitas para validarlo.
          </p>
        </div>

        <div className="border border-slate-200 bg-slate-50 p-6 shadow-sm sm:p-8">
          <div className="mb-8 grid grid-cols-3 gap-2" aria-label="Progreso de la calculadora">
            {["Datos de cálculo", "Contacto", "Resultado"].map((label, index) => {
              const active = step >= index + 1;
              return (
                <div key={label} className="min-w-0">
                  <div className={`mb-2 h-1.5 ${active ? "bg-emerald-600" : "bg-slate-200"}`} />
                  <span className={`block text-xs font-semibold ${active ? "text-slate-900" : "text-slate-500"}`}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>

          {step === 1 && (
            <form onSubmit={handleNext} className="space-y-6">
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">
                    Plantilla media aproximada del año anterior *
                  </label>
                  <Select name="employee_range" required value={formData.employee_range} onChange={handleChange}>
                    <option value="">Selecciona una opción</option>
                    {EMPLOYEE_RANGES.map((range) => (
                      <option key={range.value} value={range.value}>{range.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">
                    ¿Qué dato tienes a mano? *
                  </label>
                  <Select name="calculation_mode" value={formData.calculation_mode} onChange={handleChange}>
                    <option value="no_data">No tengo el dato; quiero conocer mi tramo</option>
                    <option value="fp_quota">Cuota total de Formación Profesional pagada</option>
                    <option value="other_contributions_base">Suma de bases de otras cotizaciones</option>
                  </Select>
                </div>
              </div>

              {formData.calculation_mode === "fp_quota" && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">
                    Cuota total de Formación Profesional pagada el año anterior (€) *
                  </label>
                  <Input
                    aria-describedby="fp-quota-help"
                    inputMode="decimal"
                    name="prior_year_fp_quota"
                    required={requiresInput}
                    type="text"
                    value={formData.prior_year_fp_quota}
                    onChange={handleChange}
                    placeholder="Ej. 4.500"
                  />
                  <p id="fp-quota-help" className="mt-2 text-xs leading-relaxed text-slate-500">
                    Es un importe agregado de los recibos de liquidación; no necesitas subir ningún documento.
                  </p>
                </div>
              )}

              {formData.calculation_mode === "other_contributions_base" && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">
                    Suma anual de bases de otras cotizaciones (€) *
                  </label>
                  <Input
                    aria-describedby="other-contributions-base-help"
                    inputMode="decimal"
                    name="prior_year_other_contributions_base"
                    required={requiresInput}
                    type="text"
                    value={formData.prior_year_other_contributions_base}
                    onChange={handleChange}
                    placeholder="Ej. 650.000"
                  />
                  <p id="other-contributions-base-help" className="mt-2 text-xs leading-relaxed text-slate-500">
                    FUNDAE usa esta referencia multiplicada por el 0,7% y por el porcentaje de plantilla.
                  </p>
                </div>
              )}

              {calculationError && (
                <p className="text-sm text-red-700" role="alert">{calculationError}</p>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-800">
                  ¿Hay alguna situación especial?
                </label>
                <Select name="special_situation" value={formData.special_situation} onChange={handleChange}>
                  <option value="unknown">No lo sé</option>
                  <option value="no">No</option>
                  <option value="yes">Sí: empresa o centro nuevo, grupo, fusión/escisión o ERTE/RED</option>
                </Select>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Estos casos pueden modificar el crédito y siempre los marcaremos para revisión, no para prometer una cifra.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <Button type="submit" className="flex items-center gap-2">
                  Continuar
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-6">
              <div className="text-center">
                <h3 className="text-xl font-bold text-slate-950">¿A quién enviamos el resultado?</h3>
                <p className="mt-2 text-sm text-slate-600">Pedimos solo los datos necesarios para identificar tu solicitud.</p>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">Nombre completo *</label>
                  <Input name="name" required value={formData.name} onChange={handleChange} placeholder="Tu nombre" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">Empresa *</label>
                  <Input name="company" required value={formData.company} onChange={handleChange} placeholder="Nombre de tu empresa" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">Email corporativo *</label>
                  <Input type="email" name="email" required value={formData.email} onChange={handleChange} placeholder="nombre@empresa.com" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">Cargo (opcional)</label>
                  <Input name="role" value={formData.role} onChange={handleChange} placeholder="Ej. RRHH o dirección" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">Teléfono (opcional)</label>
                  <Input type="tel" name="phone" value={formData.phone} onChange={handleChange} placeholder="+34 600 000 000" />
                </div>
              </div>

              <label className="flex items-start gap-3 text-sm text-slate-600">
                <input
                  checked={formData.privacy_accepted}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  id="privacy_calc_v2"
                  name="privacy_accepted"
                  required
                  type="checkbox"
                  onChange={handleChange}
                />
                <span>
                  Acepto la <a href="/privacidad" className="font-medium text-emerald-700 underline">política de privacidad</a>.
                </span>
              </label>

              {error && (
                <div className="border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
                  {error}
                </div>
              )}

              <div className="flex justify-between gap-3 pt-2">
                <Button type="button" variant="ghost" onClick={() => setStep(1)}>Volver</Button>
                <Button type="submit" disabled={state === "loading"} className="flex items-center gap-2">
                  {state === "loading" ? "Guardando..." : "Ver mi estimación"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </form>
          )}

          {step === 3 && creditResult && (
            <div className="mx-auto max-w-3xl space-y-6 py-2">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <CheckCircle2 className="h-7 w-7" />
                </div>
                <p className="text-sm font-semibold uppercase text-emerald-700">Resultado orientativo</p>
                <h3 className="mt-2 text-3xl font-bold text-slate-950">Tu estimación FUNDAE</h3>
              </div>

              <div className="border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-950 p-6 text-white sm:p-8">
                  <p className="text-sm font-semibold uppercase text-slate-300">Crédito anual estimado</p>
                  {creditResult.amount === null ? (
                    <p className="mt-3 text-3xl font-bold sm:text-4xl">Importe pendiente de datos</p>
                  ) : (
                    <p className="mt-3 text-4xl font-bold text-emerald-300 sm:text-5xl">{formatEuro(creditResult.amount)}</p>
                  )}
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
                    No representa el saldo disponible ni garantiza la bonificación de un curso concreto.
                  </p>
                </div>

                <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8">
                  <div className="border border-slate-200 bg-slate-50 p-4">
                    <span className="block text-xs font-semibold uppercase text-slate-500">Plantilla media</span>
                    <span className="mt-1 block text-lg font-bold text-slate-900">{formData.employee_range} personas</span>
                  </div>
                  <div className="border border-slate-200 bg-slate-50 p-4">
                    <span className="block text-xs font-semibold uppercase text-slate-500">Tramo aplicado</span>
                    <span className="mt-1 block text-lg font-bold text-slate-900">{creditResult.rateLabel}</span>
                  </div>
                </div>

                <div className="space-y-4 px-6 pb-6 sm:px-8 sm:pb-8">
                  <div className="flex gap-3 border-l-4 border-emerald-500 bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-950">
                    <Calculator className="mt-0.5 h-5 w-5 shrink-0" />
                    <p>{getCalculationSourceCopy(creditResult)}</p>
                  </div>

                  {creditResult.requires_manual_review && (
                    <div className="flex gap-3 border-l-4 border-amber-500 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                      <p>Has indicado una situación especial o no estás seguro. La cifra debe revisarse con datos de FUNDAE/TGSS antes de tomar decisiones.</p>
                    </div>
                  )}

                  <div className="flex gap-3 border-l-4 border-slate-400 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
                    <Info className="mt-0.5 h-5 w-5 shrink-0" />
                    <p>La bonificación aplicable a un curso depende además del crédito disponible, costes admitidos, límites de coste y, cuando corresponda, cofinanciación privada.</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-4 text-center">
                <Button size="lg" className="flex items-center gap-2 px-8" onClick={openValidation}>
                  <User className="h-5 w-5" />
                  Solicitar validación con datos TGSS
                </Button>
                <a
                  className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 underline"
                  href={OFFICIAL_SIMULATOR_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  <FileText className="h-4 w-4" />
                  Contrastar en el simulador oficial de FUNDAE
                </a>
                <p className="max-w-2xl text-xs leading-relaxed text-slate-500">
                  Esta herramienta es orientativa. La aplicación de FUNDAE valida el crédito con la información de la TGSS y las circunstancias particulares de la empresa.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
