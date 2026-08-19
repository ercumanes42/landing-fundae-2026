import { createHmac } from 'node:crypto';
import { leadHashSecret } from './env';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buildLeadId(email: string): string {
  const normalized = normalizeEmail(email);
  return createHmac('sha256', leadHashSecret())
    .update(normalized)
    .digest('hex');
}
