import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

import { readCampaignWorkbook, text, validateCampaignRows } from './campaign-workbook.mjs';
import { TECHNICAL_EVIDENCE_FIELD, TECHNICAL_STATUS_FIELDS } from './campaign-materialization.mjs';

export const EXCLUSION_SOURCES = [
  'unsubscribe',
  'opposition',
  'hard_bounce',
  'suppression',
  'duplicate',
];
export const MAX_SNAPSHOT_AGE_SECONDS = 86_400;
export const TECHNICAL_EVIDENCE_SCHEMA = 'fundae-campaign-technical-evidence-v1';
export const SOURCE_EXPORT_SCHEMA = 'fundae-campaign-exclusion-source-v1';
export const SOURCE_BUNDLE_SCHEMA = 'fundae-campaign-exclusion-source-bundle-v1';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MATERIALIZED_WORKBOOK = path.resolve(
  HERE, '../../data-private/Base_FUNDAE_2026_MATERIALIZADA_OFF_V1.xlsx',
);
export const MATERIALIZED_REPORT = path.resolve(
  HERE, '../../data-private/FUNDAE_2026_MATERIALIZED_COPY_REPORT.json',
);

const HASH = /^[a-f0-9]{64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KEY_ID = /^[A-Za-z0-9_-]{3,64}$/;
const SNAPSHOT_ID = /^[A-Za-z0-9_-]{8,100}$/;
const SNAPSHOT_KEYS = [
  'campaign_id', 'captured_at', 'dataset_sha256', 'key_id', 'max_age_seconds',
  'records', 'records_sha256', 'signature', 'snapshot_id', 'source',
];
const RECORD_KEYS = ['status', 'subject_sha256'];
const SOURCE_RECORD_KEYS = ['email', 'status'];
const SOURCE_EXPORT_KEYS = [
  'campaign_id', 'captured_at', 'dataset_sha256', 'export_id', 'full_snapshot',
  'max_age_seconds', 'records', 'schema_version', 'source',
];
const SOURCE_BUNDLE_KEYS = ['exports', 'key_id', 'schema_version'];
const SOURCE_TO_FIELD = {
  unsubscribe: 'unsubscribe status',
  opposition: 'opposition status',
  hard_bounce: 'hard bounce status',
  suppression: 'suppression status',
  duplicate: 'duplicate status',
};
const PRECEDENCE = { CLEAR: 0, PENDING_RECHECK: 1, STOP: 2 };

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validatedSecret(value, code) {
  const secret = String(value || '');
  if (Buffer.byteLength(secret, 'utf8') < 32 || secret !== secret.trim() ||
      /replace|placeholder|changeme|example/i.test(secret)) throw new Error(code);
  return secret;
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function canonicalRecords(records) {
  if (!Array.isArray(records)) throw new Error('SNAPSHOT_RECORDS_INVALID');
  const normalized = records.map((record) => {
    if (!exactKeys(record, RECORD_KEYS) || !HASH.test(record.subject_sha256 || '') ||
        !['STOP', 'PENDING_RECHECK'].includes(record.status)) {
      throw new Error('SNAPSHOT_RECORD_INVALID');
    }
    return { subject_sha256: record.subject_sha256, status: record.status };
  }).sort((left, right) => left.subject_sha256.localeCompare(right.subject_sha256));
  if (new Set(normalized.map((record) => record.subject_sha256)).size !== normalized.length) {
    throw new Error('SNAPSHOT_SUBJECT_DUPLICATE');
  }
  return normalized;
}

export function exclusionRecordsSha256(records) {
  return sha256(JSON.stringify(canonicalRecords(records)));
}

export function campaignExclusionSubjectSha256(email, leadHashSecret) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(normalized)) throw new Error('CAMPAIGN_EMAIL_INVALID');
  return createHmac('sha256', validatedSecret(leadHashSecret, 'LEAD_HASH_SECRET_INVALID'))
    .update(normalized).digest('hex');
}

