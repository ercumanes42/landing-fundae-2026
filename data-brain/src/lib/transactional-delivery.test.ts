import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  findTransactionalLead,
  recordTransactionalEmailCallback,
  validateTransactionalEmailCallback,
  type TransactionalResource,
} from './transactional-delivery';
import { generateInteractiveChecklistPdf } from './transactional-pdf';

const sentCallback = {
  submission_id: 'interactive_checklist_01JTEST123',
  lead_id: 'a'.repeat(64),
  event_name: 'email_sent',
  source_event_id: 'make:outlook:01JTEST123',
  occurred_at: '2026-08-12T12:00:00.000Z',
  provider_message_hash: 'b'.repeat(64),
};

const requiredEnv = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_ANON_KEY: 'anon-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  LEAD_HASH_SECRET: 'hash-test',
  UNSUBSCRIBE_TOKEN_SECRET: 'unsubscribe-test',
  DATA_BRAIN_ADMIN_USER: 'admin-test',
  DATA_BRAIN_ADMIN_PASSWORD: 'password-test',
  MAKE_WEBHOOK_SECRET: 'make-test',
};

async function withMockedSupabase(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  callback: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const previousEnv = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(requiredEnv)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }
  globalThis.fetch = handler;
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('transactional callback accepts only PII-free canonical fields', () => {
  assert.doesNotThrow(() => validateTransactionalEmailCallback(sentCallback));
  for (const invalid of [
    { ...sentCallback, event_name: 'delivered' },
    { ...sentCallback, provider_message_hash: 'outlook-id@example.com' },
    { ...sentCallback, email: 'person@example.com' },
  ]) {
    assert.throws(() => validateTransactionalEmailCallback(invalid));
  }
});

test('email_failed may carry only a bounded failure code', () => {
  const failed = { ...sentCallback, event_name: 'email_failed', provider_message_hash: undefined, failure_code: 'OUTLOOK_REJECTED' };
  assert.doesNotThrow(() => validateTransactionalEmailCallback(failed));
  assert.throws(() => validateTransactionalEmailCallback({ ...failed, failure_code: 'recipient@example.com' }));
});

test('transactional callback accepts the four resource types and records their state', async () => {
  const resources: TransactionalResource[] = ['calculator', 'interactive_checklist', 'checklist', 'webinar'];

  for (const resource of resources) {
    const callback = {
      ...sentCallback,
      submission_id: `${resource}_01JTEST123`,
      source_event_id: `make:outlook:${resource}`,
    };
    const methods: string[] = [];

    await withMockedSupabase(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      methods.push(`${method} ${new URL(url).pathname}`);

      if (method === 'GET' && url.includes('/rest/v1/leads?')) {
        return Response.json([{
          id: `row-${resource}`,
          submission_id: callback.submission_id,
          lead_id: callback.lead_id,
          form_type: resource,
          lead_magnet: resource,
          payload: {},
        }]);
      }
      if (method === 'GET' && url.includes('/rest/v1/transactional_email_events?')) {
        return Response.json([]);
      }
      if (method === 'POST' && url.endsWith('/rest/v1/transactional_email_events')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json([{ id: `event-${resource}`, ...body }]);
      }
      if (method === 'PATCH' && url.includes('/rest/v1/leads?')) {
        assert.deepEqual(JSON.parse(String(init?.body)), {
          email_delivery_status: 'email_sent',
          email_delivery_updated_at: callback.occurred_at,
        });
        return Response.json([{ id: `row-${resource}` }]);
      }
      throw new Error(`unexpected Supabase request: ${method} ${url}`);
    }, async () => {
      assert.deepEqual(await recordTransactionalEmailCallback(callback), {
        duplicate: false,
        eventId: `event-${resource}`,
      });
    });

    assert.deepEqual(methods, [
      'GET /rest/v1/leads',
      'GET /rest/v1/transactional_email_events',
      'POST /rest/v1/transactional_email_events',
      'PATCH /rest/v1/leads',
    ]);
  }
});

test('transactional lead lookup rejects diagnostic and mismatched resource rows', async () => {
  for (const row of [
    { form_type: 'diagnostic', lead_magnet: 'diagnostic' },
    { form_type: 'calculator', lead_magnet: 'webinar' },
  ]) {
    await withMockedSupabase(async () => Response.json([{
      id: 'row-invalid',
      submission_id: sentCallback.submission_id,
      lead_id: sentCallback.lead_id,
      payload: {},
      ...row,
    }]), async () => {
      await assert.rejects(
        findTransactionalLead(sentCallback.submission_id, sentCallback.lead_id),
        /not an allowed transactional resource/,
      );
    });
  }
});

test('duplicate transactional callback is idempotent and does not insert another event', async () => {
  let insertCalls = 0;
  let updateCalls = 0;
  await withMockedSupabase(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.includes('/rest/v1/leads?')) {
      return Response.json([{
        id: 'row-checklist',
        submission_id: sentCallback.submission_id,
        lead_id: sentCallback.lead_id,
        form_type: 'checklist',
        lead_magnet: 'checklist',
        payload: {},
      }]);
    }
    if (method === 'GET' && url.includes('/rest/v1/transactional_email_events?')) {
      return Response.json([{
        id: 'event-existing',
        submission_id: sentCallback.submission_id,
        lead_id: sentCallback.lead_id,
        event_name: sentCallback.event_name,
        source_event_id: sentCallback.source_event_id,
      }]);
    }
    if (method === 'POST') {
      insertCalls += 1;
      return Response.json([]);
    }
    if (method === 'PATCH' && url.includes('/rest/v1/leads?')) {
      updateCalls += 1;
      return Response.json([{ id: 'row-checklist' }]);
    }
    throw new Error(`unexpected Supabase request: ${method} ${url}`);
  }, async () => {
    assert.deepEqual(await recordTransactionalEmailCallback(sentCallback), {
      duplicate: true,
      eventId: 'event-existing',
    });
  });
  assert.equal(insertCalls, 0);
  assert.equal(updateCalls, 1);
});

test('interactive checklist PDF is valid, general and contains no contact PII', async () => {
  const pdfBytes = await generateInteractiveChecklistPdf({
    score: 5,
    riskLevel: 'medium',
    answers: { company_size: '10-49', credit_visibility: 'No todavía', training_fit: 'No o no lo sé', planning_process: 'A veces con poco margen' },
  });
  assert.ok(pdfBytes.byteLength > 2_000);
  assert.equal(Buffer.from(pdfBytes).subarray(0, 5).toString('ascii'), '%PDF-');
  const pdf = await PDFDocument.load(pdfBytes);
  assert.equal(pdf.getPageCount(), 1);
  const raw = Buffer.from(pdfBytes).toString('latin1');
  assert.doesNotMatch(raw, /person@example\.com|Hola /i);
});

test('PDF rejects inconsistent risk levels and out-of-range scores', async () => {
  await assert.rejects(generateInteractiveChecklistPdf({ score: 6, riskLevel: 'high', answers: {} }), /does not match/);
  await assert.rejects(generateInteractiveChecklistPdf({ score: 15, riskLevel: 'high', answers: {} }), /score is invalid/);
});
