-- Additive transactional resource-delivery state. Does not activate Make or send email.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

alter table public.leads
  add column if not exists accepted_by_make_at timestamptz,
  add column if not exists email_delivery_status text not null default 'pending',
  add column if not exists email_delivery_updated_at timestamptz;

alter table public.leads drop constraint if exists leads_email_delivery_status_check;
alter table public.leads add constraint leads_email_delivery_status_check
  check (email_delivery_status in ('pending', 'email_sent', 'email_failed')) not valid;
alter table public.leads validate constraint leads_email_delivery_status_check;

alter table public.delivery_queue
  add column if not exists accepted_by_make_at timestamptz;

create table if not exists public.transactional_email_events (
  id uuid primary key default gen_random_uuid(),
  submission_id text not null,
  lead_id text not null,
  event_name text not null check (event_name in ('email_sent', 'email_failed')),
  source_event_id text not null,
  occurred_at timestamptz not null,
  provider_message_hash text,
  failure_code text,
  created_at timestamptz not null default now(),
  constraint transactional_email_events_source_unique unique (source_event_id),
  constraint transactional_email_events_provider_hash_check check (provider_message_hash is null or provider_message_hash ~ '^[a-f0-9]{64}$'),
  constraint transactional_email_events_failure_code_check check (failure_code is null or failure_code ~ '^[A-Z0-9_:-]{2,64}$')
);

create index if not exists transactional_email_events_submission_idx
  on public.transactional_email_events (submission_id, occurred_at desc);

alter table public.transactional_email_events enable row level security;
revoke all on table public.transactional_email_events from anon, authenticated;
grant all on table public.transactional_email_events to service_role;

commit;
