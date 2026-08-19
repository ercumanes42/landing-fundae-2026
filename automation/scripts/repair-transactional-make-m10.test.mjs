import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blueprintHash,
  buildMethodRepairPlan,
  buildRepairPlan,
  repairCalculatorModule,
  repairHttpMethods,
  repairHttpMethodsLive,
  repairM10,
} from './repair-transactional-make-m10.mjs';

const PRE_ERRORS = [
  'Route calculator: connection mismatch',
  'Route calculator: recipient mismatch',
  'Route calculator: attachment/toBinary mapping mismatch',
  'Route interactive_checklist: connection mismatch',
  'Route interactive_checklist: recipient mismatch',
  'Route checklist: connection mismatch',
  'Route checklist: recipient mismatch',
  'Route webinar: connection mismatch',
  'Route webinar: recipient mismatch',
  'Route webinar: attachment/toBinary mapping mismatch',
];

function driftBlueprint() {
  const flow = Array.from({ length: 35 }, (_, index) => index + 1)
    .filter((id) => id < 24 || id > 31)
    .map((id) => ({
    id,
    module: `test:Module${id}`,
    version: 1,
  }));
  const routes = [
    { id: 10, packageId: 8, connection: 14000001, callback: 28, ignore: 24, attachments: [{ filename: 'wrong' }] },
    { id: 14, packageId: 12, connection: 14000002, callback: 29, ignore: 25, attachments: [{ filename: 'pdf-a', data: 'pdf-buffer-a' }] },
    { id: 18, packageId: 16, connection: 14000003, callback: 30, ignore: 26, attachments: [{ filename: 'pdf-b', data: 'pdf-buffer-b' }] },
    { id: 22, packageId: 20, connection: 14522088, callback: 31, ignore: 27, attachments: [{ filename: 'wrong' }] },
  ];
  for (const route of routes) {
    flow[route.id - 1] = {
      id: route.id,
      module: 'microsoft-email:createAndSendAMessage',
      version: 2,
      parameters: { __IMTCONN__: route.connection, untouchedParameter: 'preserve' },
      mapper: {
        from: [{ name: 'Approved Sender', address: 'sender@example.test' }],
        toRecipients: [{ name: 'drift', address: 'wrong mapping' }],
        subject: `{{${route.packageId}.data.subject}}`,
        content: `{{${route.packageId}.data.body}}`,
        contentType: 'html',
        attachments: route.attachments,
        untouchedMapper: { nested: true },
      },
      filter: { name: 'preserve-filter', conditions: [[{ a: '{{9.statusCode}}', o: 'number:equal', b: '200' }]] },
      onerror: [
        { id: route.callback, module: 'http:ActionSendData', version: 3 },
        { id: route.ignore, module: 'builtin:Ignore', version: 1 },
      ],
      metadata: { designer: { x: route.id, y: 2 } },
    };
  }
  return {
    flow,
    metadata: { instant: true, scenario: { sequential: true, confidential: true, maxErrors: 1, dlq: false } },
    name: 'Target35',
  };
}

function findModule(blueprint, id) {
  const stack = [blueprint];
  while (stack.length) {
    const value = stack.pop();
    if (value?.id === id && typeof value?.module === 'string') return value;
    if (Array.isArray(value)) stack.push(...value);
    else if (value && typeof value === 'object') stack.push(...Object.values(value));
  }
  return undefined;
}

function validator(input) {
  const errors = [];
  const routes = [
    { label: 'calculator', id: 10, packageId: 8, emptyAttachments: true },
    { label: 'interactive_checklist', id: 14, packageId: 12 },
    { label: 'checklist', id: 18, packageId: 16 },
    { label: 'webinar', id: 22, packageId: 20, emptyAttachments: true },
  ];
  for (const route of routes) {
    const module = findModule(input.blueprint, route.id);
    if (module.parameters.__IMTCONN__ !== input.live_interfaces.outlook_send.expectedConnectionId) {
      errors.push(`Route ${route.label}: connection mismatch`);
    }
    if (JSON.stringify(module.mapper.toRecipients) !== JSON.stringify([
      { name: '', address: `{{${route.packageId}.data.recipient.email}}` },
    ])) errors.push(`Route ${route.label}: recipient mismatch`);
    if (route.emptyAttachments && JSON.stringify(module.mapper.attachments) !== '[]') {
      errors.push(`Route ${route.label}: attachment/toBinary mapping mismatch`);
    }
  }
  return { ok: errors.length === 0, errors, summary: { moduleCount: 35 } };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(body); } };
}

