export const DEFAULT_MIN_SAMPLE_SIZE = 30;

const DEFAULT_CONFIDENCE_Z = 1.959963984540054;
const DEFAULT_ANOMALY_THRESHOLD = 3.5;

export interface RateResult {
  successes: number;
  total: number;
  rate: number;
  percentage: number;
}

export interface ConfidenceInterval extends RateResult {
  lower: number;
  upper: number;
  confidenceLevel: 0.95;
}

export type LiftDirection = 'up' | 'down' | 'flat' | 'unavailable';

export interface LiftComparison {
  candidate: ConfidenceInterval | null;
  baseline: ConfidenceInterval | null;
  absoluteLift: number | null;
  relativeLift: number | null;
  direction: LiftDirection;
  hasMinimumSample: boolean;
  isStatisticallyReliable: boolean;
  explanation: string;
}

export interface SeriesPoint {
  key: string;
  value: number;
}

export interface SeriesAnomaly extends SeriesPoint {
  index: number;
  direction: 'high' | 'low';
  score: number;
  explanation: string;
}

export interface RecommendationCandidate {
  key: string;
  label: string;
  dimension: string;
  successes: number;
  total: number;
  baselineSuccesses: number;
  baselineTotal: number;
}

export type RecommendationAction =
  | 'collect_more_data'
  | 'scale_candidate'
  | 'review_candidate'
  | 'monitor_candidate';

export interface CampaignRecommendation {
  key: string;
  action: RecommendationAction;
  priority: 1 | 2 | 3;
  title: string;
  explanation: string;
  evidence: {
    dimension: string;
    candidateRate: number | null;
    baselineRate: number | null;
    absoluteLift: number | null;
    relativeLift: number | null;
    candidateSample: number;
    baselineSample: number;
    minimumSample: number;
    statisticallyReliable: boolean;
  };
}

