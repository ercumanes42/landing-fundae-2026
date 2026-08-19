import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 'fundae-make-outlook-manual-reconcile-v4';
const SCENARIO_ID = 9652631;
const ORIGIN = 'https://fundae-data-brain-pilot.vercel.app';
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const OUTLOOK_SLUG = 'microsoft-email:createAndSendAMessage';
const RECONCILE_CODE = 'OUTLOOK_RESULT_UNCONFIRMED';
const ROUTES = [
  { resource: 'calculator', prepare: 4, package: 8, reserve: 9, outlook: 10, callback: 11, ignore: 24, errorCallback: 28, ack: 32 },
  { resource: 'interactive_checklist', prepare: 5, package: 12, reserve: 13, outlook: 14, callback: 15, ignore: 25, errorCallback: 29, ack: 33, kind: 'generated_pdf' },
  { resource: 'checklist', prepare: 6, package: 16, reserve: 17, outlook: 18, callback: 19, ignore: 26, errorCallback: 30, ack: 34, kind: 'canonical_pdf' },
  { resource: 'webinar', prepare: 7, package: 20, reserve: 21, outlook: 22, callback: 23, ignore: 27, errorCallback: 31, ack: 35 },
];

function at(value, dotPath) {
  return dotPath.split('.').reduce((current, key) => current?.[key], value);
}

function add(errors, condition, message) {
  if (!condition) errors.push(message);
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => JSON.stringify(key) + ':' + stable(nested)).join(',') + '}';
  }
  return JSON.stringify(value);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    stable(Object.keys(value).sort()) === stable([...keys].sort());
}

function collect(value, modules = new Map()) {
  if (Array.isArray(value)) value.forEach((item) => collect(item, modules));
  else if (value && typeof value === 'object') {
    if (Number.isInteger(value.id) && typeof value.module === 'string') modules.set(value.id, value);
    Object.values(value).forEach((item) => collect(item, modules));
  }
  return modules;
}

function mappedJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') throw new Error('invalid_body');
  return JSON.parse(value);
}

function validateHttp(module, http, url, keys, errors, label) {
  add(errors, module?.module === http.slug && module?.version === http.version, label + ': HTTP slug/version mismatch');
  add(errors, at(module, http.methodPath) === http.methodValue, label + ': method literal mismatch');
  add(errors, at(module, http.urlPath) === url, label + ': URL mismatch');
  add(errors, at(module, http.parseResponsePath) === http.parseResponseValue, label + ': parse-response mismatch');
  let body;
  try {
    body = mappedJson(at(module, http.bodyPath));
  } catch {
    errors.push(label + ': body is not valid mapped JSON');
    return null;
  }
  add(errors, exactKeys(body, keys), label + ': request keys mismatch');
  return body;
}

function c(a, o, b) {
  return b === undefined ? { a, o } : { a, o, b: String(b) };
}

function validateFilter(module, expected, errors, label) {
  const groups = module?.filter?.conditions;
  add(errors, Array.isArray(groups) && groups.length === 1, label + ': filter must contain one AND group');
  add(errors, stable(groups?.[0] ?? []) === stable(expected), label + ': filter conditions mismatch');
}

