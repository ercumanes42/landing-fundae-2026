import { selectRows } from './supabase';

export interface ContextSummary {
  total_leads: number;
  leads_this_week: number;
  leads_this_month: number;
  dead_letters_pending: number;
  by_classification: Array<{ value: string; count: number }>;
  by_magnet: Array<{ value: string; count: number; avg_score: number }>;
  by_sector: Array<{ value: string; count: number }>;
  by_province: Array<{ value: string; count: number }>;
  by_employee_range: Array<{ value: string; count: number }>;
  by_source: Array<{ value: string; count: number }>;
  scoring_averages: {
    avg_fit_score: number;
    avg_intent_score: number;
    avg_engagement_score: number;
    avg_urgency_score: number;
    avg_total_score: number;
  } | null;
  generated_at: string;
  crm_deal_stats?: {
    avg_speed_to_lead_minutes: number;
    deals_by_stage: Record<string, number>;
    total_revenue_won: number;
  };
  friction_analytics?: {
    question_dropoffs: Record<string, number>;
    critical_friction_question: string;
    total_validation_errors: number;
    rage_clicks_detected: number;
  };
  session_stats?: {
    avg_session_duration_seconds: number;
    conversions_by_device: Record<string, number>;
  };
}

export interface ContextLeads {
  leads: any[];
  count: number;
  period_days: number;
  limit_applied: number;
  truncated: boolean;
}

