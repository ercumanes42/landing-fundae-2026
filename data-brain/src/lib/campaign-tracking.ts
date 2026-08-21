import { callRpc } from './supabase';
import {
  directionalMetricQuality,
  executionStatusForEvent,
  validateCanonicalTrackingInput,
  type CanonicalTrackingInput,
} from './tracking-contract';

interface TrackingRpcResult {
  event_id: string;
  execution_id: string;
  duplicate: boolean;
}

export async function recordCanonicalTrackingEvent(
  input: CanonicalTrackingInput,
): Promise<{ eventId: string; executionId: string; duplicate: boolean }> {
  validateCanonicalTrackingInput(input);

  const result = await callRpc<TrackingRpcResult>('record_campaign_tracking_event', {
    p_campaign_external_id: input.campaign_external_id,
    p_contact_id: input.contact_id,
    p_source_event_id: input.source_event_id,
    p_execution_key: input.execution_key,
    p_event_name: input.event_name,
    p_channel: input.channel,
    p_capture_method: input.capture_method,
    p_occurred_at: input.occurred_at || new Date().toISOString(),
    p_scheduled_for: input.scheduled_for ?? null,
    p_step: typeof input.properties?.step === 'number' ? input.properties.step : null,
    p_context: {
      ...(input.context ?? {}),
      metric_quality: directionalMetricQuality(input.event_name),
    },
    p_properties: input.properties ?? {},
    p_metric_quality: directionalMetricQuality(input.event_name),
    p_execution_status: executionStatusForEvent(input.event_name),
  });

  return {
    eventId: result.event_id,
    executionId: result.execution_id,
    duplicate: result.duplicate,
  };
}
