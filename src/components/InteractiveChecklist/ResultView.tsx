import React, { useRef, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, AlertTriangle, Info, Calendar, Shield, Sparkles, TrendingUp } from "lucide-react";
import { CHECKLIST_MAX_SCORE, ChecklistResultLevel, checklistQuestions, getChecklistEmployeeRange, getChecklistUrgency, introQuestion } from "../../lib/checklistScoringV2";
import { useFormSubmit } from "../../hooks/useFormSubmit";

import { config } from "../../config";
import { getCampaignAwareUrl, trackCalendlyRedirect, trackFormStart, trackPdfDownload } from "../../lib/tracking";

interface ResultViewProps {
  score: number;
  resultLevel: ChecklistResultLevel;
  recommendations: string[];
  answers: Record<string, string>;
  onReset: () => void;
}

export function ResultView({ score, resultLevel, recommendations, answers, onReset }: ResultViewProps) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    privacy_accepted: false,
  });
  
  const [isDownloading, setIsDownloading] = useState(false);
  const hasTrackedStart = useRef(false);
  const { state, submit, error } = useFormSubmit();

  const maxScore = CHECKLIST_MAX_SCORE;

  const downloadPDF = async () => {
    setIsDownloading(true);
    try {
      const { generateDiagnosticPDF } = await import("../../lib/pdfGenerator");
      const allQuestions = [
        { id: introQuestion.id, question: introQuestion.question },
        ...checklistQuestions.map(q => ({ id: q.id, question: q.question })),
      ];

      await generateDiagnosticPDF({
        score,
        maxScore,
        resultLevel,
        recommendations,
        answers,
        questions: allQuestions,
      });
      trackPdfDownload("interactive_checklist");
    } catch (error) {
      console.error('Error generating PDF:', error);
    } finally {
      setTimeout(() => setIsDownloading(false), 800);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.privacy_accepted) return;

    const payload = {
      name: formData.name,
      email: formData.email,
      privacy_accepted: formData.privacy_accepted,
      employee_range: getChecklistEmployeeRange(answers),
      urgency: getChecklistUrgency(answers),
      marketing_accepted: false,
      score,
      risk_level: resultLevel.level,
      answers,
    };

    const result = await submit("interactive_checklist", payload);
    if (result.success) {
      await downloadPDF();
    }
  };

  const trackStartOnce = () => {
    if (!hasTrackedStart.current) {
      hasTrackedStart.current = true;
      trackFormStart("interactive_checklist");
    }
  };

  const getIcon = () => {
    if (resultLevel.level === 'low') return <CheckCircle2 className="w-8 h-8 text-emerald-500" />;
    if (resultLevel.level === 'medium') return <Info className="w-8 h-8 text-amber-500" />;
    return <AlertTriangle className="w-8 h-8 text-rose-500" />;
  };

  const getColorClasses = () => {
    if (resultLevel.level === 'low') return "bg-emerald-50 border-emerald-200 text-emerald-900";
    if (resultLevel.level === 'medium') return "bg-amber-50 border-amber-200 text-amber-900";
    return "bg-rose-50 border-rose-200 text-rose-900";
  };

  const getAccentGradient = () => {
    if (resultLevel.level === 'low') return "from-emerald-500 to-teal-600";
    if (resultLevel.level === 'medium') return "from-amber-500 to-orange-600";
    return "from-rose-500 to-red-600";
  };

  const getScorePercentage = () => Math.round((score / maxScore) * 100);


  // ═══════════════════════════════════════════════════════════════════
  // SUCCESS STATE — after form submission (Reveal Results)
  // ═══════════════════════════════════════════════════════════════════
  const resultIsReady = Number.isFinite(score);
  if (resultIsReady) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl mx-auto w-full grid lg:grid-cols-5 gap-8 py-4"
      >
        {/* RESULT PANEL */}
        <div className="lg:col-span-3 space-y-6">
          {/* Score indicator */}
          <div className={`p-6 sm:p-8 rounded-3xl border ${getColorClasses()} relative overflow-hidden`}>
            {/* Decorative background */}
            <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${getAccentGradient()} opacity-10 rounded-full -translate-y-1/2 translate-x-1/2`} />
            
            <div className="flex items-start gap-4 mb-6 relative">
              <div className="p-3 bg-white/60 backdrop-blur-sm rounded-2xl shadow-sm shrink-0">
                {getIcon()}
              </div>
              <div className="flex-1">
                <span className="text-sm font-bold uppercase tracking-wider opacity-80 mb-1 block">
                  Resultado orientativo
                </span>
                <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                  {resultLevel.title}
                </h3>
              </div>
              <div className={`text-4xl font-black bg-gradient-to-br ${getAccentGradient()} bg-clip-text text-transparent`}>
                {score}/{maxScore}
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-white/50 rounded-full h-3 mb-4 overflow-hidden" role="progressbar" aria-label="Puntuación obtenida" aria-valuemin={0} aria-valuemax={maxScore} aria-valuenow={score}>
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${getScorePercentage()}%` }}
                transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
                className={`h-full rounded-full bg-gradient-to-r ${getAccentGradient()}`}
              />
            </div>

            <p className="text-lg opacity-90 leading-relaxed">
              {resultLevel.text}
            </p>
          </div>

          {recommendations.length > 0 && (
            <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-sm">
              <h4 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-sm">
                  <Sparkles className="w-5 h-5" />
                </span>
                Recomendaciones prioritarias
              </h4>
              <ul className="space-y-4">
                {recommendations.map((rec, idx) => (
                  <motion.li 
                    key={idx} 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + idx * 0.15 }}
                    className="flex items-start gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shrink-0 text-sm font-bold shadow-sm mt-0.5">
                      {idx + 1}
                    </div>
                    <span className="text-slate-700 leading-relaxed">{rec}</span>
                  </motion.li>
                ))}
              </ul>
            </div>
          )}

          {/* Trust indicators */}
          <div className="flex items-center gap-6 text-xs text-slate-400 px-2">
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" /> Orientación, no auditoría
            </span>
            <span className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" /> Basado en tus respuestas
            </span>
          </div>
        </div>

        {/* SUCCESS ACTION PANEL */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.06)] border border-slate-200 sticky top-24 text-center">
            <motion.div 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
              className="w-16 h-16 bg-gradient-to-br from-emerald-400 to-emerald-600 text-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-100"
            >
              <CheckCircle2 className="w-8 h-8" />
            </motion.div>
            <h4 className="text-xl font-bold text-slate-900 mb-2">Tu diagnóstico está listo</h4>
            <p className="text-sm text-slate-500 mb-6">Indica tu nombre y correo profesional para registrar la solicitud y descargar el informe ahora.</p>

            {state === "success" ? (
              <div className="mb-5 space-y-3">
                <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Solicitud registrada y descarga iniciada.</p>
                <button type="button" onClick={downloadPDF} disabled={isDownloading} className="w-full min-h-11 rounded-xl border border-[#302B7B] px-4 py-3 text-sm font-bold text-[#302B7B] disabled:opacity-60">
                  {isDownloading ? "Generando..." : "Descargar de nuevo"}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} onFocusCapture={trackStartOnce} className="mb-5 space-y-3 text-left">
                <label htmlFor="checklist-result-name" className="block text-sm font-semibold text-slate-800">Nombre</label>
                <input id="checklist-result-name" name="name" required autoComplete="given-name" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full rounded-xl border border-slate-300 px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#302B7B]" placeholder="Tu nombre" />
                <label htmlFor="checklist-result-email" className="block text-sm font-semibold text-slate-800">Correo profesional</label>
                <input id="checklist-result-email" name="email" required type="email" autoComplete="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full rounded-xl border border-slate-300 px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#302B7B]" placeholder="tu@empresa.com" />
                <label className="flex items-start gap-2 text-xs text-slate-600"><input required type="checkbox" checked={formData.privacy_accepted} onChange={e => setFormData({...formData, privacy_accepted: e.target.checked})} className="mt-0.5 h-4 w-4 accent-[#302B7B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF206E]" /><span>He leído la <a href="/privacidad" className="rounded-sm font-semibold text-[#302B7B] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF206E]">política de privacidad</a> y solicito recibir esta copia.</span></label>
                {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
                <button type="submit" data-track-cta="autoevaluation_email_copy" disabled={state === "loading" || isDownloading} className="w-full min-h-11 rounded-xl bg-[#FF206E] px-4 py-3 text-sm font-bold text-[#050A18] hover:bg-[#e91d66] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#302B7B] focus-visible:ring-offset-2 disabled:opacity-60">{state === "loading" || isDownloading ? "Preparando..." : "Registrar y descargar mi informe"}</button>
              </form>
            )}
            
            <div className="flex flex-col gap-4">
              <a
                data-track-cta="autoevaluation_diagnostic"
                href={getCampaignAwareUrl(config.calendlyUrl) || "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackCalendlyRedirect("interactive_checklist")}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#302B7B] px-6 py-4 font-bold text-white transition-all hover:bg-[#241F65] hover:shadow-lg hover:shadow-[#302B7B]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF206E] focus-visible:ring-offset-2"
              >
                <Calendar className="w-5 h-5" />
                Valorar una revisión de 15 minutos
              </a>
            </div>
            
            <div className="text-center mt-6">
              <button data-track-cta="autoevaluation_reset" onClick={onReset} className="min-h-11 rounded-sm px-2 text-xs text-slate-600 underline transition-colors hover:text-[#302B7B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF206E] focus-visible:ring-offset-2">
                Volver a realizar el test
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }


  return null;
}
