-- FUNDAE Data Brain V5 campaign schema.
-- Safe for the current production database: it only adds campaign tables,
-- indexes, triggers and server-only access controls. It does not alter leads.

begin;

create extension if not exists pgcrypto;

create or replace function public.touch_campaign_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Keep compatibility if a legacy God Mode campaign table is added later.
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  external_id text,
  started_at timestamptz not null default now(),
  timezone text not null default 'Europe/Madrid',
  status text not null default 'draft',
  is_active boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.campaigns
  add column if not exists external_id text,
  add column if not exists timezone text not null default 'Europe/Madrid',
  add column if not exists status text not null default 'draft',
  add column if not exists updated_at timestamptz not null default now();

update public.campaigns
set external_id = 'legacy_' || replace(id::text, '-', '')
where external_id is null or external_id = '';

alter table public.campaigns
  alter column external_id set not null;

create unique index if not exists campaigns_external_id_idx
  on public.campaigns (external_id);

drop trigger if exists campaigns_touch_updated_at on public.campaigns;
create trigger campaigns_touch_updated_at
before update on public.campaigns
for each row execute function public.touch_campaign_updated_at();

create table if not exists public.campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  external_contact_id text not null,
  external_account_id text not null,
  email_hash text not null,
  contact_data jsonb not null default '{}'::jsonb,
  variant text not null,
  magnet text not null,
  lot text not null,
  company_size text,
  current_step integer not null default 1,
  sequence_status text not null default 'pending',
  next_delivery_status text not null default 'pending',
  last_delivery_status text,
  next_scheduled_at timestamptz,
  locked_at timestamptz,
  lock_token text,
  lock_expires_at timestamptz,
  attempt_count integer not null default 0,
  outlook_message_id text,
  outlook_conversation_id text,
  last_error_code text,
  last_error_message text,
  reply_type text,
  deal_value numeric(12, 2),
  parent_external_contact_id text,
  conditional_delivery boolean not null default false,
  resource_started_at timestamptz,
  resource_completed_at timestamptz,
  meeting_booked_at timestamptz,
  meeting_completed_at timestamptz,
  opportunity_created_at timestamptz,
  last_event_at timestamptz,
  hubspot_contact_id text,
  hubspot_sync_status text not null default 'pending',
  hubspot_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_contacts_step_range check (current_step between 1 and 6),
  constraint campaign_contacts_external_id_key unique (campaign_id, external_contact_id)
);

create index if not exists campaign_contacts_campaign_status_idx
  on public.campaign_contacts (campaign_id, sequence_status, next_delivery_status);
create index if not exists campaign_contacts_external_account_idx
  on public.campaign_contacts (campaign_id, external_account_id);
create index if not exists campaign_contacts_hubspot_id_idx
  on public.campaign_contacts (hubspot_contact_id)
  where hubspot_contact_id is not null;

drop trigger if exists campaign_contacts_touch_updated_at on public.campaign_contacts;
create trigger campaign_contacts_touch_updated_at
before update on public.campaign_contacts
for each row execute function public.touch_campaign_updated_at();

create table if not exists public.campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  campaign_contact_id uuid not null references public.campaign_contacts(id) on delete cascade,
  source_event_id text,
  event_name text not null,
  occurred_at timestamptz not null default now(),
  context jsonb not null default '{}'::jsonb,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists campaign_events_source_event_idx
  on public.campaign_events (campaign_id, source_event_id)
  where source_event_id is not null;
create index if not exists campaign_events_contact_time_idx
  on public.campaign_events (campaign_contact_id, occurred_at desc);
create index if not exists campaign_events_campaign_name_idx
  on public.campaign_events (campaign_id, event_name, occurred_at desc);

alter table public.campaigns enable row level security;
alter table public.campaign_contacts enable row level security;
alter table public.campaign_events enable row level security;

revoke all privileges on table public.campaigns from anon, authenticated;
revoke all privileges on table public.campaign_contacts from anon, authenticated;
revoke all privileges on table public.campaign_events from anon, authenticated;

insert into public.campaigns (
  name,
  external_id,
  timezone,
  status,
  is_active
)
values (
  'FUNDAE 2026 Email V1',
  'FUNDAE_2026_EMAIL_V1',
  'Europe/Madrid',
  'draft',
  false
)
on conflict (external_id) do nothing;

commit;