function snapshot(blueprint) {
  return {
    authorization: { authorization: { scope: ['hooks:read', 'connections:read', 'scenarios:write', 'scenarios:read'] } },
    scenario: { scenario: { id: 9652631, isActive: false, isinvalid: false, islocked: false, dlqCount: 0, allDlqCount: 0 } },
    blueprint: {
      code: 'OK',
      response: {
        blueprint,
        concept: {},
        created: 'opaque',
        idSequence: 35,
        last_edit: 'opaque',
        metadata: {},
        scheduling: { type: 'immediately' },
      },
    },
    hook: { hook: { scenarioId: 9652631, enabled: false, queueCount: 0 } },
    connection: { connection: { id: 14522088, name: 'opaque' } },
  };
}

function optionsFor(blueprint) {
  return { validate: validator, preHash: blueprintHash(blueprint) };
}

const METHOD_ROUTES = [
  [8, 'calculator', 'package'], [9, 'calculator', 'reserve'], [11, 'calculator', 'callback'],
  [28, 'calculator', 'error callback'], [12, 'interactive_checklist', 'package'],
  [13, 'interactive_checklist', 'reserve'], [15, 'interactive_checklist', 'callback'],
  [29, 'interactive_checklist', 'error callback'], [16, 'checklist', 'package'],
  [17, 'checklist', 'reserve'], [19, 'checklist', 'callback'], [30, 'checklist', 'error callback'],
  [20, 'webinar', 'package'], [21, 'webinar', 'reserve'], [23, 'webinar', 'callback'],
  [31, 'webinar', 'error callback'],
];

function methodDriftBlueprint() {
  const blueprint = repairCalculatorModule(driftBlueprint()).candidate;
  for (const id of [2, 4, 5, 6, 7]) {
    const module = findModule(blueprint, id);
    module.module = 'http:ActionSendData';
    module.version = 3;
    module.mapper = { method: 'post', preserved: id };
  }
  for (const [id] of METHOD_ROUTES) {
    const module = findModule(blueprint, id);
    module.module = 'http:ActionSendData';
    module.version = 3;
    module.mapper = { ...(module.mapper ?? {}), method: 'POST', preserved: id };
  }
  return blueprint;
}

function methodValidator(input) {
  const errors = [];
  for (const [id, resource, stage] of METHOD_ROUTES) {
    if (findModule(input.blueprint, id)?.mapper?.method !== 'post') {
      errors.push(`Route ${resource} ${stage}: method literal mismatch`);
    }
  }
  return { ok: errors.length === 0, errors, summary: { moduleCount: 35 } };
}

function methodOptions(blueprint) {
  return { validate: methodValidator, preHash: blueprintHash(blueprint) };
}

function methodSnapshot(blueprint) {
  const value = snapshot(blueprint);
  value.authorization.authorization.scope = ['hooks:read', 'hooks:write', 'scenarios:read', 'scenarios:write'];
  delete value.connection;
  return value;
}

function mockFetch(snapshots, calls, patchStatus = 200) {
  let getIndex = 0;
  return async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'PATCH') return response({}, patchStatus);
    const current = snapshots[Math.floor(getIndex / 5)];
    const slot = getIndex % 5;
    getIndex += 1;
    return response([
      current.authorization,
      current.scenario,
      current.blueprint,
      current.hook,
      current.connection,
    ][slot]);
  };
}

function mockMethodFetch(snapshots, calls, patchStatus = 200) {
  let getIndex = 0;
  return async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'PATCH') return response({}, patchStatus);
    const current = snapshots[Math.floor(getIndex / 4)];
    const slot = getIndex % 4;
    getIndex += 1;
    return response([current.authorization, current.scenario, current.blueprint, current.hook][slot]);
  };
}

