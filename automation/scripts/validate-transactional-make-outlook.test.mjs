import assert from 'node:assert/strict';
import test from 'node:test';

import { validateTransactionalMakeOutlookAudit } from './validate-transactional-make-outlook.mjs';

const ORIGIN = 'https://fundae-data-brain-pilot.vercel.app';
const routes = [
  { resource: 'calculator', prepare: 4, package: 8, reserve: 9, outlook: 10, callback: 11, ignore: 24, errorCallback: 28, ack: 32 },
  { resource: 'interactive_checklist', prepare: 5, package: 12, reserve: 13, outlook: 14, callback: 15, ignore: 25, errorCallback: 29, ack: 33, kind: 'generated_pdf' },
  { resource: 'checklist', prepare: 6, package: 16, reserve: 17, outlook: 18, callback: 19, ignore: 26, errorCallback: 30, ack: 34, kind: 'canonical_pdf' },
  { resource: 'webinar', prepare: 7, package: 20, reserve: 21, outlook: 22, callback: 23, ignore: 27, errorCallback: 31, ack: 35 },
];

function c(a, o, b) {
  return b === undefined ? { a, o } : { a, o, b: String(b) };
}

function filter(conditions) {
  return { name: 'Strict server-derived gate', conditions: [conditions] };
}

function intakeFilter(resource) {
  return [
    c('{{2.statusCode}}', 'number:equal', 200), c('{{2.data.authorized}}', 'boolean:equal', true),
    c('{{2.data.reason_code}}', 'text:equal', 'claimed'), c('{{2.data.duplicate}}', 'boolean:equal', false),
    c('{{2.data.intake_capability}}', 'exist'), c('{{2.data.payload_sha256}}', 'exist'),
    c('{{2.data.claims.resource}}', 'text:equal', resource),
  ];
}

function prepareFilter(id, resource) {
  return [
    c('{{' + id + '.statusCode}}', 'number:equal', 200),
    c('{{' + id + '.data.prepared}}', 'boolean:equal', true),
    c('{{' + id + '.data.reason_code}}', 'text:equal', 'prepared'),
    c('{{' + id + '.data.mode}}', 'text:equal', 'dry_run'),
    c('{{' + id + '.data.resource}}', 'text:equal', resource),
    c('{{' + id + '.data.template_id}}', 'exist'),
    c('{{' + id + '.data.payload_sha256}}', 'exist'),
  ];
}

function packageFilter(route) {
  const p = '{{' + route.package + '.data.';
  const result = [
    c('{{' + route.package + '.statusCode}}', 'number:equal', 200),
    c(p + 'packaged}}', 'boolean:equal', true), c(p + 'reason_code}}', 'text:equal', 'packaged'),
    c(p + 'resource}}', 'text:equal', route.resource), c(p + 'template_id}}', 'exist'),
    c(p + 'recipient.email}}', 'exist'), c(p + 'subject}}', 'exist'), c(p + 'body}}', 'exist'),
    c(p + 'content_type}}', 'text:equal', 'html'), c(p + 'package_hmac_sha256}}', 'exist'),
  ];
  if (route.kind) result.push(
    c(p + 'attachments[1].kind}}', 'text:equal', route.kind),
    c(p + 'attachments[1].filename}}', 'exist'),
    c(p + 'attachments[1].content_type}}', 'text:equal', 'application/pdf'),
    c(p + 'attachments[1].max_bytes}}', 'number:equal', 2097152),
    c(p + 'attachments[1].byte_length}}', 'exist'),
    c(p + 'attachments[1].content_sha256}}', 'exist'),
    c(p + 'attachments[1].content_base64}}', 'exist'),
  );
  return result;
}

function reserveFilter(id) {
  return [
    c('{{' + id + '.statusCode}}', 'number:equal', 200),
    c('{{' + id + '.data.authorized_to_send}}', 'boolean:equal', true),
    c('{{' + id + '.data.reason_code}}', 'text:equal', 'reserved'),
    c('{{' + id + '.data.reservation_id}}', 'exist'),
    c('{{' + id + '.data.finalize_capability}}', 'exist'),
    c('{{' + id + '.data.lease_expires_at}}', 'exist'),
    c('{{' + id + '.data.batch_position}}', 'exist'),
    c('{{' + id + '.data.retry_after_seconds}}', 'number:equal', 0),
  ];
}

