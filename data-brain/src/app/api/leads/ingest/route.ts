import { NextResponse } from 'next/server';
import { assertEnv } from '@/lib/env';
import { buildLeadId } from '@/lib/lead-id';
import { summarizeLead } from '@/lib/openai';
import { calculateLeadScoreBreakdown, classifyLead } from '@/lib/scoring';
import { insertRow, selectRows, updateById } from '@/lib/supabase';
import type { AISummary, LeadPayload, LeadScoringInput } from '@/lib/types';
import { corsHeaders, isAllowedLandingOrigin, limitRequest } from '@/lib/security';
import {
  canonicalizeLeadPayload,
  leadCapturePayloadSha256,
  PayloadTooLargeError,
  readBoundedJsonBody,
} from '@/lib/validation';

export const runtime = 'nodejs';

interface LeadRow {
  id: string;
  lead_id: string;
  submission_id: string;
  form_type: string;
  payload: unknown;
  lead_score?: number;
  lead_classification?: string;
  delivery_status?: string;
  email_delivery_status?: string;
}

const TRANSACTIONAL_RESOURCES = new Set([
  'calculator',
  'interactive_checklist',
  'checklist',
  'webinar',
]);

function dispatchStatus(
  formType: string,
  deliveryStatus: string | undefined = 'captured',
  emailDeliveryStatus: string | undefined = 'pending',
): string {
  if (!TRANSACTIONAL_RESOURCES.has(formType)) return 'not_applicable';
  if (deliveryStatus === 'captured' && emailDeliveryStatus === 'pending') return 'queued_off';
  return emailDeliveryStatus ?? deliveryStatus ?? 'not_queued';
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

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  if (!isAllowedLandingOrigin(request)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403, headers });
  }
  const rate = await limitRequest(request, 'lead-ingest', 15, 15 * 60_000, 'fail-closed');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: rate.reason === 'unavailable' ? 503 : 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  try {
    assertEnv();
    let input: LeadPayload;
    try {
      input = canonicalizeLeadPayload(await readBoundedJsonBody(request));
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return NextResponse.json(
          { error: error.message },
          { status: 413, headers },
        );
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid lead payload' },
        { status: 400, headers },
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
      delivery_status: 'captured',
      email_delivery_status: 'pending',
    };

    const candidateHash = leadCapturePayloadSha256(lead);
    let inserted: LeadRow;
    try {
      inserted = await insertRow<LeadRow>('leads', {
        submission_id: input.submission_id,
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
        delivery_status: 'captured',
        accepted_by_make_at: null,
        email_delivery_status: 'pending',
        payload: lead,
        created_at: lead.created_at,
      });
    } catch (insertError) {
      let existing: LeadRow | undefined;
      try {
        [existing] = await selectRows<LeadRow>(
          'leads',
          `select=id,lead_id,submission_id,form_type,payload,lead_score,lead_classification,delivery_status,email_delivery_status&submission_id=eq.${encodeURIComponent(input.submission_id)}&limit=1`,
        );
      } catch {
        throw insertError;
      }
      if (!existing) throw insertError;

      let matchesCanonicalCapture = false;
      try {
        matchesCanonicalCapture = (
          existing.lead_id === leadId
          && existing.form_type === lead.form_type
          && leadCapturePayloadSha256(existing.payload) === candidateHash
        );
      } catch {
        matchesCanonicalCapture = false;
      }
      if (!matchesCanonicalCapture) {
        return NextResponse.json(
          {
            ok: false,
            error: 'submission_id collision',
            code: 'SUBMISSION_ID_COLLISION',
          },
          { status: 409, headers },
        );
      }
      return NextResponse.json(
        {
          ok: true,
          duplicate: true,
          lead_id: existing.lead_id,
          lead_score: existing.lead_score,
          lead_classification: existing.lead_classification,
          capture_status: 'captured',
          delivery_status: existing.delivery_status,
          email_delivery_status: existing.email_delivery_status,
          transactional_dispatch_status: dispatchStatus(
            existing.form_type,
            existing.delivery_status,
            existing.email_delivery_status,
          ),
        },
        { headers },
      );
    }

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
    try {
      await updateById('leads', inserted.id, {
        ai_summary: summary,
      });
    } catch (error) {
      // The lead is already durably captured. Optional enrichment must never
      // turn a successful capture into an outbound-dependent failure.
      console.error('[Lead ingest] Optional enrichment update failed:', error);
    }

    return NextResponse.json(
      {
        ok: true,
        lead_id: leadId,
        lead_score: lead.lead_score,
        lead_classification: lead.lead_classification,
        ai_summary: summary,
        capture_status: 'captured',
        delivery_status: 'captured',
        email_delivery_status: 'pending',
        transactional_dispatch_status: dispatchStatus(lead.form_type),
      },
      { headers },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown lead ingest error' },
      { status: 500, headers },
    );
  }
}
