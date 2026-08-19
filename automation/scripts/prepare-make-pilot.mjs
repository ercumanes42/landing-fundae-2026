import fs from 'node:fs';
import path from 'node:path';

export const PILOT_CAMPAIGN_ID = 'FUNDAE_2026_EMAIL_V1_PILOT';
export const COPY_PATH = path.resolve('automation/make/fundae_copy_matrix_v1.json');
export const ALLOWLIST_PATH = path.resolve('data-private/pilot-allowlist.json');
export const OUTPUT_PATH = path.resolve('data-private/FUNDAE_MAKE_PILOT_4.csv');
const VARIANTS = ['Checklist', 'Calculadora', 'Webinar', 'Revisión rápida'];

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function buildPilotRows(allowlist = readJson(ALLOWLIST_PATH), matrix = readJson(COPY_PATH)) {
  if (allowlist.recipients?.length !== 4 || matrix.variants?.length !== 4) throw new Error('Pilot requires four recipients and four variants');
  if (!VARIANTS.every((name) => allowlist.recipients.some((item) => item.variant === name))) throw new Error('Allowlist variants are incomplete');
  return matrix.variants.map((variant) => {
    if (variant.emails?.length !== 5 || variant.emails.some((email, index) => email.step !== index + 1 || !email.subject || !email.body || email.body.split('{{unsubscribe_url}}').length !== 2)) throw new Error(`Copy is invalid for ${variant.name}`);
    const recipient = allowlist.recipients.find((item) => item.variant === variant.name);
    const row = {
      campaign_external_id: PILOT_CAMPAIGN_ID,
      contact_id: `F26-PILOT-${variant.code}-0001`,
      account_id: `F26-PILOT-ACCOUNT-${variant.code}-0001`,
      variant_code: variant.code,
      variant_name: variant.name,
      recipient_email: recipient.email,
      first_name: 'Equipo',
      company_name: 'GFS Piloto',
      resource_url: '', calendly_url: '', webinar_date: '', webinar_time: '', paso_actual: 1,
      estado_secuencia: 'OFF', next_delivery_status: 'PENDING', scenario_status: 'OFF',
      internal_authorization: 'PENDING', validacion_pre_envio: 'PENDING', legal_evidence_status: 'PENDING',
      sender_connection_authorized: 'PENDING', habilitado_envio: 'NO', intent_campaign_enabled: false,
    };
    variant.emails.forEach((email) => { row[`email_${email.step}_subject`] = email.subject; row[`email_${email.step}_body`] = email.body; });
    return row;
  });
}

const cell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
export function serializeCsv(rows) {
  const headers = Object.keys(rows[0]);
  return `\uFEFF${[headers, ...rows.map((row) => headers.map((key) => row[key]))].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function prepareMakePilot(outputPath = OUTPUT_PATH) {
  const rows = buildPilotRows();
  fs.writeFileSync(outputPath, serializeCsv(rows), 'utf8');
  return rows.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1'))) {
  console.log(`Pilot queue prepared: ${prepareMakePilot()} blocked rows written.`);
}