function snapshotSignatureInput(snapshot, records) {
  return JSON.stringify({
    schema_version: TECHNICAL_EVIDENCE_SCHEMA,
    snapshot_id: snapshot.snapshot_id,
    key_id: snapshot.key_id,
    source: snapshot.source,
    campaign_id: snapshot.campaign_id,
    dataset_sha256: snapshot.dataset_sha256,
    captured_at: snapshot.captured_at,
    max_age_seconds: snapshot.max_age_seconds,
    records_sha256: snapshot.records_sha256,
    records,
  });
}

export function signCampaignExclusionSnapshot(snapshot, snapshotSecret) {
  const records = canonicalRecords(snapshot.records);
  return createHmac('sha256', validatedSecret(snapshotSecret, 'SNAPSHOT_SECRET_INVALID'))
    .update(snapshotSignatureInput(snapshot, records)).digest('hex');
}

function canonicalSourceRecords(records) {
  if (!Array.isArray(records)) throw new Error('SOURCE_EXPORT_RECORDS_INVALID');
  const normalized = records.map((record) => {
    const email = String(record?.email || '').trim().toLowerCase();
    if (!exactKeys(record, SOURCE_RECORD_KEYS) || !EMAIL.test(email) ||
        !['STOP', 'PENDING_RECHECK'].includes(record.status)) {
      throw new Error('SOURCE_EXPORT_RECORD_INVALID');
    }
    return { email, status: record.status };
  }).sort((left, right) => left.email.localeCompare(right.email));
  if (new Set(normalized.map((record) => record.email)).size !== normalized.length) {
    throw new Error('SOURCE_EXPORT_SUBJECT_DUPLICATE');
  }
  return normalized;
}

