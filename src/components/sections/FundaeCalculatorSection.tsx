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
  buildFundaeCreditInsight,
  calculateFundaeCredit,
  parseSpanishAmount,
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

type SpecialSituationSelection = "" | "none" | "new_company" | "erte" | "reservation_or_group" | "unknown";

function normalizeSpecialSituation(selection: SpecialSituationSelection): "no" | "yes" | "unknown" {
  if (selection === "none") return "no";
  if (selection === "unknown" || selection === "") return "unknown";
  return "yes";
}

export function FundaeCalculatorSection() {
  const [step, setStep] = React.useState(1);
  const { state, error, submit } = useFormSubmit();
  const hasTrackedStart = React.useRef(false);
  const hasTrackedCompletion = React.useRef(false);
  const [calculationError, setCalculationError] = React.useState<string | null>(null);
  const [formData, setFormData] = React.useState({
    employee_range: "" as EmployeeRange,
    calculation_mode: "no_data" as FundaeCalculationMode,
    prior_year_fp_quota: "",
    prior_year_other_contributions_base: "",
    special_situation_detail: "" as SpecialSituationSelection,
    name: "",
    company: "",
    role: "",
    email: "",
    phone: "",
    privacy_accepted: false,
  });

  const employeeRange = formData.employee_range || undefined;
  const creditInput = React.useMemo(() => {
    if (!employeeRange) return null;

    return {
      employeeRange,
      calculationMode: formData.calculation_mode,
      priorYearFpQuota: parseSpanishAmount(formData.prior_year_fp_quota),
      priorYearOtherContributionsBase: parseSpanishAmount(formData.prior_year_other_contributions_base),
      specialSituation: normalizeSpecialSituation(formData.special_situation_detail),
    } as const;
  }, [
    employeeRange,
    formData.calculation_mode,
    formData.prior_year_fp_quota,
    formData.prior_year_other_contributions_base,
    formData.special_situation_detail,
  ]);
  const creditResult = React.useMemo(
    () => creditInput ? calculateFundaeCredit(creditInput) : null,
    [creditInput],
  );
  const creditInsight = React.useMemo(
    () => creditInput && creditResult
      ? buildFundaeCreditInsight(creditInput, creditResult)
      : null,
    [creditInput, creditResult],
  );

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
    if (creditResult) {
      const eventData = {
        calculation_source: creditResult.calculation_source,
        employee_range: formData.employee_range,
        has_credit_estimate: creditResult.amount !== null,
        requires_manual_review: creditResult.requires_manual_review,
      };
      trackEvent("calculator_result", eventData);
      if (!hasTrackedCompletion.current) {
        hasTrackedCompletion.current = true;
        trackEvent("calculator_completed", eventData);
      }
    }
    setStep(2);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!creditResult) return;

    const { rateLabel: _rateLabel, inputLabel: _inputLabel, ...creditEstimate } = creditResult;
    const result = await submit("calculator", {
      ...formData,
      special_situation: normalizeSpecialSituation(formData.special_situation_detail),
      marketing_accepted: false,
      prior_year_fp_quota: parseSpanishAmount(formData.prior_year_fp_quota),
      prior_year_other_contributions_base: parseSpanishAmount(formData.prior_year_other_contributions_base),
      credit_estimate: creditEstimate,
      form_steps_completed: 2,
    });

    if (result.success) {
      trackFormStep("calculator", 2);
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
          <p className="mb-3 text-sm font-semibold uppercase text-emerald-700">Resultado y plan antes del email</p>
          <h2 className="mb-4 text-3xl font-bold text-slate-950 sm:text-4xl">
            Calcula en 60 segundos tu referencia FUNDAE
          </h2>
          <p className="text-lg leading-relaxed text-slate-600">
            Si tienes el dato de cotización, obtendrás una estimación. Si no, verás tu tramo, el dato exacto que debes localizar y cómo validarlo. Sin subir documentos.
          </p>
        </div>

        <div className="border border-slate-200 bg-slate-50 p-6 shadow-sm sm:p-8">
          <div className="mb-8 grid grid-cols-2 gap-2" aria-label="Progreso de la calculadora">
            {["Datos de cálculo", "Tu diagnóstico"].map((label, index) => {
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
                    <option value="other_contributions_base">Suma anual de Base otras cotizaciones</option>
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
                    Suma anual de Base otras cotizaciones del año anterior (€) *
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
                    Aplicaremos la referencia publicada: Base otras cotizaciones × 0,7% × porcentaje de plantilla.
                  </p>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-800">
                  ¿Se da alguna de estas situaciones? *
                </label>
                <Select name="special_situation_detail" required value={formData.special_situation_detail} onChange={handleChange}>
                  <option value="">Selecciona una opción</option>
                  <option value="none">Ninguna de estas situaciones</option>
                  <option value="new_company">Empresa o centro de trabajo de nueva creación</option>
                  <option value="erte">Personas afectadas por ERTE o mecanismo RED</option>
                  <option value="reservation_or_group">Reserva de crédito o grupo de empresas</option>
                  <option value="unknown">No lo sé</option>
                </Select>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Si eliges una situación especial, no inventaremos un importe: marcaremos el caso para validación.
                </p>
              </div>

              {calculationError && (
                <p className="text-sm text-red-700" role="alert">{calculationError}</p>
              )}

              <div className="flex justify-end pt-2">
                <Button type="submit" className="flex items-center gap-2" data-track-cta="calculator_continue">
                  Ver mi diagnóstico FUNDAE
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </form>
          )}

          {step === 2 && creditResult && creditInsight && (
            <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-6">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <CheckCircle2 className="h-7 w-7" />
                </div>
                <p className="text-sm font-semibold uppercase text-emerald-700">Diagnóstico orientativo</p>
                <h3 className="mt-2 text-3xl font-bold text-slate-950">Esta es tu referencia y lo que falta validar</h3>
              </div>

              <div className="border border-slate-200 bg-white" aria-live="polite">
                <div className="border-b border-slate-200 bg-slate-950 p-6 text-white sm:p-8">
                  <p className="text-sm font-semibold uppercase text-slate-300">Tu referencia hoy</p>
                  <p className="mt-3 text-4xl font-bold text-emerald-300 sm:text-5xl">{creditInsight.reference}</p>
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
                    <span className="block text-xs font-semibold uppercase text-slate-500">Nivel de validación</span>
                    <span className="mt-1 block text-lg font-bold text-slate-900">{creditInsight.validationLabel}</span>
                  </div>
                </div>

                <div className="space-y-4 px-6 pb-6 sm:px-8 sm:pb-8">
                  <div className="flex gap-3 border-l-4 border-emerald-500 bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-950">
                    <Calculator className="mt-0.5 h-5 w-5 shrink-0" />
                    <div><strong className="block">Cómo se calcula</strong>{creditInsight.formula}</div>
                  </div>

                  {creditInsight.missingData && (
                    <div className="flex gap-3 border-l-4 border-amber-500 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                      <div><strong className="block">Dato que falta</strong>{creditInsight.missingData}</div>
                    </div>
                  )}

                  <div className="flex gap-3 border-l-4 border-slate-400 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
                    <Info className="mt-0.5 h-5 w-5 shrink-0" />
                    <div><strong className="block">Qué significa</strong>{creditInsight.validationText}</div>
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 bg-white p-6 sm:p-8">
                <h4 className="text-xl font-bold text-slate-950">Tus próximos 3 pasos</h4>
                <ol className="mt-5 space-y-4">
                  {creditInsight.nextSteps.map((nextStep, index) => (
                    <li key={nextStep} className="flex gap-3 text-sm leading-relaxed text-slate-700">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#302B7B] font-bold text-white">{index + 1}</span>
                      <span>{nextStep}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="flex flex-col items-center gap-4 text-center">
                <Button size="lg" type="button" className="flex items-center gap-2 px-8" data-track-cta="calculator_validate" onClick={openValidation}>
                  <User className="h-5 w-5" />
                  Solicitar validación con datos TGSS
                </Button>
                <a
                  data-track-cta="calculator_official_simulator"
                  className="inline-flex min-h-11 items-center gap-2 rounded-sm px-2 text-sm font-medium text-[#302B7B] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF206E] focus-visible:ring-offset-2"
                  href={OFFICIAL_SIMULATOR_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  <FileText className="h-4 w-4" />
                  Contrastar en el simulador oficial de FUNDAE
                </a>
              </div>

              <div className="border-t border-slate-200 pt-6 text-center">
                <h4 className="text-xl font-bold text-slate-950">¿Quieres conservar este resultado?</h4>
                <p className="mt-2 text-sm text-slate-600">Puedes registrar una solicitud de copia. El diagnóstico seguirá visible y no daremos el correo por enviado hasta confirmarlo.</p>
              </div>

              <div className="mx-auto grid max-w-md gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">Nombre</label>
                  <Input name="name" required autoComplete="given-name" value={formData.name} onChange={handleChange} placeholder="Tu nombre" />
                </div>
                <div>
                <label className="mb-2 block text-sm font-medium text-slate-800">Correo profesional</label>
                  <Input type="email" name="email" required autoComplete="email" value={formData.email} onChange={handleChange} placeholder="nombre@empresa.com" />
                </div>
              </div>

              <label className="flex items-start gap-3 text-sm text-slate-600">
                <input
                  checked={formData.privacy_accepted}
                  className="mt-1 h-4 w-4 rounded border-slate-300 accent-[#302B7B] focus:ring-[#302B7B]"
                  id="privacy_calc_v2"
                  name="privacy_accepted"
                  required
                  type="checkbox"
                  onChange={handleChange}
                />
                <span>
                  He leído la <a href="/privacidad" className="rounded-sm font-medium text-[#302B7B] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF206E]">política de privacidad</a>.
                </span>
              </label>

              {error && (
                <div className="border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <Button type="button" variant="ghost" onClick={() => setStep(1)}>Volver</Button>
                <Button type="submit" variant="outline" data-track-cta="calculator_email_copy" disabled={state === "loading"} className="flex items-center gap-2">
                  {state === "loading" ? "Registrando..." : state === "success" ? "Solicitud registrada" : "Solicitar copia"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
