import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { executeColdCampaignTick, type ColdTickDependencies } from './cold-campaign-dispatch';
import { GraphOutboxRepository } from './graph-outbox-repository';
import { executeTransactionalGraphJob } from './graph-worker';

const dispatchId = '11111111-1111-4111-8111-111111111111';
const executionId = '22222222-2222-4222-8222-222222222222';
const reservationId = '33333333-3333-4333-8333-333333333333';
const workerId = '44444444-4444-4444-8444-444444444444';
const workerToken = 'a'.repeat(43);
const hash = 'b'.repeat(64);

function claim(recovery = false) {
  return {
    accepted: true, reason_code: recovery ? 'reserved_recovery' : 'claimed',
    lease_expires_at: '2099-01-01T00:00:00.000Z',
    items: [{ dispatch_id: dispatchId, campaign_execution_id: executionId,
      campaign_external_id: 'FUNDAE_2026_EMAIL_V1', contact_id: 'contact-1',
      execution_key: 'send.contact-1.1', step: 1,
      reservation_id: recovery ? reservationId : null, recovery_required: recovery,
      outbox_state: recovery ? 'draft_created' : null,
      graph_draft_immutable_id: recovery ? 'DraftId' : null,
      draft_neutralized: false, outcome_evidence_hash: null }],
  };
}

function terminalRecoveryClaim(evidenceHash: string | null) {
  const value = claim(true);
  return {
    ...value,
    items: [{ ...value.items[0], outbox_state: 'confirmed_sent', outcome_evidence_hash: evidenceHash }],
  };
}

const htmlBody = `<p>Campaign message with required identification and unsubscribe <a href="https://example.test/baja?token=${'u'.repeat(43)}">unsubscribe</a></p>`;
const payloadHash = createHash('sha256').update(JSON.stringify({
  recipient: 'person@example.test', subject: 'Subject', body: htmlBody, attachments: [],
})).digest('hex');
const storedPackage = { packaged: true, recipient_email: 'person@example.test', subject: 'Subject',
  html_body: htmlBody, payload_sha256: payloadHash };

test('OFF returns before DB or Graph and therefore performs zero network-capable work', async () => {
  let calls = 0;
  const result = await executeColdCampaignTick({
    enabled: () => false, workerId, workerToken, mailboxKeyHash: hash,
    capabilitySecret: 'secret-'.padEnd(40, 's'),
    alert: async () => undefined,
    rpc: async () => { calls += 1; throw new Error('must not execute'); },
    executeGraph: async () => { calls += 1; throw new Error('must not execute'); },
  });
  assert.equal(result.state, 'off');
  assert.equal(calls, 0);
});

test('one tick claims one transition, binds cold reservation, executes Graph and finalizes evidence', async () => {
  const calls: string[] = [];
  const deps: ColdTickDependencies = {
    enabled: () => true, workerId, workerToken, mailboxKeyHash: hash,
    capabilitySecret: 'secret-'.padEnd(40, 's'),
    alert: async () => undefined,
    rpc: async <T>(name: string) => {
      calls.push(name);
      if (name === 'claim_cold_campaign_dispatch') return claim() as T;
      if (name === 'get_claimed_cold_campaign_package') return storedPackage as T;
      if (name === 'bind_cold_campaign_reservation') return { authorized: true, reservation_id: reservationId, reason_code: 'reserved' } as T;
      if (name === 'finalize_cold_campaign_dispatch') return { accepted: true, reason_code: 'confirmed_sent' } as T;
      throw new Error(name);
    },
    executeGraph: async (job) => {
      assert.equal(job.pre_registered, true);
      assert.equal(job.expected_resource, 'campaign');
      return { state: 'confirmed_sent', reasonCode: 'confirmed_sent', reservationId,
        duplicate: false, alertAttempted: false, evidenceHash: hash };
    },
  };
  const result = await executeColdCampaignTick(deps);
  assert.equal(result.state, 'confirmed_sent');
  assert.deepEqual(calls, ['claim_cold_campaign_dispatch','get_claimed_cold_campaign_package',
    'bind_cold_campaign_reservation','finalize_cold_campaign_dispatch']);
});

