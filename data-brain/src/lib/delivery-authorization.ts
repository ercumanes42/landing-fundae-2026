import { callRpc } from './supabase';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/;

export interface DeliveryAuthorizationInput {
  campaign_external_id: string;
  contact_id: string;
  execution_key: string;
}

interface DeliveryAuthorizationRpcResult {
  authorized: boolean;
  reason_code: string;
  lock_expires_at?: string | null;
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value.trim())) {
    throw new Error(`${field} is invalid`);
  }
}

export function validateDeliveryAuthorizationInput(input: unknown): DeliveryAuthorizationInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Payload must be an object');
  }
  const allowed = new Set(['campaign_external_id', 'contact_id', 'execution_key']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`${key} is not allowed`);
  }
  const value = input as Partial<DeliveryAuthorizationInput>;
  assertIdentifier(value.campaign_external_id, 'campaign_external_id');
  assertIdentifier(value.contact_id, 'contact_id');
  assertIdentifier(value.execution_key, 'execution_key');
  return {
    campaign_external_id: value.campaign_external_id.trim(),
    contact_id: value.contact_id.trim(),
    execution_key: value.execution_key.trim(),
  };
}

export async function authorizeCampaignDelivery(rawInput: unknown): Promise<{
  authorized: boolean;
  reasonCode: string;
  lockExpiresAt: string | null;
}> {
  const input = validateDeliveryAuthorizationInput(rawInput);
  const result = await callRpc<DeliveryAuthorizationRpcResult>('authorize_campaign_delivery', {
    p_campaign_external_id: input.campaign_external_id,
    p_contact_id: input.contact_id,
    p_execution_key: input.execution_key,
    p_authorized_at: new Date().toISOString(),
  });
  return {
    authorized: result.authorized === true,
    reasonCode: typeof result.reason_code === 'string' ? result.reason_code : 'blocked',
    lockExpiresAt: typeof result.lock_expires_at === 'string' ? result.lock_expires_at : null,
  };
}
