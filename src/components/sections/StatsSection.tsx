import * as React from "react";
import { motion } from "motion/react";
import { copy } from "../../config/copy";
import { AnimatedNumber } from "../ui/AnimatedNumber";

export function StatsSection() {
  const statsData = copy.stats.items.map((item, index) => {
    const colors = ["text-red-500", "text-blue-600", "text-emerald-500"];
    return {
      ...item,
      color: colors[index % colors.length]
    };
  });

  return (
    <section className="py-24 bg-slate-50 relative overflow-hidden" id="problema">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="text-center mb-16">
          <h2 className="text-3xl font-extrabold text-blue-950 sm:text-4xl">
            {copy.stats.sectionTitle}
          </h2>
        </div>

        <div className="grid gap-6 sm:grid-cols-3 mb-16 max-w-5xl mx-auto">
          {statsData.map((stat, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 flex flex-col items-center text-center group"
            >
              <div className={`text-5xl font-black tracking-tighter mb-4 ${stat.color} group-hover:scale-105 transition-transform duration-300`}>
                <AnimatedNumber value={stat.value} />
              </div>
              <div className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">
                {stat.label}
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">
                {stat.description}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-4xl mx-auto text-center bg-blue-950 text-white rounded-3xl p-10 md:p-14 shadow-2xl border border-blue-900 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-800 rounded-full blur-3xl opacity-30 -translate-y-1/2 translate-x-1/2 pointer-events-none" />
          <p className="text-2xl md:text-3xl font-medium leading-relaxed relative z-10">
            “El problema no es la falta de crédito. El problema es la <span className="text-emerald-400 font-bold relative inline-block">baja adopción<svg className="absolute w-full h-2 -bottom-1 left-0 text-emerald-500/50 -z-10" viewBox="0 0 100 10" preserveAspectRatio="none"><path d="M0,5 Q50,10 100,5" stroke="currentColor" strokeWidth="8" fill="none"/></svg></span>, especialmente en microempresas y pymes.”
          </p>
        </motion.div>

      </div>
    </section>
  );
}
