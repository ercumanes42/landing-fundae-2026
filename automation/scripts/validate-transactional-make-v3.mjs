import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 'fundae-make-v3-audit-v1';
const SCENARIO_ID = 9652631;
const INTAKE_URL = 'https://fundae-data-brain-pilot.vercel.app/api/transactional/intake-authorization';
const PREPARE_URL = 'https://fundae-data-brain-pilot.vercel.app/api/transactional/prepare';
const RESOURCES = ['calculator', 'interactive_checklist', 'checklist', 'webinar'];
const PREPARE_KEYS = ['expected_resource', 'intake_capability', 'mode'];
const REQUIRED_FILTERS = [
  'statusCode',
  'authorized',
  'reasonCode',
  'duplicate',
  'intakeCapability',
  'payloadSha256',
  'resource',
];
const OPTIONAL_FILTERS = ['intakeCapabilityFormat', 'payloadSha256Format'];

function addError(errors, condition, message) {
  if (!condition) errors.push(message);
}

function getAtPath(value, dotPath) {
  if (typeof dotPath !== 'string' || !dotPath) return undefined;
  return dotPath.split('.').reduce((current, key) => current?.[key], value);
}

function normalizeBlueprint(value) {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

function collectModules(flow, modules = []) {
  for (const module of Array.isArray(flow) ? flow : []) {
    modules.push(module);
    for (const route of module.routes ?? []) collectModules(route.flow, modules);
  }
  return modules;
}

function walk(value, visitor, currentPath = '$') {
  visitor(value, currentPath);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, `${currentPath}[${index}]`));
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      walk(nested, visitor, `${currentPath}.${key}`);
    }
  }
}

function normalizeHeaders(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => ({
      name: String(entry?.name ?? entry?.key ?? '').toLowerCase(),
      value: entry?.value,
    }));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([name, headerValue]) => ({
      name: name.toLowerCase(),
      value: headerValue,
    }));
  }
  return [];
}

function mappedJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') throw new Error('HTTP body is not a JSON object or string');
  return JSON.parse(value.replace(/\{\{[^{}]+\}\}/g, '__MAPPED_VALUE__'));
}

function sameFlatObject(left, right) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return JSON.stringify(leftKeys) === JSON.stringify(rightKeys) &&
    leftKeys.every((key) => left[key] === right[key]);
}

function conditionKey(condition, contract, resource) {
  for (const [name, expected] of Object.entries(contract)) {
    const expectedCondition = {
      ...expected,
      ...(expected.b === '$RESOURCE' ? { b: resource } : {}),
    };
    if (sameFlatObject(condition, expectedCondition)) return name;
  }
  return null;
}

function validateHttpModule(module, httpContract, expectedUrl, errors, label) {
  addError(errors, String(getAtPath(module, httpContract.methodPath)).toUpperCase() === 'POST', `${label}: HTTP method must be POST`);
  addError(errors, getAtPath(module, httpContract.urlPath) === expectedUrl, `${label}: URL must be the canonical endpoint`);
  addError(errors, getAtPath(module, httpContract.parseResponsePath) === httpContract.parseResponseValue, `${label}: parsed response setting does not match the live interface contract`);
}

