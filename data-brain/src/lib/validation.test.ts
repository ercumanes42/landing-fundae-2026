import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertIdentifier,
  canonicalizeLeadPayload,
  isProfessionalEmailAddress,
  leadCapturePayloadSha256,
  PayloadTooLargeError,
  readBoundedJsonBody,
  safeInteger,
  validateEventPayload,
  validateLeadPayload,
} from './validation';

function validLead() {
  return {
    submission_id: 'calculator_01JTEST123',
    event_version: '1.0',
    form_type: 'calculator',
    lead_magnet: 'calculator',
    created_at: '2026-08-11T10:00:00.000Z',
    source_url: 'https://example.test/calculadora',
    lead_score: 21,
    lead_status: 'new',
    lead_classification: 'cold',
    scoring: {
      fit: 0,
      intent: 17,
      engagement: 0,
      urgency: 4,
      total: 21,
      classification: 'cold',
    },
    contact: {
      name: 'Persona Test',
      email: 'persona@example.com',
      company: '',
    },
    consent: {
      privacy_accepted: true,
      marketing_accepted: false,
    },
  };
}

function validEvent() {
  const touch = {
    utm_source: 'direct',
    utm_medium: 'none',
    utm_campaign: 'unattributed',
    utm_content: '',
    utm_term: '',
    referrer: '',
    lead_magnet: 'calculator',
    source_url: 'https://example.test/calculadora',
    captured_at: '2026-08-11T10:00:00.000Z',
  };
  return {
    event_name: 'tool_complete',
    context: {
      event_id: '123e4567-e89b-42d3-a456-426614174000',
      event_version: '2.0',
      occurred_at: '2026-08-11T10:00:00.000Z',
      journey_id: 'jrn_123e4567e89b42d3a456426614174000',
      anonymous_id: 'jrn_123e4567e89b42d3a456426614174000',
      session_id: 'ses_123e4567e89b42d3a456426614174001',
      identity_persistence: 'localStorage',
      storage_available: true,
      first_touch: touch,
      last_touch: touch,
      lead_magnet: 'calculator',
      section: 'calculator',
      source_url: 'https://example.test/calculadora',
      referrer: '',
      utm_source: 'direct',
      utm_medium: 'none',
      utm_campaign: 'unattributed',
      utm_content: '',
      utm_term: '',
      device_type: 'desktop',
      viewport_width: 1280,
      consent_state: 'accepted',
      consent_version: '2026-08-19',
    },
    properties: { tool_id: 'calculator' },
  };
}

test('validateLeadPayload accepts the minimum valid lead', () => {
  assert.doesNotThrow(() => validateLeadPayload(validLead()));
});

test('validateLeadPayload rejects unsafe or incomplete public input', async (t) => {
  const cases: Array<[string, (lead: ReturnType<typeof validLead>) => void, RegExp]> = [
    ['missing submission id', (lead) => { lead.submission_id = ''; }, /submission_id/],
    ['unsupported form', (lead) => { lead.form_type = 'other'; }, /form_type/],
    ['invalid timestamp', (lead) => { lead.created_at = 'today'; }, /created_at/],
    ['invalid email', (lead) => { lead.contact.email = 'not-an-email'; }, /contact\.email/],
    ['missing privacy consent', (lead) => { lead.consent.privacy_accepted = false; }, /privacy consent/],
  ];

  for (const [name, mutate, expected] of cases) {
    await t.test(name, () => {
      const lead = validLead();
      mutate(lead);
      assert.throws(() => validateLeadPayload(lead), expected);
    });
  }
});

test('validateLeadPayload normalizes email only for validation without mutating it', () => {
  const lead = validLead();
  lead.contact.email = '  PERSONA@EXAMPLE.COM  ';
  validateLeadPayload(lead);
  assert.equal(lead.contact.email, '  PERSONA@EXAMPLE.COM  ');
});

