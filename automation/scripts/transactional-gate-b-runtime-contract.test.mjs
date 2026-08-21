import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertExactMakeScopes,
  assertMakeRuntimeState,
  makeHookAddress,
  unwrapMakeBlueprint,
  unwrapMakeHook,
  unwrapMakeScenario,
} from './transactional-gate-b-runtime-contract.mjs';

test('accepts only the exact wrapped Make authorization scope set', () => {
  const body = { authorization: { authUsed: 'token', scope: ['scenarios:read', 'hooks:write', 'hooks:read'] } };
  assert.deepEqual(assertExactMakeScopes(body), ['hooks:read', 'hooks:write', 'scenarios:read']);
  assert.deepEqual(body.authorization.scope, ['scenarios:read', 'hooks:write', 'hooks:read']);
});

test('rejects legacy, malformed, duplicate, missing and extra scope shapes', () => {
  const invalid = [
    { scopes: ['hooks:read', 'hooks:write', 'scenarios:read'] },
    { authorization: { scopes: ['hooks:read', 'hooks:write', 'scenarios:read'] } },
    { authorization: { scope: 'hooks:read' } },
    { authorization: { scope: ['hooks:read', 'hooks:read', 'scenarios:read'] } },
    { authorization: { scope: ['hooks:read', 'scenarios:read'] } },
    { authorization: { scope: ['hooks:read', 'hooks:write', 'scenarios:read', 'teams:read'] } },
  ];
  for (const body of invalid) assert.throws(() => assertExactMakeScopes(body), /^Error: make_/);
});

test('unwraps only the documented scenario and hook wrappers', () => {
  const scenario = { id: 9652631, isActive: false };
  const hook = { id: 4318951, scenarioId: 9652631, enabled: false, queueCount: 0 };
  assert.equal(unwrapMakeScenario({ scenario }), scenario);
  assert.equal(unwrapMakeHook({ hook }), hook);
  assert.throws(() => unwrapMakeScenario(scenario), /make_scenario_shape_invalid/);
  assert.throws(() => unwrapMakeHook(hook), /make_hook_shape_invalid/);
});

test('unwraps only the exact successful blueprint endpoint response', () => {
  const blueprint = { flow: [], metadata: {}, name: 'Target35' };
  const body = {
    code: 'OK',
    response: {
      blueprint,
      concept: false,
      created: '2026-08-17T00:00:00Z',
      idSequence: 36,
      last_edit: '2026-08-17T00:00:00Z',
      metadata: {},
      scheduling: null,
    },
  };
  assert.equal(unwrapMakeBlueprint(body), blueprint);
  for (const invalid of [
    { ...body, code: 'ERROR' },
    { response: body.response },
    { code: 'OK', response: { ...body.response, blueprint: JSON.stringify(blueprint) } },
    { code: 'OK', response: { ...body.response, blueprint: null } },
    { code: 'OK', response: { ...body.response, blueprint: [] } },
    { code: 'OK', response: { ...body.response, blueprint: { ...blueprint, flow: {} } } },
    { ...body, blueprint },
  ]) assert.throws(() => unwrapMakeBlueprint(invalid), /make_blueprint_shape_invalid/);
});

test('accepts a trusted HTTPS ping address and rejects unsafe alternatives', () => {
  assert.equal(makeHookAddress({ address: 'https://hook.eu2.make.com/private-path' }), 'https://hook.eu2.make.com/private-path');
  for (const body of [
    { address: 'http://hook.eu2.make.com/private-path' },
    { address: 'https://make.com.attacker.example/private-path' },
    { address: 'https://user:pass@hook.eu2.make.com/private-path' },
    { address: 42 },
    {},
  ]) assert.throws(() => makeHookAddress(body), /make_hook_address_invalid/);
});

test('separates ready and close hook states fail-closed', () => {
  const scenario = { id: 9652631, isActive: false };
  const ping = { learning: false };
  const enabledHook = { scenarioId: 9652631, enabled: true, queueCount: 0 };
  const disabledHook = { scenarioId: 9652631, enabled: false, queueCount: 0 };
  assert.doesNotThrow(() => assertMakeRuntimeState({ scenario, hook: enabledHook, ping, expectedEnabled: true }));
  assert.doesNotThrow(() => assertMakeRuntimeState({ scenario, hook: disabledHook, ping, expectedEnabled: false }));
  assert.throws(
    () => assertMakeRuntimeState({ scenario, hook: disabledHook, ping, expectedEnabled: true }),
    /make_hook_state_invalid/,
  );
  assert.throws(
    () => assertMakeRuntimeState({ scenario, hook: enabledHook, ping, expectedEnabled: false }),
    /make_hook_state_invalid/,
  );
});
