import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { POST } from '../app/api/transactional/delivery-package/route';
import {
  buildTransactionalDeliveryPackage,
  renderTransactionalEmailHtml,
  transactionalPackageHmacSha256,
  validateTransactionalDeliveryPackageInput,
} from './transactional-delivery-package';
import type { TransactionalResource } from './transactional-delivery';

const capability = 'a'.repeat(43);
const leadHashSecretFixture = 'delivery-package-hash-test'.padEnd(32, 'q');
const leadId = createHmac('sha256', leadHashSecretFixture).update('internal@example.test').digest('hex');
const resources: TransactionalResource[] = [
  'calculator',
  'interactive_checklist',
  'checklist',
  'webinar',
];

const environment = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_ANON_KEY: 'anon-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  LEAD_HASH_SECRET: leadHashSecretFixture,
  UNSUBSCRIBE_TOKEN_SECRET: 'unsubscribe-test',
  DATA_BRAIN_ADMIN_USER: 'admin-test',
  DATA_BRAIN_ADMIN_PASSWORD: 'password-test',
  MAKE_WEBHOOK_SECRET: 'M4k3-HMAC-Only-9xQ2vR7sN5cP8dL1Z',
  TRANSACTIONAL_LANDING_ORIGIN: 'https://landing.example.test',
  TRANSACTIONAL_WEBINAR_TITLE: 'Webinar FUNDAE',
  TRANSACTIONAL_WEBINAR_START_AT: '2026-09-15T08:00:00.000Z',
  TRANSACTIONAL_WEBINAR_DURATION_MINUTES: '60',
  TRANSACTIONAL_WEBINAR_TIMEZONE: 'Europe/Madrid',
  TRANSACTIONAL_WEBINAR_ACCESS_NOTE: 'Recibirás el acceso por el canal confirmado.',
};

function payload(resource: TransactionalResource) {
  return {
    submission_id: `pilot_e2e_v2_${resource}`,
    event_version: '1.0',
    form_type: resource,
    lead_magnet: resource,
    created_at: '2026-08-17T09:00:00.000Z',
    source_url: 'https://landing.example.test',
    lead_id: leadId,
    lead_score: 50,
    lead_status: 'templado',
    lead_classification: 'warm',
    scoring: { fit: 10, intent: 20, engagement: 10, urgency: 10, total: 50, classification: 'warm' },
    contact: {
      name: 'Persona\r\nInterna',
      email: 'INTERNAL@EXAMPLE.TEST',
      company: 'Private Company',
      phone: '+34000000000',
    },
    consent: { privacy_accepted: true, marketing_accepted: false },
    ...(resource === 'calculator'
      ? {
          credit_estimate: {
            amount: 420,
            currency: 'EUR',
            calculation_mode: 'fp_quota',
            calculation_source: 'minimum_credit',
            applied_percentage: 100,
            requires_manual_review: false,
          },
        }
      : {}),
    ...(resource === 'interactive_checklist'
      ? {
          interactive_checklist: {
            score: 5,
            risk_level: 'medium',
            answers: {
              company_size: '1-5',
              credit_visibility: 'No todavía',
              training_fit: 'Tenemos una idea general',
              planning_process: 'A veces con poco margen',
              rlpt_process: 'No existe RLPT',
              evidence_tracking: 'Solo en algunos cursos',
              documentation_control: 'Sí, con un sistema claro',
              cofinancing: 'No aplica: 1-5 personas',
              review_timing: 'Esta semana',
            },
          },
        }
      : {}),
  };
}

