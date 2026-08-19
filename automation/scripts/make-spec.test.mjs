import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../make/${name}`, import.meta.url), 'utf8'));
const productionChecklist = fs.readFileSync(
  new URL('../MAKE_PRODUCTION_CHECKLIST.md', import.meta.url),
  'utf8',
);

test('sender is a non-importable single-call scheduler with Data Brain authority', () => {
  const sender = read('email_sender_blueprint.json');
  assert.equal(sender.importable, false);
  assert.equal(sender.production_ready, false);
  assert.equal(sender.authority.campaign_state, 'Data Brain/PostgreSQL');
  assert.equal(sender.authority.one_tick_one_transition, true);
  assert.equal(sender.scenario.modules.length, 1);
  assert.equal(sender.scenario.modules[0].endpoint, '/api/internal/graph/campaign-dispatch');
  assert.equal(sender.scenario.modules[0].body, null);
  assert.equal(sender.database_gates.outbound_master, false);
  assert.equal(sender.database_gates.cold_campaign, false);
});

test('reply monitor distinguishes deterministic replies, NDR and explicit BAJA handling', () => {
  const replies = read('reply_monitor_blueprint.json');
  assert.equal(replies.importable, false);
  assert.equal(replies.production_ready, false);
  assert.equal(replies.enabled, false);
  assert.equal(replies.scenario_plan.module_identifiers_verified, false);
  assert.equal(replies.backend_contract.email_only_match_forbidden, true);
  assert.equal(replies.backend_contract.manual_review_on_unmatched_or_ambiguous, true);
  assert.equal(replies.backend_contract.hard_bounce_requires_permanent_dsn, true);
  assert.equal(replies.backend_contract.explicit_baja_emits_global_unsubscribe, true);
});

test('Calendly scenario accepts only a confirmed booking correlated through supported UTM fields', () => {
  const calendly = read('landing_events_blueprint.json');
  assert.equal(calendly.importable, false);
  assert.equal(calendly.production_ready, false);
  assert.equal(calendly.enabled, false);
  assert.equal(calendly.source.provider_event, 'invitee.created');
  assert.equal(calendly.source.contact_id_path, 'payload.tracking.utm_content');
  assert.equal(calendly.source.campaign_external_id_path, 'payload.tracking.utm_campaign');
  assert.equal(calendly.source.unmatched_goes_to_manual_review, true);
  assert.equal(calendly.source.email_only_match_forbidden, true);
  assert.equal(calendly.backend_contract.event, 'meeting_booked');
});

test('production checklist never gives Make the HMAC secret or signing authority', () => {
  assert.match(productionChecklist, /Make nunca almacena, conoce ni calcula[\s>]*\`MAKE_WEBHOOK_SECRET\`/i);
  assert.match(productionChecklist, /sin parsear, normalizar ni reserializar el body/i);
  assert.match(productionChecklist, /campaña fría[\s\S]*deben permanecer OFF/i);
  assert.doesNotMatch(productionChecklist, /secreto almacenado como valor\s+protegido/i);
  assert.doesNotMatch(productionChecklist, /\*\*HTTP HMAC/i);
  assert.doesNotMatch(productionChecklist, /HMAC POST/i);
  assert.doesNotMatch(productionChecklist, /Firmar [^\n]+ con HMAC/i);
});