export function buildCampaignExclusionSnapshot(sourceExport, {
  leadHashSecret,
  snapshotSecret,
  keyId,
  now = new Date(),
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const capturedAtMs = Date.parse(sourceExport?.captured_at);
  if (!exactKeys(sourceExport, SOURCE_EXPORT_KEYS) ||
      sourceExport.schema_version !== SOURCE_EXPORT_SCHEMA ||
      !EXCLUSION_SOURCES.includes(sourceExport.source) ||
      sourceExport.full_snapshot !== true ||
      !SNAPSHOT_ID.test(sourceExport.export_id || '') ||
      !KEY_ID.test(keyId || '') ||
      !HASH.test(sourceExport.dataset_sha256 || '') ||
      typeof sourceExport.campaign_id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(sourceExport.campaign_id) ||
      !Number.isFinite(nowMs) || !Number.isFinite(capturedAtMs) ||
      capturedAtMs > nowMs + 300_000 ||
      !Number.isInteger(sourceExport.max_age_seconds) ||
      sourceExport.max_age_seconds < 1 ||
      sourceExport.max_age_seconds > MAX_SNAPSHOT_AGE_SECONDS) {
    throw new Error('SOURCE_EXPORT_METADATA_INVALID');
  }
  validatedSecret(leadHashSecret, 'LEAD_HASH_SECRET_INVALID');
  validatedSecret(snapshotSecret, 'SNAPSHOT_SECRET_INVALID');
  const records = canonicalSourceRecords(sourceExport.records).map((record) => ({
    subject_sha256: campaignExclusionSubjectSha256(record.email, leadHashSecret),
    status: record.status,
  }));
  const unsigned = {
    campaign_id: sourceExport.campaign_id,
    source: sourceExport.source,
    snapshot_id: sourceExport.export_id,
    key_id: keyId,
    dataset_sha256: sourceExport.dataset_sha256,
    captured_at: new Date(capturedAtMs).toISOString(),
    max_age_seconds: sourceExport.max_age_seconds,
    records_sha256: exclusionRecordsSha256(records),
    records,
  };
  return { ...unsigned, signature: signCampaignExclusionSnapshot(unsigned, snapshotSecret) };
}

export function buildCampaignExclusionSnapshotBundle(sourceBundle, options = {}) {
  if (!exactKeys(sourceBundle, SOURCE_BUNDLE_KEYS) ||
      sourceBundle.schema_version !== SOURCE_BUNDLE_SCHEMA ||
      !KEY_ID.test(sourceBundle.key_id || '') ||
      !Array.isArray(sourceBundle.exports) ||
      sourceBundle.exports.length !== EXCLUSION_SOURCES.length) {
    throw new Error('SOURCE_BUNDLE_INVALID');
  }
  const snapshots = sourceBundle.exports.map((sourceExport) =>
    buildCampaignExclusionSnapshot(sourceExport, {
      ...options,
      keyId: sourceBundle.key_id,
    }));
  if (new Set(snapshots.map((snapshot) => snapshot.source)).size !== EXCLUSION_SOURCES.length ||
      EXCLUSION_SOURCES.some((source) => !snapshots.some((snapshot) => snapshot.source === source)) ||
      new Set(snapshots.map((snapshot) => snapshot.snapshot_id)).size !== snapshots.length ||
      new Set(snapshots.map((snapshot) => snapshot.campaign_id)).size !== 1 ||
      new Set(snapshots.map((snapshot) => snapshot.dataset_sha256)).size !== 1) {
    throw new Error('SOURCE_BUNDLE_INVALID');
  }
  snapshots.sort((left, right) => left.source.localeCompare(right.source));
  return {
    schema_version: TECHNICAL_EVIDENCE_SCHEMA,
    snapshots,
    report: {
      schema_version: SOURCE_BUNDLE_SCHEMA,
      campaign_id_hash: sha256(snapshots[0].campaign_id),
      dataset_sha256: snapshots[0].dataset_sha256,
      sources: snapshots.map((snapshot) => ({
        source: snapshot.source,
        snapshot_id_hash: sha256(snapshot.snapshot_id),
        captured_at: snapshot.captured_at,
        max_age_seconds: snapshot.max_age_seconds,
        records_sha256: snapshot.records_sha256,
        records: snapshot.records.length,
      })),
      redacted: true,
    },
  };
}

function validateSnapshot(snapshot, nowMs, { campaignId, datasetSha256, snapshotSecret }) {
  if (!exactKeys(snapshot, SNAPSHOT_KEYS) || !EXCLUSION_SOURCES.includes(snapshot.source)) {
    throw new Error('SNAPSHOT_METADATA_INVALID');
  }
  const capturedAtMs = Date.parse(snapshot.captured_at);
  if (!Number.isFinite(capturedAtMs) || capturedAtMs > nowMs + 300_000 ||
      !Number.isInteger(snapshot.max_age_seconds) || snapshot.max_age_seconds < 1 ||
      snapshot.max_age_seconds > MAX_SNAPSHOT_AGE_SECONDS || !HASH.test(snapshot.records_sha256 || '') ||
      !HASH.test(snapshot.dataset_sha256 || '') || !HASH.test(snapshot.signature || '') ||
      !KEY_ID.test(snapshot.key_id || '') || !SNAPSHOT_ID.test(snapshot.snapshot_id || '') ||
      snapshot.campaign_id !== campaignId || snapshot.dataset_sha256 !== datasetSha256) {
    throw new Error('SNAPSHOT_METADATA_INVALID');
  }
  const records = canonicalRecords(snapshot.records);
  if (exclusionRecordsSha256(records) !== snapshot.records_sha256) {
    throw new Error('SNAPSHOT_HASH_MISMATCH');
  }
  const expectedSignature = signCampaignExclusionSnapshot(snapshot, snapshotSecret);
  if (!timingSafeEqual(Buffer.from(expectedSignature, 'hex'), Buffer.from(snapshot.signature, 'hex'))) {
    throw new Error('SNAPSHOT_SIGNATURE_INVALID');
  }
  return {
    snapshot_id: snapshot.snapshot_id,
    key_id: snapshot.key_id,
    source: snapshot.source,
    captured_at: new Date(capturedAtMs).toISOString(),
    capturedAtMs,
    max_age_seconds: snapshot.max_age_seconds,
    records_sha256: snapshot.records_sha256,
    records,
    fresh: nowMs - capturedAtMs <= snapshot.max_age_seconds * 1000,
  };
}

function statusCounts(rows, field) {
  return rows.reduce((counts, row) => {
    const status = row[field];
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

export function materializeCampaignExclusions(rows, snapshots, {
  now = new Date(), leadHashSecret, snapshotSecret, campaignId, datasetSha256,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs) || !Array.isArray(rows) || rows.length === 0 || !Array.isArray(snapshots) ||
      !campaignId || !HASH.test(datasetSha256 || '')) {
    throw new Error('MATERIALIZATION_INPUT_INVALID');
  }
  validatedSecret(leadHashSecret, 'LEAD_HASH_SECRET_INVALID');
  validatedSecret(snapshotSecret, 'SNAPSHOT_SECRET_INVALID');
  const validated = snapshots.map((snapshot) => validateSnapshot(
    snapshot, nowMs, { campaignId, datasetSha256, snapshotSecret },
  ));
  if (validated.length !== EXCLUSION_SOURCES.length ||
      new Set(validated.map((snapshot) => snapshot.source)).size !== EXCLUSION_SOURCES.length ||
      EXCLUSION_SOURCES.some((source) => !validated.some((snapshot) => snapshot.source === source))) {
    throw new Error('SNAPSHOT_SET_INCOMPLETE');
  }
  validated.sort((left, right) => left.source.localeCompare(right.source));
  const snapshotMaps = new Map(validated.map((snapshot) => [
    snapshot.source,
    new Map(snapshot.records.map((record) => [record.subject_sha256, record.status])),
  ]));

  const evaluated = rows.map((sourceRow) => {
    const contactId = text(sourceRow, 'contact id');
    if (text(sourceRow, 'campaign id') !== campaignId) throw new Error('CAMPAIGN_SCOPE_MISMATCH');
    const subjectSha256 = campaignExclusionSubjectSha256(text(sourceRow, 'correo electronico'), leadHashSecret);
    const statuses = {};
    for (const snapshot of validated) {
      const recorded = snapshotMaps.get(snapshot.source).get(subjectSha256);
      statuses[SOURCE_TO_FIELD[snapshot.source]] = recorded === 'STOP'
        ? 'STOP'
        : recorded === 'PENDING_RECHECK' || !snapshot.fresh
          ? 'PENDING_RECHECK'
          : 'CLEAR';
    }
    const overallStatus = Object.values(statuses).reduce(
      (highest, status) => PRECEDENCE[status] > PRECEDENCE[highest] ? status : highest,
      'CLEAR',
    );
    return { sourceRow, contactId, subjectSha256, statuses, overallStatus };
  });
  if (new Set(evaluated.map((row) => row.subjectSha256)).size !== evaluated.length) {
    throw new Error('CAMPAIGN_CONTACT_DUPLICATE');
  }

  const evidenceInput = {
    schema_version: TECHNICAL_EVIDENCE_SCHEMA,
    sources: validated.map((snapshot) => ({
      snapshot_id: snapshot.snapshot_id,
      key_id: snapshot.key_id,
      source: snapshot.source,
      captured_at: snapshot.captured_at,
      max_age_seconds: snapshot.max_age_seconds,
      records_sha256: snapshot.records_sha256,
    })),
    subjects: evaluated
      .map((row) => ({ subject_sha256: row.subjectSha256, statuses: row.statuses }))
      .sort((left, right) => left.subject_sha256.localeCompare(right.subject_sha256)),
  };
  const technicalEvidenceSha256 = sha256(
    `${TECHNICAL_EVIDENCE_SCHEMA}\x1f${JSON.stringify(evidenceInput)}`,
  );
  const materializedRows = evaluated.map(({ sourceRow, statuses, overallStatus }) => {
    const row = {
      ...sourceRow,
      ...statuses,
      [TECHNICAL_EVIDENCE_FIELD]: technicalEvidenceSha256,
      'eligibility status': overallStatus,
    };
    if (overallStatus === 'STOP') {
      row['habilitado envio'] = 'NO';
      row['estado secuencia'] = 'DETENIDA';
      row['estado envio'] = 'BLOQUEADO';
      row['validacion pre envio'] = 'STOP';
    }
    return row;
  });
  const report = {
    schema_version: TECHNICAL_EVIDENCE_SCHEMA,
    generated_at: new Date(nowMs).toISOString(),
    technical_evidence_sha256: technicalEvidenceSha256,
    contacts: materializedRows.length,
    overall_statuses: statusCounts(materializedRows, 'eligibility status'),
    technical_statuses: Object.fromEntries(
      TECHNICAL_STATUS_FIELDS.map((field) => [field, statusCounts(materializedRows, field)]),
    ),
    sources: validated.map((snapshot) => ({
      snapshot_id: snapshot.snapshot_id,
      key_id: snapshot.key_id,
      source: snapshot.source,
      captured_at: snapshot.captured_at,
      max_age_seconds: snapshot.max_age_seconds,
      records_sha256: snapshot.records_sha256,
      records: snapshot.records.length,
      fresh: snapshot.fresh,
    })),
    redacted: true,
  };
  return { rows: materializedRows, technicalEvidenceSha256, report };
}

function normalizeHeader(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function setCell(sheet, rowIndex, columnIndex, value) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  sheet[address] = { t: 's', v: String(value) };
}

function fileHash(filePath) {
  return sha256(fs.readFileSync(filePath));
}

export function writeMaterializedControlledCopy({
  inputPath, outputPath, reportPath, snapshots, now, leadHashSecret, snapshotSecret,
}) {
  const input = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  if (input.toLowerCase() === output.toLowerCase() || fs.existsSync(output)) {
    throw new Error('MATERIALIZED_OUTPUT_INVALID');
  }
  const campaign = readCampaignWorkbook(input);
  const sourceValidation = validateCampaignRows(campaign.rows, { requireReady: false });
  const campaignIds = [...new Set(campaign.rows.map((row) => text(row, 'campaign id')))];
  if (!sourceValidation.ok || campaignIds.length !== 1 || !campaignIds[0]) {
    throw new Error('MATERIALIZATION_SOURCE_INVALID');
  }
  const materialized = materializeCampaignExclusions(campaign.rows, snapshots, {
    now,
    leadHashSecret,
    snapshotSecret,
    campaignId: campaignIds[0],
    datasetSha256: sourceValidation.summary.logicalDatasetSha256,
  });
  const sheet = campaign.workbook.Sheets[campaign.sheetName];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const headers = [...(grid[0] || [])];
  const indexes = new Map(headers.map((header, index) => [normalizeHeader(header), index]));
  for (const field of [...TECHNICAL_STATUS_FIELDS, TECHNICAL_EVIDENCE_FIELD, 'eligibility status']) {
    if (!indexes.has(field)) {
      indexes.set(field, headers.length);
      setCell(sheet, 0, headers.length, field);
      headers.push(field);
    }
  }
  const byContact = new Map(materialized.rows.map((row) => [text(row, 'contact id'), row]));
  for (let rowIndex = 1; rowIndex < grid.length; rowIndex += 1) {
    const contactId = String(grid[rowIndex]?.[indexes.get('contact id')] || '').trim();
    const result = byContact.get(contactId);
    if (!result) continue;
    for (const field of [...TECHNICAL_STATUS_FIELDS, TECHNICAL_EVIDENCE_FIELD, 'eligibility status']) {
      setCell(sheet, rowIndex, indexes.get(field), result[field]);
    }
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp.xlsx`;
  try {
    XLSX.writeFile(campaign.workbook, temporary, { compression: true });
    const validation = validateCampaignRows(readCampaignWorkbook(temporary).rows, { requireReady: false });
    if (!validation.ok || validation.summary.policyCoverage.technicalEvidenceSha256 !== materialized.technicalEvidenceSha256) {
      throw new Error('MATERIALIZED_COPY_VALIDATION_FAILED');
    }
    fs.copyFileSync(temporary, output, fs.constants.COPYFILE_EXCL);
    const controlledReport = {
      ...materialized.report,
      controlled_copy_sha256: fileHash(output),
      logical_dataset_sha256: validation.summary.logicalDatasetSha256,
    };
    if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify(controlledReport, null, 2)}\n`, { flag: 'wx' });
    return controlledReport;
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function privatePath(variableName) {
  const value = String(process.env[variableName] || '').trim();
  if (!value || /^https?:/i.test(value)) throw new Error('PRIVATE_LOCAL_PATH_REQUIRED');
  const resolved = path.resolve(value);
  const privateRoot = path.resolve('data-private');
  if (resolved !== privateRoot && !resolved.startsWith(`${privateRoot}${path.sep}`)) {
    throw new Error('PRIVATE_LOCAL_PATH_REQUIRED');
  }
  return resolved;
}

async function runCli() {
  const args = process.argv.slice(2);
  if (args.some((argument) => !['--build-signed-snapshots', '--materialize-private-copy'].includes(argument)) ||
      args.includes('--build-signed-snapshots') && args.includes('--materialize-private-copy')) {
    throw new Error('MATERIALIZATION_ARGUMENTS_INVALID');
  }
  if (args.includes('--build-signed-snapshots')) {
    const sourcePath = privatePath('CAMPAIGN_EXCLUSION_RAW_EXPORTS_FILE');
    const outputPath = privatePath('CAMPAIGN_EXCLUSIONS_SNAPSHOT_FILE');
    const sourceBundle = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const built = buildCampaignExclusionSnapshotBundle(sourceBundle, {
      leadHashSecret: String(process.env.LEAD_HASH_SECRET || ''),
      snapshotSecret: String(process.env.CAMPAIGN_EXCLUSION_SNAPSHOT_SECRET || ''),
    });
    fs.writeFileSync(
      outputPath,
      `${JSON.stringify({ schema_version: built.schema_version, snapshots: built.snapshots }, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    return { ok: true, mode: 'snapshot_build', ...built.report };
  }
  const snapshotPath = privatePath('CAMPAIGN_EXCLUSIONS_SNAPSHOT_FILE');
  const inputPath = privatePath('CAMPAIGN_OPERATIONAL_FILE');
  const snapshots = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))?.snapshots;
  const leadHashSecret = String(process.env.LEAD_HASH_SECRET || '');
  const snapshotSecret = String(process.env.CAMPAIGN_EXCLUSION_SNAPSHOT_SECRET || '');
  const materialize = args.includes('--materialize-private-copy');
  if (!materialize) {
    const campaign = readCampaignWorkbook(inputPath);
    const validation = validateCampaignRows(campaign.rows, { requireReady: false });
    const campaignIds = [...new Set(campaign.rows.map((row) => text(row, 'campaign id')))];
    if (!validation.ok || campaignIds.length !== 1 || !campaignIds[0]) throw new Error('MATERIALIZATION_SOURCE_INVALID');
    return materializeCampaignExclusions(campaign.rows, snapshots, {
      leadHashSecret,
      snapshotSecret,
      campaignId: campaignIds[0],
      datasetSha256: validation.summary.logicalDatasetSha256,
    }).report;
  }
  const outputPath = MATERIALIZED_WORKBOOK;
  const reportPath = MATERIALIZED_REPORT;
  return writeMaterializedControlledCopy({
    inputPath, outputPath, reportPath, snapshots, leadHashSecret, snapshotSecret,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runCli(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error instanceof Error ? error.message : 'MATERIALIZATION_FAILED' }));
    process.exitCode = 2;
  }
}
