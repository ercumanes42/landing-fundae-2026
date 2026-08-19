import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeTarget35Scenario, TARGET35_INTERFACES } from './transactional-gate-b-runtime.mjs';
import {
  unwrapMakeBlueprint,
  unwrapMakeHook,
  unwrapMakeScenario,
} from './transactional-gate-b-runtime-contract.mjs';
import { validateTransactionalMakeOutlookAudit } from './validate-transactional-make-outlook.mjs';

const MAKE_API_BASE = 'https://eu2.make.com/api/v2';
const SCENARIO_ID = 9652631;
const HOOK_ID = 4318951;
const CONNECTION_ID = 14522088;
const HISTORICAL_CONNECTION_ID = 13331400;
const APPLY_CONFIRMATION = 'APPLY_TARGET35_OUTLOOK_ALL4_REPAIR_ONCE';
const PRE_HASH = '3f5ea89ee31a55af264a946d4c6967afd298fe88cbb14d54432de33028432dfc';
const METHOD_PRE_HASH = '8246e0b230a89d7eb43b1fa95870aa3c855f4481e2569da872504c8beaa9fe29';
const METHOD_APPLY_CONFIRMATION = 'APPLY_TARGET35_HTTP_METHOD_REPAIR_ONCE';
const METHOD_IDS = [8, 9, 11, 12, 13, 15, 16, 17, 19, 20, 21, 23, 28, 29, 30, 31];
const METHOD_SOURCE_IDS = [2, 4, 5, 6, 7];
const EXPECTED_SCOPES = ['connections:read', 'hooks:read', 'scenarios:read', 'scenarios:write'];
const METHOD_EXPECTED_SCOPES = ['hooks:read', 'hooks:write', 'scenarios:read', 'scenarios:write'];
const PRE_ERRORS = [
  'Route calculator: attachment/toBinary mapping mismatch',
  'Route calculator: connection mismatch',
  'Route calculator: recipient mismatch',
  'Route interactive_checklist: connection mismatch',
  'Route interactive_checklist: recipient mismatch',
  'Route checklist: connection mismatch',
  'Route checklist: recipient mismatch',
  'Route webinar: attachment/toBinary mapping mismatch',
  'Route webinar: connection mismatch',
  'Route webinar: recipient mismatch',
].sort();
const ALLOWED_PATHS = [
  'module[10].mapper.attachments',
  'module[10].mapper.toRecipients',
  'module[10].parameters.__IMTCONN__',
  'module[14].mapper.toRecipients',
  'module[14].parameters.__IMTCONN__',
  'module[18].mapper.toRecipients',
  'module[18].parameters.__IMTCONN__',
  'module[22].mapper.attachments',
  'module[22].mapper.toRecipients',
].sort();
const METHOD_PRE_ERRORS = ['calculator', 'interactive_checklist', 'checklist', 'webinar']
  .flatMap((resource) => ['package', 'reserve', 'callback', 'error callback']
    .map((stage) => `Route ${resource} ${stage}: method literal mismatch`))
  .sort();

