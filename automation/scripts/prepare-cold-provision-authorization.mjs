import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  READY_REPORT, READY_WORKBOOK, analyzeControlledWorkbook,
  buildProvisionManifest, prepareProvisionRows,
} from './provision-cold-campaign.mjs';
import { text } from './campaign-workbook.mjs';

const outputPath = path.resolve('data-private/FUNDAE_2026_PROVISION_AUTH_PRIVATE.json');
if (fs.existsSync(outputPath)) throw new Error('PROVISION_AUTH_ALREADY_EXISTS');
const analysis = analyzeControlledWorkbook({ workbookPath: READY_WORKBOOK, reportPath: READY_REPORT });
if (!analysis.ready) throw new Error(`PROVISION_NOT_READY:${analysis.gates.join(',')}`);
const rows = prepareProvisionRows(analysis.rows, {
  unsubscribeSecret: process.env.UNSUBSCRIBE_TOKEN_SECRET || '',
  unsubscribeBaseUrl: process.env.UNSUBSCRIBE_PUBLIC_BASE_URL || '',
  leadHashSecret: process.env.LEAD_HASH_SECRET || '',
});
const manifest = buildProvisionManifest(
  rows, analysis.report.logicalDatasetSha256, analysis.report.technicalEvidenceSha256,
);
const actorHash = randomBytes(32).toString('hex');
const authorizationToken = randomBytes(48).toString('base64url');
const authorizationHash = createHash('sha256').update(authorizationToken).digest('hex');
const privateAuthorization = {
  schema_version: 'fundae-cold-provision-authorization-v1',
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  campaign_external_id: text(analysis.rows[0], 'campaign id'),
  manifest_hash: manifest.manifestHash,
  actor_hash: actorHash,
  authorization_hash: authorizationHash,
  authorization_token: authorizationToken,
  contacts: 939,
  payloads: 4695,
};
fs.writeFileSync(outputPath, `${JSON.stringify(privateAuthorization, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({
  accepted: true,
  campaign_external_id: privateAuthorization.campaign_external_id,
  manifest_hash: manifest.manifestHash,
  actor_hash: actorHash,
  authorization_hash: authorizationHash,
  expires_at: privateAuthorization.expires_at,
  contacts: 939,
  payloads: 4695,
}, null, 2));
