import assert from 'node:assert/strict';
import test from 'node:test';

import { campaignStateForEvent, canEnqueueMarketing } from './campaign-state';

const occurredAt = '2026-08-11T10:00:00.000Z';

test('global unsubscribe stops both lanes and suppresses every delivery', () => {
  assert.deepEqual(campaignStateForEvent('unsubscribe', occurredAt, false), {
    cold_sequence_status: 'stopped',
    intent_sequence_status: 'stopped',
    marketing_lane: 'none',
    suppression_scope: 'all',
    stopped_at: occurredAt,
    stopped_reason: 'unsubscribe',
    suppressed_at: occurredAt,
    suppression_reason: 'unsubscribe',
  });
});

test('hard bounce and commercial conversion suppress marketing only', () => {
  assert.equal(campaignStateForEvent('bounce_hard', occurredAt, false).suppression_scope, 'marketing');
  const opposition = campaignStateForEvent('opposition', occurredAt, false);
  assert.equal(opposition.suppression_scope, 'marketing');
  assert.equal(opposition.cold_sequence_status, 'stopped');
  const meeting = campaignStateForEvent('meeting_booked', occurredAt, false);
  assert.equal(meeting.cold_sequence_status, 'stopped');
  assert.equal(meeting.intent_sequence_status, 'stopped');
  assert.equal(meeting.suppression_scope, 'marketing');
  assert.equal(meeting.stopped_reason, 'meeting_booked');
});

test('explicit intent never continues the cold campaign', () => {
  const disabled = campaignStateForEvent('diagnostic_requested', occurredAt, false);
  assert.equal(disabled.cold_sequence_status, 'stopped');
  assert.equal(disabled.intent_sequence_status, 'eligible_disabled');
  assert.equal(disabled.marketing_lane, 'none');

  const enabled = campaignStateForEvent('diagnostic_requested', occurredAt, true);
  assert.equal(enabled.cold_sequence_status, 'stopped');
  assert.equal(enabled.intent_sequence_status, 'pending');
  assert.equal(enabled.marketing_lane, 'intent');
});

test('resource completion requests transactional delivery and stops marketing', () => {
  const state = campaignStateForEvent('calculator_completed', occurredAt, false);
  assert.equal(state.cold_sequence_status, 'stopped');
  assert.equal(state.transactional_status, 'pending');
  assert.equal(state.marketing_lane, 'none');
});

test('transactional confirmation marks the resource delivery as sent', () => {
  const state = campaignStateForEvent('transactional_delivery_sent', occurredAt, false);
  assert.equal(state.transactional_status, 'sent');
});

test('reply stops the cold lane while unknown events are no-ops', () => {
  assert.equal(campaignStateForEvent('reply_received', occurredAt, false).cold_sequence_status, 'stopped');
  assert.deepEqual(campaignStateForEvent('page_view', occurredAt, false), {});
});

test('canEnqueueMarketing requires consent-compatible scope, feature flag and active lane', () => {
  assert.equal(canEnqueueMarketing({ lane: 'cold', coldEnabled: true, intentEnabled: false, suppressionScope: 'none', activeLane: 'cold' }), true);
  assert.equal(canEnqueueMarketing({ lane: 'cold', coldEnabled: true, intentEnabled: false, suppressionScope: 'marketing', activeLane: 'cold' }), false);
  assert.equal(canEnqueueMarketing({ lane: 'cold', coldEnabled: false, intentEnabled: true, suppressionScope: 'none', activeLane: 'cold' }), false);
  assert.equal(canEnqueueMarketing({ lane: 'intent', coldEnabled: false, intentEnabled: false, suppressionScope: 'none', activeLane: 'intent' }), false);
  assert.equal(canEnqueueMarketing({ lane: 'intent', coldEnabled: false, intentEnabled: true, suppressionScope: 'none', activeLane: 'cold' }), false);
  assert.equal(canEnqueueMarketing({ lane: 'intent', coldEnabled: false, intentEnabled: true, suppressionScope: 'none', activeLane: 'intent' }), true);
});
