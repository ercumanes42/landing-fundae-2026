import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import type { GraphInboundMessage } from './graph-secure-client';
import { hashInternetMessageId } from './graph-message-identity';
import {
  classifyInboundMessage,
  messageReferenceHashes,
  parseCalendlyInviteeCreated,
  verifyCalendlySignature,
  processGraphInboundMessage,
  processCalendlyInviteeCreated,
  SupabaseInboundRepository,
  type InboundCorrelation,
  type InboundEffects,
  type InboundRepository,
} from './inbound-reliability';

function message(overrides: Partial<GraphInboundMessage> = {}): GraphInboundMessage {
  return {
    id: 'immutable-message-1', conversationId: 'conversation-1', internetMessageId: '<reply@example.test>',
    receivedDateTime: '2026-08-19T08:00:00.000Z', subject: 'Re: FUNDAE', bodyPreview: 'Necesito más información',
    uniqueBody: 'Necesito más información',
    internetMessageHeaders: [{ name: 'In-Reply-To', value: '<outbound@example.test>' }], ...overrides,
  };
}

test('correlation evidence hashes conversation-independent provider headers and never email addresses', () => {
  const hashes = messageReferenceHashes(message());
  assert.equal(hashes.length, 1);
  assert.match(hashes[0], /^[a-f0-9]{64}$/);
  assert.doesNotMatch(hashes[0], /@/);
});

test('outbound Message-ID digest correlates an inbound References header to exactly one contact', async () => {
  const outboundMessageId = '<outbound@example.test>';
  const expectedHash = hashInternetMessageId(outboundMessageId);
  const queries: string[] = [];
  const select = async <T,>(table: string, query: string): Promise<T[]> => {
    queries.push(`${table}?${query}`);
    if (table === 'graph_outbox' && query.includes(`internet_message_id_hash=eq.${expectedHash}`)) {
      return [{ campaign_contact_id: 'contact-id', campaign_id: 'campaign-id' }] as T[];
    }
    if (table === 'campaign_contacts' && query.includes('id=eq.contact-id')) {
      return [{ id: 'contact-id', campaign_id: 'campaign-id', external_contact_id: 'contact_001' }] as T[];
    }
    if (table === 'campaigns' && query.includes('id=eq.campaign-id')) {
      return [{ external_id: 'FUNDAE_2026_EMAIL_V1' }] as T[];
    }
    return [];
  };
  const references = messageReferenceHashes(message({
    conversationId: null,
    internetMessageHeaders: [{ name: 'References', value: outboundMessageId }],
  }));
  const correlations = await new SupabaseInboundRepository(select).correlate(null, references);

  assert.deepEqual(references, [expectedHash]);
  assert.deepEqual(correlations, [correlation]);
  assert.equal(queries.some((query) => query.includes('example.test')), false);
});

test('human replies always stop and deterministic BAJA/positive classification is conservative', () => {
  assert.deepEqual(classifyInboundMessage(message({ uniqueBody: 'BAJA, por favor' })), { kind: 'human_reply', replyType: 'BAJA' });
  assert.deepEqual(classifyInboundMessage(message({ uniqueBody: 'Me interesa, hablemos' })), { kind: 'human_reply', replyType: 'POSITIVA' });
  assert.deepEqual(classifyInboundMessage(message({ uniqueBody: '¿Puedes ampliar información?' })), { kind: 'human_reply', replyType: 'INFORMACION' });
});

test('unsubscribe copy in quoted history never turns a positive reply into BAJA', () => {
  const reply = message({
    bodyPreview: 'Me interesa\n-----Mensaje original-----\nPuedes darte de baja aquí',
    uniqueBody: 'Me interesa\n-----Mensaje original-----\nPuedes darte de baja aquí',
  });
  assert.deepEqual(classifyInboundMessage(reply), { kind: 'human_reply', replyType: 'POSITIVA' });
  assert.deepEqual(
    classifyInboundMessage(message({ uniqueBody: 'Gracias. En el pie pone: Puedes darte de baja aquí.' })),
    { kind: 'human_reply', replyType: 'INFORMACION' },
  );
  assert.deepEqual(classifyInboundMessage(message({ uniqueBody: null, bodyPreview: 'BAJA en texto no confiable' })), { kind: 'human_reply', replyType: 'INFORMACION' });
});

test('only explicit permanent DSN is hard bounce; transient and unknown remain non-hard', () => {
  const headers = [{ name: 'Content-Type', value: 'multipart/report; report-type=delivery-status' }];
  assert.deepEqual(classifyInboundMessage(message({ uniqueBody: 'Status: 5.1.1', internetMessageHeaders: headers })), { kind: 'dsn_permanent', dsnStatus: '5.1.1' });
  assert.deepEqual(classifyInboundMessage(message({ uniqueBody: 'Status: 4.4.1', internetMessageHeaders: headers })), { kind: 'dsn_transient', dsnStatus: '4.4.1' });
  assert.deepEqual(classifyInboundMessage(message({ uniqueBody: 'Delivery delayed', internetMessageHeaders: headers })), { kind: 'dsn_unknown' });
});

