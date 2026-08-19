import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCampaignWorkbook, text, toDate, validateCampaignRows, value } from './campaign-workbook.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONTROLLED_WORKBOOK = path.resolve(HERE, '../../data-private/Base_FUNDAE_2026_CONTROLADA_OFF_V1.xlsx');
export const CONTROLLED_REPORT = path.resolve(HERE, '../campaign-reports/FUNDAE_2026_CONTROLLED_COPY_REPORT.json');
export const EXPECTED_CONTACTS = 939;
export const EXPECTED_PAYLOADS = 4695;
export const EXPECTED_LOTS = { A: 235, B: 235, C: 235, D: 234 };
const HASH = /^[a-f0-9]{64}$/;
const ACTOR = /^[a-f0-9]{64}$/;
const APPLY_ACK = 'FUNDAE_STAGING_PROVISION_APPLY_V1';
const TOKEN_PATTERN = /^u1\.[A-Za-z0-9_-]{43}$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fileHash(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function exactCounts(actual, expected) {
  return Object.keys(expected).length === Object.keys(actual || {}).length &&
    Object.entries(expected).every(([key, count]) => actual?.[key] === count);
}

function onlyBucket(counts, bucket, expected) {
  return counts && Object.keys(counts).length === 1 && counts[bucket] === expected;
}

export function evaluateProvisioningGates(summary, report, structuralOk = true) {
  const gates = [];
  const payloadCount = summary.optOutCoverage?.totalBodies ?? 0;
  const policy = summary.policyCoverage ?? {};
  if (!structuralOk) gates.push('STRUCTURE_OR_COPY_INVALID');
  if (summary.contacts !== EXPECTED_CONTACTS || report.contacts !== EXPECTED_CONTACTS ||
      report.unique_contact_ids !== EXPECTED_CONTACTS || report.unique_emails !== EXPECTED_CONTACTS) gates.push('CONTACT_COUNT_MISMATCH');
  if (!exactCounts(summary.lots, EXPECTED_LOTS) || !exactCounts(report.lots, EXPECTED_LOTS)) gates.push('LOT_DISTRIBUTION_MISMATCH');
  if (payloadCount !== EXPECTED_PAYLOADS || report.bodies !== EXPECTED_PAYLOADS ||
      report.identified_bodies !== EXPECTED_PAYLOADS || report.unsubscribe_placeholders !== EXPECTED_PAYLOADS ||
      summary.copyCoverage?.identifiedBodies !== EXPECTED_PAYLOADS || summary.copyCoverage?.canonicalMismatches !== 0 ||
      summary.copyCoverage?.unresolvedPlaceholderBodies !== 0 || summary.optOutCoverage?.missingBodies !== 0) gates.push('PAYLOAD_OR_COPY_MISMATCH');
  if (summary.logicalDatasetSha256 !== report.logical_dataset_sha256) gates.push('LOGICAL_DATASET_HASH_DRIFT');
  if (!onlyBucket(summary.readiness, 'OK', EXPECTED_CONTACTS)) gates.push('VALIDATION_NOT_OK');
  const technical = policy.technicalStatuses || {};
  if (!Object.values(technical).every((counts) => onlyBucket(counts, 'CLEAR', EXPECTED_CONTACTS))) gates.push('TECHNICAL_EXCLUSIONS_NOT_CLEAR');
  if (!onlyBucket(policy.authorizations, 'AUTHORIZED', EXPECTED_CONTACTS)) gates.push('CAMPAIGN_NOT_AUTHORIZED');
  return [...new Set(gates)];
}

export function analyzeControlledWorkbook({ workbookPath = CONTROLLED_WORKBOOK, reportPath = CONTROLLED_REPORT } = {}) {
  const resolvedWorkbook = path.resolve(workbookPath);
  const resolvedReport = path.resolve(reportPath);
  if (resolvedWorkbook !== CONTROLLED_WORKBOOK || resolvedReport !== CONTROLLED_REPORT) throw new Error('CONTROLLED_INPUT_ONLY');
  const report = JSON.parse(fs.readFileSync(resolvedReport, 'utf8'));
  if (!HASH.test(report.controlled_copy_sha256 || '') || !HASH.test(report.logical_dataset_sha256 || '')) throw new Error('REPORT_INVALID');
  const observedHash = fileHash(resolvedWorkbook);
  const hashMatches = observedHash === report.controlled_copy_sha256;
  const { rows } = readCampaignWorkbook(resolvedWorkbook);
  const structural = validateCampaignRows(rows, { requireReady: false });
  const gates = evaluateProvisioningGates(structural.summary, report, structural.ok);
  if (!hashMatches) gates.unshift('CONTROLLED_COPY_HASH_DRIFT');
  return {
    ready: gates.length === 0,
    gates: [...new Set(gates)],
    rows,
    report: {
      reportVersion: report.report_version,
      controlledCopySha256: report.controlled_copy_sha256,
      logicalDatasetSha256: report.logical_dataset_sha256,
    },
    summary: {
      observedWorkbookSha256: observedHash,
      contacts: structural.summary.contacts,
      payloads: structural.summary.optOutCoverage.totalBodies,
      lots: structural.summary.lots,
      logicalDatasetSha256: structural.summary.logicalDatasetSha256,
    },
  };
}

function unsubscribeToken(campaignId, contactId, secret) {
  if (Buffer.byteLength(secret, 'utf8') < 32 || /replace|change.?me|placeholder|example|xxxxx/i.test(secret)) throw new Error('APPLY_SECRET_INVALID');
  return `u1.${createHmac('sha256', secret).update(`unsubscribe\0${campaignId}\0${contactId}\0${1}`).digest('base64url')}`;
}

function canonicalRowHash(row) {
  const fields = [
    row.campaign_external_id, row.contact_id, row.account_id, row.email, row.email_hash,
    row.variant, row.lot, String(row.step), row.scheduled_for, row.execution_key,
    row.recipient_email, row.subject, row.html_body, row.payload_sha256, row.token_hash,
    row.validation_status, row.unsubscribe_status, row.opposition_status,
    row.hard_bounce_status, row.suppression_status, row.duplicate_status,
    row.campaign_authorization, row.company_size,
  ];
  return sha256(fields.join('\x1f'));
}

export function prepareProvisionRows(rows, { unsubscribeSecret, unsubscribeBaseUrl }) {
  const base = new URL(unsubscribeBaseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/') throw new Error('APPLY_UNSUBSCRIBE_ORIGIN_INVALID');
  const provisionRows = [];
  for (const source of rows) {
    const campaignId = text(source, 'campaign id');
    const contactId = text(source, 'contact id');
    const email = text(source, 'correo electronico').toLowerCase();
    const token = unsubscribeToken(campaignId, contactId, unsubscribeSecret);
    if (!TOKEN_PATTERN.test(token)) throw new Error('APPLY_TOKEN_INVALID');
    const unsubscribeUrl = `${base.origin}/baja?token=${token}`;
    for (let step = 1; step <= 5; step += 1) {
      const template = text(source, `email${step} cuerpo html`);
      if ((template.match(/\{\{unsubscribe_url\}\}/g) || []).length !== 1) throw new Error('APPLY_UNSUBSCRIBE_BINDING_INVALID');
      const htmlBody = template.replace('{{unsubscribe_url}}', unsubscribeUrl);
      const subject = text(source, `email${step} asunto`);
      const scheduled = value(source, `fecha email ${step}`);
      const scheduledDate = toDate(scheduled);
      if (!scheduledDate) throw new Error('APPLY_SCHEDULE_INVALID');
      const scheduledFor = scheduledDate.toISOString();
      const payloadSha256 = sha256(JSON.stringify({ recipient: email, subject, body: htmlBody, attachments: [] }));
      const row = {
        campaign_external_id: campaignId,
        contact_id: contactId,
        account_id: text(source, 'account id'),
        email,
        email_hash: sha256(email),
        variant: text(source, 'variante nombre'),
        lot: text(source, 'lote envio').toUpperCase(),
        step,
        scheduled_for: scheduledFor,
        execution_key: `cold:${sha256(`${campaignId}\0${contactId}\0${step}`).slice(0, 48)}`,
        recipient_email: email,
        subject,
        html_body: htmlBody,
        payload_sha256: payloadSha256,
        token_hash: sha256(token),
        validation_status: text(source, 'validacion pre envio').toUpperCase(),
        unsubscribe_status: text(source, 'unsubscribe status').toUpperCase(),
        opposition_status: text(source, 'opposition status').toUpperCase(),
        hard_bounce_status: text(source, 'hard bounce status').toUpperCase(),
        suppression_status: text(source, 'suppression status').toUpperCase(),
        duplicate_status: text(source, 'duplicate status').toUpperCase(),
        campaign_authorization: text(source, 'campaign authorization').toUpperCase(),
        company_size: text(source, 'tipo de empresa'),
      };
      row.row_sha256 = canonicalRowHash(row);
      provisionRows.push(row);
    }
  }
  provisionRows.sort((a, b) => a.execution_key.localeCompare(b.execution_key));
  return provisionRows;
}

export function buildProvisionManifest(rows, logicalDatasetSha256, batchSize = 500) {
  if (rows.length !== EXPECTED_PAYLOADS || batchSize < 1 || batchSize > 500 || !HASH.test(logicalDatasetSha256 || '')) throw new Error('APPLY_ROW_COUNT_INVALID');
  const campaignExternalId = rows[0]?.campaign_external_id;
  if (!campaignExternalId || rows.some((row) => row.campaign_external_id !== campaignExternalId || !HASH.test(row.row_sha256 || ''))) throw new Error('APPLY_MANIFEST_INPUT_INVALID');
  const rowHashes = rows.map((row) => row.row_sha256).sort();
  const manifestHash = sha256(`cold-provision-v2\x1f${logicalDatasetSha256}\x1f${campaignExternalId}\x1f${rowHashes.join('\n')}`);
  const batches = [];
  for (let index = 0; index < rows.length; index += batchSize) {
    const batchRows = rows.slice(index, index + batchSize);
    batches.push({ index: batches.length, rows: batchRows, hash: sha256(batchRows.map((row) => row.row_sha256).sort().join('\n')) });
  }
  return { manifestHash, logicalDatasetSha256, campaignExternalId, batchCount: batches.length, rows: rows.length, batches };
}

function constantHash(value) {
  const buffer = Buffer.from(value || '', 'utf8');
  const dummy = Buffer.alloc(Math.max(buffer.length, 32));
  buffer.copy(dummy);
  timingSafeEqual(dummy, dummy);
  return sha256(value || '');
}

async function rpc(fetchImpl, url, serviceKey, name, body) {
  const response = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.accepted !== true) throw new Error('APPLY_RPC_REJECTED');
  return result;
}

export async function applyProvisionManifest(input, fetchImpl = fetch) {
  const { manifest, campaignExternalId, actorHash, authorizationToken, supabaseUrl, serviceKey } = input;
  if (input.applyAck !== APPLY_ACK || input.provisioningEnabled !== 'true' || !ACTOR.test(actorHash || '') ||
      manifest.campaignExternalId !== campaignExternalId || !HASH.test(manifest.logicalDatasetSha256 || '') ||
      Buffer.byteLength(authorizationToken || '', 'utf8') < 32 || !/^https:\/\//.test(supabaseUrl || '') ||
      Buffer.byteLength(serviceKey || '', 'utf8') < 32) throw new Error('APPLY_DOUBLE_GATE_CLOSED');
  const authorizationHash = constantHash(authorizationToken);
  for (const batch of manifest.batches) {
    await rpc(fetchImpl, supabaseUrl, serviceKey, 'apply_cold_campaign_provision_batch', {
      p_manifest_hash: manifest.manifestHash, p_logical_dataset_hash: manifest.logicalDatasetSha256, p_batch_index: batch.index,
      p_batch_count: manifest.batchCount, p_batch_hash: batch.hash,
      p_actor_hash: actorHash, p_authorization_hash: authorizationHash,
      p_campaign_external_id: campaignExternalId, p_rows: batch.rows,
    });
  }
  return rpc(fetchImpl, supabaseUrl, serviceKey, 'finalize_cold_campaign_provision', {
    p_manifest_hash: manifest.manifestHash, p_actor_hash: actorHash,
    p_authorization_hash: authorizationHash,
  });
}

export async function runProvisioner({ apply = false, fetchImpl = fetch } = {}) {
  const analysis = analyzeControlledWorkbook();
  const publicResult = { mode: apply ? 'apply' : 'dry-run', ready: analysis.ready, gates: analysis.gates, summary: analysis.summary };
  if (!analysis.ready) return { ...publicResult, exitCode: 2 };
  if (!apply) return { ...publicResult, exitCode: 0 };
  const rows = prepareProvisionRows(analysis.rows, {
    unsubscribeSecret: process.env.UNSUBSCRIBE_TOKEN_SECRET || '',
    unsubscribeBaseUrl: process.env.UNSUBSCRIBE_PUBLIC_BASE_URL || '',
  });
  const manifest = buildProvisionManifest(rows, analysis.report.logicalDatasetSha256);
  await applyProvisionManifest({
    manifest, campaignExternalId: text(analysis.rows[0], 'campaign id'),
    actorHash: process.env.CAMPAIGN_PROVISION_ACTOR_HASH || '',
    authorizationToken: process.env.CAMPAIGN_PROVISION_AUTHORIZATION_TOKEN || '',
    applyAck: process.env.CAMPAIGN_PROVISION_APPLY_ACK || '',
    provisioningEnabled: process.env.COLD_CAMPAIGN_PROVISIONING_ENABLED || '',
    supabaseUrl: process.env.SUPABASE_URL || '', serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  }, fetchImpl);
  return { ...publicResult, manifest: { hash: manifest.manifestHash, batches: manifest.batchCount, rows: manifest.rows }, exitCode: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runProvisioner({ apply: process.argv.slice(2).includes('--apply') });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.exitCode;
}
