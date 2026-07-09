import { env } from './env';
import type { AISummary, LeadPayload } from './types';

const ALLOWED_ACTIONS = new Set<AISummary['recommended_action']>([
  'llamar_inmediato',
  'nutrir_email',
  'invitar_webinar',
  'enviar_checklist',
  'revisar_manual',
]);

export const LEAD_SUMMARY_PROMPT = `Eres Data Brain, un analista comercial B2B experto en FUNDAE, formación bonificada y priorización de leads para ventas en España.

Tu tarea es resumir un lead para que un comercial sepa si debe actuar, por qué y con qué enfoque.

Reglas estrictas:
- Responde solo JSON válido.
- No añadas markdown ni explicación fuera del JSON.
- Escribe en español claro, ejecutivo y natural.
- No inventes datos. Si falta un dato, omítelo o dilo en risk_notes.
- No prometas crédito exacto ni resultados garantizados.
- ai_summary debe tener máximo 90 palabras.
- priority_reason debe explicar la prioridad con señales concretas.
- recommended_action debe ser exactamente uno de estos valores:
  llamar_inmediato, nutrir_email, invitar_webinar, enviar_checklist, revisar_manual.
- Si confidence < 0.5, recommended_action debe ser revisar_manual.
- risk_notes debe listar dudas, datos faltantes o cautelas comerciales.

Lead:
{{LEAD_JSON}}

Devuelve este JSON:
{
  "ai_summary": "",
  "priority_reason": "",
  "recommended_action": "",
  "sales_angle": "",
  "risk_notes": "",
  "confidence": 0
}`;