function isValidCount(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function hasValidBinomialCounts(successes: number, total: number): boolean {
  return isValidCount(successes) && isValidCount(total) && successes <= total;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatPercentage(rate: number | null): string {
  return rate === null ? 'sin tasa calculable' : `${round(rate * 100, 2)}%`;
}

export function calculateSafeRate(
  successes: number,
  total: number,
): RateResult | null {
  if (!hasValidBinomialCounts(successes, total) || total === 0) return null;

  const rate = successes / total;
  return {
    successes,
    total,
    rate: round(rate),
    percentage: round(rate * 100, 4),
  };
}

export function calculateWilsonInterval(
  successes: number,
  total: number,
  z = DEFAULT_CONFIDENCE_Z,
): ConfidenceInterval | null {
  const metric = calculateSafeRate(successes, total);
  if (!metric || !Number.isFinite(z) || z <= 0) return null;

  const observedRate = successes / total;
  const zSquared = z * z;
  const denominator = 1 + zSquared / total;
  const centre = (observedRate + zSquared / (2 * total)) / denominator;
  const margin =
    (z *
      Math.sqrt(
        (observedRate * (1 - observedRate) + zSquared / (4 * total)) /
          total,
      )) /
    denominator;

  return {
    ...metric,
    lower: round(Math.max(0, centre - margin)),
    upper: round(Math.min(1, centre + margin)),
    confidenceLevel: 0.95,
  };
}

export function compareCampaignMetric(
  candidateSuccesses: number,
  candidateTotal: number,
  baselineSuccesses: number,
  baselineTotal: number,
  minimumSample = DEFAULT_MIN_SAMPLE_SIZE,
): LiftComparison {
  const candidate = calculateWilsonInterval(candidateSuccesses, candidateTotal);
  const baseline = calculateWilsonInterval(baselineSuccesses, baselineTotal);
  const validMinimum =
    isValidCount(minimumSample) && minimumSample > 0
      ? minimumSample
      : DEFAULT_MIN_SAMPLE_SIZE;
  const hasMinimumSample =
    candidateTotal >= validMinimum && baselineTotal >= validMinimum;

  if (!candidate || !baseline) {
    return {
      candidate,
      baseline,
      absoluteLift: null,
      relativeLift: null,
      direction: 'unavailable',
      hasMinimumSample: false,
      isStatisticallyReliable: false,
      explanation: 'No hay denominadores válidos para comparar las tasas.',
    };
  }

  const absoluteLift = candidate.rate - baseline.rate;
  const relativeLift =
    baseline.rate === 0 ? null : absoluteLift / baseline.rate;
  const epsilon = 1e-12;
  const direction: LiftDirection =
    absoluteLift > epsilon ? 'up' : absoluteLift < -epsilon ? 'down' : 'flat';
  const intervalsDoNotOverlap =
    candidate.lower > baseline.upper || candidate.upper < baseline.lower;
  const isStatisticallyReliable =
    hasMinimumSample && direction !== 'flat' && intervalsDoNotOverlap;

  let explanation: string;
  if (!hasMinimumSample) {
    explanation = `Muestra insuficiente: se requieren al menos ${validMinimum} observaciones en candidato y baseline.`;
  } else if (direction === 'flat') {
    explanation = 'Las tasas observadas son iguales.';
  } else if (!intervalsDoNotOverlap) {
    explanation = 'El lift observado no es concluyente porque los intervalos Wilson 95% se solapan.';
  } else {
    explanation = `Diferencia fiable: ${formatPercentage(candidate.rate)} frente a ${formatPercentage(baseline.rate)}.`;
  }

  return {
    candidate,
    baseline,
    absoluteLift: round(absoluteLift),
    relativeLift: relativeLift === null ? null : round(relativeLift),
    direction,
    hasMinimumSample,
    isStatisticallyReliable,
    explanation,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function detectSeriesAnomalies(
  points: readonly SeriesPoint[],
  threshold = DEFAULT_ANOMALY_THRESHOLD,
): SeriesAnomaly[] {
  const validPoints = points.filter((point) => Number.isFinite(point.value));
  if (
    validPoints.length < 5 ||
    !Number.isFinite(threshold) ||
    threshold <= 0
  ) {
    return [];
  }

  const values = validPoints.map((point) => point.value);
  const centre = median(values);
  const absoluteDeviations = values.map((value) => Math.abs(value - centre));
  const medianAbsoluteDeviation = median(absoluteDeviations);

  return validPoints.flatMap((point) => {
    const deviation = point.value - centre;
    const score =
      medianAbsoluteDeviation === 0
        ? deviation === 0
          ? 0
          : Number.POSITIVE_INFINITY
        : Math.abs((0.6744897501960817 * deviation) / medianAbsoluteDeviation);

    if (score < threshold) return [];

    return [
      {
        ...point,
        index: points.indexOf(point),
        direction: deviation > 0 ? ('high' as const) : ('low' as const),
        score: Number.isFinite(score) ? round(score, 3) : score,
        explanation: `Valor ${deviation > 0 ? 'superior' : 'inferior'} al patrón reciente (mediana ${round(centre, 3)}; umbral robusto ${threshold}).`,
      },
    ];
  });
}

export function generateCampaignRecommendations(
  candidates: readonly RecommendationCandidate[],
  minimumSample = DEFAULT_MIN_SAMPLE_SIZE,
): CampaignRecommendation[] {
  const validMinimum =
    isValidCount(minimumSample) && minimumSample > 0
      ? minimumSample
      : DEFAULT_MIN_SAMPLE_SIZE;

  return candidates
    .map((candidate): CampaignRecommendation => {
      const comparison = compareCampaignMetric(
        candidate.successes,
        candidate.total,
        candidate.baselineSuccesses,
        candidate.baselineTotal,
        validMinimum,
      );

      let action: RecommendationAction;
      let priority: 1 | 2 | 3;
      let title: string;

      if (!comparison.hasMinimumSample || comparison.direction === 'unavailable') {
        action = 'collect_more_data';
        priority = 3;
        title = `Esperar más datos para ${candidate.label}`;
      } else if (
        comparison.isStatisticallyReliable &&
        comparison.direction === 'up'
      ) {
        action = 'scale_candidate';
        priority = 1;
        title = `Escalar ${candidate.label}`;
      } else if (
        comparison.isStatisticallyReliable &&
        comparison.direction === 'down'
      ) {
        action = 'review_candidate';
        priority = 1;
        title = `Revisar ${candidate.label}`;
      } else {
        action = 'monitor_candidate';
        priority = 2;
        title = `Mantener en observación ${candidate.label}`;
      }

      return {
        key: candidate.key,
        action,
        priority,
        title,
        explanation: comparison.explanation,
        evidence: {
          dimension: candidate.dimension,
          candidateRate: comparison.candidate?.rate ?? null,
          baselineRate: comparison.baseline?.rate ?? null,
          absoluteLift: comparison.absoluteLift,
          relativeLift: comparison.relativeLift,
          candidateSample: candidate.total,
          baselineSample: candidate.baselineTotal,
          minimumSample: validMinimum,
          statisticallyReliable: comparison.isStatisticallyReliable,
        },
      };
    })
    .sort(
      (left, right) =>
        left.priority - right.priority || left.key.localeCompare(right.key),
    );
}
