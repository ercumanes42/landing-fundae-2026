export type MarketingLane = 'cold' | 'intent' | 'none';
export type SuppressionScope = 'none' | 'marketing' | 'all';

export interface CampaignStatePatch {
  cold_sequence_status?: 'pending' | 'active' | 'stopped' | 'completed';
  intent_sequence_status?: 'not_eligible' | 'eligible_disabled' | 'pending' | 'active' | 'stopped' | 'completed';
  transactional_status?: 'not_requested' | 'pending' | 'sent' | 'failed';
  marketing_lane?: MarketingLane;
  suppression_scope?: SuppressionScope;
  stopped_at?: string;
  stopped_reason?: string;
  suppressed_at?: string;
  suppression_reason?: string;
}

const COMPLETION_EVENTS = new Set([
  'resource_completed',
  'checklist_downloaded',
  'calculator_completed',
  'webinar_registered',
  'review_submitted',
]);

const EXPLICIT_INTENT_EVENTS = new Set([
  'diagnostic_intent',
  'diagnostic_requested',
  'positive_reply',
]);

const COMMERCIAL_STOP_EVENTS = new Set([
  'meeting_booked',
  'meeting_completed',
  'opportunity_created',
]);

export function campaignStateForEvent(
  eventName: string,
  occurredAt: string,
  intentEnabled: boolean,
): CampaignStatePatch {
  if (eventName === 'unsubscribe' || eventName === 'bounce_hard' || eventName === 'opposition') {
    return {
      cold_sequence_status: 'stopped',
      intent_sequence_status: 'stopped',
      marketing_lane: 'none',
      suppression_scope: eventName === 'unsubscribe' ? 'all' : 'marketing',
      stopped_at: occurredAt,
      stopped_reason: eventName,
      suppressed_at: occurredAt,
      suppression_reason: eventName,
    };
  }

  if (COMMERCIAL_STOP_EVENTS.has(eventName)) {
    return {
      cold_sequence_status: 'stopped',
      intent_sequence_status: 'stopped',
      marketing_lane: 'none',
      suppression_scope: 'marketing',
      stopped_at: occurredAt,
      stopped_reason: eventName,
      suppressed_at: occurredAt,
      suppression_reason: eventName,
    };
  }

  if (EXPLICIT_INTENT_EVENTS.has(eventName)) {
    return {
      cold_sequence_status: 'stopped',
      intent_sequence_status: intentEnabled ? 'pending' : 'eligible_disabled',
      marketing_lane: intentEnabled ? 'intent' : 'none',
      stopped_at: occurredAt,
      stopped_reason: eventName,
    };
  }

  if (COMPLETION_EVENTS.has(eventName)) {
    return {
      cold_sequence_status: 'stopped',
      transactional_status: 'pending',
      marketing_lane: 'none',
      stopped_at: occurredAt,
      stopped_reason: eventName,
    };
  }

  if (eventName === 'transactional_delivery_sent') {
    return {
      transactional_status: 'sent',
    };
  }

  if (eventName === 'reply_received') {
    return {
      cold_sequence_status: 'stopped',
      marketing_lane: 'none',
      stopped_at: occurredAt,
      stopped_reason: eventName,
    };
  }

  return {};
}

export function canEnqueueMarketing(input: {
  lane: Exclude<MarketingLane, 'none'>;
  coldEnabled: boolean;
  intentEnabled: boolean;
  suppressionScope: SuppressionScope;
  activeLane: MarketingLane;
}): boolean {
  if (input.suppressionScope !== 'none') return false;
  if (input.lane === 'cold' && !input.coldEnabled) return false;
  if (input.lane === 'intent' && !input.intentEnabled) return false;
  return input.activeLane === input.lane;
}
