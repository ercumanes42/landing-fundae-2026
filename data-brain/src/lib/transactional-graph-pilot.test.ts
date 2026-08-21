import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runTransactionalGraphPilot,
  deriveTransactionalGraphPilotActorHash,
  buildTransactionalGraphPilotGrantRequest,
  hashTransactionalGraphPilotAuthorizationId,
  TRANSACTIONAL_GRAPH_PILOT_LIVE_CONFIRMATION,
  type TransactionalGraphPilotLedgerRow,
} from './transactional-graph-pilot';

const HASH = 'a'.repeat(64);
const SECRET = 'pilot-capability-' + 's'.repeat(40);
const RUN_ID = '018f1e20-7b5d-7d20-8c3a-4b5c6d7e8f90';
const request = (overrides: Record<string, unknown> = {}) => ({
  schema_version: 'fundae-transactional-graph-pilot-v1',
  run_id: RUN_ID,
  authorization_id: '018f1e20-7b5d-7d20-8c3a-4b5c6d7e8f91',
  submissions: [
    { resource: 'calculator', submission_id: 'pilot_calculator_01' },
    { resource: 'interactive_checklist', submission_id: 'pilot_interactive_01' },
    { resource: 'checklist', submission_id: 'pilot_checklist_01' },
    { resource: 'webinar', submission_id: 'pilot_webinar_01' },
  ],
  ...overrides,
});

test('authorization identity uses stable domain-separated hashes and normalizes UUID case', () => {
  const authorizationId = '018f1e20-7b5d-7d20-8c3a-4b5c6d7e8f91';
  const nonceHash = hashTransactionalGraphPilotAuthorizationId(authorizationId);
  const actorHash = deriveTransactionalGraphPilotActorHash(SECRET, authorizationId);
  assert.match(nonceHash, /^[a-f0-9]{64}$/);
  assert.match(actorHash, /^[a-f0-9]{64}$/);
  assert.notEqual(nonceHash, actorHash);
  assert.equal(
    hashTransactionalGraphPilotAuthorizationId(authorizationId.toUpperCase()),
    nonceHash,
  );
});

test('grant request is hash-only, scope-bound and never echoes the authorization UUID', () => {
  const authorizationId = request().authorization_id;
  const grant = buildTransactionalGraphPilotGrantRequest(request(), {
    expectedLeadIdHash: HASH,
    capabilitySecret: SECRET,
    ttlSeconds: 600,
    now: new Date('2026-08-19T20:00:00.000Z'),
  });
  assert.equal(grant.run_id, RUN_ID);
  assert.equal(grant.allowed_lead_id, HASH);
  assert.equal(grant.max_ttl_seconds, 600);
  assert.equal(grant.expires_at, '2026-08-19T20:12:00.000Z');
  assert.equal(grant.submission_ids.length, 4);
  assert.match(grant.actor_hash, /^[a-f0-9]{64}$/);
  assert.match(grant.authorization_nonce_hash, /^[a-f0-9]{64}$/);
  assert.match(grant.submission_set_hash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(grant), new RegExp(authorizationId, 'i'));
});

function row(resource: TransactionalGraphPilotLedgerRow['resource'], index: number): TransactionalGraphPilotLedgerRow {
  const hex = (index + 1).toString(16);
  return {
    resource,
    status: 'confirmed_sent',
    dispatchIdHash: hex.repeat(64),
    reservationIdHash: ((index + 5).toString(16)).repeat(64),
    draftImmutableIdHash: ((index + 9).toString(16)).repeat(64),
    internetMessageIdHash: ((index + 11).toString(16)).repeat(64),
    evidenceHash: ((index + 12).toString(16)).repeat(64),
  };
}

const rows = [
  row('calculator', 0),
  row('interactive_checklist', 1),
  row('checklist', 2),
  row('webinar', 3),
];

test('dry-run validates exactly four resources without dispatch or control mutation', async () => {
  let executed = 0;
  let finished = 0;
  const summary = await runTransactionalGraphPilot(request(), {
    live: false,
    liveEnabled: false,
    expectedLeadIdHash: HASH,
    capabilitySecret: SECRET,
    runId: RUN_ID,
  }, {
    prepare: async (input) => {
      assert.equal(input.apply, false);
      assert.equal(input.expectedLeadIdHash, HASH);
      assert.equal(input.submissions.length, 4);
      assert.equal(input.ttlSeconds, 600);
      assert.match(input.actorHash, /^[a-f0-9]{64}$/);
      return { accepted: true, reasonCode: 'validated', runId: RUN_ID, candidateCount: 4, outboundOff: true };
    },
    executeOnce: async () => {
      executed += 1;
      throw new Error('must not execute');
    },
    readLedger: async () => [],
    finish: async () => {
      finished += 1;
      throw new Error('must not finish');
    },
    emergencyHalt: async () => {
      throw new Error('must not halt');
    },
  });
  assert.equal(executed, 0);
  assert.equal(finished, 0);
  assert.deepEqual(summary, {
    status: 'validated',
    mode: 'dry_run',
    run_id_hash: 'b5b87976687df143db79cfba9ce10f8609641537898e9d5ad0144632b1e5e810',
    resources: 4,
    confirmed: 0,
    outbound_off: true,
    evidence: [],
  });
});

