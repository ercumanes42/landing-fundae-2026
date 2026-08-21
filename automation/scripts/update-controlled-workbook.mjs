import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const artifactToolModule = process.env.ARTIFACT_TOOL_MODULE_URL || '@oai/artifact-tool';
const { FileBlob, SpreadsheetFile } = await import(artifactToolModule);

const [mode = 'inspect', inputArg, outputArg, baseReportArg, technicalReportArg, outputReportArg] = process.argv.slice(2);
if (!inputArg) throw new Error('Usage: update-controlled-workbook.mjs <inspect|update> <input.xlsx> [output]');

const inputPath = path.resolve(inputArg);
const outputPath = outputArg ? path.resolve(outputArg) : null;
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const inspectResult = async (options, fileName) => {
  const result = await workbook.inspect(options);
  if (outputPath) {
    await fs.mkdir(outputPath, { recursive: true });
    await fs.writeFile(path.join(outputPath, fileName), result.ndjson, 'utf8');
  }
  console.log(result.ndjson);
};

if (mode === 'inspect') {
  await inspectResult({ kind: 'sheet', include: 'id,name', maxChars: 12000 }, 'sheets.ndjson');
  await inspectResult({
    kind: 'table',
    sheetId: 'Destinatarios email frío',
    range: 'A1:CR6',
    include: 'values,formulas',
    tableMaxRows: 6,
    tableMaxCols: 96,
    tableMaxCellChars: 140,
    maxChars: 30000,
  }, 'recipients-head.ndjson');
  await inspectResult({
    kind: 'computedStyle',
    sheetId: 'Destinatarios email frío',
    range: 'A1:Z4',
    maxChars: 12000,
  }, 'recipients-style.ndjson');
  await inspectResult({
    kind: 'match',
    searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
    options: { useRegex: true, maxResults: 300 },
    summary: 'formula error scan before campaign update',
    maxChars: 12000,
  }, 'formula-errors-before.ndjson');
} else if (mode === 'authorize') {
  if (!outputPath || !baseReportArg || !technicalReportArg || !outputReportArg) {
    throw new Error('Usage: update-controlled-workbook.mjs authorize <input.xlsx> <output.xlsx> <base-report.json> <technical-report.json> <output-report.json>');
  }
  const sha256 = (value) => createHash('sha256').update(value).digest('hex');
  const inputBytes = await fs.readFile(inputPath);
  const baseReport = JSON.parse(await fs.readFile(path.resolve(baseReportArg), 'utf8'));
  const technicalReport = JSON.parse(await fs.readFile(path.resolve(technicalReportArg), 'utf8'));
  const clear = technicalReport.technical_statuses || {};
  const expectedTechnicalFields = [
    'unsubscribe status', 'opposition status', 'hard bounce status', 'suppression status', 'duplicate status',
  ];
  if (technicalReport.controlled_copy_sha256 !== sha256(inputBytes) ||
      technicalReport.contacts !== 939 || technicalReport.overall_statuses?.CLEAR !== 939 ||
      technicalReport.logical_dataset_sha256 !== baseReport.logical_dataset_sha256 ||
      expectedTechnicalFields.some((field) => clear[field]?.CLEAR !== 939)) {
    throw new Error('CAMPAIGN_AUTHORIZATION_EVIDENCE_INVALID');
  }

  const sheet = workbook.worksheets.getItem('Destinatarios email frío');
  sheet.getRange('CQ2:CQ940').values = Array.from({ length: 939 }, () => ['OK']);
  sheet.getRange('DJ2:DJ940').values = Array.from({ length: 939 }, () => ['AUTHORIZED']);
  sheet.getRange('DC2:DC940').values = Array.from({ length: 939 }, () => [new Date('2026-08-21T00:00:00.000Z')]);
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  const outputBytes = await fs.readFile(outputPath);
  const readyReport = {
    ...baseReport, ...technicalReport, report_version: '2.0.0',
    controlled_copy_sha256: sha256(outputBytes), readiness: { OK: 939 },
    technical_gates: {
      unsubscribe: { CLEAR: 939 }, opposition: { CLEAR: 939 }, hard_bounce: { CLEAR: 939 },
      suppression: { CLEAR: 939 }, duplicate: { CLEAR: 939 }, campaign_authorization: { AUTHORIZED: 939 },
    },
  };
  await fs.writeFile(path.resolve(outputReportArg), `${JSON.stringify(readyReport, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ accepted: true, contacts: 939,
    technical_evidence_sha256: readyReport.technical_evidence_sha256,
    controlled_copy_sha256: readyReport.controlled_copy_sha256 }, null, 2));
} else {
  throw new Error(`Unsupported mode: ${mode}`);
}
