import { env } from './env';
import type { LeadPayload } from './types';

export async function sendPriorityNotification(lead: LeadPayload): Promise<void> {
  const url = env('NOTIFICATION_WEBHOOK_URL');
  if (!url) return;

  const score = lead.lead_score;
  const classification = lead.lead_classification;
  const name = lead.contact?.name || 'N/A';
  const email = lead.contact?.email || 'N/A';
  const phone = lead.contact?.phone || 'N/A';
  const company = lead.contact?.company || 'N/A';
  const role = lead.contact?.role || 'N/A';
  const employees = lead.company?.employee_range || 'N/A';
  
  const aiSummary = lead.ai_summary?.ai_summary || 'No disponible';
  const recommendedAction = lead.ai_summary?.recommended_action || 'No disponible';

  // Support Slack standard attachment payload
  const slackPayload = {
    text: `🚨 *¡Nuevo Lead Prioritario Detectado!* (Score: *${score}/100* - _${classification.toUpperCase()}_)`,
    attachments: [
      {
        color: '#10b981', // Emerald green
        fields: [
          { title: 'Nombre', value: name, short: true },
          { title: 'Empresa', value: company, short: true },
          { title: 'Email', value: email, short: true },
          { title: 'Teléfono', value: phone, short: true },
          { title: 'Cargo', value: role, short: true },
          { title: 'Empleados', value: employees, short: true },
          { title: 'Acción Recomendada', value: `\`${recommendedAction}\``, short: false },
        ],
        text: `*Resumen de Inteligencia Comercial (IA):*\n${aiSummary}`,
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload),
    });

    if (!response.ok) {
      console.warn(`[Notification] Webhook failed with status ${response.status}`);
    }
  } catch (error) {
    console.error('[Notification] Webhook fetch error:', error);
  }
}
