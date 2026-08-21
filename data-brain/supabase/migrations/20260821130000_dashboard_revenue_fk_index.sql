-- Cover the campaign contact foreign key used by revenue reconciliation.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create index if not exists campaign_revenue_pipeline_contact_idx
  on fundae_private.campaign_revenue_pipeline (campaign_contact_id);

commit;
