import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCampaignWorkbook, text, validateCampaignRows } from './campaign-workbook.mjs';
import { campaignExclusionSubjectSha256, EXCLUSION_SOURCES } from './materialize-campaign-exclusions.mjs';

const SOURCE_EXPORT_SCHEMA = 'fundae-campaign-exclusion-source-v1';
const SOURCE_BUNDLE_SCHEMA = 'fundae-campaign-exclusion-source-bundle-v1';
const MAX_AGE_SECONDS = 86_400;
const HASH = /^[a-f0-9]{64}$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredPrivatePath(value) {
  const resolved = path.resolve(String(value || ''));
  const privateRoot = path.resolve('data-private');
  if (!value || resolved === privateRoot || !resolved.startsWith(`${privateRoot}${path.sep}`)) {
    throw new Error('PRIVATE_LOCAL_PATH_REQUIRED');
  }
  return resolved;
}

function assertProductionEndpoint(rawUrl, expectedProjectRef) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.hostname !== `${expectedProjectRef}.supabase.co`) {
    throw new Error('SUPABASE_PRODUCTION_ENDPOINT_MISMATCH');
  }
  return url.origin;
}

async function fetchAll(fetchImpl, origin, serviceKey, table, select) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`/rest/v1/${table}`, origin);
    url.searchParams.set('select', select);
    const response = await fetchImpl(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Range: `${offset}-${offset + 999}`,
        Prefer: 'count=exact',
      },
    });
    if (!response.ok) throw new Error('SUPABASE_EXCLUSION_READ_FAILED');
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('SUPABASE_EXCLUSION_RESPONSE_INVALID');
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function addTargetRecord(targetByHash, bucket, identityHash) {
  if (!HASH.test(identityHash || '')) return;
  const email = targetByHash.get(identityHash);
  if (email) bucket.set(email, 'STOP');
}

export async function collectCampaignExclusionSources({
  workbookPath,
  outputPath,
  supabaseUrl,
  serviceKey,
  leadHashSecret,
  expectedProjectRef,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (Buffer.byteLength(serviceKey || '', 'utf8') < 32 ||
      Buffer.byteLength(leadHashSecret || '', 'utf8') < 32 ||
      !/^[a-z0-9]{20}$/.test(expectedProjectRef || '')) {
    throw new Error('EXCLUSION_COLLECTOR_CONFIGURATION_INVALID');
  }
  const origin = assertProductionEndpoint(supabaseUrl, expectedProjectRef);
  const campaign = readCampaignWorkbook(workbookPath);
  const validation = validateCampaignRows(campaign.rows, { requireReady: false });
  if (!validation.ok || !validation.summary.campaignExternalId ||
      !HASH.test(validation.summary.logicalDatasetSha256 || '')) {
    throw new Error('EXCLUSION_COLLECTOR_WORKBOOK_INVALID');
  }

  const targetByHash = new Map();
  for (const row of campaign.rows) {
    const email = text(row, 'correo electronico').trim().toLowerCase();
    const identityHash = campaignExclusionSubjectSha256(email, leadHashSecret);
    if (targetByHash.has(identityHash)) throw new Error('EXCLUSION_COLLECTOR_TARGET_DUPLICATE');
    targetByHash.set(identityHash, email);
  }

  const [leads, suppressions, campaignContacts] = await Promise.all([
    fetchAll(fetchImpl, origin, serviceKey, 'leads', 'lead_id'),
    fetchAll(fetchImpl, origin, serviceKey, 'campaign_suppressions', 'identity_hash,reason,scope'),
    fetchAll(fetchImpl, origin, serviceKey, 'campaign_contacts', 'email_hash'),
  ]);
  const sourceRecords = new Map(EXCLUSION_SOURCES.map((source) => [source, new Map()]));

  for (const lead of leads) addTargetRecord(targetByHash, sourceRecords.get('suppression'), lead?.lead_id);
  for (const suppression of suppressions) {
    const identityHash = suppression?.identity_hash;
    addTargetRecord(targetByHash, sourceRecords.get('suppression'), identityHash);
    if (suppression?.reason === 'unsubscribe') addTargetRecord(targetByHash, sourceRecords.get('unsubscribe'), identityHash);
    if (suppression?.reason === 'opposition') addTargetRecord(targetByHash, sourceRecords.get('opposition'), identityHash);
    if (suppression?.reason === 'hard_bounce') addTargetRecord(targetByHash, sourceRecords.get('hard_bounce'), identityHash);
  }
  for (const contact of campaignContacts) addTargetRecord(targetByHash, sourceRecords.get('duplicate'), contact?.email_hash);

  const capturedAt = new Date(now).toISOString();
  const captureId = capturedAt.replace(/[-:.TZ]/g, '').slice(0, 14);
  const exports = EXCLUSION_SOURCES.map((source) => ({
    schema_version: SOURCE_EXPORT_SCHEMA,
    source,
    export_id: `prod-${source}-${captureId}`,
    campaign_id: validation.summary.campaignExternalId,
    dataset_sha256: validation.summary.logicalDatasetSha256,
    captured_at: capturedAt,
    max_age_seconds: MAX_AGE_SECONDS,
    full_snapshot: true,
    records: [...sourceRecords.get(source).entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([email, status]) => ({ email, status })),
  }));
  const bundle = {
    schema_version: SOURCE_BUNDLE_SCHEMA,
    key_id: `prod-${captureId}`,
    exports,
  };
  const target = requiredPrivatePath(outputPath);
  fs.writeFileSync(target, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return {
    ok: true,
    campaign_id_hash: sha256(validation.summary.campaignExternalId),
    dataset_sha256: validation.summary.logicalDatasetSha256,
    contacts: campaign.rows.length,
    source_counts: Object.fromEntries(exports.map((entry) => [entry.source, entry.records.length])),
    redacted: true,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await collectCampaignExclusionSources({
      workbookPath: requiredPrivatePath(process.env.CAMPAIGN_OPERATIONAL_FILE),
      outputPath: requiredPrivatePath(process.env.CAMPAIGN_EXCLUSION_RAW_EXPORTS_FILE),
      supabaseUrl: process.env.SUPABASE_URL,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      leadHashSecret: process.env.LEAD_HASH_SECRET,
      expectedProjectRef: process.env.EXPECTED_SUPABASE_PROJECT_REF,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error instanceof Error ? error.message : 'EXCLUSION_COLLECTION_FAILED' }));
    process.exitCode = 2;
  }
}
