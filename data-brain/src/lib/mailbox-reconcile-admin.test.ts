import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reconcileTransactionalMailboxAdmin,
  reconciliationEvidenceHash,
  validateMailboxReconcileAdminInput,
  type MailboxReconcileAdminDependencies,
} from './mailbox-reconcile-admin';
import { providerMessageHash } from './mailbox-throttle';

const reservationId = '018f4f6a-2b2c-7c8d-8e9f-0123456789ab';
const mailboxHash = 'c'.repeat(64);
const baseInput = {
  reservation_id: reservationId,
  expected_state: 'reconcile_required',
  resolution: 'confirmed_sent',
  provider_message_id: 'opaque-outlook-id',
  evidence: 'operator-confirmed-in-outlook',
} as const;

process.env.LEAD_HASH_SECRET = 'lead-hash-test-secret';

function dependencies(
  overrides: Partial<MailboxReconcileAdminDependencies> = {},
): MailboxReconcileAdminDependencies & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async findReservation() {
      calls.push('findReservation');
      return {
        id: reservationId,
        mailbox_key_hash: mailboxHash,
        lane: 'transactional',
        status: 'reconcile_required',
        reconciliation_resolution: null,
        reconciliation_evidence_hash: null,
        provider_message_hash: null,
      };
    },
    async findMailbox() {
      calls.push('findMailbox');
      return { active_reservation_id: null, blocked_reservation_id: reservationId };
    },
    async reconcile() {
      calls.push('reconcile');
      return { accepted: true, duplicate: false, reason_code: 'reconciled_sent', mailbox_halted: false };
    },
    ...overrides,
  };
}

test('admin reconciliation validates exact dry-run and apply contracts', () => {
  assert.deepEqual(validateMailboxReconcileAdminInput(baseInput, false), baseInput);
  assert.throws(() => validateMailboxReconcileAdminInput({ ...baseInput, confirmation: 'wrong' }, false), /confirmation_not_allowed/);
  assert.throws(() => validateMailboxReconcileAdminInput(baseInput, true), /confirmation_required/);
  assert.doesNotThrow(() => validateMailboxReconcileAdminInput({
    ...baseInput,
    confirmation: 'APPLY_TRANSACTIONAL_MAILBOX_RECONCILIATION',
  }, true));
  for (const invalid of [
    { ...baseInput, recipient: 'not-allowed' },
    { ...baseInput, provider_message_id: 'header\r\ninjection' },
    { ...baseInput, evidence: '' },
    { ...baseInput, resolution: 'confirmed_not_sent' },
  ]) assert.throws(() => validateMailboxReconcileAdminInput(invalid, false));
  assert.doesNotThrow(() => validateMailboxReconcileAdminInput({
    reservation_id: reservationId,
    expected_state: 'reconcile_required',
    resolution: 'confirmed_not_sent',
    evidence: 'definitively-not-sent',
  }, false));
});

test('dry-run is read-only and requires the exact blocked reservation', async () => {
  const deps = dependencies();
  const summary = await reconcileTransactionalMailboxAdmin(baseInput, false, deps);
  assert.deepEqual(summary, {
    status: 'validated',
    resolution: 'confirmed_sent',
    writes: 0,
    mailbox_halted: true,
  });
  assert.deepEqual(deps.calls, ['findReservation', 'findMailbox']);

  const unblocked = dependencies({
    async findMailbox() {
      return { active_reservation_id: null, blocked_reservation_id: null };
    },
  });
  await assert.rejects(
    () => reconcileTransactionalMailboxAdmin(baseInput, false, unblocked),
    /reconciliation_state_invalid/,
  );
  assert.doesNotMatch(unblocked.calls.join(' '), /reconcile$/);
});

test('invalid input and missing apply confirmation fail before any backend call', async () => {
  const deps = dependencies();
  await assert.rejects(
    () => reconcileTransactionalMailboxAdmin({ ...baseInput, evidence: '' }, false, deps),
    /evidence_invalid/,
  );
  await assert.rejects(
    () => reconcileTransactionalMailboxAdmin(baseInput, true, deps),
    /confirmation_required/,
  );
  assert.deepEqual(deps.calls, []);
});

test('apply sends only hashes to the service-role RPC and never raw evidence or provider id', async () => {
  let rpcArgs: Record<string, unknown> | undefined;
  const deps = dependencies({
    async reconcile(args) {
      rpcArgs = args;
      return { accepted: true, duplicate: false, reason_code: 'reconciled_sent', mailbox_halted: false };
    },
  });
  const summary = await reconcileTransactionalMailboxAdmin({
    ...baseInput,
    confirmation: 'APPLY_TRANSACTIONAL_MAILBOX_RECONCILIATION',
  }, true, deps);
  assert.equal(summary.status, 'reconciled');
  assert.equal(summary.writes, 1);
  assert.equal(rpcArgs?.providerMessageHash, providerMessageHash(baseInput.provider_message_id));
  assert.equal(rpcArgs?.evidenceHash, reconciliationEvidenceHash(baseInput.evidence));
  assert.doesNotMatch(JSON.stringify(rpcArgs), /opaque-outlook-id|operator-confirmed/);
});

test('exactly reconciled outcome is idempotent and conflicting evidence fails closed', async () => {
  const exact = dependencies({
    async findReservation() {
      return {
        id: reservationId,
        mailbox_key_hash: mailboxHash,
        lane: 'transactional',
        status: 'sent',
        reconciliation_resolution: 'confirmed_sent',
        reconciliation_evidence_hash: reconciliationEvidenceHash(baseInput.evidence),
        provider_message_hash: providerMessageHash(baseInput.provider_message_id),
      };
    },
    async findMailbox() {
      return { active_reservation_id: null, blocked_reservation_id: null };
    },
  });
  const summary = await reconcileTransactionalMailboxAdmin(baseInput, false, exact);
  assert.deepEqual(summary, {
    status: 'already_reconciled',
    resolution: 'confirmed_sent',
    writes: 0,
    mailbox_halted: false,
  });

  await assert.rejects(
    () => reconcileTransactionalMailboxAdmin({ ...baseInput, evidence: 'different-evidence' }, false, exact),
    /reconciliation_conflict/,
  );
});

test('RPC duplicate from a concurrent reconciliation is reported as zero writes', async () => {
  const deps = dependencies({
    async reconcile() {
      return { accepted: true, duplicate: true, reason_code: 'reconciled_sent', mailbox_halted: false };
    },
  });
  const summary = await reconcileTransactionalMailboxAdmin({
    ...baseInput,
    confirmation: 'APPLY_TRANSACTIONAL_MAILBOX_RECONCILIATION',
  }, true, deps);
  assert.equal(summary.status, 'already_reconciled');
  assert.equal(summary.writes, 0);
});

test('unexpected RPC rejection is sanitized and does not expose its response', async () => {
  const deps = dependencies({
    async reconcile() {
      return { accepted: false, duplicate: false, reason_code: 'private-db-detail', mailbox_halted: true };
    },
  });
  await assert.rejects(
    () => reconcileTransactionalMailboxAdmin({
      ...baseInput,
      confirmation: 'APPLY_TRANSACTIONAL_MAILBOX_RECONCILIATION',
    }, true, deps),
    /reconciliation_rejected/,
  );
});
