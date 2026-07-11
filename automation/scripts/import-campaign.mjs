import { campaignFilePath, readCampaignWorkbook, text, toDate, validateCampaignRows, value } from './campaign-workbook.mjs';

const dataBrainUrl = (process.env.DATA_BRAIN_URL || '').replace(/\/+$/, '');
const importSecret = process.env.CAMPAIGN_IMPORT_SECRET || '';
const adminUser = process.env.DATA_BRAIN_ADMIN_USER || '';
const adminPassword = process.env.DATA_BRAIN_ADMIN_PASSWORD || '';
const dryRun = process.env.CAMPAIGN_DRY_RUN !== 'false';

function status(value, fallback) {
  const normalized = String(value || '').trim().toUpperCase();
  const map = {
    PENDIENTE: 'pending',
    ACTIVA: 'active',
    ESPERA_PRINCIPAL: 'awaiting_primary',
    DETENIDA: 'stopped',
    FINALIZADA: 'completed',
    ENVIADO: 'sent',
    ERROR: 'error',
    LOCKED: 'locked',
  };
  return map[normalized] || fallback;
}

function iso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : undefined;
}

function contactPayload(row) {
  const firstName = text(row, 'nombre');
  const lastName = [text(row, 'primer apellido'), text(row, 'segundo apellido')].filter(Boolean).join(' ');
  return {
    contact_id: text(row, 'contact id'),
    account_id: text(row, 'account id'),
    email: text(row, 'correo electronico').toLowerCase(),
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    company_name: text(row, 'organizacion') || undefined,
    job_title: text(row, 'cargo') || undefined,
    company_size: text(row, 'tipo de empresa') || undefined,
    variant: text(row, 'variante nombre'),
    magnet: text(row, 'variante nombre'),
    lot: text(row, 'lote envio'),
    scheduled_at: iso(value(row, 'proximo envio at')),
    current_step: Number(value(row, 'paso actual') || 1),
    sequence_status: status(value(row, 'estado secuencia'), 'pending'),
    next_delivery_status: status(value(row, 'estado envio'), 'pending'),
    parent_contact_id: text(row, 'contacto principal id') || undefined,
    conditional_delivery: text(row, 'habilitado envio').toUpperCase() === 'CONDICIONADO',
    contact_data: {
      resource_url: text(row, 'enlace recurso utm'),
      calendly_url: text(row, 'enlace calendly utm'),
      time_slot: text(row, 'hora franja'),
      send_order: Number(value(row, 'orden envio franja') || 0),
    },
  };
}

async function sendBatch(payload) {
  const response = await fetch(`${dataBrainUrl}/api/campaign/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Campaign-Import-Secret': importSecret,
      Authorization: `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString('base64')}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Import failed with status ${response.status}`);
  return body;
}

try {
  const { filePath, rows } = readCampaignWorkbook(campaignFilePath());
  const validation = validateCampaignRows(rows, { requireReady: !dryRun });
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  if (!dataBrainUrl || !importSecret || !adminUser || !adminPassword) {
    throw new Error('DATA_BRAIN_URL, CAMPAIGN_IMPORT_SECRET, DATA_BRAIN_ADMIN_USER and DATA_BRAIN_ADMIN_PASSWORD are required');
  }

  const campaignExternalId = text(rows[0], 'campaign id');
  let imported = 0;
  let hubspotSynced = 0;
  for (let index = 0; index < rows.length; index += 100) {
    const result = await sendBatch({
      campaign_external_id: campaignExternalId,
      campaign_name: 'FUNDAE 2026 Email Campaign',
      dry_run: dryRun,
      contacts: rows.slice(index, index + 100).map(contactPayload),
    });
    imported += result.imported || 0;
    hubspotSynced += result.hubspotSynced || 0;
  }

  console.log(JSON.stringify({ file: filePath, dryRun, imported, hubspotSynced }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Campaign import failed');
  process.exitCode = 1;
}
