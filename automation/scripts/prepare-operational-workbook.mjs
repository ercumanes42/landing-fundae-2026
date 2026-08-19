import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { campaignFilePath, readCampaignWorkbook, validateCampaignRows } from './campaign-workbook.mjs';
import { injectOptOutFooter } from './unsubscribe-operations.mjs';

const BODY_COLUMNS = [1, 2, 3, 4, 5].map((step) => `email${step} cuerpo html`);
const LEGAL_EVIDENCE_HEADERS = [
  'base_juridica_envio',
  'origen_datos',
  'referencia_evidencia',
  'fecha_evidencia',
];

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fileHash(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function requiredPath(variableName) {
  const value = String(process.env[variableName] || '').trim();
  if (!value) throw new Error(`${variableName} is required`);
  return path.resolve(value);
}

function setTextCell(sheet, rowIndex, columnIndex, value) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  const existing = sheet[address] || {};
  sheet[address] = { ...existing, t: 's', v: value };
  delete sheet[address].f;
  delete sheet[address].w;
}

const mode = String(process.env.UNSUBSCRIBE_MODE || 'placeholder').trim().toLowerCase();
if (mode !== 'placeholder') {
  throw new Error('Only UNSUBSCRIBE_MODE=placeholder is supported locally; Make must request the URL from Data Brain /api/campaign/unsubscribe-link');
}

const sourcePath = path.resolve(campaignFilePath());
const outputPath = requiredPath('CAMPAIGN_OPERATIONAL_FILE');
if (sourcePath.toLowerCase() === outputPath.toLowerCase()) {
  throw new Error('CAMPAIGN_OPERATIONAL_FILE must differ from the immutable CAMPAIGN_FILE');
}
if (!fs.existsSync(sourcePath)) throw new Error('CAMPAIGN_FILE was not found');
if (fs.existsSync(outputPath) && process.env.CAMPAIGN_OPERATIONAL_OVERWRITE !== 'true') {
  throw new Error('Operational copy already exists; set CAMPAIGN_OPERATIONAL_OVERWRITE=true to replace only that copy');
}

const sourceHashBefore = fileHash(sourcePath);
const source = readCampaignWorkbook(sourcePath);
const sourceValidation = validateCampaignRows(source.rows, { requireReady: false });
if (!sourceValidation.ok) {
  throw new Error(`Source workbook is structurally invalid: ${sourceValidation.errors.join('; ')}`);
}

const workbook = XLSX.readFile(sourcePath, { cellDates: true });
const sheet = workbook.Sheets[source.sheetName];
const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
const indexes = new Map((grid[0] || []).map((header, index) => [normalizeHeader(header), index]));
const legalColumnsAdded = [];
let nextColumnIndex = (grid[0] || []).length;
for (const header of LEGAL_EVIDENCE_HEADERS) {
  const normalized = normalizeHeader(header);
  if (indexes.has(normalized)) continue;
  setTextCell(sheet, 0, nextColumnIndex, header);
  indexes.set(normalized, nextColumnIndex);
  legalColumnsAdded.push(header);
  nextColumnIndex += 1;
}
if (legalColumnsAdded.length > 0) {
  const sheetRange = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  sheetRange.e.c = Math.max(sheetRange.e.c, nextColumnIndex - 1);
  sheet['!ref'] = XLSX.utils.encode_range(sheetRange);
}
for (const column of ['contact id', ...BODY_COLUMNS]) {
  if (!indexes.has(column)) throw new Error(`Missing required operational column: ${column}`);
}

let contacts = 0;
let updatedBodies = 0;
for (let rowIndex = 1; rowIndex < grid.length; rowIndex += 1) {
  const values = grid[rowIndex] || [];
  const contactId = String(values[indexes.get('contact id')] || '').trim();
  if (!contactId) continue;
  for (const bodyColumn of BODY_COLUMNS) {
    const columnIndex = indexes.get(bodyColumn);
    setTextCell(
      sheet,
      rowIndex,
      columnIndex,
      injectOptOutFooter(String(values[columnIndex] || ''), '{{unsubscribe_url}}'),
    );
    updatedBodies += 1;
  }
  contacts += 1;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const temporaryWorkbook = `${outputPath}.${process.pid}.tmp.xlsx`;
try {
  XLSX.writeFile(workbook, temporaryWorkbook, { compression: true });
  const prepared = readCampaignWorkbook(temporaryWorkbook);
  const preparedValidation = validateCampaignRows(prepared.rows, { requireReady: false });
  if (
    !preparedValidation.ok ||
    preparedValidation.summary.optOutCoverage.missingBodies !== 0 ||
    preparedValidation.summary.legalBasisCoverage.missingColumns.length !== 0
  ) {
    throw new Error('Operational copy failed structural, opt-out or legal-column validation');
  }
  if (fileHash(sourcePath) !== sourceHashBefore) {
    throw new Error('Safety check failed: the immutable source workbook changed');
  }
  fs.copyFileSync(temporaryWorkbook, outputPath);
  console.log(JSON.stringify({
    ok: true,
    mode: 'placeholder',
    contacts,
    updatedBodies,
    legalColumnsAdded,
    legalBasisCoverage: preparedValidation.summary.legalBasisCoverage,
    optOutCoverage: preparedValidation.summary.optOutCoverage,
    sourceUnchanged: true,
    outputFile: path.basename(outputPath),
  }, null, 2));
} finally {
  if (fs.existsSync(temporaryWorkbook)) fs.rmSync(temporaryWorkbook, { force: true });
}