test('live mode requires both the dedicated switch and exact direct confirmation', async () => {
  const dependencies = {
    prepare: async () => ({ accepted: true, reasonCode: 'started', runId: RUN_ID, candidateCount: 4, outboundOff: false }),
    executeOnce: async () => ({ state: 'empty' as const, reasonCode: 'empty', dispatchId: null, reservationId: null }),
    readLedger: async () => [],
    finish: async () => ({ accepted: true, reasonCode: 'halted', runId: RUN_ID, candidateCount: 4, outboundOff: true }),
    emergencyHalt: async () => ({ accepted: true, reasonCode: 'halted', runId: RUN_ID, candidateCount: 4, outboundOff: true }),
  };
  await assert.rejects(
    runTransactionalGraphPilot(request(), {
      live: true, liveEnabled: false, expectedLeadIdHash: HASH, capabilitySecret: SECRET, runId: RUN_ID,
    }, dependencies),
    /pilot_live_authorization_required/,
  );
  await assert.rejects(
    runTransactionalGraphPilot(request({ confirmation: 'WRONG' }), {
      live: true, liveEnabled: true, expectedLeadIdHash: HASH, capabilitySecret: SECRET, runId: RUN_ID,
    }, dependencies),
    /pilot_live_authorization_required/,
  );
});

test('live mode confirms four unique ledger rows and always closes outbound', async () => {
  let dispatches = 0;
  let finishOutcome = '';
  const summary = await runTransactionalGraphPilot(request({
    confirmation: TRANSACTIONAL_GRAPH_PILOT_LIVE_CONFIRMATION,
  }), {
    live: true,
    liveEnabled: true,
    expectedLeadIdHash: HASH,
    capabilitySecret: SECRET,
    runId: RUN_ID,
  }, {
    prepare: async (input) => {
      assert.equal(input.apply, true);
      return { accepted: true, reasonCode: 'started', runId: RUN_ID, candidateCount: 4, outboundOff: false };
    },
    executeOnce: async () => {
      dispatches += 1;
      return {
        state: 'confirmed_sent',
        reasonCode: 'confirmed_sent',
        dispatchId: `018f1e20-7b5d-7d20-8c3a-4b5c6d7e8f9${dispatches}`,
        reservationId: `028f1e20-7b5d-7d20-8c3a-4b5c6d7e8f9${dispatches}`,
      };
    },
    readLedger: async () => {
      assert.equal(dispatches, 4);
      return rows;
    },
    finish: async (input) => {
      finishOutcome = input.outcome;
      assert.match(input.evidenceHash, /^[a-f0-9]{64}$/);
      return { accepted: true, reasonCode: 'halted', runId: RUN_ID, candidateCount: 4, outboundOff: true };
    },
    emergencyHalt: async () => {
      throw new Error('emergency halt should not be needed');
    },
  });
  assert.equal(dispatches, 4);
  assert.equal(finishOutcome, 'completed');
  assert.equal(summary.status, 'confirmed_sent');
  assert.equal(summary.confirmed, 4);
  assert.equal(summary.outbound_off, true);
  assert.deepEqual(summary.evidence, rows);
  assert.doesNotMatch(JSON.stringify(summary), /pilot_(calculator|webinar)_01/);
});

test('first non-confirmed result stops the sequence and closes the pilot as aborted', async () => {
  let dispatches = 0;
  let finishOutcome = '';
  await assert.rejects(
    runTransactionalGraphPilot(request({
      confirmation: TRANSACTIONAL_GRAPH_PILOT_LIVE_CONFIRMATION,
    }), {
      live: true, liveEnabled: true, expectedLeadIdHash: HASH, capabilitySecret: SECRET, runId: RUN_ID,
    }, {
      prepare: async () => ({ accepted: true, reasonCode: 'started', runId: RUN_ID, candidateCount: 4, outboundOff: false }),
      executeOnce: async () => {
        dispatches += 1;
        return { state: 'ambiguous_halted', reasonCode: 'ambiguous', dispatchId: RUN_ID, reservationId: RUN_ID };
      },
      readLedger: async () => [],
      finish: async (input) => {
        finishOutcome = input.outcome;
        assert.match(input.evidenceHash, /^[a-f0-9]{64}$/);
        return { accepted: true, reasonCode: 'halted', runId: RUN_ID, candidateCount: 4, outboundOff: true };
      },
      emergencyHalt: async () => {
        throw new Error('not needed');
      },
    }),
    /pilot_dispatch_ambiguous/,
  );
  assert.equal(dispatches, 1);
  assert.equal(finishOutcome, 'halted');
});