function intakeFilter(resource) {
  return [
    c('{{2.statusCode}}', 'number:equal', 200),
    c('{{2.data.authorized}}', 'boolean:equal', true),
    c('{{2.data.reason_code}}', 'text:equal', 'claimed'),
    c('{{2.data.duplicate}}', 'boolean:equal', false),
    c('{{2.data.intake_capability}}', 'exist'),
    c('{{2.data.payload_sha256}}', 'exist'),
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
  const id = route.package;
  const p = '{{' + id + '.data.';
  const result = [
    c('{{' + id + '.statusCode}}', 'number:equal', 200),
    c(p + 'packaged}}', 'boolean:equal', true),
    c(p + 'reason_code}}', 'text:equal', 'packaged'),
    c(p + 'resource}}', 'text:equal', route.resource),
    c(p + 'template_id}}', 'exist'),
    c(p + 'recipient.email}}', 'exist'),
    c(p + 'subject}}', 'exist'),
    c(p + 'body}}', 'exist'),
    c(p + 'content_type}}', 'text:equal', 'html'),
    c(p + 'package_hmac_sha256}}', 'exist'),
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

function validateCallback(module, http, route, errors, label) {
  const body = validateHttp(module, http, ORIGIN + '/api/transactional/email-callback',
    ['failure_code', 'finalize_capability', 'state'], errors, label);
  add(errors, body?.finalize_capability === '{{' + route.reserve + '.data.finalize_capability}}' &&
    body?.state === 'reconcile_required' && body?.failure_code === RECONCILE_CODE,
  label + ': manual-reconcile contract mismatch');
  return body;
}

function attachment(id) {
  return [{
    filename: '{{' + id + '.data.attachments[1].filename}}',
    data: '{{toBinary(' + id + '.data.attachments[1].content_base64; "base64")}}',
  }];
}

function unsafeAudit(audit, modules, errors) {
  let serialized = JSON.stringify(audit);
  for (const route of ROUTES) {
    const from = modules.get(route.outlook)?.mapper?.from;
    if (Array.isArray(from) && typeof from[0]?.address === 'string') {
      serialized = serialized.replaceAll(from[0].address, '[FIXED_SENDER]');
    }
  }
  add(errors, !/https:\/\/hook\.[^/"']+\/[A-Za-z0-9_-]+/i.test(serialized), 'webhook bearer URL is forbidden');
  add(errors, !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(serialized), 'literal email outside fixed sender is forbidden');
  add(errors, !/MAKE_WEBHOOK_SECRET|authorization\s*:\s*bearer|mcp\/u\//i.test(serialized), 'secret marker is forbidden');
  add(errors, !/provider_message_(?:id|hash)/i.test(serialized), 'provider message identifiers are forbidden');
  add(errors, !/\/api\/transactional\/(?:interactive-checklist|checklist)\/pdf/i.test(serialized), 'separate PDF endpoints are forbidden');
  add(errors, !/\\"state\\"\s*:\s*\\"(?:sent|failed)\\"/i.test(serialized), 'sent/failed callback states are forbidden');
  const ackIds = new Set(ROUTES.map((route) => route.ack));
  const forbidden = /DataStore|GetVariable|FunctionSleep|ActionGetFile|WebhookRespond|google-sheets|listMessages/i;
  for (const module of modules.values()) {
    add(errors, !forbidden.test(module.module), 'Module ' + module.id + ': forbidden slug ' + module.module);
    add(errors, !/SetVariable/i.test(module.module) || ackIds.has(module.id),
      'Module ' + module.id + ': SetVariable is allowed only for terminal acknowledgement markers');
    add(errors, !/(?:^|:)(?:Break|Resume)$/i.test(module.module),
      'Module ' + module.id + ': retry/error-resume directive is forbidden');
    add(errors, !Object.hasOwn(module, 'retry') && !Object.hasOwn(module, 'retries') &&
      !Object.hasOwn(module, 'maxRetries'), 'Module ' + module.id + ': retry settings are forbidden');
  }
  const visit = (value) => {
    if (typeof value === 'string' && CAPABILITY.test(value)) errors.push('literal capability-like value is forbidden');
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(audit.blueprint);
}

export function validateTransactionalMakeOutlookAudit(input) {
  const errors = [];
  const audit = input && typeof input === 'object' ? input : {};
  let blueprint;
  try {
    blueprint = typeof audit.blueprint === 'string' ? JSON.parse(audit.blueprint) : audit.blueprint;
  } catch {
    return { ok: false, saveReady: false, errors: ['blueprint must be valid JSON'] };
  }
  const interfaces = audit.live_interfaces ?? {};
  const http = interfaces.http_v3 ?? {};
  const outlook = interfaces.outlook_send ?? {};

  add(errors, audit.schema_version === SCHEMA_VERSION, 'schema_version must be ' + SCHEMA_VERSION);
  add(errors, interfaces.verified_from_live_interface === true, 'module interfaces must be verified live');
  add(errors, interfaces.to_binary_verified_from_official_help === true, 'toBinary base64 contract must be verified');
  add(errors, interfaces.backend_pdf_determinism_verified === true, 'backend PDF determinism gate must pass');
  for (const key of ['slug', 'version', 'methodPath', 'methodValue', 'urlPath', 'bodyPath', 'parseResponsePath']) {
    add(errors, http[key] !== undefined && http[key] !== '', 'live_interfaces.http_v3.' + key + ' is required');
  }
  add(errors, Object.hasOwn(http, 'parseResponseValue'), 'HTTP parseResponseValue is required');
  for (const key of ['slug', 'version', 'connectionPath', 'toRecipientsPath', 'subjectPath', 'bodyPath',
    'contentTypePath', 'attachmentsPath', 'fromPath', 'errorFlowPath']) {
    add(errors, outlook[key] !== undefined && outlook[key] !== '', 'live_interfaces.outlook_send.' + key + ' is required');
  }
  add(errors, outlook.slug === OUTLOOK_SLUG && outlook.version === 2, 'Outlook slug/version mismatch');
  add(errors, outlook.connectionPath === 'parameters.__IMTCONN__', 'Outlook connection path mismatch');
  add(errors, Number.isSafeInteger(outlook.expectedConnectionId) && outlook.expectedConnectionId > 0,
    'Outlook expected connection ID is required');

  const scenario = audit.scenario ?? {};
  add(errors, scenario.id === SCENARIO_ID, 'scenario.id mismatch');
  add(errors, scenario.isActive === false, 'scenario must remain OFF');
  add(errors, scenario.isValid === true && scenario.isLocked === false, 'scenario must remain valid and unlocked');
  add(errors, blueprint?.metadata?.instant === true, 'instant blueprint is required');
  add(errors, blueprint?.metadata?.scenario?.sequential === true, 'scenario must remain sequential');
  add(errors, blueprint?.metadata?.scenario?.confidential === true, 'scenario must remain confidential');
  add(errors, blueprint?.metadata?.scenario?.maxErrors === 1, 'maxErrors must remain 1');
  add(errors, blueprint?.metadata?.scenario?.dlq === false, 'DLQ must remain disabled');
  add(errors, scenario.dlqCount === 0 && scenario.allDlqCount === 0,
    'incomplete-execution counters must remain zero');

  const top = blueprint?.flow;
  add(errors, Array.isArray(top) && top.length === 3, 'top-level flow must remain trigger, intake and Router');
  add(errors, top?.[0]?.id === 1 && top[0].module === 'gateway:CustomWebHook' && top[0].version === 1, 'module 1 mismatch');
  add(errors, top?.[1]?.id === 2 && top[1].module === http.slug && top[1].version === http.version, 'module 2 mismatch');
  const router = top?.[2];
  add(errors, router?.id === 3 && router.module === 'builtin:BasicRouter' && router.version === 1, 'module 3 mismatch');
  add(errors, Array.isArray(router?.routes) && router.routes.length === 4, 'Router must contain exactly four routes');

  const modules = collect(blueprint);
  const ids = [...modules.keys()].sort((a, b) => a - b);
  add(errors, modules.size === 35, 'exactly 35 modules required; found ' + modules.size);
  add(errors, stable(ids) === stable(Array.from({ length: 35 }, (_, index) => index + 1)), 'module IDs must be exact 1..35');

  let sender;
  for (const [index, route] of ROUTES.entries()) {
    const label = 'Route ' + route.resource;
    const flow = router?.routes?.[index]?.flow ?? [];
    add(errors, stable(flow.map((module) => module.id)) === stable([
      route.prepare, route.package, route.reserve, route.outlook, route.callback, route.ack,
    ]), label + ': flow IDs/order mismatch');

    const prepare = modules.get(route.prepare);
    const prepareBody = validateHttp(prepare, http, ORIGIN + '/api/transactional/prepare',
      ['intake_capability', 'expected_resource', 'mode'], errors, label + ' prepare');
    add(errors, prepareBody?.intake_capability === '{{2.data.intake_capability}}' &&
      prepareBody?.expected_resource === route.resource && prepareBody?.mode === 'dry_run',
    label + ': prepare mappings mismatch');
    validateFilter(prepare, intakeFilter(route.resource), errors, label + ' prepare');

    const packageModule = modules.get(route.package);
    const packageBody = validateHttp(packageModule, http, ORIGIN + '/api/transactional/delivery-package',
      ['intake_capability', 'expected_resource'], errors, label + ' package');
    add(errors, packageBody?.intake_capability === '{{2.data.intake_capability}}' &&
      packageBody?.expected_resource === route.resource, label + ': package mappings mismatch');
    validateFilter(packageModule, prepareFilter(route.prepare, route.resource), errors, label + ' package');

    const reserve = modules.get(route.reserve);
    const reserveBody = validateHttp(reserve, http, ORIGIN + '/api/transactional/mailbox-reserve',
      ['intake_capability', 'expected_resource', 'package_hmac_sha256'], errors, label + ' reserve');
    add(errors, reserveBody?.intake_capability === '{{2.data.intake_capability}}' &&
      reserveBody?.expected_resource === route.resource &&
      reserveBody?.package_hmac_sha256 === '{{' + route.package + '.data.package_hmac_sha256}}',
    label + ': reserve mappings mismatch');
    validateFilter(reserve, packageFilter(route), errors, label + ' reserve');

    const outlookModule = modules.get(route.outlook);
    add(errors, outlookModule?.module === OUTLOOK_SLUG && outlookModule?.version === 2, label + ': Outlook mismatch');
    add(errors, at(outlookModule, outlook.connectionPath) === outlook.expectedConnectionId,
      label + ': connection mismatch');
    add(errors, stable(at(outlookModule, outlook.toRecipientsPath)) === stable([{
      name: '', address: '{{' + route.package + '.data.recipient.email}}',
    }]), label + ': recipient mismatch');
    add(errors, at(outlookModule, outlook.subjectPath) === '{{' + route.package + '.data.subject}}', label + ': subject mismatch');
    add(errors, at(outlookModule, outlook.bodyPath) === '{{' + route.package + '.data.body}}', label + ': body mismatch');
    add(errors, at(outlookModule, outlook.contentTypePath) === 'html', label + ': content type mismatch');
    add(errors, stable(at(outlookModule, outlook.attachmentsPath)) === stable(route.kind ? attachment(route.package) : []),
      label + ': attachment/toBinary mapping mismatch');
    const from = at(outlookModule, outlook.fromPath);
    add(errors, Array.isArray(from) && from.length === 1 && typeof from[0]?.name === 'string' &&
      from[0].name.length > 0 && typeof from[0]?.address === 'string' &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from[0].address), label + ': fixed sender missing');
    if (sender === undefined) sender = stable(from);
    else add(errors, stable(from) === sender, label + ': sender drift');
    validateFilter(outlookModule, reserveFilter(route.reserve), errors, label + ' Outlook');

    const errorFlow = at(outlookModule, outlook.errorFlowPath);
    add(errors, Array.isArray(errorFlow) && errorFlow.length === 2 &&
      stable(errorFlow.map((module) => module.id)) === stable([route.errorCallback, route.ignore]),
    label + ': onerror must be callback ' + route.errorCallback + ' then Ignore ' + route.ignore);

    const errorCallback = modules.get(route.errorCallback);
    validateCallback(errorCallback, http, route, errors, label + ' error callback');
    add(errors, errorCallback?.filter === undefined, label + ': error callback must not be conditionally skipped');
    add(errors, !errorCallback?.onerror && !errorCallback?.routes,
      label + ': nested error-callback flow forbidden');

    const ignore = modules.get(route.ignore);
    add(errors, ignore?.module === 'builtin:Ignore' && ignore?.version === 1, label + ': Ignore mismatch');
    add(errors, !ignore?.onerror && !ignore?.routes, label + ': nested Ignore flow forbidden');
    validateFilter(ignore, callbackAcknowledgementFilter(route.errorCallback, route.reserve), errors,
      label + ' callback acknowledgement');

    const callback = modules.get(route.callback);
    validateCallback(callback, http, route, errors, label + ' callback');
    add(errors, callback?.filter === undefined, label + ': terminal callback must not be conditionally skipped');

    const ack = modules.get(route.ack);
    add(errors, ack?.module === 'util:SetVariable2' && ack?.version === 1,
      label + ': terminal acknowledgement marker mismatch');
    add(errors, exactKeys(ack?.parameters ?? {}, []), label + ': acknowledgement parameters must be empty');
    add(errors, exactKeys(ack?.mapper, ['name', 'scope', 'value']) &&
      ack?.mapper?.name === 'delivery_acknowledged' && ack?.mapper?.scope === 'roundtrip' &&
      ack?.mapper?.value === 'confirmed', label + ': acknowledgement marker must be a fixed non-sensitive constant');
    validateFilter(ack, callbackAcknowledgementFilter(route.callback, route.reserve), errors,
      label + ' terminal callback acknowledgement');
    add(errors, !ack?.onerror && !ack?.routes, label + ': acknowledgement marker must be terminal');
  }

  unsafeAudit(audit, modules, errors);
  const ok = errors.length === 0;
  const runtime = {
    attachmentRoundTripVerified: interfaces.attachment_runtime_roundtrip_verified === true,
    outlookErrorCallbackHandlerVerified: interfaces.outlook_error_callback_handler_verified === true,
    connectionHealthVerified: interfaces.connection_health_verified === true,
    strictFormatFiltersVerified: interfaces.strict_format_filters_verified === true,
    outlookRetryDisabledVerified: interfaces.outlook_retry_disabled_verified === true,
  };
  return {
    ok,
    saveReady: ok && Object.values(runtime).every(Boolean),
    errors,
    summary: {
      scenarioId: SCENARIO_ID,
      moduleCount: modules.size,
      resources: ROUTES.map((route) => route.resource),
      outlookAttemptsPerExecution: 1,
      callbackState: 'reconcile_required',
      terminalAckMarkers: ROUTES.map((route) => route.ack),
      trafficExecuted: false,
      runtime,
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const auditPath = process.argv[2];
  if (!auditPath) {
    console.error('Usage: node automation/scripts/validate-transactional-make-outlook.mjs <sanitized-audit.json>');
    process.exitCode = 2;
  } else {
    try {
      const report = validateTransactionalMakeOutlookAudit(JSON.parse(fs.readFileSync(path.resolve(auditPath), 'utf8')));
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    } catch {
      console.error('Validation failed');
      process.exitCode = 1;
    }
  }
}
