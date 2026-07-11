import React from 'react';
import { selectRows } from '@/lib/supabase';
import { env, validateEnv, optionalIntegrationStatus } from '@/lib/env';
import { DashboardPanel } from './components/DashboardPanel';
import type { CampaignDashboardData } from './components/CampaignDashboard';

export const dynamic = 'force-dynamic';

export default async function DataBrainHome() {
  const validation = validateEnv();
  const integrations = optionalIntegrationStatus();

  let leads: any[] = [];
  let events: any[] = [];
  let queue: any[] = [];
  let dbError = false;
  let campaignData: CampaignDashboardData = { campaigns: [], contacts: [], events: [], error: null };

  if (validation.ok) {
    try {
      [leads, events, queue] = await Promise.all([
        selectRows('leads', 'select=id,lead_classification,lead_magnet,lead_score,created_at,payload,delivery_status&order=created_at.desc'),
        selectRows('events', 'select=*&order=created_at.desc&limit=5000'),
        selectRows('delivery_queue', 'select=status')
      ]);
    } catch (err) {
      console.error('[Dashboard] Supabase query failed:', err);
      dbError = true;
    }

    try {
      const [campaigns, contacts, campaignEvents] = await Promise.all([
        selectRows<CampaignDashboardData['campaigns'][number]>('campaigns', 'select=id,external_id,name,status&order=started_at.desc'),
        selectRows<CampaignDashboardData['contacts'][number]>('campaign_contacts', 'select=id,campaign_id,external_contact_id,variant,magnet,lot,company_size,sequence_status,next_delivery_status,last_delivery_status,reply_type,deal_value,conditional_delivery,locked_at,lock_expires_at,last_error_code&limit=1000'),
        selectRows<CampaignDashboardData['events'][number]>('campaign_events', 'select=id,campaign_id,campaign_contact_id,event_name,occurred_at&order=occurred_at.desc&limit=10000'),
      ]);
      campaignData = { campaigns, contacts, events: campaignEvents, error: null };
    } catch (error) {
      campaignData = {
        campaigns: [],
        contacts: [],
        events: [],
        error: error instanceof Error ? error.message : 'Campaign tables are not available',
      };
    }
  }

  // Aggregate metrics
  const leadsCount = leads.length;
  const eventsCount = events.length;

  const leadsByClassification = { cold: 0, warm: 0, hot: 0, priority: 0 };
  const leadsByMagnet = { calculator: 0, checklist: 0, interactive_checklist: 0, webinar: 0, diagnostic: 0, unknown: 0 };

  leads.forEach((l: any) => {
    const cls = (l.lead_classification || 'cold') as keyof typeof leadsByClassification;
    if (leadsByClassification[cls] !== undefined) leadsByClassification[cls]++;

    const mag = (l.lead_magnet || 'unknown') as keyof typeof leadsByMagnet;
    if (leadsByMagnet[mag] !== undefined) leadsByMagnet[mag]++;
  });

  const queueCounts = { queued: 0, delivered: 0, retrying: 0, dead_letter: 0 };
  queue.forEach((q: any) => {
    const status = (q.status || 'queued') as keyof typeof queueCounts;
    if (queueCounts[status] !== undefined) queueCounts[status]++;
  });

  let totalScroll = 0;
  let scrollCount = 0;
  let totalTime = 0;
  let timeCount = 0;

  leads.forEach((l: any) => {
    const journey = l.payload?.journey || {};
    if (typeof journey.scroll_depth === 'number') {
      totalScroll += journey.scroll_depth;
      scrollCount++;
    }
    if (typeof journey.time_on_page_seconds === 'number') {
      totalTime += journey.time_on_page_seconds;
      timeCount++;
    }
  });

  const avgScroll = scrollCount > 0 ? Math.round(totalScroll / scrollCount) : 0;
  const avgTime = timeCount > 0 ? Math.round(totalTime / timeCount) : 0;
  const videoPlayCount = events.filter(e => e.event_name === 'video_play').length;

  // Calculate unique visitors from events (fallback to leads count if no events are tracked yet)
  const uniqueVisitors = new Set(events.map(e => e.anonymous_id).filter(Boolean)).size;

  const dashboardData = {
    leadsCount,
    eventsCount,
    leadsByClassification,
    leadsByMagnet,
    queueCounts,
    integrations,
    validationOk: validation.ok && !dbError,
    missingEnvs: !validation.ok ? validation.missing : dbError ? ['SUPABASE_URL (Error de Conexión)'] : [],
    avgScroll,
    avgTime,
    videoPlayCount,
    uniqueVisitors,
    leadsList: leads.slice(0, 50),
    rawLeads: leads,
    rawEvents: events,
    campaign: campaignData,
  };

  return (
    <DashboardPanel initialData={dashboardData} />
  );
}
