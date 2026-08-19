export interface FunnelRoute {
  sectionId: string;
  ctaLabel: string;
  title: string;
  description: string;
}

export const FUNNEL_ROUTES: Record<string, FunnelRoute> = {
  "/calculadora": {
    sectionId: "calculadora",
    ctaLabel: "Calcular mi estimación",
    title: "Calculadora FUNDAE",
    description: "Estimación orientativa con los datos que conoces.",
  },
  "/checklist-10-errores": {
    sectionId: "checklist",
    ctaLabel: "Descargar el checklist",
    title: "Checklist de 10 controles",
    description: "Revisión práctica antes de bonificar formación.",
  },
  "/autodiagnostico": {
    sectionId: "interactive-checklist",
    ctaLabel: "Empezar la autoevaluación",
    title: "Autoevaluación FUNDAE",
    description: "Resultado y prioridades sin facilitar datos personales.",
  },
  "/webinar": {
    sectionId: "webinar",
    ctaLabel: "Reservar plaza",
    title: "Webinar FUNDAE",
    description: "Sesión práctica sobre planificación y control.",
  },
};

export const LEGAL_PATHS = ["/aviso-legal", "/privacidad", "/cookies"] as const;

export function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}