test('crash replay resumes the same reserved dispatch and never creates a second authority path', async () => {
  let attempts = 0;
  const boundReservations: string[] = [];
  const deps: ColdTickDependencies = {
    enabled: () => true, workerId, workerToken, mailboxKeyHash: hash,
    capabilitySecret: 'secret-'.padEnd(40, 's'),
    alert: async () => undefined,
    rpc: async <T>(name: string) => {
      if (name === 'claim_cold_campaign_dispatch') return claim(attempts > 0) as T;
      if (name === 'get_claimed_cold_campaign_package') return storedPackage as T;
      if (name === 'bind_cold_campaign_reservation') { boundReservations.push(reservationId); return { authorized: true, duplicate: attempts > 0, reservation_id: reservationId, reason_code: 'reserved' } as T; }
      if (name === 'finalize_cold_campaign_dispatch') return { accepted: true } as T;
      throw new Error(name);
    },
    executeGraph: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('simulated crash after reservation');
      return { state: 'confirmed_sent', reasonCode: 'confirmed_sent', reservationId,
        duplicate: true, alertAttempted: false, evidenceHash: hash };
    },
  };
  await assert.rejects(() => executeColdCampaignTick(deps), /simulated crash/);
  assert.equal((await executeColdCampaignTick(deps)).state, 'confirmed_sent');
  assert.deepEqual(boundReservations, [reservationId]);
});


test('tampered recipient, subject, body or unsubscribe binding HALTs before reserve and Graph', async () => {
  for (const tampered of [
    { ...storedPackage, recipient_email: 'other@example.test' },
    { ...storedPackage, subject: 'Changed subject' },
    { ...storedPackage, html_body: `${htmlBody}<p>changed</p>` },
    { ...storedPackage, html_body: htmlBody.replace('/baja?token=', '/different?token=') },
  ]) {
    const calls: string[] = [];
    const result = await executeColdCampaignTick({
      enabled: () => true, workerId, workerToken, mailboxKeyHash: hash,
      capabilitySecret: 'secret-'.padEnd(40, 's'),
      alert: async () => { throw new Error('alert unavailable'); },
      rpc: async <T>(name: string) => {
        calls.push(name);
        if (name === 'claim_cold_campaign_dispatch') return claim() as T;
        if (name === 'get_claimed_cold_campaign_package') return tampered as T;
        if (name === 'halt_cold_campaign_dispatch') return { accepted: true } as T;
        throw new Error(`unexpected ${name}`);
      },
      executeGraph: async () => { throw new Error('Graph must not execute'); },
    });
    assert.equal(result.state, 'ambiguous_halted');
    assert.equal(result.alertAttempted, true);
    assert.equal(result.alertDelivered, false);
    assert.equal(calls.includes('bind_cold_campaign_reservation'), false);
    assert.equal(calls.at(-1), 'halt_cold_campaign_dispatch');
  }
});
test('draft_created cold recovery uses the real Graph worker, sends the same draft and creates no second draft', async () => {
  const calls: string[] = [];
  let createCalls = 0;
  let sendCalls = 0;
  let marker = '';
  const rpc = async <T>(name: string) => {
    calls.push(name);
    if (name === 'claim_cold_campaign_dispatch') return claim(true) as T;
    if (name === 'get_claimed_cold_campaign_package') return storedPackage as T;
    if (name === 'bind_cold_campaign_reservation') return { authorized: true, duplicate: true, reservation_id: reservationId, reason_code: 'reserved' } as T;
    if (name === 'authorize_graph_draft_send') return { authorized: true, duplicate: false, reason_code: 'send_submitted', reservation_id: reservationId, graph_draft_immutable_id: 'DraftId' } as T;
    if (name === 'confirm_graph_sent_item') return { accepted: true, duplicate: false, reason_code: 'confirmed_sent', reservation_id: reservationId } as T;
    if (name === 'finalize_cold_campaign_dispatch') return { accepted: true, reason_code: 'confirmed_sent' } as T;
    throw new Error(`unexpected RPC ${name}`);
  };
  const result = await executeColdCampaignTick({
    enabled: () => true, workerId, workerToken, mailboxKeyHash: hash,
    capabilitySecret: 'secret-'.padEnd(40, 's'), alert: async () => undefined, rpc,
    executeGraph: async (job, deliveryPackage) => executeTransactionalGraphJob(job, {
      enabled: () => true,
      capabilitySecret: 'secret-'.padEnd(40, 's'),
      repository: new GraphOutboxRepository(rpc),
      buildPackage: async () => deliveryPackage,
      sleep: async () => undefined, pollIntervalMs: 0, markerPollAttempts: 1, sentPollAttempts: 1,
      alert: async () => undefined,
      client: {
        createDraft: async () => { createCalls += 1; throw new Error('must not create during recovery'); },
        findByMarker: async (value) => { marker = value; return [{ id: 'DraftId', changeKey: 'Change1', isDraft: true, parentFolderId: 'Drafts', internetMessageId: null, sentDateTime: null, marker: value }]; },
        getDraftIntegrity: async () => ({ id: 'DraftId', changeKey: 'Change1', isDraft: true, parentFolderId: 'Drafts', internetMessageId: null, sentDateTime: null, subject: deliveryPackage.subject, htmlBody: deliveryPackage.body, recipients: [deliveryPackage.recipient.email], marker, attachments: [] }),
        sendDraft: async (id) => { assert.equal(id, 'DraftId'); sendCalls += 1; },
        getSentItemsFolderId: async () => 'SentFolder',
        getMessage: async () => ({ id: 'DraftId', changeKey: 'Change2', isDraft: false, parentFolderId: 'SentFolder', internetMessageId: '<cold@example.test>', sentDateTime: '2026-08-19T10:00:00Z' }),
        deleteDraft: async () => { throw new Error('must not neutralize'); },
      },
    }),
  });
  assert.equal(result.state, 'confirmed_sent');
  assert.equal(createCalls, 0);
  assert.equal(sendCalls, 1);
  assert.equal(calls.includes('bind_cold_campaign_reservation'), false);
  assert.equal(calls.includes('begin_graph_draft_creation'), false);
  assert.equal(calls.includes('bind_graph_draft_immutable_id'), false);
});

