-- Operational and schema gate for the 20260811 controlled release.
-- Read-only: run before 20260811_preflight.sql. It always rolls back.
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

  select string_agg(required.table_name || '.' || required.column_name, ', '
    order by required.table_name, required.column_name)
  into v_missing
  from (values
    ('leads', 'payload'),
    ('delivery_queue', 'payload'),
    ('delivery_queue', 'target'),
    ('campaigns', 'id'),
    ('campaigns', 'external_id'),
    ('campaigns', 'status'),
    ('campaigns', 'is_active'),
    ('campaign_contacts', 'id'),
    ('campaign_contacts', 'campaign_id'),
    ('campaign_contacts', 'external_contact_id'),
    ('campaign_contacts', 'email_hash'),
    ('campaign_contacts', 'current_step'),
    ('campaign_contacts', 'sequence_status'),
    ('campaign_contacts', 'next_delivery_status'),
    ('campaign_contacts', 'next_scheduled_at'),
    ('campaign_contacts', 'locked_at'),
    ('campaign_contacts', 'lock_token'),
    ('campaign_contacts', 'lock_expires_at'),
    ('campaign_contacts', 'resource_started_at'),
    ('campaign_contacts', 'resource_completed_at'),
    ('campaign_contacts', 'meeting_booked_at'),
    ('campaign_contacts', 'meeting_completed_at'),
    ('campaign_contacts', 'opportunity_created_at'),
    ('campaign_contacts', 'last_event_at'),
    ('campaign_events', 'id'),
    ('campaign_events', 'campaign_id'),
    ('campaign_events', 'campaign_contact_id'),
    ('campaign_events', 'source_event_id'),
    ('campaign_events', 'event_name'),
    ('campaign_events', 'occurred_at'),
    ('campaign_events', 'context'),
    ('campaign_events', 'properties')
  ) as required(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = required.table_name
      and c.column_name = required.column_name
  );

  if v_missing is not null then
    raise exception 'Missing required public columns: %', v_missing;
  end if;

  if to_regprocedure('public.touch_updated_at()') is null then
    raise exception 'Missing required function public.touch_updated_at()';
  end if;

  if to_regrole('anon') is null or to_regrole('authenticated') is null or
     to_regrole('service_role') is null then
    raise exception 'Supabase API roles anon, authenticated or service_role are missing';
  end if;

  if exists (
    select 1 from public.campaigns
    where external_id = 'FUNDAE_2026_EMAIL_V1'
      and (is_active or status in ('active', 'running', 'pilot'))
  ) then
    raise exception 'FUNDAE_2026_EMAIL_V1 must be inactive before migration';
  end if;

  if exists (
    select 1 from public.campaign_contacts
    where lock_expires_at is not null and lock_expires_at > now()
  ) then
    raise exception 'Active campaign delivery locks exist; stop writers and retry after leases expire';
  end if;

  if to_regclass('public.campaign_executions') is not null or
     to_regclass('public.campaign_suppressions') is not null or
     to_regclass('public.campaign_unsubscribe_tokens') is not null then
    raise exception 'Target release tables already exist; audit partial application before continuing';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and (
      (table_name = 'campaigns' and column_name = 'intent_enabled') or
      (table_name = 'campaign_contacts' and column_name in (
        'cold_sequence_status', 'intent_sequence_status', 'transactional_status',
        'marketing_lane', 'suppression_scope', 'stopped_at', 'stopped_reason',
        'suppressed_at', 'suppression_reason'
      ))
    )
  ) then
    raise exception 'Hardening columns already exist; audit partial application before continuing';
  end if;
end;
$$;

select 'release_gate_ok' as result,
  current_database() as database_name,
  current_setting('server_version') as postgres_version,
  now() as checked_at,
  (select count(*) from public.leads) as leads,
  (select count(*) from public.events) as events,
  (select count(*) from public.delivery_queue) as delivery_queue,
  (select count(*) from public.campaigns) as campaigns,
  (select count(*) from public.campaign_contacts) as campaign_contacts,
  (select count(*) from public.campaign_events) as campaign_events;

rollback;
