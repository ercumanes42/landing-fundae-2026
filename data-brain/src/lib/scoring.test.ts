import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateLeadScoreBreakdown, classifyLead } from './scoring';
import type { LeadScoringInput } from './types';

test('classification boundaries are stable and exhaustive', () => {
  assert.equal(classifyLead(0), 'cold');
  assert.equal(classifyLead(39), 'cold');
  assert.equal(classifyLead(40), 'warm');
  assert.equal(classifyLead(59), 'warm');
  assert.equal(classifyLead(60), 'hot');
  assert.equal(classifyLead(79), 'hot');
  assert.equal(classifyLead(80), 'priority');
  assert.equal(classifyLead(100), 'priority');
});

test('a fully qualified and engaged calculator lead is capped at 100', () => {
  const input: LeadScoringInput = {
    form_type: 'calculator',
    employee_range: '50-249',
    role: 'Directora de RRHH',
    sector: 'tecnologia',
    province: 'Madrid',
    training_area: 'IA y automatización',
    urgency: 'inmediato',
    knows_credit: 'no',
    used_fundae_before: 'no',
    risk_level: 'high',
    calendly_click: true,
    journey: {
      sections_viewed: ['hero', 'calculator', 'proof', 'faq', 'contact'],
      scroll_depth: 95,
      time_on_page_seconds: 300,
      video_played: true,
      repeat_visit: true,
      form_steps_completed: 3,
    },
  };

  assert.deepEqual(calculateLeadScoreBreakdown(input), {
    fit: 25,
    intent: 25,
    engagement: 25,
    urgency: 25,
    total: 100,
    classification: 'priority',
  });
});

test('journey scoring deduplicates sections and respects caps', () => {
  const result = calculateLeadScoreBreakdown({
    form_type: 'webinar',
    journey: {
      sections_viewed: ['hero', 'hero', 'faq'],
      scroll_depth: 75,
      time_on_page_seconds: 120,
      form_steps_completed: 10,
    },
  });

  assert.equal(result.engagement, 15);
  assert.ok(Object.values(result).every((value) => typeof value === 'string' || (value >= 0 && value <= 100)));
});

test('empty diagnostic keeps only its observed form intent', () => {
  assert.deepEqual(calculateLeadScoreBreakdown({ form_type: 'diagnostic' }), {
    fit: 0,
    intent: 22,
    engagement: 0,
    urgency: 0,
    total: 22,
    classification: 'cold',
  });
});

test('empty checklist has deterministic scoring with no calendar urgency', () => {
  assert.deepEqual(calculateLeadScoreBreakdown({ form_type: 'checklist' }), {
    fit: 0,
    intent: 7,
    engagement: 0,
    urgency: 0,
    total: 7,
    classification: 'cold',
  });
});

test('scoring is pure and does not mutate captured lead data', () => {
  const input: LeadScoringInput = {
    form_type: 'interactive_checklist',
    answers: { company_size: '10-49', review_timing: 'Esta semana' },
    journey: { sections_viewed: ['checklist'] },
  };
  const snapshot = structuredClone(input);
  calculateLeadScoreBreakdown(input);
  assert.deepEqual(input, snapshot);
});