test('repairs exactly nine all4 paths and preserves PDF attachments and all other fields', () => {
  const before = driftBlueprint();
  const original = structuredClone(before);
  const { candidate, changedPaths } = repairCalculatorModule(before);
  assert.deepEqual(changedPaths, [
    'module[10].mapper.attachments',
    'module[10].mapper.toRecipients',
    'module[10].parameters.__IMTCONN__',
    'module[14].mapper.toRecipients',
    'module[14].parameters.__IMTCONN__',
    'module[18].mapper.toRecipients',
    'module[18].parameters.__IMTCONN__',
    'module[22].mapper.attachments',
    'module[22].mapper.toRecipients',
  ]);
  for (const [id, packageId] of [[10, 8], [14, 12], [18, 16], [22, 20]]) {
    const module = findModule(candidate, id);
    assert.equal(module.parameters.__IMTCONN__, 14522088);
    assert.deepEqual(module.mapper.toRecipients, [{ name: '', address: `{{${packageId}.data.recipient.email}}` }]);
    const prior = findModule(original, id);
    for (const key of ['from', 'subject', 'content', 'contentType', 'untouchedMapper']) {
      assert.deepEqual(module.mapper[key], prior.mapper[key]);
    }
    for (const key of ['filter', 'onerror', 'metadata']) assert.deepEqual(module[key], prior[key]);
  }
  assert.deepEqual(findModule(candidate, 10).mapper.attachments, []);
  assert.deepEqual(findModule(candidate, 22).mapper.attachments, []);
  assert.deepEqual(findModule(candidate, 14).mapper.attachments, findModule(original, 14).mapper.attachments);
  assert.deepEqual(findModule(candidate, 18).mapper.attachments, findModule(original, 18).mapper.attachments);
  assert.deepEqual(before, original, 'the input blueprint must remain immutable');
});

test('accepts only the exact ten precondition errors and exact hashes', () => {
  const blueprint = driftBlueprint();
  const plan = buildRepairPlan(snapshot(blueprint), optionsFor(blueprint));
  assert.equal(plan.changedPaths.length, 9);
  assert.equal(blueprintHash(plan.candidate), plan.candidateHash);
  assert.throws(() => buildRepairPlan(snapshot(blueprint), {
    ...optionsFor(blueprint),
    validate: () => ({ ok: false, errors: [...PRE_ERRORS, 'unexpected'], summary: { moduleCount: 35 } }),
  }), /make_precondition_errors_mismatch/);
  assert.throws(() => buildRepairPlan(snapshot(blueprint), {
    ...optionsFor(blueprint), preHash: '0'.repeat(64),
  }), /make_pre_hash_mismatch/);
});

test('derives the candidate hash from the exact live property order', () => {
  const original = driftBlueprint();
  const reordered = { name: original.name, metadata: original.metadata, flow: original.flow };
  assert.notEqual(blueprintHash(original), blueprintHash(reordered));
  const plan = buildRepairPlan(snapshot(reordered), optionsFor(reordered));
  assert.equal(plan.candidateHash, blueprintHash(plan.candidate));
  assert.equal(validator({
    blueprint: plan.candidate,
    live_interfaces: { outlook_send: { expectedConnectionId: 14522088 } },
  }).ok, true);
});

test('dry-run performs exactly five GETs and zero writes', async () => {
  const blueprint = driftBlueprint();
  const calls = [];
  const result = await repairM10({
    ...optionsFor(blueprint), token: 'memory-only-token', fetch: mockFetch([snapshot(blueprint)], calls),
  });
  assert.equal(result.status, 'dry_run_ready');
  assert.equal(result.writes, 0);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.init.method === 'GET' && call.init.redirect === 'error'));
  assert.doesNotMatch(JSON.stringify(result), /memory-only-token|recipient|blueprint|sender@example/);
});

test('bad apply confirmation aborts before any network call', async () => {
  const calls = [];
  await assert.rejects(() => repairM10({
    apply: true, confirmation: 'wrong', token: 'memory-only-token', fetch: mockFetch([], calls),
  }), /apply_confirmation_required/);
  assert.equal(calls.length, 0);
});