function fail(reason) {
  throw new Error(reason);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isPlainObject(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function clone(value) {
  return structuredClone(value);
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isPlainObject(value)) {
    return '{' + Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => JSON.stringify(key) + ':' + canonical(nested)).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function blueprintHash(blueprint) {
  if (!isPlainObject(blueprint)) fail('make_blueprint_invalid');
  return createHash('sha256').update(JSON.stringify(blueprint), 'utf8').digest('hex');
}

function collectModules(value, modules = new Map()) {
  if (Array.isArray(value)) value.forEach((item) => collectModules(item, modules));
  else if (isPlainObject(value)) {
    if (Number.isInteger(value.id) && typeof value.module === 'string') {
      if (modules.has(value.id)) fail('make_module_id_duplicate');
      modules.set(value.id, value);
    }
    Object.values(value).forEach((item) => collectModules(item, modules));
  }
  return modules;
}

function maskAllowedPaths(blueprint) {
  const masked = clone(blueprint);
  const modules = collectModules(masked);
  for (const id of [10, 14, 18, 22]) {
    const module = modules.get(id);
    if (!module || !isPlainObject(module.parameters) || !isPlainObject(module.mapper)) {
      fail('make_outlook_shape_invalid');
    }
    module.mapper.toRecipients = '__ALLOWED__';
  }
  for (const id of [10, 14, 18]) modules.get(id).parameters.__IMTCONN__ = '__ALLOWED__';
  for (const id of [10, 22]) modules.get(id).mapper.attachments = '__ALLOWED__';
  return masked;
}

export function repairOutlookModules(blueprint) {
  if (!isPlainObject(blueprint)) fail('make_blueprint_invalid');
  const before = clone(blueprint);
  const candidate = clone(blueprint);
  const modules = collectModules(candidate);
  if (modules.size !== 35 || [...modules.keys()].sort((a, b) => a - b)
    .some((id, index) => id !== index + 1)) fail('make_module_set_invalid');
  const packages = new Map([[10, 8], [14, 12], [18, 16], [22, 20]]);
  for (const [id, packageId] of packages) {
    const module = modules.get(id);
    if (
      module?.module !== 'microsoft-email:createAndSendAMessage' || module?.version !== 2 ||
      !isPlainObject(module.parameters) || !isPlainObject(module.mapper)
    ) fail('make_outlook_shape_invalid');
    module.mapper.toRecipients = [{ name: '', address: `{{${packageId}.data.recipient.email}}` }];
  }
  for (const id of [10, 14, 18]) modules.get(id).parameters.__IMTCONN__ = CONNECTION_ID;
  if (modules.get(22).parameters.__IMTCONN__ !== CONNECTION_ID) fail('make_selected_connection_drift');
  modules.get(10).mapper.attachments = [];
  modules.get(22).mapper.attachments = [];

  if (JSON.stringify(maskAllowedPaths(before)) !== JSON.stringify(maskAllowedPaths(candidate))) {
    fail('make_mutation_scope_invalid');
  }
  return { candidate, changedPaths: [...ALLOWED_PATHS] };
}

export const repairCalculatorModule = repairOutlookModules;

function maskMethodPaths(blueprint) {
  const masked = clone(blueprint);
  const modules = collectModules(masked);
  for (const id of METHOD_IDS) {
    const module = modules.get(id);
    if (!isPlainObject(module?.mapper)) fail('make_http_shape_invalid');
    module.mapper.method = '__ALLOWED__';
  }
  return masked;
}

export function repairHttpMethods(blueprint) {
  if (!isPlainObject(blueprint)) fail('make_blueprint_invalid');
  const before = clone(blueprint);
  const candidate = clone(blueprint);
  const modules = collectModules(candidate);
  if (modules.size !== 35 || [...modules.keys()].sort((a, b) => a - b)
    .some((id, index) => id !== index + 1)) fail('make_module_set_invalid');
  for (const id of METHOD_SOURCE_IDS) {
    if (modules.get(id)?.mapper?.method !== 'post') fail('make_method_source_drift');
  }
  for (const id of METHOD_IDS) {
    const module = modules.get(id);
    if (module?.module !== 'http:ActionSendData' || module?.version !== 3 ||
        !isPlainObject(module.mapper) || module.mapper.method !== 'POST') {
      fail('make_http_method_drift');
    }
    module.mapper.method = 'post';
  }
  if (JSON.stringify(maskMethodPaths(before)) !== JSON.stringify(maskMethodPaths(candidate))) {
    fail('make_mutation_scope_invalid');
  }
  return {
    candidate,
    changedPaths: METHOD_IDS.map((id) => `module[${id}].mapper.method`).sort(),
  };
}

function assertRepairScopes(body) {
  const scopes = body?.authorization?.scope;
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string') ||
      new Set(scopes).size !== scopes.length ||
      JSON.stringify([...scopes].sort()) !== JSON.stringify(EXPECTED_SCOPES)) {
    fail('make_scopes_mismatch');
  }
}

function assertMethodRepairScopes(body) {
  const scopes = body?.authorization?.scope;
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string') ||
      new Set(scopes).size !== scopes.length ||
      JSON.stringify([...scopes].sort()) !== JSON.stringify(METHOD_EXPECTED_SCOPES)) {
    fail('make_scopes_mismatch');
  }
}