test('an ambiguous payload halt kills the lane so the next tick performs zero reserve and zero Graph', async () => {
  let killed = false;
  let reserveCalls = 0;
  let graphCalls = 0;
  const deps: ColdTickDependencies = {
    enabled: () => true, workerId, workerToken, mailboxKeyHash: hash,
    capabilitySecret: 'secret-'.padEnd(40, 's'),
    alert: async () => undefined,
    rpc: async <T>(name: string) => {
      if (name === 'claim_cold_campaign_dispatch') return (killed
        ? { accepted: false, reason_code: 'master_or_lane_disabled', items: [] }
        : claim()) as T;
      if (name === 'get_claimed_cold_campaign_package') return { ...storedPackage, subject: 'tampered' } as T;
      if (name === 'halt_cold_campaign_dispatch') { killed = true; return { accepted: true, reason_code: 'ambiguous_halted' } as T; }
      if (name === 'bind_cold_campaign_reservation') { reserveCalls += 1; throw new Error('must not reserve'); }
      throw new Error(name);
    },
    executeGraph: async () => { graphCalls += 1; throw new Error('must not execute Graph'); },
  };
  assert.equal((await executeColdCampaignTick(deps)).state, 'ambiguous_halted');
  assert.equal((await executeColdCampaignTick(deps)).reasonCode, 'master_or_lane_disabled');
  assert.equal(reserveCalls, 0);
  assert.equal(graphCalls, 0);
});

