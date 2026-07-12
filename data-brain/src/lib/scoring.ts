import type {
  LeadClassification,
  LeadScoreBreakdown,
  LeadScoringInput,
} from './types';

const MAX_DIMENSION_SCORE = 25;

function clampDimension(value: number): number {
  return Math.max(0, Math.min(MAX_DIMENSION_SCORE, Math.round(value)));
}

function normalize(value?: string): string {
  return (value ?? '').trim().toLowerCase();
}

function containsAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

function scoreFit(data: LeadScoringInput): number {
  const employeeScores: Record<string, number> = {
    '1-5': 4,
    '6-9': 8,
    '10-49': 15,
    '50-249': 18,
    '+249': 14,
  };

  let employeeRange = data.employee_range;
  let roleStr = data.role;
  let sectorStr = data.sector;
  let provinceStr = data.province;

  // --- VALORES IMPLÍCITOS DE FIT SEGÚN CAPTADOR ---
  if (data.form_type === 'diagnostic') {
    // Diagnóstico de 15 minutos en Calendly (alta intención, no pide trabajadores)
    if (!employeeRange) employeeRange = '10-49';
  } else if (data.form_type === 'interactive_checklist') {
    const explicitEmployeeRange = data.employee_range ?? data.answers?.company_size;
    employeeRange = explicitEmployeeRange && Object.prototype.hasOwnProperty.call(employeeScores, explicitEmployeeRange)
      ? explicitEmployeeRange
      : undefined;
    roleStr = data.role ?? '';
  } else if (data.form_type === 'checklist') {
    // Descarga pasiva del Checklist de errores (no pide cargo)
    if (!roleStr) roleStr = 'gestor_implicito';
  }

  let score = employeeScores[employeeRange ?? ''] ?? 0;
  const role = normalize(roleStr);
  if (
    containsAny(role, [
      'ceo',
      'direccion',
      'director',
      'gerente',
      'rrhh',
      'recursos humanos',
      'talento',
      'formacion',
      'formación',
      'operaciones',
      'gestor_implicito',
    ])
  ) {
    score += (role === 'gestor_implicito') ? 2 : 4;
  } else if (role) {
    score += 2;
  }

  const sector = normalize(sectorStr);
  if (
    [
      'tecnologia',
      'industria',
      'servicios_profesionales',
      'salud',
      'transporte',
      'finanzas',
      'energia',
    ].includes(sector)
  ) {
    score += 2;
  } else if (sector) {
    score += 1;
  }

  if (provinceStr) score += 1;

  // --- NORMALIZACIÓN DE ESCALA ---
  // Calculamos el valor máximo factible de sumar en base al diseño del formulario
  let maxPossibleScore = 25;
  if (data.form_type === 'checklist') {
    maxPossibleScore = 21; // employee_range (18) + role implícito (3)
  } else if (data.form_type === 'webinar') {
    maxPossibleScore = 22; // employee_range (18) + role (4)
  } else if (data.form_type === 'diagnostic') {
    maxPossibleScore = 22; // employee_range implícito (18) + role (4)
  }

  const normalizedScore = (score / maxPossibleScore) * MAX_DIMENSION_SCORE;
  return clampDimension(normalizedScore);
}

function scoreIntent(data: LeadScoringInput): number {
  const formScores: Record<LeadScoringInput['form_type'], number> = {
    checklist: 7,
    interactive_checklist: 13,
    webinar: 12,
    calculator: 17,
    diagnostic: 22,
  };

  let score = formScores[data.form_type] ?? 0;
  if (data.calendly_click) score += 25;

  const area = normalize(data.training_area);
  if (
    containsAny(area, [
      'ia',
      'automatiza',
      'liderazgo',
      'digital',
      'ventas',
      'productividad',
    ])
  ) {
    score += 3;
  }

  const risk = normalize(data.risk_level);
  if (risk === 'high' || risk.includes('alto')) score += 4;
  if (risk === 'medium' || risk.includes('medio')) score += 2;

  return clampDimension(score);
}

function scoreEngagement(data: LeadScoringInput): number {
  const journey = data.journey;
  if (!journey) return 0;

  let score = 0;
  score += Math.min(new Set(journey.sections_viewed ?? []).size * 2, 8);

  const scrollDepth = journey.scroll_depth ?? 0;
  if (scrollDepth >= 90) score += 6;
  else if (scrollDepth >= 75) score += 4;
  else if (scrollDepth >= 50) score += 2;

  const timeOnPage = journey.time_on_page_seconds ?? 0;
  if (timeOnPage >= 240) score += 5;
  else if (timeOnPage >= 120) score += 3;
  else if (timeOnPage >= 45) score += 1;

  if (journey.video_played) score += 3;
  if (journey.repeat_visit) score += 2;
  score += Math.min((journey.form_steps_completed ?? 0) * 2, 4);

  return clampDimension(score);
}

