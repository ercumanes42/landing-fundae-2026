import assert from 'node:assert/strict';
import test from 'node:test';

import { BROWSER_STORAGE_REGISTRY } from '../../src/lib/browserStorage';

test('browser storage registry has unique keys and explicit category, retention and cleanup', () => {
  const entries = Object.values(BROWSER_STORAGE_REGISTRY);
  assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length);

  for (const entry of entries) {
    assert.ok(entry.category === 'preferences' || entry.category === 'analytics');
    assert.ok(entry.storageAreas.length > 0);
    assert.ok(entry.retention.length > 0);
    assert.ok(entry.ttlMs === null || entry.ttlMs > 0);
    assert.ok(entry.cleanup.length > 0);
  }
});

test('every analytics identifier is purged on consent withdrawal', () => {
  const analyticsEntries = Object.values(BROWSER_STORAGE_REGISTRY).filter(
    (entry) => entry.category === 'analytics',
  );
  assert.ok(analyticsEntries.length > 0);
  for (const entry of analyticsEntries) {
    assert.ok(entry.cleanup.includes('consent-withdrawal'), entry.key);
  }
});

test('active journey and session TTLs match the tracking contract', () => {
  assert.equal(BROWSER_STORAGE_REGISTRY.journey.ttlMs, 30 * 24 * 60 * 60 * 1000);
  assert.equal(BROWSER_STORAGE_REGISTRY.session.ttlMs, 30 * 60 * 1000);
  assert.equal(BROWSER_STORAGE_REGISTRY.analyticsConsent.retention, 'fixed');
  assert.equal(BROWSER_STORAGE_REGISTRY.analyticsConsent.ttlMs, 730 * 24 * 60 * 60 * 1000);
  assert.deepEqual(BROWSER_STORAGE_REGISTRY.analyticsConsent.storageAreas, ['localStorage']);
});
