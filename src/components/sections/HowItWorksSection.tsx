import * as React from "react";
import { motion } from "motion/react";

const steps = [
  {
    number: "01",
    title: "Calcula tu oportunidad",
    description: "Usa nuestra calculadora o realiza el diagnóstico inicial para entender tu panorama."
  },
  {
    number: "02",
    title: "Revisamos tu caso",
    description: "Evaluamos el perfil de tu empresa, los requisitos y el crédito estimado."
  },
  {
    number: "03",
    title: "Diseñamos una formación útil",
    description: "Seleccionamos o creamos un programa formativo que aporte valor real a tu negocio."
  },
  {
    number: "04",
    title: "Activamos el plan y medimos resultados",
    description: "Nos encargamos de las gestiones y te acompañamos en la ejecución y reporte."
  }
];

export function HowItWorksSection() {
  return (
    <section className="py-24 bg-white" id="como-funciona">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h2 className="text-3xl font-extrabold tracking-tight text-blue-950 sm:text-4xl mb-4">
            Cómo funciona
          </h2>
          <p className="text-lg text-slate-600">
            Un proceso claro y transparente para convertir tu cotización en conocimiento. sin sorpresas ni complejidades.
          </p>
        </div>

        <div className="relative">
          {/* Connector line for large screens */}
          <div className="hidden lg:block absolute top-[43px] left-[10%] right-[10%] h-[2px] bg-slate-100" />
          
          <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="relative text-center group cursor-pointer"
              >
                <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white border-8 border-white ring-1 ring-slate-200 shadow-sm relative z-10 text-xl font-extrabold text-emerald-600 transition-all duration-300 group-hover:bg-gradient-to-br group-hover:from-emerald-500 group-hover:to-teal-600 group-hover:text-white group-hover:scale-110 group-hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] group-hover:ring-emerald-400">
                  {step.number}
                </div>
                <h3 className="mb-3 text-lg font-bold text-slate-900 group-hover:text-emerald-700 transition-colors duration-300">{step.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{step.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
