import { NextResponse } from 'next/server';

import { corsHeaders, limitRequest } from '@/lib/security';
import { resolveTransactionalIntakeCapability } from '@/lib/transactional-intake';
import {
  canonicalChecklistPdfUrl,
  TransactionalResourceConfigurationError,
} from '@/lib/transactional-resources';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 1_024;
const MAX_PDF_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'private, no-store, max-age=0' };
  const rate = await limitRequest(request, 'transactional-checklist-pdf', 120, 60_000, 'fail-closed');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rate.reason === 'unavailable' ? 'PDF unavailable' : 'Too many requests' },
      { status: rate.reason === 'unavailable' ? 503 : 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } },
    );
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
    if (!claim.valid || claim.resource !== 'checklist') {
      return NextResponse.json({ error: 'Capability rejected' }, { status: 403, headers });
    }

    const upstream = await fetch(canonicalChecklistPdfUrl(), {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const declaredLength = Number(upstream.headers.get('content-length') ?? '0');
    if (
      !upstream.ok ||
      !upstream.headers.get('content-type')?.toLowerCase().startsWith('application/pdf') ||
      (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES)
    ) {
      throw new Error('canonical PDF is unavailable');
    }
    const pdf = new Uint8Array(await upstream.arrayBuffer());
    if (
      pdf.byteLength < 5 ||
      pdf.byteLength > MAX_PDF_BYTES ||
      pdf[0] !== 0x25 ||
      pdf[1] !== 0x50 ||
      pdf[2] !== 0x44 ||
      pdf[3] !== 0x46 ||
      pdf[4] !== 0x2d
    ) {
      throw new Error('canonical PDF is invalid');
    }

    return new Response(pdf, {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Checklist_10_Controles_FUNDAE.pdf"',
        'Content-Length': String(pdf.byteLength),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'PDF unavailable' },
      { status: error instanceof TransactionalResourceConfigurationError ? 503 : 502, headers },
    );
  }
}
