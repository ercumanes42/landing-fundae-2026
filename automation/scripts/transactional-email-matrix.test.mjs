import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const matrixUrl = new URL('../make/fundae_transactional_email_matrix_v1.json', import.meta.url);
const matrix = JSON.parse(fs.readFileSync(matrixUrl, 'utf8'));
const PLACEHOLDER_PATTERN = /{{[a-z][a-z0-9_]*}}/g;
const EXPECTED_FORM_TYPES = ['calculator', 'checklist', 'interactive_checklist', 'webinar'];

function renderedCopy(template) {
  return [template.subject, template.preheader, template.body_text].join('\n');
}

function placeholdersIn(template) {
  return [...new Set(renderedCopy(template).match(PLACEHOLDER_PATTERN) ?? [])].sort();
}

test('defines one new transactional template for each requested interaction', () => {
  assert.equal(matrix.schema_version, '1.0.0');
  assert.equal(matrix.kind, 'configuration-spec');
  assert.equal(matrix.importable, false);
  assert.equal(matrix.production_ready, false);
  assert.deepEqual(
    matrix.templates.map((template) => template.form_type).sort(),
    EXPECTED_FORM_TYPES,
  );
  assert.equal(new Set(matrix.templates.map((template) => template.id)).size, 4);
});

test('every placeholder is declared, sourced and used', () => {
  for (const template of matrix.templates) {
    const used = placeholdersIn(template);
    assert.deepEqual(used, [...template.required_placeholders].sort(), `${template.id}: undeclared placeholder`);
    assert.deepEqual(used, Object.keys(template.placeholder_sources).sort(), `${template.id}: unsourced placeholder`);
    assert.match(template.body_text, /^Hola {{first_name}},/);
    assert.ok(Object.values(template.placeholder_sources).every((source) => typeof source === 'string' && source.trim()));
  }
});

test('copy contains no sample contacts, fabricated results or hard-coded event dates', () => {
  const allCopy = matrix.templates.map(renderedCopy).join('\n');
  const forbiddenFiction = [
    /(?:example|ejemplo)\.(?:com|org|net)/i,
    /@empresa\./i,
    /\b(?:Juan|Pedro)\s+(?:Pérez|Martínez|García)\b/i,
    /\b(?:\+34\s*)?(?:600|666|900)\s*\d{3}\s*\d{3}\b/,
    /\b\d{1,2}[/-]\d{1,2}[/-]20\d{2}\b/,
    /\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+20\d{2}\b/i,
    /\b(?:1\.050|1,050|6\.400|6,400|26\.000|26,000|420)\s*€/i,
  ];

  for (const pattern of forbiddenFiction) assert.doesNotMatch(allCopy, pattern);
});

test('transactional delivery stays separate from marketing and unsubscribe handling', () => {
  const policy = matrix.legal_and_delivery_policy;
  assert.equal(policy.lane, 'transactional');
  assert.equal(policy.marketing_content_allowed, false);
  assert.equal(policy.unsubscribe.include, false);
  assert.equal(policy.commercial_follow_up.included_in_this_matrix, false);
  assert.equal(policy.commercial_follow_up.require_separate_template, true);
  assert.equal(policy.commercial_follow_up.require_valid_legal_basis, true);
  assert.equal(policy.commercial_follow_up.require_opposition_mechanism_when_applicable, true);

  for (const template of matrix.templates) {
    const copy = renderedCopy(template);
    assert.doesNotMatch(copy, /{{unsubscribe_url}}/);
    assert.doesNotMatch(copy, /\b(?:oferta|descuento|promoción|plazas limitadas|agenda una revisión|contrata)\b/i);
    assert.equal(template.content_requirements.sales_cta_allowed, false);
  }
});

test('each interaction delivers its actual result or requested resource', () => {
  const byForm = Object.fromEntries(matrix.templates.map((template) => [template.form_type, template]));
  assert.match(byForm.calculator.body_text, /{{credit_reference}}/);
  assert.match(byForm.calculator.body_text, /{{calculation_formula}}/);
  assert.match(byForm.calculator.body_text, /{{validation_text}}/);
  assert.equal(byForm.calculator.content_requirements.must_handle_null_amount, true);

  assert.match(byForm.interactive_checklist.body_text, /{{score_label}}/);
  assert.match(byForm.interactive_checklist.body_text, /{{result_title}}/);
  assert.match(byForm.interactive_checklist.body_text, /{{priority_list_text}}/);
  assert.equal(byForm.interactive_checklist.attachments[0].contains_contact_pii, false);

  assert.equal(byForm.checklist.attachments[0].required, true);
  assert.match(byForm.checklist.body_text, /{{resource_url}}/);

  assert.match(byForm.webinar.subject, /{{webinar_title}}/);
  assert.match(byForm.webinar.body_text, /{{webinar_date}}/);
  assert.match(byForm.webinar.body_text, /{{webinar_time}}/);
  assert.match(byForm.webinar.body_text, /{{webinar_timezone}}/);
  assert.match(byForm.webinar.body_text, /{{access_delivery_note}}/);
});
