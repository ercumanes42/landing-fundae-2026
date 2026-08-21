-- Reject new campaign contacts whose canonical identity is already suppressed.
-- This remains additive and never enables outbound.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create or replace function fundae_private.reject_suppressed_campaign_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' and
     (new.marketing_lane <> 'cold' or new.suppression_scope <> 'none') then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.email_hash, 20260819234000)
  );
  if exists (
    select 1 from public.campaign_suppressions
    where identity_hash = new.email_hash
  ) then
    raise exception using errcode = '23514',
      message = 'campaign_contact_suppressed';
  end if;
  return new;
end;
$$;

revoke execute on function fundae_private.reject_suppressed_campaign_contact()
  from public, anon, authenticated, service_role;

commit;
