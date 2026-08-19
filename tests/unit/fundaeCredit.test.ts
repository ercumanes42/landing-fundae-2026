import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFundaeCreditInsight, calculateFundaeCredit, parseSpanishAmount } from '../../src/lib/fundaeCredit';

const base = {
  calculationMode: 'fp_quota' as const,
  priorYearFpQuota: 1_200,
  specialSituation: 'no' as const,
};

test('uses the 420 EUR minimum for 1-5 employees', () => {
  assert.equal(calculateFundaeCredit({ ...base, employeeRange: '1-5' }).amount, 420);
});

test('applies the official percentage bands to the prior-year FP quota', () => {
  assert.equal(calculateFundaeCredit({ ...base, employeeRange: '6-9' }).amount, 1_200);
  assert.equal(calculateFundaeCredit({ ...base, employeeRange: '10-49' }).amount, 900);
  assert.equal(calculateFundaeCredit({ ...base, employeeRange: '50-249' }).amount, 720);
  assert.equal(calculateFundaeCredit({ ...base, employeeRange: '+249' }).amount, 600);
});

test('does not invent an amount when the FP quota is missing', () => {
  const result = calculateFundaeCredit({
    employeeRange: '10-49',
    calculationMode: 'fp_quota',
    specialSituation: 'no',
  });
  assert.equal(result.amount, null);
  assert.equal(result.calculation_source, 'insufficient_data');
});

test('parses common Spanish amount formats', () => {
  assert.equal(parseSpanishAmount('4.500,50'), 4_500.5);
  assert.equal(parseSpanishAmount('4500.50'), 4_500.5);
  assert.equal(parseSpanishAmount('4.500'), 4_500);
  assert.equal(parseSpanishAmount(''), undefined);
});

test('turns a calculation with FP quota into an explicit formula and validation plan', () => {
  const input = { ...base, employeeRange: '10-49' as const };
  const result = calculateFundaeCredit(input);
  const insight = buildFundaeCreditInsight(input, result);

  assert.equal(insight.reference, '900 €');
  assert.match(insight.formula, /1200.*75%.*900/);
  assert.equal(insight.missingData, null);
  assert.equal(insight.validationLevel, 'with_data');
  assert.equal(insight.nextSteps.length, 3);
});

test('provides the missing data and next steps without inventing an amount', () => {
  const input = {
    employeeRange: '50-249' as const,
    calculationMode: 'no_data' as const,
    specialSituation: 'no' as const,
  };
  const result = calculateFundaeCredit(input);
  const insight = buildFundaeCreditInsight(input, result);

  assert.equal(result.amount, null);
  assert.equal(insight.reference, '60% de la cuota de Formación Profesional');
  assert.match(insight.formula, /Base otras cotizaciones × 0,7% × 60%/);
  assert.match(insight.missingData ?? '', /Necesitas la cuota/);
  assert.equal(insight.validationLevel, 'range_only');
});

test('marks special situations for review without changing the base formula', () => {
  const input = {
    ...base,
    employeeRange: '10-49' as const,
    specialSituation: 'yes' as const,
  };
  const result = calculateFundaeCredit(input);
  const insight = buildFundaeCreditInsight(input, result);

  assert.equal(result.amount, 900);
  assert.equal(insight.validationLevel, 'manual_review');
  assert.match(insight.validationText, /No la simulamos/);
});
