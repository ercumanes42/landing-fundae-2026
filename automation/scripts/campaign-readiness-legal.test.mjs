import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAMPAIGN_POLICY_VERSION,
  controlledFieldDefaults,
  materializeCampaignCopies,
  readCampaignPolicy,
  readCopyMatrix,
} from './campaign-materialization.mjs';

function row(overrides = {}) {
  return {
    'contact id': 'F26-A-0001',
    nombre: 'María',
    organizacion: 'Empresa Ejemplo',
    'variante nombre': 'Checklist',
    'enlace recurso utm': 'https://example.test/recurso?utm_source=email&cid=F26-A-0001',
    'enlace calendly utm': 'https://example.test/reunion?utm_source=email&cid=F26-A-0001',
    ...overrides,
  };
}

const getText = (input, key) => String(input[key] || '').trim();

test('implements the approved customer/similar-services policy without an individual evidence or new consent gate', () => {
  const policy = readCampaignPolicy();
  assert.equal(policy.policy_version, CAMPAIGN_POLICY_VERSION);
  assert.equal(policy.scope.audience, 'current_or_former_customers');
  assert.equal(policy.scope.offer, 'own_similar_services');
  assert.equal(policy.scope.individual_legal_evidence_gate_required, false);
  assert.equal(policy.scope.new_consent_gate_required, false);
  assert.deepEqual(policy.switches, {
    outbound_master_enabled: false,
    campaign_outbound_enabled: false,
    make_sender_enabled: false,
  });
});

test('materializes five canonical copies with identity and exactly one deferred unsubscribe URL', () => {
  const copies = materializeCampaignCopies(row(), getText, readCopyMatrix());
  assert.equal(copies.length, 5);
  for (const copy of copies) {
    assert.match(copy.body, /Joaquín G\. del Pino/);
    assert.equal((copy.body.match(/\{\{unsubscribe_url\}\}/g) || []).length, 1);
    assert.equal(/\{\{(?!unsubscribe_url\}\})/.test(`${copy.subject}\n${copy.body}`), false);
  }
});

test('sanitizes line breaks and rejects template injection or cross-contact tracking URLs', () => {
  const copies = materializeCampaignCopies(row({ nombre: 'María\r\nBcc: attacker@example.test' }), getText);
  assert.equal(copies[0].subject.includes('\n'), false);
  assert.match(copies[0].body, /Hola María Bcc: attacker@example\.test/);
  assert.throws(() => materializeCampaignCopies(row({ nombre: '{{company_name}}' }), getText), /template syntax/);
  assert.throws(
    () => materializeCampaignCopies(row({ 'enlace recurso utm': 'https://example.test/recurso?cid=OTHER' }), getText),
    /cid does not match/,
  );
});

test('keeps every operational decision fail-closed in the controlled copy', () => {
  assert.deepEqual(controlledFieldDefaults(), {
    'campaign policy version': CAMPAIGN_POLICY_VERSION,
    'unsubscribe status': 'PENDING_RECHECK',
    'opposition status': 'PENDING_RECHECK',
    'hard bounce status': 'PENDING_RECHECK',
    'suppression status': 'PENDING_RECHECK',
    'duplicate status': 'CLEAR',
    'technical evidence sha256': '',
    'campaign authorization': 'PENDING',
    'eligibility status': 'PENDING_TECHNICAL_GATES',
  });
});
