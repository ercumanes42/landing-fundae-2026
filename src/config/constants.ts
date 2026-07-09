/**
 * Business data constants for the FUNDAE landing page.
 *
 * This is the single source of truth for dropdown options, scoring rules,
 * statistics shown on the page, and calculator result messages.
 */

// ── Dropdown option types ───────────────────────────────────────────────

export interface SelectOption<V extends string = string> {
  readonly value: V;
  readonly label: string;
}

export interface TrainingAreaOption extends SelectOption {
  readonly score: number;
}

// ── Employee ranges ─────────────────────────────────────────────────────

export const EMPLOYEE_RANGES: readonly SelectOption[] = [
  { value: '1-5', label: '1-5 trabajadores' },
  { value: '6-9', label: '6-9 trabajadores' },
  { value: '10-49', label: '10-49 trabajadores' },
  { value: '50-249', label: '50-249 trabajadores' },
  { value: '+249', label: 'Más de 249 trabajadores' },
] as const;

// ── Spanish provinces (52) ──────────────────────────────────────────────

export const PROVINCES: readonly SelectOption[] = [
  { value: 'A Coruña', label: 'A Coruña' },
  { value: 'Álava', label: 'Álava' },
  { value: 'Albacete', label: 'Albacete' },
  { value: 'Alicante', label: 'Alicante' },
  { value: 'Almería', label: 'Almería' },
  { value: 'Asturias', label: 'Asturias' },
  { value: 'Ávila', label: 'Ávila' },
  { value: 'Badajoz', label: 'Badajoz' },
  { value: 'Barcelona', label: 'Barcelona' },
  { value: 'Bizkaia', label: 'Bizkaia' },
  { value: 'Burgos', label: 'Burgos' },
  { value: 'Cáceres', label: 'Cáceres' },
  { value: 'Cádiz', label: 'Cádiz' },
  { value: 'Cantabria', label: 'Cantabria' },
  { value: 'Castellón', label: 'Castellón' },
  { value: 'Ceuta', label: 'Ceuta' },
  { value: 'Ciudad Real', label: 'Ciudad Real' },
  { value: 'Córdoba', label: 'Córdoba' },
  { value: 'Cuenca', label: 'Cuenca' },
  { value: 'Gipuzkoa', label: 'Gipuzkoa' },
  { value: 'Girona', label: 'Girona' },
  { value: 'Granada', label: 'Granada' },
  { value: 'Guadalajara', label: 'Guadalajara' },
  { value: 'Huelva', label: 'Huelva' },
  { value: 'Huesca', label: 'Huesca' },
  { value: 'Illes Balears', label: 'Illes Balears' },
  { value: 'Jaén', label: 'Jaén' },
  { value: 'La Rioja', label: 'La Rioja' },
  { value: 'Las Palmas', label: 'Las Palmas' },
  { value: 'León', label: 'León' },
  { value: 'Lleida', label: 'Lleida' },
  { value: 'Lugo', label: 'Lugo' },
  { value: 'Madrid', label: 'Madrid' },
  { value: 'Málaga', label: 'Málaga' },
  { value: 'Melilla', label: 'Melilla' },
  { value: 'Murcia', label: 'Murcia' },
  { value: 'Navarra', label: 'Navarra' },
  { value: 'Ourense', label: 'Ourense' },
  { value: 'Palencia', label: 'Palencia' },
  { value: 'Pontevedra', label: 'Pontevedra' },
  { value: 'Salamanca', label: 'Salamanca' },
  { value: 'Santa Cruz de Tenerife', label: 'Santa Cruz de Tenerife' },
  { value: 'Segovia', label: 'Segovia' },
  { value: 'Sevilla', label: 'Sevilla' },
  { value: 'Soria', label: 'Soria' },
  { value: 'Tarragona', label: 'Tarragona' },
  { value: 'Teruel', label: 'Teruel' },
  { value: 'Toledo', label: 'Toledo' },
  { value: 'Valencia', label: 'Valencia' },
  { value: 'Valladolid', label: 'Valladolid' },
  { value: 'Zamora', label: 'Zamora' },
  { value: 'Zaragoza', label: 'Zaragoza' },
] as const;

// ── Sectors ─────────────────────────────────────────────────────────────

export const SECTORS: readonly SelectOption[] = [
  { value: 'tecnologia', label: 'Tecnología / TI' },
  { value: 'industria', label: 'Industria / Manufactura' },
  { value: 'construccion', label: 'Construcción' },
  { value: 'comercio', label: 'Comercio / Retail' },
  { value: 'hosteleria', label: 'Hostelería / Turismo' },
  { value: 'salud', label: 'Salud / Sanidad' },
  { value: 'educacion', label: 'Educación' },
  { value: 'transporte', label: 'Transporte / Logística' },
  { value: 'finanzas', label: 'Finanzas / Seguros' },
  { value: 'servicios_profesionales', label: 'Servicios profesionales' },
  { value: 'agricultura', label: 'Agricultura / Alimentación' },
  { value: 'energia', label: 'Energía / Medio ambiente' },
  { value: 'inmobiliaria', label: 'Inmobiliaria' },
  { value: 'otro', label: 'Otro' },
] as const;

// ── Training areas (with lead-scoring values) ───────────────────────────

