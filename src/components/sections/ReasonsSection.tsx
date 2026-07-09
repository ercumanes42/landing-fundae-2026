import * as React from "react";
import { HelpCircle, FileText, TrendingDown, CalendarX2 } from "lucide-react";
import { motion } from "motion/react";
import { copy } from "../../config/copy";

export function ReasonsSection() {
  const icons = [
    <CalendarX2 className="h-6 w-6" />,
    <FileText className="h-6 w-6" />,
    <TrendingDown className="h-6 w-6" />,
    <HelpCircle className="h-6 w-6" />,
  ];

  const cardStyles = [
    "bg-gradient-to-br from-blue-50 to-indigo-50/50 border-blue-100 hover:border-blue-300 hover:shadow-[0_8px_30px_rgba(37,99,235,0.12)]",
    "bg-gradient-to-br from-emerald-50 to-teal-50/50 border-emerald-100 hover:border-emerald-300 hover:shadow-[0_8px_30px_rgba(16,185,129,0.12)]",
    "bg-gradient-to-br from-amber-50 to-orange-50/50 border-amber-100 hover:border-amber-300 hover:shadow-[0_8px_30px_rgba(245,158,11,0.12)]",
    "bg-gradient-to-br from-purple-50 to-fuchsia-50/50 border-purple-100 hover:border-purple-300 hover:shadow-[0_8px_30px_rgba(147,51,234,0.12)]",
  ];
  const iconColors = [
    "text-blue-600 bg-white border-blue-200 group-hover:bg-blue-600 group-hover:text-white",
    "text-emerald-600 bg-white border-emerald-200 group-hover:bg-emerald-600 group-hover:text-white",
    "text-amber-600 bg-white border-amber-200 group-hover:bg-amber-600 group-hover:text-white",
    "text-purple-600 bg-white border-purple-200 group-hover:bg-purple-600 group-hover:text-white",
  ];
  const blobColors = [
    "bg-blue-400/10",
    "bg-emerald-400/10",
    "bg-amber-400/10",
    "bg-purple-400/10",
  ];

  return (
    <section className="py-24 bg-white relative overflow-hidden" id="razones">
      {/* Decorative background blobs for the section */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-blue-50/50 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-emerald-50/50 rounded-full blur-3xl translate-x-1/2 translate-y-1/2 pointer-events-none" />

      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h3 className="text-sm font-bold text-emerald-600 uppercase tracking-[0.2em] mb-4">
            Beneficios Clave
          </h3>
          <h2 className="text-3xl font-extrabold text-blue-950 sm:text-4xl">
            {copy.reasons.sectionTitle}
          </h2>
        </div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {copy.reasons.items.map((reason, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1, type: "spring", stiffness: 100 }}
              className={`flex flex-col gap-4 p-8 rounded-[2rem] border transition-all duration-300 group relative overflow-hidden ${cardStyles[i % 4]}`}
            >
              <div className={`absolute top-0 right-0 w-32 h-32 rounded-bl-[100px] -z-10 group-hover:scale-125 transition-transform duration-500 ${blobColors[i % 4]}`} />
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border shadow-sm transition-colors duration-300 ${iconColors[i % 4]}`}>
                {icons[i] || <HelpCircle className="h-6 w-6" />}
              </div>
              <span className="text-xl font-bold text-slate-900 leading-snug mt-2">{reason.title}</span>
              <p className="text-slate-600 leading-relaxed flex-grow">{reason.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
