import { campaignFilePath, readCampaignWorkbook, text } from './campaign-workbook.mjs';

try {
  const { filePath, rows } = readCampaignWorkbook(campaignFilePath());
  const failures = [];

  for (const row of rows) {
    const contactId = text(row, 'contact id');
    for (const field of ['enlace recurso utm', 'enlace calendly utm']) {
      const rawUrl = text(row, field);
      try {
        const url = new URL(rawUrl);
        if (url.searchParams.get('cid') !== contactId || !url.searchParams.get('utm_source')) {
          failures.push({ contactId, field });
        }
      } catch {
        failures.push({ contactId, field });
      }
    }
  }

  console.log(JSON.stringify({ file: filePath, contacts: rows.length, failures: failures.length }, null, 2));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Tracking URL validation failed');
  process.exitCode = 1;
}