test('Calendly signature rejects forgery and replay while valid invitee.created uses UTM correlation', () => {
  const secret = 's'.repeat(32);
  const raw = JSON.stringify({ event: 'invitee.created', created_at: '2026-08-19T08:00:00Z', payload: { uri: 'https://api.calendly.com/scheduled_events/e/invitees/i', status: 'active', tracking: { utm_campaign: 'FUNDAE_2026_EMAIL_V1', utm_content: 'contact_001' } } });
  const timestamp = 1_776_240_000;
  const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  assert.equal(verifyCalendlySignature(raw, `t=${timestamp},v1=${signature}`, secret, timestamp), true);
  assert.equal(verifyCalendlySignature(`${raw} `, `t=${timestamp},v1=${signature}`, secret, timestamp), false);
  assert.equal(verifyCalendlySignature(raw, `t=${timestamp},v1=${signature}`, secret, timestamp + 301), false);
  const parsed = parseCalendlyInviteeCreated(JSON.parse(raw));
  assert.equal(parsed.campaignExternalId, 'FUNDAE_2026_EMAIL_V1');
  assert.equal(parsed.externalContactId, 'contact_001');
  assert.match(parsed.sourceHash, /^[a-f0-9]{64}$/);
});

test('Calendly without supported UTM identifiers is never correlated by email', () => {
  assert.throws(() => parseCalendlyInviteeCreated({ event: 'invitee.created', created_at: '2026-08-19T08:00:00Z', payload: { uri: 'https://api.calendly.com/x', status: 'active', email: 'person@example.test', tracking: {} } }), /not correlatable/);
});

function harness(correlations: InboundCorrelation[]) {
  const terminal = new Map<string, string>();
  const effectsLog: string[] = [];
  const claimed = new Set<string>();
  const repository: InboundRepository = {
    claim: async (_provider, hash) => {
      if (claimed.has(hash)) return { accepted: false, duplicate: true, busy: false, claimToken: null, status: terminal.get(hash) ?? 'processed' };
      claimed.add(hash);
      return { accepted: true, duplicate: false, busy: false, claimToken: '123e4567-e89b-42d3-a456-426614174000', status: 'processing' };
    },
    finalize: async (_provider, hash, _token, status, _correlation, reason) => { terminal.set(hash, `${status}:${reason}`); },
    correlate: async () => correlations,
    correlateExternal: async () => correlations,
  };
  const effects: InboundEffects = {
    track: async (_correlation, _hash, eventName) => { effectsLog.push(eventName); },
    positiveReply: async () => { effectsLog.push('positive_reply_task'); },
  };
  return { repository, effects, effectsLog, terminal };
}

const correlation: InboundCorrelation = { campaignId: 'campaign-id', campaignExternalId: 'FUNDAE_2026_EMAIL_V1', contactId: 'contact-id', externalContactId: 'contact_001' };

test('provider replay is idempotent and BAJA emits reply stop plus global unsubscribe once', async () => {
  const state = harness([correlation]);
  const baja = message({ uniqueBody: 'BAJA' });
  assert.deepEqual(await processGraphInboundMessage(baja, state.repository, state.effects), { status: 'processed', reason: 'human_reply' });
  assert.deepEqual(await processGraphInboundMessage(baja, state.repository, state.effects), { status: 'processed:human_reply', reason: 'duplicate' });
  assert.deepEqual(state.effectsLog, ['reply_received', 'unsubscribe']);
});

test('ambiguous and unmatched replies are durable manual review and have no side effect', async () => {
  for (const correlations of [[], [correlation, { ...correlation, contactId: 'other' }]]) {
    const state = harness(correlations);
    const result = await processGraphInboundMessage(message({ id: `message-${correlations.length}` }), state.repository, state.effects);
    assert.equal(result.status, 'manual_review');
    assert.deepEqual(state.effectsLog, []);
  }
});

test('out-of-order positive replies remain idempotent and request the existing task contract', async () => {
  const state = harness([correlation]);
  await processGraphInboundMessage(message({ id: 'newer', receivedDateTime: '2026-08-19T09:00:00Z', uniqueBody: 'Me interesa' }), state.repository, state.effects);
  await processGraphInboundMessage(message({ id: 'older', receivedDateTime: '2026-08-19T08:00:00Z', uniqueBody: 'Me interesa' }), state.repository, state.effects);
  assert.deepEqual(state.effectsLog, ['reply_received', 'positive_reply_task', 'reply_received', 'positive_reply_task']);
});

test('Calendly replay emits meeting stop once', async () => {
  const state = harness([correlation]);
  const input = { sourceHash: 'a'.repeat(64), occurredAt: '2026-08-19T08:00:00.000Z', campaignExternalId: correlation.campaignExternalId, externalContactId: correlation.externalContactId };
  await processCalendlyInviteeCreated(input, state.repository, state.effects);
  await processCalendlyInviteeCreated(input, state.repository, state.effects);
  assert.deepEqual(state.effectsLog, ['meeting_booked']);
});
