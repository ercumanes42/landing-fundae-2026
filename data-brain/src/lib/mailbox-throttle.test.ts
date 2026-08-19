import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  POST as postPublicOutlookCallback,
  validatePublicOutlookCallback,
} from '../app/api/transactional/email-callback/route';
import {
  capabilityHash,
  finalizeTransactionalMailbox,
  providerMessageHash,
  reserveTransactionalMailbox,
  validateIntakeCapability,
  validateMailboxFinalizeInput,
} from './mailbox-throttle';
import { buildTransactionalDeliveryPackage } from './transactional-delivery-package';

const mailboxHash = 'c'.repeat(64);
const intakeCapability = 'a'.repeat(43);
const reservationId = '018f4f6a-2b2c-7c8d-8e9f-0123456789ab';
const submissionId = 'pilot_e2e_v2_calculator';
const leadId = createHmac('sha256', 'hash-test').update('internal@example.test').digest('hex');

const calculatorPayload = {
  submission_id: submissionId,
  event_version: '1.0',
  form_type: 'calculator',
  lead_magnet: 'calculator',
  created_at: '2026-08-17T09:00:00.000Z',
  source_url: 'https://landing.example.test',
  lead_id: leadId,
  lead_score: 50,
  lead_status: 'templado',
  lead_classification: 'warm',
  scoring: { fit: 10, intent: 20, engagement: 10, urgency: 10, total: 50, classification: 'warm' },
  contact: { name: 'Persona Interna', email: 'internal@example.test', company: 'Private Company' },
  consent: { privacy_accepted: true, marketing_accepted: false },
  credit_estimate: {
    amount: 420,
    currency: 'EUR',
    calculation_mode: 'fp_quota',
    calculation_source: 'minimum_credit',
    applied_percentage: 100,
    requires_manual_review: false,
  },
};

