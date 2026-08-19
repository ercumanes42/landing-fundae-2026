import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const [mode = 'inspect', inputArg, outputArg] = process.argv.slice(2);
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
} else if (mode === 'update') {
  throw new Error('Update mode is not implemented yet');
} else {
  throw new Error(`Unsupported mode: ${mode}`);
}