export const TRAINING_AREAS: readonly TrainingAreaOption[] = [
  { value: 'ia_productividad', label: 'IA y Productividad', score: 5 },
  { value: 'automatizacion', label: 'Automatización de procesos', score: 5 },
  { value: 'liderazgo', label: 'Liderazgo y gestión de equipos', score: 4 },
  { value: 'competencias_digitales', label: 'Competencias digitales', score: 4 },
  { value: 'ventas', label: 'Ventas y atención al cliente', score: 3 },
  { value: 'compliance', label: 'Compliance y normativa', score: 3 },
  { value: 'prl', label: 'Prevención de riesgos laborales (PRL)', score: 2 },
  { value: 'otro', label: 'Otro / No lo tengo claro', score: 1 },
] as const;

// ── FUNDAE-usage options ────────────────────────────────────────────────

export const USED_FUNDAE_OPTIONS: readonly SelectOption[] = [
  { value: 'Sí', label: 'Sí' },
  { value: 'No', label: 'No' },
  { value: 'No lo sé', label: 'No lo sé' },
] as const;

export const KNOWS_CREDIT_OPTIONS: readonly SelectOption[] = [
  { value: 'Sí', label: 'Sí, conozco mi crédito' },
  { value: 'No', label: 'No, no lo conozco' },
  { value: 'No lo sé', label: 'No estoy seguro/a' },
] as const;

// ── Urgency options ─────────────────────────────────────────────────────

export const URGENCY_OPTIONS: readonly SelectOption[] = [
  { value: 'Menos de 3 meses', label: 'Menos de 3 meses' },
  { value: '3-6 meses', label: 'Entre 3 y 6 meses' },
  { value: 'Más de 6 meses', label: 'Más de 6 meses' },
  { value: 'Solo explorando', label: 'Solo estoy explorando' },
] as const;

// ── Scoring rules ───────────────────────────────────────────────────────

export const SCORING_RULES = {
  employeeRange: {
    '1-5': 1,
    '6-9': 2,
    '10-49': 5,
    '50-249': 6,
    '+249': 4,
  } as Record<string, number>,

  usedFundaeBefore: {
    No: 3,
    'No lo sé': 2,
  } as Record<string, number>,

  knowsCredit: {
    No: 3,
    'No lo sé': 3,
    'No, me gustaría averiguarlo': 3,
    'Creo que no tenemos': 3,
  } as Record<string, number>,

  formType: {
    checklist: 2,
    calculator: 5,
    webinar: 4,
    diagnostic: 10,
  } as Record<string, number>,

  urgency: {
    'Lo antes posible': 7,
    'Menos de 3 meses': 5,
  } as Record<string, number>,
} as const;

// ── Lead classification thresholds ──────────────────────────────────────

export interface LeadClassificationRule {
  readonly maxScore: number;
  readonly key: string;       // English key for payloads
  readonly label: string;     // Spanish label for UI
}

export const LEAD_CLASSIFICATION: readonly LeadClassificationRule[] = [
  { maxScore: 8, key: 'cold', label: 'Frío' },
  { maxScore: 18, key: 'warm', label: 'Templado' },
  { maxScore: 28, key: 'hot', label: 'Caliente' },
  { maxScore: Infinity, key: 'priority', label: 'Prioritario' },
] as const;

// ── FUNDAE national statistics (for StatsSection, copy, etc.) ───────────

export const FUNDAE_STATS = {
  /** % of companies that do NOT use their credit */
  creditUnused: 79.5,
  /** % of companies that DO use FUNDAE */
  adoptionRate: 20.5,
  /** % of total national credit actually executed */
  creditExecuted: 52,
  /** Adoption breakdown by company size */
  adoptionBySize: {
    '1-5': 10,
    '6-9': 18,
    '10-49': 36,
    '50-249': 68,
    '+249': 90,
  } as Record<string, number>,
} as const;

// ── Calculator result messages (per employee range) ─────────────────────

export interface CalculatorResult {
  readonly range: string;
  readonly min: string;
  readonly max: string;
  readonly bonusPercentage: string;
  readonly message: string;
}

export const CALCULATOR_RESULTS: readonly CalculatorResult[] = [
  {
    range: '1-5',
    min: '420',
    max: '420',
    bonusPercentage: '100%',
    message:
      'Todas las empresas disponen de un crédito mínimo anual garantizado por ley de 420 € para formación, independientemente de lo cotizado. Es una cantidad modesta, pero suficiente para acciones formativas puntuales de alto impacto.',
  },
  {
    range: '6-9',
    min: '1.050',
    max: '1.575',
    bonusPercentage: '100%',
    message:
      'Tu empresa disfruta del tramo máximo de bonificación (100%). Esto significa que puedes recuperar íntegramente todo el dinero cotizado durante el ejercicio anterior en contingencias de formación profesional.',
  },
  {
    range: '10-49',
    min: '1.300',
    max: '6.400',
    bonusPercentage: '75%',
    message:
      'En este tramo de plantilla, FUNDAE permite bonificar el 75% de la cantidad ingresada el año anterior por contingencias de formación profesional. Tienes una bolsa económica importante para implementar planes de formación sólidos.',
  },
  {
    range: '50-249',
    min: '5.200',
    max: '26.000',
    bonusPercentage: '60%',
    message:
      'Con una bonificación del 60%, el volumen de crédito de tu empresa permite desarrollar programas estratégicos para gran parte del equipo. A pesar de ello, gran parte de las empresas de este tamaño dejan crédito sin consumir.',
  },
  {
    range: '+249',
    min: '21.000',
    max: 'Más de 21.000',
    bonusPercentage: '50%',
    message:
      'Aplica el porcentaje de bonificación del 50%. Debido al volumen de cotización y tamaño de la plantilla, hablamos de bolsas de crédito muy significativas que requieren de una gestión y control precisos.',
  },
] as const;
