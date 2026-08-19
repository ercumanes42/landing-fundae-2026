import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ALLOWLIST_PATH, COPY_PATH, PILOT_CAMPAIGN_ID, buildPilotRows } from './prepare-make-pilot.mjs';

const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
const matrix = JSON.parse(fs.readFileSync(COPY_PATH, 'utf8'));

test('pilot has four variants and twenty complete copies', () => {
  assert.equal(matrix.variants.length, 4);
  for (const variant of matrix.variants) {
    assert.deepEqual(variant.emails.map((email) => email.step), [1, 2, 3, 4, 5]);
    for (const email of variant.emails) assert.equal((email.body.match(/\{\{unsubscribe_url\}\}/g) || []).length, 1);
  }
});

test('four rows are isolated and fail closed', () => {
  const rows = buildPilotRows(allowlist, matrix);
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map((row) => row.variant_name)).size, 4);
  assert.ok(rows.every((row) => row.campaign_external_id === PILOT_CAMPAIGN_ID && row.campaign_external_id !== 'FUNDAE_2026_EMAIL_V1'));
  assert.ok(rows.every((row) => row.scenario_status === 'OFF' && row.internal_authorization === 'PENDING' && row.validacion_pre_envio === 'PENDING' && row.habilitado_envio === 'NO'));
  assert.ok(rows.every((row) => !Object.keys(row).some((key) => /^email_[67]_/.test(key))));
});
