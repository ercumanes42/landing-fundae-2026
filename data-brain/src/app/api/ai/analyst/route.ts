import { NextResponse } from 'next/server';
import { basicAuthHeaders, isBasicAuthValid } from '@/lib/auth';
import { assertEnv } from '@/lib/env';
import { askAnalyst, buildAnalystSystemPrompt } from '@/lib/openai';
import { getContextSummary, getContextLeads, selectContextStrategy } from '@/lib/analyst-context';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertEnv();

    if (!isBasicAuthValid(request)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: basicAuthHeaders() },
      );
    }

    const body = (await request.json()) as {
      question?: string;
      conversationHistory?: Array<{ role: 'user' | 'assistant'; text: string }>;
    };

    const question = body.question;
    const conversationHistory = body.conversationHistory || [];

    if (!question?.trim()) {
      return NextResponse.json({ error: 'Pregunta vacía' }, { status: 400 });
    }

    // 1. Obtener contexto real de Supabase ANTES de llamar a OpenAI
    let contextSummary, contextLeads;
    try {
      contextSummary = await getContextSummary();

      // Seleccionar estrategia de manera dinámica según el número total de leads para evitar overflow de tokens
      const totalLeads = contextSummary.total_leads;
      const strategy = selectContextStrategy(totalLeads);

      const maxLeadsEnv = process.env.ANALYST_MAX_LEADS_IN_CONTEXT;
      const maxLeads = maxLeadsEnv ? parseInt(maxLeadsEnv, 10) : strategy.limit;
      
      const daysBackEnv = process.env.ANALYST_CONTEXT_DAYS_BACK;
      const daysBack = daysBackEnv ? parseInt(daysBackEnv, 10) : strategy.daysBack;

      contextLeads = await getContextLeads({ limit: maxLeads, daysBack });
    } catch (err) {
      // Si Supabase falla, NO llamar a OpenAI — mejor error honesto que alucinación
      console.error('Supabase context retrieval error:', err);
      return NextResponse.json({
        error: 'No se pudo acceder a la base de datos. El analista no puede responder sin datos reales.',
        suggestion: 'Verifica la conexión a Supabase y vuelve a intentarlo.'
      }, { status: 503 });
    }

    // 2. Construir prompt con contexto real
    const systemPrompt = buildAnalystSystemPrompt(contextSummary, contextLeads);

    // 3. Cortar historial de la conversación al máximo configurado (default: 10)
    const maxTurnsEnv = process.env.ANALYST_MAX_CONVERSATION_TURNS;
    const maxTurns = maxTurnsEnv ? parseInt(maxTurnsEnv, 10) : 10;
    const safeHistory = conversationHistory.slice(-maxTurns);

    // 4. Llamar a OpenAI con el prompt estructurado y el historial
    const answer = await askAnalyst(question, systemPrompt, safeHistory);

    return NextResponse.json({
      answer,
      context_meta: {
        total_leads_in_db: contextSummary.total_leads,
        leads_in_context: contextLeads.count,
        context_truncated: contextLeads.truncated,
        context_generated_at: contextSummary.generated_at,
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown analyst error' },
      { status: 500 },
    );
  }
}
