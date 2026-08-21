import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../app/api/transactional/prepare/route';
import {
  prepareTransactionalDryRun,
  validateTransactionalPrepareInput,
} from './transactional-prepare';

const requiredEnv = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_ANON_KEY: 'anon-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  LEAD_HASH_SECRET: 'transactional-prepare-hash-test'.padEnd(32, 'q'),
  UNSUBSCRIBE_TOKEN_SECRET: 'unsubscribe-test',
  DATA_BRAIN_ADMIN_USER: 'admin-test',
  DATA_BRAIN_ADMIN_PASSWORD: 'password-test',
  MAKE_WEBHOOK_SECRET: 'M4k3-HMAC-Only-9xQ2vR7sN5cP8dL1Z',
  TRANSACTIONAL_LANDING_ORIGIN: 'https://landing.example.test',
  TRANSACTIONAL_WEBINAR_TITLE: 'Webinar FUNDAE',
  TRANSACTIONAL_WEBINAR_START_AT: '2026-10-01T12:00:00+02:00',
  TRANSACTIONAL_WEBINAR_DURATION_MINUTES: '45',
  TRANSACTIONAL_WEBINAR_TIMEZONE: 'Europe/Madrid',
  TRANSACTIONAL_WEBINAR_ACCESS_NOTE: 'El enlace se enviará antes de la sesión.',
};
const capability = 'A'.repeat(43);
const payloadSha256 = 'b'.repeat(64);

const artifactByResource = {
  calculator: 'resource_link',
  interactive_checklist: 'generated_pdf',
  checklist: 'canonical_pdf',
  webinar: 'calendar_confirmation',
} as const;

const templateByResource = {
  calculator: 'calculator_result_v1',
  interactive_checklist: 'interactive_checklist_result_v1',
  checklist: 'checklist_delivery_v1',
  webinar: 'webinar_confirmation_v1',
} as const;

function assertStrictPrepareMetadata(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  const metadata = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(metadata).sort(), [
    'artifact_type',
    'mode',
    'payload_sha256',
    'prepared',
    'reason_code',
    'resource',
    'template_id',
  ]);
  for (const item of Object.values(metadata)) {
    assert.ok(item === null || ['boolean', 'string'].includes(typeof item));
  }
}

async function withMockedSupabase(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  callback: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(requiredEnv)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  globalThis.fetch = handler;
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

test('prepare accepts only the exact capability-bound dry-run contract', () => {
  assert.equal(validateTransactionalPrepareInput({
    intake_capability: capability,
    expected_resource: 'calculator',
    mode: 'dry_run',
  }).expected_resource, 'calculator');
  assert.throws(
    () => validateTransactionalPrepareInput({ intake_capability: capability, expected_resource: 'diagnostic', mode: 'dry_run' }),
    /expected_resource is invalid/,
  );
  assert.throws(
    () => validateTransactionalPrepareInput({ intake_capability: capability, expected_resource: 'calculator', mode: 'send' }),
    /mode is invalid/,
  );
  assert.throws(
    () => validateTransactionalPrepareInput({ intake_capability: capability, expected_resource: 'calculator', mode: 'dry_run', recipient: 'x@example.test' }),
    /recipient is not allowed/,
  );
  assert.throws(
    () => validateTransactionalPrepareInput({ capability, expected_resource: 'calculator', mode: 'dry_run' }),
    /capability is not allowed/,
  );
});

test('prepare derives all resource metadata server-side and is idempotent without mailbox calls', async () => {
  for (const [resource, artifactType] of Object.entries(artifactByResource)) {
    const calls: string[] = [];
    await withMockedSupabase(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
      assert.match(String(init?.body), /p_intake_capability_hash/);
      assert.doesNotMatch(String(init?.body), new RegExp(capability));
      return Response.json({
        valid: true,
        reason_code: 'valid',
        submission_id: 'submission_01JTEST123',
        resource,
        payload_sha256: payloadSha256,
      });
    }, async () => {
      const input = { intake_capability: capability, expected_resource: resource, mode: 'dry_run' };
      const first = await prepareTransactionalDryRun(input);
      const repeated = await prepareTransactionalDryRun(input);
      assert.deepEqual(repeated, first);
      assert.deepEqual(first, {
        prepared: true,
        reasonCode: 'prepared',
        mode: 'dry_run',
        resource,
        payloadSha256,
        artifactType,
        templateId: templateByResource[resource as keyof typeof templateByResource],
      });
      const serialized = JSON.stringify(first);
      assert.doesNotMatch(serialized, /submission_01JTEST123|intake_capability|recipient|email|body|url|filename|endpoint/i);
    });
    assert.deepEqual(calls, [
      'POST /rest/v1/rpc/resolve_transactional_intake_capability',
      'POST /rest/v1/rpc/resolve_transactional_intake_capability',
    ]);
  }
});

test('prepare rejects an expired, consumed or resource-mismatched capability generically', async () => {
  for (const result of [
    { valid: false, reason_code: 'capability_unavailable' },
    {
      valid: true,
      reason_code: 'valid',
      submission_id: 'submission_01JTEST123',
      resource: 'webinar',
      payload_sha256: payloadSha256,
    },
  ]) {
    await withMockedSupabase(async () => Response.json(result), async () => {
      const prepared = await prepareTransactionalDryRun({
        intake_capability: capability,
        expected_resource: 'calculator',
        mode: 'dry_run',
      });
      assert.deepEqual(prepared, {
        prepared: false,
        reasonCode: 'capability_rejected',
        mode: 'dry_run',
        resource: null,
        payloadSha256: null,
        artifactType: null,
        templateId: null,
      });
    });
  }
});