function callbackAcknowledgementFilter(callbackId, reserveId) {
  return [
    c('{{' + callbackId + '.statusCode}}', 'number:equal', 200),
    c('{{' + callbackId + '.data.accepted}}', 'boolean:equal', true),
    c('{{' + callbackId + '.data.duplicate}}', 'boolean:equal', false),
    c('{{' + callbackId + '.data.reason_code}}', 'text:equal', 'reconcile_required'),
    c('{{' + callbackId + '.data.reservation_id}}', 'text:equal', '{{' + reserveId + '.data.reservation_id}}'),
    c('{{' + callbackId + '.data.mailbox_halted}}', 'boolean:equal', true),
  ];
}

function http(id, url, body, conditions) {
  return {
    id,
    module: 'http:ActionSendData',
    version: 3,
    parameters: { handleErrors: true },
    mapper: { method: 'post', url, data: JSON.stringify(body), parseResponse: true },
    ...(conditions ? { filter: filter(conditions) } : {}),
  };
}

function fixture() {
  const trigger = { id: 1, module: 'gateway:CustomWebHook', version: 1, parameters: { hook: 1234567 } };
  const intake = http(2, ORIGIN + '/api/transactional/intake-authorization', '{{1.rawBody}}');
  const router = { id: 3, module: 'builtin:BasicRouter', version: 1, routes: [] };
  for (const route of routes) {
    const capability = '{{2.data.intake_capability}}';
    const prepare = http(route.prepare, ORIGIN + '/api/transactional/prepare', {
      intake_capability: capability, expected_resource: route.resource, mode: 'dry_run',
    }, intakeFilter(route.resource));
    const packageModule = http(route.package, ORIGIN + '/api/transactional/delivery-package', {
      intake_capability: capability, expected_resource: route.resource,
    }, prepareFilter(route.prepare, route.resource));
    const reserve = http(route.reserve, ORIGIN + '/api/transactional/mailbox-reserve', {
      intake_capability: capability,
      expected_resource: route.resource,
      package_hmac_sha256: '{{' + route.package + '.data.package_hmac_sha256}}',
    }, packageFilter(route));
    const attachments = route.kind ? [{
      filename: '{{' + route.package + '.data.attachments[1].filename}}',
      data: '{{toBinary(' + route.package + '.data.attachments[1].content_base64; "base64")}}',
    }] : [];
    const outlook = {
      id: route.outlook,
      module: 'microsoft-email:createAndSendAMessage',
      version: 2,
      parameters: { __IMTCONN__: 13331400 },
      mapper: {
        from: [{ name: 'Approved Sender', address: 'sender@example.test' }],
        toRecipients: [{ name: '', address: '{{' + route.package + '.data.recipient.email}}' }],
        subject: '{{' + route.package + '.data.subject}}',
        content: '{{' + route.package + '.data.body}}',
        contentType: 'html',
        attachments,
      },
      filter: filter(reserveFilter(route.reserve)),
    };
    const callbackBody = {
      finalize_capability: '{{' + route.reserve + '.data.finalize_capability}}',
      state: 'reconcile_required',
      failure_code: 'OUTLOOK_RESULT_UNCONFIRMED',
    };
    const callback = http(route.callback, ORIGIN + '/api/transactional/email-callback', callbackBody);
    const errorCallback = http(route.errorCallback, ORIGIN + '/api/transactional/email-callback', callbackBody);
    const ignore = {
      id: route.ignore,
      module: 'builtin:Ignore',
      version: 1,
      filter: filter(callbackAcknowledgementFilter(route.errorCallback, route.reserve)),
    };
    const ack = {
      id: route.ack,
      module: 'util:SetVariable2',
      version: 1,
      parameters: {},
      mapper: { name: 'delivery_acknowledged', scope: 'roundtrip', value: 'confirmed' },
      filter: filter(callbackAcknowledgementFilter(route.callback, route.reserve)),
    };
    outlook.onerror = [errorCallback, ignore];
    router.routes.push({ flow: [prepare, packageModule, reserve, outlook, callback, ack] });
  }
  return {
    schema_version: 'fundae-make-outlook-manual-reconcile-v4',
    scenario: {
      id: 9652631,
      isActive: false,
      isValid: true,
      isLocked: false,
      dlqCount: 0,
      allDlqCount: 0,
    },
    live_interfaces: {
      verified_from_live_interface: true,
      to_binary_verified_from_official_help: true,
      backend_pdf_determinism_verified: true,
      attachment_runtime_roundtrip_verified: false,
      outlook_error_callback_handler_verified: false,
      connection_health_verified: false,
      strict_format_filters_verified: false,
      outlook_retry_disabled_verified: false,
      http_v3: {
        slug: 'http:ActionSendData', version: 3, methodPath: 'mapper.method', methodValue: 'post',
        urlPath: 'mapper.url', bodyPath: 'mapper.data',
        parseResponsePath: 'mapper.parseResponse', parseResponseValue: true,
      },
      outlook_send: {
        slug: 'microsoft-email:createAndSendAMessage', version: 2,
        expectedConnectionId: 13331400,
        connectionPath: 'parameters.__IMTCONN__', toRecipientsPath: 'mapper.toRecipients',
        subjectPath: 'mapper.subject', bodyPath: 'mapper.content',
        contentTypePath: 'mapper.contentType', attachmentsPath: 'mapper.attachments',
        fromPath: 'mapper.from', errorFlowPath: 'onerror',
      },
    },
    blueprint: {
      flow: [trigger, intake, router],
      metadata: { instant: true, scenario: { sequential: true, confidential: true, maxErrors: 1, dlq: false } },
    },
  };
}

