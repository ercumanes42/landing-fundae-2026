import assert from 'node:assert/strict';
import test from 'node:test';
import { DIAGNOSTIC_PDF_FILENAME, getBrandLogoUrl, loadBrandLogoDataUrl } from '../../src/lib/pdfGenerator';

test('uses a general PDF filename without personal identifiers', () => {
  assert.equal(DIAGNOSTIC_PDF_FILENAME, 'Resumen_Orientativo_FUNDAE.pdf');
});

test('resolves the GFS logo under the configured Vite base path', () => {
  assert.equal(getBrandLogoUrl('/campaign/'), '/campaign/gfs-consulting-logo.png');
  assert.equal(getBrandLogoUrl('/campaign'), '/campaign/gfs-consulting-logo.png');
});

test('converts the same-origin GFS logo response to a PNG data URL', async () => {
  const fetchLogo = async () => new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });

  const logo = await loadBrandLogoDataUrl(fetchLogo as typeof fetch, '/gfs-consulting-logo.png');
  assert.equal(logo, 'data:image/png;base64,iVBORw==');
});

test('returns null when the GFS logo cannot be loaded so PDF generation can continue', async () => {
  const fetchLogo = async () => {
    throw new Error('offline');
  };

  assert.equal(await loadBrandLogoDataUrl(fetchLogo as typeof fetch, '/missing-logo.png'), null);
});
