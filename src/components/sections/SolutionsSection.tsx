import * as React from "react";
import { Button } from "../ui/Button";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";

const solutions = [
  {
    title: "Activación FUNDAE Pyme",
    target: "Para empresas que nunca han usado FUNDAE.",
    includes: [
      "Diagnóstico inicial.",
      "Revisión de oportunidad.",
      "Recomendación formativa.",
      "Primera acción formativa bonificable."
    ],
    cta: "Solicitar revisión",
    highlight: false
  },
  {
    title: "IA y Productividad Bonificable",
    target: "Para empresas que quieren convertir su crédito en formación práctica.",
    includes: [
      "Formación en IA aplicada.",
      "Productividad.",
      "Automatización básica.",
      "Casos de uso por área."
    ],
    cta: "Ver programa",
    highlight: true
  },
  {
    title: "Plan Anual FUNDAE",
    target: "Para empresas con más estructura.",
    includes: [
      "Mapa de necesidades.",
      "Calendario anual.",
      "Formación por trimestre.",
      "Seguimiento y Reporting."
    ],
    cta: "Pedir propuesta",
    highlight: false
  }
];

export function SolutionsSection() {
  const scrollTo = (id: string, solutionTitle?: string) => {
    if (solutionTitle) {
      window.dispatchEvent(new CustomEvent('prefillDiagnostic', { detail: solutionTitle }));
    }
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="py-24 bg-white" id="soluciones">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl font-extrabold tracking-tight text-blue-950 sm:text-4xl mb-4">
            Rutas de trabajo destacadas
          </h2>
          <p className="text-lg text-slate-600">
            Diferentes formas de activar tu crédito en función de las necesidades actuales de tu equipo.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-3 items-stretch">
          {solutions.map((solution, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              className={`relative flex flex-col rounded-3xl p-8 border ${solution.highlight ? 'border-blue-950 bg-blue-950 text-white shadow-2xl scale-100 lg:scale-105 z-10' : 'border-slate-200 bg-white text-slate-900 shadow-sm'}`}
            >
              {solution.highlight && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-amber-100 text-amber-800 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                  Más demandado
                </div>
              )}
              
              <h3 className="text-2xl font-bold mb-2">{solution.title}</h3>
              <p className={`text-sm mb-8 ${solution.highlight ? 'text-blue-200' : 'text-slate-500'}`}>
                {solution.target}
              </p>
              
              <div className="mb-8 flex-grow">
                <p className={`font-semibold mb-4 ${solution.highlight ? 'text-white' : 'text-slate-900'}`}>Incluye:</p>
                <ul className="space-y-4">
                  {solution.includes.map((item, j) => (
                    <li key={j} className="flex gap-3 items-start">
                      <svg className={`h-5 w-5 shrink-0 ${solution.highlight ? 'text-emerald-400' : 'text-blue-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              
              <Button 
                variant={solution.highlight ? 'primary' : 'outline'} 
                className={`w-full justify-center gap-2 ${!solution.highlight && 'border-slate-300'}`}
                onClick={() => scrollTo("diagnostico", solution.title)}
              >
                {solution.cta} <ArrowRight className="h-4 w-4" />
              </Button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
