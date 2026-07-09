import React from "react";
import { InteractiveChecklist } from "../InteractiveChecklist";

export function InteractiveChecklistSection() {
  return (
    <section className="py-24 bg-slate-50 relative overflow-hidden" id="interactive-checklist">
      {/* Decorative background */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-100/50 rounded-full blur-3xl opacity-50 translate-x-1/3 -translate-y-1/3 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-emerald-50/50 rounded-full blur-3xl opacity-50 -translate-x-1/3 translate-y-1/3 pointer-events-none" />
      
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <span className="inline-block py-1 px-3 rounded-full bg-blue-100 text-blue-800 text-sm font-bold tracking-wide mb-4">
            TEST RÁPIDO
          </span>
          <h2 className="text-3xl font-extrabold text-blue-950 sm:text-4xl lg:text-5xl mb-6 tracking-tight">
            Haz una revisión rápida de tu situación FUNDAE
          </h2>
          <p className="text-lg text-slate-600 leading-relaxed">
            Responde 10 preguntas y descubre si tu empresa tiene una base sólida, una oportunidad de mejora o riesgo de estar dejando crédito de formación sin usar.
          </p>
        </div>

        <div className="flex justify-center">
          <InteractiveChecklist />
        </div>

        <div className="mt-16 text-center max-w-2xl mx-auto">
          <p className="text-sm text-slate-500 bg-white/50 backdrop-blur px-6 py-4 rounded-xl border border-slate-200">
            Este resultado es orientativo. Para validar crédito disponible, requisitos y opciones de formación, conviene revisar el caso concreto de tu empresa.
          </p>
        </div>
        
      </div>
    </section>
  );
}
