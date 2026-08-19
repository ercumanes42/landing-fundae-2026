import { createHash, createHmac } from 'node:crypto';

import { env } from './env';
import { callRpc } from './supabase';

const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/;
const TOKEN_PATTERN = /^u1\.[A-Za-z0-9_-]{43}$/;

interface IssueRpcResult {
  issued: boolean;
}

interface ConsumeRpcResult {
  accepted: boolean;
  duplicate: boolean;
}

export interface IssueUnsubscribeLinkInput {
  campaign_external_id: string;
  contact_id: string;
  token_version?: number;
  expires_at?: string | null;
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !EXTERNAL_ID_PATTERN.test(value.trim())) {
    throw new Error(`${field} is invalid`);
  }
}

function normalizeExpiry(value: unknown, now = Date.now()): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('expires_at is invalid');
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error('expires_at is invalid');
  if (milliseconds < now + 24 * 60 * 60_000 || milliseconds > now + 5 * 365 * 24 * 60 * 60_000) {
    throw new Error('expires_at must be between 24 hours and 5 years from now');
  }
  return new Date(milliseconds).toISOString();
}

export function validateIssueUnsubscribeLinkInput(
  input: unknown,
  now = Date.now(),
): IssueUnsubscribeLinkInput & { token_version: number; expires_at: string | null } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Payload must be an object');
  }

  const allowed = new Set(['campaign_external_id', 'contact_id', 'token_version', 'expires_at']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`${key} is not allowed`);
  }

  const value = input as Partial<IssueUnsubscribeLinkInput>;
  assertIdentifier(value.campaign_external_id, 'campaign_external_id');
  assertIdentifier(value.contact_id, 'contact_id');
  const tokenVersion = value.token_version ?? 1;
  if (!Number.isInteger(tokenVersion) || tokenVersion < 1 || tokenVersion > 100_000) {
    throw new Error('token_version is invalid');
  }

  return {
    campaign_external_id: value.campaign_external_id.trim(),
    contact_id: value.contact_id.trim(),
    token_version: tokenVersion,
    expires_at: normalizeExpiry(value.expires_at, now),
  };
}

export function createUnsubscribeToken(
  campaignExternalId: string,
  contactId: string,
  tokenVersion: number,
  secret: string,
): string {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('UNSUBSCRIBE_TOKEN_SECRET must contain at least 32 bytes');
  }
  if (/replace|change.?me|placeholder|example|xxxxx/i.test(secret)) {
    throw new Error('UNSUBSCRIBE_TOKEN_SECRET cannot be a placeholder');
  }
  assertIdentifier(campaignExternalId, 'campaign_external_id');
  assertIdentifier(contactId, 'contact_id');
  if (!Number.isInteger(tokenVersion) || tokenVersion < 1 || tokenVersion > 100_000) {
    throw new Error('token_version is invalid');
  }
  const digest = createHmac('sha256', secret)
    .update(`unsubscribe\0${campaignExternalId}\0${contactId}\0${tokenVersion}`)
    .digest('base64url');
  return `u1.${digest}`;
}

export function isUnsubscribeToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function hashUnsubscribeToken(token: string): string {
  if (!isUnsubscribeToken(token)) throw new Error('Invalid unsubscribe token');
  return createHash('sha256').update(token).digest('hex');
}

export function unsubscribePublicUrl(token: string, requestUrl?: string): string {
  if (!isUnsubscribeToken(token)) throw new Error('Invalid unsubscribe token');
  const configured = env('UNSUBSCRIBE_PUBLIC_BASE_URL').trim().replace(/\/+$/, '');
  let base = configured;

  if (!base && requestUrl) {
    const requestOrigin = new URL(requestUrl);
    if (!['localhost', '127.0.0.1', '::1'].includes(requestOrigin.hostname)) {
      throw new Error('UNSUBSCRIBE_PUBLIC_BASE_URL is required outside localhost');
    }
    base = requestOrigin.origin;
  }

  if (!base) throw new Error('UNSUBSCRIBE_PUBLIC_BASE_URL is required');
  const parsed = new URL(base);
  const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.username || parsed.password || (parsed.protocol !== 'https:' && !localHttp)) {
    throw new Error('UNSUBSCRIBE_PUBLIC_BASE_URL must be HTTPS');
  }
  return `${parsed.origin}/baja?token=${encodeURIComponent(token)}`;
}

export async function issueUnsubscribeLink(
  rawInput: unknown,
  requestUrl?: string,
): Promise<{ url: string; expiresAt: string | null }> {
  const input = validateIssueUnsubscribeLinkInput(rawInput);
  const token = createUnsubscribeToken(
    input.campaign_external_id,
    input.contact_id,
    input.token_version,
    env('UNSUBSCRIBE_TOKEN_SECRET'),
  );
  const tokenHash = hashUnsubscribeToken(token);
  const result = await callRpc<IssueRpcResult>('issue_campaign_unsubscribe_token', {
    p_campaign_external_id: input.campaign_external_id,
    p_contact_id: input.contact_id,
    p_token_hash: tokenHash,
    p_token_version: input.token_version,
    p_expires_at: input.expires_at,
  });
  if (!result.issued) throw new Error('Unsubscribe token could not be issued');
  return { url: unsubscribePublicUrl(token, requestUrl), expiresAt: input.expires_at };
}

export async function consumeUnsubscribeToken(
  token: string,
  occurredAt = new Date().toISOString(),
): Promise<{ accepted: boolean; duplicate: boolean }> {
  const tokenHash = hashUnsubscribeToken(token);
  const sourceEventId = `unsubscribe:${tokenHash.slice(0, 48)}`;
  const result = await callRpc<ConsumeRpcResult>('consume_campaign_unsubscribe_token', {
    p_token_hash: tokenHash,
    p_occurred_at: occurredAt,
    p_source_event_id: sourceEventId,
  });
  return { accepted: Boolean(result.accepted), duplicate: Boolean(result.duplicate) };
}
