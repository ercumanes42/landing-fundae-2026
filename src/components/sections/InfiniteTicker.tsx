import React from "react";
import { motion } from "motion/react";

export function InfiniteTicker() {
  // We duplicate the items a few times so the loop is seamless
  const phrases = [
    "DIAGNÓSTICO ESTRATÉGICO",
    "MAXIMIZA TU CRÉDITO FUNDAE",
    "FORMACIÓN BONIFICADA",
    "SIN RIESGOS",
    "AUDITORÍA CERTIFICADA",
    "1.200+ PYMES ACTIVAS",
    "PARTNERS OFICIALES"
  ];

  return (
    <div className="w-full overflow-hidden bg-[#0A0A0A] py-4 border-y border-white/10 relative flex">
      {/* Decorative gradients */}
      <div className="absolute top-0 left-0 bottom-0 w-24 bg-gradient-to-r from-[#0A0A0A] to-transparent z-10 pointer-events-none" />
      <div className="absolute top-0 right-0 bottom-0 w-24 bg-gradient-to-l from-[#0A0A0A] to-transparent z-10 pointer-events-none" />
      
      <motion.div
        className="flex whitespace-nowrap"
        animate={{ x: [0, -1035] }} // the x value might need tuning depending on content width
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "linear",
          repeatType: "loop"
        }}
      >
        {/* We map the array multiple times to create the infinite effect */}
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center">
            {phrases.map((phrase, j) => (
              <React.Fragment key={`${i}-${j}`}>
                <span className="text-emerald-400 font-black tracking-widest uppercase text-sm mx-8">
                  {phrase}
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-white/20 mx-4" />
              </React.Fragment>
            ))}
          </div>
        ))}
      </motion.div>
    </div>
  );
}
