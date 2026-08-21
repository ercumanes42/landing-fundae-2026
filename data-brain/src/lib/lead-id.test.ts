import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, test } from 'node:test';

import {
  isValidLeadHashSecret,
  leadHashSecret,
  validateDashboardEnv,
  validateEnv,
} from './env';
import { buildLeadId } from './lead-id';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

test('LEAD_HASH_SECRET requires at least 32 UTF-8 bytes and rejects placeholders or surrounding whitespace', () => {
  assert.equal(isValidLeadHashSecret('k'.repeat(32)), true);
  assert.equal(isValidLeadHashSecret('ñ'.repeat(16)), true);
  assert.equal(isValidLeadHashSecret('k'.repeat(31)), false);
  assert.equal(isValidLeadHashSecret('replace-with-a-long-random-secret-value'), false);
  assert.equal(isValidLeadHashSecret(` ${'k'.repeat(32)}`), false);
  assert.equal(isValidLeadHashSecret(`${'k'.repeat(32)} `), false);
});

test('runtime env and buildLeadId fail closed without exposing an invalid secret', () => {
  const invalidSecret = 'replace-with-a-long-random-secret-value';
  Object.assign(process.env, {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    LEAD_HASH_SECRET: invalidSecret,
  });

  const validation = validateEnv();
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.deepEqual(validation.missing, ['LEAD_HASH_SECRET']);
  assert.throws(() => leadHashSecret(), /LEAD_HASH_SECRET_INVALID/);
  assert.throws(() => buildLeadId('person@example.invalid'), /LEAD_HASH_SECRET_INVALID/);
  assert.equal(JSON.stringify(validation).includes(invalidSecret), false);
});

test('dashboard validation is independent from capture identity configuration', () => {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    LEAD_HASH_SECRET: '',
    DATA_BRAIN_AUTH_CREDENTIALS: '{"version":1}',
    DATA_BRAIN_AUTH_PEPPER: 'p'.repeat(32),
  });

  assert.deepEqual(validateDashboardEnv(), { ok: true });
  assert.deepEqual(validateEnv(), { ok: false, missing: ['SUPABASE_ANON_KEY', 'LEAD_HASH_SECRET'] });
});

test('buildLeadId uses the exact validated secret and canonical email', () => {
  const secret = 'lead-identity-v1-'.padEnd(32, 'k');
  process.env.LEAD_HASH_SECRET = secret;
  const expected = createHmac('sha256', secret)
    .update('person@example.invalid')
    .digest('hex');
  assert.equal(buildLeadId(' Person@Example.Invalid '), expected);
});
