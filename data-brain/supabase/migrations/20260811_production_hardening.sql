-- Additive hardening for lead idempotency and the four-funnel campaign model.
-- Review and apply manually in Supabase after taking a backup. Not executed by Codex.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Fail before any DDL when the legacy campaign foundation is incomplete.
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

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads' and column_name = 'payload'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'delivery_queue' and column_name = 'payload'
  ) then
    raise exception 'leads.payload and delivery_queue.payload are required';
  end if;

  if exists (
    select 1 from public.campaign_contacts where current_step not between 1 and 5
  ) then
    raise exception 'campaign_contacts contains current_step outside 1..5; resolve before migration';
  end if;

  if exists (
    select 1 from public.leads
    where nullif(payload ->> 'submission_id', '') is not null
    group by nullif(payload ->> 'submission_id', '')
    having count(*) > 1
  ) then
    raise exception 'Duplicate non-empty leads.payload.submission_id values detected';
  end if;

  if exists (
    select 1 from public.delivery_queue
    where nullif(payload ->> 'submission_id', '') is not null
    group by nullif(payload ->> 'submission_id', ''), target
    having count(*) > 1
  ) then
    raise exception 'Duplicate non-empty delivery_queue submission_id/target values detected';
  end if;
end;
$$;

-- Range-only employee data cannot produce an official FUNDAE credit figure.
-- Stop generating unsupported point estimates; existing values remain for audit.
drop trigger if exists leads_estimate_credit_trigger on public.leads;
drop function if exists public.estimate_fundae_credit_func();
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads'
      and column_name = 'estimated_fundae_credit'
  ) then
    alter table public.leads alter column estimated_fundae_credit drop default;
  end if;
end;
$$;

alter table public.leads
  add column if not exists submission_id text;

update public.leads
set submission_id = nullif(payload ->> 'submission_id', '')
where submission_id is null
  and nullif(payload ->> 'submission_id', '') is not null;

create unique index if not exists leads_submission_id_unique_idx
  on public.leads (submission_id)
  where submission_id is not null;

alter table public.delivery_queue
  add column if not exists submission_id text;

update public.delivery_queue
set submission_id = nullif(payload ->> 'submission_id', '')
where submission_id is null
  and nullif(payload ->> 'submission_id', '') is not null;

create unique index if not exists delivery_queue_submission_target_unique_idx
  on public.delivery_queue (submission_id, target)
  where submission_id is not null;

alter table public.campaigns
  add column if not exists intent_enabled boolean not null default false;

alter table public.campaign_contacts
  add column if not exists cold_sequence_status text not null default 'pending',
  add column if not exists intent_sequence_status text not null default 'not_eligible',
  add column if not exists transactional_status text not null default 'not_requested',
  add column if not exists marketing_lane text not null default 'cold',
  add column if not exists suppression_scope text not null default 'none',
  add column if not exists stopped_at timestamptz,
  add column if not exists stopped_reason text,
  add column if not exists suppressed_at timestamptz,
  add column if not exists suppression_reason text;

alter table public.campaign_contacts
  drop constraint if exists campaign_contacts_step_range;

alter table public.campaign_contacts
  add constraint campaign_contacts_step_range
  check (current_step between 1 and 5) not valid;

alter table public.campaign_contacts
  validate constraint campaign_contacts_step_range;

create index if not exists campaign_contacts_lane_status_idx
  on public.campaign_contacts (campaign_id, marketing_lane, cold_sequence_status, intent_sequence_status);

alter table public.leads enable row level security;
alter table public.events enable row level security;
alter table public.delivery_queue enable row level security;
-- These analytics tables are optional in the legacy production schema.
do $$
begin
  if to_regclass('public.sessions') is not null then
    alter table public.sessions enable row level security;
    revoke all on table public.sessions from anon, authenticated;
  end if;
  if to_regclass('public.crm_deals') is not null then
    alter table public.crm_deals enable row level security;
    revoke all on table public.crm_deals from anon, authenticated;
  end if;
end;
$$;

revoke all on table public.leads from anon, authenticated;
revoke all on table public.events from anon, authenticated;
revoke all on table public.delivery_queue from anon, authenticated;

commit;