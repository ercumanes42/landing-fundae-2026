-- Run in Supabase SQL Editor before the 20260811 migration chain.
-- Read-only: raises on unsafe legacy data and always rolls back.
begin;
set local transaction read only;
set local statement_timeout = '5min';

do $$
declare
  v_missing text;
begin
  select string_agg(required_table, ', ' order by required_table)
  into v_missing
  from unnest(array[
    'leads', 'events', 'delivery_queue', 'campaigns', 'campaign_contacts', 'campaign_events'
  ]) as required(required_table)
  where to_regclass('public.' || required_table) is null;

  if v_missing is not null then
    raise exception 'Missing required public tables: %', v_missing;
  end if;

  if exists (
    select 1 from public.campaign_contacts where current_step not between 1 and 5
  ) then
    raise exception 'campaign_contacts contains current_step outside 1..5';
  end if;

  if exists (
    select 1 from public.leads
    where nullif(payload ->> 'submission_id', '') is not null
    group by nullif(payload ->> 'submission_id', '')
    having count(*) > 1
  ) then
    raise exception 'Duplicate leads payload submission_id values detected';
  end if;

  if exists (
    select 1 from public.delivery_queue
    where nullif(payload ->> 'submission_id', '') is not null
    group by nullif(payload ->> 'submission_id', ''), target
    having count(*) > 1
  ) then
    raise exception 'Duplicate delivery_queue payload submission_id/target values detected';
  end if;

  if exists (
    select 1
    from public.campaign_events ce
    join public.campaign_contacts cc on cc.id = ce.campaign_contact_id
    where ce.event_name = 'unsubscribe'
      and (cc.email_hash is null or cc.email_hash !~ '^[A-Za-z0-9_:-]{16,160}$')
  ) then
    raise exception 'Historical unsubscribe has an invalid contact email_hash';
  end if;
end;
$$;

select 'row_counts' as check_name,
  (select count(*) from public.leads) as leads,
  (select count(*) from public.delivery_queue) as delivery_queue,
  (select count(*) from public.campaign_contacts) as campaign_contacts,
  (select count(*) from public.campaign_events) as campaign_events;

select 'historical_unsubscribes' as check_name, count(*) as rows
from public.campaign_events
where event_name = 'unsubscribe';

select 'optional_analytics_tables' as check_name,
  to_regclass('public.sessions') is not null as sessions_exists,
  to_regclass('public.crm_deals') is not null as crm_deals_exists;

rollback;
