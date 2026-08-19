import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../make/${name}`, import.meta.url), 'utf8'));
const productionChecklist = fs.readFileSync(
  new URL('../MAKE_PRODUCTION_CHECKLIST.md', import.meta.url),
  'utf8',
);
const automationReadme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const operationsValidator = fs.readFileSync(new URL('./validate-operations.mjs', import.meta.url), 'utf8');

test('sender is a non-importable single-call scheduler with Data Brain authority', () => {
  const sender = read('email_sender_blueprint.json');
  assert.equal(sender.importable, false);
  assert.equal(sender.production_ready, false);
  assert.equal(sender.enabled, false);
  assert.equal(sender.authority.campaign_state, 'Data Brain/PostgreSQL');
  assert.equal(sender.authority.one_tick_one_transition, true);
  assert.equal(sender.scenario.modules.length, 1);
  assert.equal(sender.scenario.modules[0].endpoint, '/api/internal/graph/campaign-dispatch');
  assert.equal(sender.scenario.modules[0].body, null);
  assert.equal(sender.database_gates.outbound_master, false);
  assert.equal(sender.database_gates.cold_campaign, false);
  assert.deepEqual(sender.response_contract.fields.slice(-2), ['alert_attempted', 'alert_delivered']);
  assert.equal(sender.response_contract.http_status_policy['409'], 'controlled_no_progress_wait_for_next_scheduled_tick');
  assert.equal(sender.response_contract.http_status_policy['503'], 'halt_execution_create_incomplete_execution_and_alert_operator');
  assert.equal(sender.response_contract.retry_policy.automatic_retries, 0);
  assert.equal(sender.response_contract.retry_policy.retry_requires_operator_review, true);
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

test('transactional dispatcher is a non-importable scheduler with no message data', () => {
  const transactional = read('transactional_dispatch_blueprint.json');
  assert.equal(transactional.importable, false);
  assert.equal(transactional.production_ready, false);
  assert.equal(transactional.enabled, false);
  assert.equal(transactional.authority.transactional_state, 'Data Brain/PostgreSQL');
  assert.equal(transactional.authority.one_tick_one_transition, true);
  assert.equal(transactional.scenario.modules.length, 1);
  assert.equal(transactional.scenario.modules[0].endpoint, '/api/internal/graph/dispatch');
  assert.equal(transactional.scenario.modules[0].body, null);
  assert.equal(transactional.feature_gates.outbound_master, false);
  assert.equal(transactional.feature_gates.transactional_outlook, false);
  assert.deepEqual(Object.keys(transactional.feature_gates).sort(), ['outbound_master', 'transactional_outlook']);
  assert.deepEqual(transactional.response_contract.fields.slice(-2), ['alert_attempted', 'alert_delivered']);
  assert.equal(transactional.response_contract.http_status_policy['409'], 'controlled_no_progress_wait_for_next_scheduled_tick');
  assert.equal(transactional.response_contract.http_status_policy['503'], 'halt_execution_create_incomplete_execution_and_alert_operator');
  assert.equal(transactional.response_contract.retry_policy.automatic_retries, 0);
  assert.equal(transactional.response_contract.retry_policy.incomplete_executions, true);
  assert.match(transactional.verification_required.join('\n'), /four-resource single-approved-sink/i);
});

test('canonical operations artifacts contain no retired queue or fictitious dispatch gate', () => {
  const canonical = [
    productionChecklist,
    automationReadme,
    operationsValidator,
    JSON.stringify(read('email_sender_blueprint.json')),
    JSON.stringify(read('transactional_dispatch_blueprint.json')),
  ].join('\n');
  const retiredDispatchGate = ['TRANSACTIONAL', 'DISPATCH', 'ENABLED'].join('_');
  assert.equal(canonical.includes(retiredDispatchGate), false);
  const retiredQueueArtifacts = [
    automationReadme,
    operationsValidator,
    JSON.stringify(read('email_sender_blueprint.json')),
  ].join('\n');
  assert.doesNotMatch(
    retiredQueueArtifacts,
    /Google Sheets|visible Make queue|Make sequential queue|Make Data Store|Microsoft 365 Email|Watch Emails/i,
  );
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

test('production checklist keeps Make scheduler-only and without message authority', () => {
  assert.match(productionChecklist, /Make no es autoridad de datos ni de entrega/i);
  assert.match(productionChecklist, /Único módulo: POST \/api\/internal\/graph\/dispatch/i);
  assert.match(productionChecklist, /Make no recibe PII ni[\s\S]*capabilities/i);
  assert.match(productionChecklist, /No crear conexiones Outlook, Sheets, Calendly ni Data Store/i);
  assert.match(productionChecklist, /Body: vacío/i);
  assert.match(productionChecklist, /OUTBOUND_MASTER_ENABLED=false, COLD_CAMPAIGN_ENABLED=false/i);
  assert.doesNotMatch(productionChecklist, /secreto almacenado como valor\s+protegido/i);
  assert.doesNotMatch(productionChecklist, /\*\*HTTP HMAC/i);
  assert.doesNotMatch(productionChecklist, /HMAC POST/i);
  assert.doesNotMatch(productionChecklist, /Firmar [^\n]+ con HMAC/i);
  assert.doesNotMatch(productionChecklist, /Microsoft 365 Email/i);
  assert.doesNotMatch(productionChecklist, /Watch Emails/i);
});
