import { createHmac } from 'node:crypto';
import { env } from './env';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buildLeadId(email: string): string {
  const normalized = normalizeEmail(email);
  return createHmac('sha256', env('LEAD_HASH_SECRET'))
    .update(normalized)
    .digest('hex');
}
