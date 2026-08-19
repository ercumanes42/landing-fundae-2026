import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertExactMakeScopes,
  assertMakeRuntimeState,
  makeHookAddress,
  unwrapMakeBlueprint,
  unwrapMakeHook,
  unwrapMakeScenario,
} from './transactional-gate-b-runtime-contract.mjs';
import { validateTransactionalMakeOutlookAudit } from './validate-transactional-make-outlook.mjs';

const RESOURCES = ['calculator', 'interactive_checklist', 'checklist', 'webinar'];
const MAKE_API_BASE = 'https://eu2.make.com/api/v2';
const MAKE_HOOK_ID = '4318951';
const FRESH_SUBMISSION_PREFIX = 'pilot_outlook_e2e_v3_';
const SEND_CONFIRMATION = 'POST_ONCE_FRESH_V4';
const HOOK_TIMEOUT_MS = 15_000;
const V4_INTERACTIVE_ANSWERS = {
  company_size: '1-5',
  credit_visibility: 'No todavía',
  training_fit: 'Tenemos una idea general',
  planning_process: 'A veces con poco margen',
  rlpt_process: 'No existe RLPT',
  evidence_tracking: 'Solo en algunos cursos',
  documentation_control: 'Sí, con un sistema claro',
  cofinancing: 'No aplica: 1-5 personas',
  review_timing: 'Esta semana',
};
export const TARGET35_INTERFACES = {
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
    expectedConnectionId: 14522088,
    connectionPath: 'parameters.__IMTCONN__', toRecipientsPath: 'mapper.toRecipients',
    subjectPath: 'mapper.subject', bodyPath: 'mapper.content',
    contentTypePath: 'mapper.contentType', attachmentsPath: 'mapper.attachments',
    fromPath: 'mapper.from', errorFlowPath: 'onerror',
  },
};

function fail(message) {
  throw new Error(message);
}

export function normalizeTarget35Scenario(scenario, blueprint) {
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
    fail('make_scenario_shape_invalid');
  }
  if (Object.hasOwn(scenario, 'blueprint')) fail('make_scenario_shape_invalid');
  const legacyValid = Object.hasOwn(scenario, 'isinvalid');
  const modernValid = Object.hasOwn(scenario, 'isValid');
  const legacyLocked = Object.hasOwn(scenario, 'islocked');
  const modernLocked = Object.hasOwn(scenario, 'isLocked');
  if (
    (!legacyValid && !modernValid) ||
    (!legacyLocked && !modernLocked) ||
    (legacyValid && typeof scenario.isinvalid !== 'boolean') ||
    (modernValid && typeof scenario.isValid !== 'boolean') ||
    (legacyLocked && typeof scenario.islocked !== 'boolean') ||
    (modernLocked && typeof scenario.isLocked !== 'boolean')
  ) fail('make_scenario_shape_invalid');

  const isValid = legacyValid ? !scenario.isinvalid : scenario.isValid;
  const isLocked = legacyLocked ? scenario.islocked : scenario.isLocked;
  if (
    (legacyValid && modernValid && scenario.isValid !== !scenario.isinvalid) ||
    (legacyLocked && modernLocked && scenario.isLocked !== scenario.islocked)
  ) fail('make_scenario_shape_invalid');
  if (
    scenario.id !== 9652631 ||
    scenario.isActive !== false ||
    isValid !== true ||
    isLocked !== false ||
    scenario.dlqCount !== 0 ||
    scenario.allDlqCount !== 0
  ) fail('make_scenario_state_invalid');

  if (
    !blueprint ||
    typeof blueprint !== 'object' ||
    Array.isArray(blueprint) ||
    !Array.isArray(blueprint.flow)
  ) {
    fail('make_blueprint_invalid');
  }
  return {
    id: scenario.id,
    isActive: scenario.isActive,
    isValid,
    isLocked,
    dlqCount: scenario.dlqCount,
    allDlqCount: scenario.allDlqCount,
    blueprint,
  };
}