test('cold recovery wrapper alerts for missing evidence and rejected terminal finalization', async () => {
  for (const mode of ['missing_evidence', 'finalize_rejected'] as const) {
    let alerts = 0;
    const result = await executeColdCampaignTick({
      enabled: () => true, workerId, workerToken, mailboxKeyHash: hash,
      capabilitySecret: 'secret-'.padEnd(40, 's'),
      alert: async () => { alerts += 1; },
      rpc: async <T>(name: string) => {
        if (name === 'claim_cold_campaign_dispatch') {
          return terminalRecoveryClaim(mode === 'missing_evidence' ? null : hash) as T;
        }
        if (name === 'get_claimed_cold_campaign_package') return storedPackage as T;
        if (name === 'halt_cold_campaign_dispatch') return { accepted: true } as T;
        if (name === 'finalize_cold_campaign_dispatch') return { accepted: false } as T;
        throw new Error(name);
      },
      executeGraph: async () => { throw new Error('Graph must not execute during terminal recovery'); },
    });
    assert.equal(result.state, 'ambiguous_halted');
    assert.equal(result.reasonCode, mode === 'missing_evidence' ? 'recovery_evidence_missing' : 'finalize_rejected');
    assert.equal(result.alertAttempted, true);
    assert.equal(result.alertDelivered, true);
    assert.equal(alerts, 1);
  }
});

test('cold wrapper alerts when finalization after Graph evidence is rejected', async () => {
  let alerts = 0;
  const result = await executeColdCampaignTick({
    enabled: () => true, workerId, workerToken, mailboxKeyHash: hash,
    capabilitySecret: 'secret-'.padEnd(40, 's'),
    alert: async () => { alerts += 1; },
    rpc: async <T>(name: string) => {
      if (name === 'claim_cold_campaign_dispatch') return claim() as T;
      if (name === 'get_claimed_cold_campaign_package') return storedPackage as T;
      if (name === 'bind_cold_campaign_reservation') return {
        authorized: true, reservation_id: reservationId, reason_code: 'reserved',
      } as T;
      if (name === 'finalize_cold_campaign_dispatch') return { accepted: false } as T;
      throw new Error(name);
    },
    executeGraph: async () => ({
      state: 'confirmed_sent', reasonCode: 'confirmed_sent', reservationId,
      duplicate: false, alertAttempted: false, evidenceHash: hash,
    }),
  });
  assert.equal(result.state, 'ambiguous_halted');
  assert.equal(result.reasonCode, 'finalize_rejected');
  assert.equal(result.alertAttempted, true);
  assert.equal(result.alertDelivered, true);
  assert.equal(alerts, 1);
});
test('SQL contract serializes two workers, bounds retries and enforces Madrid day/spacing gates', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260819170000_cold_campaign_scheduler.sql', import.meta.url), 'utf8').toLowerCase();
  for (const marker of [
    "unique index cold_campaign_single_inflight_idx", "where status in ('claimed','reserved')",
    'where singleton for update', 'for update skip locked limit 1', "operating_timezone <> 'europe/madrid'",
    'minimum_spacing_seconds < 60', 'cold_daily_limit > 480', 'claim_attempt >= 20',
    "code,dispatch_id,evidence_hash) values('claim_attempts_exhausted'", 'pg_catalog.clock_timestamp()',
    'ce.step = cc.current_step', 'pg_catalog.generate_series(1, ce.step - 1)',
    "prior.status = 'executed'", "prior_dispatch.status = 'confirmed_sent'",
    "set cold_enabled=false,halt_reason='claim_attempts_exhausted'",
    "set cold_enabled=false,halt_reason='reservation_binding_missing'",
    "set cold_enabled=false,halt_reason='terminal_evidence_mismatch'",
    'current_step=least(5,current_step+1)', "case when v_e.step>=5 then 'completed'",
    "'graph_draft_immutable_id',v_outbox.graph_draft_immutable_id",
    "'draft_neutralized',(v_outbox.draft_neutralized_at is not null)",
    "'outcome_evidence_hash',case when v_outbox.state='confirmed_sent'",
  ]) assert.ok(sql.includes(marker), `missing scheduler fault contract: ${marker}`);
});
test('confirmed finalize preserves a previously committed stop and stops all later planned steps', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260819170000_cold_campaign_scheduler.sql', import.meta.url), 'utf8').toLowerCase();
  assert.match(sql, /select \* into v_c from public\.campaign_contacts[^;]+for update;/);
  assert.match(sql, /v_terminal_stop :=[\s\S]+reply_received_at is not null/);
  assert.match(sql, /if v_terminal_stop then[\s\S]+last_delivery_status='confirmed_sent'[\s\S]+status='stopped'[\s\S]+stop_reason='terminal_stop_before_finalize'/);
  assert.match(sql, /step>v_e\.step/);
});
