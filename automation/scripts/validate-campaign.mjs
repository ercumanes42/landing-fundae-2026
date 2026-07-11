import { campaignFilePath, readCampaignWorkbook, validateCampaignRows } from './campaign-workbook.mjs';

const requireReady = process.argv.includes('--require-ready');

try {
  const { filePath, rows } = readCampaignWorkbook(campaignFilePath());
  const report = validateCampaignRows(rows, { requireReady });
  console.log(JSON.stringify({ file: filePath, ...report }, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Campaign validation failed');
  process.exitCode = 1;
}