function validateNoSecretsOrForbiddenState(audit, blueprint, modules, errors) {
  const serialized = JSON.stringify(audit);
  addError(errors, !/https:\/\/hook\.[^/"']+\/[A-Za-z0-9_-]+/i.test(serialized), 'Audit snapshot must not contain a webhook bearer URL');
  addError(errors, !/MAKE_WEBHOOK_SECRET|authorization\s*:\s*bearer|mcp\/u\//i.test(serialized), 'Audit snapshot contains a secret marker');
  addError(errors, !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(serialized), 'Audit snapshot contains an email address');

  walk(blueprint, (value, valuePath) => {
    if (typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)) {
      errors.push(`${valuePath}: literal capability-like value is forbidden`);
    }
    if (typeof value === 'string' && /\/api\/transactional\/(mailbox-reserve|email-callback|[^"']*\/pdf)/i.test(value)) {
      errors.push(`${valuePath}: forbidden transactional endpoint`);
    }
    if (/\.onerror(?:\.|$)/.test(valuePath)) errors.push(`${valuePath}: error handlers/retries are forbidden`);
    if (/\.(?:__IMTCONN__|makeConnectionId|connection|account)(?:\.|$)/i.test(valuePath) && value !== null && value !== '') {
      errors.push(`${valuePath}: connection-bearing field is forbidden`);
    }
  });

  for (const module of modules) {
    addError(errors, !Object.hasOwn(module, 'onerror'), `Module ${module.id}: onerror/retry flow is forbidden`);
  }
}

export function validateTransactionalMakeV3Audit(input) {
  const errors = [];
  const audit = input && typeof input === 'object' ? input : {};
  let blueprint;
  try {
    blueprint = normalizeBlueprint(audit.blueprint);
  } catch {
    return { ok: false, errors: ['blueprint must be valid JSON'] };
  }

  addError(errors, audit.schema_version === SCHEMA_VERSION, `schema_version must be ${SCHEMA_VERSION}`);
  addError(errors, blueprint && typeof blueprint === 'object', 'blueprint is required');
  if (!blueprint || typeof blueprint !== 'object') return { ok: false, errors };

  const state = audit.scenario ?? {};
  addError(errors, state.id === SCENARIO_ID, `scenario.id must be ${SCENARIO_ID}`);
  addError(errors, state.isActive === false, 'scenario must remain OFF');
  addError(errors, state.isValid === true, 'scenario must be valid');
  addError(errors, state.isLocked === false, 'scenario must be unlocked');
  addError(errors, state.schedulingType === 'immediately', 'webhook scheduling type must be immediately');

  const metadata = blueprint.metadata?.scenario ?? {};
  addError(errors, blueprint.metadata?.instant === true, 'blueprint.metadata.instant must be true');
  addError(errors, metadata.sequential === true, 'scenario metadata must be sequential=true');
  addError(errors, metadata.confidential === true, 'scenario metadata must be confidential=true');
  addError(errors, metadata.maxErrors === 1, 'scenario metadata must use maxErrors=1');
  addError(errors, metadata.dlq === false, 'scenario metadata must use dlq=false');

  const topFlow = blueprint.flow ?? [];
  addError(errors, Array.isArray(topFlow) && topFlow.length === 3, 'top-level flow must contain webhook, intake HTTP and Router only');
  const [trigger, intake, router] = topFlow;
  addError(errors, trigger?.module === 'gateway:CustomWebHook' && trigger?.version === 1, 'module 1 must be gateway:CustomWebHook v1');
  addError(errors, intake?.module === 'http:ActionSendData' && intake?.version === 3, 'module 2 must be http:ActionSendData v3');
  addError(errors, router?.module === 'builtin:BasicRouter' && router?.version === 1, 'module 3 must be builtin:BasicRouter v1');

  const modules = collectModules(topFlow);
  addError(errors, modules.length === 7, `exactly 7 modules required; found ${modules.length}`);
  const ids = modules.map((module) => module.id);
  addError(errors, ids.every((id) => Number.isInteger(id) && id > 0), 'all module IDs must be positive integers');
  addError(errors, new Set(ids).size === ids.length, 'module IDs must be unique');
  const allowedModules = new Set(['gateway:CustomWebHook', 'http:ActionSendData', 'builtin:BasicRouter']);
  for (const module of modules) {
    addError(errors, allowedModules.has(module.module), `Module ${module.id}: forbidden slug ${module.module}`);
  }
  addError(errors, modules.filter((module) => module.module === 'gateway:CustomWebHook' && module.version === 1).length === 1, 'exactly one Webhook v1 is required');
  addError(errors, modules.filter((module) => module.module === 'http:ActionSendData' && module.version === 3).length === 5, 'exactly five HTTP v3 modules are required');
  addError(errors, modules.filter((module) => module.module === 'builtin:BasicRouter' && module.version === 1).length === 1, 'exactly one Router v1 is required');

  const contract = audit.interface_contract ?? {};
  const httpContract = contract.http_v3 ?? {};
  const triggerContract = contract.trigger ?? {};
  const filterContract = contract.filters ?? {};
  for (const key of ['methodPath', 'urlPath', 'headersPath', 'bodyPath', 'parseResponsePath']) {
    addError(errors, typeof httpContract[key] === 'string' && httpContract[key].length > 0, `interface_contract.http_v3.${key} is required from the live interface`);
  }
  addError(errors, Object.hasOwn(httpContract, 'parseResponseValue'), 'interface_contract.http_v3.parseResponseValue is required');
  for (const key of ['hookIdPath', 'rawBodyExpression', 'signatureExpression', 'timestampExpression']) {
    addError(errors, triggerContract[key] !== undefined && triggerContract[key] !== '', `interface_contract.trigger.${key} is required from the live interface`);
  }
  for (const key of REQUIRED_FILTERS) addError(errors, filterContract[key] && typeof filterContract[key] === 'object', `interface_contract.filters.${key} is required`);
  for (const [name, condition] of Object.entries(filterContract)) {
    addError(errors, [...REQUIRED_FILTERS, ...OPTIONAL_FILTERS].includes(name), `unknown filter contract ${name}`);
    if (typeof condition?.a === 'string' && Number.isInteger(intake?.id)) {
      addError(errors, condition.a.includes(`{{${intake.id}.`), `filter ${name} must reference only intake module ${intake.id}`);
      addError(errors, !condition.a.includes(`{{${trigger?.id}.`), `filter ${name} must not reference raw trigger module ${trigger?.id}`);
    }
  }

  if (trigger && intake && router && httpContract.methodPath) {
    const hookId = getAtPath(trigger, triggerContract.hookIdPath);
    const hook = audit.hook ?? {};
    addError(errors, hook.id !== undefined && hookId === hook.id, 'trigger must bind the exact V3 hook ID');
    addError(errors, hook.scenarioId === SCENARIO_ID, 'V3 hook scenarioId must match the scenario');
    addError(errors, hook.enabled === false, 'V3 hook must be disabled');
    addError(errors, hook.queueSize === 0, 'V3 hook queue must be zero');
    addError(errors, hook.headers === true && hook.stringify === true && String(hook.method).toUpperCase() === 'POST', 'V3 hook must use POST, headers=true and stringify=true');
    addError(errors, audit.triggerHookId === hook.id, '/triggers must resolve the exact V3 hook ID');

    validateHttpModule(intake, httpContract, INTAKE_URL, errors, 'Intake HTTP');
    addError(errors, getAtPath(intake, httpContract.bodyPath) === triggerContract.rawBodyExpression, 'Intake HTTP must forward the exact raw body expression');
    const intakeHeaders = normalizeHeaders(getAtPath(intake, httpContract.headersPath));
    const signature = intakeHeaders.find((header) => header.name === 'x-make-signature');
    const timestamp = intakeHeaders.find((header) => header.name === 'x-make-timestamp');
    addError(errors, signature?.value === triggerContract.signatureExpression, 'Intake must forward the original signature header only');
    addError(errors, timestamp?.value === triggerContract.timestampExpression, 'Intake must forward the original timestamp header only');
    const unexpectedMappedHeaders = intakeHeaders.filter((header) =>
      header.value?.includes?.(`{{${trigger.id}.`) &&
      !['x-make-signature', 'x-make-timestamp'].includes(header.name));
    addError(errors, unexpectedMappedHeaders.length === 0, 'Intake maps an unexpected trigger header');

    const routes = router.routes ?? [];
    addError(errors, Array.isArray(routes) && routes.length === 4, 'Router must contain exactly four routes');
    const foundResources = [];
    for (const [index, route] of routes.entries()) {
      addError(errors, Array.isArray(route.flow) && route.flow.length === 1, `Route ${index + 1} must contain one HTTP module`);
      const prepare = route.flow?.[0];
      if (!prepare) continue;
      validateHttpModule(prepare, httpContract, PREPARE_URL, errors, `Route ${index + 1}`);
      let body;
      try {
        body = mappedJson(getAtPath(prepare, httpContract.bodyPath));
      } catch (error) {
        errors.push(`Route ${index + 1}: ${error instanceof Error ? error.message : 'invalid JSON body'}`);
        continue;
      }
      addError(errors, JSON.stringify(Object.keys(body).sort()) === JSON.stringify(PREPARE_KEYS), `Route ${index + 1}: prepare body must contain exactly three allowed keys`);
      const resource = body.expected_resource;
      foundResources.push(resource);
      addError(errors, RESOURCES.includes(resource), `Route ${index + 1}: invalid expected_resource`);
      addError(errors, body.mode === 'dry_run', `Route ${index + 1}: mode must be dry_run`);
      const mappedCapability = typeof getAtPath(prepare, httpContract.bodyPath) === 'string'
        ? getAtPath(prepare, httpContract.bodyPath).includes(filterContract.intakeCapability?.a)
        : body.intake_capability === filterContract.intakeCapability?.a;
      addError(errors, mappedCapability, `Route ${index + 1}: intake_capability must map the verified intake output`);

      const groups = prepare.filter?.conditions;
      addError(errors, Array.isArray(groups) && groups.length === 1, `Route ${index + 1}: filter must contain one AND group`);
      const conditions = groups?.[0] ?? [];
      const names = conditions.map((condition) => conditionKey(condition, filterContract, resource));
      addError(errors, names.every(Boolean), `Route ${index + 1}: filter contains an unapproved condition`);
      addError(errors, new Set(names).size === names.length, `Route ${index + 1}: filter contains duplicate conditions`);
      for (const required of REQUIRED_FILTERS) {
        addError(errors, names.includes(required), `Route ${index + 1}: missing ${required} gate`);
      }
      const expectedCount = Object.keys(filterContract).length;
      addError(errors, conditions.length === expectedCount, `Route ${index + 1}: filter must match the live-derived contract exactly`);
    }
    addError(errors, JSON.stringify([...foundResources].sort()) === JSON.stringify([...RESOURCES].sort()), 'Router resources must be the exact four-resource set');
  }

  validateNoSecretsOrForbiddenState(audit, blueprint, modules, errors);
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      scenarioId: SCENARIO_ID,
      moduleCount: modules.length,
      resources: RESOURCES,
      trafficExecuted: false,
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const auditPath = process.argv[2];
  if (!auditPath) {
    console.error('Usage: node automation/scripts/validate-transactional-make-v3.mjs <sanitized-audit.json>');
    process.exitCode = 2;
  } else {
    try {
      const audit = JSON.parse(fs.readFileSync(path.resolve(auditPath), 'utf8'));
      const report = validateTransactionalMakeV3Audit(audit);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Validation failed');
      process.exitCode = 1;
    }
  }
}
