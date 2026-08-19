-- Run after all release migrations. Read-only and rollback-only.
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
    'campaign_executions', 'campaign_suppressions', 'campaign_unsubscribe_tokens', 'rate_limit_buckets'
  ]) as required(required_table)
  where to_regclass('public.' || required_table) is null;

  if v_missing is not null then
    raise exception 'Missing migrated tables: %', v_missing;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.campaign_contacts'::regclass
      and conname = 'campaign_contacts_step_range' and convalidated
  ) then
    raise exception 'campaign_contacts_step_range is absent or not validated';
  end if;

  if exists (
    select 1 from public.leads
    where submission_id is null and nullif(payload ->> 'submission_id', '') is not null
  ) or exists (
    select 1 from public.delivery_queue
    where submission_id is null and nullif(payload ->> 'submission_id', '') is not null
  ) then
    raise exception 'submission_id backfill is incomplete';
  end if;

  if exists (
    select 1
    from public.campaign_events ce
    join public.campaign_contacts cc on cc.id = ce.campaign_contact_id
    left join public.campaign_suppressions s on s.identity_hash = cc.email_hash
    where ce.event_name = 'unsubscribe' and s.identity_hash is null
  ) then
    raise exception 'Historical unsubscribe is missing from the global registry';
  end if;

  if exists (
    select 1
    from public.campaign_contacts cc
    join public.campaign_suppressions s on s.identity_hash = cc.email_hash
    where cc.suppression_scope <> 'all'
       or cc.marketing_lane <> 'none'
       or cc.sequence_status <> 'stopped'
       or cc.next_delivery_status <> 'stopped'
       or cc.locked_at is not null
       or cc.lock_token is not null
       or cc.lock_expires_at is not null
  ) then
    raise exception 'A globally suppressed identity has an active sibling contact';
  end if;

  if exists (
    select 1
    from public.campaign_executions ex
    join public.campaign_contacts cc on cc.id = ex.campaign_contact_id
    join public.campaign_suppressions s on s.identity_hash = cc.email_hash
    where ex.status = 'planned'
  ) then
    raise exception 'A globally suppressed identity still has a planned execution';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('campaign_executions', 'campaign_suppressions', 'campaign_unsubscribe_tokens', 'rate_limit_buckets')
      and not c.relrowsecurity
  ) then
    raise exception 'RLS is disabled on a migrated server-only table';
  end if;

  if has_table_privilege('anon', 'public.campaign_executions', 'select')
     or has_table_privilege('authenticated', 'public.campaign_executions', 'select')
     or has_table_privilege('anon', 'public.campaign_suppressions', 'select')
     or has_table_privilege('authenticated', 'public.campaign_unsubscribe_tokens', 'select')
     or has_table_privilege('anon', 'public.rate_limit_buckets', 'select')
     or has_table_privilege('authenticated', 'public.rate_limit_buckets', 'select') then
    raise exception 'A browser role retains access to a migrated server-only table';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.authorize_campaign_delivery(text,text,text,timestamptz)',
    'execute'
  ) then
    raise exception 'service_role cannot execute authorize_campaign_delivery';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.consume_rate_limit(text,integer,integer,timestamptz)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.consume_rate_limit(text,integer,integer,timestamptz)',
    'execute'
  ) then
    raise exception 'Distributed rate limit function privileges are unsafe';
  end if;
end;
$$;

select 'migration_postcheck_ok' as result,
  (select count(*) from public.campaign_suppressions) as suppressed_identities,
  (select count(*) from public.campaign_unsubscribe_tokens where revoked_at is null) as active_tokens,
  (select count(*) from public.campaign_executions) as executions;

rollback;
