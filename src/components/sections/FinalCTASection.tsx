import * as React from "react";
import { Button } from "../ui/Button";
import { motion } from "motion/react";

export function FinalCTASection() {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section id="cta-final" className="py-24 bg-blue-950 border-t border-slate-800 relative overflow-hidden">
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)`,
        backgroundSize: '24px 24px',
      }} />
      <div className="container relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-3xl font-extrabold tracking-tight text-white md:text-5xl mb-6"
        >
          ¿Quieres saber si tu empresa está dejando crédito FUNDAE <span className="text-emerald-400">sin usar?</span>
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="text-xl text-blue-200 mb-10 max-w-2xl mx-auto"
        >
          Empieza con una revisión rápida. Sin compromiso.
        </motion.p>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row justify-center gap-4"
        >
          <Button size="lg" variant="primary" onClick={() => scrollTo("calculadora")} className="w-full sm:w-auto">
            Calcular mi oportunidad
          </Button>
          <Button size="lg" variant="outline" className="text-white border-white/20 hover:bg-white/10 hover:text-white w-full sm:w-auto" onClick={() => scrollTo("diagnostico")}>
            Agendar diagnóstico
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
