import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCampaignAwareUrl } from '../../src/lib/campaignUrl';

const campaign = {
  campaign_external_id: 'FUNDAE_2026_EMAIL_V1',
  contact_id: 'F26-A-0001',
};

test('keeps the landing contract and adds Calendly-supported attribution without PII', () => {
  const result = new URL(buildCampaignAwareUrl(
    'https://calendly.com/gfs/diagnostico?month=2026-09',
    campaign,
    'https://fundae.gfs.es',
  ));

  assert.equal(result.searchParams.get('month'), '2026-09');
  assert.equal(result.searchParams.get('cid'), campaign.contact_id);
  assert.equal(result.searchParams.get('campaign_id'), campaign.campaign_external_id);
  assert.equal(result.searchParams.get('utm_source'), 'fundae_landing');
  assert.equal(result.searchParams.get('utm_medium'), 'campaign');
  assert.equal(result.searchParams.get('utm_campaign'), campaign.campaign_external_id);
  assert.equal(result.searchParams.get('utm_content'), campaign.contact_id);
  assert.equal(result.toString().includes('@'), false);
});

test('returns malformed input unchanged', () => {
  assert.equal(buildCampaignAwareUrl('http://[', campaign, 'https://fundae.gfs.es'), 'http://[');
});
