import fs from 'node:fs';

const workflowPath = '.github/workflows/release-gates.yml';
const expectedPins = new Map([
  ['actions/checkout', 'de0fac2e4500dabe0009e67214ff5f5447ce83dd'],
  ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
]);

const content = fs.readFileSync(workflowPath, 'utf8');
const uses = [...content.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
const failures = [];

for (const reference of uses) {
  if (reference.startsWith('./')) continue;
  const separator = reference.lastIndexOf('@');
  const action = separator > 0 ? reference.slice(0, separator) : reference;
  const revision = separator > 0 ? reference.slice(separator + 1) : '';
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    failures.push(`${reference} is not pinned to a full commit SHA`);
    continue;
  }
  const expected = expectedPins.get(action);
  if (!expected) failures.push(`${action} has no reviewed pin in verify-ci-pins.mjs`);
  else if (revision !== expected) failures.push(`${action} expected ${expected}, got ${revision}`);
}

for (const action of expectedPins.keys()) {
  if (!uses.some((reference) => reference.startsWith(`${action}@`))) failures.push(`${action} is missing from workflow`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[ci-pins] FAIL: ${failure}`);
  process.exit(1);
}

console.log(`[ci-pins] PASS ${uses.length} action references pinned to reviewed full SHAs.`);
