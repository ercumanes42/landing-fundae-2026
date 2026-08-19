import { env, isInboundCapabilityEnabled } from './env';
import { SecureMicrosoftGraphClient } from './graph-secure-client';
import { createGraphTokenProvider } from './graph-runtime';
import { processGraphInboundMessage, sha256, SupabaseInboundRepository } from './inbound-reliability';
import { callRpc, selectRows } from './supabase';

function required(key: Parameters<typeof env>[0], minimum = 1): string {
  const value = env(key).trim();
  if (value.length < minimum) throw new Error('Inbound runtime is not configured');
  return value;
}

export async function executeConfiguredInboundMailboxTick() {
  if (!isInboundCapabilityEnabled('INBOUND_MAILBOX_ENABLED')) {
    return { state: 'off' as const, processed: 0, manualReview: 0, duplicates: 0 };
  }
  const timeoutMs = Math.max(250, Math.min(60_000, Number(env('GRAPH_REQUEST_TIMEOUT_MS')) || 10_000));
  const client = new SecureMicrosoftGraphClient({
    mailboxUserId: required('GRAPH_MAILBOX_USER_ID'),
    mailboxAddress: required('GRAPH_MAILBOX_ADDRESS'),
    accessToken: createGraphTokenProvider({
      tenantId: required('GRAPH_TENANT_ID'),
      clientId: required('GRAPH_CLIENT_ID'),
      clientSecret: required('GRAPH_CLIENT_SECRET', 16),
      timeoutMs,
    }),
    requestTimeoutMs: timeoutMs,
  });
  const [cursorRow] = await selectRows<{ cursor_value: string; cursor_hash: string }>(
    'inbound_sync_cursors',
    'select=cursor_value,cursor_hash&source=eq.microsoft_graph_inbox&limit=1',
  );
  const page = await client.listInboxDelta(
    cursorRow?.cursor_value ?? null,
    cursorRow ? undefined : required('INBOUND_MAILBOX_BOOTSTRAP_FROM'),
  );
  let processed = 0;
  let manualReview = 0;
  let duplicates = 0;
  const repository = new SupabaseInboundRepository();
  for (const message of page.messages) {
    const result = await processGraphInboundMessage(message, repository);
    if (result.reason === 'duplicate') duplicates += 1;
    else if (result.status === 'manual_review') manualReview += 1;
    else processed += 1;
  }
  const nextCursor = page.nextLink ?? page.deltaLink;
  if (!nextCursor) throw new Error('Graph delta response did not contain a cursor');
  await callRpc('advance_inbound_cursor', {
    p_source: 'microsoft_graph_inbox',
    p_expected_cursor_hash: cursorRow?.cursor_hash ?? null,
    p_next_cursor: nextCursor,
  });
  return { state: page.nextLink ? 'more' as const : 'caught_up' as const, processed, manualReview, duplicates, cursorHash: sha256(nextCursor) };
}
