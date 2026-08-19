import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/release-gates.yml', import.meta.url), 'utf8');
const verifier = readFileSync(new URL('./verify-release.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const gates = [
  'test:release-candidate',
  'test:supabase-gate-pack',
  'release:supabase:gates:static',
];

test('GitHub release gates and the local verifier execute every release contract', () => {
  for (const gate of gates) {
    assert.equal(workflow.match(new RegExp(gate.replaceAll(':', '\\:'), 'g'))?.length, 1, `${gate} must run once in CI`);
    assert.equal(verifier.match(new RegExp(gate.replaceAll(':', '\\:'), 'g'))?.length, 1, `${gate} must run once locally`);
  }
});

test('the Supabase static gate npm entrypoint is cross-platform', () => {
  assert.equal(
    packageJson.scripts['release:supabase:gates:static'],
    'node scripts/release/run-supabase-static-gates.mjs',
  );
  assert.doesNotMatch(workflow, /powershell\.exe/i);
});
