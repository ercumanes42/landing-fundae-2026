import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverSourceTests } from './run-src-tests.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function independentTestInventory(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return independentTestInventory(absolute);
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [absolute] : [];
  }).sort((left, right) => left.localeCompare(right));
}

test('the release test gate discovers every src TypeScript test without exclusions', () => {
  const expected = independentTestInventory(join(root, 'src'));
  assert.ok(expected.length > 0);
  assert.deepEqual(discoverSourceTests(), expected);
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.test, /run-src-tests\.mjs/);
  assert.doesNotMatch(packageJson.scripts.test, /src\/[^ ]+\.test\.ts/);
});
