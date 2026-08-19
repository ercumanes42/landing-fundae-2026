import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { GraphInboundMessage } from './graph-secure-client';
import { hashInternetMessageId } from './graph-message-identity';
import { recordCanonicalTrackingEvent } from './campaign-tracking';
import { recordCampaignOperation } from './campaign';
import { callRpc, selectRows } from './supabase';

export type InboundTerminalStatus = 'processed' | 'manual_review' | 'rejected';
export interface InboundCorrelation { campaignId: string; campaignExternalId: string; contactId: string; externalContactId: string }
export interface InboundClaim { accepted: boolean; duplicate: boolean; busy: boolean; claimToken: string | null; status: string }

export interface InboundRepository {
  claim(provider: 'microsoft_graph' | 'calendly', sourceHash: string, kind: string, evidence: Record<string, unknown>): Promise<InboundClaim>;
  finalize(provider: 'microsoft_graph' | 'calendly', sourceHash: string, claimToken: string, status: InboundTerminalStatus, correlation: InboundCorrelation | null, reason: string): Promise<void>;
  correlate(conversationId: string | null, referenceHashes: string[]): Promise<InboundCorrelation[]>;
  correlateExternal(campaignExternalId: string, externalContactId: string): Promise<InboundCorrelation[]>;
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function headerValues(message: GraphInboundMessage, name: string): string[] {
  return message.internetMessageHeaders
    .filter((header) => header.name.toLowerCase() === name.toLowerCase())
    .map((header) => header.value);
}

export function messageReferenceHashes(message: GraphInboundMessage): string[] {
  const values = ['in-reply-to', 'references', 'original-message-id', 'x-original-message-id']
    .flatMap((name) => headerValues(message, name));
  const ids = values.flatMap((value) => value.match(/<[^<>\r\n]{3,2048}>/g) ?? []);
  return [...new Set(ids.map(hashInternetMessageId))];
}

export function classifyInboundMessage(message: GraphInboundMessage): {
  kind: 'human_reply' | 'dsn_permanent' | 'dsn_transient' | 'dsn_unknown';
  replyType?: 'POSITIVA' | 'NEGATIVA' | 'INFORMACION' | 'DERIVACION' | 'REUNION' | 'BAJA';
  dsnStatus?: string;
} {
  const contentType = headerValues(message, 'content-type').join(' ').toLowerCase();
  const isDsn = contentType.includes('multipart/report') && contentType.includes('delivery-status');
  const dsnText = `${message.uniqueBody ?? message.bodyPreview}\n${message.internetMessageHeaders.map((h) => h.value).join('\n')}`;
  if (isDsn) {
    const status = dsnText.match(/(?:^|\s)([45]\.\d{1,3}\.\d{1,3})(?:\s|$)/m)?.[1];
    if (status?.startsWith('5.')) return { kind: 'dsn_permanent', dsnStatus: status };
    if (status?.startsWith('4.')) return { kind: 'dsn_transient', dsnStatus: status };
    return { kind: 'dsn_unknown' };
  }
  if (!message.uniqueBody) return { kind: 'human_reply', replyType: 'INFORMACION' };
  const freshReply = message.uniqueBody
    .split(/^(?:>|-{2,}\s*(?:original message|mensaje original)|_{5,}|from:|de:|on .+ wrote:|el .+ escribio:)/im, 1)[0];
  const text = freshReply.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const explicitBaja = /^\s*(?:baja|unsubscribe)(?:\s*,?\s*por favor)?[.!\s]*$/.test(text) ||
    /\b(?:quiero|solicito|deseo|por favor)\s+(?:que me den de baja|darme de baja)\b/.test(text) ||
    /\bno me escrib(?:an|ais) (?:mas|de nuevo)\b/.test(text);
  if (explicitBaja) return { kind: 'human_reply', replyType: 'BAJA' };
  if (/\b(reunion|agend(?:a|ar|amos)|calendly)\b/.test(text)) return { kind: 'human_reply', replyType: 'REUNION' };
  if (/\b(no me interesa|no estoy interesad[oa])\b/.test(text)) return { kind: 'human_reply', replyType: 'NEGATIVA' };
  if (/\b(me interesa|estoy interesad[oa]|hablemos|llamadme)\b/.test(text)) return { kind: 'human_reply', replyType: 'POSITIVA' };
  if (/\b(contacta|escribe|habla) con\b/.test(text)) return { kind: 'human_reply', replyType: 'DERIVACION' };
  return { kind: 'human_reply', replyType: 'INFORMACION' };
}

async function emitTracking(correlation: InboundCorrelation, sourceHash: string, eventName: 'reply_received' | 'bounce_hard' | 'unsubscribe' | 'meeting_booked', properties: Record<string, unknown>) {
  return recordCanonicalTrackingEvent({
    campaign_external_id: correlation.campaignExternalId,
    contact_id: correlation.externalContactId,
    event_name: eventName,
    source_event_id: `inbound:${sourceHash}:${eventName}`,
    execution_key: `inbound:${sourceHash}:${eventName}`,
    channel: 'email',
    capture_method: 'official_api',
    context: { provider: eventName === 'meeting_booked' ? 'calendly' : 'microsoft_graph', provider_event_id: sourceHash },
    properties,
  });
}

export interface InboundEffects {
  track(correlation: InboundCorrelation, sourceHash: string, eventName: 'reply_received' | 'bounce_hard' | 'unsubscribe' | 'meeting_booked', properties: Record<string, unknown>): Promise<unknown>;
  positiveReply(correlation: InboundCorrelation, sourceHash: string, occurredAt: string): Promise<unknown>;
}

const defaultEffects: InboundEffects = {
  track: emitTracking,
  positiveReply: (correlation, sourceHash, occurredAt) => recordCampaignOperation({
    campaign_external_id: correlation.campaignExternalId,
    contact_id: correlation.externalContactId,
    event_name: 'positive_reply',
    source_event_id: `inbound:${sourceHash}:positive_reply`,
    occurred_at: occurredAt,
    reply_type: 'positive',
  }),
};

export async function processGraphInboundMessage(message: GraphInboundMessage, repository: InboundRepository, effects: InboundEffects = defaultEffects): Promise<{ status: string; reason: string }> {
  const sourceHash = sha256(message.id);
  const classification = classifyInboundMessage(message);
  const claim = await repository.claim('microsoft_graph', sourceHash, classification.kind, {
    received_at: message.receivedDateTime,
    has_conversation_id: Boolean(message.conversationId),
    reference_count: messageReferenceHashes(message).length,
  });
  if (!claim.accepted) return { status: claim.status as InboundTerminalStatus, reason: claim.duplicate ? 'duplicate' : 'busy' };
  const correlations = await repository.correlate(message.conversationId, messageReferenceHashes(message));
  if (correlations.length !== 1) {
    await repository.finalize('microsoft_graph', sourceHash, claim.claimToken!, 'manual_review', null, correlations.length ? 'ambiguous_correlation' : 'unmatched');
    return { status: 'manual_review', reason: correlations.length ? 'ambiguous_correlation' : 'unmatched' };
  }
  const correlation = correlations[0];
  if (classification.kind === 'dsn_transient') {
    await repository.finalize('microsoft_graph', sourceHash, claim.claimToken!, 'processed', correlation, 'transient_dsn_no_hard_bounce');
    return { status: 'processed', reason: 'transient_dsn_no_hard_bounce' };
  }
  if (classification.kind === 'dsn_unknown') {
    await repository.finalize('microsoft_graph', sourceHash, claim.claimToken!, 'manual_review', correlation, 'unknown_dsn');
    return { status: 'manual_review', reason: 'unknown_dsn' };
  }
  if (classification.kind === 'dsn_permanent') {
    await effects.track(correlation, sourceHash, 'bounce_hard', { bounce_type: 'permanent', status_code: classification.dsnStatus! });
  } else {
    await effects.track(correlation, sourceHash, 'reply_received', { reply_type: classification.replyType! });
    if (classification.replyType === 'POSITIVA') await effects.positiveReply(correlation, sourceHash, message.receivedDateTime);
    if (classification.replyType === 'BAJA') await effects.track(correlation, sourceHash, 'unsubscribe', { reason_code: 'explicit_reply_baja' });
  }
  await repository.finalize('microsoft_graph', sourceHash, claim.claimToken!, 'processed', correlation, classification.kind);
  return { status: 'processed', reason: classification.kind };
}

export function verifyCalendlySignature(rawBody: string, signatureHeader: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1_000)): boolean {
  if (secret.length < 32 || !signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map((part) => part.trim().split('=', 2)));
  const timestamp = Number(parts.t);
  const supplied = parts.v1;
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300 || !/^[a-f0-9]{64}$/i.test(supplied ?? '')) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const left = Buffer.from(supplied, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function parseCalendlyInviteeCreated(raw: unknown): { sourceHash: string; occurredAt: string; campaignExternalId: string; externalContactId: string } {
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const payload = body.payload && typeof body.payload === 'object' ? body.payload as Record<string, unknown> : {};
  const tracking = payload.tracking && typeof payload.tracking === 'object' ? payload.tracking as Record<string, unknown> : {};
  if (body.event !== 'invitee.created' || payload.status !== 'active' || typeof payload.uri !== 'string' ||
      typeof body.created_at !== 'string' || !Number.isFinite(Date.parse(body.created_at)) ||
      typeof tracking.utm_campaign !== 'string' || typeof tracking.utm_content !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(tracking.utm_campaign) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(tracking.utm_content)) {
    throw new Error('Calendly invitee.created payload is not correlatable');
  }
  return { sourceHash: sha256(`${body.event}:${payload.uri}`), occurredAt: new Date(body.created_at).toISOString(), campaignExternalId: tracking.utm_campaign, externalContactId: tracking.utm_content };
}

export async function processCalendlyInviteeCreated(input: ReturnType<typeof parseCalendlyInviteeCreated>, repository: InboundRepository, effects: InboundEffects = defaultEffects) {
  const claim = await repository.claim('calendly', input.sourceHash, 'invitee.created', { occurred_at: input.occurredAt, correlation: 'utm_campaign+utm_content' });
  if (!claim.accepted) return { status: claim.status, reason: claim.duplicate ? 'duplicate' : 'busy' };
  const correlations = await repository.correlateExternal(input.campaignExternalId, input.externalContactId);
  if (correlations.length !== 1) {
    await repository.finalize('calendly', input.sourceHash, claim.claimToken!, 'manual_review', null, correlations.length ? 'ambiguous_correlation' : 'unmatched');
    return { status: 'manual_review', reason: correlations.length ? 'ambiguous_correlation' : 'unmatched' };
  }
  await effects.track(correlations[0], input.sourceHash, 'meeting_booked', { platform: 'calendly' });
  await repository.finalize('calendly', input.sourceHash, claim.claimToken!, 'processed', correlations[0], 'meeting_booked');
  return { status: 'processed', reason: 'meeting_booked' };
}

interface ContactRow { id: string; campaign_id: string; external_contact_id: string }
type SelectRows = <T>(table: string, query: string) => Promise<T[]>;
export class SupabaseInboundRepository implements InboundRepository {
  constructor(private readonly select: SelectRows = selectRows) {}

  async claim(provider: 'microsoft_graph' | 'calendly', sourceHash: string, kind: string, evidence: Record<string, unknown>) {
    return callRpc<InboundClaim>('claim_inbound_event', { p_provider: provider, p_source_event_hash: sourceHash, p_event_kind: kind, p_evidence: evidence, p_lease_seconds: 120 });
  }
  async finalize(provider: 'microsoft_graph' | 'calendly', sourceHash: string, claimToken: string, status: InboundTerminalStatus, correlation: InboundCorrelation | null, reason: string) {
    await callRpc('finalize_inbound_event', { p_provider: provider, p_source_event_hash: sourceHash, p_claim_token: claimToken, p_status: status, p_campaign_id: correlation?.campaignId ?? null, p_campaign_contact_id: correlation?.contactId ?? null, p_reason_code: reason });
  }
  async hydrate(rows: ContactRow[]): Promise<InboundCorrelation[]> {
    const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
    const results: InboundCorrelation[] = [];
    for (const row of unique) {
      const campaigns = await this.select<{ external_id: string }>('campaigns', `select=external_id&id=eq.${encodeURIComponent(row.campaign_id)}&limit=1`);
      if (campaigns[0]) results.push({ campaignId: row.campaign_id, campaignExternalId: campaigns[0].external_id, contactId: row.id, externalContactId: row.external_contact_id });
    }
    return results;
  }
  async correlate(conversationId: string | null, referenceHashes: string[]) {
    const rows: ContactRow[] = [];
    if (conversationId) rows.push(...await this.select<ContactRow>('campaign_contacts', `select=id,campaign_id,external_contact_id&outlook_conversation_id=eq.${encodeURIComponent(conversationId)}&limit=3`));
    for (const hash of referenceHashes) {
      const outbox = await this.select<{ campaign_contact_id: string; campaign_id: string }>('graph_outbox', `select=campaign_contact_id,campaign_id&internet_message_id_hash=eq.${hash}&lane=eq.cold&limit=3`);
      for (const item of outbox) {
        const contacts = await this.select<ContactRow>('campaign_contacts', `select=id,campaign_id,external_contact_id&id=eq.${encodeURIComponent(item.campaign_contact_id)}&campaign_id=eq.${encodeURIComponent(item.campaign_id)}&limit=1`);
        rows.push(...contacts);
      }
    }
    return this.hydrate(rows);
  }
  async correlateExternal(campaignExternalId: string, externalContactId: string) {
    const campaigns = await this.select<{ id: string }>('campaigns', `select=id&external_id=eq.${encodeURIComponent(campaignExternalId)}&limit=2`);
    if (campaigns.length !== 1) return [];
    return this.hydrate(await this.select<ContactRow>('campaign_contacts', `select=id,campaign_id,external_contact_id&campaign_id=eq.${encodeURIComponent(campaigns[0].id)}&external_contact_id=eq.${encodeURIComponent(externalContactId)}&limit=2`));
  }
}
