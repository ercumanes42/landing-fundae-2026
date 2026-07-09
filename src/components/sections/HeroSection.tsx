import * as React from "react";
import { Button } from "../ui/Button";
import { ArrowRight, BarChart3, Clock, AlertTriangle } from "lucide-react";
import { motion, useMotionValue, useTransform, useSpring } from "motion/react";
import { copy } from "../../config/copy";
import { FUNDAE_STATS } from "../../config/constants";
import { AnimatedNumber } from "../ui/AnimatedNumber";

export function HeroSection() {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const mouseXSpring = useSpring(x, { stiffness: 300, damping: 30 });
  const mouseYSpring = useSpring(y, { stiffness: 300, damping: 30 });

  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["15deg", "-15deg"]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-15deg", "15deg"]);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;
    
    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="relative overflow-hidden pt-12 pb-24 lg:pt-16 lg:pb-40 min-h-[90vh] flex items-center" id="inicio">
      
      {/* 🎬 CINEMATIC VIDEO BACKGROUND */}
      <div className="absolute inset-0 w-full h-full z-0 bg-slate-900">
        <video 
          autoPlay 
          loop 
          muted 
          playsInline 
          className="w-full h-full object-cover opacity-80"
        >
          <source src="/hero_video.mp4" type="video/mp4" />
        </video>
        
        {/* Dark overlay to ensure text readability */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#030914]/95 via-[#061124]/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#030914] via-transparent to-transparent opacity-80" />
      </div>
      
      <div className="container relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-16 lg:grid-cols-2 lg:gap-8 items-center">
          
          {/* TEXT COLUMN */}
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="max-w-2xl mx-auto text-center lg:mx-0 lg:text-left"
          >
            <h1 className="text-4xl font-extrabold text-white leading-[1.15] sm:text-5xl lg:text-6xl mb-6 tracking-tight">
              El <span className="text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]">{FUNDAE_STATS.creditUnused}%</span> de las empresas pierde su <span className="relative inline-block text-blue-300">crédito de formación<svg className="absolute w-full h-3 -bottom-1 left-0 text-blue-500/40 -z-10" viewBox="0 0 100 10" preserveAspectRatio="none"><path d="M0,5 Q50,10 100,5" stroke="currentColor" strokeWidth="8" fill="none"/></svg></span> cada año
            </h1>
            
            <p className="text-lg text-slate-300 mb-10 max-w-xl mx-auto lg:mx-0 leading-relaxed font-light">
              {copy.hero.subheadline}
            </p>
            
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="flex flex-col sm:flex-row gap-5 mb-10 justify-center lg:justify-start"
            >
              <Button size="lg" onClick={() => scrollTo("interactive-checklist")} className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:shadow-[0_0_30px_rgba(16,185,129,0.6)] transition-all hover:-translate-y-1 py-6 px-8 text-lg rounded-xl border border-emerald-500/50">
                {copy.hero.primaryCta} <ArrowRight className="h-6 w-6" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => scrollTo("diagnostico")} className="bg-white/5 hover:bg-white/10 text-white border-white/20 backdrop-blur-sm py-6 rounded-xl transition-all">
                {copy.hero.secondaryCta}
              </Button>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="grid grid-cols-3 gap-6 pt-8 border-t border-white/10 max-w-lg mx-auto lg:mx-0"
            >
              {copy.hero.stats.map((stat, i) => (
                <div key={i}>
                  <div className="text-2xl font-bold text-white mb-1 drop-shadow-md">{stat.value}</div>
                  <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">{stat.label}</div>
                </div>
              ))}
            </motion.div>
          </motion.div>

          {/* 3D GLASSMORPHISM CARD WITH ROTATING LAYERS */}
          <motion.div 
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
            className="relative w-full aspect-square lg:aspect-auto"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{ perspective: 1200 }}
          >
            <motion.div 
              className="relative w-full h-full lg:h-auto"
              style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
            >
              {/* Rotating background layer 1 (Slower, larger) */}
              <motion.div 
                animate={{ rotate: 360 }} 
                transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
                className="absolute -inset-12 border border-blue-500/20 rounded-[4rem] bg-gradient-to-tr from-blue-500/5 to-transparent backdrop-blur-sm -z-20 hidden lg:block"
                style={{ transform: "translateZ(-50px)" }}
              />
              
              {/* Rotating background layer 2 (Faster, tighter) */}
              <motion.div 
                animate={{ rotate: -360 }} 
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                className="absolute -inset-6 border border-emerald-500/20 rounded-[3rem] bg-gradient-to-bl from-emerald-500/10 to-transparent backdrop-blur-md -z-10 hidden lg:block"
                style={{ transform: "translateZ(-25px)" }}
              />

              {/* Glowing aura behind card */}
              <div className="absolute -inset-1 rounded-[2.5rem] bg-gradient-to-br from-blue-500/40 via-emerald-500/20 to-purple-500/40 blur-2xl opacity-60 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
              
              <div className="relative rounded-[2rem] border border-white/10 bg-[#0A101C]/80 backdrop-blur-2xl p-8 shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden h-full flex flex-col justify-center">
                {/* Decorative glowing blobs inside the card */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
                
                <h3 className="text-2xl font-black text-white mb-8 flex items-center gap-3 tracking-tight">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/30">
                    <BarChart3 className="h-6 w-6 text-blue-400" />
                  </div>
                  Realidad en España
                </h3>
                
                <div className="space-y-8 relative z-10">
                  <div className="group/item">
                    <div className="flex justify-between text-sm font-bold text-white mb-3 tracking-wide">
                      <span className="text-slate-300 group-hover/item:text-emerald-400 transition-colors">Empresas que SÍ lo usan</span>
                      <span className="text-emerald-400 font-mono text-base drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]"><AnimatedNumber value={`${FUNDAE_STATS.adoptionRate}%`} /></span>
                    </div>
                    <div className="h-3.5 w-full rounded-full bg-black/50 overflow-hidden border border-white/10 shadow-inner">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${FUNDAE_STATS.adoptionRate}%` }}
                        transition={{ duration: 1.5, delay: 0.8, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-emerald-300 rounded-full shadow-[0_0_15px_rgba(52,211,153,0.8)] relative" 
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
                      </motion.div>
                    </div>
                  </div>

                  <div className="group/item">
                    <div className="flex justify-between text-sm font-bold text-white mb-3 tracking-wide">
                      <span className="text-slate-300 group-hover/item:text-rose-400 transition-colors">Empresas que lo PIERDEN</span>
                      <span className="text-rose-400 font-mono text-base drop-shadow-[0_0_8px_rgba(251,113,133,0.8)]"><AnimatedNumber value={`${FUNDAE_STATS.creditUnused}%`} /></span>
                    </div>
                    <div className="h-3.5 w-full rounded-full bg-black/50 overflow-hidden border border-white/10 shadow-inner">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${FUNDAE_STATS.creditUnused}%` }}
                        transition={{ duration: 1.5, delay: 1, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-rose-600 via-rose-500 to-rose-400 rounded-full shadow-[0_0_15px_rgba(244,63,94,0.8)] relative" 
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
                      </motion.div>
                    </div>
                  </div>
                  
                  <div className="pt-8 mt-2 border-t border-white/10 relative">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                    <div className="flex items-start gap-4 p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 shadow-inner group-hover:border-amber-500/40 transition-colors backdrop-blur-sm">
                      <div className="bg-amber-500/20 p-2.5 rounded-xl shrink-0 shadow-[0_0_15px_rgba(245,158,11,0.3)]">
                        <AlertTriangle className="h-5 w-5 text-amber-400" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-amber-400 mb-1.5 uppercase tracking-wider">Dato clave</p>
                        <p className="text-sm text-slate-300 leading-relaxed font-light">
                          Solo 1 de cada 5 empresas usa sus créditos FUNDAE. 
                          A nivel global, se ejecuta en torno al <strong className="text-white font-bold">{FUNDAE_STATS.creditExecuted}%</strong> del crédito disponible.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        
        </div>
      </div>
    </section>
  );
}