function assertConnection(body) {
  if (!exactKeys(body, ['connection']) || !isPlainObject(body.connection) ||
      Number(body.connection.id) !== CONNECTION_ID) fail('make_connection_shape_invalid');
}

function assertSafeState(scenario, hook) {
  const isValid = typeof scenario?.isinvalid === 'boolean' ? !scenario.isinvalid : scenario?.isValid;
  const isLocked = typeof scenario?.islocked === 'boolean' ? scenario.islocked : scenario?.isLocked;
  if (scenario?.id !== SCENARIO_ID || scenario?.isActive !== false || isValid !== true ||
      isLocked !== false || scenario?.dlqCount !== 0 || scenario?.allDlqCount !== 0) {
    fail('make_scenario_state_invalid');
  }
  if (String(hook?.scenarioId) !== String(SCENARIO_ID) || hook?.enabled !== false || hook?.queueCount !== 0) {
    fail('make_hook_state_invalid');
  }
}

function audit(scenario, blueprint, validate = validateTransactionalMakeOutlookAudit,
  expectedConnectionId = CONNECTION_ID) {
  const normalized = normalizeTarget35Scenario(scenario, blueprint);
  return validate({
    schema_version: 'fundae-make-outlook-manual-reconcile-v4',
    scenario: normalized,
    blueprint,
    live_interfaces: {
      ...TARGET35_INTERFACES,
      outlook_send: { ...TARGET35_INTERFACES.outlook_send, expectedConnectionId },
    },
  });
}

export function buildRepairPlan(snapshot, options = {}) {
  const validate = options.validate ?? validateTransactionalMakeOutlookAudit;
  const preHash = options.preHash ?? PRE_HASH;
  assertRepairScopes(snapshot.authorization);
  assertConnection(snapshot.connection);
  const scenario = unwrapMakeScenario(snapshot.scenario);
  const blueprint = unwrapMakeBlueprint(snapshot.blueprint);
  const hook = unwrapMakeHook(snapshot.hook);
  assertSafeState(scenario, hook);
  if (blueprintHash(blueprint) !== preHash) fail('make_pre_hash_mismatch');
  const beforeReport = audit(scenario, blueprint, validate, HISTORICAL_CONNECTION_ID);
  if (beforeReport?.ok !== false || beforeReport?.summary?.moduleCount !== 35 ||
      JSON.stringify([...(beforeReport.errors ?? [])].sort()) !== JSON.stringify(PRE_ERRORS)) {
    fail('make_precondition_errors_mismatch');
  }
  const { candidate, changedPaths } = repairOutlookModules(blueprint);
  const afterReport = audit(scenario, candidate, validate);
  if (afterReport?.ok !== true || (afterReport.errors ?? []).length !== 0 ||
      afterReport?.summary?.moduleCount !== 35) fail('make_candidate_invalid');
  const candidateHash = blueprintHash(candidate);
  return { candidate, changedPaths, preHash, candidateHash };
}

export function buildMethodRepairPlan(snapshot, options = {}) {
  const validate = options.validate ?? validateTransactionalMakeOutlookAudit;
  const preHash = options.preHash ?? METHOD_PRE_HASH;
  assertMethodRepairScopes(snapshot.authorization);
  const scenario = unwrapMakeScenario(snapshot.scenario);
  const blueprint = unwrapMakeBlueprint(snapshot.blueprint);
  const hook = unwrapMakeHook(snapshot.hook);
  assertSafeState(scenario, hook);
  if (blueprintHash(blueprint) !== preHash) fail('make_pre_hash_mismatch');
  const beforeReport = audit(scenario, blueprint, validate);
  if (beforeReport?.ok !== false || beforeReport?.summary?.moduleCount !== 35 ||
      JSON.stringify([...(beforeReport.errors ?? [])].sort()) !== JSON.stringify(METHOD_PRE_ERRORS)) {
    fail('make_precondition_errors_mismatch');
  }
  const { candidate, changedPaths } = repairHttpMethods(blueprint);
  const afterReport = audit(scenario, candidate, validate);
  if (!afterReport?.ok || (afterReport.errors ?? []).length !== 0 ||
      afterReport?.summary?.moduleCount !== 35) fail('make_candidate_invalid');
  return { candidate, changedPaths, preHash, candidateHash: blueprintHash(candidate) };
}

