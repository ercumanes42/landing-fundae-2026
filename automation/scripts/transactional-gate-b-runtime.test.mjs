import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  normalizeTarget35Scenario,
  selectFreshOutlookCandidates,
  sendFreshResource,
  signedFreshHookRequest,
} from './transactional-gate-b-runtime.mjs';

const resources = ['calculator', 'interactive_checklist', 'checklist', 'webinar'];
const leadHashSecret = 'lead-hash-test-secret-that-is-at-least-32-bytes';
const email = 'never-output@example.test';
const computedIdentity = createHmac('sha256', leadHashSecret).update(email).digest('hex');
const computedAllowlist = [computedIdentity, 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)];

function rows(prefix = 'pilot_outlook_e2e_v3_') {
  return resources.map((resource) => {
    const submissionId = `${prefix}${resource}_${computedIdentity}`;
    return {
      submission_id: submissionId,
      lead_id: computedIdentity,
      form_type: resource,
      lead_magnet: resource,
      delivery_status: 'dead_letter',
      email_delivery_status: 'pending',
      accepted_by_make_at: null,
      ai_summary: null,
      payload: {
        submission_id: submissionId,
        lead_id: computedIdentity,
        form_type: resource,
        lead_magnet: resource,
        delivery_status: 'dead_letter',
        email_delivery_status: 'pending',
        contact: { name: 'Internal pilot', email },
        consent: { privacy_accepted: true },
        ...(resource === 'calculator' ? {
          credit_estimate: {
            amount: 420, currency: 'EUR', calculation_mode: 'fp_quota',
            calculation_source: 'minimum_credit', applied_percentage: 100,
            requires_manual_review: false,
          },
        } : {}),
        ...(resource === 'interactive_checklist' ? {
          interactive_checklist: {
            score: 5,
            risk_level: 'medium',
            answers: {
              company_size: '1-5', credit_visibility: 'No todavía',
              training_fit: 'Tenemos una idea general', planning_process: 'A veces con poco margen',
              rlpt_process: 'No existe RLPT', evidence_tracking: 'Solo en algunos cursos',
              documentation_control: 'Sí, con un sistema claro',
              cofinancing: 'No aplica: 1-5 personas', review_timing: 'Esta semana',
            },
          },
        } : {}),
      },
    };
  });
}

test('combines exact scenario state with the separately unwrapped blueprint object', () => {
  const blueprint = {
    flow: [],
    metadata: { instant: true, scenario: { sequential: true, confidential: true } },
  };
  const normalized = normalizeTarget35Scenario({
    id: 9652631,
    isActive: false,
    isinvalid: false,
    islocked: false,
    dlqCount: 0,
    allDlqCount: 0,
  }, blueprint);
  assert.deepEqual(normalized, {
    id: 9652631,
    isActive: false,
    isValid: true,
    isLocked: false,
    dlqCount: 0,
    allDlqCount: 0,
    blueprint,
  });

  assert.deepEqual(normalizeTarget35Scenario({
    id: 9652631,
    isActive: false,
    isValid: true,
    isLocked: false,
    dlqCount: 0,
    allDlqCount: 0,
  }, blueprint), normalized);
});

test('rejects legacy, malformed and semantically invalid live scenario shapes', () => {
  for (const scenario of [
    null,
    { isinvalid: false, islocked: false },
    { isinvalid: true, islocked: false },
    { isinvalid: false },
    { isinvalid: 'false', islocked: false },
    {
      blueprint: { flow: [] },
      isinvalid: false,
      isValid: false,
      islocked: false,
      isLocked: false,
    },
    {
      blueprint: { flow: [] },
      isinvalid: false,
      isValid: true,
      islocked: false,
      isLocked: true,
    },
  ]) {
    assert.throws(
      () => normalizeTarget35Scenario(scenario, { flow: [], metadata: {}, name: 'Target35' }),
      /make_(?:scenario_(?:shape|state)|blueprint)_invalid/,
    );
  }
  const live = {
    id: 9652631,
    isActive: false,
    isinvalid: false,
    islocked: false,
    dlqCount: 0,
    allDlqCount: 0,
  };
  for (const blueprint of [null, 'string', [], {}, { flow: {} }]) {
    assert.throws(() => normalizeTarget35Scenario(live, blueprint), /make_blueprint_invalid/);
  }
  assert.throws(
    () => normalizeTarget35Scenario({ ...live, blueprint: { flow: [] } }, { flow: [] }),
    /make_scenario_shape_invalid/,
  );
});