test('finish failure invokes emergency halt and both failures remain fail-closed', async () => {
  let emergencyCalls = 0;
  const base = {
    prepare: async () => ({ accepted: true, reasonCode: 'started', runId: RUN_ID, candidateCount: 4, outboundOff: false }),
    executeOnce: async () => ({ state: 'ambiguous_halted' as const, reasonCode: 'ambiguous', dispatchId: RUN_ID, reservationId: RUN_ID }),
    readLedger: async () => [],
    finish: async () => {
      throw new Error('finish unavailable');
    },
  };
  await assert.rejects(
    runTransactionalGraphPilot(request({ confirmation: TRANSACTIONAL_GRAPH_PILOT_LIVE_CONFIRMATION }), {
      live: true, liveEnabled: true, expectedLeadIdHash: HASH, capabilitySecret: SECRET, runId: RUN_ID,
    }, {
      ...base,
      emergencyHalt: async () => {
        emergencyCalls += 1;
        return { accepted: true, reasonCode: 'halted', runId: RUN_ID, candidateCount: 4, outboundOff: true };
      },
    }),
    /pilot_dispatch_ambiguous/,
  );
  assert.equal(emergencyCalls, 1);

  await assert.rejects(
    runTransactionalGraphPilot(request({ confirmation: TRANSACTIONAL_GRAPH_PILOT_LIVE_CONFIRMATION }), {
      live: true, liveEnabled: true, expectedLeadIdHash: HASH, capabilitySecret: SECRET, runId: RUN_ID,
    }, {
      ...base,
      emergencyHalt: async () => ({ accepted: false, reasonCode: 'unavailable', runId: RUN_ID, candidateCount: 4, outboundOff: false }),
    }),
    /pilot_finally_halt_failed/,
  );
});

test('ambiguous live start always invokes emergency halt before returning an error', async () => {
  let emergencyCalls = 0;
  await assert.rejects(
    runTransactionalGraphPilot(request({ confirmation: TRANSACTIONAL_GRAPH_PILOT_LIVE_CONFIRMATION }), {
      live: true, liveEnabled: true, expectedLeadIdHash: HASH, capabilitySecret: SECRET, runId: RUN_ID,
    }, {
      prepare: async () => {
        throw new Error('response lost after start');
      },
      executeOnce: async () => {
        throw new Error('must not execute');
      },
      readLedger: async () => [],
      finish: async () => {
        throw new Error('must not finish');
      },
      emergencyHalt: async () => {
        emergencyCalls += 1;
        return { accepted: true, reasonCode: 'halted', runId: null, candidateCount: 0, outboundOff: true };
      },
    }),
    /pilot_prepare_unavailable/,
  );
  assert.equal(emergencyCalls, 1);

  await assert.rejects(
    runTransactionalGraphPilot(request({ confirmation: TRANSACTIONAL_GRAPH_PILOT_LIVE_CONFIRMATION }), {
      live: true, liveEnabled: true, expectedLeadIdHash: HASH, capabilitySecret: SECRET, runId: RUN_ID,
    }, {
      prepare: async () => {
        throw new Error('response lost after start');
      },
      executeOnce: async () => {
        throw new Error('must not execute');
      },
      readLedger: async () => [],
      finish: async () => {
        throw new Error('must not finish');
      },
      emergencyHalt: async () => {
        throw new Error('halt unavailable');
      },
    }),
    /pilot_finally_halt_failed/,
  );
});

test('rejects duplicate, missing or extra cohort members before dependencies run', async () => {
  let prepareCalls = 0;
  const dependencies = {
    prepare: async () => {
      prepareCalls += 1;
      throw new Error('must not run');
    },
    executeOnce: async () => ({ state: 'empty' as const, reasonCode: 'empty', dispatchId: null, reservationId: null }),
    readLedger: async () => [],
    finish: async () => ({ accepted: false, reasonCode: 'unused', runId: null, candidateCount: 0, outboundOff: true }),
    emergencyHalt: async () => ({ accepted: false, reasonCode: 'unused', runId: null, candidateCount: 0, outboundOff: true }),
  };
  const duplicate = request({
    submissions: [
      { resource: 'calculator', submission_id: 'same_submission' },
      { resource: 'calculator', submission_id: 'same_submission' },
      { resource: 'checklist', submission_id: 'pilot_checklist_01' },
      { resource: 'webinar', submission_id: 'pilot_webinar_01' },
    ],
  });
  await assert.rejects(
    runTransactionalGraphPilot(duplicate, {
      live: false, liveEnabled: false, expectedLeadIdHash: HASH, capabilitySecret: SECRET, runId: RUN_ID,
    }, dependencies),
    /pilot_cohort_invalid/,
  );
  assert.equal(prepareCalls, 0);
});
