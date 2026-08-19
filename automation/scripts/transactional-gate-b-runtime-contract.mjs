const EXPECTED_SCOPES = ['hooks:read', 'hooks:write', 'scenarios:read'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function assertExactMakeScopes(body) {
  if (!isPlainObject(body) || !isPlainObject(body.authorization)) {
    throw new Error('make_authorization_shape_invalid');
  }
  const scopes = body.authorization.scope;
  if (!Array.isArray(scopes) || scopes.length !== EXPECTED_SCOPES.length ||
      scopes.some((scope) => typeof scope !== 'string') || new Set(scopes).size !== scopes.length) {
    throw new Error('make_authorization_shape_invalid');
  }
  const actual = [...scopes].sort();
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_SCOPES)) {
    throw new Error('make_scopes_mismatch');
  }
  return actual;
}

export function unwrapMakeScenario(body) {
  if (!isPlainObject(body) || !isPlainObject(body.scenario)) {
    throw new Error('make_scenario_shape_invalid');
  }
  return body.scenario;
}

export function unwrapMakeHook(body) {
  if (!isPlainObject(body) || !isPlainObject(body.hook)) {
    throw new Error('make_hook_shape_invalid');
  }
  return body.hook;
}

export function unwrapMakeBlueprint(body) {
  if (
    !isPlainObject(body) ||
    JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(['code', 'response']) ||
    body.code !== 'OK' ||
    !isPlainObject(body.response) ||
    JSON.stringify(Object.keys(body.response).sort()) !== JSON.stringify([
      'blueprint', 'concept', 'created', 'idSequence', 'last_edit', 'metadata', 'scheduling',
    ].sort()) ||
    !isPlainObject(body.response.blueprint) ||
    JSON.stringify(Object.keys(body.response.blueprint).sort()) !== JSON.stringify(['flow', 'metadata', 'name']) ||
    !Array.isArray(body.response.blueprint.flow)
  ) {
    throw new Error('make_blueprint_shape_invalid');
  }
  return body.response.blueprint;
}

export function makeHookAddress(body) {
  if (!isPlainObject(body) || typeof body.address !== 'string') {
    throw new Error('make_hook_address_invalid');
  }
  let address;
  try {
    address = new URL(body.address);
  } catch {
    throw new Error('make_hook_address_invalid');
  }
  const trustedHost = address.hostname === 'make.com' || address.hostname.endsWith('.make.com') ||
    address.hostname === 'make.cloud' || address.hostname.endsWith('.make.cloud');
  if (address.protocol !== 'https:' || !trustedHost || address.username || address.password) {
    throw new Error('make_hook_address_invalid');
  }
  return address.href;
}

export function assertMakeRuntimeState({ scenario, hook, ping, expectedEnabled }) {
  if (typeof expectedEnabled !== 'boolean') throw new Error('make_expected_state_invalid');
  if (!isPlainObject(scenario) || scenario.isActive !== false) throw new Error('make_scenario_active');
  if (!isPlainObject(hook) || String(hook.scenarioId) !== '9652631') throw new Error('make_hook_binding_mismatch');
  if (!isPlainObject(ping) || hook.enabled !== expectedEnabled || hook.queueCount !== 0 || ping.learning !== false) {
    throw new Error('make_hook_state_invalid');
  }
}
