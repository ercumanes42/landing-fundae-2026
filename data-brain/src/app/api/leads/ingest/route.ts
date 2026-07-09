import { NextResponse } from 'next/server';
import { assertEnv } from '@/lib/env';
import { enqueueAndAttemptDelivery } from '@/lib/delivery';
import { buildLeadId } from '@/lib/lead-id';
import { sendPriorityNotification } from '@/lib/notification';
import { summarizeLead } from '@/lib/openai';
import { calculateLeadScoreBreakdown, classifyLead } from '@/lib/scoring';
import { insertRow, updateById } from '@/lib/supabase';
import type { AISummary, LeadPayload, LeadScoringInput } from '@/lib/types';

export const runtime = 'nodejs';

interface LeadRow {
  id: string;
  lead_id: string;
  delivery_status?: string;
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function statusFromScore(score: number): string {
  const classification = classifyLead(score);
  return {
    cold: 'frio',
    warm: 'templado',
    hot: 'caliente',
    priority: 'prioritario',
  }[classification];
}

function scoringInputFromLead(lead: LeadPayload): LeadScoringInput {
  return {
    employee_range: lead.company?.employee_range,
    used_fundae_before: lead.company?.used_fundae_before,
    knows_credit: lead.company?.knows_credit,
    training_area: lead.interest?.training_area,
    form_type: lead.form_type,
    urgency: lead.interest?.urgency,
    sector: lead.company?.sector,
    province: lead.company?.province,
    role: lead.contact?.role,
    risk_level: lead.interactive_checklist?.risk_level,
    journey: lead.journey,
    answers: lead.interactive_checklist?.answers,
  };
}

function fallbackSummary(error: unknown): AISummary {
  return {
    ai_summary:
      'Resumen IA no disponible. Lead guardado correctamente para revision comercial manual.',
    priority_reason:
      'No se pudo generar el resumen automaticamente, por lo que conviene revisar los datos del lead antes de decidir prioridad.',
    recommended_action: 'revisar_manual',
    sales_angle: 'Revision consultiva de oportunidad FUNDAE.',
    risk_notes: error instanceof Error ? error.message : 'Error desconocido en resumen IA.',
    confidence: 0,
  };
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    assertEnv();
    const input = (await request.json()) as LeadPayload;

    if (!input?.contact?.email || !input?.form_type) {
      return NextResponse.json(
        { error: 'Invalid lead payload: contact.email and form_type are required' },
        { status: 400, headers: corsHeaders() },
      );
    }

    const leadId = buildLeadId(input.contact.email);
    const scoring = calculateLeadScoreBreakdown(scoringInputFromLead(input));
    const lead: LeadPayload = {
      ...input,
      lead_id: leadId,
      scoring,
      lead_score: scoring.total,
      lead_status: statusFromScore(scoring.total),
      lead_classification: scoring.classification,
      delivery_status: 'queued',
    };

    const inserted = await insertRow<LeadRow>('leads', {
      lead_id: leadId,
      anonymous_id: lead.anonymous_id,
      session_id: lead.session_id,
      form_type: lead.form_type,
      lead_magnet: lead.lead_magnet,
      lead_score: lead.lead_score,
      lead_classification: lead.lead_classification,
      fit_score: scoring.fit,
      intent_score: scoring.intent,
      engagement_score: scoring.engagement,
      urgency_score: scoring.urgency,
      ai_summary: null,
      delivery_status: 'queued',
      payload: lead,
      created_at: lead.created_at,
    });

    let summary: AISummary;
    try {
      summary = await summarizeLead(lead);
      if (summary.confidence < 0.5) {
        summary.recommended_action = 'revisar_manual';
      }
    } catch (error) {
      summary = fallbackSummary(error);
    }

    lead.ai_summary = summary;
    await updateById('leads', inserted.id, {
      ai_summary: summary,
      payload: lead,
    });

    let deliveryStatus: LeadPayload['delivery_status'] = 'queued';
    try {
      const delivery = await enqueueAndAttemptDelivery(lead);
      deliveryStatus = delivery.status;
    } catch {
      deliveryStatus = 'dead_letter';
    }

    lead.delivery_status = deliveryStatus;
    await updateById('leads', inserted.id, {
      delivery_status: deliveryStatus,
      payload: lead,
    });

    if (lead.lead_score >= 80 || lead.lead_classification === 'priority') {
      try {
        await sendPriorityNotification(lead);
      } catch (err) {
        console.error('[Notification] Webhook trigger error:', err);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        lead_id: leadId,
        lead_score: lead.lead_score,
        lead_classification: lead.lead_classification,
        ai_summary: summary,
        delivery_status: deliveryStatus,
      },
      { headers: corsHeaders() },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown lead ingest error' },
      { status: 500, headers: corsHeaders() },
    );
  }
}
