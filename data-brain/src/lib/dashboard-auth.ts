const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const KEY_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const MIN_ITERATIONS = 600_000;
const MAX_ITERATIONS = 1_000_000;
const MAX_IDENTITIES = 32;
const MAX_CREDENTIALS = 2;

export interface DashboardCredential {
  key_id: string;
  salt: string;
  digest: string;
  not_before?: string;
  expires_at?: string;
}

export interface DashboardIdentity {
  username: string;
  credentials: DashboardCredential[];
}

export interface DashboardCredentialStore {
  version: 1;
  kdf: { name: 'PBKDF2-SHA256'; iterations: number };
  identities: DashboardIdentity[];
}

export type DashboardAuthResult =
  | { ok: true; actorHash: string; credentialKeyId: string }
  | { ok: false; reason: 'invalid_credentials' | 'configuration_error' };

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validInstant(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function isActive(credential: DashboardCredential, now: Date): boolean {
  return (!credential.not_before || Date.parse(credential.not_before) <= now.getTime()) &&
    (!credential.expires_at || Date.parse(credential.expires_at) > now.getTime());
}

export function parseDashboardCredentialStore(raw: string, now = new Date()): DashboardCredentialStore {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Invalid dashboard credential store');
  }
  if (!value || typeof value !== 'object') throw new Error('Invalid dashboard credential store');
  const store = value as Partial<DashboardCredentialStore>;
  if (store.version !== 1 || store.kdf?.name !== 'PBKDF2-SHA256' ||
      !Number.isInteger(store.kdf.iterations) || store.kdf.iterations < MIN_ITERATIONS ||
      store.kdf.iterations > MAX_ITERATIONS || !Array.isArray(store.identities) ||
      store.identities.length < 1 || store.identities.length > MAX_IDENTITIES) {
    throw new Error('Invalid dashboard credential store');
  }

  const usernames = new Set<string>();
  const credentialFingerprints = new Set<string>();
  for (const identity of store.identities) {
    if (!identity || typeof identity !== 'object' || !USERNAME_PATTERN.test(identity.username) ||
        identity.username !== identity.username.toLowerCase() || usernames.has(identity.username) ||
        !Array.isArray(identity.credentials) || identity.credentials.length < 1 ||
        identity.credentials.length > MAX_CREDENTIALS) {
      throw new Error('Invalid dashboard credential store');
    }
    usernames.add(identity.username);
    const keyIds = new Set<string>();
    let activeCount = 0;
    for (const credential of identity.credentials) {
      if (!credential || typeof credential !== 'object' || !KEY_ID_PATTERN.test(credential.key_id) ||
          keyIds.has(credential.key_id) ||
          (credential.not_before !== undefined && !validInstant(credential.not_before)) ||
          (credential.expires_at !== undefined && !validInstant(credential.expires_at))) {
        throw new Error('Invalid dashboard credential store');
      }
      keyIds.add(credential.key_id);
      const salt = decodeBase64Url(credential.salt);
      const digest = decodeBase64Url(credential.digest);
      const fingerprint = `${credential.salt}:${credential.digest}`;
      if (salt.length < 16 || salt.length > 32 || digest.length !== 32 || credentialFingerprints.has(fingerprint)) {
        throw new Error('Invalid dashboard credential store');
      }
      credentialFingerprints.add(fingerprint);
      if (credential.not_before && credential.expires_at &&
          Date.parse(credential.not_before) >= Date.parse(credential.expires_at)) {
        throw new Error('Invalid dashboard credential store');
      }
      if (isActive(credential, now)) activeCount += 1;
    }
    if (activeCount < 1) throw new Error('Invalid dashboard credential store');
  }
  return store as DashboardCredentialStore;
}

function parseBasicAuthorization(authorization: string | null): { username: string; password: string } | null {
  if (!authorization?.startsWith('Basic ') || authorization.length > 2_048) return null;
  try {
    const bytes = decodeBase64Url(authorization.slice(6).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const separator = decoded.indexOf(':');
    if (separator < 1) return null;
    const username = decoded.slice(0, separator).toLowerCase();
    const password = decoded.slice(separator + 1);
    return USERNAME_PATTERN.test(username) && password.length <= 512 ? { username, password } : null;
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256,
  ));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

async function actorHash(username: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return encodeHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`dashboard-actor-v1\0${username}`)));
}

export async function authenticateDashboardAuthorization(input: {
  authorization: string | null;
  credentialStore: string;
  pepper: string;
  legacyEnabled?: string;
  now?: Date;
}): Promise<DashboardAuthResult> {
  if (input.legacyEnabled !== undefined && input.legacyEnabled !== 'false') {
    return { ok: false, reason: 'configuration_error' };
  }
  if (new TextEncoder().encode(input.pepper).length < 32) return { ok: false, reason: 'configuration_error' };
  let store: DashboardCredentialStore;
  try {
    store = parseDashboardCredentialStore(input.credentialStore, input.now);
  } catch {
    return { ok: false, reason: 'configuration_error' };
  }
  const parsed = parseBasicAuthorization(input.authorization);
  const now = input.now ?? new Date();
  const identity = parsed ? store.identities.find((candidate) => candidate.username === parsed.username) : undefined;
  const fallback = store.identities[0].credentials.find((credential) => isActive(credential, now))!;
  const candidates = identity?.credentials.filter((credential) => isActive(credential, now)) ?? [];
  let matchedKeyId = '';
  let matched = false;
  for (let index = 0; index < MAX_CREDENTIALS; index += 1) {
    const credential = candidates[index] ?? fallback;
    const derived = await derive(parsed?.password ?? '', decodeBase64Url(credential.salt), store.kdf.iterations);
    const equal = constantTimeEqual(derived, decodeBase64Url(credential.digest));
    if (identity && index < candidates.length && equal) {
      matched = true;
      matchedKeyId = credential.key_id;
    }
  }
  if (!parsed || !identity || !matched) return { ok: false, reason: 'invalid_credentials' };
  return { ok: true, actorHash: await actorHash(identity.username, input.pepper), credentialKeyId: matchedKeyId };
}

export class AuthAttemptLimiter {
  private readonly attempts = new Map<string, { failures: number; resetAt: number }>();

  constructor(private readonly maxFailures: number, private readonly windowMs: number, private readonly maxKeys = 10_000) {}

  isAllowed(key: string, now = Date.now()): boolean {
    const state = this.attempts.get(key);
    if (!state || state.resetAt <= now) {
      if (state) this.attempts.delete(key);
      return true;
    }
    return state.failures < this.maxFailures;
  }

  recordFailure(key: string, now = Date.now()): void {
    const state = this.attempts.get(key);
    if (!state || state.resetAt <= now) {
      if (this.attempts.size >= this.maxKeys) this.attempts.delete(this.attempts.keys().next().value ?? '');
      this.attempts.set(key, { failures: 1, resetAt: now + this.windowMs });
      return;
    }
    state.failures += 1;
  }

  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }
}

export function dashboardAuthAudit(result: DashboardAuthResult, logger: Pick<Console, 'info' | 'warn'> = console): void {
  const event = result.ok
    ? { event: 'dashboard_auth', outcome: 'success', actor_hash: result.actorHash }
    : { event: 'dashboard_auth', outcome: 'failure', reason: result.reason };
  (result.ok ? logger.info : logger.warn)(JSON.stringify(event));
}