test('canonical lead validation rejects unknown PII injection at every public nesting boundary', () => {
  const topLevel = { ...validLead(), national_id: '00000000T' };
  assert.throws(() => canonicalizeLeadPayload(topLevel), /national_id is not allowed/);

  const contact = validLead() as ReturnType<typeof validLead> & {
    contact: ReturnType<typeof validLead>['contact'] & { tax_id?: string };
  };
  contact.contact.tax_id = 'B00000000';
  assert.throws(() => canonicalizeLeadPayload(contact), /contact.tax_id is not allowed/);

  const checklist = {
    ...validLead(),
    form_type: 'interactive_checklist',
    lead_magnet: 'interactive_checklist',
    interactive_checklist: {
      score: 1,
      risk_level: 'low',
      answers: { company_size: '1-5', personal_email: 'third-party@example.test' },
    },
  };
  assert.throws(() => canonicalizeLeadPayload(checklist), /personal_email is not allowed/);

  const tracking = {
    ...validLead(),
    tracking_context: {
      email: 'injected@example.test',
    },
  };
  assert.throws(() => canonicalizeLeadPayload(tracking), /context.email is not allowed/);
});

test('canonical payload normalizes identity and produces a stable semantic hash', () => {
  const left = validLead();
  left.contact.email = '  PERSONA@EXAMPLE.COM  ';
  const right = validLead();
  assert.equal(canonicalizeLeadPayload(left).contact.email, 'persona@example.com');
  assert.equal(leadCapturePayloadSha256(left), leadCapturePayloadSha256(right));
});

test('bounded JSON reader rejects declared and streamed payloads before JSON parsing', async () => {
  const declared = new Request('https://brain.test/api/leads/ingest', {
    method: 'POST',
    headers: { 'content-length': '65537' },
    body: '{}',
  });
  await assert.rejects(() => readBoundedJsonBody(declared), PayloadTooLargeError);

  const streamed = new Request('https://brain.test/api/leads/ingest', {
    method: 'POST',
    body: JSON.stringify({ padding: 'x'.repeat(65_536) }),
  });
  await assert.rejects(() => readBoundedJsonBody(streamed), PayloadTooLargeError);
});

test('calculator and interactive checklist require a non-empty contact name', () => {
  for (const formType of ['calculator', 'interactive_checklist'] as const) {
    const lead = validLead();
    lead.form_type = formType;
    lead.lead_magnet = formType;
    lead.contact.name = '   ';
    assert.throws(() => validateLeadPayload(lead), /contact\.name is required/);
  }

  const checklist = validLead();
  checklist.form_type = 'checklist';
  checklist.lead_magnet = 'checklist';
  checklist.contact.name = '';
  assert.doesNotThrow(() => validateLeadPayload(checklist));
});

test('calculator and interactive checklist reject common personal email providers', () => {
  for (const formType of ['calculator', 'interactive_checklist'] as const) {
    for (const email of ['persona@gmail.com', 'persona@HOTMAIL.ES', 'persona@outlook.com', 'persona@yahoo.es']) {
      const lead = validLead();
      lead.form_type = formType;
      lead.lead_magnet = formType;
      lead.contact.email = email;
      assert.throws(() => validateLeadPayload(lead), /professional email address/);
    }
  }

  assert.equal(isProfessionalEmailAddress('persona@gfs.es'), true);
  assert.equal(isProfessionalEmailAddress('persona@proton.me'), false);

  const checklist = validLead();
  checklist.form_type = 'checklist';
  checklist.lead_magnet = 'checklist';
  checklist.contact.email = 'persona@gmail.com';
  assert.doesNotThrow(() => validateLeadPayload(checklist));
});

test('validateEventPayload enforces the public event allowlist and context ids', () => {
  assert.doesNotThrow(() => validateEventPayload(validEvent()));

  const privateEvent = validEvent();
  privateEvent.event_name = 'admin_export';
  assert.throws(() => validateEventPayload(privateEvent), /event_name is not allowed/);

  const invalidContext = validEvent();
  invalidContext.context.event_id = '../escape';
  assert.throws(() => validateEventPayload(invalidContext), /context\.event_id/);
});

test('identifier and integer guards enforce exact boundaries', () => {
  assert.doesNotThrow(() => assertIdentifier('abc_123-Z', 'id'));
  assert.throws(() => assertIdentifier('ab', 'id'), /id is invalid/);
  assert.equal(safeInteger(1, 'step', 1, 5), 1);
  assert.equal(safeInteger(5, 'step', 1, 5), 5);
  assert.equal(safeInteger(undefined, 'step', 1, 5), undefined);
  assert.throws(() => safeInteger(6, 'step', 1, 5), /between 1 and 5/);
  assert.throws(() => safeInteger(1.5, 'step', 1, 5), /between 1 and 5/);
});
