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
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => scrollTo("inicio")}>
            <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-900 shadow-md">
              <div className="w-4 h-4 border-2 border-white rounded-sm"></div>
            </div>
            <span className="text-xl font-bold tracking-tight text-blue-900">
              {copy.header.brand}<span className="font-light text-slate-500">STRATEGIC</span>
            </span>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex gap-8 items-center text-sm font-medium text-slate-600">
            {copy.header.nav.map((item) => (
              item.label !== 'Inicio' && (
                <button
                  key={item.label}
                  onClick={() => scrollTo(item.href.substring(1))}
                  className="hover:text-blue-900 transition-colors relative group"
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
              onClick={() => scrollTo("interactive-checklist")}
              className="hidden lg:flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)] hover:shadow-[0_0_25px_rgba(16,185,129,0.6)] hover:-translate-y-0.5 transition-all group"
            >
              <div className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
              </div>
              Test Rápido
            </button>
            
            <Button 
              size="sm" 
              onClick={() => scrollTo("diagnostico")} 
              className="hidden sm:inline-flex bg-slate-900 hover:bg-slate-800 text-white shadow-sm hover:shadow-md transition-all rounded-xl px-4"
            >
              {copy.header.cta}
            </Button>
            <button
              className="md:hidden p-2 text-slate-600 hover:text-blue-900"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
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
            <nav className="flex flex-col px-4 py-4 space-y-4">
              {copy.header.nav.map((item) => (
                <button
                  key={item.label}
                  onClick={() => scrollTo(item.href.substring(1))}
                  className="text-left text-base font-medium text-slate-600 hover:text-blue-900 w-full"
                >
                  {item.label}
                </button>
              ))}
              <div className="flex flex-col gap-3 pt-2">
                <button 
                  onClick={() => scrollTo("interactive-checklist")}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                >
                  <div className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                  </div>
                  Test Rápido (2 min)
                </button>
                <Button size="sm" onClick={() => scrollTo("diagnostico")} className="w-full justify-center bg-slate-900 py-6 rounded-xl">
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
