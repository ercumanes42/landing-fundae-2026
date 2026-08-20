import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/release-gates.yml', import.meta.url), 'utf8');
const verifier = readFileSync(new URL('./verify-release.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const dataBrainPackageJson = JSON.parse(
  readFileSync(new URL('../../data-brain/package.json', import.meta.url), 'utf8'),
);
const vercelJson = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

const gates = [
  'test:release-candidate',
  'test:release-deploy-gate',
  'test:supabase-gate-pack',
  'release:supabase:gates:static',
];

test('GitHub release gates and the local verifier execute every release contract', () => {
  for (const gate of gates) {
    assert.equal(workflow.match(new RegExp(gate.replaceAll(':', '\\:'), 'g'))?.length, 1, `${gate} must run once in CI`);
    assert.equal(verifier.match(new RegExp(gate.replaceAll(':', '\\:'), 'g'))?.length, 1, `${gate} must run once locally`);
  }
});

test('CI fixtures include the complete no-send Graph pilot and same-origin E2E backend', () => {
  assert.match(workflow, /TRANSACTIONAL_GRAPH_PILOT_LIVE_ENABLED: 'false'/);
  assert.match(workflow, /TRANSACTIONAL_GRAPH_PILOT_TTL_SECONDS: '600'/);
  assert.match(workflow, /VITE_DATA_BRAIN_INGEST_URL: http:\/\/127\.0\.0\.1:4173/);
  assert.match(verifier, /VITE_DATA_BRAIN_INGEST_URL: 'http:\/\/127\.0\.0\.1:4173'/);
});

test('the Supabase static gate npm entrypoint is cross-platform', () => {
  assert.equal(
    packageJson.scripts['release:supabase:gates:static'],
    'node scripts/release/run-supabase-static-gates.mjs',
  );
  assert.doesNotMatch(workflow, /powershell\.exe/i);
});

test('the legal deploy gate is enforced only for an explicit production target', () => {
  assert.equal(
    packageJson.scripts['release:deploy:gate'],
    'node scripts/release/legal-deploy-gate.mjs',
  );
  assert.equal(
    packageJson.scripts['test:release-deploy-gate'],
    'node --test scripts/release/legal-deploy-gate.test.mjs',
  );
  assert.equal(workflow.match(/npm run release:deploy:gate/g)?.length, 1);
  assert.match(
    workflow,
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
  );
  assert.equal(verifier.match(/npmArgs\(\['run', 'release:deploy:gate'\]\)/g)?.length, 1);
  assert.match(verifier, /process\.env\.FUNDAE_RELEASE_TARGET === 'production'/);
  assert.doesNotMatch(packageJson.scripts.build, /release:deploy:gate/);
  assert.equal(
    packageJson.scripts['build:vercel'],
    'node scripts/release/legal-deploy-gate.mjs --vercel-production && vite build',
  );
  assert.equal(
    dataBrainPackageJson.scripts['build:vercel'],
    'node ../scripts/release/legal-deploy-gate.mjs --vercel-production && next build',
  );
  assert.equal(vercelJson.buildCommand, 'npm run build:vercel');
});