async function jsonResponse(response, label) {
  if (!response?.ok) fail(`${label}_status_${response?.status ?? 'unknown'}`);
  try {
    return await response.json();
  } catch {
    fail(`${label}_json_invalid`);
  }
}

export async function fetchRepairSnapshot(fetchImpl, token) {
  if (typeof fetchImpl !== 'function' || typeof token !== 'string' || !token.trim()) fail('make_token_missing');
  const headers = { Authorization: `Token ${token.trim()}` };
  let responses;
  try {
    const request = { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000), headers };
    responses = await Promise.all([
      fetchImpl(`${MAKE_API_BASE}/users/me/current-authorization`, request),
      fetchImpl(`${MAKE_API_BASE}/scenarios/${SCENARIO_ID}`, request),
      fetchImpl(`${MAKE_API_BASE}/scenarios/${SCENARIO_ID}/blueprint`, request),
      fetchImpl(`${MAKE_API_BASE}/hooks/${HOOK_ID}`, request),
      fetchImpl(`${MAKE_API_BASE}/connections/${CONNECTION_ID}`, request),
    ]);
  } catch {
    fail('make_read_failed');
  }
  const [authorization, scenario, blueprint, hook, connection] = await Promise.all([
    jsonResponse(responses[0], 'make_authorization'),
    jsonResponse(responses[1], 'make_scenario'),
    jsonResponse(responses[2], 'make_blueprint'),
    jsonResponse(responses[3], 'make_hook'),
    jsonResponse(responses[4], 'make_connection'),
  ]);
  return { authorization, scenario, blueprint, hook, connection };
}

export async function fetchMethodRepairSnapshot(fetchImpl, token) {
  if (typeof fetchImpl !== 'function' || typeof token !== 'string' || !token.trim()) fail('make_token_missing');
  const headers = { Authorization: `Token ${token.trim()}` };
  let responses;
  try {
    const request = { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000), headers };
    responses = await Promise.all([
      fetchImpl(`${MAKE_API_BASE}/users/me/current-authorization`, request),
      fetchImpl(`${MAKE_API_BASE}/scenarios/${SCENARIO_ID}`, request),
      fetchImpl(`${MAKE_API_BASE}/scenarios/${SCENARIO_ID}/blueprint`, request),
      fetchImpl(`${MAKE_API_BASE}/hooks/${HOOK_ID}`, request),
    ]);
  } catch {
    fail('make_read_failed');
  }
  const [authorization, scenario, blueprint, hook] = await Promise.all([
    jsonResponse(responses[0], 'make_authorization'),
    jsonResponse(responses[1], 'make_scenario'),
    jsonResponse(responses[2], 'make_blueprint'),
    jsonResponse(responses[3], 'make_hook'),
  ]);
  return { authorization, scenario, blueprint, hook };
}

export async function repairM10(options = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const token = options.token ?? process.env.MAKE_API_TOKEN ?? '';
  const apply = options.apply === true;
  const confirmation = options.confirmation ?? '';
  if (apply && confirmation !== APPLY_CONFIRMATION) fail('apply_confirmation_required');
  const firstPlan = buildRepairPlan(await fetchRepairSnapshot(fetchImpl, token), options);
  if (!apply) {
    return {
      status: 'dry_run_ready', writes: 0, scenario_off: true, hook_disabled: true,
      queue_zero: true, connection_present: true, module_count: 35,
      precondition_errors: 10, changed_paths: firstPlan.changedPaths.length,
      candidate_valid: true, pre_hash_match: true, post_hash_match: true,
    };
  }
  const freshPlan = buildRepairPlan(await fetchRepairSnapshot(fetchImpl, token), options);
  if (firstPlan.candidateHash !== freshPlan.candidateHash) {
    fail('make_concurrent_change_detected');
  }
  let response;
  try {
    response = await fetchImpl(`${MAKE_API_BASE}/scenarios/${SCENARIO_ID}?confirmed=true`, {
      method: 'PATCH', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Token ${token.trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ blueprint: JSON.stringify(freshPlan.candidate) }),
    });
  } catch {
    fail('make_patch_outcome_ambiguous');
  }
  if (!response.ok) fail(`make_patch_status_${response.status}`);

  const readback = await fetchRepairSnapshot(fetchImpl, token);
  const scenario = unwrapMakeScenario(readback.scenario);
  const blueprint = unwrapMakeBlueprint(readback.blueprint);
  const hook = unwrapMakeHook(readback.hook);
  assertRepairScopes(readback.authorization);
  assertConnection(readback.connection);
  assertSafeState(scenario, hook);
  const report = audit(scenario, blueprint, options.validate ?? validateTransactionalMakeOutlookAudit);
  const rawHashMatch = blueprintHash(blueprint) === freshPlan.candidateHash;
  const semanticMatch = canonical(blueprint) === canonical(freshPlan.candidate);
  if (!semanticMatch || !report.ok ||
      report.errors.length !== 0 || report.summary?.moduleCount !== 35) fail('make_readback_invalid');
  return {
    status: 'repaired', writes: 1, scenario_off: true, hook_disabled: true,
    queue_zero: true, connection_present: true, module_count: 35,
    changed_paths: freshPlan.changedPaths.length, validator_errors: 0,
    semantic_match: true, raw_hash_match: rawHashMatch,
  };
}