// Helpers for in-memory grouping and metrics calculations
function groupAndCount(data: any[], field: string): Array<{ value: string; count: number }> {
  if (!data) return [];
  const counts: Record<string, number> = {};
  data.forEach(row => {
    const key = row[field] ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  });
  return Object.entries(counts)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

function groupWithAvg(data: any[], groupField: string, avgField: string): Array<{ value: string; count: number; avg_score: number }> {
  if (!data) return [];
  const groups: Record<string, { count: number; sum: number }> = {};
  data.forEach(row => {
    const key = row[groupField] ?? 'unknown';
    if (!groups[key]) groups[key] = { count: 0, sum: 0 };
    groups[key].count++;
    groups[key].sum += row[avgField] ?? 0;
  });
  return Object.entries(groups)
    .map(([value, { count, sum }]) => ({
      value,
      count,
      avg_score: Math.round(sum / count),
    }))
    .sort((a, b) => b.count - a.count);
}

function computeAverages(data: any[]) {
  if (!data || data.length === 0) return null;
  const fields = ['fit_score', 'intent_score', 'engagement_score', 'urgency_score', 'lead_score'];
  const result: Record<string, number> = {};
  fields.forEach(f => {
    const values = data.map(r => r[f]).filter(v => v != null);
    const keyName = f === 'lead_score' ? 'avg_total_score' : `avg_${f}`;
    result[keyName] = values.length
      ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
      : 0;
  });
  return result as any;
}

/**
 * Strategy to dynamically limit leads count to avoid exceeding OpenAI context token limits
 */
export function selectContextStrategy(totalLeads: number): { limit: number; daysBack: number } {
  if (totalLeads < 200) {
    return { limit: 200, daysBack: 60 };
  } else if (totalLeads < 500) {
    return { limit: 150, daysBack: 30 };
  } else if (totalLeads < 2000) {
    return { limit: 100, daysBack: 15 };
  } else {
    return { limit: 50, daysBack: 7 };
  }
}

/**
 * Fetch and construct statistical summary context
 */
export async function getContextSummary(): Promise<ContextSummary> {
  const now = new Date();
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Retrieve last 1000 records to calculate trends and averages safely
  const rawData = await selectRows<any>('leads', 'select=lead_classification,lead_magnet,lead_score,created_at,fit_score,intent_score,engagement_score,urgency_score,payload,delivery_status&order=created_at.desc&limit=1000');

  let totalLeadsCount = rawData.length;
  if (totalLeadsCount === 1000) {
    try {
      await selectRows<any>('leads', 'select=id&limit=1');
      totalLeadsCount = 1000; 
    } catch {
      totalLeadsCount = 1000;
    }
  }

  // Fetch extended data science records from new tables
  let sessions: any[] = [];
  let crmDeals: any[] = [];
  let rawEvents: any[] = [];

  try {
    const [sessRes, dealRes, evRes] = await Promise.all([
      selectRows<any>('sessions', 'select=session_id,duration_seconds,converted_lead,ip_country,device_type,browser_name&limit=500').catch(() => []),
      selectRows<any>('crm_deals', 'select=lead_id,deal_stage,deal_value,speed_to_lead_seconds&limit=500').catch(() => []),
      selectRows<any>('events', 'select=event_name,anonymous_id,properties,occurred_at&limit=500').catch(() => []),
    ]);
    sessions = sessRes || [];
    crmDeals = dealRes || [];
    rawEvents = evRes || [];
  } catch (err) {
    console.error('Extended context fetch warning (tables may not exist yet):', err);
  }

  let leadsThisWeek = 0;
  let leadsThisMonth = 0;
  let deadLettersPending = 0;

  rawData.forEach(row => {
    const createdAt = new Date(row.created_at);
    if (createdAt >= startOfWeek) leadsThisWeek++;
    if (createdAt >= startOfMonth) leadsThisMonth++;
    if (row.delivery_status === 'dead_letter') deadLettersPending++;
  });

  const mappedDataForGrouping = rawData.map(r => ({
    classification: r.lead_classification,
    lead_magnet: r.lead_magnet,
    total_score: r.lead_score,
    fit_score: r.fit_score,
    intent_score: r.intent_score,
    engagement_score: r.engagement_score,
    urgency_score: r.urgency_score,
    sector: r.payload?.company?.sector || r.payload?.sector || 'unknown',
    province: r.payload?.company?.province || r.payload?.province || 'unknown',
    employee_range: r.payload?.company?.employee_range || r.payload?.employee_range || 'unknown',
    utm_source: r.payload?.utm_source || 'directo',
  }));

  const byClassification = groupAndCount(mappedDataForGrouping, 'classification');
  const byMagnet = groupWithAvg(mappedDataForGrouping, 'lead_magnet', 'total_score');
  const bySector = groupAndCount(mappedDataForGrouping, 'sector');
  const byProvince = groupAndCount(mappedDataForGrouping, 'province');
  const byEmployeeRange = groupAndCount(mappedDataForGrouping, 'employee_range');
  const bySource = groupAndCount(mappedDataForGrouping, 'utm_source');
  const scoringAverages = computeAverages(mappedDataForGrouping);

  // CRM metrics remain empty/zero until HubSpot has delivered actual data.
  let avgSpeedToLead = 0;
  let dealsByStage: Record<string, number> = {};
  let totalRevenueWon = 0;

  if (crmDeals.length > 0) {
    let speedSum = 0, speedCount = 0;
    let revenueSum = 0;
    const stages: Record<string, number> = {};
    crmDeals.forEach(d => {
      stages[d.deal_stage] = (stages[d.deal_stage] || 0) + 1;
      if (d.deal_stage === 'Cerrado-Ganado' || d.deal_stage === 'closed_won') {
        revenueSum += Number(d.deal_value) || 0;
      }
      if (typeof d.speed_to_lead_seconds === 'number' && d.speed_to_lead_seconds > 0) {
        speedSum += d.speed_to_lead_seconds;
        speedCount++;
      }
    });
    avgSpeedToLead = speedCount > 0 ? Math.round(speedSum / speedCount) : 0;
    dealsByStage = stages;
    totalRevenueWon = revenueSum;
  }

  let questionDropoffs: Record<string, number> = {};
  let criticalFrictionQuestion = '';
  let totalValidationErrors = 0;
  let rageClicksDetected = 0;

  if (rawEvents.length > 0) {
    const qCounts: Record<string, number> = {};
    let valErrors = 0;
    let rClicks = 0;
    rawEvents.forEach(e => {
      if (e.event_name === 'checklist_question_answered') {
        const qId = e.properties?.question_id || 'intro';
        qCounts[qId] = (qCounts[qId] || 0) + 1;
      } else if (e.event_name === 'validation_error' || e.event_name?.includes('error')) {
        valErrors++;
      } else if (e.event_name === 'rage_click') {
        rClicks++;
      }
    });
    if (Object.keys(qCounts).length > 0) {
      questionDropoffs = qCounts as any;
      let maxDrop = 0;
      let worstQ = '';
      const steps = ['intro', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'];
      for (let i = 0; i < steps.length - 1; i++) {
        const curr = qCounts[steps[i]] || 0;
        const next = qCounts[steps[i+1]] || 0;
        const drop = curr - next;
        if (drop > maxDrop && curr > 0) {
          maxDrop = drop;
          worstQ = steps[i+1];
        }
      }
      criticalFrictionQuestion = worstQ;
    }
    totalValidationErrors = valErrors;
    rageClicksDetected = rClicks;
  }

  let avgSessionDuration = 0;
  let conversionsByDevice: Record<string, number> = {};

  if (sessions.length > 0) {
    let durSum = 0, durCount = 0;
    const devices: Record<string, number> = {};
    sessions.forEach(s => {
      if (typeof s.duration_seconds === 'number') {
        durSum += s.duration_seconds;
        durCount++;
      }
      if (s.converted_lead && s.device_type) {
        devices[s.device_type] = (devices[s.device_type] || 0) + 1;
      }
    });
    avgSessionDuration = durCount > 0 ? Math.round(durSum / durCount) : 0;
    conversionsByDevice = devices;
  }

  return {
    total_leads: totalLeadsCount,
    leads_this_week: leadsThisWeek,
    leads_this_month: leadsThisMonth,
    dead_letters_pending: deadLettersPending,
    by_classification: byClassification,
    by_magnet: byMagnet,
    by_sector: bySector,
    by_province: byProvince,
    by_employee_range: byEmployeeRange,
    by_source: bySource,
    scoring_averages: scoringAverages,
    generated_at: now.toISOString(),
    crm_deal_stats: {
      avg_speed_to_lead_minutes: Math.round(avgSpeedToLead / 60),
      deals_by_stage: dealsByStage,
      total_revenue_won: totalRevenueWon,
    },
    friction_analytics: {
      question_dropoffs: questionDropoffs,
      critical_friction_question: criticalFrictionQuestion,
      total_validation_errors: totalValidationErrors,
      rage_clicks_detected: rageClicksDetected,
    },
    session_stats: {
      avg_session_duration_seconds: avgSessionDuration,
      conversions_by_device: conversionsByDevice,
    }
  };
}

/**
 * Fetch and construct recent individual leads list context (without PII)
 */
export async function getContextLeads(options: {
  limit?: number;
  daysBack?: number;
  magnet?: string;
  classification?: string;
} = {}): Promise<ContextLeads> {
  const { limit = 150, daysBack = 30, magnet, classification } = options;
  const safeLimit = Math.min(limit, 300);

  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  let query = `select=id,created_at,lead_classification,lead_magnet,fit_score,intent_score,engagement_score,urgency_score,lead_score,payload,delivery_status&order=created_at.desc&limit=${safeLimit}&created_at=gte.${since.toISOString()}`;
  
  if (magnet) {
    query += `&lead_magnet=eq.${encodeURIComponent(magnet)}`;
  }
  if (classification) {
    query += `&lead_classification=eq.${encodeURIComponent(classification)}`;
  }

  const rawLeads = await selectRows<any>('leads', query);

  const cleanLeads = rawLeads.map(l => ({
    id: l.id,
    created_at: l.created_at,
    classification: l.lead_classification,
    lead_magnet: l.lead_magnet,
    fit_score: l.fit_score,
    intent_score: l.intent_score,
    engagement_score: l.engagement_score,
    urgency_score: l.urgency_score,
    total_score: l.lead_score,
    sector: l.payload?.company?.sector || l.payload?.sector || 'No especificado',
    province: l.payload?.company?.province || l.payload?.province || 'No especificada',
    employee_range: l.payload?.company?.employee_range || l.payload?.employee_range || 'No especificado',
    utm_source: l.payload?.utm_source || 'directo',
    utm_campaign: l.payload?.utm_campaign || 'ninguna',
    recommended_action: l.payload?.ai_summary?.recommended_action || 'revisar_manual',
    delivery_status: l.delivery_status,
    confidence: l.payload?.ai_summary?.confidence ?? 1.0,
  }));

  return {
    leads: cleanLeads,
    count: cleanLeads.length,
    period_days: daysBack,
    limit_applied: safeLimit,
    truncated: cleanLeads.length === safeLimit,
  };
}