test('selects exactly the fresh v4 cohort and one deliverable inert row per resource', () => {
  const result = selectFreshOutlookCandidates(rows(), [], computedAllowlist, leadHashSecret);
  assert.deepEqual(result.counts, {
    calculator: 1,
    interactive_checklist: 1,
    checklist: 1,
    webinar: 1,
  });
  assert.equal(result.candidates.size, 4);
  assert.equal(result.completedCount, 0);
  assert.equal(result.pendingCount, 4);
  assert.equal(new Set([...result.candidates.values()].map((row) => row.lead_id)).size, 1);
});

test('candidate selection rejects weak, placeholder and whitespace-drift lead secrets', () => {
  for (const secret of [
    'k'.repeat(31),
    'replace-with-a-long-random-secret-value',
    ` ${'k'.repeat(32)}`,
    `${'k'.repeat(32)} `,
  ]) {
    assert.throws(
      () => selectFreshOutlookCandidates(rows(), [], computedAllowlist, secret),
      /lead_hash_secret_invalid/,
    );
  }
});

test('accepts a completed calculator with its claim and keeps only pending resources sendable', async () => {
  const sequential = rows();
  sequential[0] = { ...sequential[0], email_delivery_status: 'email_sent' };
  const claims = [{ submission_id: sequential[0].submission_id, resource: 'calculator' }];
  const result = selectFreshOutlookCandidates(sequential, claims, computedAllowlist, leadHashSecret);
  assert.equal(result.completedCount, 1);
  assert.equal(result.pendingCount, 3);
  assert.equal(result.candidates.has('calculator'), false);
  assert.equal(result.candidates.has('interactive_checklist'), true);

  const previousSecret = process.env.MAKE_WEBHOOK_SECRET;
  process.env.MAKE_WEBHOOK_SECRET = 'runtime-test-secret-that-is-at-least-32-bytes';
  let hookLookups = 0;
  let posts = 0;
  const dependencies = {
    async internalCandidates() { return result; },
    async makeHookUrl() { hookLookups += 1; return 'https://hook.example.test/private'; },
    async fetch() { posts += 1; return new Response(null, { status: 200 }); },
  };
  try {
    await assert.rejects(
      () => sendFreshResource('calculator', 'POST_ONCE_FRESH_V4', dependencies),
      /internal_candidate_missing/,
    );
    assert.equal(hookLookups, 0);
    assert.equal(posts, 0);
    const sent = await sendFreshResource('interactive_checklist', 'POST_ONCE_FRESH_V4', dependencies);
    assert.deepEqual(sent, {
      resource: 'interactive_checklist', accepted_by_hook: true, http_status: 200,
    });
    assert.equal(hookLookups, 1);
    assert.equal(posts, 1);
  } finally {
    if (previousSecret === undefined) delete process.env.MAKE_WEBHOOK_SECRET;
    else process.env.MAKE_WEBHOOK_SECRET = previousSecret;
  }
});

test('rejects completed-without-claim, pending-with-claim and failed states', () => {
  const completed = rows();
  completed[0] = { ...completed[0], email_delivery_status: 'email_sent' };
  assert.throws(
    () => selectFreshOutlookCandidates(completed, [], computedAllowlist, leadHashSecret),
    /fresh_candidate_claim_state_invalid/,
  );

  const pending = rows();
  assert.throws(
    () => selectFreshOutlookCandidates(pending, [{ submission_id: pending[0].submission_id, resource: 'calculator' }], computedAllowlist, leadHashSecret),
    /fresh_candidate_claim_state_invalid/,
  );

  const failed = rows();
  failed[0] = { ...failed[0], email_delivery_status: 'failed' };
  assert.throws(
    () => selectFreshOutlookCandidates(failed, [], computedAllowlist, leadHashSecret),
    /fresh_candidate_set_invalid/,
  );
});

test('rejects prior, duplicate, partial, cross-identity and non-inert cohorts', () => {
  const invalid = [
    rows('pilot_outlook_e2e_v1_'),
    [...rows(), rows()[0]],
    rows().slice(0, 3),
    rows().map((row, index) => index === 3 ? { ...row, lead_id: 'b'.repeat(64) } : row),
    rows().map((row, index) => index === 2 ? { ...row, delivery_status: 'queued' } : row),
  ];
  for (const candidateRows of invalid) {
    assert.throws(
      () => selectFreshOutlookCandidates(candidateRows, [], computedAllowlist, leadHashSecret),
      /fresh_candidate_set_invalid/,
    );
  }
});