export const repairOutlookAll4 = repairM10;

export async function repairHttpMethodsLive(options = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const token = options.token ?? process.env.MAKE_API_TOKEN ?? '';
  const apply = options.apply === true;
  const confirmation = options.confirmation ?? '';
  if (apply && confirmation !== METHOD_APPLY_CONFIRMATION) fail('apply_confirmation_required');
  const firstPlan = buildMethodRepairPlan(await fetchMethodRepairSnapshot(fetchImpl, token), options);
  if (!apply) {
    return {
      status: 'dry_run_ready', writes: 0, scenario_off: true, hook_disabled: true,
      queue_zero: true, module_count: 35,
      precondition_errors: 16, changed_paths: firstPlan.changedPaths.length,
      candidate_valid: true, pre_hash_match: true,
    };
  }

  const freshPlan = buildMethodRepairPlan(await fetchMethodRepairSnapshot(fetchImpl, token), options);
  if (firstPlan.candidateHash !== freshPlan.candidateHash) fail('make_concurrent_change_detected');
  let response;
  try {
    response = await fetchImpl(`${MAKE_API_BASE}/scenarios/${SCENARIO_ID}?confirmed=true`, {
      method: 'PATCH', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Token ${token.trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ blueprint: JSON.stringify(freshPlan.candidate) }),
    });
  } catch {
    fail('make_patch_outcome_ambiguous');
  }
  if (!response.ok) fail(`make_patch_status_${response.status}`);

  const readback = await fetchMethodRepairSnapshot(fetchImpl, token);
  const scenario = unwrapMakeScenario(readback.scenario);
  const blueprint = unwrapMakeBlueprint(readback.blueprint);
  const hook = unwrapMakeHook(readback.hook);
  assertMethodRepairScopes(readback.authorization);
  assertSafeState(scenario, hook);
  const report = audit(scenario, blueprint, options.validate ?? validateTransactionalMakeOutlookAudit);
  const rawHashMatch = blueprintHash(blueprint) === freshPlan.candidateHash;
  const semanticMatch = canonical(blueprint) === canonical(freshPlan.candidate);
  if (!semanticMatch || !report.ok || report.errors.length !== 0 ||
      report.summary?.moduleCount !== 35) fail('make_readback_invalid');
  return {
    status: 'repaired', writes: 1, scenario_off: true, hook_disabled: true,
    queue_zero: true, module_count: 35,
    changed_paths: freshPlan.changedPaths.length, validator_errors: 0,
    semantic_match: true, raw_hash_match: rawHashMatch,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const apply = args[0] === '--apply';
  const confirmation = apply ? args[1] : '';
  if ((!apply && args.length !== 0) || (apply && args.length !== 2)) {
    process.stderr.write('OUTLOOK_REPAIR_FAIL:usage_invalid');
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(JSON.stringify(await repairM10({ apply, confirmation })));
    } catch (error) {
      process.stderr.write(`OUTLOOK_REPAIR_FAIL:${error instanceof Error ? error.message : 'unknown'}`);
      process.exitCode = 1;
    }
  }
}
