import { campaignFilePath, readCampaignWorkbook, text } from './campaign-workbook.mjs';

try {
  const { filePath, rows } = readCampaignWorkbook(campaignFilePath());
  const bySizeAndLot = {};
  for (const row of rows) {
    const size = text(row, 'tipo de empresa') || 'Unknown';
    const lot = text(row, 'lote envio') || 'Unknown';
    bySizeAndLot[size] ||= { A: 0, B: 0, C: 0, D: 0 };
    bySizeAndLot[size][lot] = (bySizeAndLot[size][lot] || 0) + 1;
  }

  const target = {};
  for (const [size, values] of Object.entries(bySizeAndLot)) {
    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    target[size] = { min: Math.floor(total / 4), max: Math.ceil(total / 4) };
  }

  console.log(JSON.stringify({
    file: filePath,
    strategy: 'Report only. Apply approved swaps in the Google Sheets operational copy, never in the master workbook.',
    current: bySizeAndLot,
    targetPerLot: target,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Rebalance report failed');
  process.exitCode = 1;
}
