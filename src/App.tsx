import { Header } from "./components/sections/Header";
import { HeroSection } from "./components/sections/HeroSection";
import { InfiniteTicker } from "./components/sections/InfiniteTicker";
import { VideoSection } from "./components/sections/VideoSection";
import { StatsSection } from "./components/sections/StatsSection";
import { ReasonsSection } from "./components/sections/ReasonsSection";
import { EntryDoors } from "./components/sections/EntryDoors";
import { InteractiveChecklistSection } from "./components/sections/InteractiveChecklistSection";
import { CalculatorSection } from "./components/sections/CalculatorSection";
import { ChecklistSection } from "./components/sections/ChecklistSection";
import { WebinarSection } from "./components/sections/WebinarSection";
import { SolutionsSection } from "./components/sections/SolutionsSection";
import { DiagnosticSection } from "./components/sections/DiagnosticSection";
import { HowItWorksSection } from "./components/sections/HowItWorksSection";
import { FAQSection } from "./components/sections/FAQSection";
import { FinalCTASection } from "./components/sections/FinalCTASection";
import { Footer } from "./components/sections/Footer";
import { CookieConsentBanner } from "./components/CookieConsentBanner";
import { useEffect } from "react";
import { trackEvent } from "./lib/tracking";
import { flushPendingLeads } from "./lib/webhooks";
import { useGodModeTracking } from "./hooks/useGodModeTracking";

const ROUTE_TO_SECTION: Record<string, string> = {
  "/calculadora": "calculadora",
  "/checklist-10-errores": "checklist",
  "/autodiagnostico": "interactive-checklist",
  "/webinar": "webinar",
  "/diagnostico": "diagnostico",
};

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export default function App() {
  useGodModeTracking();

  useEffect(() => {
    const sectionId =
      ROUTE_TO_SECTION[normalizePath(window.location.pathname)] ??
      window.location.hash.replace("#", "");

    trackEvent("page_view", { section: sectionId || "home" });
    flushPendingLeads().catch(() => undefined);

    if (sectionId) {
      window.setTimeout(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth" });
      }, 250);
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-20 lg:pb-0">
      <div data-section="header"><Header /></div>
      <main>
        <div data-section="hero"><HeroSection /></div>
        <div data-section="ticker"><InfiniteTicker /></div>
        <div data-section="video"><VideoSection /></div>
        <div data-section="stats"><StatsSection /></div>
        <div data-section="reasons"><ReasonsSection /></div>
        <div data-section="how-it-works"><HowItWorksSection /></div>
        <div data-section="entry-doors"><EntryDoors /></div>
        <div data-section="interactive-checklist"><InteractiveChecklistSection /></div>
        <div data-section="calculator"><CalculatorSection /></div>
        <div data-section="checklist"><ChecklistSection /></div>
        <div data-section="webinar"><WebinarSection /></div>
        <div data-section="solutions"><SolutionsSection /></div>
        <div data-section="diagnostic"><DiagnosticSection /></div>
        <div data-section="faq"><FAQSection /></div>
        <div data-section="final-cta"><FinalCTASection /></div>
      </main>
      <div data-section="footer"><Footer /></div>
      <CookieConsentBanner />
      
      {/* Mobile sticky bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] lg:hidden z-50">
        <button 
          data-track-cta="mobile_sticky_calculator"
          onClick={() => {
            trackEvent("cta_click", { cta: "mobile_sticky_calculator", section: "sticky" });
            document.getElementById("calculadora")?.scrollIntoView({ behavior: "smooth" });
          }}
          className="w-full flex h-12 items-center justify-center rounded-lg bg-blue-900 text-base font-semibold text-white shadow-md hover:bg-blue-800 transition-colors"
        >
          Calcular oportunidad
        </button>
      </div>
    </div>
  );
}