async function withMockedBackend(
  resource: TransactionalResource,
  callback: (calls: string[]) => Promise<void>,
  claimOverride: Record<string, unknown> = {},
  transformStored: (value: ReturnType<typeof payload>) => ReturnType<typeof payload> = (value) => value,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(environment)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;
    calls.push(`${method} ${path}`);
    if (method === 'POST' && path.endsWith('/rpc/consume_rate_limit')) {
      return Response.json({ allowed: true, retry_after_seconds: 0 });
    }
    if (method === 'POST' && path.endsWith('/rpc/resolve_transactional_intake_capability')) {
      return Response.json({
        valid: true,
        reason_code: 'valid',
        submission_id: payload(resource).submission_id,
        resource,
        payload_sha256: 'c'.repeat(64),
        ...claimOverride,
      });
    }
    if (method === 'GET' && path.endsWith('/leads')) {
      const stored = transformStored(payload(resource));
      return Response.json([{
        id: 'row-id',
        submission_id: stored.submission_id,
        lead_id: stored.lead_id,
        form_type: resource,
        lead_magnet: resource,
        payload: stored,
      }]);
    }
    throw new Error(`unexpected request: ${method} ${path}`);
  };
  try {
    await callback(calls);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('delivery package accepts only capability and expected resource', () => {
  assert.deepEqual(
    validateTransactionalDeliveryPackageInput({
      intake_capability: capability,
      expected_resource: 'calculator',
    }),
    { intake_capability: capability, expected_resource: 'calculator' },
  );
  for (const invalid of [
    { intake_capability: 'short', expected_resource: 'calculator' },
    { intake_capability: capability, expected_resource: 'diagnostic' },
    { intake_capability: capability, expected_resource: 'calculator', recipient: 'attacker@example.test' },
  ]) assert.throws(() => validateTransactionalDeliveryPackageInput(invalid), /invalid|not allowed/);
});

test('delivery package renders all four resources from stored server-side data', async () => {
  for (const resource of resources) {
    await withMockedBackend(resource, async (calls) => {
      const result = await buildTransactionalDeliveryPackage({
        intake_capability: capability,
        expected_resource: resource,
      });
      assert.equal(result.packaged, true);
      if (!result.packaged) return;
      assert.equal(result.resource, resource);
      assert.equal(result.recipient.email, 'internal@example.test');
      assert.deepEqual(Object.keys(result.recipient), ['email']);
      assert.equal(result.contentType, 'html');
      assert.match(result.packageHmacSha256, /^[a-f0-9]{64}$/);
      assert.ok(result.subject.length > 5);
      assert.ok(result.body.includes('Persona'));
      assert.match(result.body, /^<div style=/);
      assert.equal(result.attachments.length, resource === 'interactive_checklist' || resource === 'checklist' ? 1 : 0);
      for (const attachment of result.attachments) {
        assert.deepEqual(Object.keys(attachment).sort(), [
          'byte_length',
          'content_base64',
          'content_sha256',
          'content_type',
          'filename',
          'kind',
          'max_bytes',
        ]);
        assert.equal(attachment.content_type, 'application/pdf');
        assert.equal(attachment.max_bytes, 2_097_152);
        assert.ok(attachment.byte_length > 5 && attachment.byte_length <= attachment.max_bytes);
        const bytes = Buffer.from(attachment.content_base64, 'base64');
        assert.equal(bytes.byteLength, attachment.byte_length);
        assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
        assert.equal(createHash('sha256').update(bytes).digest('hex'), attachment.content_sha256);
        assert.doesNotMatch(JSON.stringify(attachment), /https?:|endpoint_path|intake_capability/i);
      }
      const serialized = JSON.stringify(result);
      assert.doesNotMatch(serialized, /Private Company|\+34000000000|pilot_e2e|"lead_id"|intake_capability/i);
      assert.deepEqual(calls, [
        'POST /rest/v1/rpc/resolve_transactional_intake_capability',
        'GET /rest/v1/leads',
      ]);
    });
  }
});

test('delivery package rejects a mutated stored recipient before rendering an envelope', async () => {
  await withMockedBackend('calculator', async (calls) => {
    await assert.rejects(
      () => buildTransactionalDeliveryPackage({
        intake_capability: capability,
        expected_resource: 'calculator',
      }),
      /identity does not match/,
    );
    assert.deepEqual(calls, [
      'POST /rest/v1/rpc/resolve_transactional_intake_capability',
      'GET /rest/v1/leads',
    ]);
  }, {}, (stored) => ({
    ...stored,
    contact: { ...stored.contact, email: 'changed@example.test' },
  }));
});

test('delivery package HTML escapes all active markup and preserves line breaks safely', () => {
  const html = renderTransactionalEmailHtml('A&B <script>alert("x")</script> \'quoted\'\r\nnext');
  assert.doesNotMatch(html, /<script>|<\/script>|\r|\n/);
  assert.match(html, /A&amp;B/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;x&quot;/);
  assert.match(html, /&#39;quoted&#39;/);
  assert.match(html, /<br>/);
});

test('delivery package PDF bytes are deterministic and covered by the package HMAC', async () => {
  for (const resource of ['interactive_checklist', 'checklist'] as const) {
    await withMockedBackend(resource, async () => {
      const input = { intake_capability: capability, expected_resource: resource };
      const first = await buildTransactionalDeliveryPackage(input);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const second = await buildTransactionalDeliveryPackage(input);
      assert.deepEqual(second, first);
      if (!first.packaged) return;
      const { packaged: _packaged, reasonCode: _reason, packageHmacSha256, ...envelope } = first;
      const modified = structuredClone(envelope);
      modified.attachments[0].content_base64 += 'A';
      assert.notEqual(
        transactionalPackageHmacSha256(capability, modified),
        packageHmacSha256,
      );
    });
  }
});

test('delivery package is idempotent and never calls mailbox, PDF or callback', async () => {
  await withMockedBackend('calculator', async (calls) => {
    const input = { intake_capability: capability, expected_resource: 'calculator' };
    const first = await buildTransactionalDeliveryPackage(input);
    const second = await buildTransactionalDeliveryPackage(input);
    assert.deepEqual(second, first);
    assert.equal(calls.filter((call) => call.includes('resolve_transactional')).length, 2);
    assert.equal(calls.filter((call) => call.endsWith('/leads')).length, 2);
    assert.doesNotMatch(calls.join(' '), /mailbox|pdf|callback|claim_transactional/);
  });
});

test('delivery package rejects resource mismatch generically before reading the lead', async () => {
  await withMockedBackend('calculator', async (calls) => {
    const result = await buildTransactionalDeliveryPackage({
      intake_capability: capability,
      expected_resource: 'webinar',
    });
    assert.deepEqual(result, { packaged: false, reasonCode: 'capability_rejected' });
    assert.deepEqual(calls, ['POST /rest/v1/rpc/resolve_transactional_intake_capability']);
  });
});

test('delivery package rejects unavailable, expired and consumed capabilities identically', async () => {
  for (const reason_code of ['capability_unavailable', 'capability_expired', 'replay_blocked']) {
    await withMockedBackend('calculator', async (calls) => {
      const result = await buildTransactionalDeliveryPackage({
        intake_capability: capability,
        expected_resource: 'calculator',
      });
      assert.deepEqual(result, { packaged: false, reasonCode: 'capability_rejected' });
      assert.deepEqual(calls, ['POST /rest/v1/rpc/resolve_transactional_intake_capability']);
    }, { valid: false, reason_code });
  }
});

test('delivery package HTTP returns private no-store envelope and generic capability rejection', async () => {
  await withMockedBackend('checklist', async (calls) => {
    const response = await POST(new Request('https://brain.test/api/transactional/delivery-package', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intake_capability: capability, expected_resource: 'checklist' }),
    }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      'attachments',
      'body',
      'content_type',
      'package_hmac_sha256',
      'packaged',
      'reason_code',
      'recipient',
      'resource',
      'subject',
      'template_id',
    ]);
    assert.equal(body.packaged, true);
    assert.deepEqual(calls, [
      'POST /rest/v1/rpc/resolve_transactional_intake_capability',
      'GET /rest/v1/leads',
    ]);
  });

  await withMockedBackend('calculator', async () => {
    const response = await POST(new Request('https://brain.test/api/transactional/delivery-package', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intake_capability: capability, expected_resource: 'calculator' }),
    }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { packaged: false, reason_code: 'capability_rejected' });
  }, { valid: false, reason_code: 'capability_unavailable' });
});

