import type {
  EmployeeRange,
  FundaeCalculationMode,
  FundaeCreditEstimate,
} from '../types';

const CREDIT_PERCENTAGE_BY_RANGE: Record<Exclude<EmployeeRange, ''>, number> = {
  '1-5': 1,
  '6-9': 1,
  '10-49': 0.75,
  '50-249': 0.6,
  '+249': 0.5,
};

export interface FundaeCreditInput {
  employeeRange: Exclude<EmployeeRange, ''>;
  calculationMode: FundaeCalculationMode;
  priorYearFpQuota?: number;
  priorYearOtherContributionsBase?: number;
  specialSituation: 'no' | 'yes' | 'unknown';
}

export interface FundaeCreditResult extends FundaeCreditEstimate {
  rateLabel: string;
  inputLabel: string;
}

function validAmount(value?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/**
 * Accepts the formats a Spanish-speaking visitor is most likely to enter:
 * 4500, 4.500, 4.500,50, or 4500.50. HTML number inputs do not understand
 * thousands separators, so this is intentionally kept separate from the UI.
 */
export function parseSpanishAmount(value: string): number | undefined {
  const compact = value.trim().replace(/[\s\u00A0]/g, '');
  if (!compact) return undefined;

  const commaIndex = compact.lastIndexOf(',');
  const dotIndex = compact.lastIndexOf('.');
  let normalized = compact;

  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? compact.replace(/\./g, '').replace(',', '.')
      : compact.replace(/,/g, '');
  } else if (commaIndex >= 0) {
    normalized = compact.replace(',', '.');
  } else if (dotIndex >= 0) {
    const dotCount = (compact.match(/\./g) ?? []).length;
    const decimalPlaces = compact.length - dotIndex - 1;
    normalized = dotCount > 1 || decimalPlaces === 3
      ? compact.replace(/\./g, '')
      : compact;
  }

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  return validAmount(Number(normalized));
}

export function getFundaeCreditPercentage(employeeRange: Exclude<EmployeeRange, ''>): number {
  return CREDIT_PERCENTAGE_BY_RANGE[employeeRange];
}

export function getFundaeRateLabel(employeeRange: Exclude<EmployeeRange, ''>): string {
  if (employeeRange === '1-5') return 'Crédito mínimo de 420 €';
  return `${Math.round(getFundaeCreditPercentage(employeeRange) * 100)}% de la cuota de Formación Profesional`;
}

export function formatEuro(value: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Mirrors FUNDAE's public calculation reference. It never claims to know the
 * remaining balance, which also depends on credit already used or reserved.
 */
export function calculateFundaeCredit(input: FundaeCreditInput): FundaeCreditResult {
  const rate = getFundaeCreditPercentage(input.employeeRange);
  const requiresManualReview = input.specialSituation !== 'no';

  if (input.employeeRange === '1-5') {
    return {
      amount: 420,
      currency: 'EUR',
      calculation_mode: input.calculationMode,
      calculation_source: 'minimum_credit',
      applied_percentage: 100,
      requires_manual_review: requiresManualReview,
      rateLabel: getFundaeRateLabel(input.employeeRange),
      inputLabel: 'Mínimo legal orientativo para una empresa con 1 a 5 personas',
    };
  }

  const quota = validAmount(input.priorYearFpQuota);
  if (input.calculationMode === 'fp_quota' && quota) {
    return {
      amount: Math.round(quota * rate * 100) / 100,
      currency: 'EUR',
      calculation_mode: input.calculationMode,
      calculation_source: 'fp_quota',
      applied_percentage: Math.round(rate * 100),
      requires_manual_review: requiresManualReview,
      rateLabel: getFundaeRateLabel(input.employeeRange),
      inputLabel: 'Cuota de Formación Profesional introducida',
    };
  }

  const base = validAmount(input.priorYearOtherContributionsBase);
  if (input.calculationMode === 'other_contributions_base' && base) {
    return {
      amount: Math.round(base * 0.007 * rate * 100) / 100,
      currency: 'EUR',
      calculation_mode: input.calculationMode,
      calculation_source: 'other_contributions_base',
      applied_percentage: Math.round(rate * 100),
      requires_manual_review: requiresManualReview,
      rateLabel: getFundaeRateLabel(input.employeeRange),
      inputLabel: 'Base de otras cotizaciones introducida',
    };
  }

  return {
    amount: null,
    currency: 'EUR',
    calculation_mode: input.calculationMode,
    calculation_source: 'insufficient_data',
    applied_percentage: Math.round(rate * 100),
    requires_manual_review: requiresManualReview,
    rateLabel: getFundaeRateLabel(input.employeeRange),
    inputLabel: 'Falta la cuota de Formación Profesional o la base de otras cotizaciones',
  };
}