test('accepts the exact 35-module OFF target but keeps saveReady closed without runtime evidence', () => {
  const report = validateTransactionalMakeOutlookAudit(fixture());
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.summary.moduleCount, 35);
  assert.equal(report.saveReady, false);
});

test('opens saveReady only when all remaining runtime gates are explicit', () => {
  const audit = fixture();
  audit.live_interfaces.attachment_runtime_roundtrip_verified = true;
  audit.live_interfaces.outlook_error_callback_handler_verified = true;
  audit.live_interfaces.connection_health_verified = true;
  audit.live_interfaces.strict_format_filters_verified = true;
  audit.live_interfaces.outlook_retry_disabled_verified = true;
  const report = validateTransactionalMakeOutlookAudit(audit);
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.saveReady, true);
});

test('rejects sent/provider semantics, Sleep and Outlook retry', () => {
  const audit = fixture();
  const flow = audit.blueprint.flow[2].routes[0].flow;
  flow[3].retries = 1;
  flow[4].mapper.data = JSON.stringify({
    finalize_capability: '{{9.data.finalize_capability}}',
    state: 'sent',
    provider_message_id: '{{10.id}}',
  });
  flow.push({ id: 36, module: 'util:FunctionSleep', version: 1, mapper: { duration: 60 } });
  const report = validateTransactionalMakeOutlookAudit(audit);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => /provider message identifiers/.test(error)));
  assert.ok(report.errors.some((error) => /retry settings/.test(error)));
  assert.ok(report.errors.some((error) => /forbidden slug/.test(error)));
});

test('rejects toBinary drift, error side effects and missing determinism evidence', () => {
  const audit = fixture();
  const outlook = audit.blueprint.flow[2].routes[1].flow[3];
  outlook.mapper.attachments[0].data = '{{12.data.attachments[1].content_base64}}';
  outlook.onerror.unshift(http(36, ORIGIN + '/api/transactional/email-callback', {
    finalize_capability: '{{13.data.finalize_capability}}',
    state: 'reconcile_required',
    failure_code: 'OUTLOOK_RESULT_UNCONFIRMED',
  }));
  audit.live_interfaces.backend_pdf_determinism_verified = false;
  const report = validateTransactionalMakeOutlookAudit(audit);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => /attachment\/toBinary/.test(error)));
  assert.ok(report.errors.some((error) => /onerror must be callback/.test(error)));
  assert.ok(report.errors.some((error) => /PDF determinism/.test(error)));
});