test('delivery package HTTP maps deterministic stored-content failures to non-retriable 422', async () => {
  await withMockedBackend('calculator', async (calls) => {
    const response = await POST(new Request('https://brain.test/api/transactional/delivery-package', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intake_capability: capability, expected_resource: 'calculator' }),
    }));
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { packaged: false, reason_code: 'package_not_ready' });
    assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
    assert.deepEqual(calls, [
      'POST /rest/v1/rpc/resolve_transactional_intake_capability',
      'GET /rest/v1/leads',
    ]);
  }, {}, (stored) => {
    const changed = structuredClone(stored);
    delete changed.credit_estimate;
    return changed;
  });
});

test('delivery package HTTP keeps backend configuration failures as transient 503', async () => {
  await withMockedBackend('calculator', async () => {
    delete process.env.TRANSACTIONAL_LANDING_ORIGIN;
    const response = await POST(new Request('https://brain.test/api/transactional/delivery-package', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intake_capability: capability, expected_resource: 'calculator' }),
    }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { packaged: false, reason_code: 'package_unavailable' });
  });
});

test('delivery package HTTP rejects oversized input before resolving capability', async () => {
  await withMockedBackend('calculator', async (calls) => {
    const response = await POST(new Request('https://brain.test/api/transactional/delivery-package', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '2048' },
      body: '{}',
    }));
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { packaged: false, reason_code: 'invalid_request' });
    assert.deepEqual(calls, []);
  });
});

test('both capability-bound PDF routes enforce the same 2 MiB output ceiling', () => {
  const interactive = readFileSync(
    new URL('../app/api/transactional/interactive-checklist/pdf/route.ts', import.meta.url),
    'utf8',
  );
  const checklist = readFileSync(
    new URL('../app/api/transactional/checklist/pdf/route.ts', import.meta.url),
    'utf8',
  );
  for (const source of [interactive, checklist]) {
    assert.match(source, /const MAX_PDF_BYTES = 2 \* 1024 \* 1024/);
    assert.match(source, /pdf\.byteLength > MAX_PDF_BYTES/);
  }
});
