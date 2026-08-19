import type { CampaignTrackingContext } from '../types';

export function buildCampaignAwareUrl(
  rawUrl: string,
  campaign: CampaignTrackingContext,
  baseUrl: string,
): string {
  if (!rawUrl) return rawUrl;

  try {
    const url = new URL(rawUrl, baseUrl);
    // Keep the existing landing contract while also using Calendly-supported UTM fields.
    url.searchParams.set('cid', campaign.contact_id);
    url.searchParams.set('campaign_id', campaign.campaign_external_id);
    url.searchParams.set('utm_source', 'fundae_landing');
    url.searchParams.set('utm_medium', 'campaign');
    url.searchParams.set('utm_campaign', campaign.campaign_external_id);
    url.searchParams.set('utm_content', campaign.contact_id);
    return url.toString();
  } catch {
    return rawUrl;
  }
}
