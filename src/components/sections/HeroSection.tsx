import * as React from "react";
import { Button } from "../ui/Button";
import { ArrowRight, BarChart3, AlertTriangle } from "lucide-react";
import { motion, useMotionValue, useTransform, useSpring, useReducedMotion } from "motion/react";
import { copy } from "../../config/copy";
import { FUNDAE_STATS } from "../../config/constants";
import { AnimatedNumber } from "../ui/AnimatedNumber";

export function HeroSection() {
  const prefersReducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const mouseXSpring = useSpring(x, { stiffness: 300, damping: 30 });
  const mouseYSpring = useSpring(y, { stiffness: 300, damping: 30 });

  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["3deg", "-3deg"]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-3deg", "3deg"]);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || window.matchMedia("(pointer: coarse)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    x.set(mouseX / rect.width - 0.5);
    y.set(mouseY / rect.height - 0.5);
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
    <section className="relative flex min-h-[90vh] items-center overflow-hidden bg-[#030914] pb-24 pt-12 lg:pb-40 lg:pt-16" id="inicio">
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <div className="absolute -left-48 top-20 h-[32rem] w-[32rem] rounded-full bg-[#302b7b]/20 blur-[120px]" />
        <div className="absolute -right-40 bottom-0 h-[34rem] w-[34rem] rounded-full bg-[#FF206E]/10 blur-[130px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
      </div>

      <div className="container relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-16 lg:grid-cols-2 lg:gap-10">
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="mx-auto max-w-2xl text-center lg:mx-0 lg:text-left"
          >
            <h1 className="mb-6 text-4xl font-extrabold leading-[1.15] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Aclara tu <span className="text-[#FF206E] drop-shadow-[0_0_15px_rgba(255,32,110,0.35)]">crédito formativo</span> y qué debes revisar antes de utilizarlo
            </h1>

            <p className="mx-auto mb-10 max-w-xl text-lg font-light leading-relaxed text-slate-300 lg:mx-0">
              {copy.hero.subheadline}
            </p>

            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mb-10 flex flex-col justify-center gap-5 sm:flex-row lg:justify-start"
            >
              <Button size="lg" data-track-cta="hero_autoevaluation" onClick={() => scrollTo("interactive-checklist")} className="gap-2 rounded-xl border border-[#FF7BA9] bg-[#FF206E] px-8 py-6 text-lg text-[#050A18] shadow-[0_0_20px_rgba(255,32,110,0.28)] transition-all hover:-translate-y-1 hover:bg-[#FF206E] hover:shadow-[0_0_30px_rgba(255,32,110,0.4)]">
                {copy.hero.primaryCta} <ArrowRight className="h-6 w-6" />
              </Button>
              <Button size="lg" variant="outline" data-track-cta="hero_explore" onClick={() => scrollTo("opciones")} className="rounded-xl border-white/20 bg-white/5 py-6 text-white backdrop-blur-sm transition-all hover:bg-white/10">
                {copy.hero.secondaryCta}
              </Button>
            </motion.div>

            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="mx-auto grid max-w-lg grid-cols-3 gap-4 border-t border-white/10 pt-8 sm:gap-6 lg:mx-0"
            >
              {copy.hero.stats.map((stat, i) => (
                <div key={i}>
                  <div className="mb-1 text-2xl font-bold text-white drop-shadow-md">{stat.value}</div>
                  <div className="text-xs font-medium uppercase tracking-wider text-slate-400">{stat.label}</div>
                </div>
              ))}
            </motion.div>
          </motion.div>

          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
            className="relative mx-auto w-full max-w-[650px] lg:mx-0"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{ perspective: 1200 }}
          >
            <motion.div
              className="relative w-full"
              style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
            >
              <div className="absolute -inset-8 -z-20 hidden rounded-[3.5rem] border border-[#302b7b]/45 bg-[#302b7b]/5 lg:block" style={{ transform: "translateZ(-45px) rotate(4deg)" }} />
              <div className="absolute -inset-4 -z-10 hidden rounded-[3rem] border border-[#FF206E]/20 bg-[#FF206E]/5 lg:block" style={{ transform: "translateZ(-20px) rotate(-3deg)" }} />
              <div className="pointer-events-none absolute -inset-1 rounded-[2.2rem] bg-gradient-to-br from-[#302b7b]/70 via-cyan-500/25 to-[#FF206E]/45 opacity-65 blur-2xl" />

              <div className="relative flex min-h-[520px] flex-col overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#081322] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.5)] sm:min-h-[570px] sm:rounded-[2rem] sm:p-8">
                <video
                  className="absolute inset-0 h-full w-full object-cover object-center"
                  autoPlay={!prefersReducedMotion}
                  loop
                  muted
                  playsInline
                  preload="metadata"
                  poster="/hero-reality-fundae-poster.jpg"
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  <source src="/hero-reality-fundae.mp4" type="video/mp4" />
                </video>
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#061124]/70 via-[#061124]/82 to-[#030914]/98" aria-hidden="true" />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#030914]/35 via-transparent to-[#030914]/25" aria-hidden="true" />

                <h3 className="relative z-10 mb-8 flex items-center gap-3 text-2xl font-black tracking-tight text-white">
                  <span className="rounded-xl border border-blue-400/35 bg-[#0b1b36]/75 p-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] backdrop-blur-md">
                    <BarChart3 className="h-6 w-6 text-blue-300" />
                  </span>
                  Realidad en España
                </h3>

                <div className="relative z-10 flex flex-1 flex-col justify-end gap-8">
                  <div className="rounded-2xl border border-white/10 bg-[#030914]/45 p-4 shadow-xl backdrop-blur-md sm:p-5">
                    <div className="group/item mb-7">
                      <div className="mb-3 flex justify-between gap-4 text-sm font-bold tracking-wide text-white">
                        <span className="text-slate-100 transition-colors group-hover/item:text-emerald-300">Cobertura formativa anual</span>
                        <span className="font-mono text-base text-emerald-300 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]"><AnimatedNumber value={`${FUNDAE_STATS.adoptionRate}%`} /></span>
                      </div>
                      <div className="h-3.5 w-full overflow-hidden rounded-full border border-white/15 bg-black/70 shadow-inner">
                        <motion.div
                          initial={prefersReducedMotion ? false : { width: 0 }}
                          animate={{ width: `${FUNDAE_STATS.adoptionRate}%` }}
                          transition={{ duration: 1.5, delay: 0.8, ease: "easeOut" }}
                          className="relative h-full rounded-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-emerald-300 shadow-[0_0_15px_rgba(52,211,153,0.8)]"
                        >
                          <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent motion-safe:animate-[shimmer_2s_infinite]" />
                        </motion.div>
                      </div>
                    </div>

                    <div className="group/item">
                      <div className="mb-3 flex justify-between gap-4 text-sm font-bold tracking-wide text-white">
                        <span className="text-slate-100 transition-colors group-hover/item:text-rose-300">Ratio de disposición del crédito</span>
                        <span className="font-mono text-base text-rose-300 drop-shadow-[0_0_8px_rgba(251,113,133,0.8)]"><AnimatedNumber value={`${FUNDAE_STATS.creditExecuted}%`} /></span>
                      </div>
                      <div className="h-3.5 w-full overflow-hidden rounded-full border border-white/15 bg-black/70 shadow-inner">
                        <motion.div
                          initial={prefersReducedMotion ? false : { width: 0 }}
                          animate={{ width: `${FUNDAE_STATS.creditExecuted}%` }}
                          transition={{ duration: 1.5, delay: 1, ease: "easeOut" }}
                          className="relative h-full rounded-full bg-gradient-to-r from-rose-600 via-rose-500 to-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.8)]"
                        >
                          <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent motion-safe:animate-[shimmer_2s_infinite]" />
                        </motion.div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-amber-400/30 bg-[#17150f]/70 p-4 shadow-xl backdrop-blur-md sm:gap-4 sm:p-5">
                    <div className="shrink-0 rounded-xl bg-amber-400/15 p-2.5 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                      <AlertTriangle className="h-5 w-5 text-amber-300" />
                    </div>
                    <div>
                      <p className="mb-1.5 text-sm font-bold uppercase tracking-wider text-amber-300">Dato clave</p>
                      <p className="text-sm font-light leading-relaxed text-slate-200">
                        Datos agregados FUNDAE 2024: cobertura formativa y ratio de disposición. No describen la situación de una empresa concreta.
                      </p>
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
