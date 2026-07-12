import React, { useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { User, Mail, Building2, ArrowRight, CheckCircle2, AlertTriangle, Info, FileDown, Calendar, Shield, Sparkles, TrendingUp } from "lucide-react";
import { CHECKLIST_MAX_SCORE, ChecklistResultLevel, checklistQuestions, getChecklistEmployeeRange, getChecklistUrgency, introQuestion } from "../../lib/checklistScoringV2";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { generateDiagnosticPDF } from "../../lib/pdfGenerator";
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
    company: "",
    privacy_accepted: false,
  });
  
  const [isDownloading, setIsDownloading] = useState(false);
  const hasTrackedStart = useRef(false);
  const { state, submit, error } = useFormSubmit();

  const maxScore = CHECKLIST_MAX_SCORE;

  const downloadPDF = () => {
    setIsDownloading(true);
    try {
      const allQuestions = [
        { id: introQuestion.id, question: introQuestion.question },
        ...checklistQuestions.map(q => ({ id: q.id, question: q.question })),
      ];

      generateDiagnosticPDF({
        userName: formData.name,
        userEmail: formData.email,
        userCompany: formData.company,
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
      company: formData.company,
      privacy_accepted: formData.privacy_accepted,
      employee_range: getChecklistEmployeeRange(answers),
      urgency: getChecklistUrgency(answers),
      marketing_accepted: false,
      score,
      risk_level: resultLevel.level,
      answers,
    };

    await submit("interactive_checklist", payload);
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
  // SUCCESS STATE — after form submission
  // ═══════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════
  // SUCCESS STATE — after form submission (Reveal Results)
  // ═══════════════════════════════════════════════════════════════════
  if (state === "success") {
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
            <div className="w-full bg-white/50 rounded-full h-3 mb-4 overflow-hidden">
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
              <Shield className="w-3.5 h-3.5" /> Autoevaluación orientativa
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
            <h4 className="text-xl font-bold text-slate-900 mb-2">Resumen preparado</h4>
            <p className="text-sm text-slate-500 mb-6">Tu resumen orientativo en PDF está listo para descargar.</p>
            
            <div className="flex flex-col gap-4">
              <button
                onClick={downloadPDF}
                disabled={isDownloading}
                className="w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold shadow-lg shadow-emerald-100 flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
              >
                {isDownloading ? (
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                ) : (
                  <FileDown className="w-5 h-5" />
                )}
                {isDownloading ? "Generando..." : "Descargar PDF"}
              </button>

              <a
                href={getCampaignAwareUrl(config.calendlyUrl) || "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackCalendlyRedirect("interactive_checklist")}
                className="w-full py-4 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-xl font-bold hover:shadow-lg hover:shadow-blue-900/20 transition-all flex items-center justify-center gap-2"
              >
                <Calendar className="w-5 h-5" />
                Agendar Análisis 1a1
              </a>
            </div>
            
            <div className="text-center mt-6">
              <button onClick={onReset} className="text-xs text-slate-400 hover:text-slate-650 underline transition-colors">
                Volver a realizar el test
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // LEAD FORM — before form submission (gated results)
  // ═══════════════════════════════════════════════════════════════════
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md mx-auto w-full py-4"
    >
      <div className="bg-white p-8 rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.08)] border border-slate-200">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-100">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h4 className="text-2xl font-extrabold text-slate-900 mb-2">Tu resumen está preparado</h4>
          
          <div className="my-5 p-4 bg-emerald-50 border border-dashed border-emerald-300 rounded-2xl flex items-center justify-center gap-2.5">
            <div className="w-3 h-3 bg-emerald-600 rounded-full shrink-0 animate-pulse" />
            <span className="text-sm font-bold text-emerald-800">Resultado listo: puntos prioritarios identificados</span>
          </div>

          <p className="text-sm text-slate-500 leading-relaxed">
            Introduce tu correo para recibir un resumen orientativo de tus respuestas y recomendaciones prioritarias.
          </p>
        </div>

        {state === "error" && (
          <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">
            {error || "Ha ocurrido un error al enviar el formulario."}
          </div>
        )}

        <form onSubmit={handleSubmit} onFocusCapture={trackStartOnce} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">Nombre completo</label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input 
                required
                type="text" 
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none font-medium text-slate-900"
                placeholder="Tu nombre"
                disabled={state === 'loading'}
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">Email Corporativo</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input 
                required
                type="email" 
                value={formData.email}
                onChange={e => setFormData({...formData, email: e.target.value})}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none font-medium text-slate-900"
                placeholder="tu@empresa.com"
                disabled={state === 'loading'}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">Empresa</label>
            <div className="relative">
              <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input 
                required
                type="text" 
                value={formData.company}
                onChange={e => setFormData({...formData, company: e.target.value})}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none font-medium text-slate-900"
                placeholder="Nombre de tu empresa"
                disabled={state === 'loading'}
              />
            </div>
          </div>

          <div className="pt-2">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative flex items-start">
                <input
                  type="checkbox"
                  required
                  checked={formData.privacy_accepted}
                  onChange={(e) => setFormData({ ...formData, privacy_accepted: e.target.checked })}
                  className="peer sr-only"
                />
                <div className="w-5 h-5 border-2 border-slate-300 rounded peer-focus:ring-2 peer-focus:ring-blue-500 peer-checked:bg-blue-600 peer-checked:border-blue-600 transition-colors flex items-center justify-center">
                  <motion.svg
                    initial={false}
                    animate={{ opacity: formData.privacy_accepted ? 1 : 0, scale: formData.privacy_accepted ? 1 : 0.5 }}
                    className="w-3 h-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </motion.svg>
                </div>
              </div>
              <span className="text-xs text-slate-500 leading-relaxed">
                He leído y acepto la política de privacidad.
              </span>
            </label>
          </div>

          <button 
            type="submit"
            disabled={state === 'loading'}
            className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-xl font-bold hover:from-blue-500 hover:to-indigo-650 transition-all shadow-lg shadow-blue-200 flex items-center justify-center gap-2 mt-2 disabled:opacity-70 disabled:cursor-not-allowed group"
          >
            {state === 'loading' ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Revelando resultados...
              </span>
            ) : (
              <>
                Ver mi resumen <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>
      </div>
    </motion.div>
  );
}
