import assert from 'node:assert/strict';
import test from 'node:test';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage, sessionStorage },
});

const {
  ANALYTICS_CONSENT_VERSION,
  getAnalyticsConsent,
  hasAnalyticsConsent,
  setAnalyticsConsent,
  subscribeAnalyticsConsent,
} = await import('../../src/lib/consent');
const { BROWSER_STORAGE_REGISTRY } = await import('../../src/lib/browserStorage');

test('only the current policy version can restore analytics consent', () => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('fundae_analytics_consent_v1', JSON.stringify({
    state: 'accepted',
    version: ANALYTICS_CONSENT_VERSION,
    updated_at: '2026-08-19T00:00:00.000Z',
  }));
  assert.equal(getAnalyticsConsent(), 'accepted');
});

test('stale or legacy consent is invalidated and analytics identifiers are cleared', () => {
  for (const storedConsent of [
    'accepted',
    JSON.stringify({ state: 'accepted', version: '2026-01-01', updated_at: '2026-01-01T00:00:00.000Z' }),
  ]) {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('fundae_analytics_consent_v1', storedConsent);
    localStorage.setItem('fundae_journey_v2', 'stored');
    sessionStorage.setItem('fundae_session_v2', 'stored');

    assert.equal(getAnalyticsConsent(), 'unknown');
    assert.equal(localStorage.getItem('fundae_analytics_consent_v1'), null);
    assert.equal(localStorage.getItem('fundae_journey_v2'), null);
    assert.equal(sessionStorage.getItem('fundae_session_v2'), null);
  }
});

test('expired or future-dated consent is invalidated', () => {
  for (const updatedAt of ['2024-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z']) {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('fundae_analytics_consent_v1', JSON.stringify({
      state: 'accepted',
      version: ANALYTICS_CONSENT_VERSION,
      updated_at: updatedAt,
    }));
    assert.equal(getAnalyticsConsent(), 'unknown');
  }
});

test('unknown consent emits nothing until an explicit accepted decision', () => {
  localStorage.clear();
  sessionStorage.clear();
  assert.equal(getAnalyticsConsent(), 'unknown');
  assert.equal(hasAnalyticsConsent(), false);
  setAnalyticsConsent('accepted');
  assert.equal(getAnalyticsConsent(), 'accepted');
  assert.equal(hasAnalyticsConsent(), true);
});

test('withdrawal clears journey/session/touch storage and notifies subscribers once', () => {
  const withdrawalEntries = Object.values(BROWSER_STORAGE_REGISTRY).filter(
    (entry) => entry.cleanup.includes('consent-withdrawal'),
  );
  for (const entry of withdrawalEntries) {
    for (const storageArea of entry.storageAreas) {
      ({ localStorage, sessionStorage })[storageArea].setItem(entry.key, 'stored');
    }
  }
  const observed: string[] = [];
  const unsubscribe = subscribeAnalyticsConsent((state) => observed.push(state));
  setAnalyticsConsent('rejected');
  unsubscribe();
  assert.equal(getAnalyticsConsent(), 'rejected');
  assert.deepEqual(observed, ['rejected']);
  for (const entry of withdrawalEntries) {
    for (const storageArea of entry.storageAreas) {
      assert.equal(({ localStorage, sessionStorage })[storageArea].getItem(entry.key), null);
    }
  }
  assert.notEqual(localStorage.getItem(BROWSER_STORAGE_REGISTRY.analyticsConsent.key), null);
});

test('an explicit decision remains effective in memory when storage is unavailable', () => {
  const original = globalThis.window.localStorage;
  Object.defineProperty(globalThis.window, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    },
  });
  setAnalyticsConsent('accepted');
  assert.equal(getAnalyticsConsent(), 'accepted');
  setAnalyticsConsent('rejected');
  assert.equal(getAnalyticsConsent(), 'rejected');
  Object.defineProperty(globalThis.window, 'localStorage', {
    configurable: true,
    value: original,
  });
});
