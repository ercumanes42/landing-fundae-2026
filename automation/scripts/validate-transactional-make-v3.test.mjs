import assert from 'node:assert/strict';
import test from 'node:test';

import { validateTransactionalMakeV3Audit } from './validate-transactional-make-v3.mjs';

const resources = ['calculator', 'interactive_checklist', 'checklist', 'webinar'];
const filterContract = {
  statusCode: { a: '{{2.statusCode}}', o: 'number:equal', b: '200' },
  authorized: { a: '{{2.data.authorized}}', o: 'boolean:equal', b: 'true' },
  reasonCode: { a: '{{2.data.reason_code}}', o: 'text:equal', b: 'claimed' },
  duplicate: { a: '{{2.data.duplicate}}', o: 'boolean:equal', b: 'false' },
  intakeCapability: { a: '{{2.data.intake_capability}}', o: 'exist' },
  payloadSha256: { a: '{{2.data.payload_sha256}}', o: 'exist' },
  resource: { a: '{{2.data.claims.resource}}', o: 'text:equal', b: '$RESOURCE' },
};

function filterFor(resource) {
  return {
    name: `Prepare ${resource}`,
    conditions: [[...Object.values(filterContract).map((condition) => ({
      ...condition,
      ...(condition.b === '$RESOURCE' ? { b: resource } : {}),
    }))]],
  };
}

function http(id, url, body, y, filter) {
  return {
    id,
    module: 'http:ActionSendData',
    version: 3,
    parameters: { method: 'POST', parseResponse: true },
    mapper: { url, body, headers: [{ name: 'Content-Type', value: 'application/json' }] },
    ...(filter ? { filter } : {}),
    metadata: { designer: { x: 900, y } },
  };
}

function validAudit() {
  const hookId = 1234567;
  const trigger = {
    id: 1,
    module: 'gateway:CustomWebHook',
    version: 1,
    parameters: { hook: hookId },
    mapper: {},
  };
  const intake = http(2, 'https://fundae-data-brain-pilot.vercel.app/api/transactional/intake-authorization', '{{1.rawBody}}', 0);
  intake.mapper.headers = [
    { name: 'X-Make-Signature', value: '{{1.headers.x-make-signature}}' },
    { name: 'X-Make-Timestamp', value: '{{1.headers.x-make-timestamp}}' },
    { name: 'Content-Type', value: 'application/json' },
  ];
  const router = {
    id: 3,
    module: 'builtin:BasicRouter',
    version: 1,
    mapper: null,
    routes: resources.map((resource, index) => ({
      flow: [http(
        index + 4,
        'https://fundae-data-brain-pilot.vercel.app/api/transactional/prepare',
        JSON.stringify({
          intake_capability: '{{2.data.intake_capability}}',
          expected_resource: resource,
          mode: 'dry_run',
        }),
        index * 300,
        filterFor(resource),
      )],
    })),
  };
  return {
    schema_version: 'fundae-make-v3-audit-v1',
    scenario: {
      id: 9652631,
      isActive: false,
      isValid: true,
      isLocked: false,
      schedulingType: 'immediately',
    },
    hook: {
      id: hookId,
      scenarioId: 9652631,
      enabled: false,
      queueSize: 0,
      headers: true,
      stringify: true,
      method: 'POST',
    },
    triggerHookId: hookId,
    interface_contract: {
      http_v3: {
        methodPath: 'parameters.method',
        urlPath: 'mapper.url',
        headersPath: 'mapper.headers',
        bodyPath: 'mapper.body',
        parseResponsePath: 'parameters.parseResponse',
        parseResponseValue: true,
      },
      trigger: {
        hookIdPath: 'parameters.hook',
        rawBodyExpression: '{{1.rawBody}}',
        signatureExpression: '{{1.headers.x-make-signature}}',
        timestampExpression: '{{1.headers.x-make-timestamp}}',
      },
      filters: filterContract,
    },
    blueprint: {
      name: 'FUNDAE PILOT - Transactional Intake - OFF',
      flow: [trigger, intake, router],
      metadata: {
        instant: true,
        version: 1,
        scenario: {
          sequential: true,
          confidential: true,
          maxErrors: 1,
          dlq: false,
        },
        designer: { orphans: [] },
        zone: 'eu2.make.com',
      },
    },
  };
}

test('accepts only the exact seven-module OFF V3 dry-run blueprint', () => {
  const report = validateTransactionalMakeV3Audit(validAudit());
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.summary.moduleCount, 7);
});

test('rejects extra modules, unsafe route payloads and an active hook', () => {
  const audit = validAudit();
  audit.hook.enabled = true;
  audit.blueprint.flow[2].routes[0].flow[0].mapper.body = JSON.stringify({
    intake_capability: '{{2.data.intake_capability}}',
    expected_resource: 'calculator',
    mode: 'dry_run',
    recipient: 'unsafe',
  });
  audit.blueprint.flow[2].routes[1].flow.push({
    id: 99,
    module: 'microsoft-email:sendAnEmail',
    version: 1,
  });
  const report = validateTransactionalMakeV3Audit(audit);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => /disabled/.test(error)));
  assert.ok(report.errors.some((error) => /exactly 7 modules/.test(error)));
  assert.ok(report.errors.some((error) => /exactly three allowed keys/.test(error)));
  assert.ok(report.errors.some((error) => /forbidden slug/.test(error)));
});

test('rejects trigger-derived filters, literal capabilities and webhook bearer URLs', () => {
  const audit = validAudit();
  audit.interface_contract.filters.resource.a = '{{1.form_type}}';
  audit.blueprint.flow[2].routes[0].flow[0].filter.conditions[0][6].a = '{{1.form_type}}';
  audit.blueprint.flow[2].routes[0].flow[0].mapper.literal = 'A'.repeat(43);
  audit.hook.webhookUrl = 'https://hook.example.invalid/syntheticBearerPath';
  const report = validateTransactionalMakeV3Audit(audit);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => /must reference only intake/.test(error)));
  assert.ok(report.errors.some((error) => /literal capability-like/.test(error)));
  assert.ok(report.errors.some((error) => /webhook bearer URL/.test(error)));
});