function scoreUrgency(data: LeadScoringInput): number {
  let score = 0;
  let urgencyVal = data.urgency;
  let knowsCreditVal = data.knows_credit;
  let usedFundaeVal = data.used_fundae_before;
  let riskVal = data.risk_level;

  // --- VALORES IMPLÍCITOS DE URGENCIA SEGÚN CAPTADOR ---
  if (data.form_type === 'diagnostic') {
    // Al pedir consultoría 1a1, la urgencia comercial es inmediata por defecto
    if (!urgencyVal) urgencyVal = 'inmediato';
    if (!knowsCreditVal) knowsCreditVal = 'gustaria averiguarlo';
    if (!usedFundaeVal) usedFundaeVal = 'no';
    if (!riskVal) riskVal = 'high';
  } else if (data.form_type === 'interactive_checklist' && data.answers) {
    const creditVisibility = data.answers.credit_visibility;
    if (!knowsCreditVal && (creditVisibility === 'No todavía' || creditVisibility === 'No lo sé')) {
      knowsCreditVal = 'no';
    }

    const reviewTiming = data.answers.review_timing;
    if (!urgencyVal && reviewTiming === 'Esta semana') urgencyVal = 'inmediato';
    if (!urgencyVal && reviewTiming === 'En los próximos 3 meses') urgencyVal = 'menos de 3 meses';
  } else if (data.form_type === 'webinar') {
    // Webinar tiene compromiso temporal implícito
    if (!urgencyVal) urgencyVal = 'menos de 3 meses';
    if (!knowsCreditVal) knowsCreditVal = 'gustaria averiguarlo';
  } else if (data.form_type === 'checklist') {
    // Cierre de año fiscal FUNDAE en Q4 (Octubre, Noviembre, Diciembre) aumenta urgencia
    const currentMonth = new Date().getMonth();
    if (currentMonth >= 9 && !urgencyVal) {
      urgencyVal = 'menos de 3 meses';
    }
  } else if (data.form_type === 'calculator') {
    // Si calculadora detecta empresa grande, el volumen de crédito en riesgo es urgente
    const employeeRange = data.employee_range;
    if ((employeeRange === '50-249' || employeeRange === '+249') && !urgencyVal) {
      urgencyVal = 'menos de 3 meses';
      riskVal = 'high';
    }
  }

  const urgency = normalize(urgencyVal);
  if (containsAny(urgency, ['lo antes', 'inmediato', 'urgente'])) score += 10;
  else if (containsAny(urgency, ['menos de 3'])) score += 8;
  else if (containsAny(urgency, ['3-6', '3 a 6', 'entre 3'])) score += 4;

  const knowsCredit = normalize(knowsCreditVal);
  if (
    containsAny(knowsCredit, [
      'no',
      'no lo',
      'no,',
      'gustaria averiguarlo',
      'gustaría averiguarlo',
      'creo que no',
    ])
  ) {
    score += 6;
  }

  const usedFundae = normalize(usedFundaeVal);
  if (usedFundae === 'no') score += 5;
  else if (containsAny(usedFundae, ['no lo', 'no se', 'no sé'])) score += 3;

  const risk = normalize(riskVal);
  if (risk === 'high' || risk.includes('alto')) score += 4;
  if (risk === 'medium' || risk.includes('medio')) score += 2;

  // Si el captador no tiene campos de urgencia ni se dedujo nada (ej. Checklist en Q1/Q2)
  // le asignamos un valor base neutral mínimo de salvaguarda.
  if (!urgencyVal && !knowsCreditVal && !usedFundaeVal && !riskVal) {
    score = 4;
  }

  return clampDimension(score);
}

export function classifyLead(score: number): LeadClassification {
  if (score <= 39) return 'cold';
  if (score <= 59) return 'warm';
  if (score <= 79) return 'hot';
  return 'priority';
}

export function calculateLeadScoreBreakdown(
  data: LeadScoringInput,
): LeadScoreBreakdown {
  const fit = scoreFit(data);
  const intent = scoreIntent(data);
  const engagement = scoreEngagement(data);
  const urgency = scoreUrgency(data);
  const total = Math.max(0, Math.min(100, fit + intent + engagement + urgency));

  return {
    fit,
    intent,
    engagement,
    urgency,
    total,
    classification: classifyLead(total),
  };
}