async function withMockedRpc(
  response: Record<string, unknown>,
  callback: () => Promise<void>,
  inspect?: (body: Record<string, unknown>) => void,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const previous = new Map<string, string | undefined>();
  const environment = {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_ANON_KEY: 'anon-test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    LEAD_HASH_SECRET: 'hash-test',
    UNSUBSCRIBE_TOKEN_SECRET: 'unsubscribe-test',
    DATA_BRAIN_ADMIN_USER: 'admin-test',
    DATA_BRAIN_ADMIN_PASSWORD: 'password-test',
    MAKE_WEBHOOK_SECRET: 'M4k3-HMAC-Only-9xQ2vR7sN5cP8dL1Z',
    MAILBOX_IDENTITY_HASH: mailboxHash,
    OUTBOUND_MASTER_ENABLED: 'true',
    TRANSACTIONAL_OUTLOOK_ENABLED: 'true',
    TRANSACTIONAL_LANDING_ORIGIN: 'https://landing.example.test',
  };
  for (const [key, value] of Object.entries(environment)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  globalThis.fetch = async (_input, init) => {
    inspect?.(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json(response);
  };
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withMockedReservationBackend(
  reservationResponse: Record<string, unknown>,
  callback: (reserveBodies: Record<string, unknown>[]) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const previous = new Map<string, string | undefined>();
  const environment = {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_ANON_KEY: 'anon-test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    LEAD_HASH_SECRET: 'hash-test',
    UNSUBSCRIBE_TOKEN_SECRET: 'unsubscribe-test',
    DATA_BRAIN_ADMIN_USER: 'admin-test',
    DATA_BRAIN_ADMIN_PASSWORD: 'password-test',
    MAKE_WEBHOOK_SECRET: 'M4k3-HMAC-Only-9xQ2vR7sN5cP8dL1Z',
    MAILBOX_IDENTITY_HASH: mailboxHash,
    OUTBOUND_MASTER_ENABLED: 'true',
    TRANSACTIONAL_OUTLOOK_ENABLED: 'true',
    TRANSACTIONAL_LANDING_ORIGIN: 'https://landing.example.test',
  };
  for (const [key, value] of Object.entries(environment)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  const reserveBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/rpc/resolve_transactional_intake_capability')) {
      return Response.json({
        valid: true,
        reason_code: 'valid',
        submission_id: submissionId,
        resource: 'calculator',
        payload_sha256: 'e'.repeat(64),
      });
    }
    if (path.endsWith('/leads')) {
      return Response.json([{
        id: 'row-id',
        submission_id: submissionId,
        lead_id: leadId,
        form_type: 'calculator',
        lead_magnet: 'calculator',
        payload: calculatorPayload,
      }]);
    }
    if (path.endsWith('/rpc/reserve_transactional_mailbox_delivery')) {
      reserveBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(reservationResponse);
    }
    throw new Error('unexpected backend request');
  };
  try {
    await callback(reserveBodies);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('mailbox reservation accepts only one opaque intake capability and its package hash', () => {
  assert.deepEqual(validateIntakeCapability({
    intake_capability: intakeCapability,
    expected_resource: 'calculator',
    package_hmac_sha256: 'd'.repeat(64),
  }), {
    intakeCapability,
    expectedResource: 'calculator',
    packageHmacSha256: 'd'.repeat(64),
  });
  assert.throws(
    () => validateIntakeCapability({
      intake_capability: intakeCapability,
      expected_resource: 'calculator',
      package_hmac_sha256: 'd'.repeat(64),
      lane: 'cold',
    }),
    /not allowed/,
  );
  assert.throws(() => validateIntakeCapability({
    intake_capability: 'short',
    expected_resource: 'calculator',
    package_hmac_sha256: 'd'.repeat(64),
  }), /invalid/);
});

test('Outlook kill switch fails closed before the mailbox RPC', async () => {
  const previous = process.env.TRANSACTIONAL_OUTLOOK_ENABLED;
  process.env.TRANSACTIONAL_OUTLOOK_ENABLED = 'false';
  try {
    const result = await reserveTransactionalMailbox({
      intake_capability: intakeCapability,
      expected_resource: 'calculator',
      package_hmac_sha256: 'd'.repeat(64),
    });
    assert.equal(result.authorizedToSend, false);
    assert.equal(result.reasonCode, 'outlook_disabled');
    assert.equal(result.finalizeCapability, null);
  } finally {
    if (previous === undefined) delete process.env.TRANSACTIONAL_OUTLOOK_ENABLED;
    else process.env.TRANSACTIONAL_OUTLOOK_ENABLED = previous;
  }
});

test('master kill dominates an enabled Outlook lane before package or RPC access', async () => {
  const originalFetch = globalThis.fetch;
  const previousMaster = process.env.OUTBOUND_MASTER_ENABLED;
  const previousLane = process.env.TRANSACTIONAL_OUTLOOK_ENABLED;
  let calls = 0;
  process.env.OUTBOUND_MASTER_ENABLED = 'false';
  process.env.TRANSACTIONAL_OUTLOOK_ENABLED = 'true';
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('mailbox backend must remain unreachable');
  };
  try {
    const result = await reserveTransactionalMailbox({
      intake_capability: intakeCapability,
      expected_resource: 'calculator',
      package_hmac_sha256: 'd'.repeat(64),
    });
    assert.equal(result.authorizedToSend, false);
    assert.equal(result.reasonCode, 'outlook_disabled');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousMaster === undefined) delete process.env.OUTBOUND_MASTER_ENABLED;
    else process.env.OUTBOUND_MASTER_ENABLED = previousMaster;
    if (previousLane === undefined) delete process.env.TRANSACTIONAL_OUTLOOK_ENABLED;
    else process.env.TRANSACTIONAL_OUTLOOK_ENABLED = previousLane;
  }
});

test('reservation derives identity and keys server-side and returns a finalizer only when authorized', async () => {
  await withMockedReservationBackend({
    authorized: true,
    reason_code: 'reserved',
    reservation_id: reservationId,
    lease_expires_at: '2026-08-13T08:01:30.000Z',
    next_allowed_at: '2026-08-13T08:01:00.000Z',
    batch_position: 1,
    retry_after_seconds: 0,
  }, async (reserveBodies) => {
    const deliveryPackage = await buildTransactionalDeliveryPackage({
      intake_capability: intakeCapability,
      expected_resource: 'calculator',
    });
    assert.equal(deliveryPackage.packaged, true);
    if (!deliveryPackage.packaged) return;
    const result = await reserveTransactionalMailbox({
      intake_capability: intakeCapability,
      expected_resource: 'calculator',
      package_hmac_sha256: deliveryPackage.packageHmacSha256,
    });
    assert.equal(result.authorizedToSend, true);
    assert.equal(result.batchPosition, 1);
    assert.equal(result.reservationId, reservationId);
    assert.match(result.finalizeCapability ?? '', /^[A-Za-z0-9_-]{43}$/);
    assert.equal(reserveBodies.length, 1);
    const body = reserveBodies[0];
    assert.equal(body.p_mailbox_key_hash, mailboxHash);
    assert.equal(body.p_intake_capability_hash, capabilityHash(intakeCapability));
    assert.match(String(body.p_finalize_capability_hash), /^[a-f0-9]{64}$/);
    assert.equal(body.p_package_hmac_sha256, deliveryPackage.packageHmacSha256);
    assert.doesNotMatch(JSON.stringify(body), /@|transactional|cold/);
  });
});

test('denied reservation never exposes a finalization capability', async () => {
  await withMockedReservationBackend({ authorized: false, reason_code: 'cooldown', retry_after_seconds: 60 }, async () => {
    const deliveryPackage = await buildTransactionalDeliveryPackage({
      intake_capability: intakeCapability,
      expected_resource: 'calculator',
    });
    assert.equal(deliveryPackage.packaged, true);
    if (!deliveryPackage.packaged) return;
    const result = await reserveTransactionalMailbox({
      intake_capability: intakeCapability,
      expected_resource: 'calculator',
      package_hmac_sha256: deliveryPackage.packageHmacSha256,
    });
    assert.equal(result.authorizedToSend, false);
    assert.equal(result.finalizeCapability, null);
  });
});

test('package HMAC mismatch fails before reservation and does not consume the intake capability', async () => {
  await withMockedReservationBackend({ authorized: true, reason_code: 'reserved' }, async (reserveBodies) => {
    await assert.rejects(() => reserveTransactionalMailbox({
      intake_capability: intakeCapability,
      expected_resource: 'calculator',
      package_hmac_sha256: 'f'.repeat(64),
    }), /package hash is invalid/);
    assert.equal(reserveBodies.length, 0);
  });
});

test('finalization validates sent, failed and reconcile-required contracts', () => {
  const finalizeCapability = 'b'.repeat(43);
  assert.deepEqual(validateMailboxFinalizeInput({
    finalize_capability: finalizeCapability,
    state: 'sent',
    provider_message_id: 'outlook-message-id',
  }), {
    finalize_capability: finalizeCapability,
    state: 'sent',
    provider_message_id: 'outlook-message-id',
  });
  assert.throws(() => validateMailboxFinalizeInput({
    finalize_capability: finalizeCapability,
    state: 'reconcile_required',
  }), /failure_code is required/);
  assert.throws(() => validateMailboxFinalizeInput({
    finalize_capability: finalizeCapability,
    state: 'sent',
    provider_message_id: 'outlook-message-id',
    failure_code: 'OUTLOOK_TIMEOUT',
  }), /not allowed/);
  assert.throws(() => validateMailboxFinalizeInput({
    finalize_capability: finalizeCapability,
    state: 'sent',
    provider_message_id: 'header\r\ninjection',
  }), /invalid/);
});

test('public Outlook callback can only halt for exact manual reconciliation', () => {
  const finalizeCapability = 'b'.repeat(43);
  const safe = {
    finalize_capability: finalizeCapability,
    state: 'reconcile_required',
    failure_code: 'OUTLOOK_RESULT_UNCONFIRMED',
  };
  assert.deepEqual(validatePublicOutlookCallback(safe), safe);
  for (const invalid of [
    { finalize_capability: finalizeCapability, state: 'sent', provider_message_id: 'fake-provider-id' },
    { finalize_capability: finalizeCapability, state: 'failed', failure_code: 'DEFINITIVE_OUTLOOK_REJECTED' },
    { ...safe, provider_message_id: 'fake-provider-id' },
    { ...safe, failure_code: 'OUTLOOK_TIMEOUT' },
  ]) assert.throws(() => validatePublicOutlookCallback(invalid), /invalid/);
});

test('public Outlook callback rejects sent before the mailbox finalization RPC', async () => {
  const originalFetch = globalThis.fetch;
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries({
    NODE_ENV: 'development',
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_ANON_KEY: 'anon-test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    LEAD_HASH_SECRET: 'hash-test',
  })) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path.endsWith('/rpc/consume_rate_limit')) {
      return Response.json({ allowed: true, retry_after_seconds: 0 });
    }
    throw new Error('mailbox finalization RPC must not run');
  };
  try {
    const response = await postPublicOutlookCallback(new Request('https://brain.test/api/transactional/email-callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        finalize_capability: 'b'.repeat(43),
        state: 'sent',
        provider_message_id: 'unverified-provider-id',
      }),
    }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { accepted: false, reason_code: 'invalid_request' });
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('ambiguous Outlook outcome is finalized as reconcile_required and halts the mailbox', async () => {
  const finalizeCapability = 'b'.repeat(43);
  await withMockedRpc({
    accepted: true,
    duplicate: false,
    reason_code: 'reconcile_required',
    reservation_id: reservationId,
    next_allowed_at: '2026-08-13T08:02:00.000Z',
    mailbox_halted: true,
  }, async () => {
    const result = await finalizeTransactionalMailbox({
      finalize_capability: finalizeCapability,
      state: 'reconcile_required',
      failure_code: 'OUTLOOK_TIMEOUT',
    });
    assert.equal(result.accepted, true);
    assert.equal(result.mailboxHalted, true);
  }, (body) => {
    assert.equal(body.p_mailbox_key_hash, mailboxHash);
    assert.equal(body.p_finalize_capability_hash, capabilityHash(finalizeCapability));
    assert.doesNotMatch(JSON.stringify(body), new RegExp(finalizeCapability));
  });
});