test('rejects a weakened error callback acknowledgement and incomplete execution drift', () => {
  const audit = fixture();
  const outlook = audit.blueprint.flow[2].routes[0].flow[3];
  outlook.onerror[0].mapper.data = JSON.stringify({
    finalize_capability: '{{9.data.finalize_capability}}',
    state: 'sent',
    provider_message_id: '{{10.id}}',
  });
  outlook.onerror[1].filter.conditions[0].pop();
  audit.scenario.dlqCount = 1;
  const report = validateTransactionalMakeOutlookAudit(audit);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => /provider message identifiers/.test(error)));
  assert.ok(report.errors.some((error) => /callback acknowledgement: filter conditions mismatch/.test(error)));
  assert.ok(report.errors.some((error) => /incomplete-execution counters/.test(error)));
});

test('rejects filter weakening and a conditional terminal callback', () => {
  const audit = fixture();
  audit.blueprint.flow[2].routes[2].flow[2].filter.conditions[0].pop();
  audit.blueprint.flow[2].routes[3].flow[4].filter = filter([
    c('{{23.data.accepted}}', 'boolean:equal', true),
  ]);
  const report = validateTransactionalMakeOutlookAudit(audit);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => /filter conditions mismatch/.test(error)));
  assert.ok(report.errors.some((error) => /must not be conditionally skipped/.test(error)));
});

test('rejects a weakened or non-terminal main callback acknowledgement marker', () => {
  const audit = fixture();
  const ack = audit.blueprint.flow[2].routes[0].flow[5];
  ack.mapper.value = '{{11.data.accepted}}';
  ack.filter.conditions[0].pop();
  ack.routes = [];
  const report = validateTransactionalMakeOutlookAudit(audit);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => /fixed non-sensitive constant/.test(error)));
  assert.ok(report.errors.some((error) => /terminal callback acknowledgement: filter conditions mismatch/.test(error)));
  assert.ok(report.errors.some((error) => /acknowledgement marker must be terminal/.test(error)));
});

test('rejects SetVariable outside the four terminal acknowledgement markers', () => {
  const audit = fixture();
  audit.blueprint.flow[2].routes[0].flow.push({
    id: 36,
    module: 'util:SetVariable2',
    version: 1,
    parameters: {},
    mapper: { name: 'unexpected', scope: 'roundtrip', value: 'constant' },
  });
  const report = validateTransactionalMakeOutlookAudit(audit);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => /SetVariable is allowed only/.test(error)));
});

test('rejects a literal recipient and a literal capability-like value', () => {
  const audit = fixture();
  const flow = audit.blueprint.flow[2].routes[0].flow;
  flow[3].mapper.toRecipients[0].address = 'recipient@example.test';
  flow[1].mapper.literal = 'A'.repeat(43);
  const report = validateTransactionalMakeOutlookAudit(audit);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => /literal email outside fixed sender/.test(error)));
  assert.ok(report.errors.some((error) => /literal capability-like/.test(error)));
});

test('rejects every non-exact HTTP method literal and the wrong method path', () => {
  for (const value of ['POST', 'Post', ' post', undefined, null, 1]) {
    const audit = fixture();
    const module = audit.blueprint.flow[2].routes[0].flow[1];
    if (value === undefined) delete module.mapper.method;
    else module.mapper.method = value;
    const report = validateTransactionalMakeOutlookAudit(audit);
    assert.equal(report.ok, false);
    assert.ok(report.errors.includes('Route calculator package: method literal mismatch'));
  }
  const audit = fixture();
  const module = audit.blueprint.flow[2].routes[0].flow[1];
  delete module.mapper.method;
  module.parameters.method = 'post';
  const report = validateTransactionalMakeOutlookAudit(audit);
  assert.equal(report.ok, false);
  assert.ok(report.errors.includes('Route calculator package: method literal mismatch'));
});
