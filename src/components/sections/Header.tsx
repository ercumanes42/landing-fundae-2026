import * as React from "react";
import { Button } from "../ui/Button";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { copy } from "../../config/copy";

export function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const scrollTo = (id: string) => {
    setIsMobileMenuOpen(false);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full glass">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF206E] focus-visible:ring-offset-2"
            onClick={() => scrollTo("inicio")}
            aria-label="Ir al inicio"
          >
            <img src="/gfs-consulting-logo.png" alt="GFS Consulting Group" className="h-8 w-auto" />
          </button>

          {/* Desktop Nav */}
          <nav className="hidden md:flex gap-8 items-center text-sm font-medium text-slate-600">
            {copy.header.nav.map((item) => (
              item.label !== 'Inicio' && (
                <button
                  key={item.label}
                  onClick={() => scrollTo(item.href.substring(1))}
                  className="relative rounded-sm transition-colors hover:text-[#302B7B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF206E] focus-visible:ring-offset-2 group"
                >
                  {item.label}
                  <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-blue-600 transition-all group-hover:w-full"></span>
                </button>
              )
            ))}
          </nav>

          {/* CTA & Mobile Toggle */}
          <div className="flex items-center gap-3">
            <button 
              data-track-cta="header_autoevaluation"
              onClick={() => scrollTo("interactive-checklist")}
              className="hidden min-h-11 lg:flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm bg-[#FF206E] text-[#050A18] shadow-[0_0_15px_rgba(255,32,110,0.28)] hover:shadow-[0_0_25px_rgba(255,32,110,0.4)] hover:-translate-y-0.5 transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#302B7B] focus-visible:ring-offset-2"
            >
              <div className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
              </div>
              Autoevaluación
            </button>
            
            <Button 
              data-track-cta="header_explore"
              size="sm"
              onClick={() => scrollTo("opciones")}
              className="hidden sm:inline-flex bg-slate-900 hover:bg-slate-800 text-white shadow-sm hover:shadow-md transition-all rounded-xl px-4"
            >
              {copy.header.cta}
            </Button>
            <button
              className="md:hidden min-h-11 min-w-11 rounded-lg p-2 text-slate-600 hover:text-[#302B7B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF206E] focus-visible:ring-offset-2"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-controls="mobile-navigation"
              aria-expanded={isMobileMenuOpen}
              aria-label={isMobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
            >
              {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-gray-100 bg-white"
          >
            <nav id="mobile-navigation" className="flex flex-col px-4 py-4 space-y-4">
              {copy.header.nav.map((item) => (
                <button
                  key={item.label}
                  onClick={() => scrollTo(item.href.substring(1))}
                  className="min-h-11 w-full rounded-md text-left text-base font-medium text-slate-600 hover:text-[#302B7B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF206E] focus-visible:ring-offset-2"
                >
                  {item.label}
                </button>
              ))}
              <div className="flex flex-col gap-3 pt-2">
                <button 
                  data-track-cta="mobile_menu_autoevaluation"
              onClick={() => scrollTo("interactive-checklist")}
                  className="flex min-h-11 items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-[#050A18] bg-[#FF206E] shadow-[0_0_15px_rgba(255,32,110,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#302B7B] focus-visible:ring-offset-2"
                >
                  <div className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                  </div>
                  Autoevaluación (2 min)
                </button>
                <Button size="sm" data-track-cta="mobile_menu_explore" onClick={() => scrollTo("opciones")} className="w-full justify-center bg-slate-900 py-6 rounded-xl">
                  {copy.header.cta}
                </Button>
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