test('rejects identity, privacy and package-content drift before any hook operation', () => {
  for (const candidateRows of [
    rows().map((row, index) => index === 0
      ? { ...row, payload: { ...row.payload, contact: { email: 'changed@example.test' } } }
      : row),
    rows().map((row, index) => index === 1
      ? { ...row, payload: { ...row.payload, consent: { privacy_accepted: false } } }
      : row),
    rows().map((row, index) => index === 0
      ? { ...row, payload: { ...row.payload, credit_estimate: undefined } }
      : row),
    rows().map((row, index) => index === 1
      ? { ...row, payload: { ...row.payload, interactive_checklist: undefined } }
      : row),
  ]) {
    assert.throws(
      () => selectFreshOutlookCandidates(candidateRows, [], computedAllowlist, leadHashSecret),
      /fresh_candidate_set_invalid/,
    );
  }
});

test('builds one deterministic HMAC request without exposing values in a summary', () => {
  const candidate = rows()[0];
  const secret = 'runtime-test-secret-that-is-at-least-32-bytes';
  const request = signedFreshHookRequest(candidate, secret, 1_700_000_000_000);
  assert.equal(request.timestamp, '1700000000');
  assert.equal(
    request.signature,
    createHmac('sha256', secret).update(`${request.timestamp}.${request.rawBody}`, 'utf8').digest('hex'),
  );
  const summary = { resource: candidate.form_type, accepted_by_hook: true, http_status: 200 };
  assert.doesNotMatch(JSON.stringify(summary), /@|submission|lead_id|payload|signature|capability/i);
});

test('send guard and target35 failure occur before the single hook POST', async () => {
  const previousSecret = process.env.MAKE_WEBHOOK_SECRET;
  process.env.MAKE_WEBHOOK_SECRET = 'runtime-test-secret-that-is-at-least-32-bytes';
  let posts = 0;
  const dependencies = {
    async internalCandidates() {
      return selectFreshOutlookCandidates(rows(), [], computedAllowlist, leadHashSecret);
    },
    async makeHookUrl() {
      throw new Error('make_target35_mismatch');
    },
    async fetch() {
      posts += 1;
      return new Response(null, { status: 200 });
    },
  };
  try {
    await assert.rejects(
      () => sendFreshResource('calculator', 'WRONG_CONFIRMATION', dependencies),
      /send_confirmation_required/,
    );
    await assert.rejects(
      () => sendFreshResource('calculator', 'POST_ONCE_FRESH_V3', dependencies),
      /send_confirmation_required/,
    );
    await assert.rejects(
      () => sendFreshResource('calculator', 'POST_ONCE_FRESH_V4', dependencies),
      /make_target35_mismatch/,
    );
    assert.equal(posts, 0);
  } finally {
    if (previousSecret === undefined) delete process.env.MAKE_WEBHOOK_SECRET;
    else process.env.MAKE_WEBHOOK_SECRET = previousSecret;
  }
});

test('send performs exactly one no-redirect timeout-bound POST and returns only HTTP metadata', async () => {
  const previousSecret = process.env.MAKE_WEBHOOK_SECRET;
  process.env.MAKE_WEBHOOK_SECRET = 'runtime-test-secret-that-is-at-least-32-bytes';
  let posts = 0;
  try {
    const summary = await sendFreshResource('calculator', 'POST_ONCE_FRESH_V4', {
      async internalCandidates() {
        return selectFreshOutlookCandidates(rows(), [], computedAllowlist, leadHashSecret);
      },
      async makeHookUrl() {
        return 'https://hook.eu2.make.com/private-path';
      },
      async fetch(_url, init) {
        posts += 1;
        assert.equal(init.redirect, 'error');
        assert.ok(init.signal instanceof AbortSignal);
        return new Response(null, { status: 200 });
      },
    });
    assert.equal(posts, 1);
    assert.deepEqual(summary, { resource: 'calculator', accepted_by_hook: true, http_status: 200 });
    assert.doesNotMatch(JSON.stringify(summary), /@|submission|lead_id|payload|signature|capability/i);
  } finally {
    if (previousSecret === undefined) delete process.env.MAKE_WEBHOOK_SECRET;
    else process.env.MAKE_WEBHOOK_SECRET = previousSecret;
  }
});