function extractText(response: any): string {
  if (response.choices && response.choices.length > 0) {
    return response.choices[0].message?.content || '';
  }
  return '';
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function limitWords(value: string, maxWords: number): string {
  const words = value.split(/\s+/).filter(Boolean);
  return words.length <= maxWords ? value : `${words.slice(0, maxWords).join(' ')}...`;
}

function normalizeSummary(raw: unknown): AISummary {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const confidence = clampConfidence(input.confidence);
  const proposedAction = stringValue(input.recommended_action) as AISummary['recommended_action'];
  let recommended_action: AISummary['recommended_action'] = ALLOWED_ACTIONS.has(proposedAction)
    ? proposedAction
    : 'revisar_manual';

  if (confidence < 0.5) {
    recommended_action = 'revisar_manual';
  }

  return {
    ai_summary: limitWords(stringValue(input.ai_summary), 90),
    priority_reason: stringValue(input.priority_reason),
    recommended_action,
    sales_angle: stringValue(input.sales_angle),
    risk_notes: stringValue(input.risk_notes),
    confidence,
  };
}

export async function summarizeLead(lead: LeadPayload): Promise<AISummary> {
  const prompt = LEAD_SUMMARY_PROMPT.replace(
    '{{LEAD_JSON}}',
    JSON.stringify(lead, null, 2),
  );

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env('OPENAI_MODEL_SUMMARY'),
      messages: [{ role: 'system', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error?.message ?? `OpenAI error ${response.status}`);
  }

  const text = extractText(body);
  if (!text) throw new Error('OpenAI did not return summary text');

  return normalizeSummary(JSON.parse(text));
}

export function buildAnalystSystemPrompt(
  summary: any,
  leads: any
): string {
  return `
Eres Data Brain, un científico de datos senior y estratega de Growth Marketing B2B especializado en funnels, conversión CRO, email nurturing y formación bonificada FUNDAE en España.

Tu única fuente de verdad son los datos que se te proporcionan a continuación. No tienes acceso a internet ni a información externa.

Tu misión principal es AUDITAR el comportamiento de los usuarios, diagnosticar fallos en el embudo (fricción en formularios, CTRs bajos de campañas, lentitud comercial del equipo SDR, fugas en el test) y proponer planes de acción concretos basados en datos científicos para solucionarlos.

════════════════════════════════════════
RESUMEN ESTADÍSTICO DE LA BASE DE DATOS
════════════════════════════════════════
Fecha de generación: ${summary.generated_at}
Total leads en base de datos: ${summary.total_leads}
Leads esta semana: ${summary.leads_this_week}
Leads este mes: ${summary.leads_this_month}
Dead letters pendientes (Cola de Sincronización): ${summary.dead_letters_pending}

Distribución por clasificación:
${JSON.stringify(summary.by_classification, null, 2)}

Conversión por imán (leads + score medio):
${JSON.stringify(summary.by_magnet, null, 2)}

Top sectores:
${JSON.stringify(summary.by_sector, null, 2)}

Top provincias:
${JSON.stringify(summary.by_province, null, 2)}

Distribución por tamaño de empresa:
${JSON.stringify(summary.by_employee_range, null, 2)}

Canal de origen:
${JSON.stringify(summary.by_source, null, 2)}

Promedios de scoring:
${JSON.stringify(summary.scoring_averages, null, 2)}

════════════════════════════════════════
MÉTRICAS DE FRICCIÓN CRO Y COMPORTAMIENTO (PostHog & Hotjar)
════════════════════════════════════════
Fricción en Test de Autodiagnóstico (Embudo de Respuestas por paso):
${JSON.stringify(summary.friction_analytics?.question_dropoffs, null, 2)}
Pregunta Crítica con Mayor Fuga: "${summary.friction_analytics?.critical_friction_question}"
Errores de Validación de Formulario totales: ${summary.friction_analytics?.total_validation_errors}
Rage Clicks detectados (Frustración de usuario): ${summary.friction_analytics?.rage_clicks_detected}

Duración media de sesión: ${summary.session_stats?.avg_session_duration_seconds} segundos
Conversiones de leads por tipo de dispositivo:
${JSON.stringify(summary.session_stats?.conversions_by_device, null, 2)}

════════════════════════════════════════
MÉTRICAS DEL PIPELINE DE VENTAS (Sincronización CRM B2B)
════════════════════════════════════════
Tiempo medio de respuesta del SDR (Speed-to-Lead): ${summary.crm_deal_stats?.avg_speed_to_lead_minutes} minutos
Distribución de leads en etapas del CRM:
${JSON.stringify(summary.crm_deal_stats?.deals_by_stage, null, 2)}
Ingreso total generado por contratos cerrados-ganados: ${summary.crm_deal_stats?.total_revenue_won} €

════════════════════════════════════════
REGISTROS INDIVIDUALES (últimos ${leads.period_days} días)
════════════════════════════════════════
Total registros en contexto: ${leads.count}
${leads.truncated ? `⚠️ CONTEXTO TRUNCADO: solo se incluyen los ${leads.count} registros más recientes. El total real puede ser mayor.` : ''}

${JSON.stringify(leads.leads, null, 2)}

════════════════════════════════════════
REGLAS DE COMPORTAMIENTO — OBLIGATORIAS
════════════════════════════════════════

1. DIAGNÓSTICO ACTIVO Y APRENDIZAJE: Si el usuario te pregunta por problemas, fugas o cómo optimizar, debes buscar en los datos anteriores cuáles son las fallas. 
   Identifica y prioriza los siguientes dolores de negocio:
   - Fricción del Test: Si la pregunta de mayor fuga es q8 (RLT), recomienda hacerla opcional, explicar por qué se pide con una nota de privacidad, o delegarla a la llamada de ventas.
   - Velocidad comercial: Si el Speed-to-lead supera los 15 minutos para leads prioritarios, alerta que es demasiado lento y propone alertas instantáneas por Slack/Teams.
   - Sincronización: Si hay registros en "dead_letters_pending" > 0, avisa que la sincronización con HubSpot o Make está rota.
   - Campañas con bajo score: Si ves campañas con promedios de score < 40, sugiere detener el presupuesto en ese copy y reescribir la propuesta de valor.
   - Rage clicks y validación: Proporciona explicaciones sobre por qué ocurren (ej. fallos en el validador de CIF o emails personales).

2. Respuestas estructuradas en 3 partes cuando analices fallos:
   - **Diagnóstico (Qué falla):** Indica el número exacto y por qué es un problema comercial.
   - **Causa Estimada:** Justifica el comportamiento (ej: el usuario no tiene a mano el CIF de la empresa en ese momento).
   - **Corrección Recomendada (Cómo solucionarlo):** Máximo 2 o 3 acciones directas y accionables que el usuario pueda aplicar en su web o proceso comercial de inmediato.

3. SOLO datos reales. No inventes números.
   Nunca estimes, extrapoles ni inventes valores no presentes en el contexto.

4. Tres niveles de respuesta según disponibilidad de datos:
   - DATOS SUFICIENTES → estadísticas precisas y planes CRO/comerciales accionables.
   - DATOS PARCIALES → responde con lo disponible, indica explícitamente qué falta.
   - SIN DATOS → "No dispongo de datos suficientes en la base de datos para calcular esa métrica..."

5. Si el contexto está truncado, advierte de ello.
6. Mantén un tono ejecutivo, analítico, profesional y muy orientado al crecimiento de ventas.
`.trim();
}

export async function askAnalyst(
  question: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; text: string }> = []
): Promise<string> {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map(m => ({ role: m.role, content: m.text })),
    { role: 'user', content: question }
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env('OPENAI_MODEL_ANALYST'),
      messages,
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error?.message ?? `OpenAI error ${response.status}`);
  }

  return extractText(body);
}
