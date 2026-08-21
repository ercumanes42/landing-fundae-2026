import { NextResponse } from 'next/server';

import { corsHeaders, limitRequest } from '@/lib/security';
import { findTransactionalLeadBySubmission } from '@/lib/transactional-delivery';
import { resolveTransactionalIntakeCapability } from '@/lib/transactional-intake';
import { generateInteractiveChecklistPdf } from '@/lib/transactional-pdf';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 1_024;
const MAX_PDF_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'private, no-store, max-age=0' };
  const rate = await limitRequest(request, 'transactional-pdf', 120, 60_000, 'fail-closed');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rate.reason === 'unavailable' ? 'PDF unavailable' : 'Too many requests' },
      { status: rate.reason === 'unavailable' ? 503 : 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 413, headers });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') < 2 || Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 413, headers });
  }

  try {
    const input = JSON.parse(rawBody) as { intake_capability?: unknown };
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'intake_capability')) {
      throw new Error('request is invalid');
    }
    const claim = await resolveTransactionalIntakeCapability(input.intake_capability);
    if (!claim.valid || claim.resource !== 'interactive_checklist' || !claim.submissionId) {
      return NextResponse.json({ error: 'Capability rejected' }, { status: 403, headers });
    }
    const lead = await findTransactionalLeadBySubmission(claim.submissionId);
    const payload = lead.payload as { interactive_checklist?: { score?: unknown; risk_level?: unknown; answers?: unknown } };
    const checklist = payload.interactive_checklist;
    if (!checklist || typeof checklist.score !== 'number' || typeof checklist.risk_level !== 'string' || !checklist.answers || typeof checklist.answers !== 'object' || Array.isArray(checklist.answers)) {
      throw new Error('interactive checklist result is incomplete');
    }
    const pdf = await generateInteractiveChecklistPdf({
      score: checklist.score,
      riskLevel: checklist.risk_level,
      answers: checklist.answers as Record<string, string>,
    });
    if (pdf.byteLength > MAX_PDF_BYTES) throw new Error('interactive checklist PDF is too large');
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Resumen_Orientativo_FUNDAE.pdf"',
        'Content-Length': String(pdf.byteLength),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'PDF request rejected' }, { status: 400, headers });
  }
}
