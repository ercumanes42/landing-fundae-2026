import assert from 'node:assert/strict';
import test from 'node:test';

import { projectLeadForSummary } from './openai';
import type { LeadPayload } from './types';

function leadWithPii(): LeadPayload {
  return {
    submission_id: 'interactive_checklist_01JTEST123',
    event_version: '1.0',
    form_type: 'interactive_checklist',
    lead_magnet: 'interactive_checklist',
    created_at: '2026-08-12T10:00:00.000Z',
    source_url: 'https://example.test/autodiagnostico?cid=private-contact',
    anonymous_id: 'anon_private',
    session_id: 'session_private',
    lead_id: 'lead_private',
    utm_source: 'campaign',
    utm_medium: 'email',
    utm_campaign: 'FUNDAE_2026_EMAIL_V1',
    utm_content: 'private-contact',
    lead_score: 72,
    lead_status: 'caliente',
    lead_classification: 'hot',
    scoring: {
      fit: 20,
      intent: 30,
      engagement: 12,
      urgency: 10,
      total: 72,
      classification: 'hot',
    },
    contact: {
      name: 'Nombre Privado',
      email: 'persona@empresa.example',
      phone: '+34 600 000 000',
      company: 'Empresa Privada SL',
      role: 'Responsable de RRHH',
    },
    company: {
      province: 'Madrid',
      sector: 'Servicios',
      employee_range: '10-49',
      used_fundae_before: 'yes',
    },
    interest: {
      training_area: 'Liderazgo',
      urgency: 'this_month',
      message: 'Llamar a Nombre Privado en el +34 600 000 000',
    },
    interactive_checklist: {
      score: 7,
      risk_level: 'medium',
      answers: { q1: 'Respuesta potencialmente sensible' },
    },
    consent: {
      privacy_accepted: true,
      marketing_accepted: false,
    },
  };
}

test('AI summary projection excludes direct identifiers, free text and raw answers', () => {
  const projection = projectLeadForSummary(leadWithPii());
  const serialized = JSON.stringify(projection);

  for (const forbidden of [
    'Nombre Privado',
    'persona@empresa.example',
    '+34 600 000 000',
    'Empresa Privada SL',
    'private-contact',
    'anon_private',
    'session_private',
    'lead_private',
    'Respuesta potencialmente sensible',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `projection leaked ${forbidden}`);
  }

  assert.deepEqual(projection.interactive_checklist, { score: 7, risk_level: 'medium' });
  assert.equal(projection.contact_role, 'Responsable de RRHH');
  assert.deepEqual(JSON.parse(JSON.stringify(projection.company)), {
    province: 'Madrid',
    sector: 'Servicios',
    employee_range: '10-49',
    used_fundae_before: 'yes',
  });
});