test('provider message identifiers are domain-separated and hashed server-side', async () => {
  const finalizeCapability = 'b'.repeat(43);
  await withMockedRpc({ accepted: true, duplicate: false, reason_code: 'sent' }, async () => {
    await finalizeTransactionalMailbox({
      finalize_capability: finalizeCapability,
      state: 'sent',
      provider_message_id: 'outlook-message-id',
    });
  }, (body) => {
    assert.equal(body.p_provider_message_hash, providerMessageHash('outlook-message-id'));
    assert.doesNotMatch(JSON.stringify(body), /outlook-message-id/);
  });
});

test('timeouts, throttling and unknown outcomes cannot release the mailbox as failed', () => {
  const finalizeCapability = 'b'.repeat(43);
  for (const failureCode of ['OUTLOOK_TIMEOUT', 'OUTLOOK_429', 'AMBIGUOUS_TIMEOUT', 'OUTLOOK_UNKNOWN']) {
    assert.throws(() => validateMailboxFinalizeInput({
      finalize_capability: finalizeCapability,
      state: 'failed',
      failure_code: failureCode,
    }), /definitive/);
    assert.doesNotThrow(() => validateMailboxFinalizeInput({
      finalize_capability: finalizeCapability,
      state: 'reconcile_required',
      failure_code: failureCode,
    }));
  }
  assert.doesNotThrow(() => validateMailboxFinalizeInput({
    finalize_capability: finalizeCapability,
    state: 'failed',
    failure_code: 'DEFINITIVE_OUTLOOK_REJECTED',
  }));
});
