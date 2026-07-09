import type {
  LeadClassification,
  LeadScoreBreakdown,
  LeadScoringInput,
  LeadStatus,
} from '../types';

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

  let score = employeeScores[data.employee_range ?? ''] ?? 0;

  const role = normalize(data.role);
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
    ])
  ) {
    score += 4;
  } else if (role) {
    score += 2;
  }

  const sector = normalize(data.sector);
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

  if (data.province) score += 1;

  return clampDimension(score);
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
  const uniqueSections = new Set(journey.sections_viewed ?? []);
  score += Math.min(uniqueSections.size * 2, 8);

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
  const urgency = normalize(data.urgency);

  if (containsAny(urgency, ['lo antes', 'inmediato', 'urgente'])) score += 10;
  else if (containsAny(urgency, ['menos de 3'])) score += 8;
  else if (containsAny(urgency, ['3-6', '3 a 6', 'entre 3'])) score += 4;

  const knowsCredit = normalize(data.knows_credit);
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

  const usedFundae = normalize(data.used_fundae_before);
  if (usedFundae === 'no') score += 5;
  else if (containsAny(usedFundae, ['no lo', 'no se', 'no sé'])) score += 3;

  const risk = normalize(data.risk_level);
  if (risk === 'high' || risk.includes('alto')) score += 4;
  if (risk === 'medium' || risk.includes('medio')) score += 2;

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

export function calculateLeadScore(data: LeadScoringInput): number {
  return calculateLeadScoreBreakdown(data).total;
}

export function getLeadStatus(score: number): LeadStatus {
  const statusMap: Record<LeadClassification, LeadStatus> = {
    cold: 'frio',
    warm: 'templado',
    hot: 'caliente',
    priority: 'prioritario',
  };
  return statusMap[classifyLead(score)];
}

export function getLeadLabel(classification: LeadClassification): string {
  const labels: Record<LeadClassification, string> = {
    cold: 'Frio',
    warm: 'Templado',
    hot: 'Caliente',
    priority: 'Prioritario',
  };
  return labels[classification];
}