test('prepare HTTP returns the strict non-PII metadata contract for all four resources', async () => {
  let requestIndex = 0;
  for (const resource of Object.keys(artifactByResource) as Array<keyof typeof artifactByResource>) {
    const calls: string[] = [];
    await withMockedSupabase(async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
      return Response.json({
        valid: true,
        reason_code: 'valid',
        submission_id: 'submission_01JTEST123',
        resource,
        payload_sha256: payloadSha256,
      });
    }, async () => {
      requestIndex += 1;
      const response = await POST(new Request('https://data.example.test/api/transactional/prepare', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `192.0.2.${80 + requestIndex}`,
        },
        body: JSON.stringify({
          intake_capability: capability,
          expected_resource: resource,
          mode: 'dry_run',
        }),
      }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
      const body = await response.text();
      const metadata = JSON.parse(body) as Record<string, unknown>;
      assertStrictPrepareMetadata(metadata);
      assert.deepEqual(metadata, {
        prepared: true,
        reason_code: 'prepared',
        mode: 'dry_run',
        resource,
        payload_sha256: payloadSha256,
        artifact_type: artifactByResource[resource],
        template_id: templateByResource[resource],
      });
      assert.doesNotMatch(body, new RegExp(capability));
      assert.doesNotMatch(body, /submission_01JTEST123|recipient|email|https?:|resource_url|filename|endpoint_path|calendar_url/i);
    });
    assert.deepEqual(calls, ['POST /rest/v1/rpc/resolve_transactional_intake_capability']);
  }
});

test('prepare HTTP rejects extra fields before resolving the capability', async () => {
  await withMockedSupabase(async () => { throw new Error('unexpected Supabase call'); }, async () => {
    const response = await POST(new Request('https://data.example.test/api/transactional/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.81' },
      body: JSON.stringify({ intake_capability: capability, expected_resource: 'calculator', mode: 'dry_run', recipient: 'x@example.test' }),
    }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { prepared: false, reason_code: 'invalid_request' });
  });
});

test('prepare HTTP rejects unavailable and mismatched capabilities with the same generic response', async () => {
  const rpcResults = [
    { valid: false, reason_code: 'capability_unavailable' },
    {
      valid: true,
      reason_code: 'valid',
      submission_id: 'submission_01JTEST123',
      resource: 'webinar',
      payload_sha256: payloadSha256,
    },
  ];
  for (const [index, rpcResult] of rpcResults.entries()) {
    await withMockedSupabase(async () => Response.json(rpcResult), async () => {
      const response = await POST(new Request('https://data.example.test/api/transactional/prepare', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `192.0.2.${90 + index}`,
        },
        body: JSON.stringify({
          intake_capability: capability,
          expected_resource: 'calculator',
          mode: 'dry_run',
        }),
      }));
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        prepared: false,
        reason_code: 'capability_rejected',
      });
    });
  }
});

test('prepare HTTP rejects oversized bodies before resolving capabilities', async () => {
  await withMockedSupabase(async () => { throw new Error('unexpected Supabase call'); }, async () => {
    const response = await POST(new Request('https://data.example.test/api/transactional/prepare', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '1025',
        'x-forwarded-for': '192.0.2.100',
      },
      body: '{}',
    }));
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { prepared: false, reason_code: 'invalid_request' });
  });
});

test('prepare HTTP fails closed when canonical resource configuration is unavailable', async () => {
  await withMockedSupabase(async () => Response.json({
    valid: true,
    reason_code: 'valid',
    submission_id: 'submission_01JTEST123',
    resource: 'calculator',
    payload_sha256: payloadSha256,
  }), async () => {
    delete process.env.TRANSACTIONAL_LANDING_ORIGIN;
    const response = await POST(new Request('https://data.example.test/api/transactional/prepare', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '192.0.2.101',
      },
      body: JSON.stringify({
        intake_capability: capability,
        expected_resource: 'calculator',
        mode: 'dry_run',
      }),
    }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { prepared: false, reason_code: 'prepare_unavailable' });
  });
});

test('prepare HTTP rate limit fails closed without resolving a capability', async () => {
  const previousNodeEnv = Object.getOwnPropertyDescriptor(process.env, 'NODE_ENV');
  Object.defineProperty(process.env, 'NODE_ENV', {
    configurable: true,
    enumerable: true,
    value: 'production',
    writable: true,
  });
  try {
    await withMockedSupabase(async (input) => {
      assert.equal(new URL(String(input)).pathname, '/rest/v1/rpc/consume_rate_limit');
      return Response.json({ message: 'rate limiter unavailable' }, { status: 503 });
    }, async () => {
      const response = await POST(new Request('https://data.example.test/api/transactional/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intake_capability: capability,
          expected_resource: 'calculator',
          mode: 'dry_run',
        }),
      }));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('retry-after'), '60');
      assert.deepEqual(await response.json(), {
        prepared: false,
        reason_code: 'prepare_unavailable',
      });
    });
  } finally {
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Object.defineProperty(process.env, 'NODE_ENV', previousNodeEnv);
  }
});
