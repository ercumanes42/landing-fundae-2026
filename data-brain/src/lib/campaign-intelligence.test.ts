import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateSafeRate,
  calculateWilsonInterval,
  compareCampaignMetric,
  detectSeriesAnomalies,
  generateCampaignRecommendations,
} from './campaign-intelligence';

test('safe rates reject empty or inconsistent denominators', () => {
  assert.equal(calculateSafeRate(0, 0), null);
  assert.equal(calculateSafeRate(2, 1), null);
  assert.equal(calculateSafeRate(-1, 10), null);
  assert.equal(calculateSafeRate(1.5, 10), null);
  assert.deepEqual(calculateSafeRate(25, 100), {
    successes: 25,
    total: 100,
    rate: 0.25,
    percentage: 25,
  });
});

test('Wilson 95% interval is bounded and stable for edge rates', () => {
  const emptySuccess = calculateWilsonInterval(0, 100);
  const fullSuccess = calculateWilsonInterval(100, 100);

  assert.ok(emptySuccess);
  assert.equal(emptySuccess.lower, 0);
  assert.ok(emptySuccess.upper > 0 && emptySuccess.upper < 0.04);

  assert.ok(fullSuccess);
  assert.ok(fullSuccess.lower > 0.96 && fullSuccess.lower < 1);
  assert.equal(fullSuccess.upper, 1);
});

test('lift comparison requires enough data and non-overlapping intervals', () => {
  const insufficient = compareCampaignMetric(8, 20, 4, 20);
  assert.equal(insufficient.hasMinimumSample, false);
  assert.equal(insufficient.isStatisticallyReliable, false);

  const reliable = compareCampaignMetric(80, 100, 30, 100);
  assert.equal(reliable.direction, 'up');
  assert.equal(reliable.hasMinimumSample, true);
  assert.equal(reliable.isStatisticallyReliable, true);
  assert.equal(reliable.absoluteLift, 0.5);
  assert.equal(reliable.relativeLift, 1.666667);
});

test('zero baseline reports absolute lift without inventing infinite relative lift', () => {
  const comparison = compareCampaignMetric(10, 100, 0, 100);
  assert.equal(comparison.absoluteLift, 0.1);
  assert.equal(comparison.relativeLift, null);
  assert.equal(comparison.direction, 'up');
});

test('robust anomaly detection identifies an isolated spike', () => {
  const anomalies = detectSeriesAnomalies([
    { key: '08:00', value: 10 },
    { key: '09:00', value: 10 },
    { key: '10:00', value: 10 },
    { key: '11:00', value: 10 },
    { key: '12:00', value: 80 },
  ]);

  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].key, '12:00');
  assert.equal(anomalies[0].direction, 'high');
  assert.equal(anomalies[0].index, 4);
});

test('anomaly detection ignores short, invalid and constant series', () => {
  assert.deepEqual(
    detectSeriesAnomalies([
      { key: 'a', value: 1 },
      { key: 'b', value: 99 },
    ]),
    [],
  );
  assert.deepEqual(
    detectSeriesAnomalies([
      { key: 'a', value: 4 },
      { key: 'b', value: 4 },
      { key: 'c', value: 4 },
      { key: 'd', value: 4 },
      { key: 'e', value: 4 },
    ]),
    [],
  );
});

test('recommendations are deterministic, evidence-based and priority sorted', () => {
  const recommendations = generateCampaignRecommendations([
    {
      key: 'email-2',
      label: 'Email 2',
      dimension: 'email_step',
      successes: 8,
      total: 20,
      baselineSuccesses: 20,
      baselineTotal: 100,
    },
    {
      key: 'variant-b',
      label: 'Variante B',
      dimension: 'variant',
      successes: 80,
      total: 100,
      baselineSuccesses: 30,
      baselineTotal: 100,
    },
    {
      key: 'variant-c',
      label: 'Variante C',
      dimension: 'variant',
      successes: 20,
      total: 100,
      baselineSuccesses: 30,
      baselineTotal: 100,
    },
  ]);

  assert.deepEqual(
    recommendations.map(({ key, action, priority }) => ({ key, action, priority })),
    [
      { key: 'variant-b', action: 'scale_candidate', priority: 1 },
      { key: 'variant-c', action: 'monitor_candidate', priority: 2 },
      { key: 'email-2', action: 'collect_more_data', priority: 3 },
    ],
  );
  assert.equal(
    recommendations[0].evidence.statisticallyReliable,
    true,
  );
  assert.equal(recommendations[0].evidence.dimension, 'variant');
});