function supabaseHeaders() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const anon = process.env.SUPABASE_ANON_KEY ?? '';
  if (!secret) fail('supabase_service_role_missing');
  return secret.startsWith('sb_secret_')
    ? { apikey: secret }
    : { apikey: anon, Authorization: `Bearer ${secret}` };
}

export function selectFreshOutlookCandidates(rows, claims, allowlist, leadHashSecret) {
  if (!Array.isArray(rows) || !Array.isArray(claims) || !Array.isArray(allowlist)) {
    fail('internal_candidate_shape_invalid');
  }
  const allowed = new Set(allowlist);
  if (
    allowlist.length < 1 ||
    allowlist.length > 4 ||
    allowed.size !== allowlist.length ||
    allowlist.some((value) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
  ) fail('pilot_allowlist_invalid');
  if (Buffer.byteLength(leadHashSecret ?? '', 'utf8') < 32) fail('lead_hash_secret_invalid');

  const candidates = new Map();
  const counts = {};
  let completedCount = 0;
  for (const resource of RESOURCES) {
    const valid = rows.filter((row) =>
      row?.form_type === resource &&
      row?.lead_magnet === resource &&
      typeof row?.lead_id === 'string' &&
      allowed.has(row.lead_id) &&
      typeof row?.payload?.contact?.email === 'string' &&
      typeof row?.payload?.contact?.name === 'string' &&
      row.payload.contact.name.trim().length > 0 &&
      row.payload.contact.name.length <= 500 &&
      createHmac('sha256', leadHashSecret)
        .update(row.payload.contact.email.trim().toLowerCase(), 'utf8')
        .digest('hex') === row.lead_id &&
      row?.submission_id === `${FRESH_SUBMISSION_PREFIX}${resource}_${row.lead_id}` &&
      row?.delivery_status === 'dead_letter' &&
      (row?.email_delivery_status === 'pending' || row?.email_delivery_status === 'email_sent') &&
      row?.accepted_by_make_at === null &&
      row?.ai_summary === null &&
      row?.payload?.form_type === resource &&
      row?.payload?.lead_magnet === resource &&
      row?.payload?.submission_id === row?.submission_id &&
      row?.payload?.lead_id === row?.lead_id &&
      row?.payload?.delivery_status === 'dead_letter' &&
      row?.payload?.email_delivery_status === 'pending' &&
      row?.payload?.consent?.privacy_accepted === true &&
      (resource !== 'calculator' || (
        row?.payload?.credit_estimate?.amount === 420 &&
        row?.payload?.credit_estimate?.currency === 'EUR' &&
        row?.payload?.credit_estimate?.calculation_mode === 'fp_quota' &&
        row?.payload?.credit_estimate?.calculation_source === 'minimum_credit' &&
        row?.payload?.credit_estimate?.applied_percentage === 100 &&
        row?.payload?.credit_estimate?.requires_manual_review === false
      )) &&
      (resource !== 'interactive_checklist' || (
        row?.payload?.interactive_checklist?.score === 5 &&
        row?.payload?.interactive_checklist?.risk_level === 'medium' &&
        JSON.stringify(Object.keys(row?.payload?.interactive_checklist?.answers ?? {}).sort()) ===
          JSON.stringify(Object.keys(V4_INTERACTIVE_ANSWERS).sort()) &&
        Object.entries(V4_INTERACTIVE_ANSWERS).every(
          ([key, answer]) => row?.payload?.interactive_checklist?.answers?.[key] === answer,
        )
      )),
    );
    counts[resource] = valid.length;
    if (valid.length !== 1) fail('fresh_candidate_set_invalid');
    const row = valid[0];
    const matchingClaims = claims.filter((claim) =>
      claim?.submission_id === row.submission_id && claim?.resource === resource,
    );
    if (row.email_delivery_status === 'pending') {
      if (matchingClaims.length !== 0) fail('fresh_candidate_claim_state_invalid');
      candidates.set(resource, row);
    } else {
      if (matchingClaims.length !== 1) fail('fresh_candidate_claim_state_invalid');
      completedCount += 1;
    }
  }
  const rowIdentities = new Set(rows.map((row) => row?.lead_id));
  if (
    rows.length !== 4 ||
    rowIdentities.size !== 1 ||
    claims.length !== completedCount ||
    candidates.size < 1
  ) {
    fail('fresh_candidate_set_invalid');
  }
  return {
    allowlistCount: allowlist.length,
    counts,
    completedCount,
    pendingCount: candidates.size,
    candidates,
  };
}

async function internalCandidates() {
  const baseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const allowlist = (process.env.TRANSACTIONAL_PILOT_ALLOWLIST_LEAD_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!baseUrl) fail('supabase_url_missing');

  const query = new URLSearchParams({
    select: 'submission_id,lead_id,form_type,lead_magnet,delivery_status,email_delivery_status,accepted_by_make_at,ai_summary,payload',
    submission_id: `like.${FRESH_SUBMISSION_PREFIX}*`,
    form_type: 'in.(calculator,interactive_checklist,checklist,webinar)',
    limit: '8',
  });
  const response = await fetch(`${baseUrl}/rest/v1/leads?${query}`, {
    method: 'GET',
    headers: supabaseHeaders(),
  });
  if (!response.ok) fail(`supabase_status_${response.status}`);
  const claimQuery = new URLSearchParams({
    select: 'submission_id,resource',
    submission_id: `like.${FRESH_SUBMISSION_PREFIX}*`,
    limit: '8',
  });
  const claimResponse = await fetch(`${baseUrl}/rest/v1/transactional_intake_claims?${claimQuery}`, {
    method: 'GET',
    headers: supabaseHeaders(),
  });
  if (!claimResponse.ok) fail(`supabase_claims_status_${claimResponse.status}`);
  return selectFreshOutlookCandidates(
    await response.json(),
    await claimResponse.json(),
    allowlist,
    process.env.LEAD_HASH_SECRET ?? '',
  );
}

function assertTarget35Scenario(scenario, blueprint) {
  const normalized = normalizeTarget35Scenario(scenario, blueprint);
  const report = validateTransactionalMakeOutlookAudit({
    schema_version: 'fundae-make-outlook-manual-reconcile-v4',
    scenario: normalized,
    blueprint: normalized.blueprint,
    live_interfaces: TARGET35_INTERFACES,
  });
  if (!report.ok || report.summary?.moduleCount !== 35) fail('make_target35_mismatch');
  return report;
}

async function makeRuntimeContext(expectedEnabled) {
  const token = (process.env.MAKE_API_TOKEN ?? '').trim();
  if (!token) fail('make_token_missing');
  const headers = { Authorization: `Token ${token}` };
  const [authResponse, scenarioResponse, blueprintResponse, hookResponse, pingResponse] = await Promise.all([
    fetch(`${MAKE_API_BASE}/users/me/current-authorization`, { headers }),
    fetch(`${MAKE_API_BASE}/scenarios/9652631`, { headers }),
    fetch(`${MAKE_API_BASE}/scenarios/9652631/blueprint`, { headers }),
    fetch(`${MAKE_API_BASE}/hooks/${MAKE_HOOK_ID}`, { headers }),
    fetch(`${MAKE_API_BASE}/hooks/${MAKE_HOOK_ID}/ping`, { headers }),
  ]);
  if (!authResponse.ok) fail(`make_authorization_status_${authResponse.status}`);
  if (!scenarioResponse.ok) fail(`make_scenario_status_${scenarioResponse.status}`);
  if (!blueprintResponse.ok) fail(`make_blueprint_status_${blueprintResponse.status}`);
  if (!hookResponse.ok) fail(`make_hook_status_${hookResponse.status}`);
  if (!pingResponse.ok) fail(`make_ping_status_${pingResponse.status}`);
  const authorization = await authResponse.json();
  const scenarioBody = await scenarioResponse.json();
  const blueprintBody = await blueprintResponse.json();
  const hookBody = await hookResponse.json();
  const ping = await pingResponse.json();
  assertExactMakeScopes(authorization);
  const scenario = unwrapMakeScenario(scenarioBody);
  const blueprint = unwrapMakeBlueprint(blueprintBody);
  const hook = unwrapMakeHook(hookBody);
  assertMakeRuntimeState({ scenario, hook, ping, expectedEnabled });
  const target35 = assertTarget35Scenario(scenario, blueprint);
  const hookUrl = makeHookAddress({ address: hook.url });
  const pingAddress = makeHookAddress(ping);
  if (hookUrl !== pingAddress) fail('make_hook_address_mismatch');
  return { scenario, hook, ping, hookUrl: pingAddress, target35 };
}

async function makeHookUrl() {
  const context = await makeRuntimeContext(true);
  return context.hookUrl;
}

async function makeStatePrecheck(expectedEnabled) {
  const { scenario, hook, hookUrl, target35 } = await makeRuntimeContext(expectedEnabled);
  const result = {
    scopes_exact: true,
    scenario_off: scenario.isActive === false,
    hook_state_exact: hook.enabled === expectedEnabled,
    queue_zero: hook.queueCount === 0,
    binding_exact: String(hook.scenarioId) === '9652631',
    url_present: hookUrl.startsWith('https://'),
    target35_exact: target35.ok === true && target35.summary.moduleCount === 35,
  };
  const gate = Object.values(result).every(Boolean) ? 'PASS' : 'FAIL';
  process.stdout.write(JSON.stringify({ gate, ...result }));
  if (gate !== 'PASS') process.exitCode = 2;
}

async function precheck() {
  const { allowlistCount, counts } = await internalCandidates();
  const gate = RESOURCES.every((resource) => counts[resource] > 0) ? 'PASS' : 'FAIL';
  process.stdout.write(JSON.stringify({ allowlist_count: allowlistCount, resource_counts: counts, gate }));
  if (gate !== 'PASS') process.exitCode = 2;
}

export function signedFreshHookRequest(candidate, secret, now = Date.now()) {
  if (!candidate?.payload || Buffer.byteLength(secret ?? '', 'utf8') < 32) fail('hmac_secret_invalid');
  const rawBody = JSON.stringify(candidate.payload);
  const timestamp = String(Math.floor(now / 1000));
  const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  return { rawBody, timestamp, signature };
}

export function freshHookRequestInit(request) {
  return {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
    headers: {
      'content-type': 'application/json',
      'x-make-signature': request.signature,
      'x-make-timestamp': request.timestamp,
    },
    body: request.rawBody,
  };
}

export async function sendFreshResource(resource, confirmation, dependencies = {}) {
  if (!RESOURCES.includes(resource)) fail('resource_invalid');
  if (confirmation !== SEND_CONFIRMATION) fail('send_confirmation_required');
  const secret = process.env.MAKE_WEBHOOK_SECRET ?? '';
  const loadCandidates = dependencies.internalCandidates ?? internalCandidates;
  const loadHookUrl = dependencies.makeHookUrl ?? makeHookUrl;
  const post = dependencies.fetch ?? fetch;
  const { candidates } = await loadCandidates();
  const candidate = candidates.get(resource);
  if (!candidate) fail('internal_candidate_missing');
  const request = signedFreshHookRequest(candidate, secret);
  const hookUrl = await loadHookUrl();
  const response = await post(hookUrl, freshHookRequestInit(request));
  return { resource, accepted_by_hook: response.ok, http_status: response.status };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [command, resource, confirmation] = process.argv.slice(2);
  try {
    if (command === 'precheck') await precheck();
    else if (command === 'make-ready') await makeStatePrecheck(true);
    else if (command === 'make-close-precheck') await makeStatePrecheck(false);
    else if (command === 'send') {
      const result = await sendFreshResource(resource, confirmation);
      process.stdout.write(JSON.stringify(result));
      if (!result.accepted_by_hook) process.exitCode = 3;
    }
    else fail('usage_invalid');
  } catch (error) {
    process.stderr.write(`GATE_B_FAIL:${error instanceof Error ? error.message : 'unknown'}`);
    process.exitCode = 1;
  }
}