test('apply performs two fresh snapshots, one PATCH and a safe readback', async () => {
  const before = driftBlueprint();
  const opts = optionsFor(before);
  const after = repairCalculatorModule(before).candidate;
  const calls = [];
  const result = await repairM10({
    ...opts,
    apply: true,
    confirmation: 'APPLY_TARGET35_OUTLOOK_ALL4_REPAIR_ONCE',
    token: 'memory-only-token',
    fetch: mockFetch([snapshot(before), snapshot(before), snapshot(after)], calls),
  });
  assert.equal(result.status, 'repaired');
  assert.equal(result.writes, 1);
  assert.equal(result.semantic_match, true);
  assert.equal(result.raw_hash_match, true);
  const patches = calls.filter((call) => call.init.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.match(patches[0].url, /\/scenarios\/9652631\?confirmed=true$/);
  assert.equal(patches[0].init.redirect, 'error');
  assert.deepEqual(Object.keys(JSON.parse(patches[0].init.body)), ['blueprint']);
  assert.deepEqual(JSON.parse(JSON.parse(patches[0].init.body).blueprint), after);
  assert.equal(calls.filter((call) => call.init.method === 'GET').length, 15);
});

test('readback accepts Make key-order normalization only when semantics remain exact', async () => {
  const before = driftBlueprint();
  const after = repairCalculatorModule(before).candidate;
  const reordered = { name: after.name, metadata: after.metadata, flow: after.flow };
  const calls = [];
  const result = await repairM10({
    ...optionsFor(before),
    apply: true,
    confirmation: 'APPLY_TARGET35_OUTLOOK_ALL4_REPAIR_ONCE',
    token: 'memory-only-token',
    fetch: mockFetch([snapshot(before), snapshot(before), snapshot(reordered)], calls),
  });
  assert.equal(result.status, 'repaired');
  assert.equal(result.semantic_match, true);
  assert.equal(result.raw_hash_match, false);
  assert.equal(calls.filter((call) => call.init.method === 'PATCH').length, 1);
});

test('PATCH failure is not retried', async () => {
  const before = driftBlueprint();
  const calls = [];
  await assert.rejects(() => repairM10({
    ...optionsFor(before),
    apply: true,
    confirmation: 'APPLY_TARGET35_OUTLOOK_ALL4_REPAIR_ONCE',
    token: 'memory-only-token',
    fetch: mockFetch([snapshot(before), snapshot(before)], calls, 503),
  }), /make_patch_status_503/);
  assert.equal(calls.filter((call) => call.init.method === 'PATCH').length, 1);
});

test('semantic drift outside the allowlist and concurrent drift abort before PATCH', async () => {
  const before = driftBlueprint();
  const drifted = structuredClone(before);
  drifted.metadata.unexpected = true;
  const calls = [];
  await assert.rejects(() => repairM10({
    ...optionsFor(before),
    apply: true,
    confirmation: 'APPLY_TARGET35_OUTLOOK_ALL4_REPAIR_ONCE',
    token: 'memory-only-token',
    fetch: mockFetch([snapshot(before), snapshot(drifted)], calls),
  }), /make_pre_hash_mismatch/);
  assert.equal(calls.filter((call) => call.init.method === 'PATCH').length, 0);
});

test('readback drift stops after the one PATCH without retry', async () => {
  const before = driftBlueprint();
  const after = repairCalculatorModule(before).candidate;
  const driftedReadback = structuredClone(after);
  driftedReadback.metadata.unexpected = true;
  const calls = [];
  await assert.rejects(() => repairM10({
    ...optionsFor(before),
    apply: true,
    confirmation: 'APPLY_TARGET35_OUTLOOK_ALL4_REPAIR_ONCE',
    token: 'memory-only-token',
    fetch: mockFetch([snapshot(before), snapshot(before), snapshot(driftedReadback)], calls),
  }), /make_readback_invalid/);
  assert.equal(calls.filter((call) => call.init.method === 'PATCH').length, 1);
});

test('malformed connection and non-exact scopes fail closed', () => {
  const blueprint = driftBlueprint();
  const malformedConnection = snapshot(blueprint);
  malformedConnection.connection = { connection: { id: 13331400 }, extra: true };
  assert.throws(() => buildRepairPlan(malformedConnection, optionsFor(blueprint)), /make_connection_shape_invalid/);
  const extraScope = snapshot(blueprint);
  extraScope.authorization.authorization.scope.push('hooks:write');
  assert.throws(() => buildRepairPlan(extraScope, optionsFor(blueprint)), /make_scopes_mismatch/);
});

test('repairs only the exact sixteen HTTP mapper.method paths using lowercase post', () => {
  const before = methodDriftBlueprint();
  const original = structuredClone(before);
  const { candidate, changedPaths } = repairHttpMethods(before);
  assert.equal(changedPaths.length, 16);
  for (const [id] of METHOD_ROUTES) {
    assert.equal(findModule(candidate, id).mapper.method, 'post');
    const prior = findModule(original, id);
    const after = findModule(candidate, id);
    assert.equal(after.mapper.preserved, prior.mapper.preserved);
  }
  for (const id of [2, 4, 5, 6, 7]) assert.equal(findModule(candidate, id).mapper.method, 'post');
  assert.deepEqual(before, original);
});

test('method repair requires exact sixteen errors and performs dry-run with zero writes', async () => {
  const before = methodDriftBlueprint();
  const plan = buildMethodRepairPlan(methodSnapshot(before), methodOptions(before));
  assert.equal(plan.changedPaths.length, 16);
  assert.equal(methodValidator({ blueprint: plan.candidate }).ok, true);
  const calls = [];
  const result = await repairHttpMethodsLive({
    ...methodOptions(before), token: 'memory-only-token',
    fetch: mockMethodFetch([methodSnapshot(before)], calls),
  });
  assert.equal(result.status, 'dry_run_ready');
  assert.equal(result.writes, 0);
  assert.equal(calls.length, 4);
});

test('method repair apply uses one PATCH and exact semantic readback', async () => {
  const before = methodDriftBlueprint();
  const after = repairHttpMethods(before).candidate;
  const calls = [];
  const result = await repairHttpMethodsLive({
    ...methodOptions(before), apply: true,
    confirmation: 'APPLY_TARGET35_HTTP_METHOD_REPAIR_ONCE', token: 'memory-only-token',
    fetch: mockMethodFetch([
      methodSnapshot(before), methodSnapshot(before), methodSnapshot(after),
    ], calls),
  });
  assert.equal(result.status, 'repaired');
  assert.equal(result.changed_paths, 16);
  assert.equal(calls.filter((call) => call.init.method === 'PATCH').length, 1);
});

test('method repair aborts concurrent drift before PATCH', async () => {
  const before = methodDriftBlueprint();
  const drifted = structuredClone(before);
  drifted.metadata.concurrent = true;
  const calls = [];
  await assert.rejects(() => repairHttpMethodsLive({
    ...methodOptions(before), apply: true,
    confirmation: 'APPLY_TARGET35_HTTP_METHOD_REPAIR_ONCE', token: 'memory-only-token',
    fetch: mockMethodFetch([methodSnapshot(before), methodSnapshot(drifted)], calls),
  }), /make_pre_hash_mismatch/);
  assert.equal(calls.filter((call) => call.init.method === 'PATCH').length, 0);
});

test('method repair rejects semantic readback drift after one PATCH without retry', async () => {
  const before = methodDriftBlueprint();
  const after = repairHttpMethods(before).candidate;
  const drifted = structuredClone(after);
  drifted.metadata.readback = true;
  const calls = [];
  await assert.rejects(() => repairHttpMethodsLive({
    ...methodOptions(before), apply: true,
    confirmation: 'APPLY_TARGET35_HTTP_METHOD_REPAIR_ONCE', token: 'memory-only-token',
    fetch: mockMethodFetch([
      methodSnapshot(before), methodSnapshot(before), methodSnapshot(drifted),
    ], calls),
  }), /make_readback_invalid/);
  assert.equal(calls.filter((call) => call.init.method === 'PATCH').length, 1);
});
