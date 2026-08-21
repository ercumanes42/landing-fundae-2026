import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./prepare-operational-workbook.mjs', import.meta.url),
  'utf8',
);

test('operational workbook preparation validates structure and opt-out without per-row legal evidence', () => {
  assert.match(source, /preparedValidation\.summary\.optOutCoverage\.missingBodies !== 0/);
  assert.match(source, /sourceHashBefore/);
  assert.match(source, /CAMPAIGN_OPERATIONAL_FILE must differ from the immutable CAMPAIGN_FILE/);
  assert.doesNotMatch(source, /LEGAL_EVIDENCE_HEADERS|legalBasisCoverage/);
  for (const obsoleteHeader of [
    'base_juridica_envio',
    'origen_datos',
    'referencia_evidencia',
    'fecha_evidencia',
  ]) {
    assert.equal(source.includes(obsoleteHeader), false);
  }
});

test('operational copy stays placeholder-only and never overwrites its immutable source', () => {
  assert.match(source, /mode !== 'placeholder'/);
  assert.match(source, /injectOptOutFooter\([\s\S]*?'\{\{unsubscribe_url\}\}'/);
  assert.match(source, /CAMPAIGN_OPERATIONAL_OVERWRITE/);
  assert.match(source, /if \(fileHash\(sourcePath\) !== sourceHashBefore\)/);
});
