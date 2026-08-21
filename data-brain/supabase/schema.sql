create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  anonymous_id text,
  session_id text,
  form_type text not null,
  lead_magnet text not null,
  lead_score integer not null default 0,
  lead_classification text not null default 'cold',
  fit_score integer not null default 0,
  intent_score integer not null default 0,
  engagement_score integer not null default 0,
  urgency_score integer not null default 0,
  ai_summary jsonb,
  delivery_status text not null default 'queued',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  anonymous_id text not null,
  session_id text,
  lead_magnet text,
  occurred_at timestamptz not null default now(),
  context jsonb not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_queue (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  target text not null default 'make',
  payload jsonb not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_lead_id_idx on public.leads (lead_id);
create index if not exists leads_form_type_idx on public.leads (form_type);
create index if not exists leads_classification_idx on public.leads (lead_classification);
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists events_anon_session_idx on public.events (anonymous_id, session_id);
create index if not exists events_name_created_idx on public.events (event_name, created_at desc);
create index if not exists delivery_queue_status_next_idx
  on public.delivery_queue (status, next_attempt_at);

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_touch_updated_at on public.leads;
create trigger leads_touch_updated_at
before update on public.leads
for each row execute function public.touch_updated_at();

drop trigger if exists delivery_queue_touch_updated_at on public.delivery_queue;
create trigger delivery_queue_touch_updated_at
before update on public.delivery_queue
for each row execute function public.touch_updated_at();

-- =========================================================================
-- EXTENSIÓN B2B GROWTH ANALYTICS (PostHog, HubSpot y Hotjar)
-- =========================================================================

-- 1. Ampliación de la tabla leads
ALTER TABLE public.leads 
  ADD COLUMN IF NOT EXISTS first_utm_source text,
  ADD COLUMN IF NOT EXISTS first_utm_medium text,
  ADD COLUMN IF NOT EXISTS first_utm_campaign text,
  ADD COLUMN IF NOT EXISTS last_utm_source text,
  ADD COLUMN IF NOT EXISTS last_utm_medium text,
  ADD COLUMN IF NOT EXISTS last_utm_campaign text,
  ADD COLUMN IF NOT EXISTS referrer_host text,
  ADD COLUMN IF NOT EXISTS device_type text,
  ADD COLUMN IF NOT EXISTS browser_name text,
  ADD COLUMN IF NOT EXISTS os_name text,
  ADD COLUMN IF NOT EXISTS estimated_fundae_credit numeric(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS crm_contact_id text,
  ADD COLUMN IF NOT EXISTS time_to_convert_seconds integer;

CREATE INDEX IF NOT EXISTS leads_first_utm_campaign_idx ON public.leads (first_utm_campaign);
CREATE INDEX IF NOT EXISTS leads_estimated_credit_idx ON public.leads (estimated_fundae_credit DESC);
CREATE INDEX IF NOT EXISTS leads_crm_contact_id_idx ON public.leads (crm_contact_id);

-- 2. Tabla de Sesiones (Estilo PostHog)
CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text UNIQUE NOT NULL,
  anonymous_id text NOT NULL,
  first_utm_source text,
  first_utm_medium text,
  first_utm_campaign text,
  first_utm_content text,
  first_utm_term text,
  referrer_host text,
  device_type text,
  browser_name text,
  os_name text,
  ip_country text,
  duration_seconds integer DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NOT NULL DEFAULT now(),
  page_views_count integer DEFAULT 1,
  converted_lead BOOLEAN DEFAULT FALSE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_session_id_idx ON public.sessions (session_id);
CREATE INDEX IF NOT EXISTS sessions_anon_id_idx ON public.sessions (anonymous_id);
CREATE INDEX IF NOT EXISTS sessions_started_at_idx ON public.sessions (started_at DESC);

-- 3. Tabla de Pipeline Comercial (Sincronización CRM)
CREATE TABLE IF NOT EXISTS public.crm_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id text UNIQUE NOT NULL,
  crm_deal_id text UNIQUE NOT NULL,
  deal_stage text NOT NULL,
  deal_value numeric(12, 2) DEFAULT 0.00,
  sdr_owner text,
  speed_to_lead_seconds integer,
  first_contact_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_deals_stage_idx ON public.crm_deals (deal_stage);
CREATE INDEX IF NOT EXISTS crm_deals_value_idx ON public.crm_deals (deal_value DESC);

DROP TRIGGER IF EXISTS crm_deals_touch_updated_at ON public.crm_deals;
CREATE TRIGGER crm_deals_touch_updated_at
  BEFORE UPDATE ON public.crm_deals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Ampliación de la tabla events para micro-interacciones
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS page_url text,
  ADD COLUMN IF NOT EXISTS time_on_field_ms integer,
  ADD COLUMN IF NOT EXISTS field_id text;

CREATE INDEX IF NOT EXISTS events_field_idx ON public.events (field_id) WHERE field_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_page_url_idx ON public.events (page_url) WHERE page_url IS NOT NULL;

-- 5. Trigger para estimación automática de crédito FUNDAE
CREATE OR REPLACE FUNCTION public.estimate_fundae_credit_func()
RETURNS TRIGGER AS $$
DECLARE
  employee_range text;
  calculated_credit numeric(10, 2) := 0.00;
BEGIN
  employee_range := NEW.payload->'company'->>'employee_range';
  CASE employee_range
    WHEN '1-5' THEN calculated_credit := 420.00;
    WHEN '6-9' THEN calculated_credit := 900.00;
    WHEN '10-49' THEN calculated_credit := 3600.00;
    WHEN '50-249' THEN calculated_credit := 15000.00;
    WHEN '+249' THEN calculated_credit := 40000.00;
    ELSE calculated_credit := 0.00;
  END CASE;
  NEW.estimated_fundae_credit := calculated_credit;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_estimate_credit_trigger ON public.leads;
CREATE TRIGGER leads_estimate_credit_trigger
  BEFORE INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.estimate_fundae_credit_func();

-- =========================================================================
-- EXTENSIÓN GOD MODE (Campañas y Telemetría Ultra-detallada)
-- =========================================================================

-- 6. Tabla de Campañas para aislamiento de datos (Opción B)
CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    started_at TIMESTAMPTZ DEFAULT now(),
    is_active BOOLEAN DEFAULT false
);

-- Insertar la primera campaña activa por defecto si no hay ninguna
INSERT INTO public.campaigns (name, is_active) 
SELECT 'Lanzamiento Inicial (God Mode)', true
WHERE NOT EXISTS (SELECT 1 FROM public.campaigns);

-- 7. Ampliación de la tabla events para God Mode
ALTER TABLE public.events 
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id),
  ADD COLUMN IF NOT EXISTS active_seconds integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idle_seconds integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_scroll_pct integer DEFAULT 0;

-- 8. Actualizar eventos antiguos para asignarles la campaña activa por defecto
UPDATE public.events 
SET campaign_id = (SELECT id FROM public.campaigns WHERE is_active = true LIMIT 1)
WHERE campaign_id IS NULL;

-- =========================================================================
-- FUNDAE 2026 CAMPAIGN: OPERATIONS, ATTRIBUTION AND CRM
-- =========================================================================

-- The original God Mode table predates the outbound campaign. Keep existing
-- rows and add a stable external identifier used by Excel, Make and HubSpot.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Europe/Madrid',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.campaigns
SET external_id = 'legacy_' || replace(id::text, '-', '')
WHERE external_id IS NULL OR external_id = '';

ALTER TABLE public.campaigns
  ALTER COLUMN external_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_external_id_idx
  ON public.campaigns (external_id);

DROP TRIGGER IF EXISTS campaigns_touch_updated_at ON public.campaigns;
CREATE TRIGGER campaigns_touch_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.campaign_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  external_contact_id text NOT NULL,
  external_account_id text NOT NULL,
  email_hash text NOT NULL,
  contact_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  variant text NOT NULL,
  magnet text NOT NULL,
  lot text NOT NULL,
  company_size text,
  current_step integer NOT NULL DEFAULT 1,
  sequence_status text NOT NULL DEFAULT 'pending',
  next_delivery_status text NOT NULL DEFAULT 'pending',
  last_delivery_status text,
  next_scheduled_at timestamptz,
  locked_at timestamptz,
  lock_token text,
  lock_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  outlook_message_id text,
  outlook_conversation_id text,
  last_error_code text,
  last_error_message text,
  reply_type text,
  deal_value numeric(12, 2),
  parent_external_contact_id text,
  conditional_delivery boolean NOT NULL DEFAULT false,
  resource_started_at timestamptz,
  resource_completed_at timestamptz,
  meeting_booked_at timestamptz,
  meeting_completed_at timestamptz,
  opportunity_created_at timestamptz,
  last_event_at timestamptz,
  hubspot_contact_id text,
  hubspot_sync_status text NOT NULL DEFAULT 'pending',
  hubspot_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_contacts_step_range CHECK (current_step BETWEEN 1 AND 6),
  CONSTRAINT campaign_contacts_external_id_key UNIQUE (campaign_id, external_contact_id)
);

CREATE INDEX IF NOT EXISTS campaign_contacts_campaign_status_idx
  ON public.campaign_contacts (campaign_id, sequence_status, next_delivery_status);
CREATE INDEX IF NOT EXISTS campaign_contacts_external_account_idx
  ON public.campaign_contacts (campaign_id, external_account_id);
CREATE INDEX IF NOT EXISTS campaign_contacts_hubspot_id_idx
  ON public.campaign_contacts (hubspot_contact_id)
  WHERE hubspot_contact_id IS NOT NULL;

DROP TRIGGER IF EXISTS campaign_contacts_touch_updated_at ON public.campaign_contacts;
CREATE TRIGGER campaign_contacts_touch_updated_at
  BEFORE UPDATE ON public.campaign_contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  campaign_contact_id uuid NOT NULL REFERENCES public.campaign_contacts(id) ON DELETE CASCADE,
  source_event_id text,
  event_name text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_events_source_event_idx
  ON public.campaign_events (campaign_id, source_event_id)
  WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaign_events_contact_time_idx
  ON public.campaign_events (campaign_contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS campaign_events_campaign_name_idx
  ON public.campaign_events (campaign_id, event_name, occurred_at DESC);

-- The browser never talks to Supabase directly. RLS keeps campaign PII and
-- operational records available only to the server-side service role.
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_events ENABLE ROW LEVEL SECURITY;


REVOKE ALL ON TABLE public.leads FROM anon, authenticated;
REVOKE ALL ON TABLE public.events FROM anon, authenticated;
REVOKE ALL ON TABLE public.delivery_queue FROM anon, authenticated;
REVOKE ALL ON TABLE public.sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.crm_deals FROM anon, authenticated;
REVOKE ALL ON TABLE public.campaigns FROM anon, authenticated;
REVOKE ALL ON TABLE public.campaign_contacts FROM anon, authenticated;
REVOKE ALL ON TABLE public.campaign_events FROM anon, authenticated;

-- =========================================================================
-- FINAL PRODUCTION STATE (kept in parity with additive migrations)
-- =========================================================================

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

-- Canonical journey and calendar/control. Additive; apply manually after backup.
-- Depends on 20260811_production_hardening.sql.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

do $$
begin
  if to_regclass('public.campaigns') is null or
     to_regclass('public.campaign_contacts') is null or
     to_regclass('public.campaign_events') is null then
    raise exception 'Campaign foundation is incomplete; apply campaign V5 and production hardening first';
  end if;
end;
$$;

create table if not exists public.campaign_executions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  campaign_contact_id uuid not null references public.campaign_contacts(id) on delete cascade,
  idempotency_key text not null,
  channel text not null check (channel in ('email', 'linkedin', 'manual')),
  capture_method text not null check (capture_method in ('automation', 'provider_webhook', 'official_api', 'manual')),
  action_name text not null,
  step integer check (step is null or step between 1 and 5),
  status text not null check (status in ('planned', 'executed', 'failed', 'stopped')),
  scheduled_for timestamptz,
  planned_at timestamptz,
  actual_at timestamptz,
  failed_at timestamptz,
  stopped_at timestamptz,
  failure_code text,
  stop_reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_executions_key_format check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$'),
  constraint campaign_executions_linkedin_safe check (channel <> 'linkedin' or capture_method in ('official_api', 'manual')),
  constraint campaign_executions_manual_safe check (channel <> 'manual' or capture_method = 'manual'),
  constraint campaign_executions_metadata_no_pii check (not (metadata ?| array[
    'email','email_address','name','first_name','last_name','phone','mobile','company',
    'company_name','job_title','message','answers','contact','address','ip','ip_address'
  ]))
);

create unique index if not exists campaign_executions_idempotency_idx
  on public.campaign_executions (campaign_id, idempotency_key);
create index if not exists campaign_executions_calendar_idx
  on public.campaign_executions (campaign_id, scheduled_for, channel, status);
create index if not exists campaign_executions_contact_time_idx
  on public.campaign_executions (campaign_contact_id, created_at desc);

drop trigger if exists campaign_executions_touch_updated_at on public.campaign_executions;
create trigger campaign_executions_touch_updated_at before update on public.campaign_executions
for each row execute function public.touch_updated_at();

alter table public.campaign_events
  add column if not exists execution_id uuid references public.campaign_executions(id) on delete set null,
  add column if not exists channel text,
  add column if not exists capture_method text,
  add column if not exists metric_quality text not null default 'confirmed';

create index if not exists campaign_events_execution_idx on public.campaign_events (execution_id)
where execution_id is not null;

create or replace function public.record_campaign_tracking_event(
  p_campaign_external_id text, p_contact_id text, p_source_event_id text,
  p_execution_key text, p_event_name text, p_channel text, p_capture_method text,
  p_occurred_at timestamptz, p_scheduled_for timestamptz, p_step integer,
  p_context jsonb, p_properties jsonb, p_metric_quality text, p_execution_status text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_event_id uuid;
  v_execution_id uuid;
  v_existing_contact_id uuid;
  v_existing_event_name text;
  v_existing_execution_key text;
  v_duplicate boolean := false;
begin
  if p_event_name <> all(array[
    'delivery_scheduled','delivery_sent','delivery_delivered','delivery_failed','email_opened','link_clicked',
    'reply_received','bounce_hard','unsubscribe','tool_started','tool_completed',
    'pdf_downloaded','transactional_delivery_sent','transactional_delivery_failed',
    'meeting_booked','meeting_completed','opportunity_created'
  ]) then raise exception 'Unsupported canonical campaign event'; end if;
  if p_source_event_id is null or p_source_event_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' then raise exception 'Invalid source event id'; end if;
  if p_execution_key is null or p_execution_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' then raise exception 'Invalid execution key'; end if;
  if p_occurred_at is null then raise exception 'occurred_at is required'; end if;
  if p_channel not in ('email','linkedin','manual') then raise exception 'Invalid channel'; end if;
  if p_capture_method not in ('automation','provider_webhook','official_api','manual') then raise exception 'Invalid capture method'; end if;
  if p_channel = 'linkedin' and p_capture_method not in ('official_api','manual') then raise exception 'LinkedIn capture must be manual or official_api'; end if;
  if p_channel = 'manual' and p_capture_method <> 'manual' then raise exception 'Manual channel requires manual capture'; end if;
  if p_event_name = 'email_opened' and (p_channel <> 'email' or p_metric_quality <> 'directional') then raise exception 'Email opens must be directional'; end if;
  if p_execution_status not in ('planned','executed','failed','stopped') then raise exception 'Invalid execution status'; end if;
  if jsonb_typeof(coalesce(p_context, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_properties, '{}'::jsonb)) <> 'object' then raise exception 'Metadata must be JSON objects'; end if;

  select * into v_campaign from public.campaigns where external_id = p_campaign_external_id;
  if not found then raise exception 'Unknown campaign'; end if;
  select * into v_contact from public.campaign_contacts
    where campaign_id = v_campaign.id and external_contact_id = p_contact_id for update;
  if not found then raise exception 'Unknown campaign contact'; end if;

  select ce.id, ce.execution_id, ce.campaign_contact_id, ce.event_name, ex.idempotency_key
    into v_event_id, v_execution_id, v_existing_contact_id, v_existing_event_name, v_existing_execution_key
    from public.campaign_events ce
    left join public.campaign_executions ex on ex.id = ce.execution_id
    where ce.campaign_id = v_campaign.id and ce.source_event_id = p_source_event_id limit 1;
  if found then
    if v_existing_contact_id <> v_contact.id or v_existing_event_name <> p_event_name then raise exception 'source_event_id collision'; end if;
    if v_existing_execution_key <> p_execution_key then raise exception 'source_event_id execution collision'; end if;
    v_duplicate := true;
  else
    if p_event_name = 'delivery_scheduled' and (
      not v_campaign.is_active or v_campaign.status not in ('active','running','pilot') or
      v_contact.suppression_scope <> 'none' or v_contact.marketing_lane = 'none' or
      (v_contact.marketing_lane = 'cold' and v_contact.cold_sequence_status not in ('pending','active')) or
      (v_contact.marketing_lane = 'intent' and v_contact.intent_sequence_status not in ('pending','active'))
    ) then raise exception 'Campaign stop gate rejected outbound action'; end if;

    insert into public.campaign_executions (
      campaign_id,campaign_contact_id,idempotency_key,channel,capture_method,action_name,step,
      status,scheduled_for,planned_at,actual_at,failed_at,stopped_at,failure_code,stop_reason,metadata
    ) values (
      v_campaign.id,v_contact.id,p_execution_key,p_channel,p_capture_method,p_event_name,p_step,
      p_execution_status,p_scheduled_for,
      case when p_execution_status='planned' then p_occurred_at end,
      case when p_execution_status='executed' then p_occurred_at end,
      case when p_execution_status='failed' then p_occurred_at end,
      case when p_execution_status='stopped' then p_occurred_at end,
      case when p_execution_status='failed' then p_properties->>'reason_code' end,
      case when p_execution_status='stopped' then p_event_name end,
      coalesce(p_context,'{}'::jsonb) || coalesce(p_properties,'{}'::jsonb) || jsonb_build_object('event_name',p_event_name,'metric_quality',p_metric_quality)
    ) on conflict (campaign_id,idempotency_key) do update set
      action_name=excluded.action_name,
      status=case
        when campaign_executions.status='stopped' or excluded.status='stopped' then 'stopped'
        when campaign_executions.status='executed' or excluded.status='executed' then 'executed'
        when campaign_executions.status='failed' or excluded.status='failed' then 'failed'
        else excluded.status end,
      scheduled_for=coalesce(campaign_executions.scheduled_for,excluded.scheduled_for),
      planned_at=coalesce(campaign_executions.planned_at,excluded.planned_at),
      actual_at=coalesce(campaign_executions.actual_at,excluded.actual_at),
      failed_at=coalesce(campaign_executions.failed_at,excluded.failed_at),
      stopped_at=coalesce(campaign_executions.stopped_at,excluded.stopped_at),
      failure_code=coalesce(campaign_executions.failure_code,excluded.failure_code),
      stop_reason=coalesce(campaign_executions.stop_reason,excluded.stop_reason),
      metadata=campaign_executions.metadata || excluded.metadata
      where campaign_executions.campaign_contact_id=excluded.campaign_contact_id
    returning id into v_execution_id;
    if v_execution_id is null then raise exception 'Execution key belongs to another contact'; end if;

    insert into public.campaign_events (
      campaign_id,campaign_contact_id,execution_id,source_event_id,event_name,occurred_at,
      channel,capture_method,metric_quality,context,properties
    ) values (
      v_campaign.id,v_contact.id,v_execution_id,p_source_event_id,p_event_name,p_occurred_at,
      p_channel,p_capture_method,p_metric_quality,coalesce(p_context,'{}'::jsonb),coalesce(p_properties,'{}'::jsonb)
    ) returning id into v_event_id;
  end if;

  -- Reconciliation is intentionally reapplied on retries after a partial caller failure.
  update public.campaign_contacts set
    last_event_at = greatest(coalesce(last_event_at,p_occurred_at),p_occurred_at),
    resource_started_at = case when p_event_name='tool_started' then coalesce(resource_started_at,p_occurred_at) else resource_started_at end,
    resource_completed_at = case when p_event_name in ('tool_completed','pdf_downloaded') then coalesce(resource_completed_at,p_occurred_at) else resource_completed_at end,
    meeting_booked_at = case when p_event_name='meeting_booked' then coalesce(meeting_booked_at,p_occurred_at) else meeting_booked_at end,
    meeting_completed_at = case when p_event_name='meeting_completed' then coalesce(meeting_completed_at,p_occurred_at) else meeting_completed_at end,
    opportunity_created_at = case when p_event_name='opportunity_created' then coalesce(opportunity_created_at,p_occurred_at) else opportunity_created_at end,
    cold_sequence_status = case when p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then 'stopped' else cold_sequence_status end,
    intent_sequence_status = case when p_event_name in ('bounce_hard','unsubscribe','meeting_booked','meeting_completed','opportunity_created') then 'stopped' else intent_sequence_status end,
    marketing_lane = case when p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then 'none' else marketing_lane end,
    suppression_scope = case when p_event_name='unsubscribe' then 'all' when p_event_name in ('bounce_hard','meeting_booked','meeting_completed','opportunity_created') then 'marketing' else suppression_scope end,
    sequence_status = case when p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then 'stopped' else sequence_status end,
    next_delivery_status = case when p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then 'stopped' else next_delivery_status end,
    transactional_status = case when p_event_name in ('tool_completed','pdf_downloaded') then 'pending' when p_event_name='transactional_delivery_sent' then 'sent' when p_event_name='transactional_delivery_failed' then 'retrying' else transactional_status end,
    stopped_at = case when p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then coalesce(stopped_at,p_occurred_at) else stopped_at end,
    stopped_reason = case when p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then coalesce(stopped_reason,p_event_name) else stopped_reason end
  where id=v_contact.id;

  if p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then
    update public.campaign_executions set status='stopped',stopped_at=coalesce(stopped_at,p_occurred_at),stop_reason=coalesce(stop_reason,p_event_name)
    where campaign_contact_id=v_contact.id and status='planned';
  end if;

  return jsonb_build_object('event_id',v_event_id,'execution_id',v_execution_id,'duplicate',v_duplicate);
end;
$$;

alter table public.campaign_executions enable row level security;
revoke all privileges on table public.campaign_executions from anon, authenticated;
revoke execute on function public.record_campaign_tracking_event(text,text,text,text,text,text,text,timestamptz,timestamptz,integer,jsonb,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.record_campaign_tracking_event(text,text,text,text,text,text,text,timestamptz,timestamptz,integer,jsonb,jsonb,text,text) to service_role;

commit;

-- Opaque, revocable unsubscribe links and identity-wide campaign suppression.
-- Additive; apply manually after 20260811_tracking_control.sql and a backup.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

do $$
begin
  if to_regclass('public.campaign_executions') is null or
     not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'campaign_events' and column_name = 'execution_id') then
    raise exception 'Tracking control migration must be applied before unsubscribe flow';
  end if;
end;
$$;

create table if not exists public.campaign_suppressions (
  identity_hash text primary key,
  scope text not null default 'all' check (scope = 'all'),
  reason text not null default 'unsubscribe' check (reason = 'unsubscribe'),
  occurred_at timestamptz not null,
  source_event_id text,
  source_campaign_id uuid references public.campaigns(id) on delete set null,
  source_contact_id uuid references public.campaign_contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_suppressions_hash_format check (identity_hash ~ '^[A-Za-z0-9_:-]{16,160}$')
);

create table if not exists public.campaign_unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  campaign_contact_id uuid not null references public.campaign_contacts(id) on delete cascade,
  token_hash text not null,
  token_version integer not null default 1 check (token_version between 1 and 100000),
  expires_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_unsubscribe_tokens_hash_format check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint campaign_unsubscribe_tokens_contact_version_key unique (campaign_contact_id, token_version),
  constraint campaign_unsubscribe_tokens_hash_key unique (token_hash)
);

-- Preserve unsubscribe decisions recorded before this global registry existed.
insert into public.campaign_suppressions (
  identity_hash, scope, reason, occurred_at, source_event_id, source_campaign_id, source_contact_id
)
select distinct on (history.email_hash)
  history.email_hash, 'all', 'unsubscribe', history.occurred_at,
  coalesce(history.source_event_id, 'backfill:' || substring(history.email_hash from 1 for 48)),
  history.campaign_id, history.campaign_contact_id
from (
  select cc.email_hash, cc.campaign_id, cc.id as campaign_contact_id,
    min(coalesce(cc.suppressed_at, cc.stopped_at, cc.last_event_at, cc.created_at, now())) as occurred_at,
    null::text as source_event_id
  from public.campaign_contacts cc
  where suppression_scope = 'all' or suppression_reason = 'unsubscribe'
  group by cc.email_hash, cc.campaign_id, cc.id
  union all
  select cc.email_hash, ce.campaign_id, ce.campaign_contact_id,
    ce.occurred_at, ce.source_event_id
  from public.campaign_events ce
  join public.campaign_contacts cc on cc.id = ce.campaign_contact_id
  where ce.event_name = 'unsubscribe'
) history
order by history.email_hash, history.occurred_at asc
on conflict (identity_hash) do nothing;

create index if not exists campaign_unsubscribe_tokens_active_idx
  on public.campaign_unsubscribe_tokens (token_hash)
  where revoked_at is null;

drop trigger if exists campaign_unsubscribe_tokens_touch_updated_at on public.campaign_unsubscribe_tokens;
create trigger campaign_unsubscribe_tokens_touch_updated_at
before update on public.campaign_unsubscribe_tokens
for each row execute function public.touch_updated_at();

alter table public.campaign_executions
  drop constraint if exists campaign_executions_capture_method_check;
alter table public.campaign_executions
  add constraint campaign_executions_capture_method_check
  check (capture_method in ('automation', 'provider_webhook', 'official_api', 'manual', 'self_service'));

create or replace function public.enforce_campaign_execution_stop_gate()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_contact public.campaign_contacts%rowtype;
  v_campaign_status text;
  v_campaign_active boolean;
begin
  if new.status <> 'planned' then return new; end if;

  select *
  into v_contact
  from public.campaign_contacts
  where id = new.campaign_contact_id
  for update;

  if not found then
    raise exception 'Campaign contact does not exist';
  end if;

  select status, is_active
  into v_campaign_status, v_campaign_active
  from public.campaigns
  where id = v_contact.campaign_id;

  if not found or not v_campaign_active or v_campaign_status not in ('active', 'running', 'pilot') or
     v_contact.suppression_scope <> 'none' or v_contact.marketing_lane = 'none' or
     exists (select 1 from public.campaign_suppressions s where s.identity_hash = v_contact.email_hash) or
     (v_contact.marketing_lane = 'cold' and v_contact.cold_sequence_status not in ('pending', 'active')) or
     (v_contact.marketing_lane = 'intent' and v_contact.intent_sequence_status not in ('pending', 'active')) then
    raise exception 'Campaign stop gate rejected planned execution';
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_executions_enforce_stop_gate on public.campaign_executions;
create trigger campaign_executions_enforce_stop_gate
before insert or update of status, campaign_contact_id
on public.campaign_executions
for each row execute function public.enforce_campaign_execution_stop_gate();

create or replace function public.apply_campaign_global_suppression(
  p_identity_hash text,
  p_occurred_at timestamptz,
  p_source_event_id text default null,
  p_source_campaign_id uuid default null,
  p_source_contact_id uuid default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_identity_hash is null or p_identity_hash !~ '^[A-Za-z0-9_:-]{16,160}$' then
    raise exception 'Invalid identity hash';
  end if;
  if p_occurred_at is null then raise exception 'occurred_at is required'; end if;

  insert into public.campaign_suppressions (
    identity_hash, scope, reason, occurred_at, source_event_id, source_campaign_id, source_contact_id
  ) values (
    p_identity_hash, 'all', 'unsubscribe', p_occurred_at,
    p_source_event_id, p_source_campaign_id, p_source_contact_id
  ) on conflict (identity_hash) do update set
    scope = 'all',
    reason = 'unsubscribe',
    occurred_at = least(campaign_suppressions.occurred_at, excluded.occurred_at),
    source_event_id = coalesce(campaign_suppressions.source_event_id, excluded.source_event_id),
    source_campaign_id = coalesce(campaign_suppressions.source_campaign_id, excluded.source_campaign_id),
    source_contact_id = coalesce(campaign_suppressions.source_contact_id, excluded.source_contact_id),
    updated_at = now();

  -- Lock and suppress every campaign row for the same identity in this transaction.
  perform 1 from public.campaign_contacts where email_hash = p_identity_hash for update;

  update public.campaign_contacts set
    cold_sequence_status = 'stopped',
    intent_sequence_status = 'stopped',
    marketing_lane = 'none',
    suppression_scope = 'all',
    sequence_status = 'stopped',
    next_delivery_status = 'stopped',
    next_scheduled_at = null,
    locked_at = null,
    lock_token = null,
    lock_expires_at = null,
    stopped_at = coalesce(stopped_at, p_occurred_at),
    stopped_reason = coalesce(stopped_reason, 'unsubscribe'),
    suppressed_at = coalesce(suppressed_at, p_occurred_at),
    suppression_reason = coalesce(suppression_reason, 'unsubscribe'),
    last_event_at = greatest(coalesce(last_event_at, p_occurred_at), p_occurred_at)
  where email_hash = p_identity_hash;

  update public.campaign_executions set
    status = 'stopped',
    stopped_at = coalesce(stopped_at, p_occurred_at),
    stop_reason = coalesce(stop_reason, 'unsubscribe')
  where status = 'planned'
    and campaign_contact_id in (
      select id from public.campaign_contacts where email_hash = p_identity_hash
    );
end;
$$;

-- Propagate every historical unsubscribe to all matching campaign rows and
-- stop existing planned executions before the enforcement triggers go live.
do $$
declare
  v_suppression public.campaign_suppressions%rowtype;
begin
  for v_suppression in select * from public.campaign_suppressions loop
    perform public.apply_campaign_global_suppression(
      v_suppression.identity_hash, v_suppression.occurred_at, v_suppression.source_event_id,
      v_suppression.source_campaign_id, v_suppression.source_contact_id
    );
  end loop;
end;

$$;
create or replace function public.enforce_campaign_suppression_on_contact()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_suppression public.campaign_suppressions%rowtype;
begin
  select * into v_suppression
  from public.campaign_suppressions
  where identity_hash = new.email_hash and scope = 'all';

  if found then
    new.cold_sequence_status := 'stopped';
    new.intent_sequence_status := 'stopped';
    new.marketing_lane := 'none';
    new.suppression_scope := 'all';
    new.sequence_status := 'stopped';
    new.next_delivery_status := 'stopped';
    new.next_scheduled_at := null;
    new.locked_at := null;
    new.lock_token := null;
    new.lock_expires_at := null;
    new.stopped_at := coalesce(new.stopped_at, v_suppression.occurred_at);
    new.stopped_reason := coalesce(new.stopped_reason, 'unsubscribe');
    new.suppressed_at := coalesce(new.suppressed_at, v_suppression.occurred_at);
    new.suppression_reason := coalesce(new.suppression_reason, 'unsubscribe');
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_contacts_enforce_suppression on public.campaign_contacts;
create trigger campaign_contacts_enforce_suppression
before insert or update of email_hash, suppression_scope, sequence_status, next_delivery_status,
  marketing_lane, cold_sequence_status, intent_sequence_status, next_scheduled_at,
  locked_at, lock_token, lock_expires_at
on public.campaign_contacts
for each row execute function public.enforce_campaign_suppression_on_contact();

create or replace function public.propagate_campaign_unsubscribe_event()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_identity_hash text;
begin
  if new.event_name <> 'unsubscribe' then return new; end if;
  select email_hash into v_identity_hash
  from public.campaign_contacts
  where id = new.campaign_contact_id;
  if not found then return new; end if;

  perform public.apply_campaign_global_suppression(
    v_identity_hash, new.occurred_at, new.source_event_id, new.campaign_id, new.campaign_contact_id
  );
  return new;
end;
$$;

drop trigger if exists campaign_events_propagate_unsubscribe on public.campaign_events;
create trigger campaign_events_propagate_unsubscribe
after insert on public.campaign_events
for each row when (new.event_name = 'unsubscribe')
execute function public.propagate_campaign_unsubscribe_event();

create or replace function public.issue_campaign_unsubscribe_token(
  p_campaign_external_id text,
  p_contact_id text,
  p_token_hash text,
  p_token_version integer,
  p_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign_id uuid;
  v_contact_id uuid;
  v_token_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token hash'; end if;
  if p_token_version is null or p_token_version not between 1 and 100000 then raise exception 'Invalid token version'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'Invalid token expiry'; end if;

  select id into v_campaign_id from public.campaigns where external_id = p_campaign_external_id;
  if not found then raise exception 'Unknown campaign'; end if;
  select id into v_contact_id from public.campaign_contacts
    where campaign_id = v_campaign_id and external_contact_id = p_contact_id;
  if not found then raise exception 'Unknown campaign contact'; end if;

  insert into public.campaign_unsubscribe_tokens (
    campaign_id, campaign_contact_id, token_hash, token_version, expires_at
  ) values (
    v_campaign_id, v_contact_id, p_token_hash, p_token_version, p_expires_at
  ) on conflict (campaign_contact_id, token_version) do update set
    expires_at = excluded.expires_at,
    updated_at = now()
  where campaign_unsubscribe_tokens.revoked_at is null
    and campaign_unsubscribe_tokens.token_hash = excluded.token_hash
  returning id into v_token_id;

  return jsonb_build_object('issued', v_token_id is not null);
end;
$$;

create or replace function public.consume_campaign_unsubscribe_token(
  p_token_hash text,
  p_occurred_at timestamptz,
  p_source_event_id text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_token public.campaign_unsubscribe_tokens%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_execution_id uuid;
  v_event_id uuid;
  v_duplicate boolean := false;
  v_execution_key text;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('accepted', false, 'duplicate', false);
  end if;
  if p_source_event_id is null or p_source_event_id !~ '^unsubscribe:[a-f0-9]{48}$' then
    return jsonb_build_object('accepted', false, 'duplicate', false);
  end if;
  if p_occurred_at is null then raise exception 'occurred_at is required'; end if;

  select * into v_token
  from public.campaign_unsubscribe_tokens
  where token_hash = p_token_hash
  for update;
  if not found or v_token.revoked_at is not null or (v_token.expires_at is not null and v_token.expires_at < p_occurred_at) then
    return jsonb_build_object('accepted', false, 'duplicate', false);
  end if;

  select * into v_contact from public.campaign_contacts where id = v_token.campaign_contact_id for update;
  if not found then return jsonb_build_object('accepted', false, 'duplicate', false); end if;
  v_execution_key := 'unsubscribe:' || substring(p_token_hash from 1 for 48);

  insert into public.campaign_executions (
    campaign_id, campaign_contact_id, idempotency_key, channel, capture_method,
    action_name, status, stopped_at, stop_reason, metadata
  ) values (
    v_token.campaign_id, v_token.campaign_contact_id, v_execution_key, 'email', 'self_service',
    'unsubscribe', 'stopped', p_occurred_at, 'unsubscribe',
    jsonb_build_object('event_name', 'unsubscribe', 'metric_quality', 'confirmed', 'source', 'public_unsubscribe')
  ) on conflict (campaign_id, idempotency_key) do update set
    status = 'stopped',
    stopped_at = coalesce(campaign_executions.stopped_at, excluded.stopped_at),
    stop_reason = coalesce(campaign_executions.stop_reason, excluded.stop_reason)
  returning id into v_execution_id;

  insert into public.campaign_events (
    campaign_id, campaign_contact_id, execution_id, source_event_id, event_name,
    occurred_at, channel, capture_method, metric_quality, context, properties
  ) values (
    v_token.campaign_id, v_token.campaign_contact_id, v_execution_id, p_source_event_id,
    'unsubscribe', p_occurred_at, 'email', 'self_service', 'confirmed',
    jsonb_build_object('source', 'public_unsubscribe'), '{}'::jsonb
  ) on conflict (campaign_id, source_event_id) where source_event_id is not null do nothing
  returning id into v_event_id;

  if v_event_id is null then
    v_duplicate := true;
    select id into v_event_id from public.campaign_events
    where campaign_id = v_token.campaign_id and source_event_id = p_source_event_id;
  end if;

  -- Reapply the invariant for idempotent retries and contacts imported later in the transaction.
  perform public.apply_campaign_global_suppression(
    v_contact.email_hash, p_occurred_at, p_source_event_id, v_token.campaign_id, v_token.campaign_contact_id
  );
  update public.campaign_unsubscribe_tokens
  set used_at = coalesce(used_at, p_occurred_at)
  where id = v_token.id;

  return jsonb_build_object('accepted', true, 'duplicate', v_duplicate);
end;
$$;

create or replace function public.authorize_campaign_delivery(
  p_campaign_external_id text,
  p_contact_id text,
  p_execution_key text,
  p_authorized_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_lock_expires_at timestamptz;
begin
  if p_campaign_external_id is null or p_campaign_external_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_contact_id is null or p_contact_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_execution_key is null or p_execution_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_request');
  end if;
  if p_authorized_at is null or abs(extract(epoch from (now() - p_authorized_at))) > 300 then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_timestamp');
  end if;

  select * into v_campaign from public.campaigns where external_id = p_campaign_external_id;
  if not found or not v_campaign.is_active or v_campaign.status not in ('active', 'running', 'pilot') then
    return jsonb_build_object('authorized', false, 'reason_code', 'campaign_inactive');
  end if;

  select * into v_contact from public.campaign_contacts
  where campaign_id = v_campaign.id and external_contact_id = p_contact_id
  for update;
  if not found then
    return jsonb_build_object('authorized', false, 'reason_code', 'contact_unavailable');
  end if;

  if exists (select 1 from public.campaign_suppressions where identity_hash = v_contact.email_hash) or
     v_contact.suppression_scope <> 'none' or v_contact.marketing_lane = 'none' or
     (v_contact.marketing_lane = 'cold' and v_contact.cold_sequence_status not in ('pending', 'active')) or
     (v_contact.marketing_lane = 'intent' and v_contact.intent_sequence_status not in ('pending', 'active')) then
    return jsonb_build_object('authorized', false, 'reason_code', 'suppressed');
  end if;

  select * into v_execution from public.campaign_executions
  where campaign_id = v_campaign.id
    and campaign_contact_id = v_contact.id
    and idempotency_key = p_execution_key
  for update;
  if not found or v_execution.status <> 'planned' or v_execution.channel <> 'email' or
     v_execution.action_name <> 'delivery_scheduled' then
    return jsonb_build_object('authorized', false, 'reason_code', 'execution_unavailable');
  end if;

  if v_contact.lock_expires_at is not null and v_contact.lock_expires_at > p_authorized_at and
     v_contact.lock_token is distinct from p_execution_key then
    return jsonb_build_object('authorized', false, 'reason_code', 'execution_locked');
  end if;

  v_lock_expires_at := p_authorized_at + interval '120 seconds';
  update public.campaign_contacts set
    locked_at = p_authorized_at,
    lock_token = p_execution_key,
    lock_expires_at = v_lock_expires_at
  where id = v_contact.id;

  return jsonb_build_object(
    'authorized', true,
    'reason_code', 'authorized',
    'lock_expires_at', v_lock_expires_at
  );
end;
$$;

alter table public.campaign_suppressions enable row level security;
alter table public.campaign_unsubscribe_tokens enable row level security;
revoke all privileges on table public.campaign_suppressions from anon, authenticated;
revoke all privileges on table public.campaign_unsubscribe_tokens from anon, authenticated;

revoke execute on function public.apply_campaign_global_suppression(text,timestamptz,text,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.issue_campaign_unsubscribe_token(text,text,text,integer,timestamptz) from public, anon, authenticated;
revoke execute on function public.consume_campaign_unsubscribe_token(text,timestamptz,text) from public, anon, authenticated;
revoke execute on function public.authorize_campaign_delivery(text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.issue_campaign_unsubscribe_token(text,text,text,integer,timestamptz) to service_role;
grant execute on function public.consume_campaign_unsubscribe_token(text,timestamptz,text) to service_role;
grant execute on function public.authorize_campaign_delivery(text,text,text,timestamptz) to service_role;

commit;


begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create table if not exists public.rate_limit_buckets (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  request_count integer not null check (request_count > 0),
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (expires_at > window_started_at)
);

create index if not exists rate_limit_buckets_expires_at_idx
  on public.rate_limit_buckets (expires_at);

create or replace function public.consume_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_expires_at timestamptz;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' or
     p_limit is null or p_limit < 1 or p_limit > 100000 or
     p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 or
     p_now is null then
    raise exception 'Invalid rate limit input';
  end if;

  insert into public.rate_limit_buckets as bucket (
    key_hash, request_count, window_started_at, expires_at, updated_at
  ) values (
    p_key_hash, 1, p_now, p_now + make_interval(secs => p_window_seconds), p_now
  )
  on conflict (key_hash) do update set
    request_count = case
      when bucket.expires_at <= p_now then 1
      else bucket.request_count + 1
    end,
    window_started_at = case
      when bucket.expires_at <= p_now then p_now
      else bucket.window_started_at
    end,
    expires_at = case
      when bucket.expires_at <= p_now then p_now + make_interval(secs => p_window_seconds)
      else bucket.expires_at
    end,
    updated_at = p_now
  returning request_count, expires_at into v_count, v_expires_at;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'retry_after_seconds', case
      when v_count <= p_limit then 0
      else greatest(1, ceil(extract(epoch from (v_expires_at - p_now))))::integer
    end
  );
end;
$$;

create or replace function public.cleanup_expired_rate_limits(
  p_before timestamptz default now() - interval '1 day',
  p_batch_size integer default 5000
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_before is null or p_batch_size is null or p_batch_size < 1 or p_batch_size > 50000 then
    raise exception 'Invalid cleanup input';
  end if;

  with expired as (
    select ctid
    from public.rate_limit_buckets
    where expires_at < p_before
    order by expires_at
    limit p_batch_size
    for update skip locked
  )
  delete from public.rate_limit_buckets bucket
  using expired
  where bucket.ctid = expired.ctid;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

alter table public.rate_limit_buckets enable row level security;
revoke all privileges on table public.rate_limit_buckets from public, anon, authenticated;
revoke execute on function public.consume_rate_limit(text,integer,integer,timestamptz) from public, anon, authenticated;
revoke execute on function public.cleanup_expired_rate_limits(timestamptz,integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer,timestamptz) to service_role;
grant execute on function public.cleanup_expired_rate_limits(timestamptz,integer) to service_role;

commit;

-- Transactional intake replay lock and shared physical-mailbox throttle.
-- Stores only hashes and non-PII claims. Does not activate Make or Outlook.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.leads drop constraint if exists leads_email_delivery_status_check;
alter table public.leads add constraint leads_email_delivery_status_check
  check (email_delivery_status in ('pending', 'email_sent', 'email_failed', 'reconcile_required')) not valid;
alter table public.leads validate constraint leads_email_delivery_status_check;

alter table public.transactional_email_events
  drop constraint if exists transactional_email_events_event_name_check;
alter table public.transactional_email_events
  add constraint transactional_email_events_event_name_check
  check (event_name in ('email_sent', 'email_failed', 'reconcile_required')) not valid;
alter table public.transactional_email_events
  validate constraint transactional_email_events_event_name_check;

create table if not exists public.transactional_intake_claims (
  submission_id text primary key
    check (submission_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$'),
  resource text not null
    check (resource in ('calculator', 'interactive_checklist', 'checklist', 'webinar')),
  payload_sha256 text not null
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  intake_capability_hash text not null unique
    check (intake_capability_hash ~ '^[a-f0-9]{64}$'),
  pilot_recipient_allowed boolean not null default false,
  claimed_at timestamptz not null default now(),
  capability_expires_at timestamptz not null,
  capability_consumed_at timestamptz,
  check (capability_expires_at > claimed_at)
);

create index if not exists transactional_intake_claims_expiry_idx
  on public.transactional_intake_claims (capability_expires_at)
  where capability_consumed_at is null;

create table if not exists public.mailbox_throttle_state (
  mailbox_key_hash text primary key
    check (mailbox_key_hash ~ '^[a-f0-9]{64}$'),
  active_reservation_id uuid,
  blocked_reservation_id uuid,
  batch_id uuid not null default gen_random_uuid(),
  batch_reservations_count smallint not null default 0
    check (batch_reservations_count between 0 and 2),
  next_allowed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mailbox_delivery_reservations (
  id uuid primary key default gen_random_uuid(),
  mailbox_key_hash text not null references public.mailbox_throttle_state(mailbox_key_hash),
  message_key_hash text not null check (message_key_hash ~ '^[a-f0-9]{64}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  submission_id text not null references public.transactional_intake_claims(submission_id),
  resource text not null check (resource in ('calculator', 'interactive_checklist', 'checklist', 'webinar')),
  lane text not null check (lane in ('transactional', 'cold')),
  batch_id uuid not null,
  batch_position smallint not null check (batch_position in (1, 2)),
  status text not null check (status in ('reserved', 'sent', 'failed', 'reconcile_required')),
  finalize_capability_hash text not null unique
    check (finalize_capability_hash ~ '^[a-f0-9]{64}$'),
  reserved_at timestamptz not null,
  lease_expires_at timestamptz not null,
  finalized_at timestamptz,
  provider_message_hash text check (provider_message_hash is null or provider_message_hash ~ '^[a-f0-9]{64}$'),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z0-9_:-]{2,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mailbox_delivery_message_unique unique (mailbox_key_hash, message_key_hash),
  constraint mailbox_delivery_mailbox_id_unique unique (mailbox_key_hash, id),
  check (lease_expires_at > reserved_at),
  check ((status = 'reserved' and finalized_at is null) or (status <> 'reserved' and finalized_at is not null)),
  constraint mailbox_delivery_terminal_fields_check check (
    (status = 'reserved' and provider_message_hash is null and failure_code is null) or
    (status = 'sent' and provider_message_hash is not null and failure_code is null) or
    (
      status = 'failed' and provider_message_hash is null
      and failure_code ~ '^DEFINITIVE_[A-Z0-9_:-]{2,53}$'
      and failure_code !~ '(TIMEOUT|429|AMBIGUOUS|UNKNOWN|RATE_LIMIT|LEASE_EXPIRED)'
    ) or
    (status = 'reconcile_required' and provider_message_hash is null and failure_code is not null)
  )
);

alter table public.mailbox_throttle_state
  add constraint mailbox_state_active_reservation_fk
  foreign key (mailbox_key_hash, active_reservation_id)
  references public.mailbox_delivery_reservations (mailbox_key_hash, id);
alter table public.mailbox_throttle_state
  add constraint mailbox_state_blocked_reservation_fk
  foreign key (mailbox_key_hash, blocked_reservation_id)
  references public.mailbox_delivery_reservations (mailbox_key_hash, id);

create unique index if not exists mailbox_one_active_reservation_idx
  on public.mailbox_delivery_reservations (mailbox_key_hash)
  where status = 'reserved';

create index if not exists mailbox_reservations_status_lease_idx
  on public.mailbox_delivery_reservations (status, lease_expires_at);

create or replace function public.claim_transactional_intake(
  p_submission_id text,
  p_resource text,
  p_payload_sha256 text,
  p_intake_capability_hash text,
  p_pilot_recipient_allowed boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.transactional_intake_claims%rowtype;
  v_claimed_at timestamptz := clock_timestamp();
begin
  if p_submission_id is null or p_submission_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_resource is null or p_resource not in ('calculator', 'interactive_checklist', 'checklist', 'webinar') or
     p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' or
     p_intake_capability_hash is null or p_intake_capability_hash !~ '^[a-f0-9]{64}$' or
     p_pilot_recipient_allowed is null then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_request');
  end if;

  perform 1
    from public.leads
    where submission_id = p_submission_id
      and form_type = p_resource
      and lead_magnet = p_resource
      and payload #>> '{consent,privacy_accepted}' = 'true'
    for update;
  if not found then
    return jsonb_build_object('authorized', false, 'reason_code', 'lead_unavailable');
  end if;

  insert into public.transactional_intake_claims (
    submission_id,
    resource,
    payload_sha256,
    intake_capability_hash,
    pilot_recipient_allowed,
    claimed_at,
    capability_expires_at
  ) values (
    p_submission_id,
    p_resource,
    p_payload_sha256,
    p_intake_capability_hash,
    p_pilot_recipient_allowed,
    v_claimed_at,
    v_claimed_at + interval '15 minutes'
  ) on conflict (submission_id) do nothing
  returning * into v_existing;

  if not found then
    select * into v_existing
    from public.transactional_intake_claims
    where submission_id = p_submission_id;
    return jsonb_build_object(
      'authorized', false,
      'reason_code', 'replay_blocked',
      'claimed_at', v_existing.claimed_at
    );
  end if;

  return jsonb_build_object(
    'authorized', true,
    'reason_code', 'claimed',
    'claimed_at', v_claimed_at
  );
end;
$$;

create or replace function public.reserve_transactional_mailbox_delivery(
  p_mailbox_key_hash text,
  p_intake_capability_hash text,
  p_finalize_capability_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.mailbox_throttle_state%rowtype;
  v_claim public.transactional_intake_claims%rowtype;
  v_active public.mailbox_delivery_reservations%rowtype;
  v_existing public.mailbox_delivery_reservations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_message_key_hash text;
  v_position smallint;
begin
  if p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$' or
     p_intake_capability_hash is null or p_intake_capability_hash !~ '^[a-f0-9]{64}$' or
     p_finalize_capability_hash is null or p_finalize_capability_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_request');
  end if;

  insert into public.mailbox_throttle_state (mailbox_key_hash, next_allowed_at)
  values (p_mailbox_key_hash, v_now)
  on conflict (mailbox_key_hash) do nothing;

  select * into v_state
  from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash
  for update;

  if v_state.blocked_reservation_id is not null then
    return jsonb_build_object(
      'authorized', false,
      'reason_code', 'reconcile_required',
      'next_allowed_at', v_state.next_allowed_at,
      'retry_after_seconds', 0
    );
  end if;

  select * into v_claim
  from public.transactional_intake_claims
  where intake_capability_hash = p_intake_capability_hash
  for update;

  if not found then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_capability');
  end if;
  if v_claim.capability_consumed_at is not null then
    return jsonb_build_object('authorized', false, 'reason_code', 'replay_blocked');
  end if;
  if v_claim.capability_expires_at <= v_now then
    update public.transactional_intake_claims
    set capability_consumed_at = v_now
    where submission_id = v_claim.submission_id;
    return jsonb_build_object('authorized', false, 'reason_code', 'capability_expired');
  end if;
  if not v_claim.pilot_recipient_allowed then
    return jsonb_build_object('authorized', false, 'reason_code', 'recipient_not_allowed');
  end if;

  if v_state.active_reservation_id is not null then
    select * into v_active
    from public.mailbox_delivery_reservations
    where id = v_state.active_reservation_id
    for update;

    if not found or v_active.status <> 'reserved' then
      return jsonb_build_object('authorized', false, 'reason_code', 'mailbox_state_invalid');
    end if;
    if v_active.lease_expires_at <= v_now then
      update public.mailbox_delivery_reservations
      set status = 'reconcile_required',
          finalized_at = v_now,
          failure_code = 'LEASE_EXPIRED',
          updated_at = v_now
      where id = v_active.id;
      update public.mailbox_throttle_state
      set active_reservation_id = null,
          blocked_reservation_id = v_active.id,
          next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
          updated_at = v_now
      where mailbox_key_hash = p_mailbox_key_hash;
      return jsonb_build_object('authorized', false, 'reason_code', 'lease_expired_reconcile_required');
    end if;
    return jsonb_build_object(
      'authorized', false,
      'reason_code', 'lease_active',
      'lease_expires_at', v_active.lease_expires_at,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_active.lease_expires_at - v_now))))::integer
    );
  end if;

  if v_state.next_allowed_at > v_now then
    return jsonb_build_object(
      'authorized', false,
      'reason_code', 'cooldown',
      'next_allowed_at', v_state.next_allowed_at,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_state.next_allowed_at - v_now))))::integer
    );
  end if;

  v_message_key_hash := encode(extensions.digest('transactional:' || v_claim.submission_id, 'sha256'), 'hex');
  select * into v_existing
  from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash
    and message_key_hash = v_message_key_hash
  for update;
  if found then
    update public.transactional_intake_claims
    set capability_consumed_at = coalesce(capability_consumed_at, v_now)
    where submission_id = v_claim.submission_id;
    return jsonb_build_object('authorized', false, 'reason_code', 'replay_blocked');
  end if;

  v_position := v_state.batch_reservations_count + 1;
  if v_position not in (1, 2) then
    return jsonb_build_object('authorized', false, 'reason_code', 'mailbox_state_invalid');
  end if;

  insert into public.mailbox_delivery_reservations (
    mailbox_key_hash,
    message_key_hash,
    payload_sha256,
    submission_id,
    resource,
    lane,
    batch_id,
    batch_position,
    status,
    finalize_capability_hash,
    reserved_at,
    lease_expires_at
  ) values (
    p_mailbox_key_hash,
    v_message_key_hash,
    v_claim.payload_sha256,
    v_claim.submission_id,
    v_claim.resource,
    'transactional',
    v_state.batch_id,
    v_position,
    'reserved',
    p_finalize_capability_hash,
    v_now,
    v_now + interval '90 seconds'
  ) returning * into v_reservation;

  update public.transactional_intake_claims
  set capability_consumed_at = v_now
  where submission_id = v_claim.submission_id;

  update public.mailbox_throttle_state
  set active_reservation_id = v_reservation.id,
      batch_reservations_count = v_position,
      next_allowed_at = case
        when v_position = 1 then greatest(next_allowed_at, v_now + interval '60 seconds')
        else next_allowed_at
      end,
      updated_at = v_now
  where mailbox_key_hash = p_mailbox_key_hash
  returning * into v_state;

  return jsonb_build_object(
    'authorized', true,
    'reason_code', 'reserved',
    'reservation_id', v_reservation.id,
    'lease_expires_at', v_reservation.lease_expires_at,
    'next_allowed_at', v_state.next_allowed_at,
    'batch_position', v_position,
    'retry_after_seconds', 0
  );
end;
$$;

create or replace function public.resolve_transactional_intake_capability(
  p_intake_capability_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.transactional_intake_claims%rowtype;
begin
  if p_intake_capability_hash is null or p_intake_capability_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('valid', false, 'reason_code', 'invalid_capability');
  end if;

  select * into v_claim
  from public.transactional_intake_claims
  where intake_capability_hash = p_intake_capability_hash;

  if not found or v_claim.capability_consumed_at is not null or v_claim.capability_expires_at <= clock_timestamp() then
    return jsonb_build_object('valid', false, 'reason_code', 'capability_unavailable');
  end if;

  return jsonb_build_object(
    'valid', true,
    'reason_code', 'valid',
    'submission_id', v_claim.submission_id,
    'resource', v_claim.resource,
    'payload_sha256', v_claim.payload_sha256
  );
end;
$$;

create or replace function public.finalize_transactional_mailbox_delivery(
  p_mailbox_key_hash text,
  p_finalize_capability_hash text,
  p_state text,
  p_provider_message_hash text,
  p_failure_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.mailbox_throttle_state%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_lead_id text;
  v_event_name text;
  v_source_event_id text;
begin
  if p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$' or
     p_finalize_capability_hash is null or p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_state is null or p_state not in ('sent', 'failed', 'reconcile_required') or
     (p_provider_message_hash is not null and p_provider_message_hash !~ '^[a-f0-9]{64}$') or
     (p_failure_code is not null and p_failure_code !~ '^[A-Z0-9_:-]{2,64}$') or
     (p_state = 'sent' and (p_provider_message_hash is null or p_failure_code is not null)) or
     (p_state <> 'sent' and (p_failure_code is null or p_provider_message_hash is not null)) then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'invalid_request');
  end if;

  select * into v_state
  from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'mailbox_unavailable');
  end if;

  select * into v_reservation
  from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash
    and finalize_capability_hash = p_finalize_capability_hash
    and lane = 'transactional'
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'invalid_capability');
  end if;

  if v_reservation.status <> 'reserved' then
    if v_reservation.status = p_state and
       v_reservation.provider_message_hash is not distinct from p_provider_message_hash and
       v_reservation.failure_code is not distinct from p_failure_code then
      return jsonb_build_object(
        'accepted', true,
        'duplicate', true,
        'reason_code', 'duplicate',
        'reservation_id', v_reservation.id,
        'next_allowed_at', v_state.next_allowed_at,
        'mailbox_halted', v_state.blocked_reservation_id is not null
      );
    end if;
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'callback_conflict');
  end if;

  if v_state.active_reservation_id is distinct from v_reservation.id then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'mailbox_state_invalid');
  end if;

  update public.mailbox_delivery_reservations
  set status = p_state,
      finalized_at = v_now,
      provider_message_hash = p_provider_message_hash,
      failure_code = p_failure_code,
      updated_at = v_now
  where id = v_reservation.id;

  if p_state = 'reconcile_required' then
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        blocked_reservation_id = v_reservation.id,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  elsif v_reservation.batch_position = 2 then
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        batch_id = gen_random_uuid(),
        batch_reservations_count = 0,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  else
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  end if;

  select lead_id into strict v_lead_id
  from public.leads
  where submission_id = v_reservation.submission_id
  for update;

  v_event_name := case p_state
    when 'sent' then 'email_sent'
    when 'failed' then 'email_failed'
    else 'reconcile_required'
  end;
  v_source_event_id := 'mailbox:' || v_reservation.id::text || ':' || p_state;

  insert into public.transactional_email_events (
    submission_id,
    lead_id,
    event_name,
    source_event_id,
    occurred_at,
    provider_message_hash,
    failure_code
  ) values (
    v_reservation.submission_id,
    v_lead_id,
    v_event_name,
    v_source_event_id,
    v_now,
    p_provider_message_hash,
    p_failure_code
  );

  update public.leads
  set email_delivery_status = v_event_name,
      email_delivery_updated_at = v_now
  where submission_id = v_reservation.submission_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'reason_code', p_state,
    'reservation_id', v_reservation.id,
    'next_allowed_at', v_state.next_allowed_at,
    'mailbox_halted', v_state.blocked_reservation_id is not null
  );
end;
$$;

create or replace function public.record_transactional_lease_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id text;
begin
  if new.lane <> 'transactional' or new.failure_code <> 'LEASE_EXPIRED' then
    return new;
  end if;

  select lead_id into strict v_lead_id
  from public.leads
  where submission_id = new.submission_id
  for update;

  insert into public.transactional_email_events (
    submission_id, lead_id, event_name, source_event_id, occurred_at, failure_code
  ) values (
    new.submission_id, v_lead_id, 'reconcile_required',
    'mailbox:' || new.id::text || ':reconcile_required',
    coalesce(new.finalized_at, clock_timestamp()), 'LEASE_EXPIRED'
  ) on conflict (source_event_id) do nothing;

  update public.leads
  set email_delivery_status = 'reconcile_required',
      email_delivery_updated_at = coalesce(new.finalized_at, clock_timestamp())
  where submission_id = new.submission_id;

  return new;
end;
$$;

drop trigger if exists mailbox_transactional_lease_expiry on public.mailbox_delivery_reservations;
create trigger mailbox_transactional_lease_expiry
after update of status on public.mailbox_delivery_reservations
for each row
when (
  old.status = 'reserved' and
  new.status = 'reconcile_required' and
  new.failure_code = 'LEASE_EXPIRED'
)
execute function public.record_transactional_lease_expiry();

alter table public.transactional_intake_claims enable row level security;
alter table public.mailbox_throttle_state enable row level security;
alter table public.mailbox_delivery_reservations enable row level security;

revoke all privileges on table public.transactional_intake_claims from public, anon, authenticated;
revoke all privileges on table public.mailbox_throttle_state from public, anon, authenticated;
revoke all privileges on table public.mailbox_delivery_reservations from public, anon, authenticated;

revoke execute on function public.claim_transactional_intake(text,text,text,text,boolean) from public, anon, authenticated;
revoke execute on function public.resolve_transactional_intake_capability(text) from public, anon, authenticated;
revoke execute on function public.reserve_transactional_mailbox_delivery(text,text,text) from public, anon, authenticated;
revoke execute on function public.finalize_transactional_mailbox_delivery(text,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.record_transactional_lease_expiry() from public, anon, authenticated;

grant select, insert, update on table public.transactional_intake_claims to service_role;
grant select, insert, update on table public.mailbox_throttle_state to service_role;
grant select, insert, update on table public.mailbox_delivery_reservations to service_role;
grant execute on function public.claim_transactional_intake(text,text,text,text,boolean) to service_role;
grant execute on function public.resolve_transactional_intake_capability(text) to service_role;
grant execute on function public.reserve_transactional_mailbox_delivery(text,text,text) to service_role;
grant execute on function public.finalize_transactional_mailbox_delivery(text,text,text,text,text) to service_role;

commit;

-- Share the physical-mailbox lock with a server-only cold lane.
-- This migration creates no HTTP endpoint and does not activate cold delivery.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.mailbox_delivery_reservations
  alter column submission_id drop not null,
  alter column resource drop not null;

alter table public.mailbox_delivery_reservations
  drop constraint if exists mailbox_delivery_lane_claim_check;
alter table public.mailbox_delivery_reservations
  add constraint mailbox_delivery_lane_claim_check check (
    (lane = 'transactional' and submission_id is not null and resource is not null) or
    (lane = 'cold' and submission_id is null and resource is null)
  ) not valid;
alter table public.mailbox_delivery_reservations
  validate constraint mailbox_delivery_lane_claim_check;

create or replace function public.reserve_cold_mailbox_delivery(
  p_mailbox_key_hash text,
  p_message_key_hash text,
  p_payload_sha256 text,
  p_finalize_capability_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.mailbox_throttle_state%rowtype;
  v_active public.mailbox_delivery_reservations%rowtype;
  v_existing public.mailbox_delivery_reservations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_position smallint;
begin
  if p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$'
     or p_message_key_hash is null or p_message_key_hash !~ '^[a-f0-9]{64}$'
     or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$'
     or p_finalize_capability_hash is null or p_finalize_capability_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_request');
  end if;

  insert into public.mailbox_throttle_state (mailbox_key_hash, next_allowed_at)
  values (p_mailbox_key_hash, v_now)
  on conflict (mailbox_key_hash) do nothing;

  select * into v_state
  from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash
  for update;

  if v_state.blocked_reservation_id is not null then
    return jsonb_build_object('authorized', false, 'reason_code', 'reconcile_required', 'retry_after_seconds', 0);
  end if;

  select * into v_existing
  from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash and message_key_hash = p_message_key_hash
  for update;
  if found then
    return jsonb_build_object('authorized', false, 'reason_code', 'replay_blocked');
  end if;

  if v_state.active_reservation_id is not null then
    select * into v_active
    from public.mailbox_delivery_reservations
    where id = v_state.active_reservation_id
    for update;
    if not found or v_active.status <> 'reserved' then
      return jsonb_build_object('authorized', false, 'reason_code', 'mailbox_state_invalid');
    end if;
    if v_active.lease_expires_at <= v_now then
      update public.mailbox_delivery_reservations
      set status = 'reconcile_required', finalized_at = v_now,
          failure_code = 'LEASE_EXPIRED', updated_at = v_now
      where id = v_active.id;
      update public.mailbox_throttle_state
      set active_reservation_id = null, blocked_reservation_id = v_active.id,
          next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
          updated_at = v_now
      where mailbox_key_hash = p_mailbox_key_hash;
      return jsonb_build_object('authorized', false, 'reason_code', 'lease_expired_reconcile_required');
    end if;
    return jsonb_build_object(
      'authorized', false, 'reason_code', 'lease_active',
      'lease_expires_at', v_active.lease_expires_at,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_active.lease_expires_at - v_now))))::integer
    );
  end if;

  if v_state.next_allowed_at > v_now then
    return jsonb_build_object(
      'authorized', false, 'reason_code', 'cooldown',
      'next_allowed_at', v_state.next_allowed_at,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_state.next_allowed_at - v_now))))::integer
    );
  end if;

  v_position := v_state.batch_reservations_count + 1;
  if v_position not in (1, 2) then
    return jsonb_build_object('authorized', false, 'reason_code', 'mailbox_state_invalid');
  end if;

  insert into public.mailbox_delivery_reservations (
    mailbox_key_hash, message_key_hash, payload_sha256, submission_id, resource,
    lane, batch_id, batch_position, status, finalize_capability_hash,
    reserved_at, lease_expires_at
  ) values (
    p_mailbox_key_hash, p_message_key_hash, p_payload_sha256, null, null,
    'cold', v_state.batch_id, v_position, 'reserved', p_finalize_capability_hash,
    v_now, v_now + interval '90 seconds'
  ) returning * into v_reservation;

  update public.mailbox_throttle_state
  set active_reservation_id = v_reservation.id,
      batch_reservations_count = v_position,
      next_allowed_at = case when v_position = 1
        then greatest(next_allowed_at, v_now + interval '60 seconds')
        else next_allowed_at end,
      updated_at = v_now
  where mailbox_key_hash = p_mailbox_key_hash
  returning * into v_state;

  return jsonb_build_object(
    'authorized', true, 'reason_code', 'reserved',
    'reservation_id', v_reservation.id,
    'lease_expires_at', v_reservation.lease_expires_at,
    'next_allowed_at', v_state.next_allowed_at,
    'batch_position', v_position, 'retry_after_seconds', 0
  );
end;
$$;

create or replace function public.finalize_cold_mailbox_delivery(
  p_mailbox_key_hash text,
  p_finalize_capability_hash text,
  p_state text,
  p_provider_message_hash text,
  p_failure_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.mailbox_throttle_state%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
begin
  if p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$'
     or p_finalize_capability_hash is null or p_finalize_capability_hash !~ '^[a-f0-9]{64}$'
     or p_state is null or p_state not in ('sent', 'failed', 'reconcile_required')
     or (p_provider_message_hash is not null and p_provider_message_hash !~ '^[a-f0-9]{64}$')
     or (p_failure_code is not null and p_failure_code !~ '^[A-Z0-9_:-]{2,64}$')
     or (p_state = 'sent' and (p_provider_message_hash is null or p_failure_code is not null))
     or (p_state <> 'sent' and (p_failure_code is null or p_provider_message_hash is not null)) then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'invalid_request');
  end if;

  select * into v_state
  from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'mailbox_unavailable');
  end if;

  select * into v_reservation
  from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash
    and finalize_capability_hash = p_finalize_capability_hash
    and lane = 'cold'
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'invalid_capability');
  end if;

  if v_reservation.status <> 'reserved' then
    if v_reservation.status = p_state
       and v_reservation.provider_message_hash is not distinct from p_provider_message_hash
       and v_reservation.failure_code is not distinct from p_failure_code then
      return jsonb_build_object(
        'accepted', true, 'duplicate', true, 'reason_code', 'duplicate',
        'reservation_id', v_reservation.id,
        'next_allowed_at', v_state.next_allowed_at,
        'mailbox_halted', v_state.blocked_reservation_id is not null
      );
    end if;
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'callback_conflict');
  end if;

  if v_state.active_reservation_id is distinct from v_reservation.id then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'mailbox_state_invalid');
  end if;

  update public.mailbox_delivery_reservations
  set status = p_state, finalized_at = v_now,
      provider_message_hash = p_provider_message_hash,
      failure_code = p_failure_code, updated_at = v_now
  where id = v_reservation.id;

  if p_state = 'reconcile_required' then
    update public.mailbox_throttle_state
    set active_reservation_id = null, blocked_reservation_id = v_reservation.id,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  elsif v_reservation.batch_position = 2 then
    update public.mailbox_throttle_state
    set active_reservation_id = null, batch_id = gen_random_uuid(),
        batch_reservations_count = 0,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  else
    update public.mailbox_throttle_state
    set active_reservation_id = null, updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  end if;

  return jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', p_state,
    'reservation_id', v_reservation.id,
    'next_allowed_at', v_state.next_allowed_at,
    'mailbox_halted', v_state.blocked_reservation_id is not null
  );
end;
$$;

revoke execute on function public.reserve_cold_mailbox_delivery(text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.finalize_cold_mailbox_delivery(text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.reserve_cold_mailbox_delivery(text,text,text,text)
  to service_role;
grant execute on function public.finalize_cold_mailbox_delivery(text,text,text,text,text)
  to service_role;

commit;


-- Production hotfix for the already-created function: pgcrypto is installed
-- in Supabase's non-writable extensions schema.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter function public.reserve_transactional_mailbox_delivery(text,text,text)
  set search_path = pg_catalog, extensions;

revoke execute on function public.reserve_transactional_mailbox_delivery(text,text,text)
  from public, anon, authenticated;
grant execute on function public.reserve_transactional_mailbox_delivery(text,text,text)
  to service_role;

commit;

-- Enforce pilot quota and terminal-state safety in the database authority.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mailbox_delivery_reservations'::regclass
      and conname = 'mailbox_delivery_mailbox_id_unique'
  ) then
    alter table public.mailbox_delivery_reservations
      add constraint mailbox_delivery_mailbox_id_unique unique (mailbox_key_hash, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mailbox_throttle_state'::regclass
      and conname = 'mailbox_state_active_reservation_fk'
  ) then
    alter table public.mailbox_throttle_state
      add constraint mailbox_state_active_reservation_fk
      foreign key (mailbox_key_hash, active_reservation_id)
      references public.mailbox_delivery_reservations (mailbox_key_hash, id)
      not valid;
    alter table public.mailbox_throttle_state
      validate constraint mailbox_state_active_reservation_fk;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mailbox_throttle_state'::regclass
      and conname = 'mailbox_state_blocked_reservation_fk'
  ) then
    alter table public.mailbox_throttle_state
      add constraint mailbox_state_blocked_reservation_fk
      foreign key (mailbox_key_hash, blocked_reservation_id)
      references public.mailbox_delivery_reservations (mailbox_key_hash, id)
      not valid;
    alter table public.mailbox_throttle_state
      validate constraint mailbox_state_blocked_reservation_fk;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mailbox_delivery_reservations'::regclass
      and conname = 'mailbox_delivery_terminal_fields_check'
  ) then
    alter table public.mailbox_delivery_reservations
      add constraint mailbox_delivery_terminal_fields_check check (
        (status = 'reserved' and provider_message_hash is null and failure_code is null) or
        (status = 'sent' and provider_message_hash is not null and failure_code is null) or
        (
          status = 'failed' and provider_message_hash is null
          and failure_code ~ '^DEFINITIVE_[A-Z0-9_:-]{2,53}$'
          and failure_code !~ '(TIMEOUT|429|AMBIGUOUS|UNKNOWN|RATE_LIMIT|LEASE_EXPIRED)'
        ) or
        (status = 'reconcile_required' and provider_message_hash is null and failure_code is not null)
      ) not valid;
    alter table public.mailbox_delivery_reservations
      validate constraint mailbox_delivery_terminal_fields_check;
  end if;
end
$$;

create unique index if not exists mailbox_transactional_pilot_resource_unique
  on public.mailbox_delivery_reservations (mailbox_key_hash, resource)
  where lane = 'transactional';

create or replace function public.enforce_transactional_pilot_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lane <> 'transactional' then
    return new;
  end if;

  perform 1
  from public.mailbox_throttle_state
  where mailbox_key_hash = new.mailbox_key_hash
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'mailbox_state_unavailable';
  end if;

  if exists (
    select 1
    from public.mailbox_delivery_reservations
    where mailbox_key_hash = new.mailbox_key_hash
      and lane = 'transactional'
      and resource = new.resource
  ) then
    raise exception using errcode = '23514', message = 'pilot_resource_quota_reached';
  end if;

  if (
    select count(*)
    from public.mailbox_delivery_reservations
    where mailbox_key_hash = new.mailbox_key_hash
      and lane = 'transactional'
  ) >= 4 then
    raise exception using errcode = '23514', message = 'pilot_mailbox_quota_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists mailbox_transactional_pilot_quota on public.mailbox_delivery_reservations;
create trigger mailbox_transactional_pilot_quota
before insert on public.mailbox_delivery_reservations
for each row
execute function public.enforce_transactional_pilot_reservation();

create or replace function public.enforce_mailbox_terminal_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'reserved'
     and old.lease_expires_at <= clock_timestamp()
     and new.status in ('sent', 'failed') then
    raise exception using errcode = '23514', message = 'lease_expired_requires_reconcile';
  end if;
  return new;
end;
$$;

drop trigger if exists mailbox_terminal_transition on public.mailbox_delivery_reservations;
create trigger mailbox_terminal_transition
before update of status on public.mailbox_delivery_reservations
for each row
execute function public.enforce_mailbox_terminal_transition();

create or replace function public.record_transactional_lease_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id text;
begin
  if new.lane <> 'transactional' or new.failure_code <> 'LEASE_EXPIRED' then
    return new;
  end if;

  select lead_id into strict v_lead_id
  from public.leads
  where submission_id = new.submission_id
  for update;

  insert into public.transactional_email_events (
    submission_id, lead_id, event_name, source_event_id, occurred_at, failure_code
  ) values (
    new.submission_id, v_lead_id, 'reconcile_required',
    'mailbox:' || new.id::text || ':reconcile_required',
    coalesce(new.finalized_at, clock_timestamp()), 'LEASE_EXPIRED'
  ) on conflict (source_event_id) do nothing;

  update public.leads
  set email_delivery_status = 'reconcile_required',
      email_delivery_updated_at = coalesce(new.finalized_at, clock_timestamp())
  where submission_id = new.submission_id;

  return new;
end;
$$;

drop trigger if exists mailbox_transactional_lease_expiry on public.mailbox_delivery_reservations;
create trigger mailbox_transactional_lease_expiry
after update of status on public.mailbox_delivery_reservations
for each row
when (
  old.status = 'reserved' and
  new.status = 'reconcile_required' and
  new.failure_code = 'LEASE_EXPIRED'
)
execute function public.record_transactional_lease_expiry();

create or replace function public.claim_transactional_intake(
  p_submission_id text,
  p_resource text,
  p_payload_sha256 text,
  p_intake_capability_hash text,
  p_pilot_recipient_allowed boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.transactional_intake_claims%rowtype;
  v_claimed_at timestamptz := clock_timestamp();
begin
  if p_submission_id is null or p_submission_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_resource is null or p_resource not in ('calculator', 'interactive_checklist', 'checklist', 'webinar') or
     p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' or
     p_intake_capability_hash is null or p_intake_capability_hash !~ '^[a-f0-9]{64}$' or
     p_pilot_recipient_allowed is null then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_request');
  end if;

  perform 1
  from public.leads
  where submission_id = p_submission_id
    and form_type = p_resource
    and lead_magnet = p_resource
    and payload #>> '{consent,privacy_accepted}' = 'true'
  for update;
  if not found then
    return jsonb_build_object('authorized', false, 'reason_code', 'lead_unavailable');
  end if;

  insert into public.transactional_intake_claims (
    submission_id, resource, payload_sha256, intake_capability_hash,
    pilot_recipient_allowed, claimed_at, capability_expires_at
  ) values (
    p_submission_id, p_resource, p_payload_sha256, p_intake_capability_hash,
    p_pilot_recipient_allowed, v_claimed_at, v_claimed_at + interval '15 minutes'
  ) on conflict (submission_id) do nothing
  returning * into v_existing;

  if not found then
    select * into v_existing
    from public.transactional_intake_claims
    where submission_id = p_submission_id;
    return jsonb_build_object(
      'authorized', false, 'reason_code', 'replay_blocked',
      'claimed_at', v_existing.claimed_at
    );
  end if;

  return jsonb_build_object(
    'authorized', true, 'reason_code', 'claimed',
    'claimed_at', v_claimed_at
  );
end;
$$;

revoke execute on function public.enforce_transactional_pilot_reservation() from public, anon, authenticated;
revoke execute on function public.enforce_mailbox_terminal_transition() from public, anon, authenticated;
revoke execute on function public.record_transactional_lease_expiry() from public, anon, authenticated;
revoke execute on function public.claim_transactional_intake(text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.claim_transactional_intake(text,text,text,text,boolean) to service_role;

commit;

-- Anchor mailbox leases and cooldowns after acquiring the authoritative row lock.
-- A timestamp captured before SELECT ... FOR UPDATE can become stale while waiting
-- and shorten the required 60/120 second windows.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create or replace function public.reserve_transactional_mailbox_delivery(
  p_mailbox_key_hash text,
  p_intake_capability_hash text,
  p_finalize_capability_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.mailbox_throttle_state%rowtype;
  v_claim public.transactional_intake_claims%rowtype;
  v_active public.mailbox_delivery_reservations%rowtype;
  v_existing public.mailbox_delivery_reservations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_message_key_hash text;
  v_position smallint;
begin
  if p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$' or
     p_intake_capability_hash is null or p_intake_capability_hash !~ '^[a-f0-9]{64}$' or
     p_finalize_capability_hash is null or p_finalize_capability_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_request');
  end if;

  insert into public.mailbox_throttle_state (mailbox_key_hash, next_allowed_at)
  values (p_mailbox_key_hash, v_now)
  on conflict (mailbox_key_hash) do nothing;

  select * into v_state
  from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash
  for update;
  v_now := clock_timestamp();

  if v_state.blocked_reservation_id is not null then
    return jsonb_build_object(
      'authorized', false,
      'reason_code', 'reconcile_required',
      'next_allowed_at', v_state.next_allowed_at,
      'retry_after_seconds', 0
    );
  end if;

  select * into v_claim
  from public.transactional_intake_claims
  where intake_capability_hash = p_intake_capability_hash
  for update;
  v_now := clock_timestamp();

  if not found then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_capability');
  end if;
  if v_claim.capability_consumed_at is not null then
    return jsonb_build_object('authorized', false, 'reason_code', 'replay_blocked');
  end if;
  if v_claim.capability_expires_at <= v_now then
    update public.transactional_intake_claims
    set capability_consumed_at = v_now
    where submission_id = v_claim.submission_id;
    return jsonb_build_object('authorized', false, 'reason_code', 'capability_expired');
  end if;
  if not v_claim.pilot_recipient_allowed then
    return jsonb_build_object('authorized', false, 'reason_code', 'recipient_not_allowed');
  end if;

  if v_state.active_reservation_id is not null then
    select * into v_active
    from public.mailbox_delivery_reservations
    where id = v_state.active_reservation_id
    for update;
    v_now := clock_timestamp();

    if not found or v_active.status <> 'reserved' then
      return jsonb_build_object('authorized', false, 'reason_code', 'mailbox_state_invalid');
    end if;
    if v_active.lease_expires_at <= v_now then
      update public.mailbox_delivery_reservations
      set status = 'reconcile_required',
          finalized_at = v_now,
          failure_code = 'LEASE_EXPIRED',
          updated_at = v_now
      where id = v_active.id;
      update public.mailbox_throttle_state
      set active_reservation_id = null,
          blocked_reservation_id = v_active.id,
          next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
          updated_at = v_now
      where mailbox_key_hash = p_mailbox_key_hash;
      return jsonb_build_object('authorized', false, 'reason_code', 'lease_expired_reconcile_required');
    end if;
    return jsonb_build_object(
      'authorized', false,
      'reason_code', 'lease_active',
      'lease_expires_at', v_active.lease_expires_at,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_active.lease_expires_at - v_now))))::integer
    );
  end if;

  if v_state.next_allowed_at > v_now then
    return jsonb_build_object(
      'authorized', false,
      'reason_code', 'cooldown',
      'next_allowed_at', v_state.next_allowed_at,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_state.next_allowed_at - v_now))))::integer
    );
  end if;

  v_message_key_hash := encode(extensions.digest('transactional:' || v_claim.submission_id, 'sha256'), 'hex');
  select * into v_existing
  from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash
    and message_key_hash = v_message_key_hash
  for update;
  v_now := clock_timestamp();
  if found then
    update public.transactional_intake_claims
    set capability_consumed_at = coalesce(capability_consumed_at, v_now)
    where submission_id = v_claim.submission_id;
    return jsonb_build_object('authorized', false, 'reason_code', 'replay_blocked');
  end if;

  v_position := v_state.batch_reservations_count + 1;
  if v_position not in (1, 2) then
    return jsonb_build_object('authorized', false, 'reason_code', 'mailbox_state_invalid');
  end if;

  insert into public.mailbox_delivery_reservations (
    mailbox_key_hash,
    message_key_hash,
    payload_sha256,
    submission_id,
    resource,
    lane,
    batch_id,
    batch_position,
    status,
    finalize_capability_hash,
    reserved_at,
    lease_expires_at
  ) values (
    p_mailbox_key_hash,
    v_message_key_hash,
    v_claim.payload_sha256,
    v_claim.submission_id,
    v_claim.resource,
    'transactional',
    v_state.batch_id,
    v_position,
    'reserved',
    p_finalize_capability_hash,
    v_now,
    v_now + interval '90 seconds'
  ) returning * into v_reservation;

  update public.transactional_intake_claims
  set capability_consumed_at = v_now
  where submission_id = v_claim.submission_id;

  update public.mailbox_throttle_state
  set active_reservation_id = v_reservation.id,
      batch_reservations_count = v_position,
      next_allowed_at = case
        when v_position = 1 then greatest(next_allowed_at, v_now + interval '60 seconds')
        else next_allowed_at
      end,
      updated_at = v_now
  where mailbox_key_hash = p_mailbox_key_hash
  returning * into v_state;

  return jsonb_build_object(
    'authorized', true,
    'reason_code', 'reserved',
    'reservation_id', v_reservation.id,
    'lease_expires_at', v_reservation.lease_expires_at,
    'next_allowed_at', v_state.next_allowed_at,
    'batch_position', v_position,
    'retry_after_seconds', 0
  );
end;
$$;

create or replace function public.finalize_transactional_mailbox_delivery(
  p_mailbox_key_hash text,
  p_finalize_capability_hash text,
  p_state text,
  p_provider_message_hash text,
  p_failure_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.mailbox_throttle_state%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_lead_id text;
  v_event_name text;
  v_source_event_id text;
begin
  if p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$' or
     p_finalize_capability_hash is null or p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_state is null or p_state not in ('sent', 'failed', 'reconcile_required') or
     (p_provider_message_hash is not null and p_provider_message_hash !~ '^[a-f0-9]{64}$') or
     (p_failure_code is not null and p_failure_code !~ '^[A-Z0-9_:-]{2,64}$') or
     (p_state = 'sent' and (p_provider_message_hash is null or p_failure_code is not null)) or
     (p_state <> 'sent' and (p_failure_code is null or p_provider_message_hash is not null)) then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'invalid_request');
  end if;

  select * into v_state
  from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'mailbox_unavailable');
  end if;

  select * into v_reservation
  from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash
    and finalize_capability_hash = p_finalize_capability_hash
    and lane = 'transactional'
  for update;
  v_now := clock_timestamp();
  if not found then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'invalid_capability');
  end if;

  if v_reservation.status <> 'reserved' then
    if v_reservation.status = p_state and
       v_reservation.provider_message_hash is not distinct from p_provider_message_hash and
       v_reservation.failure_code is not distinct from p_failure_code then
      return jsonb_build_object(
        'accepted', true,
        'duplicate', true,
        'reason_code', 'duplicate',
        'reservation_id', v_reservation.id,
        'next_allowed_at', v_state.next_allowed_at,
        'mailbox_halted', v_state.blocked_reservation_id is not null
      );
    end if;
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'callback_conflict');
  end if;

  if v_state.active_reservation_id is distinct from v_reservation.id then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'mailbox_state_invalid');
  end if;

  update public.mailbox_delivery_reservations
  set status = p_state,
      finalized_at = v_now,
      provider_message_hash = p_provider_message_hash,
      failure_code = p_failure_code,
      updated_at = v_now
  where id = v_reservation.id;

  if p_state = 'reconcile_required' then
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        blocked_reservation_id = v_reservation.id,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  elsif v_reservation.batch_position = 2 then
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        batch_id = gen_random_uuid(),
        batch_reservations_count = 0,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  else
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  end if;

  select lead_id into strict v_lead_id
  from public.leads
  where submission_id = v_reservation.submission_id
  for update;

  v_event_name := case p_state
    when 'sent' then 'email_sent'
    when 'failed' then 'email_failed'
    else 'reconcile_required'
  end;
  v_source_event_id := 'mailbox:' || v_reservation.id::text || ':' || p_state;

  insert into public.transactional_email_events (
    submission_id,
    lead_id,
    event_name,
    source_event_id,
    occurred_at,
    provider_message_hash,
    failure_code
  ) values (
    v_reservation.submission_id,
    v_lead_id,
    v_event_name,
    v_source_event_id,
    v_now,
    p_provider_message_hash,
    p_failure_code
  );

  update public.leads
  set email_delivery_status = v_event_name,
      email_delivery_updated_at = v_now
  where submission_id = v_reservation.submission_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'reason_code', p_state,
    'reservation_id', v_reservation.id,
    'next_allowed_at', v_state.next_allowed_at,
    'mailbox_halted', v_state.blocked_reservation_id is not null
  );
end;
$$;

create or replace function public.reserve_cold_mailbox_delivery(
  p_mailbox_key_hash text,
  p_message_key_hash text,
  p_payload_sha256 text,
  p_finalize_capability_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.mailbox_throttle_state%rowtype;
  v_active public.mailbox_delivery_reservations%rowtype;
  v_existing public.mailbox_delivery_reservations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_position smallint;
begin
  if p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$'
     or p_message_key_hash is null or p_message_key_hash !~ '^[a-f0-9]{64}$'
     or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$'
     or p_finalize_capability_hash is null or p_finalize_capability_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_request');
  end if;

  insert into public.mailbox_throttle_state (mailbox_key_hash, next_allowed_at)
  values (p_mailbox_key_hash, v_now)
  on conflict (mailbox_key_hash) do nothing;

  select * into v_state
  from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash
  for update;
  v_now := clock_timestamp();

  if v_state.blocked_reservation_id is not null then
    return jsonb_build_object('authorized', false, 'reason_code', 'reconcile_required', 'retry_after_seconds', 0);
  end if;

  select * into v_existing
  from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash and message_key_hash = p_message_key_hash
  for update;
  v_now := clock_timestamp();
  if found then
    return jsonb_build_object('authorized', false, 'reason_code', 'replay_blocked');
  end if;

  if v_state.active_reservation_id is not null then
    select * into v_active
    from public.mailbox_delivery_reservations
    where id = v_state.active_reservation_id
    for update;
    v_now := clock_timestamp();
    if not found or v_active.status <> 'reserved' then
      return jsonb_build_object('authorized', false, 'reason_code', 'mailbox_state_invalid');
    end if;
    if v_active.lease_expires_at <= v_now then
      update public.mailbox_delivery_reservations
      set status = 'reconcile_required', finalized_at = v_now,
          failure_code = 'LEASE_EXPIRED', updated_at = v_now
      where id = v_active.id;
      update public.mailbox_throttle_state
      set active_reservation_id = null, blocked_reservation_id = v_active.id,
          next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
          updated_at = v_now
      where mailbox_key_hash = p_mailbox_key_hash;
      return jsonb_build_object('authorized', false, 'reason_code', 'lease_expired_reconcile_required');
    end if;
    return jsonb_build_object(
      'authorized', false, 'reason_code', 'lease_active',
      'lease_expires_at', v_active.lease_expires_at,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_active.lease_expires_at - v_now))))::integer
    );
  end if;

  if v_state.next_allowed_at > v_now then
    return jsonb_build_object(
      'authorized', false, 'reason_code', 'cooldown',
      'next_allowed_at', v_state.next_allowed_at,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_state.next_allowed_at - v_now))))::integer
    );
  end if;

  v_position := v_state.batch_reservations_count + 1;
  if v_position not in (1, 2) then
    return jsonb_build_object('authorized', false, 'reason_code', 'mailbox_state_invalid');
  end if;

  insert into public.mailbox_delivery_reservations (
    mailbox_key_hash, message_key_hash, payload_sha256, submission_id, resource,
    lane, batch_id, batch_position, status, finalize_capability_hash,
    reserved_at, lease_expires_at
  ) values (
    p_mailbox_key_hash, p_message_key_hash, p_payload_sha256, null, null,
    'cold', v_state.batch_id, v_position, 'reserved', p_finalize_capability_hash,
    v_now, v_now + interval '90 seconds'
  ) returning * into v_reservation;

  update public.mailbox_throttle_state
  set active_reservation_id = v_reservation.id,
      batch_reservations_count = v_position,
      next_allowed_at = case when v_position = 1
        then greatest(next_allowed_at, v_now + interval '60 seconds')
        else next_allowed_at end,
      updated_at = v_now
  where mailbox_key_hash = p_mailbox_key_hash
  returning * into v_state;

  return jsonb_build_object(
    'authorized', true, 'reason_code', 'reserved',
    'reservation_id', v_reservation.id,
    'lease_expires_at', v_reservation.lease_expires_at,
    'next_allowed_at', v_state.next_allowed_at,
    'batch_position', v_position, 'retry_after_seconds', 0
  );
end;
$$;

create or replace function public.finalize_cold_mailbox_delivery(
  p_mailbox_key_hash text,
  p_finalize_capability_hash text,
  p_state text,
  p_provider_message_hash text,
  p_failure_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.mailbox_throttle_state%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
begin
  if p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$'
     or p_finalize_capability_hash is null or p_finalize_capability_hash !~ '^[a-f0-9]{64}$'
     or p_state is null or p_state not in ('sent', 'failed', 'reconcile_required')
     or (p_provider_message_hash is not null and p_provider_message_hash !~ '^[a-f0-9]{64}$')
     or (p_failure_code is not null and p_failure_code !~ '^[A-Z0-9_:-]{2,64}$')
     or (p_state = 'sent' and (p_provider_message_hash is null or p_failure_code is not null))
     or (p_state <> 'sent' and (p_failure_code is null or p_provider_message_hash is not null)) then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'invalid_request');
  end if;

  select * into v_state
  from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'mailbox_unavailable');
  end if;

  select * into v_reservation
  from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash
    and finalize_capability_hash = p_finalize_capability_hash
    and lane = 'cold'
  for update;
  v_now := clock_timestamp();
  if not found then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'invalid_capability');
  end if;

  if v_reservation.status <> 'reserved' then
    if v_reservation.status = p_state
       and v_reservation.provider_message_hash is not distinct from p_provider_message_hash
       and v_reservation.failure_code is not distinct from p_failure_code then
      return jsonb_build_object(
        'accepted', true, 'duplicate', true, 'reason_code', 'duplicate',
        'reservation_id', v_reservation.id,
        'next_allowed_at', v_state.next_allowed_at,
        'mailbox_halted', v_state.blocked_reservation_id is not null
      );
    end if;
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'callback_conflict');
  end if;

  if v_state.active_reservation_id is distinct from v_reservation.id then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'mailbox_state_invalid');
  end if;

  update public.mailbox_delivery_reservations
  set status = p_state, finalized_at = v_now,
      provider_message_hash = p_provider_message_hash,
      failure_code = p_failure_code, updated_at = v_now
  where id = v_reservation.id;

  if p_state = 'reconcile_required' then
    update public.mailbox_throttle_state
    set active_reservation_id = null, blocked_reservation_id = v_reservation.id,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  elsif v_reservation.batch_position = 2 then
    update public.mailbox_throttle_state
    set active_reservation_id = null, batch_id = gen_random_uuid(),
        batch_reservations_count = 0,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  else
    update public.mailbox_throttle_state
    set active_reservation_id = null, updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  end if;

  return jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', p_state,
    'reservation_id', v_reservation.id,
    'next_allowed_at', v_state.next_allowed_at,
    'mailbox_halted', v_state.blocked_reservation_id is not null
  );
end;
$$;

revoke execute on function public.reserve_transactional_mailbox_delivery(text,text,text)
  from public, anon, authenticated;
revoke execute on function public.finalize_transactional_mailbox_delivery(text,text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.reserve_cold_mailbox_delivery(text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.finalize_cold_mailbox_delivery(text,text,text,text,text)
  from public, anon, authenticated;

grant execute on function public.reserve_transactional_mailbox_delivery(text,text,text)
  to service_role;
grant execute on function public.finalize_transactional_mailbox_delivery(text,text,text,text,text)
  to service_role;
grant execute on function public.reserve_cold_mailbox_delivery(text,text,text,text)
  to service_role;
grant execute on function public.finalize_cold_mailbox_delivery(text,text,text,text,text)
  to service_role;

commit;

-- Bind the rendered delivery package to the atomic reservation and provide a
-- service-role-only, audited resolution for ambiguous Outlook outcomes.
-- This migration does not activate Outlook or send email.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.mailbox_delivery_reservations
  add column if not exists package_hmac_sha256 text,
  add column if not exists reconciliation_resolution text,
  add column if not exists reconciliation_evidence_hash text,
  add column if not exists reconciled_at timestamptz;

alter table public.mailbox_delivery_reservations
  drop constraint if exists mailbox_delivery_package_hmac_check;
alter table public.mailbox_delivery_reservations
  add constraint mailbox_delivery_package_hmac_check
  check (package_hmac_sha256 is null or package_hmac_sha256 ~ '^[a-f0-9]{64}$') not valid;
alter table public.mailbox_delivery_reservations
  validate constraint mailbox_delivery_package_hmac_check;

alter table public.mailbox_delivery_reservations
  drop constraint if exists mailbox_delivery_reconciliation_fields_check;
alter table public.mailbox_delivery_reservations
  add constraint mailbox_delivery_reconciliation_fields_check check (
    (
      reconciliation_resolution is null and
      reconciliation_evidence_hash is null and
      reconciled_at is null
    ) or (
      reconciliation_resolution in ('confirmed_sent', 'confirmed_not_sent') and
      reconciliation_evidence_hash ~ '^[a-f0-9]{64}$' and
      reconciled_at is not null
    )
  ) not valid;
alter table public.mailbox_delivery_reservations
  validate constraint mailbox_delivery_reconciliation_fields_check;

create or replace function public.reserve_transactional_mailbox_delivery(
  p_mailbox_key_hash text,
  p_intake_capability_hash text,
  p_finalize_capability_hash text,
  p_package_hmac_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_result jsonb;
  v_updated integer;
begin
  if p_package_hmac_sha256 is null or p_package_hmac_sha256 !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_request');
  end if;

  v_result := public.reserve_transactional_mailbox_delivery(
    p_mailbox_key_hash,
    p_intake_capability_hash,
    p_finalize_capability_hash
  );

  if coalesce((v_result ->> 'authorized')::boolean, false) then
    update public.mailbox_delivery_reservations
    set package_hmac_sha256 = p_package_hmac_sha256,
        updated_at = clock_timestamp()
    where id = (v_result ->> 'reservation_id')::uuid
      and lane = 'transactional'
      and status = 'reserved'
      and package_hmac_sha256 is null;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using errcode = '23514', message = 'package_binding_failed';
    end if;
  end if;

  return v_result;
end;
$$;

create or replace function public.reconcile_transactional_mailbox_delivery(
  p_reservation_id uuid,
  p_resolution text,
  p_provider_message_hash text,
  p_evidence_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_state public.mailbox_throttle_state%rowtype;
  v_lead_id text;
  v_status text;
  v_event_name text;
  v_failure_code text;
  v_reason_code text;
begin
  if p_reservation_id is null or
     p_resolution not in ('confirmed_sent', 'confirmed_not_sent') or
     p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$' or
     (p_resolution = 'confirmed_sent' and
       (p_provider_message_hash is null or p_provider_message_hash !~ '^[a-f0-9]{64}$')) or
     (p_resolution = 'confirmed_not_sent' and p_provider_message_hash is not null) then
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'reason_code', 'invalid_request',
      'mailbox_halted', true
    );
  end if;

  select * into v_reservation
  from public.mailbox_delivery_reservations
  where id = p_reservation_id
    and lane = 'transactional'
  for update;
  if not found then
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'reason_code', 'reservation_unavailable',
      'mailbox_halted', true
    );
  end if;

  select * into v_state
  from public.mailbox_throttle_state
  where mailbox_key_hash = v_reservation.mailbox_key_hash
  for update;
  if not found then
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'reason_code', 'mailbox_unavailable',
      'mailbox_halted', true
    );
  end if;

  v_status := case p_resolution when 'confirmed_sent' then 'sent' else 'failed' end;
  v_event_name := case p_resolution when 'confirmed_sent' then 'email_sent' else 'email_failed' end;
  v_failure_code := case p_resolution when 'confirmed_not_sent' then 'DEFINITIVE_RECONCILED_NOT_SENT' else null end;
  v_reason_code := case p_resolution when 'confirmed_sent' then 'reconciled_sent' else 'reconciled_not_sent' end;

  if v_reservation.reconciliation_resolution is not null then
    if v_reservation.reconciliation_resolution = p_resolution and
       v_reservation.reconciliation_evidence_hash = p_evidence_hash and
       v_reservation.provider_message_hash is not distinct from p_provider_message_hash and
       v_reservation.status = v_status then
      return jsonb_build_object(
        'accepted', true,
        'duplicate', true,
        'reason_code', v_reason_code,
        'mailbox_halted', v_state.blocked_reservation_id is not null
      );
    end if;
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'reason_code', 'reconciliation_conflict',
      'mailbox_halted', v_state.blocked_reservation_id is not null
    );
  end if;

  if v_reservation.status <> 'reconcile_required' or
     v_state.blocked_reservation_id is distinct from v_reservation.id or
     v_state.active_reservation_id is not null then
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'reason_code', 'reconciliation_state_invalid',
      'mailbox_halted', v_state.blocked_reservation_id is not null
    );
  end if;

  update public.mailbox_delivery_reservations
  set status = v_status,
      finalized_at = v_now,
      provider_message_hash = p_provider_message_hash,
      failure_code = v_failure_code,
      reconciliation_resolution = p_resolution,
      reconciliation_evidence_hash = p_evidence_hash,
      reconciled_at = v_now,
      updated_at = v_now
  where id = v_reservation.id;

  if v_reservation.batch_position = 2 then
    update public.mailbox_throttle_state
    set blocked_reservation_id = null,
        active_reservation_id = null,
        batch_id = extensions.gen_random_uuid(),
        batch_reservations_count = 0,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = v_reservation.mailbox_key_hash;
  else
    update public.mailbox_throttle_state
    set blocked_reservation_id = null,
        active_reservation_id = null,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = v_reservation.mailbox_key_hash;
  end if;

  select lead_id into strict v_lead_id
  from public.leads
  where submission_id = v_reservation.submission_id
  for update;

  insert into public.transactional_email_events (
    submission_id,
    lead_id,
    event_name,
    source_event_id,
    occurred_at,
    provider_message_hash,
    failure_code
  ) values (
    v_reservation.submission_id,
    v_lead_id,
    v_event_name,
    'mailbox:' || v_reservation.id::text || ':reconciled:' || p_resolution,
    v_now,
    p_provider_message_hash,
    v_failure_code
  );

  update public.leads
  set email_delivery_status = v_event_name,
      email_delivery_updated_at = v_now
  where submission_id = v_reservation.submission_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'reason_code', v_reason_code,
    'mailbox_halted', false
  );
end;
$$;

revoke execute on function public.reserve_transactional_mailbox_delivery(text,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.reserve_transactional_mailbox_delivery(text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.reconcile_transactional_mailbox_delivery(uuid,text,text,text)
  from public, anon, authenticated;

grant execute on function public.reserve_transactional_mailbox_delivery(text,text,text,text)
  to service_role;
grant execute on function public.reconcile_transactional_mailbox_delivery(uuid,text,text,text)
  to service_role;

commit;
-- =========================================================================
-- GRAPH OUTBOX FOUNDATION (parity with 20260818083632 migration)
-- =========================================================================

-- Durable Microsoft Graph outbox and one-shot cold authorization.
-- All outbound switches are inserted OFF. This migration sends no email.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- Fail before DDL when the established mailbox/campaign authority is partial.
do $$
declare
  v_missing text;
begin
  select pg_catalog.string_agg(required_table, ', ' order by required_table)
  into v_missing
  from pg_catalog.unnest(array[
    'campaigns', 'campaign_contacts', 'campaign_executions',
    'campaign_suppressions', 'campaign_unsubscribe_tokens',
    'mailbox_throttle_state', 'mailbox_delivery_reservations'
  ]) as required(required_table)
  where pg_catalog.to_regclass('public.' || required_table) is null;

  if v_missing is not null then
    raise exception using errcode = '55000',
      message = 'graph_outbox_precheck_missing_tables', detail = v_missing;
  end if;

  if pg_catalog.to_regprocedure(
    'public.reserve_cold_mailbox_delivery(text,text,text,text)'
  ) is null then
    raise exception using errcode = '55000',
      message = 'graph_outbox_precheck_missing_cold_reservation_rpc';
  end if;

  if exists (
    select 1 from public.mailbox_delivery_reservations
    where lane = 'cold' and (submission_id is not null or resource is not null)
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_precheck_invalid_cold_claim';
  end if;
end;
$$;

create table public.outbound_delivery_control (
  singleton boolean primary key default true check (singleton),
  master_enabled boolean not null default false,
  transactional_enabled boolean not null default false,
  cold_enabled boolean not null default false,
  minimum_spacing_seconds integer not null default 60
    check (minimum_spacing_seconds >= 60),
  cold_daily_limit integer not null default 480
    check (cold_daily_limit between 1 and 480),
  operating_timezone text not null default 'Europe/Madrid'
    check (operating_timezone = 'Europe/Madrid'),
  halt_reason text,
  updated_by_hash text
    check (updated_by_hash is null or updated_by_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

insert into public.outbound_delivery_control (
  singleton, master_enabled, transactional_enabled, cold_enabled, halt_reason
) values (true, false, false, false, 'MIGRATION_DEFAULT_OFF');

create table public.outbound_daily_usage (
  mailbox_key_hash text not null check (mailbox_key_hash ~ '^[a-f0-9]{64}$'),
  local_day date not null,
  lane text not null check (lane in ('transactional', 'cold')),
  reservation_count integer not null default 0
    check (
      (lane = 'cold' and reservation_count between 0 and 480) or
      (lane = 'transactional' and reservation_count >= 0)
    ),
  send_submitted_count integer not null default 0
    check (
      (lane = 'cold' and send_submitted_count between 0 and 480) or
      (lane = 'transactional' and send_submitted_count >= 0)
    ),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (mailbox_key_hash, local_day, lane)
);

create table public.graph_outbox (
  reservation_id uuid primary key,
  mailbox_key_hash text not null,
  lane text not null check (lane in ('transactional', 'cold')),
  campaign_id uuid references public.campaigns(id) on delete restrict,
  campaign_contact_id uuid references public.campaign_contacts(id) on delete restrict,
  campaign_execution_id uuid references public.campaign_executions(id) on delete restrict,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  opaque_marker text collate "C" not null check (
    pg_catalog.length(opaque_marker) between 32 and 128 and
    opaque_marker ~ '^[A-Za-z0-9_-]+$'
  ),
  state text not null default 'reserved' check (state in (
    'reserved', 'draft_creating', 'draft_created', 'send_submitted',
    'confirmed_sent', 'definitive_failed', 'ambiguous_halted',
    'suppressed_before_send'
  )),
  graph_draft_immutable_id text collate "C",
  graph_change_key_hash text check (
    graph_change_key_hash is null or graph_change_key_hash ~ '^[a-f0-9]{64}$'
  ),
  internet_message_id_hash text check (
    internet_message_id_hash is null or internet_message_id_hash ~ '^[a-f0-9]{64}$'
  ),
  sent_items_evidence_hash text check (
    sent_items_evidence_hash is null or sent_items_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  terminal_evidence_hash text check (
    terminal_evidence_hash is null or terminal_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  failure_code text check (
    failure_code is null or failure_code ~ '^[A-Z0-9_:-]{2,64}$'
  ),
  quota_reservation_day date not null,
  quota_send_day date,
  draft_started_at timestamptz,
  draft_created_at timestamptz,
  send_submitted_at timestamptz,
  confirmed_sent_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint graph_outbox_reservation_mailbox_fk
    foreign key (mailbox_key_hash, reservation_id)
    references public.mailbox_delivery_reservations(mailbox_key_hash, id)
    on delete restrict,
  constraint graph_outbox_marker_unique unique (opaque_marker),
  constraint graph_outbox_lane_binding_check check (
    (lane = 'transactional' and campaign_id is null and
      campaign_contact_id is null and campaign_execution_id is null) or
    (lane = 'cold' and campaign_id is not null and
      campaign_contact_id is not null and campaign_execution_id is not null)
  ),
  constraint graph_outbox_draft_id_presence_check check (
    state not in ('draft_created', 'send_submitted', 'confirmed_sent') or
    (graph_draft_immutable_id is not null and
      pg_catalog.length(graph_draft_immutable_id) between 1 and 1024)
  ),
  constraint graph_outbox_confirmed_evidence_check check (
    state <> 'confirmed_sent' or (
      internet_message_id_hash is not null and sent_items_evidence_hash is not null and
      confirmed_sent_at is not null and terminal_at is not null
    )
  ),
  constraint graph_outbox_terminal_failure_check check (
    state not in ('definitive_failed', 'ambiguous_halted', 'suppressed_before_send') or
    (failure_code is not null and terminal_evidence_hash is not null and terminal_at is not null)
  )
);

-- Graph immutable ids are case-sensitive. C collation makes that contract explicit.
create unique index graph_outbox_mailbox_draft_immutable_idx
  on public.graph_outbox (mailbox_key_hash, graph_draft_immutable_id collate "C")
  where graph_draft_immutable_id is not null;
create index graph_outbox_state_created_idx
  on public.graph_outbox (state, created_at);
create index graph_outbox_campaign_contact_idx
  on public.graph_outbox (campaign_contact_id, created_at desc)
  where campaign_contact_id is not null;
create index graph_outbox_campaign_execution_idx
  on public.graph_outbox (campaign_execution_id)
  where campaign_execution_id is not null;
create index graph_outbox_campaign_id_idx
  on public.graph_outbox (campaign_id) where campaign_id is not null;

create table public.graph_outbox_authorizations (
  reservation_id uuid primary key
    references public.graph_outbox(reservation_id) on delete cascade,
  send_capability_hash text not null unique
    check (send_capability_hash ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  second_stop_checked_at timestamptz,
  stop_snapshot_hash text check (
    stop_snapshot_hash is null or stop_snapshot_hash ~ '^[a-f0-9]{64}$'
  ),
  check (expires_at > issued_at),
  check (
    (consumed_at is null and second_stop_checked_at is null and
      stop_snapshot_hash is null) or
    (consumed_at is not null and second_stop_checked_at is not null and
      stop_snapshot_hash is not null)
  )
);

create index graph_outbox_authorizations_expiry_idx
  on public.graph_outbox_authorizations (expires_at) where consumed_at is null;

create table public.graph_outbox_events (
  id bigint generated always as identity primary key,
  reservation_id uuid not null
    references public.graph_outbox(reservation_id) on delete cascade,
  state text not null,
  source_event_key text not null unique,
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  evidence_hash text check (
    evidence_hash is null or evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  metadata jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(metadata) = 'object'),
  constraint graph_outbox_events_metadata_no_pii check (not (metadata ?| array[
    'email', 'email_address', 'name', 'first_name', 'last_name', 'phone',
    'company', 'company_name', 'subject', 'body', 'message', 'address', 'ip'
  ]))
);

create index graph_outbox_events_reservation_time_idx
  on public.graph_outbox_events (reservation_id, occurred_at desc);

-- Safe advisor remediations: Postgres does not index FK columns automatically.
create index if not exists campaign_suppressions_source_campaign_idx
  on public.campaign_suppressions (source_campaign_id)
  where source_campaign_id is not null;
create index if not exists campaign_suppressions_source_contact_idx
  on public.campaign_suppressions (source_contact_id)
  where source_contact_id is not null;
create index if not exists campaign_unsubscribe_tokens_campaign_idx
  on public.campaign_unsubscribe_tokens (campaign_id);
create index if not exists mailbox_reservations_submission_idx
  on public.mailbox_delivery_reservations (submission_id)
  where submission_id is not null;

create or replace function public.enforce_graph_outbox_transition()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if row(
    new.reservation_id, new.mailbox_key_hash, new.lane, new.campaign_id,
    new.campaign_contact_id, new.campaign_execution_id, new.payload_sha256,
    new.opaque_marker, new.quota_reservation_day, new.created_at
  ) is distinct from row(
    old.reservation_id, old.mailbox_key_hash, old.lane, old.campaign_id,
    old.campaign_contact_id, old.campaign_execution_id, old.payload_sha256,
    old.opaque_marker, old.quota_reservation_day, old.created_at
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_immutable_field_changed';
  end if;

  if old.graph_draft_immutable_id is not null and
     new.graph_draft_immutable_id is distinct from old.graph_draft_immutable_id then
    raise exception using errcode = '23514',
      message = 'graph_outbox_draft_id_changed';
  end if;

  if old.state <> new.state and not (
    (old.state = 'reserved' and new.state in (
      'draft_creating', 'definitive_failed', 'ambiguous_halted',
      'suppressed_before_send'
    )) or
    (old.state = 'draft_creating' and new.state in (
      'draft_created', 'definitive_failed', 'ambiguous_halted',
      'suppressed_before_send'
    )) or
    (old.state = 'draft_created' and new.state in (
      'send_submitted', 'definitive_failed', 'ambiguous_halted',
      'suppressed_before_send'
    )) or
    (old.state = 'send_submitted' and new.state in (
      'confirmed_sent', 'definitive_failed', 'ambiguous_halted'
    )) or
    (old.state = 'ambiguous_halted' and new.state in (
      'confirmed_sent', 'definitive_failed'
    ))
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_invalid_state_transition';
  end if;

  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger graph_outbox_enforce_transition
before update on public.graph_outbox
for each row execute function public.enforce_graph_outbox_transition();

create or replace function public.record_graph_outbox_state_event()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    insert into public.graph_outbox_events (
      reservation_id, state, source_event_key, evidence_hash, metadata
    ) values (
      new.reservation_id,
      new.state,
      'graph-outbox:' || new.reservation_id::text || ':' || new.state,
      case
        when new.state = 'confirmed_sent' then new.sent_items_evidence_hash
        when new.state in (
          'definitive_failed', 'ambiguous_halted', 'suppressed_before_send'
        ) then new.terminal_evidence_hash
        else null
      end,
      pg_catalog.jsonb_build_object('lane', new.lane)
    ) on conflict (source_event_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger graph_outbox_record_state_event
after insert or update of state on public.graph_outbox
for each row execute function public.record_graph_outbox_state_event();

-- The historical registry only represented unsubscribe/all. Widen it so a
-- permanent bounce suppresses marketing globally while transactional mail stays legal.
alter table public.campaign_suppressions
  drop constraint if exists campaign_suppressions_scope_check;
alter table public.campaign_suppressions
  drop constraint if exists campaign_suppressions_reason_check;
alter table public.campaign_suppressions
  add constraint campaign_suppressions_scope_reason_check check (
    (scope = 'all' and reason = 'unsubscribe') or
    (scope = 'marketing' and reason = 'hard_bounce')
  ) not valid;
alter table public.campaign_suppressions
  validate constraint campaign_suppressions_scope_reason_check;

create or replace function public.enforce_campaign_suppression_on_contact()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_suppression public.campaign_suppressions%rowtype;
begin
  select * into v_suppression
  from public.campaign_suppressions
  where identity_hash = new.email_hash;

  if not found then
    return new;
  end if;

  new.cold_sequence_status := 'stopped';
  new.intent_sequence_status := 'stopped';
  new.marketing_lane := 'none';
  new.suppression_scope := v_suppression.scope;
  new.sequence_status := 'stopped';
  new.next_delivery_status := 'stopped';
  new.next_scheduled_at := null;
  new.locked_at := null;
  new.lock_token := null;
  new.lock_expires_at := null;
  new.stopped_at := coalesce(new.stopped_at, v_suppression.occurred_at);
  new.stopped_reason := coalesce(new.stopped_reason, v_suppression.reason);
  new.suppressed_at := coalesce(new.suppressed_at, v_suppression.occurred_at);
  new.suppression_reason := coalesce(
    new.suppression_reason, v_suppression.reason
  );
  return new;
end;
$$;

create or replace function public.apply_campaign_hard_bounce_suppression(
  p_identity_hash text,
  p_occurred_at timestamptz,
  p_source_event_id text default null,
  p_source_campaign_id uuid default null,
  p_source_contact_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_suppression public.campaign_suppressions%rowtype;
  v_contacts integer;
begin
  if p_identity_hash is null or
     p_identity_hash !~ '^[A-Za-z0-9_:-]{16,160}$' or
     p_occurred_at is null or
     (p_source_event_id is not null and
       p_source_event_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$') then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  insert into public.campaign_suppressions (
    identity_hash, scope, reason, occurred_at, source_event_id,
    source_campaign_id, source_contact_id
  ) values (
    p_identity_hash, 'marketing', 'hard_bounce', p_occurred_at,
    p_source_event_id, p_source_campaign_id, p_source_contact_id
  ) on conflict (identity_hash) do update set
    scope = case when campaign_suppressions.scope = 'all'
      then 'all' else 'marketing' end,
    reason = case when campaign_suppressions.scope = 'all'
      then 'unsubscribe' else 'hard_bounce' end,
    occurred_at = least(
      campaign_suppressions.occurred_at, excluded.occurred_at
    ),
    source_event_id = coalesce(
      campaign_suppressions.source_event_id, excluded.source_event_id
    ),
    source_campaign_id = coalesce(
      campaign_suppressions.source_campaign_id, excluded.source_campaign_id
    ),
    source_contact_id = coalesce(
      campaign_suppressions.source_contact_id, excluded.source_contact_id
    ),
    updated_at = pg_catalog.clock_timestamp()
  returning * into v_suppression;

  -- Lock every representation of the identity before propagating the stop.
  perform 1 from public.campaign_contacts
  where email_hash = p_identity_hash
  order by id for update;

  update public.campaign_contacts
  set cold_sequence_status = 'stopped',
      intent_sequence_status = 'stopped',
      marketing_lane = 'none',
      suppression_scope = v_suppression.scope,
      sequence_status = 'stopped',
      next_delivery_status = 'stopped',
      next_scheduled_at = null,
      locked_at = null,
      lock_token = null,
      lock_expires_at = null,
      stopped_at = coalesce(stopped_at, p_occurred_at),
      stopped_reason = coalesce(stopped_reason, v_suppression.reason),
      suppressed_at = coalesce(suppressed_at, p_occurred_at),
      suppression_reason = coalesce(
        suppression_reason, v_suppression.reason
      )
  where email_hash = p_identity_hash;
  get diagnostics v_contacts = row_count;

  update public.campaign_executions
  set status = 'stopped',
      stopped_at = coalesce(stopped_at, p_occurred_at),
      stop_reason = coalesce(stop_reason, v_suppression.reason)
  where status = 'planned'
    and campaign_contact_id in (
      select id from public.campaign_contacts where email_hash = p_identity_hash
    );

  return pg_catalog.jsonb_build_object(
    'accepted', true,
    'duplicate', v_suppression.occurred_at < p_occurred_at,
    'reason_code', v_suppression.reason,
    'scope', v_suppression.scope,
    'contacts_stopped', v_contacts
  );
end;
$$;

create or replace function public.register_transactional_graph_outbox(
  p_reservation_id uuid,
  p_finalize_capability_hash text,
  p_payload_sha256 text,
  p_send_capability_hash text,
  p_opaque_marker text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_control public.outbound_delivery_control%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_existing public.graph_outbox%rowtype;
  v_today date;
begin
  if p_reservation_id is null or
     p_finalize_capability_hash is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' or
     p_send_capability_hash is null or
     p_send_capability_hash !~ '^[a-f0-9]{64}$' or
     p_opaque_marker is null or
     pg_catalog.length(p_opaque_marker) not between 32 and 128 or
     p_opaque_marker !~ '^[A-Za-z0-9_-]+$' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  if not found or not v_control.master_enabled or
     not v_control.transactional_enabled then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'master_or_lane_disabled'
    );
  end if;
  v_today := (v_now at time zone v_control.operating_timezone)::date;

  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id and lane = 'transactional' for update;
  if not found or v_reservation.status <> 'reserved' or
     v_reservation.finalize_capability_hash <> p_finalize_capability_hash or
     v_reservation.payload_sha256 <> p_payload_sha256 then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'reservation_unavailable'
    );
  end if;

  select * into v_existing from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if found then
    if v_existing.payload_sha256 = p_payload_sha256 and
       v_existing.opaque_marker = p_opaque_marker then
      return pg_catalog.jsonb_build_object(
        'authorized', true, 'duplicate', true, 'reason_code', v_existing.state,
        'reservation_id', v_existing.reservation_id
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'reservation_collision'
    );
  end if;

  insert into public.graph_outbox (
    reservation_id, mailbox_key_hash, lane, payload_sha256, opaque_marker,
    quota_reservation_day
  ) values (
    v_reservation.id, v_reservation.mailbox_key_hash, 'transactional',
    p_payload_sha256, p_opaque_marker, v_today
  );

  insert into public.graph_outbox_authorizations (
    reservation_id, send_capability_hash, issued_at, expires_at
  ) values (
    v_reservation.id, p_send_capability_hash, v_now, v_now + interval '20 minutes'
  );

  return pg_catalog.jsonb_build_object(
    'authorized', true, 'duplicate', false, 'reason_code', 'reserved',
    'reservation_id', v_reservation.id,
    'authorization_expires_at', v_now + interval '20 minutes'
  );
end;
$$;

create or replace function public.reserve_cold_graph_delivery(
  p_campaign_external_id text,
  p_contact_id text,
  p_execution_key text,
  p_mailbox_key_hash text,
  p_message_key_hash text,
  p_payload_sha256 text,
  p_finalize_capability_hash text,
  p_send_capability_hash text,
  p_opaque_marker text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today date;
  v_control public.outbound_delivery_control%rowtype;
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_state public.mailbox_throttle_state%rowtype;
  v_active public.mailbox_delivery_reservations%rowtype;
  v_existing_reservation public.mailbox_delivery_reservations%rowtype;
  v_existing_outbox public.graph_outbox%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_usage public.outbound_daily_usage%rowtype;
  v_position smallint;
begin
  if p_campaign_external_id is null or
     p_campaign_external_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_contact_id is null or
     p_contact_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_execution_key is null or
     p_execution_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$' or
     p_message_key_hash is null or p_message_key_hash !~ '^[a-f0-9]{64}$' or
     p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' or
     p_finalize_capability_hash is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_send_capability_hash is null or
     p_send_capability_hash !~ '^[a-f0-9]{64}$' or
     p_opaque_marker is null or
     pg_catalog.length(p_opaque_marker) not between 32 and 128 or
     p_opaque_marker !~ '^[A-Za-z0-9_-]+$' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  if not found or not v_control.master_enabled or not v_control.cold_enabled then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'master_or_lane_disabled'
    );
  end if;
  v_today := (v_now at time zone v_control.operating_timezone)::date;

  select * into v_campaign from public.campaigns
  where external_id = p_campaign_external_id for update;
  if not found or not v_campaign.is_active or
     v_campaign.status not in ('active', 'running', 'pilot') then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'campaign_inactive'
    );
  end if;

  select * into v_contact from public.campaign_contacts
  where campaign_id = v_campaign.id and external_contact_id = p_contact_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'contact_unavailable'
    );
  end if;

  if exists (
    select 1 from public.campaign_suppressions
    where identity_hash = v_contact.email_hash
  ) or v_contact.suppression_scope <> 'none' or
     v_contact.marketing_lane <> 'cold' or
     v_contact.cold_sequence_status not in ('pending', 'active') then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'suppressed'
    );
  end if;

  select * into v_execution from public.campaign_executions
  where campaign_id = v_campaign.id and campaign_contact_id = v_contact.id
    and idempotency_key = p_execution_key for update;
  if not found or v_execution.status <> 'planned' or
     v_execution.channel <> 'email' or
     v_execution.action_name <> 'delivery_scheduled' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'execution_unavailable'
    );
  end if;

  insert into public.mailbox_throttle_state (mailbox_key_hash, next_allowed_at)
  values (p_mailbox_key_hash, v_now) on conflict (mailbox_key_hash) do nothing;
  select * into v_state from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash for update;

  if v_state.blocked_reservation_id is not null then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'ambiguous_halted'
    );
  end if;

  select * into v_existing_reservation from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash
    and message_key_hash = p_message_key_hash for update;
  if found then
    select * into v_existing_outbox from public.graph_outbox
    where reservation_id = v_existing_reservation.id;
    if found and v_existing_outbox.campaign_execution_id = v_execution.id and
       v_existing_outbox.payload_sha256 = p_payload_sha256 and
       v_existing_outbox.opaque_marker = p_opaque_marker then
      return pg_catalog.jsonb_build_object(
        'authorized', true, 'duplicate', true,
        'reason_code', v_existing_outbox.state,
        'reservation_id', v_existing_outbox.reservation_id
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'message_key_collision'
    );
  end if;

  if v_state.active_reservation_id is not null then
    select * into v_active from public.mailbox_delivery_reservations
    where id = v_state.active_reservation_id for update;
    if not found or v_active.status <> 'reserved' then
      return pg_catalog.jsonb_build_object(
        'authorized', false, 'duplicate', false, 'reason_code', 'mailbox_state_invalid'
      );
    end if;
    if v_active.lease_expires_at <= v_now then
      update public.graph_outbox
      set state = 'ambiguous_halted', failure_code = 'LEASE_EXPIRED',
          terminal_evidence_hash = v_active.payload_sha256, terminal_at = v_now
      where reservation_id = v_active.id
        and state in ('reserved', 'draft_creating', 'draft_created', 'send_submitted');
      update public.mailbox_delivery_reservations
      set status = 'reconcile_required', finalized_at = v_now,
          failure_code = 'LEASE_EXPIRED', updated_at = v_now
      where id = v_active.id;
      update public.mailbox_throttle_state
      set active_reservation_id = null, blocked_reservation_id = v_active.id,
          next_allowed_at = greatest(
            next_allowed_at, v_now + interval '120 seconds'
          ), updated_at = v_now
      where mailbox_key_hash = p_mailbox_key_hash;
      return pg_catalog.jsonb_build_object(
        'authorized', false, 'duplicate', false,
        'reason_code', 'lease_expired_ambiguous_halted'
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'lease_active',
      'lease_expires_at', v_active.lease_expires_at
    );
  end if;

  if v_state.next_allowed_at > v_now then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'cooldown',
      'next_allowed_at', v_state.next_allowed_at,
      'retry_after_seconds', greatest(
        1, pg_catalog.ceil(extract(epoch from
          (v_state.next_allowed_at - v_now)))
      )::integer
    );
  end if;

  insert into public.outbound_daily_usage (
    mailbox_key_hash, local_day, lane, reservation_count
  ) values (p_mailbox_key_hash, v_today, 'cold', 0)
  on conflict (mailbox_key_hash, local_day, lane) do nothing;
  select * into v_usage from public.outbound_daily_usage
  where mailbox_key_hash = p_mailbox_key_hash and local_day = v_today
    and lane = 'cold' for update;
  if v_usage.reservation_count >= v_control.cold_daily_limit then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'daily_limit'
    );
  end if;

  v_position := v_state.batch_reservations_count + 1;
  if v_position not in (1, 2) then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'mailbox_state_invalid'
    );
  end if;

  insert into public.mailbox_delivery_reservations (
    mailbox_key_hash, message_key_hash, payload_sha256, submission_id, resource,
    lane, batch_id, batch_position, status, finalize_capability_hash,
    reserved_at, lease_expires_at
  ) values (
    p_mailbox_key_hash, p_message_key_hash, p_payload_sha256, null, null,
    'cold', v_state.batch_id, v_position, 'reserved', p_finalize_capability_hash,
    v_now, v_now + interval '30 minutes'
  ) returning * into v_reservation;

  insert into public.graph_outbox (
    reservation_id, mailbox_key_hash, lane, campaign_id, campaign_contact_id,
    campaign_execution_id, payload_sha256, opaque_marker, quota_reservation_day
  ) values (
    v_reservation.id, p_mailbox_key_hash, 'cold', v_campaign.id, v_contact.id,
    v_execution.id, p_payload_sha256, p_opaque_marker, v_today
  );
  insert into public.graph_outbox_authorizations (
    reservation_id, send_capability_hash, issued_at, expires_at
  ) values (
    v_reservation.id, p_send_capability_hash, v_now, v_now + interval '20 minutes'
  );

  update public.outbound_daily_usage
  set reservation_count = reservation_count + 1, updated_at = v_now
  where mailbox_key_hash = p_mailbox_key_hash and local_day = v_today
    and lane = 'cold';
  update public.mailbox_throttle_state
  set active_reservation_id = v_reservation.id,
      batch_reservations_count = v_position,
      next_allowed_at = greatest(
        next_allowed_at,
        v_now + pg_catalog.make_interval(
          secs => v_control.minimum_spacing_seconds
        )
      ),
      updated_at = v_now
  where mailbox_key_hash = p_mailbox_key_hash;

  return pg_catalog.jsonb_build_object(
    'authorized', true, 'duplicate', false, 'reason_code', 'reserved',
    'reservation_id', v_reservation.id,
    'lease_expires_at', v_reservation.lease_expires_at,
    'authorization_expires_at', v_now + interval '20 minutes',
    'next_allowed_at', greatest(
      v_state.next_allowed_at,
      v_now + pg_catalog.make_interval(secs => v_control.minimum_spacing_seconds)
    ),
    'batch_position', v_position
  );
end;
$$;

create or replace function public.begin_graph_draft_creation(
  p_reservation_id uuid,
  p_finalize_capability_hash text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_outbox public.graph_outbox%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_reservation_id is null or p_finalize_capability_hash is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'outbox_unavailable'
    );
  end if;
  if not v_control.master_enabled or
     (v_outbox.lane = 'cold' and not v_control.cold_enabled) or
     (v_outbox.lane = 'transactional' and not v_control.transactional_enabled) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'master_or_lane_disabled'
    );
  end if;

  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id
    and finalize_capability_hash = p_finalize_capability_hash for update;
  if not found or v_reservation.status <> 'reserved' or
     v_reservation.lease_expires_at <= v_now then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'reservation_unavailable'
    );
  end if;

  if v_outbox.state = 'draft_creating' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', true, 'reason_code', 'draft_recovery_required',
      'reservation_id', p_reservation_id, 'opaque_marker', v_outbox.opaque_marker
    );
  end if;
  if v_outbox.state <> 'reserved' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;

  update public.graph_outbox
  set state = 'draft_creating', draft_started_at = v_now
  where reservation_id = p_reservation_id;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', 'draft_creating',
    'reservation_id', p_reservation_id, 'opaque_marker', v_outbox.opaque_marker,
    'payload_sha256', v_outbox.payload_sha256
  );
end;
$$;

create or replace function public.bind_graph_draft_immutable_id(
  p_reservation_id uuid,
  p_finalize_capability_hash text,
  p_graph_draft_immutable_id text,
  p_graph_change_key_hash text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_outbox public.graph_outbox%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_reservation_id is null or p_finalize_capability_hash is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_graph_draft_immutable_id is null or
     pg_catalog.length(p_graph_draft_immutable_id) not between 1 and 1024 or
     p_graph_change_key_hash is null or
     p_graph_change_key_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'outbox_unavailable'
    );
  end if;
  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id
    and finalize_capability_hash = p_finalize_capability_hash for update;
  if not found or v_reservation.status <> 'reserved' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'reservation_unavailable'
    );
  end if;

  if v_outbox.state = 'draft_created' and
     v_outbox.graph_draft_immutable_id = p_graph_draft_immutable_id collate "C" and
     v_outbox.graph_change_key_hash = p_graph_change_key_hash then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', true, 'reason_code', 'draft_created',
      'reservation_id', p_reservation_id
    );
  end if;
  if v_outbox.state <> 'draft_creating' or
     v_outbox.graph_draft_immutable_id is not null then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;

  update public.graph_outbox
  set state = 'draft_created',
      graph_draft_immutable_id = p_graph_draft_immutable_id,
      graph_change_key_hash = p_graph_change_key_hash,
      draft_created_at = v_now
  where reservation_id = p_reservation_id;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', 'draft_created',
    'reservation_id', p_reservation_id
  );
exception
  when unique_violation then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false,
      'reason_code', 'graph_draft_id_collision'
    );
end;
$$;

create or replace function public.authorize_graph_draft_send(
  p_reservation_id uuid,
  p_send_capability_hash text,
  p_stop_snapshot_hash text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today date;
  v_control public.outbound_delivery_control%rowtype;
  v_outbox public.graph_outbox%rowtype;
  v_authorization public.graph_outbox_authorizations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_usage public.outbound_daily_usage%rowtype;
begin
  if p_reservation_id is null or p_send_capability_hash is null or
     p_send_capability_hash !~ '^[a-f0-9]{64}$' or
     p_stop_snapshot_hash is null or p_stop_snapshot_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'outbox_unavailable'
    );
  end if;
  if not v_control.master_enabled or
     (v_outbox.lane = 'cold' and not v_control.cold_enabled) or
     (v_outbox.lane = 'transactional' and not v_control.transactional_enabled) then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'master_or_lane_disabled'
    );
  end if;
  if v_outbox.state = 'send_submitted' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', true, 'reason_code', 'replay_blocked'
    );
  end if;
  if v_outbox.state <> 'draft_created' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;

  select * into v_authorization from public.graph_outbox_authorizations
  where reservation_id = p_reservation_id
    and send_capability_hash = p_send_capability_hash for update;
  if not found or v_authorization.consumed_at is not null or
     v_authorization.expires_at <= v_now then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', 'authorization_unavailable'
    );
  end if;

  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id for update;
  if not found or v_reservation.status <> 'reserved' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'reservation_unavailable'
    );
  end if;
  if v_reservation.lease_expires_at <= v_now then
    update public.graph_outbox
    set state = 'ambiguous_halted', failure_code = 'LEASE_EXPIRED',
        terminal_evidence_hash = p_stop_snapshot_hash, terminal_at = v_now
    where reservation_id = p_reservation_id;
    update public.mailbox_delivery_reservations
    set status = 'reconcile_required', finalized_at = v_now,
        failure_code = 'LEASE_EXPIRED', updated_at = v_now
    where id = p_reservation_id;
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        blocked_reservation_id = p_reservation_id,
        next_allowed_at = greatest(
          next_allowed_at, v_now + interval '120 seconds'
        ), updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', 'lease_expired_ambiguous_halted'
    );
  end if;

  if v_outbox.lane = 'cold' then
    select * into v_campaign from public.campaigns
    where id = v_outbox.campaign_id for update;
    select * into v_contact from public.campaign_contacts
    where id = v_outbox.campaign_contact_id for update;
    select * into v_execution from public.campaign_executions
    where id = v_outbox.campaign_execution_id for update;

    if not found or not v_campaign.is_active or
       v_campaign.status not in ('active', 'running', 'pilot') or
       v_execution.status <> 'planned' or v_execution.channel <> 'email' or
       v_execution.action_name <> 'delivery_scheduled' or
       exists (
         select 1 from public.campaign_suppressions
         where identity_hash = v_contact.email_hash
       ) or v_contact.suppression_scope <> 'none' or
       v_contact.marketing_lane <> 'cold' or
       v_contact.cold_sequence_status not in ('pending', 'active') then
      update public.graph_outbox
      set state = 'suppressed_before_send', failure_code = 'DEFINITIVE_SUPPRESSED',
          terminal_evidence_hash = p_stop_snapshot_hash, terminal_at = v_now
      where reservation_id = p_reservation_id;
      update public.graph_outbox_authorizations
      set consumed_at = v_now, second_stop_checked_at = v_now,
          stop_snapshot_hash = p_stop_snapshot_hash
      where reservation_id = p_reservation_id;
      update public.mailbox_delivery_reservations
      set status = 'failed', finalized_at = v_now,
          failure_code = 'DEFINITIVE_SUPPRESSED', updated_at = v_now
      where id = p_reservation_id;
      update public.campaign_executions
      set status = 'stopped', stopped_at = v_now,
          stop_reason = coalesce(stop_reason, 'suppressed_before_send')
      where id = v_outbox.campaign_execution_id and status = 'planned';
      update public.mailbox_throttle_state
      set active_reservation_id = null,
          batch_id = case when v_reservation.batch_position = 2
            then extensions.gen_random_uuid() else batch_id end,
          batch_reservations_count = case when v_reservation.batch_position = 2
            then 0 else batch_reservations_count end,
          next_allowed_at = greatest(
            next_allowed_at,
            v_now + case when v_reservation.batch_position = 2
              then interval '120 seconds' else interval '0 seconds' end
          ), updated_at = v_now
      where mailbox_key_hash = v_outbox.mailbox_key_hash;
      return pg_catalog.jsonb_build_object(
        'authorized', false, 'duplicate', false,
        'reason_code', 'suppressed_before_send'
      );
    end if;
  end if;

  v_today := (v_now at time zone v_control.operating_timezone)::date;
  insert into public.outbound_daily_usage (
    mailbox_key_hash, local_day, lane, send_submitted_count
  ) values (v_outbox.mailbox_key_hash, v_today, v_outbox.lane, 0)
  on conflict (mailbox_key_hash, local_day, lane) do nothing;
  select * into v_usage from public.outbound_daily_usage
  where mailbox_key_hash = v_outbox.mailbox_key_hash
    and local_day = v_today and lane = v_outbox.lane for update;
  if v_outbox.lane = 'cold' and
     v_usage.send_submitted_count >= v_control.cold_daily_limit then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'daily_limit'
    );
  end if;

  update public.graph_outbox_authorizations
  set consumed_at = v_now, second_stop_checked_at = v_now,
      stop_snapshot_hash = p_stop_snapshot_hash
  where reservation_id = p_reservation_id;
  update public.graph_outbox
  set state = 'send_submitted', send_submitted_at = v_now,
      quota_send_day = v_today
  where reservation_id = p_reservation_id;
  update public.outbound_daily_usage
  set send_submitted_count = send_submitted_count + 1, updated_at = v_now
  where mailbox_key_hash = v_outbox.mailbox_key_hash
    and local_day = v_today and lane = v_outbox.lane;

  return pg_catalog.jsonb_build_object(
    'authorized', true, 'duplicate', false, 'reason_code', 'send_submitted',
    'reservation_id', p_reservation_id,
    'graph_draft_immutable_id', v_outbox.graph_draft_immutable_id,
    'opaque_marker', v_outbox.opaque_marker
  );
end;
$$;

create or replace function public.confirm_graph_sent_item(
  p_reservation_id uuid,
  p_finalize_capability_hash text,
  p_graph_draft_immutable_id text,
  p_internet_message_id_hash text,
  p_sent_items_evidence_hash text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_outbox public.graph_outbox%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
begin
  if p_reservation_id is null or p_finalize_capability_hash is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_graph_draft_immutable_id is null or
     pg_catalog.length(p_graph_draft_immutable_id) not between 1 and 1024 or
     p_internet_message_id_hash is null or
     p_internet_message_id_hash !~ '^[a-f0-9]{64}$' or
     p_sent_items_evidence_hash is null or
     p_sent_items_evidence_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'outbox_unavailable'
    );
  end if;
  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id
    and finalize_capability_hash = p_finalize_capability_hash for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_capability'
    );
  end if;

  if v_outbox.state = 'confirmed_sent' and
     v_outbox.graph_draft_immutable_id = p_graph_draft_immutable_id collate "C" and
     v_outbox.internet_message_id_hash = p_internet_message_id_hash and
     v_outbox.sent_items_evidence_hash = p_sent_items_evidence_hash then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', true, 'reason_code', 'confirmed_sent',
      'reservation_id', p_reservation_id
    );
  end if;
  if v_outbox.state not in ('send_submitted', 'ambiguous_halted') or
     v_reservation.status not in ('reserved', 'reconcile_required') or
     v_outbox.graph_draft_immutable_id <> p_graph_draft_immutable_id collate "C" then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_or_id_conflict'
    );
  end if;

  update public.graph_outbox
  set state = 'confirmed_sent',
      internet_message_id_hash = p_internet_message_id_hash,
      sent_items_evidence_hash = p_sent_items_evidence_hash,
      failure_code = null,
      terminal_evidence_hash = null,
      confirmed_sent_at = v_now,
      terminal_at = v_now
  where reservation_id = p_reservation_id;
  update public.mailbox_delivery_reservations
  set status = 'sent', finalized_at = v_now,
      provider_message_hash = p_internet_message_id_hash,
      failure_code = null, updated_at = v_now
  where id = p_reservation_id;

  if v_reservation.batch_position = 2 then
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        blocked_reservation_id = null,
        batch_id = extensions.gen_random_uuid(),
        batch_reservations_count = 0,
        next_allowed_at = greatest(
          next_allowed_at, v_now + interval '120 seconds'
        ), updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
  else
    update public.mailbox_throttle_state
    set active_reservation_id = null, blocked_reservation_id = null,
        updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
  end if;

  if v_outbox.lane = 'cold' then
    update public.campaign_executions
    set status = 'executed', actual_at = v_now
    where id = v_outbox.campaign_execution_id and status = 'planned';

    insert into public.campaign_events (
      campaign_id, campaign_contact_id, execution_id, source_event_id,
      event_name, occurred_at, channel, capture_method, metric_quality,
      context, properties
    ) values (
      v_outbox.campaign_id,
      v_outbox.campaign_contact_id,
      v_outbox.campaign_execution_id,
      'graph-confirmed:' || p_reservation_id::text,
      'delivery_sent', v_now, 'email', 'automation', 'confirmed',
      pg_catalog.jsonb_build_object('source', 'graph_sent_items'),
      pg_catalog.jsonb_build_object(
        'provider_message_hash', p_internet_message_id_hash,
        'evidence_hash', p_sent_items_evidence_hash
      )
    ) on conflict (campaign_id, source_event_id)
      where source_event_id is not null do nothing;
  end if;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', 'confirmed_sent',
    'reservation_id', p_reservation_id, 'mailbox_halted', false
  );
end;
$$;

create or replace function public.finalize_graph_delivery_failure(
  p_reservation_id uuid,
  p_finalize_capability_hash text,
  p_outcome text,
  p_failure_code text,
  p_evidence_hash text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_outbox public.graph_outbox%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_target_reservation_status text;
begin
  if p_reservation_id is null or p_finalize_capability_hash is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_outcome is null or p_outcome not in ('definitive_failed', 'ambiguous_halted') or
     p_failure_code is null or p_failure_code !~ '^[A-Z0-9_:-]{2,64}$' or
     p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$' or
     (p_outcome = 'definitive_failed' and (
       p_failure_code !~ '^DEFINITIVE_[A-Z0-9_:-]{2,53}$' or
       p_failure_code ~ '(TIMEOUT|429|AMBIGUOUS|UNKNOWN|RATE_LIMIT|LEASE_EXPIRED)'
     )) or
     (p_outcome = 'ambiguous_halted' and
       p_failure_code !~ '(TIMEOUT|429|AMBIGUOUS|UNKNOWN|RATE_LIMIT|LEASE_EXPIRED)') then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'outbox_unavailable'
    );
  end if;
  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id
    and finalize_capability_hash = p_finalize_capability_hash for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_capability'
    );
  end if;

  if v_outbox.state = p_outcome and v_outbox.failure_code = p_failure_code and
     v_outbox.terminal_evidence_hash = p_evidence_hash then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', true, 'reason_code', p_outcome,
      'reservation_id', p_reservation_id,
      'mailbox_halted', p_outcome = 'ambiguous_halted'
    );
  end if;
  if not (
    (v_outbox.state in (
    'reserved', 'draft_creating', 'draft_created', 'send_submitted'
    ) and v_reservation.status = 'reserved') or
    (v_outbox.state = 'ambiguous_halted' and
      p_outcome = 'definitive_failed' and
      v_reservation.status = 'reconcile_required')
  ) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;

  update public.graph_outbox
  set state = p_outcome, failure_code = p_failure_code,
      terminal_evidence_hash = p_evidence_hash, terminal_at = v_now
  where reservation_id = p_reservation_id;

  v_target_reservation_status := case p_outcome
    when 'definitive_failed' then 'failed' else 'reconcile_required' end;
  update public.mailbox_delivery_reservations
  set status = v_target_reservation_status,
      finalized_at = v_now, provider_message_hash = null,
      failure_code = p_failure_code, updated_at = v_now
  where id = p_reservation_id;

  if p_outcome = 'ambiguous_halted' then
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        blocked_reservation_id = p_reservation_id,
        next_allowed_at = greatest(
          next_allowed_at, v_now + interval '120 seconds'
        ), updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
  elsif v_reservation.batch_position = 2 then
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        blocked_reservation_id = null,
        batch_id = extensions.gen_random_uuid(),
        batch_reservations_count = 0,
        next_allowed_at = greatest(
          next_allowed_at, v_now + interval '120 seconds'
        ), updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
  else
    update public.mailbox_throttle_state
    set active_reservation_id = null, blocked_reservation_id = null,
        updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
  end if;

  if v_outbox.lane = 'cold' then
    update public.campaign_executions
    set status = case p_outcome
          when 'definitive_failed' then 'failed' else 'stopped' end,
        failed_at = case p_outcome
          when 'definitive_failed' then v_now else failed_at end,
        stopped_at = case p_outcome
          when 'ambiguous_halted' then v_now else stopped_at end,
        failure_code = case p_outcome
          when 'definitive_failed' then p_failure_code else failure_code end,
        stop_reason = case p_outcome
          when 'ambiguous_halted' then p_failure_code else stop_reason end
    where id = v_outbox.campaign_execution_id and status = 'planned';
  end if;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', p_outcome,
    'reservation_id', p_reservation_id,
    'mailbox_halted', p_outcome = 'ambiguous_halted'
  );
end;
$$;

-- Forward-safe rollback: this only disables capabilities. It never deletes
-- drafts, reservations, audit evidence, or migration history.
create or replace function public.emergency_halt_outbound_delivery(
  p_actor_hash text,
  p_reason text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 3 and 240 then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason_code', 'invalid_request');
  end if;

  update public.outbound_delivery_control
  set master_enabled = false,
      transactional_enabled = false,
      cold_enabled = false,
      halt_reason = pg_catalog.btrim(p_reason),
      updated_by_hash = p_actor_hash,
      updated_at = v_now
  where singleton;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'reason_code', 'halted', 'halted_at', v_now
  );
end;
$$;

-- Once a reservation is attached to Graph, only verified outbox terminal states
-- may finalize it. Legacy reservations keep their historical behavior.
create or replace function public.enforce_mailbox_terminal_transition()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_graph_state text;
begin
  if old.status <> 'reserved' or new.status not in ('sent', 'failed') then
    return new;
  end if;

  select state into v_graph_state from public.graph_outbox
  where reservation_id = old.id;
  if found then
    if (new.status = 'sent' and v_graph_state <> 'confirmed_sent') or
       (new.status = 'failed' and v_graph_state not in (
         'definitive_failed', 'suppressed_before_send'
       )) then
      raise exception using errcode = '23514',
        message = 'graph_outbox_terminal_evidence_required';
    end if;
    return new;
  end if;

  if old.lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '23514',
      message = 'lease_expired_requires_reconcile';
  end if;
  return new;
end;
$$;

alter table public.outbound_delivery_control enable row level security;
alter table public.outbound_delivery_control force row level security;
alter table public.outbound_daily_usage enable row level security;
alter table public.outbound_daily_usage force row level security;
alter table public.graph_outbox enable row level security;
alter table public.graph_outbox force row level security;
alter table public.graph_outbox_authorizations enable row level security;
alter table public.graph_outbox_authorizations force row level security;
alter table public.graph_outbox_events enable row level security;
alter table public.graph_outbox_events force row level security;

revoke all privileges on table public.outbound_delivery_control
  from public, anon, authenticated;
revoke all privileges on table public.outbound_daily_usage
  from public, anon, authenticated;
revoke all privileges on table public.graph_outbox
  from public, anon, authenticated;
revoke all privileges on table public.graph_outbox_authorizations
  from public, anon, authenticated;
revoke all privileges on table public.graph_outbox_events
  from public, anon, authenticated;
revoke all privileges on sequence public.graph_outbox_events_id_seq
  from public, anon, authenticated;

grant select, update on table public.outbound_delivery_control to service_role;
grant select, insert, update on table public.outbound_daily_usage to service_role;
grant select, insert, update on table public.graph_outbox to service_role;
grant select, insert, update on table public.graph_outbox_authorizations to service_role;
grant select, insert on table public.graph_outbox_events to service_role;
grant usage, select on sequence public.graph_outbox_events_id_seq to service_role;
grant select, insert, update on table public.campaign_suppressions to service_role;
grant select, update on table public.campaigns to service_role;
grant select, update on table public.campaign_contacts to service_role;
grant select, insert, update on table public.campaign_executions to service_role;
grant select, insert on table public.campaign_events to service_role;

-- Remove the bypassable cold lane. New cold sends must enter through the atomic
-- campaign + mailbox + quota + Graph reservation RPC above.
revoke execute on function public.reserve_cold_mailbox_delivery(text,text,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.finalize_cold_mailbox_delivery(text,text,text,text,text)
  from public, anon, authenticated, service_role;

alter default privileges in schema public
  revoke execute on functions from public;
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

revoke execute on function public.enforce_graph_outbox_transition()
  from public, anon, authenticated, service_role;
revoke execute on function public.record_graph_outbox_state_event()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_campaign_suppression_on_contact()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_mailbox_terminal_transition()
  from public, anon, authenticated, service_role;

revoke execute on function public.apply_campaign_hard_bounce_suppression(
  text,timestamptz,text,uuid,uuid
) from public, anon, authenticated;
revoke execute on function public.register_transactional_graph_outbox(
  uuid,text,text,text,text
) from public, anon, authenticated;
revoke execute on function public.reserve_cold_graph_delivery(
  text,text,text,text,text,text,text,text,text
) from public, anon, authenticated;
revoke execute on function public.begin_graph_draft_creation(uuid,text)
  from public, anon, authenticated;
revoke execute on function public.bind_graph_draft_immutable_id(uuid,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.authorize_graph_draft_send(uuid,text,text)
  from public, anon, authenticated;
revoke execute on function public.confirm_graph_sent_item(uuid,text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.finalize_graph_delivery_failure(uuid,text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.emergency_halt_outbound_delivery(text,text)
  from public, anon, authenticated;

grant execute on function public.apply_campaign_hard_bounce_suppression(
  text,timestamptz,text,uuid,uuid
) to service_role;
grant execute on function public.register_transactional_graph_outbox(
  uuid,text,text,text,text
) to service_role;
grant execute on function public.reserve_cold_graph_delivery(
  text,text,text,text,text,text,text,text,text
) to service_role;
grant execute on function public.begin_graph_draft_creation(uuid,text)
  to service_role;
grant execute on function public.bind_graph_draft_immutable_id(uuid,text,text,text)
  to service_role;
grant execute on function public.authorize_graph_draft_send(uuid,text,text)
  to service_role;
grant execute on function public.confirm_graph_sent_item(uuid,text,text,text,text)
  to service_role;
grant execute on function public.finalize_graph_delivery_failure(uuid,text,text,text,text)
  to service_role;
grant execute on function public.emergency_halt_outbound_delivery(text,text)
  to service_role;

-- Postcheck: migration success means OFF, private, indexed, invoker-only RPCs.
do $$
declare
  v_insecure_functions text;
begin
  if not exists (
    select 1 from public.outbound_delivery_control
    where singleton and not master_enabled and
      not transactional_enabled and not cold_enabled and
      minimum_spacing_seconds >= 60 and cold_daily_limit <= 480 and
      operating_timezone = 'Europe/Madrid'
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_postcheck_control_not_fail_closed';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'outbound_delivery_control', 'outbound_daily_usage', 'graph_outbox',
        'graph_outbox_authorizations', 'graph_outbox_events'
      ) and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then
    raise exception using errcode = '42501',
      message = 'graph_outbox_postcheck_rls_not_forced';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.graph_outbox', 'select') or
     pg_catalog.has_table_privilege('authenticated', 'public.graph_outbox', 'select') or
     pg_catalog.has_table_privilege(
       'anon', 'public.graph_outbox_authorizations', 'select'
     ) or pg_catalog.has_table_privilege(
       'authenticated', 'public.graph_outbox_authorizations', 'select'
     ) then
    raise exception using errcode = '42501',
      message = 'graph_outbox_postcheck_public_table_access';
  end if;

  if pg_catalog.has_function_privilege(
       'service_role',
       'public.reserve_cold_mailbox_delivery(text,text,text,text)',
       'execute'
     ) or not pg_catalog.has_function_privilege(
       'service_role',
       'public.reserve_cold_graph_delivery(text,text,text,text,text,text,text,text,text)',
       'execute'
     ) then
    raise exception using errcode = '42501',
      message = 'graph_outbox_postcheck_cold_rpc_boundary';
  end if;

  select pg_catalog.string_agg(p.proname, ', ' order by p.proname)
  into v_insecure_functions
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'apply_campaign_hard_bounce_suppression',
      'register_transactional_graph_outbox',
      'reserve_cold_graph_delivery',
      'begin_graph_draft_creation',
      'bind_graph_draft_immutable_id',
      'authorize_graph_draft_send',
      'confirm_graph_sent_item',
      'finalize_graph_delivery_failure',
      'emergency_halt_outbound_delivery',
      'enforce_graph_outbox_transition',
      'record_graph_outbox_state_event',
      'enforce_campaign_suppression_on_contact',
      'enforce_mailbox_terminal_transition'
    ) and (
      p.prosecdef or
      not coalesce(
        pg_catalog.array_to_string(p.proconfig, ','), ''
      ) like '%search_path=%'
    );
  if v_insecure_functions is not null then
    raise exception using errcode = '42501',
      message = 'graph_outbox_postcheck_insecure_functions',
      detail = v_insecure_functions;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'graph_outbox_mailbox_draft_immutable_idx'
      and indexdef like '%UNIQUE%'
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_postcheck_draft_unique_missing';
  end if;
end;
$$;

commit;

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.mailbox_throttle_state
  add column if not exists last_graph_send_authorized_at timestamptz;
alter table public.mailbox_delivery_reservations
  add column if not exists graph_managed boolean not null default false,
  add column if not exists transactional_dispatch_id uuid;
create table if not exists public.transactional_dispatch_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  submission_id text not null unique
    check (submission_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$'),
  resource text not null check (
    resource in ('calculator', 'interactive_checklist', 'checklist', 'webinar')
  ),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued_off' check (status in (
    'queued_off', 'claimed', 'reserved', 'confirmed_sent',
    'definitive_failed', 'ambiguous_halted', 'deferred'
  )),
  claimed_by uuid,
  claim_expires_at timestamptz,
  attempt integer not null default 0 check (attempt between 0 and 1000),
  reservation_id uuid,
  outcome_evidence_hash text check (
    outcome_evidence_hash is null or outcome_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  terminal_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (
    (status in ('claimed', 'reserved') and claimed_by is not null and
      claim_expires_at is not null) or status not in ('claimed', 'reserved')
  ),
  check (
    (status in ('confirmed_sent', 'definitive_failed', 'ambiguous_halted') and
      outcome_evidence_hash is not null and terminal_at is not null) or
    status not in ('confirmed_sent', 'definitive_failed', 'ambiguous_halted')
  )
);

create or replace function public.claim_transactional_graph_dispatch(
  p_worker_id uuid, p_limit integer, p_lease_seconds integer
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_item public.transactional_dispatch_outbox%rowtype;
  v_outbox public.graph_outbox%rowtype;
  v_authorization public.graph_outbox_authorizations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_dispatch_outcome text;
  v_outcome_evidence_hash text;
  v_now timestamptz;
begin
  if p_worker_id is null or p_limit <> 1 or
     p_lease_seconds not between 30 and 300 then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'invalid_request', 'claimed', 0,
      'recovery_required', false, 'resume_existing_reservation', false,
      'reservation_id', null, 'outbox_state', null,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null,
      'lease_expires_at', null, 'items', '[]'::jsonb
    );
  end if;
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  v_now := pg_catalog.clock_timestamp();
  if not v_control.master_enabled or not v_control.transactional_enabled then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'master_or_lane_disabled',
      'claimed', 0, 'recovery_required', false,
      'resume_existing_reservation', false,
      'reservation_id', null, 'outbox_state', null,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null,
      'lease_expires_at', null, 'items', '[]'::jsonb
    );
  end if;
  select * into v_item from public.transactional_dispatch_outbox
  where status = 'claimed' and claimed_by = p_worker_id
    and claim_expires_at > v_now
  order by created_at, id limit 1 for update;
  v_now := pg_catalog.clock_timestamp();
  if not found then
    select * into v_item from public.transactional_dispatch_outbox
    where status = 'reserved' and reservation_id is not null
      and claim_expires_at <= v_now
    order by created_at, id limit 1 for update skip locked;
    v_now := pg_catalog.clock_timestamp();
    if found and v_item.claim_expires_at <= v_now then
      select * into v_outbox from public.graph_outbox
      where reservation_id = v_item.reservation_id for update;
      if not found then
        return pg_catalog.jsonb_build_object(
          'accepted', false, 'reason_code', 'reserved_recovery_binding_conflict',
          'recovery_required', true, 'resume_existing_reservation', true,
          'reservation_id', v_item.reservation_id, 'outbox_state', null,
          'lease_expires_at', null, 'items', '[]'::jsonb
        );
      end if;
      select * into v_authorization from public.graph_outbox_authorizations
      where reservation_id = v_item.reservation_id for update;
      if not found then
        return pg_catalog.jsonb_build_object(
          'accepted', false, 'reason_code', 'reserved_recovery_binding_conflict',
          'recovery_required', true, 'resume_existing_reservation', true,
          'reservation_id', v_item.reservation_id,
          'outbox_state', v_outbox.state,
          'lease_expires_at', null, 'items', '[]'::jsonb
        );
      end if;
      select * into v_reservation from public.mailbox_delivery_reservations
      where id = v_item.reservation_id for update;
      if not found or not v_reservation.graph_managed or
         v_reservation.transactional_dispatch_id is distinct from v_item.id or
         v_reservation.payload_sha256 <> v_item.payload_sha256 or
         v_outbox.lane <> 'transactional' or
         v_outbox.payload_sha256 <> v_item.payload_sha256 then
        return pg_catalog.jsonb_build_object(
          'accepted', false, 'reason_code', 'reserved_recovery_binding_conflict',
          'recovery_required', true, 'resume_existing_reservation', true,
          'reservation_id', v_item.reservation_id,
          'outbox_state', v_outbox.state,
          'lease_expires_at', null, 'items', '[]'::jsonb
        );
      end if;

      v_dispatch_outcome := case v_outbox.state
        when 'confirmed_sent' then 'confirmed_sent'
        when 'definitive_failed' then 'definitive_failed'
        when 'ambiguous_halted' then 'ambiguous_halted'
        when 'suppressed_before_send' then 'definitive_failed'
        else null
      end;
      v_outcome_evidence_hash := case v_outbox.state
        when 'confirmed_sent' then v_outbox.sent_items_evidence_hash
        when 'definitive_failed' then v_outbox.terminal_evidence_hash
        when 'ambiguous_halted' then v_outbox.terminal_evidence_hash
        when 'suppressed_before_send' then v_outbox.terminal_evidence_hash
        else null
      end;
      if v_outbox.state = 'suppressed_before_send' and
         v_outbox.graph_draft_immutable_id is null and
         v_outcome_evidence_hash is not null and
         v_reservation.status = 'reserved' then
        v_now := pg_catalog.clock_timestamp();
        update public.mailbox_delivery_reservations
        set status = 'failed', finalized_at = v_now,
            failure_code = 'DEFINITIVE_SUPPRESSED', updated_at = v_now
        where id = v_reservation.id and status = 'reserved';
        update public.mailbox_throttle_state
        set active_reservation_id = null, updated_at = v_now
        where mailbox_key_hash = v_outbox.mailbox_key_hash
          and active_reservation_id = v_reservation.id;
        v_reservation.status := 'failed';
      end if;
      if v_dispatch_outcome is not null and
         v_outcome_evidence_hash ~ '^[a-f0-9]{64}$' and (
           (v_outbox.state = 'confirmed_sent' and
             v_reservation.status = 'sent') or
           (v_outbox.state = 'definitive_failed' and
             v_reservation.status = 'failed') or
           (v_outbox.state = 'ambiguous_halted' and
             v_reservation.status = 'reconcile_required') or
           (v_outbox.state = 'suppressed_before_send' and
             v_reservation.status = 'failed' and (
               v_outbox.graph_draft_immutable_id is null or (
                 v_outbox.draft_neutralized_at is not null and
                 v_outbox.neutralization_evidence_hash is not null
               )
             ))
         ) then
        v_now := pg_catalog.clock_timestamp();
        update public.transactional_dispatch_outbox
        set status = v_dispatch_outcome, claimed_by = p_worker_id,
            claim_expires_at = null,
            outcome_evidence_hash = v_outcome_evidence_hash,
            terminal_at = v_now, updated_at = v_now
        where id = v_item.id and status = 'reserved';
        return pg_catalog.jsonb_build_object(
          'accepted', true, 'reason_code', 'terminal_recovered', 'claimed', 0,
          'recovery_required', false, 'resume_existing_reservation', false,
          'reservation_id', v_reservation.id, 'outbox_state', v_outbox.state,
          'outcome', v_outbox.state, 'dispatch_outcome', v_dispatch_outcome,
          'outcome_evidence_hash', v_outcome_evidence_hash,
          'lease_expires_at', null, 'items', '[]'::jsonb
        );
      elsif v_dispatch_outcome is not null and not (
        v_outbox.state = 'suppressed_before_send' and
        v_outbox.graph_draft_immutable_id is not null and
        (v_outbox.draft_neutralized_at is null or
          v_outbox.neutralization_evidence_hash is null)
      ) then
        return pg_catalog.jsonb_build_object(
          'accepted', false, 'reason_code', 'reserved_recovery_binding_conflict',
          'recovery_required', true, 'resume_existing_reservation', true,
          'reservation_id', v_reservation.id, 'outbox_state', v_outbox.state,
          'outcome_evidence_hash', v_outcome_evidence_hash,
          'lease_expires_at', null, 'items', '[]'::jsonb
        );
      end if;

      v_now := pg_catalog.clock_timestamp();
      update public.transactional_dispatch_outbox
      set claimed_by = p_worker_id,
          claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
          attempt = attempt + 1, updated_at = v_now
      where id = v_item.id and status = 'reserved'
      returning * into v_item;
      if not found then
        return pg_catalog.jsonb_build_object(
          'accepted', false, 'reason_code', 'reserved_recovery_lost',
          'recovery_required', true, 'resume_existing_reservation', true,
          'reservation_id', v_reservation.id,
          'outbox_state', v_outbox.state,
          'lease_expires_at', null, 'items', '[]'::jsonb
        );
      end if;
      update public.mailbox_delivery_reservations
      set lease_expires_at = v_item.claim_expires_at, updated_at = v_now
      where id = v_reservation.id and status = 'reserved';
      update public.graph_outbox_authorizations
      set expires_at = least(
        v_item.claim_expires_at, v_now + interval '90 seconds'
      )
      where reservation_id = v_reservation.id and consumed_at is null
        and v_outbox.state in ('reserved', 'draft_creating', 'draft_created');

      return pg_catalog.jsonb_build_object(
        'accepted', true, 'reason_code', 'reserved_recovery', 'claimed', 1,
        'recovery_required', true, 'resume_existing_reservation', true,
        'reservation_id', v_reservation.id, 'outbox_state', v_outbox.state,
        'graph_draft_immutable_id', v_outbox.graph_draft_immutable_id,
        'draft_neutralized', v_outbox.draft_neutralized_at is not null,
        'outcome_evidence_hash', v_outcome_evidence_hash,
        'lease_expires_at', v_item.claim_expires_at,
        'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'dispatch_id', v_item.id, 'submission_id', v_item.submission_id,
          'resource', v_item.resource, 'payload_sha256', v_item.payload_sha256,
          'attempt', v_item.attempt, 'reservation_id', v_reservation.id,
          'outbox_state', v_outbox.state, 'recovery_required', true,
          'resume_existing_reservation', true,
          'graph_draft_immutable_id', v_outbox.graph_draft_immutable_id,
          'draft_neutralized', v_outbox.draft_neutralized_at is not null,
          'outcome_evidence_hash', v_outcome_evidence_hash,
          'lease_expires_at', v_item.claim_expires_at
        ))
      );
    end if;

    select * into v_item from public.transactional_dispatch_outbox
    where status in ('queued_off', 'deferred') or
      (status = 'claimed' and claim_expires_at <= v_now)
    order by created_at, id limit 1 for update skip locked;
    v_now := pg_catalog.clock_timestamp();
    if not found then
      return pg_catalog.jsonb_build_object(
        'accepted', true, 'reason_code', 'empty',
        'claimed', 0, 'recovery_required', false,
        'resume_existing_reservation', false,
        'reservation_id', null, 'outbox_state', null,
        'graph_draft_immutable_id', null, 'draft_neutralized', false,
        'outcome_evidence_hash', null,
        'lease_expires_at', null, 'items', '[]'::jsonb
      );
    end if;
    update public.transactional_dispatch_outbox
    set status = 'claimed', claimed_by = p_worker_id,
        claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
        attempt = attempt + 1, updated_at = v_now
    where id = v_item.id returning * into v_item;
  end if;
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'reason_code', 'claimed', 'claimed', 1,
    'recovery_required', false, 'resume_existing_reservation', false,
    'reservation_id', null, 'outbox_state', null,
    'graph_draft_immutable_id', null, 'draft_neutralized', false,
    'outcome_evidence_hash', null,
    'lease_expires_at', v_item.claim_expires_at,
    'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'dispatch_id', v_item.id, 'submission_id', v_item.submission_id,
      'resource', v_item.resource, 'payload_sha256', v_item.payload_sha256,
      'attempt', v_item.attempt, 'reservation_id', null,
      'outbox_state', null, 'recovery_required', false,
      'resume_existing_reservation', false,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null,
      'lease_expires_at', v_item.claim_expires_at
    ))
  );
end;
$$;

create or replace function public.reserve_claimed_transactional_graph_dispatch(
  p_dispatch_id uuid, p_worker_id uuid, p_mailbox_key_hash text,
  p_finalize_capability_hash text, p_package_hmac_sha256 text,
  p_send_capability_hash text, p_opaque_marker text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_dispatch public.transactional_dispatch_outbox%rowtype;
  v_state public.mailbox_throttle_state%rowtype;
  v_active public.mailbox_delivery_reservations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_hash text;
  v_now timestamptz;
  v_position smallint;
begin
  if p_dispatch_id is null or p_worker_id is null or
     p_mailbox_key_hash !~ '^[a-f0-9]{64}$' or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_package_hmac_sha256 !~ '^[a-f0-9]{64}$' or
     p_send_capability_hash !~ '^[a-f0-9]{64}$' or
     p_opaque_marker !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_dispatch from public.transactional_dispatch_outbox
  where id = p_dispatch_id for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_dispatch.claimed_by is distinct from p_worker_id then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'claim_unavailable'
    );
  end if;
  if v_dispatch.status = 'reserved' and v_dispatch.reservation_id is not null then
    return pg_catalog.jsonb_build_object(
      'authorized', true, 'duplicate', true, 'reason_code', 'reserved',
      'reservation_id', v_dispatch.reservation_id,
      'lease_expires_at', v_dispatch.claim_expires_at
    );
  end if;
  if v_dispatch.status <> 'claimed' or v_dispatch.claim_expires_at <= v_now then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'claim_expired'
    );
  end if;
  if not v_control.master_enabled or not v_control.transactional_enabled then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'master_or_lane_disabled'
    );
  end if;
  select pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(l.payload::text, 'UTF8'), 'sha256'
  ), 'hex') into v_hash
  from public.leads l
  where l.submission_id = v_dispatch.submission_id
    and l.form_type = v_dispatch.resource for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_hash <> v_dispatch.payload_sha256 then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'lead_binding_conflict'
    );
  end if;
  insert into public.mailbox_throttle_state(mailbox_key_hash, next_allowed_at)
  values (p_mailbox_key_hash, v_now) on conflict (mailbox_key_hash) do nothing;
  select * into v_state from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash for update;
  v_now := pg_catalog.clock_timestamp();
  if v_state.blocked_reservation_id is not null then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'reconcile_required'
    );
  end if;
  if v_state.active_reservation_id is not null then
    select * into v_active from public.mailbox_delivery_reservations
    where id = v_state.active_reservation_id for update;
    v_now := pg_catalog.clock_timestamp();
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', case when found and v_active.status = 'reserved' and
        v_active.lease_expires_at > v_now then 'lease_active'
        else 'mailbox_reconcile_required' end,
      'lease_expires_at', case when found then v_active.lease_expires_at else null end
    );
  end if;
  v_position := v_state.batch_reservations_count + 1;
  if v_position not in (1, 2) then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'mailbox_state_invalid'
    );
  end if;
  insert into public.transactional_intake_claims(
    submission_id, resource, payload_sha256, intake_capability_hash,
    pilot_recipient_allowed, claimed_at, capability_expires_at, capability_consumed_at
  ) values (
    v_dispatch.submission_id, v_dispatch.resource, v_dispatch.payload_sha256,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'dispatch:' || v_dispatch.id::text, 'UTF8'
    ), 'sha256'), 'hex'), true, v_now, v_dispatch.claim_expires_at, v_now
  ) on conflict (submission_id) do nothing;
  if not exists (
    select 1 from public.transactional_intake_claims
    where submission_id = v_dispatch.submission_id
      and resource = v_dispatch.resource
      and payload_sha256 = v_dispatch.payload_sha256
  ) then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'intake_binding_conflict'
    );
  end if;
  insert into public.mailbox_delivery_reservations(
    mailbox_key_hash, message_key_hash, payload_sha256, submission_id, resource,
    lane, batch_id, batch_position, status, finalize_capability_hash,
    package_hmac_sha256, reserved_at, lease_expires_at, graph_managed,
    transactional_dispatch_id
  ) values (
    p_mailbox_key_hash,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'transactional:' || v_dispatch.submission_id, 'UTF8'
    ), 'sha256'), 'hex'),
    v_dispatch.payload_sha256, v_dispatch.submission_id, v_dispatch.resource,
    'transactional', v_state.batch_id, v_position, 'reserved',
    p_finalize_capability_hash, p_package_hmac_sha256, v_now,
    v_dispatch.claim_expires_at, true, v_dispatch.id
  ) returning * into v_reservation;
  insert into public.graph_outbox(
    reservation_id, mailbox_key_hash, lane, payload_sha256, opaque_marker,
    quota_reservation_day
  ) values (
    v_reservation.id, p_mailbox_key_hash, 'transactional',
    v_dispatch.payload_sha256, p_opaque_marker,
    (v_now at time zone v_control.operating_timezone)::date
  );
  insert into public.graph_outbox_authorizations(
    reservation_id, send_capability_hash, authorized_at, expires_at
  ) values (
    v_reservation.id, p_send_capability_hash, v_now,
    least(v_dispatch.claim_expires_at, v_now + interval '90 seconds')
  );
  update public.mailbox_throttle_state
  set active_reservation_id = v_reservation.id,
      batch_reservations_count = v_position, updated_at = v_now
  where mailbox_key_hash = p_mailbox_key_hash;
  update public.transactional_dispatch_outbox
  set status = 'reserved', reservation_id = v_reservation.id, updated_at = v_now
  where id = v_dispatch.id;
  return pg_catalog.jsonb_build_object(
    'authorized', true, 'duplicate', false, 'reason_code', 'reserved',
    'reservation_id', v_reservation.id,
    'lease_expires_at', v_reservation.lease_expires_at
  );
exception when unique_violation then
  return pg_catalog.jsonb_build_object(
    'authorized', false, 'duplicate', false, 'reason_code', 'binding_collision'
  );
end;
$$;

create or replace function public.finalize_transactional_graph_dispatch(
  p_dispatch_id uuid, p_worker_id uuid, p_outcome text, p_evidence_hash text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_dispatch public.transactional_dispatch_outbox%rowtype;
  v_outbox public.graph_outbox%rowtype;
  v_dispatch_outcome text;
  v_now timestamptz;
begin
  if p_dispatch_id is null or p_worker_id is null or
     p_outcome not in (
       'confirmed_sent', 'definitive_failed', 'ambiguous_halted',
       'suppressed_before_send', 'deferred'
     ) or p_evidence_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;
  v_dispatch_outcome := case p_outcome
    when 'suppressed_before_send' then 'definitive_failed'
    else p_outcome
  end;
  select * into v_dispatch from public.transactional_dispatch_outbox
  where id = p_dispatch_id for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_dispatch.claimed_by is distinct from p_worker_id then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'dispatch_unavailable'
    );
  end if;
  if p_outcome = 'deferred' then
    if v_dispatch.status = 'deferred' and
       v_dispatch.outcome_evidence_hash is null then
      return pg_catalog.jsonb_build_object(
        'accepted', true, 'duplicate', true, 'reason_code', 'deferred',
        'outcome', 'deferred', 'dispatch_outcome', 'deferred',
        'graph_outbox_state', null
      );
    end if;
    if v_dispatch.status <> 'claimed' or v_dispatch.reservation_id is not null then
      return pg_catalog.jsonb_build_object(
        'accepted', false, 'duplicate', false, 'reason_code', 'state_conflict'
      );
    end if;
    update public.transactional_dispatch_outbox
    set status = 'deferred', claimed_by = null, claim_expires_at = null,
        updated_at = v_now where id = p_dispatch_id;
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', false, 'reason_code', 'deferred',
      'outcome', 'deferred', 'dispatch_outcome', 'deferred',
      'graph_outbox_state', null
    );
  end if;
  if v_dispatch.reservation_id is null or
     v_dispatch.status not in (
       'reserved', 'confirmed_sent', 'definitive_failed', 'ambiguous_halted'
     ) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;
  select * into v_outbox from public.graph_outbox
  where reservation_id = v_dispatch.reservation_id for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_outbox.state <> p_outcome or
     (p_outcome = 'confirmed_sent' and
       v_outbox.sent_items_evidence_hash is distinct from p_evidence_hash) or
     (p_outcome <> 'confirmed_sent' and
       v_outbox.terminal_evidence_hash is distinct from p_evidence_hash) or
     (p_outcome = 'suppressed_before_send' and
       v_outbox.graph_draft_immutable_id is not null and (
         v_outbox.draft_neutralized_at is null or
         v_outbox.neutralization_evidence_hash is null
       )) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false,
      'reason_code', 'graph_terminal_evidence_required'
    );
  end if;
  if v_dispatch.status = v_dispatch_outcome and
     v_dispatch.outcome_evidence_hash = p_evidence_hash then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', true, 'reason_code', p_outcome,
      'outcome', p_outcome, 'dispatch_outcome', v_dispatch_outcome,
      'graph_outbox_state', v_outbox.state
    );
  end if;
  if v_dispatch.status <> 'reserved' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;
  update public.transactional_dispatch_outbox
  set status = v_dispatch_outcome, outcome_evidence_hash = p_evidence_hash,
      terminal_at = v_now, updated_at = v_now where id = p_dispatch_id;
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', p_outcome,
    'outcome', p_outcome, 'dispatch_outcome', v_dispatch_outcome,
    'graph_outbox_state', v_outbox.state
  );
end;
$$;

alter table public.transactional_dispatch_outbox enable row level security;
alter table public.transactional_dispatch_outbox force row level security;
revoke all privileges on table public.transactional_dispatch_outbox
  from public, anon, authenticated;
grant select, insert, update on table public.transactional_dispatch_outbox
  to service_role;
revoke execute on function public.claim_transactional_graph_dispatch(uuid,integer,integer)
  from public, anon, authenticated;
revoke execute on function public.reserve_claimed_transactional_graph_dispatch(
  uuid,uuid,text,text,text,text,text
) from public, anon, authenticated;
revoke execute on function public.finalize_transactional_graph_dispatch(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.claim_transactional_graph_dispatch(uuid,integer,integer)
  to service_role;
grant execute on function public.reserve_claimed_transactional_graph_dispatch(
  uuid,uuid,text,text,text,text,text
) to service_role;
grant execute on function public.finalize_transactional_graph_dispatch(uuid,uuid,text,text)
  to service_role;

commit;
-- Contract correction: durable capture dispatch and Graph-owned authority.
-- Remains fail-closed/OFF; no network or provider operation is performed.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.graph_outbox
  drop constraint if exists graph_outbox_opaque_marker_check;
alter table public.graph_outbox
  add constraint graph_outbox_opaque_marker_check
  check (opaque_marker ~ '^[a-f0-9]{64}$') not valid;
alter table public.graph_outbox
  validate constraint graph_outbox_opaque_marker_check;
create unique index if not exists graph_outbox_marker_casefold_unique_idx
  on public.graph_outbox ((pg_catalog.lower(opaque_marker)));

alter table public.graph_outbox
  add column if not exists draft_neutralized_at timestamptz,
  add column if not exists neutralization_evidence_hash text;
alter table public.graph_outbox
  drop constraint if exists graph_outbox_neutralization_evidence_check;
alter table public.graph_outbox
  add constraint graph_outbox_neutralization_evidence_check check (
    (draft_neutralized_at is null and neutralization_evidence_hash is null) or
    (draft_neutralized_at is not null and
      neutralization_evidence_hash ~ '^[a-f0-9]{64}$')
  ) not valid;
alter table public.graph_outbox
  validate constraint graph_outbox_neutralization_evidence_check;

alter table public.mailbox_throttle_state
  add column if not exists last_graph_send_authorized_at timestamptz;
alter table public.mailbox_delivery_reservations
  add column if not exists graph_managed boolean not null default false,
  add column if not exists transactional_dispatch_id uuid;

create table if not exists public.transactional_dispatch_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  submission_id text not null unique
    check (submission_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$'),
  resource text not null
    check (resource in ('calculator', 'interactive_checklist', 'checklist', 'webinar')),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued_off' check (status in (
    'queued_off', 'claimed', 'reserved', 'confirmed_sent',
    'definitive_failed', 'ambiguous_halted', 'deferred'
  )),
  claimed_by uuid,
  claim_expires_at timestamptz,
  attempt integer not null default 0 check (attempt between 0 and 1000),
  reservation_id uuid,
  outcome_evidence_hash text check (
    outcome_evidence_hash is null or outcome_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  terminal_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (
    (status in ('claimed', 'reserved') and claimed_by is not null and
      claim_expires_at is not null) or status not in ('claimed', 'reserved')
  ),
  check (
    (status in ('confirmed_sent', 'definitive_failed', 'ambiguous_halted') and
      outcome_evidence_hash is not null and terminal_at is not null) or
    status not in ('confirmed_sent', 'definitive_failed', 'ambiguous_halted')
  )
);
alter table public.transactional_dispatch_outbox
  add constraint transactional_dispatch_reservation_fk
  foreign key (reservation_id) references public.mailbox_delivery_reservations(id)
  on delete restrict;
alter table public.mailbox_delivery_reservations
  add constraint mailbox_transactional_dispatch_fk
  foreign key (transactional_dispatch_id)
  references public.transactional_dispatch_outbox(id) on delete restrict;
create unique index mailbox_transactional_dispatch_unique_idx
  on public.mailbox_delivery_reservations(transactional_dispatch_id)
  where transactional_dispatch_id is not null;
create index transactional_dispatch_claim_idx
  on public.transactional_dispatch_outbox(status, claim_expires_at, created_at);
create index transactional_dispatch_reservation_idx
  on public.transactional_dispatch_outbox(reservation_id)
  where reservation_id is not null;

create or replace function public.enqueue_transactional_graph_dispatch()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_hash text;
  v_existing public.transactional_dispatch_outbox%rowtype;
begin
  if new.form_type not in (
    'calculator', 'interactive_checklist', 'checklist', 'webinar'
  ) then return new; end if;
  if new.submission_id is null or
     new.submission_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' then
    raise exception using errcode = '23514', message = 'dispatch_submission_invalid';
  end if;
  v_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(new.payload::text, 'UTF8'), 'sha256'
  ), 'hex');
  insert into public.transactional_dispatch_outbox(
    submission_id, resource, payload_sha256, status
  ) values (new.submission_id, new.form_type, v_hash, 'queued_off')
  on conflict (submission_id) do nothing;
  select * into strict v_existing from public.transactional_dispatch_outbox
  where submission_id = new.submission_id;
  if v_existing.resource <> new.form_type or v_existing.payload_sha256 <> v_hash then
    raise exception using errcode = '23505', message = 'dispatch_submission_collision';
  end if;
  return new;
end;
$$;
drop trigger if exists leads_transactional_graph_dispatch on public.leads;
create trigger leads_transactional_graph_dispatch after insert on public.leads
for each row execute function public.enqueue_transactional_graph_dispatch();

-- Backfill only still-pending captures so historical confirmed E2E rows cannot
-- become sendable. Existing rows remain queued while both DB controls are OFF.
insert into public.transactional_dispatch_outbox(
  submission_id, resource, payload_sha256, status
)
select l.submission_id, l.form_type,
  pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(l.payload::text, 'UTF8'), 'sha256'
  ), 'hex'),
  'queued_off'
from public.leads l
where l.form_type in ('calculator', 'interactive_checklist', 'checklist', 'webinar')
  and l.submission_id is not null
  and l.delivery_status = 'captured'
  and l.email_delivery_status = 'pending'
on conflict (submission_id) do nothing;

do $$
begin
  if exists (
    select 1 from public.leads l
    join public.transactional_dispatch_outbox d using (submission_id)
    where l.delivery_status = 'captured'
      and l.email_delivery_status = 'pending'
      and (d.resource <> l.form_type or d.payload_sha256 <>
        pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(l.payload::text, 'UTF8'), 'sha256'
        ), 'hex'))
  ) then
    raise exception using errcode = '23505',
      message = 'dispatch_backfill_collision';
  end if;
end;
$$;

create or replace function public.enforce_transactional_pilot_reservation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.lane <> 'transactional' or new.graph_managed then return new; end if;
  perform 1 from public.mailbox_throttle_state
  where mailbox_key_hash = new.mailbox_key_hash for update;
  if not found then
    raise exception using errcode = '23514', message = 'mailbox_state_unavailable';
  end if;
  if exists (
    select 1 from public.mailbox_delivery_reservations
    where mailbox_key_hash = new.mailbox_key_hash and lane = 'transactional'
      and resource = new.resource and not graph_managed
  ) then
    raise exception using errcode = '23514', message = 'pilot_resource_quota_reached';
  end if;
  if (select pg_catalog.count(*) from public.mailbox_delivery_reservations
      where mailbox_key_hash = new.mailbox_key_hash and lane = 'transactional'
        and not graph_managed) >= 4 then
    raise exception using errcode = '23514', message = 'pilot_mailbox_quota_reached';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_mailbox_terminal_transition()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare v_outbox public.graph_outbox%rowtype;
begin
  if new.status not in ('sent', 'failed') or new.status = old.status then
    return new;
  end if;
  select * into v_outbox from public.graph_outbox where reservation_id = old.id;
  if found or old.graph_managed or new.graph_managed then
    if not found or
       (new.status = 'sent' and (
         v_outbox.state <> 'confirmed_sent' or
         v_outbox.sent_items_evidence_hash is null or
         v_outbox.internet_message_id_hash is null
       )) or
       (new.status = 'failed' and (
         v_outbox.state not in ('definitive_failed', 'suppressed_before_send') or
         v_outbox.terminal_evidence_hash is null or
         (v_outbox.state = 'suppressed_before_send' and
          v_outbox.neutralization_evidence_hash is null)
       )) then
      raise exception using errcode = '23514',
        message = 'graph_outbox_terminal_evidence_required';
    end if;
    return new;
  end if;
  if old.status = 'reserved' and
     old.lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '23514',
      message = 'lease_expired_requires_reconcile';
  end if;
  return new;
end;
$$;

do $$
begin
  if pg_catalog.to_regprocedure(
    'public.finalize_transactional_mailbox_delivery_legacy_20260818(text,text,text,text,text)'
  ) is null then
    alter function public.finalize_transactional_mailbox_delivery(text,text,text,text,text)
      rename to finalize_transactional_mailbox_delivery_legacy_20260818;
  end if;
  if pg_catalog.to_regprocedure(
    'public.reconcile_transactional_mailbox_delivery_legacy_20260818(uuid,text,text,text)'
  ) is null then
    alter function public.reconcile_transactional_mailbox_delivery(uuid,text,text,text)
      rename to reconcile_transactional_mailbox_delivery_legacy_20260818;
  end if;
end;
$$;

create or replace function public.finalize_transactional_mailbox_delivery(
  p_mailbox_key_hash text, p_finalize_capability_hash text, p_state text,
  p_provider_message_hash text, p_failure_code text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.mailbox_delivery_reservations
    where mailbox_key_hash = p_mailbox_key_hash
      and finalize_capability_hash = p_finalize_capability_hash and graph_managed
  ) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'graph_managed'
    );
  end if;
  return public.finalize_transactional_mailbox_delivery_legacy_20260818(
    p_mailbox_key_hash, p_finalize_capability_hash, p_state,
    p_provider_message_hash, p_failure_code
  );
end;
$$;

create or replace function public.reconcile_transactional_mailbox_delivery(
  p_reservation_id uuid, p_resolution text, p_provider_message_hash text,
  p_evidence_hash text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.mailbox_delivery_reservations
    where id = p_reservation_id and graph_managed
  ) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'graph_managed',
      'mailbox_halted', true
    );
  end if;
  return public.reconcile_transactional_mailbox_delivery_legacy_20260818(
    p_reservation_id, p_resolution, p_provider_message_hash, p_evidence_hash
  );
end;
$$;

commit;
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create or replace function public.mark_graph_managed_reservation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.mailbox_delivery_reservations
  set graph_managed = true, updated_at = pg_catalog.clock_timestamp()
  where id = new.reservation_id and not graph_managed;
  return new;
end;
$$;
drop trigger if exists graph_outbox_mark_reservation on public.graph_outbox;
create trigger graph_outbox_mark_reservation
after insert on public.graph_outbox for each row
execute function public.mark_graph_managed_reservation();
update public.mailbox_delivery_reservations r set graph_managed = true
where exists (
  select 1 from public.graph_outbox o where o.reservation_id = r.id
) and not r.graph_managed;

create or replace function public.confirm_graph_draft_neutralized(
  p_reservation_id uuid, p_finalize_capability_hash text,
  p_graph_draft_immutable_id text, p_neutralization_evidence_hash text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_outbox public.graph_outbox%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_now timestamptz;
begin
  if p_reservation_id is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_graph_draft_immutable_id is null or
     p_neutralization_evidence_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;
  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id
    and finalize_capability_hash = p_finalize_capability_hash for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_outbox.state <> 'suppressed_before_send' or
     v_outbox.graph_draft_immutable_id <>
       p_graph_draft_immutable_id collate "C" then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_or_id_conflict'
    );
  end if;
  if v_outbox.neutralization_evidence_hash = p_neutralization_evidence_hash and
     v_reservation.status = 'failed' then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', true, 'reason_code', 'draft_neutralized'
    );
  end if;
  update public.graph_outbox
  set neutralization_evidence_hash = p_neutralization_evidence_hash,
      draft_neutralized_at = v_now, updated_at = v_now
  where reservation_id = p_reservation_id;
  update public.mailbox_delivery_reservations
  set status = 'failed', finalized_at = v_now,
      failure_code = 'DEFINITIVE_SUPPRESSED', updated_at = v_now
  where id = p_reservation_id;
  update public.mailbox_throttle_state
  set active_reservation_id = null, updated_at = v_now
  where mailbox_key_hash = v_outbox.mailbox_key_hash
    and active_reservation_id = p_reservation_id;
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', 'draft_neutralized'
  );
end;
$$;

drop function if exists public.authorize_graph_draft_send(uuid,text,text);
create or replace function public.authorize_graph_draft_send(
  p_reservation_id uuid, p_send_capability_hash text,
  p_stop_snapshot_hash text, p_observed_change_key_hash text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_outbox public.graph_outbox%rowtype;
  v_authorization public.graph_outbox_authorizations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_mailbox public.mailbox_throttle_state%rowtype;
  v_usage public.outbound_daily_usage%rowtype;
  v_now timestamptz;
  v_today date;
  v_stopped boolean := false;
begin
  if p_reservation_id is null or
     p_send_capability_hash !~ '^[a-f0-9]{64}$' or
     p_stop_snapshot_hash !~ '^[a-f0-9]{64}$' or
     p_observed_change_key_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'outbox_unavailable'
    );
  end if;
  select * into v_authorization from public.graph_outbox_authorizations
  where reservation_id = p_reservation_id
    and send_capability_hash = p_send_capability_hash for update;
  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id for update;
  select * into v_mailbox from public.mailbox_throttle_state
  where mailbox_key_hash = v_outbox.mailbox_key_hash for update;
  v_now := pg_catalog.clock_timestamp();

  if v_outbox.state = 'send_submitted' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', true, 'reason_code', 'replay_blocked'
    );
  end if;
  if v_outbox.state <> 'draft_created' or
     v_reservation.status <> 'reserved' or not v_reservation.graph_managed then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;
  if v_outbox.graph_change_key_hash is distinct from p_observed_change_key_hash then
    update public.graph_outbox set state = 'ambiguous_halted',
      failure_code = 'AMBIGUOUS_CHANGE_KEY_MISMATCH',
      terminal_evidence_hash = p_stop_snapshot_hash, terminal_at = v_now,
      updated_at = v_now where reservation_id = p_reservation_id;
    update public.mailbox_delivery_reservations set status = 'reconcile_required',
      finalized_at = v_now, failure_code = 'AMBIGUOUS_CHANGE_KEY_MISMATCH',
      updated_at = v_now where id = p_reservation_id;
    update public.mailbox_throttle_state set active_reservation_id = null,
      blocked_reservation_id = p_reservation_id, updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', 'change_key_mismatch_ambiguous_halted'
    );
  end if;

  v_stopped := not v_control.master_enabled or
    (v_outbox.lane = 'cold' and not v_control.cold_enabled) or
    (v_outbox.lane = 'transactional' and not v_control.transactional_enabled);
  if v_outbox.lane = 'cold' and not v_stopped then
    v_stopped := exists (
      select 1
      from public.campaign_contacts cc
      join public.campaign_executions ce
        on ce.id = v_outbox.campaign_execution_id
      join public.campaigns c on c.id = v_outbox.campaign_id
      where cc.id = v_outbox.campaign_contact_id and (
        not c.is_active or c.status not in ('active', 'running', 'pilot') or
        ce.status <> 'planned' or ce.channel <> 'email' or
        cc.suppression_scope <> 'none' or cc.marketing_lane <> 'cold' or
        cc.cold_sequence_status not in ('pending', 'active') or
        exists (select 1 from public.campaign_suppressions s
          where s.identity_hash = cc.email_hash)
      )
    );
  end if;
  if v_stopped then
    update public.graph_outbox set state = 'suppressed_before_send',
      failure_code = 'DEFINITIVE_SUPPRESSED',
      terminal_evidence_hash = p_stop_snapshot_hash, terminal_at = v_now,
      updated_at = v_now where reservation_id = p_reservation_id;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', 'draft_neutralization_required',
      'reservation_id', p_reservation_id
    );
  end if;

  if v_authorization.consumed_at is not null or
     v_authorization.expires_at <= v_now or
     v_reservation.lease_expires_at <= v_now then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', 'authorization_or_lease_expired'
    );
  end if;
  if v_mailbox.last_graph_send_authorized_at is not null and
     v_now < v_mailbox.last_graph_send_authorized_at +
       pg_catalog.make_interval(secs => v_control.minimum_spacing_seconds) then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'send_cadence',
      'retry_after_seconds', greatest(1, pg_catalog.ceil(
        extract(epoch from (
          v_mailbox.last_graph_send_authorized_at +
          pg_catalog.make_interval(secs => v_control.minimum_spacing_seconds) - v_now
        ))
      ))::integer
    );
  end if;

  v_today := (v_now at time zone v_control.operating_timezone)::date;
  insert into public.outbound_daily_usage(
    mailbox_key_hash, local_day, lane, send_submitted_count
  ) values (v_outbox.mailbox_key_hash, v_today, v_outbox.lane, 0)
  on conflict (mailbox_key_hash, local_day, lane) do nothing;
  select * into v_usage from public.outbound_daily_usage
  where mailbox_key_hash = v_outbox.mailbox_key_hash
    and local_day = v_today and lane = v_outbox.lane for update;
  v_now := pg_catalog.clock_timestamp();
  v_today := (v_now at time zone v_control.operating_timezone)::date;
  if v_usage.local_day <> v_today then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'day_boundary_retry'
    );
  end if;
  if v_outbox.lane = 'cold' and
     v_usage.send_submitted_count >= v_control.cold_daily_limit then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'daily_limit'
    );
  end if;

  update public.graph_outbox_authorizations
  set consumed_at = v_now, second_stop_checked_at = v_now,
      stop_snapshot_hash = p_stop_snapshot_hash
  where reservation_id = p_reservation_id;
  update public.graph_outbox
  set state = 'send_submitted', send_submitted_at = v_now,
      quota_send_day = v_today, updated_at = v_now
  where reservation_id = p_reservation_id;
  update public.outbound_daily_usage
  set send_submitted_count = send_submitted_count + 1, updated_at = v_now
  where mailbox_key_hash = v_outbox.mailbox_key_hash
    and local_day = v_today and lane = v_outbox.lane;
  update public.mailbox_throttle_state
  set last_graph_send_authorized_at = v_now, updated_at = v_now
  where mailbox_key_hash = v_outbox.mailbox_key_hash;
  return pg_catalog.jsonb_build_object(
    'authorized', true, 'duplicate', false, 'reason_code', 'send_submitted',
    'reservation_id', p_reservation_id,
    'graph_draft_immutable_id', v_outbox.graph_draft_immutable_id,
    'opaque_marker', v_outbox.opaque_marker
  );
end;
$$;

revoke execute on function public.mark_graph_managed_reservation()
  from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_transactional_graph_dispatch()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_transactional_pilot_reservation()
  from public, anon, authenticated, service_role;
revoke execute on function public.finalize_transactional_mailbox_delivery(
  text,text,text,text,text
) from public, anon, authenticated;
revoke execute on function public.reconcile_transactional_mailbox_delivery(
  uuid,text,text,text
) from public, anon, authenticated;
revoke execute on function public.confirm_graph_draft_neutralized(uuid,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.authorize_graph_draft_send(uuid,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.finalize_transactional_mailbox_delivery_legacy_20260818(
  text,text,text,text,text
) from public, anon, authenticated, service_role;
revoke execute on function public.reconcile_transactional_mailbox_delivery_legacy_20260818(
  uuid,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.confirm_graph_draft_neutralized(uuid,text,text,text)
  to service_role;
grant execute on function public.authorize_graph_draft_send(uuid,text,text,text)
  to service_role;
grant execute on function public.finalize_transactional_mailbox_delivery(
  text,text,text,text,text
) to service_role;
grant execute on function public.reconcile_transactional_mailbox_delivery(
  uuid,text,text,text
) to service_role;

commit;
-- Server-side dashboard aggregates, bounded samples and application RBAC.
-- Additive and fail-closed. It does not enable outbound capabilities.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create table public.dashboard_principals (
  actor_hash text primary key check (actor_hash ~ '^[a-f0-9]{64}$'),
  role text not null check (role in ('admin', 'operator', 'auditor', 'read_only')),
  is_active boolean not null default true,
  granted_by_hash text check (
    granted_by_hash is null or granted_by_hash ~ '^[a-f0-9]{64}$'
  ),
  granted_at timestamptz not null default pg_catalog.clock_timestamp(),
  revoked_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check ((is_active and revoked_at is null) or (not is_active and revoked_at is not null))
);

create table public.dashboard_audit_log (
  id bigint generated always as identity primary key,
  request_id text not null check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$'),
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  actor_role text not null check (
    actor_role in ('admin', 'operator', 'auditor', 'read_only')
  ),
  action text not null check (
    action in ('summary_read', 'sample_read', 'audit_read', 'export_requested')
  ),
  scope jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(scope) = 'object'),
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint dashboard_audit_log_request_action_key unique (request_id, action),
  constraint dashboard_audit_log_scope_no_pii check (not (scope ?| array[
    'email', 'name', 'phone', 'company', 'address', 'ip', 'payload', 'message',
    'graph_draft_immutable_id', 'internet_message_id'
  ]))
);

create index dashboard_audit_log_actor_time_idx
  on public.dashboard_audit_log (actor_hash, occurred_at desc);
create index dashboard_audit_log_action_time_idx
  on public.dashboard_audit_log (action, occurred_at desc);

alter table public.dashboard_principals enable row level security;
alter table public.dashboard_principals force row level security;
alter table public.dashboard_audit_log enable row level security;
alter table public.dashboard_audit_log force row level security;

revoke all privileges on table public.dashboard_principals
  from public, anon, authenticated, service_role;
revoke all privileges on table public.dashboard_audit_log
  from public, anon, authenticated, service_role;

create or replace function public.dashboard_require_role(
  p_actor_hash text, p_allowed_roles text[]
) returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
begin
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_allowed_roles is null or pg_catalog.cardinality(p_allowed_roles) = 0 or
     exists (
       select 1 from pg_catalog.unnest(p_allowed_roles) allowed(role)
       where role not in ('admin', 'operator', 'auditor', 'read_only')
     ) then
    raise exception using errcode = '22023', message = 'dashboard_invalid_authorization';
  end if;

  select role into v_role
  from public.dashboard_principals
  where actor_hash = p_actor_hash and is_active and revoked_at is null;

  if not found or v_role <> all(p_allowed_roles) then
    raise exception using errcode = '42501', message = 'dashboard_access_denied';
  end if;
  return v_role;
end;
$$;

create or replace function public.prevent_dashboard_audit_mutation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'dashboard_audit_is_append_only';
end;
$$;

create trigger dashboard_audit_append_only
before update or delete on public.dashboard_audit_log
for each row execute function public.prevent_dashboard_audit_mutation();
create or replace function public.dashboard_get_summary(
  p_actor_hash text, p_request_id text,
  p_from timestamptz, p_to timestamptz, p_campaign_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_result jsonb;
begin
  if p_request_id is null or
     p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$' or
     p_from is null or p_to is null or p_from >= p_to or
     p_to > v_now + interval '5 minutes' or
     p_to - p_from > interval '366 days' then
    raise exception using errcode = '22023', message = 'dashboard_invalid_window';
  end if;
  v_role := public.dashboard_require_role(
    p_actor_hash, array['admin', 'operator', 'auditor', 'read_only']
  );

  insert into public.dashboard_audit_log(
    request_id, actor_hash, actor_role, action, scope
  ) values (
    p_request_id, p_actor_hash, v_role, 'summary_read',
    pg_catalog.jsonb_build_object(
      'from', p_from, 'to', p_to, 'campaign_scoped', p_campaign_id is not null
    )
  ) on conflict (request_id, action) do nothing;

  with
  lead_base as materialized (
    select lead_magnet, lead_classification, lead_score
    from public.leads where created_at >= p_from and created_at < p_to
  ),
  event_base as materialized (
    select event_name, anonymous_id, session_id, lead_magnet, context, occurred_at
    from public.events where occurred_at >= p_from and occurred_at < p_to
  ),
  campaign_contact_base as materialized (
    select lot, current_step, marketing_lane, suppression_scope, deal_value,
      hubspot_sync_status, hubspot_contact_id, lock_expires_at,
      opportunity_created_at
    from public.campaign_contacts
    where created_at >= p_from and created_at < p_to
      and (p_campaign_id is null or campaign_id = p_campaign_id)
  ),
  campaign_event_base as materialized (
    select ce.event_name
    from public.campaign_events ce
    where ce.occurred_at >= p_from and ce.occurred_at < p_to
      and (p_campaign_id is null or ce.campaign_id = p_campaign_id)
  ),
  campaign_execution_base as materialized (
    select ce.status
    from public.campaign_executions ce
    where ce.created_at >= p_from and ce.created_at < p_to
      and (p_campaign_id is null or ce.campaign_id = p_campaign_id)
  )
  select pg_catalog.jsonb_build_object(
    'meta', pg_catalog.jsonb_build_object(
      'role', v_role, 'generated_at', v_now, 'from', p_from, 'to', p_to,
      'campaign_id', p_campaign_id, 'freshness_target_seconds', 60,
      'aggregate_complete', true, 'pii_included', false
    ),
    'funnel', pg_catalog.jsonb_build_object(
      'leads', (select count(*) from lead_base),
      'by_magnet', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select coalesce(lead_magnet, 'unknown') k, count(*) n
          from lead_base group by 1) grouped), '{}'::jsonb),
      'by_classification', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select coalesce(lead_classification, 'unknown') k, count(*) n
          from lead_base group by 1) grouped), '{}'::jsonb),
      'by_score_band', pg_catalog.jsonb_build_object(
        '0_39', (select count(*) from lead_base where lead_score between 0 and 39),
        '40_59', (select count(*) from lead_base where lead_score between 40 and 59),
        '60_79', (select count(*) from lead_base where lead_score between 60 and 79),
        '80_plus', (select count(*) from lead_base where lead_score >= 80)
      ),
      'events_by_name', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select event_name k, count(*) n from event_base group by 1) grouped),
        '{}'::jsonb)
    ),
    'journey', pg_catalog.jsonb_build_object(
      'events', (select count(*) from event_base),
      'unique_visitors', (select count(distinct anonymous_id) from event_base),
      'unique_sessions', (select count(distinct session_id) from event_base),
      'consented_events', (select count(*) from event_base
        where context ->> 'consent_state' = 'accepted'),
      'latest_event_at', (select max(occurred_at) from event_base),
      'by_magnet', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select coalesce(lead_magnet, 'unknown') k, count(*) n
          from event_base group by 1) grouped), '{}'::jsonb)
    ),
    'transactional', pg_catalog.jsonb_build_object(
      'dispatch_by_status', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select status k, count(*) n from public.transactional_dispatch_outbox
          where created_at >= p_from and created_at < p_to group by status) grouped),
        '{}'::jsonb),
      'graph_by_state', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select state k, count(*) n from public.graph_outbox
          where lane = 'transactional' and created_at >= p_from and created_at < p_to
          group by state) grouped), '{}'::jsonb),
      'reservations_by_status', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select status k, count(*) n from public.mailbox_delivery_reservations
          where lane = 'transactional' and reserved_at >= p_from and reserved_at < p_to
          group by status) grouped), '{}'::jsonb),
      'tx_events_by_name', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select event_name k, count(*) n from public.transactional_email_events
          where occurred_at >= p_from and occurred_at < p_to group by event_name) grouped),
        '{}'::jsonb),
      'claims_total', (select count(*) from public.transactional_intake_claims
        where claimed_at >= p_from and claimed_at < p_to),
      'claims_unconsumed', (select count(*) from public.transactional_intake_claims
        where claimed_at >= p_from and claimed_at < p_to
          and capability_consumed_at is null)
    ),
    'campaign', pg_catalog.jsonb_build_object(
      'contacts', (select count(*) from campaign_contact_base),
      'by_lane', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select marketing_lane k, count(*) n from campaign_contact_base group by 1) grouped),
        '{}'::jsonb),
      'by_lot', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select lot k, count(*) n from campaign_contact_base group by 1) grouped), '{}'::jsonb),
      'by_step', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select current_step::text k, count(*) n from campaign_contact_base group by 1) grouped),
        '{}'::jsonb),
      'events_by_name', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select event_name k, count(*) n from campaign_event_base group by 1) grouped),
        '{}'::jsonb),
      'executions_by_status', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select status k, count(*) n from campaign_execution_base group by 1) grouped),
        '{}'::jsonb),
      'pipeline_value', (select coalesce(sum(deal_value), 0)
        from campaign_contact_base where opportunity_created_at is not null),
      'hubspot_unlinked', (select count(*) from campaign_contact_base
        where hubspot_contact_id is null or hubspot_sync_status <> 'synced'),
      'suppressed', (select count(*) from campaign_contact_base
        where suppression_scope <> 'none')
    ),
    'health', pg_catalog.jsonb_build_object(
      'queue_by_status', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select status k, count(*) n from public.delivery_queue
          where created_at >= p_from and created_at < p_to group by status) grouped),
        '{}'::jsonb),
      'expired_contact_locks', (select count(*) from campaign_contact_base
        where lock_expires_at <= v_now),
      'expired_reservation_leases', (select count(*)
        from public.mailbox_delivery_reservations
        where status = 'reserved' and lease_expires_at <= v_now),
      'mailboxes_active', (select count(*) from public.mailbox_throttle_state
        where active_reservation_id is not null),
      'mailboxes_blocked', (select count(*) from public.mailbox_throttle_state
        where blocked_reservation_id is not null),
      'outbox_ambiguous', (select count(*) from public.graph_outbox
        where state = 'ambiguous_halted'),
      'outbox_in_flight', (select count(*) from public.graph_outbox
        where state in ('draft_creating', 'draft_created', 'send_submitted')),
      'control', (select pg_catalog.jsonb_build_object(
        'master_enabled', master_enabled,
        'transactional_enabled', transactional_enabled,
        'cold_enabled', cold_enabled,
        'minimum_spacing_seconds', minimum_spacing_seconds,
        'cold_daily_limit', cold_daily_limit,
        'operating_timezone', operating_timezone,
        'updated_at', updated_at
      ) from public.outbound_delivery_control where singleton)
    )
  ) into v_result;

  return v_result;
end;
$$;
create or replace function public.dashboard_get_sample(
  p_actor_hash text, p_request_id text, p_dataset text,
  p_from timestamptz, p_to timestamptz, p_offset integer, p_limit integer
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_limit integer;
  v_total bigint;
  v_rows jsonb := '[]'::jsonb;
begin
  if p_request_id is null or
     p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$' or
     p_dataset not in (
       'leads', 'events', 'reservations', 'transactional_events',
       'campaign_executions', 'graph_events', 'audit'
     ) or p_from is null or p_to is null or p_from >= p_to or
     p_to > v_now + interval '5 minutes' or
     p_to - p_from > interval '366 days' or
     p_offset is null or p_offset < 0 or p_offset > 100000 or
     p_limit is null or p_limit < 1 then
    raise exception using errcode = '22023', message = 'dashboard_invalid_sample_request';
  end if;
  v_role := public.dashboard_require_role(
    p_actor_hash, array['admin', 'operator', 'auditor']
  );
  if (p_dataset in ('leads', 'events', 'audit') and
      v_role not in ('admin', 'auditor')) then
    raise exception using errcode = '42501', message = 'dashboard_dataset_access_denied';
  end if;
  v_limit := least(
    p_limit, case when v_role in ('admin', 'operator') then 100 else 50 end
  );

  insert into public.dashboard_audit_log(
    request_id, actor_hash, actor_role, action, scope
  ) values (
    p_request_id, p_actor_hash, v_role,
    case when p_dataset = 'audit' then 'audit_read' else 'sample_read' end,
    pg_catalog.jsonb_build_object(
      'dataset', p_dataset, 'from', p_from, 'to', p_to,
      'offset', p_offset, 'limit', v_limit
    )
  ) on conflict (request_id, action) do nothing;

  case p_dataset
    when 'leads' then
      select count(*) into v_total from public.leads
      where created_at >= p_from and created_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'id', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(id::text, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'lead_magnet', lead_magnet, 'lead_classification', lead_classification,
          'lead_score', lead_score, 'delivery_status', delivery_status,
          'email_delivery_status', email_delivery_status, 'created_at', created_at
        ) row_data
        from public.leads
        where created_at >= p_from and created_at < p_to
        order by created_at desc, id desc offset p_offset limit v_limit
      ) sample;
    when 'events' then
      select count(*) into v_total from public.events
      where occurred_at >= p_from and occurred_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'id', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(id::text, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'event_name', event_name, 'lead_magnet', lead_magnet,
          'consent_state', context ->> 'consent_state', 'occurred_at', occurred_at
        ) row_data
        from public.events
        where occurred_at >= p_from and occurred_at < p_to
        order by occurred_at desc, id desc offset p_offset limit v_limit
      ) sample;
    when 'reservations' then
      select count(*) into v_total from public.mailbox_delivery_reservations
      where reserved_at >= p_from and reserved_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'id', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(id::text, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'lane', lane, 'resource', resource, 'status', status,
          'reserved_at', reserved_at, 'lease_expires_at', lease_expires_at,
          'finalized_at', finalized_at, 'failure_code', failure_code
        ) row_data
        from public.mailbox_delivery_reservations
        where reserved_at >= p_from and reserved_at < p_to
        order by reserved_at desc, id desc offset p_offset limit v_limit
      ) sample;
    when 'transactional_events' then
      select count(*) into v_total from public.transactional_email_events
      where occurred_at >= p_from and occurred_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'id', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(id::text, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'submission', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(submission_id, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'event_name', event_name, 'occurred_at', occurred_at,
          'failure_code', failure_code,
          'provider_evidence_present', provider_message_hash is not null
        ) row_data
        from public.transactional_email_events
        where occurred_at >= p_from and occurred_at < p_to
        order by occurred_at desc, id desc offset p_offset limit v_limit
      ) sample;
    when 'campaign_executions' then
      select count(*) into v_total from public.campaign_executions
      where created_at >= p_from and created_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'id', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(id::text, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'channel', channel, 'step', step,
          'status', status, 'scheduled_for', scheduled_for,
          'actual_at', actual_at, 'failure_code', failure_code
        ) row_data
        from public.campaign_executions
        where created_at >= p_from and created_at < p_to
        order by created_at desc, id desc offset p_offset limit v_limit
      ) sample;
    when 'graph_events' then
      select count(*) into v_total from public.graph_outbox_events
      where occurred_at >= p_from and occurred_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'reservation', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(reservation_id::text, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'state', state, 'occurred_at', occurred_at,
          'evidence_present', evidence_hash is not null
        ) row_data
        from public.graph_outbox_events
        where occurred_at >= p_from and occurred_at < p_to
        order by occurred_at desc, id desc offset p_offset limit v_limit
      ) sample;
    when 'audit' then
      select count(*) into v_total from public.dashboard_audit_log
      where occurred_at >= p_from and occurred_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'request_id', request_id,
          'actor', substring(actor_hash from 1 for 16),
          'actor_role', actor_role, 'action', action,
          'scope', scope, 'occurred_at', occurred_at
        ) row_data
        from public.dashboard_audit_log
        where occurred_at >= p_from and occurred_at < p_to
        order by occurred_at desc, id desc offset p_offset limit v_limit
      ) sample;
  end case;

  return pg_catalog.jsonb_build_object(
    'dataset', p_dataset, 'role', v_role, 'offset', p_offset,
    'limit', v_limit, 'total', v_total,
    'has_more', p_offset + pg_catalog.jsonb_array_length(v_rows) < v_total,
    'pii_included', false, 'rows', v_rows
  );
end;
$$;

revoke execute on function public.dashboard_require_role(text,text[])
  from public, anon, authenticated, service_role;
revoke execute on function public.prevent_dashboard_audit_mutation()
  from public, anon, authenticated, service_role;
revoke execute on function public.dashboard_get_summary(
  text,text,timestamptz,timestamptz,uuid
) from public, anon, authenticated;
revoke execute on function public.dashboard_get_sample(
  text,text,text,timestamptz,timestamptz,integer,integer
) from public, anon, authenticated;
grant execute on function public.dashboard_get_summary(
  text,text,timestamptz,timestamptz,uuid
) to service_role;
grant execute on function public.dashboard_get_sample(
  text,text,text,timestamptz,timestamptz,integer,integer
) to service_role;

commit;


-- 20260819155300_cold_campaign_hmac_identity.sql
-- Private cold-campaign identity guard and adaptive repair for environments
-- where the later provisioning migration was already applied.
begin;

set local search_path='';

create schema if not exists fundae_private;
revoke all on schema fundae_private from public,anon,authenticated,service_role;

-- HMAC_IDENTITY_HELPER_BEGIN
create or replace function fundae_private.is_cold_campaign_hmac_identity(
  p_email text,
  p_identity_hash text
) returns boolean
language sql
immutable
parallel safe
set search_path=''
as $$
  select coalesce(
    p_email is not null
    and p_identity_hash ~ '^[a-f0-9]{64}$'
    and p_identity_hash <> pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(p_email)),'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    false
  );
$$;
-- HMAC_IDENTITY_HELPER_END

revoke all on function fundae_private.is_cold_campaign_hmac_identity(text,text)
  from public,anon,authenticated,service_role;

do $$
declare
  v_signature constant text := 'public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb)';
  v_function regprocedure := pg_catalog.to_regprocedure(v_signature);
  v_definition text;
  v_patched_definition text;
  v_legacy_predicate constant text := $legacy$pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.lower(v_row->>'email'),'UTF8'),'sha256'),'hex')<>v_row->>'email_hash'$legacy$;
  v_hmac_predicate constant text := $hmac$not fundae_private.is_cold_campaign_hmac_identity(v_row->>'email',v_row->>'email_hash')$hmac$;
  v_occurrences integer;
  v_security_definer boolean;
  v_config text[];
begin
  -- Fresh databases reach this migration before the provisioning function exists.
  if v_function is null then
    return;
  end if;

  select pg_catalog.pg_get_functiondef(p.oid),p.prosecdef,p.proconfig
  into strict v_definition,v_security_definer,v_config
  from pg_catalog.pg_proc p
  where p.oid=v_function;

  if not v_security_definer or not coalesce(
    v_config @> array['search_path=""']::text[],false
  ) then
    raise exception using errcode='55000',
      message='cold_campaign_hmac_patch_insecure_function_metadata';
  end if;

  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition,v_legacy_predicate,''))
  ) / pg_catalog.length(v_legacy_predicate);
  if v_occurrences<>1 then
    raise exception using errcode='55000',
      message='cold_campaign_hmac_patch_source_drift',
      detail=pg_catalog.format('expected_legacy_occurrences=1 actual=%s',v_occurrences);
  end if;

  v_patched_definition := pg_catalog.replace(
    v_definition,v_legacy_predicate,v_hmac_predicate
  );
  execute v_patched_definition;

  select pg_catalog.pg_get_functiondef(p.oid),p.prosecdef,p.proconfig
  into strict v_definition,v_security_definer,v_config
  from pg_catalog.pg_proc p
  where p.oid=v_function;

  if pg_catalog.strpos(v_definition,v_legacy_predicate)<>0
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition,v_hmac_predicate,''))
     ) / pg_catalog.length(v_hmac_predicate)<>1
     or not v_security_definer
     or not coalesce(v_config @> array['search_path=""']::text[],false) then
    raise exception using errcode='55000',
      message='cold_campaign_hmac_patch_verification_failed';
  end if;

  execute pg_catalog.format(
    'revoke execute on function %s from public,anon,authenticated',v_signature
  );
  execute pg_catalog.format(
    'grant execute on function %s to service_role',v_signature
  );
end;
$$;

commit;


-- 20260819170000_cold_campaign_scheduler.sql
-- Data Brain-authoritative cold campaign scheduler. Local artifact only; defaults OFF.
begin;

create table public.cold_campaign_message_payloads (
  campaign_execution_id uuid primary key references public.campaign_executions(id) on delete restrict,
  recipient_email text not null check (recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  subject text not null check (length(subject) between 1 and 200 and subject !~ E'[\r\n]'),
  html_body text not null check (length(html_body) between 100 and 100000),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  unsubscribe_materialized boolean not null default false check (unsubscribe_materialized),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint cold_payload_unsubscribe_present check (html_body like '%/baja?token=%')
);

create table public.cold_campaign_dispatch_outbox (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true check (singleton),
  campaign_execution_id uuid not null unique references public.campaign_executions(id) on delete restrict,
  status text not null default 'queued' check (status in (
    'queued','claimed','reserved','confirmed_sent','definitive_failed','suppressed','ambiguous_halted'
  )),
  worker_id uuid,
  worker_token_hash text check (worker_token_hash is null or worker_token_hash ~ '^[a-f0-9]{64}$'),
  claim_attempt integer not null default 0 check (claim_attempt between 0 and 20),
  claim_expires_at timestamptz,
  reservation_id uuid references public.mailbox_delivery_reservations(id) on delete restrict,
  last_reason_code text,
  terminal_evidence_hash text check (terminal_evidence_hash is null or terminal_evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  terminal_at timestamptz,
  constraint cold_dispatch_claim_shape check (
    (status = 'queued' and worker_id is null and worker_token_hash is null and claim_expires_at is null) or
    (status in ('claimed','reserved') and worker_id is not null and worker_token_hash is not null and claim_expires_at is not null) or
    (status in ('confirmed_sent','definitive_failed','suppressed','ambiguous_halted') and terminal_at is not null)
  )
);

create unique index cold_campaign_single_inflight_idx
  on public.cold_campaign_dispatch_outbox(singleton)
  where status in ('claimed','reserved');
create index cold_campaign_dispatch_queue_idx
  on public.cold_campaign_dispatch_outbox(status, created_at, id);

create table public.cold_campaign_scheduler_alerts (
  id bigint generated always as identity primary key,
  code text not null check (code ~ '^[A-Z0-9_]{3,64}$'),
  dispatch_id uuid references public.cold_campaign_dispatch_outbox(id) on delete restrict,
  evidence_hash text check (evidence_hash is null or evidence_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  acknowledged_at timestamptz
);
create index cold_campaign_alerts_open_idx on public.cold_campaign_scheduler_alerts(occurred_at)
  where acknowledged_at is null;

alter table public.cold_campaign_message_payloads enable row level security;
alter table public.cold_campaign_message_payloads force row level security;
alter table public.cold_campaign_dispatch_outbox enable row level security;
alter table public.cold_campaign_dispatch_outbox force row level security;
alter table public.cold_campaign_scheduler_alerts enable row level security;
alter table public.cold_campaign_scheduler_alerts force row level security;
revoke all on public.cold_campaign_message_payloads, public.cold_campaign_dispatch_outbox,
  public.cold_campaign_scheduler_alerts from public, anon, authenticated, service_role;

create or replace function public.claim_cold_campaign_dispatch(
  p_worker_id uuid, p_worker_token text, p_lease_seconds integer default 120
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz;
  v_control public.outbound_delivery_control%rowtype;
  v_dispatch public.cold_campaign_dispatch_outbox%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_campaign public.campaigns%rowtype;
  v_outbox public.graph_outbox%rowtype;
  v_stop text;
  v_evidence text;
begin
  if p_worker_id is null or p_worker_token is null or p_worker_token !~ '^[A-Za-z0-9_-]{43}$' or
     p_lease_seconds not between 60 and 300 then
    return jsonb_build_object('accepted',false,'reason_code','invalid_request','items','[]'::jsonb);
  end if;
  select * into v_control from public.outbound_delivery_control where singleton for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or not v_control.master_enabled or not v_control.cold_enabled then
    return jsonb_build_object('accepted',false,'reason_code','master_or_lane_disabled','items','[]'::jsonb);
  end if;
  if v_control.operating_timezone <> 'Europe/Madrid' or v_control.minimum_spacing_seconds < 60 or
     v_control.cold_daily_limit > 480 then
    return jsonb_build_object('accepted',false,'reason_code','control_drift','items','[]'::jsonb);
  end if;

  select * into v_dispatch from public.cold_campaign_dispatch_outbox
  where status in ('claimed','reserved') and claim_expires_at <= v_now
  order by created_at, id for update limit 1;
  if not found then
    insert into public.cold_campaign_dispatch_outbox(campaign_execution_id)
    select ce.id from public.campaign_executions ce
    join public.cold_campaign_message_payloads mp on mp.campaign_execution_id = ce.id
    join public.campaign_contacts cc on cc.id = ce.campaign_contact_id
    where ce.status = 'planned' and ce.channel = 'email' and ce.action_name = 'delivery_scheduled'
      and ce.step = cc.current_step
      and not exists (
        select 1 from pg_catalog.generate_series(1, ce.step - 1) prior_step
        where not exists (
          select 1 from public.campaign_executions prior
          join public.cold_campaign_dispatch_outbox prior_dispatch on prior_dispatch.campaign_execution_id = prior.id
          where prior.campaign_id = ce.campaign_id and prior.campaign_contact_id = ce.campaign_contact_id
            and prior.channel = 'email' and prior.action_name = 'delivery_scheduled'
            and prior.step = prior_step and prior.status = 'executed'
            and prior_dispatch.status = 'confirmed_sent'
        )
      )
      and ce.scheduled_for <= v_now
      and not exists (select 1 from public.cold_campaign_dispatch_outbox d where d.campaign_execution_id = ce.id)
    order by ce.scheduled_for, ce.id limit 1
    on conflict (campaign_execution_id) do nothing;
    select * into v_dispatch from public.cold_campaign_dispatch_outbox
    where status = 'queued' order by created_at, id for update skip locked limit 1;
  end if;
  if not found then
    return jsonb_build_object('accepted',true,'reason_code','empty','items','[]'::jsonb);
  end if;

  select * into v_execution from public.campaign_executions where id = v_dispatch.campaign_execution_id for update;
  select * into v_contact from public.campaign_contacts where id = v_execution.campaign_contact_id for update;
  select * into v_campaign from public.campaigns where id = v_execution.campaign_id for update;
  v_now := pg_catalog.clock_timestamp();
  if v_dispatch.claim_attempt >= 20 then
    v_evidence := encode(extensions.digest(convert_to('cold-claim-attempts-exhausted-v1' || v_dispatch.id::text,'UTF8'),'sha256'),'hex');
    update public.cold_campaign_dispatch_outbox set status='ambiguous_halted',last_reason_code='claim_attempts_exhausted',terminal_evidence_hash=v_evidence,terminal_at=v_now,updated_at=v_now where id=v_dispatch.id;
    update public.outbound_delivery_control set cold_enabled=false,halt_reason='CLAIM_ATTEMPTS_EXHAUSTED',updated_at=v_now where singleton;
    insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash) values('CLAIM_ATTEMPTS_EXHAUSTED',v_dispatch.id,v_evidence);
    return jsonb_build_object('accepted',false,'reason_code','ambiguous_halted','items','[]'::jsonb);
  end if;
  if not v_campaign.is_active or v_campaign.status not in ('active','running','pilot') then v_stop := 'campaign_inactive';
  elsif v_execution.status <> 'planned' or v_execution.channel <> 'email' or v_execution.action_name <> 'delivery_scheduled' then v_stop := 'execution_unavailable';
  elsif v_execution.step is null or v_execution.step <> v_contact.current_step or exists (
      select 1 from pg_catalog.generate_series(1, v_execution.step - 1) prior_step
      where not exists (
        select 1 from public.campaign_executions prior
        join public.cold_campaign_dispatch_outbox prior_dispatch on prior_dispatch.campaign_execution_id=prior.id
        where prior.campaign_id=v_execution.campaign_id and prior.campaign_contact_id=v_execution.campaign_contact_id
          and prior.channel='email' and prior.action_name='delivery_scheduled' and prior.step=prior_step
          and prior.status='executed' and prior_dispatch.status='confirmed_sent'
      )) then v_stop := 'sequence_prerequisite_unmet';
  elsif v_contact.suppression_scope <> 'none' or v_contact.marketing_lane <> 'cold' or
        v_contact.cold_sequence_status not in ('pending','active') then v_stop := 'suppressed';
  elsif v_contact.reply_received_at is not null then v_stop := 'reply_human';
  elsif v_contact.meeting_booked_at is not null or v_contact.meeting_completed_at is not null then v_stop := 'meeting';
  elsif exists (select 1 from public.campaign_suppressions s where s.identity_hash = v_contact.email_hash) then v_stop := 'suppression';
  elsif exists (select 1 from public.campaign_contacts other where other.campaign_id=v_contact.campaign_id
        and other.email_hash=v_contact.email_hash and other.id<>v_contact.id and other.sequence_status not in ('stopped','completed')) then v_stop := 'duplicate';
  elsif exists (select 1 from public.campaign_events e where e.campaign_contact_id=v_contact.id and
        e.event_name in ('reply_received','positive_reply','unsubscribe','opposition','bounce_hard','meeting_booked','meeting_completed')) then v_stop := 'terminal_event';
  end if;
  if v_stop is not null then
    update public.cold_campaign_dispatch_outbox set status='suppressed', last_reason_code=v_stop,
      terminal_at=v_now, updated_at=v_now where id=v_dispatch.id;
    update public.campaign_executions set status='stopped', stopped_at=v_now, stop_reason=v_stop where id=v_execution.id;
    return jsonb_build_object('accepted',true,'reason_code','suppressed','items','[]'::jsonb);
  end if;

  if v_dispatch.reservation_id is not null then
    select * into v_outbox from public.graph_outbox where reservation_id=v_dispatch.reservation_id and lane='cold';
    if not found then
      v_evidence := encode(extensions.digest(convert_to('cold-reservation-binding-missing-v1' || v_dispatch.id::text,'UTF8'),'sha256'),'hex');
      update public.cold_campaign_dispatch_outbox set status='ambiguous_halted', last_reason_code='reservation_binding_missing',
        terminal_evidence_hash=v_evidence,terminal_at=v_now, updated_at=v_now where id=v_dispatch.id;
      update public.outbound_delivery_control set cold_enabled=false,halt_reason='RESERVATION_BINDING_MISSING',updated_at=v_now where singleton;
      insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash) values('RESERVATION_BINDING_MISSING',v_dispatch.id,v_evidence);
      return jsonb_build_object('accepted',false,'reason_code','ambiguous_halted','items','[]'::jsonb);
    end if;
  end if;
  v_now := pg_catalog.clock_timestamp();
  update public.cold_campaign_dispatch_outbox set status=case when reservation_id is null then 'claimed' else 'reserved' end,
    worker_id=p_worker_id, worker_token_hash=encode(extensions.digest(convert_to(p_worker_token,'UTF8'),'sha256'),'hex'),
    claim_attempt=claim_attempt+1, claim_expires_at=v_now+make_interval(secs=>p_lease_seconds), updated_at=v_now
  where id=v_dispatch.id returning * into v_dispatch;
  return jsonb_build_object('accepted',true,'reason_code',case when v_dispatch.reservation_id is null then 'claimed' else 'reserved_recovery' end,
    'lease_expires_at',v_dispatch.claim_expires_at,'items',jsonb_build_array(jsonb_build_object(
      'dispatch_id',v_dispatch.id,'campaign_execution_id',v_execution.id,'campaign_external_id',v_campaign.external_id,
      'contact_id',v_contact.external_contact_id,'execution_key',v_execution.idempotency_key,'step',v_execution.step,
      'reservation_id',v_dispatch.reservation_id,'recovery_required',(v_dispatch.reservation_id is not null),
      'outbox_state',v_outbox.state,'graph_draft_immutable_id',v_outbox.graph_draft_immutable_id,
      'draft_neutralized',(v_outbox.draft_neutralized_at is not null),
      'outcome_evidence_hash',case when v_outbox.state='confirmed_sent' then v_outbox.sent_items_evidence_hash else v_outbox.terminal_evidence_hash end)));
end;
$$;

create or replace function public.get_claimed_cold_campaign_package(
  p_dispatch_id uuid, p_worker_id uuid, p_worker_token text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_dispatch public.cold_campaign_dispatch_outbox%rowtype; v_payload public.cold_campaign_message_payloads%rowtype; v_now timestamptz;
begin
  select * into v_dispatch from public.cold_campaign_dispatch_outbox where id=p_dispatch_id for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or v_dispatch.status not in ('claimed','reserved') or v_dispatch.worker_id<>p_worker_id or
    v_dispatch.worker_token_hash<>encode(extensions.digest(convert_to(p_worker_token,'UTF8'),'sha256'),'hex') or v_dispatch.claim_expires_at<=v_now then
    return jsonb_build_object('packaged',false,'reason_code','claim_unavailable');
  end if;
  select * into v_payload from public.cold_campaign_message_payloads where campaign_execution_id=v_dispatch.campaign_execution_id;
  if not found or not v_payload.unsubscribe_materialized then return jsonb_build_object('packaged',false,'reason_code','payload_unavailable'); end if;
  return jsonb_build_object('packaged',true,'recipient_email',v_payload.recipient_email,'subject',v_payload.subject,
    'html_body',v_payload.html_body,'payload_sha256',v_payload.payload_sha256);
end;
$$;

create or replace function public.bind_cold_campaign_reservation(
  p_dispatch_id uuid,p_worker_id uuid,p_worker_token text,p_mailbox_key_hash text,p_message_key_hash text,
  p_payload_sha256 text,p_finalize_capability_hash text,p_send_capability_hash text,p_opaque_marker text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_d public.cold_campaign_dispatch_outbox%rowtype; v_e public.campaign_executions%rowtype; v_c public.campaign_contacts%rowtype;
  v_campaign public.campaigns%rowtype; v_result jsonb; v_now timestamptz;
begin
  select * into v_d from public.cold_campaign_dispatch_outbox where id=p_dispatch_id for update; v_now:=pg_catalog.clock_timestamp();
  if not found or v_d.status not in ('claimed','reserved') or v_d.worker_id<>p_worker_id or v_d.claim_expires_at<=v_now or
    v_d.worker_token_hash<>encode(extensions.digest(convert_to(p_worker_token,'UTF8'),'sha256'),'hex') then
    return jsonb_build_object('authorized',false,'reason_code','claim_unavailable','duplicate',false);
  end if;
  if v_d.reservation_id is not null then
    return jsonb_build_object('authorized',true,'reason_code','reserved','duplicate',true,'reservation_id',v_d.reservation_id,'lease_expires_at',v_d.claim_expires_at);
  end if;
  select * into v_e from public.campaign_executions where id=v_d.campaign_execution_id;
  select * into v_c from public.campaign_contacts where id=v_e.campaign_contact_id;
  select * into v_campaign from public.campaigns where id=v_e.campaign_id;
  v_result:=public.reserve_cold_graph_delivery(v_campaign.external_id,v_c.external_contact_id,v_e.idempotency_key,
    p_mailbox_key_hash,p_message_key_hash,p_payload_sha256,p_finalize_capability_hash,p_send_capability_hash,p_opaque_marker);
  if (v_result->>'authorized')::boolean then
    update public.cold_campaign_dispatch_outbox set status='reserved',reservation_id=(v_result->>'reservation_id')::uuid,
      updated_at=v_now where id=v_d.id;
  end if;
  return v_result;
end;
$$;

create or replace function public.finalize_cold_campaign_dispatch(
  p_dispatch_id uuid,p_worker_id uuid,p_worker_token text,p_outcome text,p_evidence_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_d public.cold_campaign_dispatch_outbox%rowtype; v_o public.graph_outbox%rowtype; v_e public.campaign_executions%rowtype; v_c public.campaign_contacts%rowtype; v_control public.outbound_delivery_control%rowtype; v_now timestamptz; v_terminal_stop boolean;
begin
  if p_outcome not in ('confirmed_sent','definitive_failed','suppressed_before_send','ambiguous_halted') or p_evidence_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('accepted',false,'reason_code','invalid_request'); end if;
  select * into v_control from public.outbound_delivery_control where singleton for update;
  if not found then return jsonb_build_object('accepted',false,'reason_code','control_unavailable'); end if;
  select * into v_d from public.cold_campaign_dispatch_outbox where id=p_dispatch_id for update; v_now:=pg_catalog.clock_timestamp();
  if not found or v_d.worker_id<>p_worker_id or v_d.worker_token_hash<>encode(extensions.digest(convert_to(p_worker_token,'UTF8'),'sha256'),'hex') or v_d.reservation_id is null then
    return jsonb_build_object('accepted',false,'reason_code','claim_unavailable'); end if;
  select * into v_o from public.graph_outbox where reservation_id=v_d.reservation_id for update;
  if not found or v_o.lane<>'cold' or v_o.state<>p_outcome or coalesce(v_o.sent_items_evidence_hash,v_o.terminal_evidence_hash)<>p_evidence_hash then
    update public.cold_campaign_dispatch_outbox set status='ambiguous_halted',last_reason_code='terminal_evidence_mismatch',terminal_evidence_hash=p_evidence_hash,terminal_at=v_now,updated_at=v_now where id=v_d.id;
    update public.outbound_delivery_control set cold_enabled=false,halt_reason='TERMINAL_EVIDENCE_MISMATCH',updated_at=v_now where singleton;
    insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash) values('TERMINAL_EVIDENCE_MISMATCH',v_d.id,p_evidence_hash);
    return jsonb_build_object('accepted',false,'reason_code','ambiguous_halted');
  end if;
  select * into v_e from public.campaign_executions where id=v_d.campaign_execution_id for update;
  select * into v_c from public.campaign_contacts where id=v_e.campaign_contact_id for update;
  v_terminal_stop := v_c.sequence_status in ('stopped','completed') or v_c.cold_sequence_status in ('stopped','completed') or
    v_c.marketing_lane <> 'cold' or v_c.suppression_scope <> 'none' or v_c.reply_received_at is not null or
    v_c.meeting_booked_at is not null or v_c.meeting_completed_at is not null or exists (
      select 1 from public.campaign_suppressions s where s.identity_hash=v_c.email_hash
    );
  update public.cold_campaign_dispatch_outbox set status=case p_outcome when 'suppressed_before_send' then 'suppressed' else p_outcome end,
    terminal_evidence_hash=p_evidence_hash,terminal_at=v_now,updated_at=v_now where id=v_d.id;
  if p_outcome='ambiguous_halted' then
    update public.outbound_delivery_control set cold_enabled=false,halt_reason='GRAPH_AMBIGUOUS_HALTED',updated_at=v_now where singleton;
    insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash) values('GRAPH_AMBIGUOUS_HALTED',v_d.id,p_evidence_hash);
  end if;
  if p_outcome='confirmed_sent' then
    update public.campaign_executions set status='executed',actual_at=v_now where id=v_e.id;
    if v_terminal_stop then
      update public.campaign_contacts set last_delivery_status='confirmed_sent',lock_expires_at=null,locked_at=null
        where id=v_e.campaign_contact_id;
      update public.campaign_executions set status='stopped',stopped_at=v_now,stop_reason='terminal_stop_before_finalize'
        where campaign_id=v_e.campaign_id and campaign_contact_id=v_e.campaign_contact_id and channel='email'
          and action_name='delivery_scheduled' and status='planned' and step>v_e.step;
    else
      update public.campaign_contacts set current_step=least(5,current_step+1),
        cold_sequence_status=case when v_e.step>=5 then 'completed' else 'active' end,
        sequence_status=case when v_e.step>=5 then 'completed' else sequence_status end,
        next_delivery_status=case when v_e.step>=5 then 'completed' else 'pending' end,
        last_delivery_status='confirmed_sent',lock_expires_at=null,locked_at=null where id=v_e.campaign_contact_id;
    end if;
  else
    update public.campaign_executions set status=case when p_outcome='suppressed_before_send' then 'stopped' else 'failed' end,
      failed_at=case when p_outcome<>'suppressed_before_send' then v_now else failed_at end,
      stopped_at=case when p_outcome='suppressed_before_send' then v_now else stopped_at end,
      failure_code=p_outcome where id=v_e.id;
  end if;
  return jsonb_build_object('accepted',true,'reason_code',p_outcome,'reservation_id',v_d.reservation_id);
end;
$$;

create or replace function public.halt_cold_campaign_dispatch(
  p_dispatch_id uuid,p_worker_id uuid,p_worker_token text,p_reason_code text,p_evidence_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_d public.cold_campaign_dispatch_outbox%rowtype; v_control public.outbound_delivery_control%rowtype; v_now timestamptz;
begin
  if p_reason_code !~ '^[A-Z0-9_]{3,64}$' or p_evidence_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('accepted',false,'reason_code','invalid_request'); end if;
  select * into v_control from public.outbound_delivery_control where singleton for update;
  if not found then return jsonb_build_object('accepted',false,'reason_code','control_unavailable'); end if;
  select * into v_d from public.cold_campaign_dispatch_outbox where id=p_dispatch_id for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or v_d.worker_id<>p_worker_id or
    v_d.worker_token_hash<>encode(extensions.digest(convert_to(p_worker_token,'UTF8'),'sha256'),'hex') then
    return jsonb_build_object('accepted',false,'reason_code','claim_unavailable'); end if;
  update public.cold_campaign_dispatch_outbox set status='ambiguous_halted',last_reason_code=p_reason_code,
    terminal_evidence_hash=p_evidence_hash,terminal_at=v_now,updated_at=v_now where id=v_d.id;
  update public.outbound_delivery_control set cold_enabled=false,halt_reason=p_reason_code,updated_at=v_now where singleton;
  insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash)
    values(p_reason_code,v_d.id,p_evidence_hash);
  return jsonb_build_object('accepted',true,'reason_code','ambiguous_halted');
end;
$$;revoke execute on function public.claim_cold_campaign_dispatch(uuid,text,integer) from public,anon,authenticated;
revoke execute on function public.get_claimed_cold_campaign_package(uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.finalize_cold_campaign_dispatch(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke execute on function public.halt_cold_campaign_dispatch(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.halt_cold_campaign_dispatch(uuid,uuid,text,text,text) to service_role;
grant execute on function public.claim_cold_campaign_dispatch(uuid,text,integer) to service_role;
grant execute on function public.get_claimed_cold_campaign_package(uuid,uuid,text) to service_role;
grant execute on function public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text) to service_role;
grant execute on function public.finalize_cold_campaign_dispatch(uuid,uuid,text,text,text) to service_role;

commit;


-- 20260819200000_cold_campaign_provisioning.sql
-- OFF-by-default, idempotent cold campaign provisioning. Local artifact only.
begin;

create table public.cold_campaign_provision_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  expected_manifest_hash text check (expected_manifest_hash is null or expected_manifest_hash ~ '^[a-f0-9]{64}$'),
  expected_authorization_hash text check (expected_authorization_hash is null or expected_authorization_hash ~ '^[a-f0-9]{64}$'),
  authorized_actor_hash text check (authorized_actor_hash is null or authorized_actor_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (not enabled or (expected_manifest_hash is not null and expected_authorization_hash is not null and authorized_actor_hash is not null and expires_at is not null))
);
insert into public.cold_campaign_provision_control(singleton,enabled) values(true,false);

create table public.cold_campaign_provision_manifests (
  manifest_hash text primary key check (manifest_hash ~ '^[a-f0-9]{64}$'),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  logical_dataset_hash text not null check (logical_dataset_hash ~ '^[a-f0-9]{64}$'),
  campaign_external_id text not null check (campaign_external_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$'),
  hash_domain text not null default 'cold-provision-v2' check (hash_domain='cold-provision-v2'),
  batch_count integer not null check (batch_count between 1 and 100),
  expected_contacts integer not null default 939 check (expected_contacts=939),
  expected_payloads integer not null default 4695 check (expected_payloads=4695),
  status text not null default 'applying' check (status in ('applying','prepared_off')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  prepared_at timestamptz
);

create table public.cold_campaign_provision_batches (
  manifest_hash text not null references public.cold_campaign_provision_manifests(manifest_hash) on delete restrict,
  batch_index integer not null check (batch_index between 0 and 99),
  batch_count integer not null check (batch_count between 1 and 100),
  batch_hash text not null check (batch_hash ~ '^[a-f0-9]{64}$'),
  row_count integer not null check (row_count between 1 and 500),
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  row_hashes text[] not null,
  applied_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(manifest_hash,batch_index),
  check (batch_index < batch_count)
);

alter table public.cold_campaign_provision_control enable row level security;
alter table public.cold_campaign_provision_control force row level security;
alter table public.cold_campaign_provision_manifests enable row level security;
alter table public.cold_campaign_provision_manifests force row level security;
alter table public.cold_campaign_provision_batches enable row level security;
alter table public.cold_campaign_provision_batches force row level security;
revoke all on public.cold_campaign_provision_control,public.cold_campaign_provision_manifests,public.cold_campaign_provision_batches from public,anon,authenticated,service_role;

create or replace function public.apply_cold_campaign_provision_batch(
  p_manifest_hash text,p_logical_dataset_hash text,p_batch_index integer,p_batch_count integer,p_batch_hash text,
  p_actor_hash text,p_authorization_hash text,p_campaign_external_id text,p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_control public.cold_campaign_provision_control%rowtype;
  v_outbound public.outbound_delivery_control%rowtype;
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_existing public.cold_campaign_provision_batches%rowtype;
  v_row jsonb;
  v_now timestamptz;
  v_row_count integer;
  v_computed_batch_hash text;
  v_row_hashes text[];
  v_computed_manifest_hash text;
  v_computed_row_hash text;
  v_token_id uuid;
  v_token text;
  v_token_occurrences integer;
  v_canonical_payload text;
begin
  if p_manifest_hash !~ '^[a-f0-9]{64}$' or p_logical_dataset_hash !~ '^[a-f0-9]{64}$' or p_batch_hash !~ '^[a-f0-9]{64}$' or
     p_actor_hash !~ '^[a-f0-9]{64}$' or p_authorization_hash !~ '^[a-f0-9]{64}$' or
     p_campaign_external_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_batch_count not between 1 and 100 or p_batch_index not between 0 and p_batch_count-1 or
     pg_catalog.jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023',message='provision_request_invalid';
  end if;
  v_row_count:=pg_catalog.jsonb_array_length(p_rows);
  if v_row_count not between 1 and 500 then raise exception using errcode='22023',message='provision_batch_size_invalid'; end if;
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.string_agg(item->>'row_sha256',E'\n' order by item->>'row_sha256'),'UTF8'),'sha256'),'hex'),
    pg_catalog.array_agg(item->>'row_sha256' order by item->>'row_sha256')
  into v_computed_batch_hash,v_row_hashes from pg_catalog.jsonb_array_elements(p_rows) item;
  if v_computed_batch_hash<>p_batch_hash then raise exception using errcode='22023',message='provision_batch_hash_invalid'; end if;

  select * into v_control from public.cold_campaign_provision_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or not v_control.enabled or v_control.expires_at<=v_now or
     v_control.expected_manifest_hash<>p_manifest_hash or v_control.expected_authorization_hash<>p_authorization_hash or
     v_control.authorized_actor_hash<>p_actor_hash then
    raise exception using errcode='42501',message='provision_control_closed';
  end if;
  select * into v_outbound from public.outbound_delivery_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or v_outbound.master_enabled or v_outbound.cold_enabled then
    raise exception using errcode='55000',message='outbound_must_remain_off';
  end if;

  select * into v_existing from public.cold_campaign_provision_batches
  where manifest_hash=p_manifest_hash and batch_index=p_batch_index for update;
  if found then
    if v_existing.batch_hash<>p_batch_hash or v_existing.batch_count<>p_batch_count or v_existing.row_count<>v_row_count or v_existing.actor_hash<>p_actor_hash or v_existing.row_hashes<>v_row_hashes then
      raise exception using errcode='23505',message='provision_batch_collision';
    end if;
    return pg_catalog.jsonb_build_object('accepted',true,'duplicate',true,'reason_code','batch_replayed');
  end if;

  insert into public.campaigns(name,is_active,external_id,timezone,status)
  values('FUNDAE 2026 Email Campaign',false,p_campaign_external_id,'Europe/Madrid','draft')
  on conflict(external_id) do nothing;
  select * into v_campaign from public.campaigns where external_id=p_campaign_external_id for update;
  if not found or v_campaign.is_active or v_campaign.status<>'draft' then
    raise exception using errcode='23505',message='campaign_collision';
  end if;
  insert into public.cold_campaign_provision_manifests(manifest_hash,campaign_id,actor_hash,logical_dataset_hash,campaign_external_id,batch_count)
  values(p_manifest_hash,v_campaign.id,p_actor_hash,p_logical_dataset_hash,p_campaign_external_id,p_batch_count)
  on conflict(manifest_hash) do nothing;
  if not exists(select 1 from public.cold_campaign_provision_manifests m where m.manifest_hash=p_manifest_hash and m.campaign_id=v_campaign.id and m.actor_hash=p_actor_hash and m.logical_dataset_hash=p_logical_dataset_hash and m.campaign_external_id=p_campaign_external_id and m.batch_count=p_batch_count and m.status='applying') then
    raise exception using errcode='23505',message='manifest_collision';
  end if;

  -- The stop-gate validates planned rows while MVCC keeps pilot state private.
  -- Every path restores draft before commit; any exception rolls the transaction back.
  update public.campaigns set is_active=true,status='pilot' where id=v_campaign.id;

  for v_row in select item from pg_catalog.jsonb_array_elements(p_rows) item loop
    if (select count(*) from pg_catalog.jsonb_object_keys(v_row))<>24 or exists(
      select 1 from pg_catalog.jsonb_object_keys(v_row) key where key not in (
        'campaign_external_id','contact_id','account_id','email','email_hash','variant','lot','step','scheduled_for','execution_key',
        'recipient_email','subject','html_body','payload_sha256','token_hash','validation_status','unsubscribe_status','opposition_status',
        'hard_bounce_status','suppression_status','duplicate_status','campaign_authorization','row_sha256','company_size'
      )) then raise exception using errcode='22023',message='provision_row_shape_invalid'; end if;
    if v_row->>'campaign_external_id'<>p_campaign_external_id or v_row->>'validation_status'<>'OK' or
       v_row->>'unsubscribe_status'<>'CLEAR' or v_row->>'opposition_status'<>'CLEAR' or
       v_row->>'hard_bounce_status'<>'CLEAR' or v_row->>'suppression_status'<>'CLEAR' or
       v_row->>'duplicate_status'<>'CLEAR' or v_row->>'campaign_authorization'<>'AUTHORIZED' or
       (v_row->>'step')::integer not between 1 and 5 or v_row->>'lot' not in ('A','B','C','D') or
       v_row->>'email_hash' !~ '^[a-f0-9]{64}$' or v_row->>'payload_sha256' !~ '^[a-f0-9]{64}$' or
       v_row->>'token_hash' !~ '^[a-f0-9]{64}$' or v_row->>'row_sha256' !~ '^[a-f0-9]{64}$' or
       v_row->>'email'<>pg_catalog.lower(v_row->>'email') or
       v_row->>'recipient_email'<>v_row->>'email' or
       not fundae_private.is_cold_campaign_hmac_identity(v_row->>'email',v_row->>'email_hash') or
       pg_catalog.strpos(v_row->>'html_body','{{unsubscribe_url}}')>0 then
      raise exception using errcode='22023',message='provision_row_gate_invalid';
    end if;
    select count(*),min(match[1]) into v_token_occurrences,v_token
    from pg_catalog.regexp_matches(v_row->>'html_body','(u1[.][A-Za-z0-9_-]{43})','g') match;
    if v_token_occurrences<>1 or pg_catalog.strpos(v_row->>'html_body','/baja?token='||v_token)=0 or
       pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_token,'UTF8'),'sha256'),'hex')<>v_row->>'token_hash' then
      raise exception using errcode='22023',message='provision_unsubscribe_binding_invalid';
    end if;
    v_canonical_payload:='{"recipient":'||pg_catalog.to_json(v_row->>'recipient_email')::text||
      ',"subject":'||pg_catalog.to_json(v_row->>'subject')::text||
      ',"body":'||pg_catalog.to_json(v_row->>'html_body')::text||',"attachments":[]}';
    if pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_canonical_payload,'UTF8'),'sha256'),'hex')<>v_row->>'payload_sha256' then
      raise exception using errcode='22023',message='provision_payload_hash_invalid';
    end if;
    v_computed_row_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.concat_ws(pg_catalog.chr(31),
      v_row->>'campaign_external_id',v_row->>'contact_id',v_row->>'account_id',v_row->>'email',v_row->>'email_hash',
      v_row->>'variant',v_row->>'lot',v_row->>'step',v_row->>'scheduled_for',v_row->>'execution_key',v_row->>'recipient_email',
      v_row->>'subject',v_row->>'html_body',v_row->>'payload_sha256',v_row->>'token_hash',v_row->>'validation_status',
      v_row->>'unsubscribe_status',v_row->>'opposition_status',v_row->>'hard_bounce_status',v_row->>'suppression_status',
      v_row->>'duplicate_status',v_row->>'campaign_authorization',v_row->>'company_size'),'UTF8'),'sha256'),'hex');
    if v_computed_row_hash<>v_row->>'row_sha256' then raise exception using errcode='22023',message='provision_row_hash_invalid'; end if;

    insert into public.campaign_contacts(campaign_id,external_contact_id,external_account_id,email_hash,contact_data,variant,magnet,lot,company_size,current_step,sequence_status,next_delivery_status,marketing_lane,cold_sequence_status,suppression_scope)
    values(v_campaign.id,v_row->>'contact_id',v_row->>'account_id',v_row->>'email_hash',pg_catalog.jsonb_build_object('email',v_row->>'email'),
      v_row->>'variant',v_row->>'variant',v_row->>'lot',nullif(v_row->>'company_size',''),1,'pending','pending','cold','pending','none')
    on conflict(campaign_id,external_contact_id) do nothing;
    select * into v_contact from public.campaign_contacts where campaign_id=v_campaign.id and external_contact_id=v_row->>'contact_id' for update;
    if not found or v_contact.external_account_id<>v_row->>'account_id' or v_contact.email_hash<>v_row->>'email_hash' or
       v_contact.variant<>v_row->>'variant' or v_contact.lot<>v_row->>'lot' or v_contact.contact_data->>'email'<>v_row->>'email' then
      raise exception using errcode='23505',message='row_collision';
    end if;

    insert into public.campaign_unsubscribe_tokens(campaign_id,campaign_contact_id,token_hash,token_version)
    values(v_campaign.id,v_contact.id,v_row->>'token_hash',1) on conflict(campaign_contact_id,token_version) do nothing;
    select id into v_token_id from public.campaign_unsubscribe_tokens where campaign_contact_id=v_contact.id and token_version=1 and token_hash=v_row->>'token_hash' and revoked_at is null;
    if not found then raise exception using errcode='23505',message='unsubscribe_token_collision'; end if;

    insert into public.campaign_executions(campaign_id,campaign_contact_id,idempotency_key,channel,capture_method,action_name,step,status,scheduled_for,planned_at,metadata)
    values(v_campaign.id,v_contact.id,v_row->>'execution_key','email','automation','delivery_scheduled',(v_row->>'step')::integer,'planned',(v_row->>'scheduled_for')::timestamptz,v_now,'{}'::jsonb)
    on conflict(campaign_id,idempotency_key) do nothing;
    select * into v_execution from public.campaign_executions where campaign_id=v_campaign.id and idempotency_key=v_row->>'execution_key' for update;
    if not found or v_execution.campaign_contact_id<>v_contact.id or v_execution.step<>(v_row->>'step')::integer or v_execution.status<>'planned' or v_execution.scheduled_for<>(v_row->>'scheduled_for')::timestamptz then
      raise exception using errcode='23505',message='execution_collision';
    end if;

    insert into public.cold_campaign_message_payloads(campaign_execution_id,recipient_email,subject,html_body,payload_sha256,unsubscribe_materialized)
    values(v_execution.id,v_row->>'recipient_email',v_row->>'subject',v_row->>'html_body',v_row->>'payload_sha256',true)
    on conflict(campaign_execution_id) do nothing;
    if not exists(select 1 from public.cold_campaign_message_payloads p where p.campaign_execution_id=v_execution.id and p.recipient_email=v_row->>'recipient_email' and p.subject=v_row->>'subject' and p.html_body=v_row->>'html_body' and p.payload_sha256=v_row->>'payload_sha256' and p.unsubscribe_materialized) then
      raise exception using errcode='23505',message='payload_collision';
    end if;
  end loop;

  update public.campaigns set is_active=false,status='draft' where id=v_campaign.id;

  insert into public.cold_campaign_provision_batches(manifest_hash,batch_index,batch_count,batch_hash,row_count,actor_hash,row_hashes)
  values(p_manifest_hash,p_batch_index,p_batch_count,p_batch_hash,v_row_count,p_actor_hash,v_row_hashes)
  on conflict (manifest_hash,batch_index) do nothing;
  return pg_catalog.jsonb_build_object('accepted',true,'duplicate',false,'reason_code','batch_applied','row_count',v_row_count);
end;
$$;

create or replace function public.finalize_cold_campaign_provision(
  p_manifest_hash text,p_actor_hash text,p_authorization_hash text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_control public.cold_campaign_provision_control%rowtype;
  v_outbound public.outbound_delivery_control%rowtype;
  v_manifest public.cold_campaign_provision_manifests%rowtype;
  v_now timestamptz;
  v_batches integer;
  v_rows integer;
  v_computed_manifest_hash text;
begin
  if p_manifest_hash !~ '^[a-f0-9]{64}$' or p_actor_hash !~ '^[a-f0-9]{64}$' or p_authorization_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='finalize_request_invalid';
  end if;
  select * into v_control from public.cold_campaign_provision_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or not v_control.enabled or v_control.expires_at<=v_now or v_control.expected_manifest_hash<>p_manifest_hash or
     v_control.expected_authorization_hash<>p_authorization_hash or v_control.authorized_actor_hash<>p_actor_hash then
    raise exception using errcode='42501',message='provision_control_closed';
  end if;
  select * into v_outbound from public.outbound_delivery_control where singleton for update;
  if not found or v_outbound.master_enabled or v_outbound.cold_enabled then raise exception using errcode='55000',message='outbound_must_remain_off'; end if;
  select * into v_manifest from public.cold_campaign_provision_manifests where manifest_hash=p_manifest_hash for update;
  if not found or v_manifest.actor_hash<>p_actor_hash then raise exception using errcode='23505',message='manifest_collision'; end if;
  if v_manifest.status='prepared_off' then return pg_catalog.jsonb_build_object('accepted',true,'duplicate',true,'reason_code','already_prepared_off'); end if;
  select count(*),coalesce(sum(row_count),0) into v_batches,v_rows from public.cold_campaign_provision_batches where manifest_hash=p_manifest_hash;
  if v_batches<>v_manifest.batch_count or v_rows<>4695 or exists(
      select 1 from pg_catalog.generate_series(0,v_manifest.batch_count-1) expected
      where not exists(select 1 from public.cold_campaign_provision_batches b where b.manifest_hash=p_manifest_hash and b.batch_index=expected)
    ) then raise exception using errcode='55000',message='partial_batch_set'; end if;
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.concat_ws(pg_catalog.chr(31),
      'cold-provision-v2',v_manifest.logical_dataset_hash,v_manifest.campaign_external_id,
      pg_catalog.string_agg(row_hash,E'\n' order by row_hash)),'UTF8'),'sha256'),'hex')
  into v_computed_manifest_hash
  from public.cold_campaign_provision_batches b
  cross join lateral pg_catalog.unnest(b.row_hashes) as hashes(row_hash)
  where b.manifest_hash=p_manifest_hash;
  if v_computed_manifest_hash<>p_manifest_hash or not exists(
      select 1 from public.campaigns c where c.id=v_manifest.campaign_id and c.external_id=v_manifest.campaign_external_id
    ) then raise exception using errcode='23514',message='provision_manifest_hash_invalid'; end if;
  if (select count(*) from public.campaign_contacts where campaign_id=v_manifest.campaign_id)<>939 or
     (select count(*) from public.campaign_contacts where campaign_id=v_manifest.campaign_id and lot='A')<>235 or
     (select count(*) from public.campaign_contacts where campaign_id=v_manifest.campaign_id and lot='B')<>235 or
     (select count(*) from public.campaign_contacts where campaign_id=v_manifest.campaign_id and lot='C')<>235 or
     (select count(*) from public.campaign_contacts where campaign_id=v_manifest.campaign_id and lot='D')<>234 then
    raise exception using errcode='55000',message='contact_or_lot_count_invalid';
  end if;
  if (select count(*) from public.campaign_executions where campaign_id=v_manifest.campaign_id and channel='email' and action_name='delivery_scheduled')<>4695 or
     (select count(*) from public.cold_campaign_message_payloads p join public.campaign_executions e on e.id=p.campaign_execution_id where e.campaign_id=v_manifest.campaign_id)<>4695 or
     exists(select 1 from public.campaign_executions e where e.campaign_id=v_manifest.campaign_id group by e.campaign_contact_id having count(*) filter(where e.channel='email' and e.action_name='delivery_scheduled')<>5 or count(distinct e.step) filter(where e.channel='email' and e.action_name='delivery_scheduled')<>5) then
    raise exception using errcode='55000',message='execution_or_payload_count_invalid';
  end if;
  update public.cold_campaign_provision_manifests set status='prepared_off',prepared_at=v_now where manifest_hash=p_manifest_hash;
  update public.cold_campaign_provision_control set enabled=false,updated_at=v_now where singleton;
  return pg_catalog.jsonb_build_object('accepted',true,'duplicate',false,'reason_code','prepared_off','contacts',939,'payloads',4695);
end;
$$;

revoke execute on function public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.finalize_cold_campaign_provision(text,text,text) from public,anon,authenticated;
grant execute on function public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb) to service_role;
grant execute on function public.finalize_cold_campaign_provision(text,text,text) to service_role;

commit;

-- 20260819210000_release_safety_barriers.sql
-- Final fail-closed barriers for cold outbound and atomic campaign event materialization.
-- Local artifact only. This migration leaves every outbound lane OFF and sends nothing.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '10min';

alter table public.campaign_contacts
  add column if not exists reply_received_at timestamptz;

alter table public.campaign_suppressions
  drop constraint if exists campaign_suppressions_scope_reason_check;
alter table public.campaign_suppressions
  add constraint campaign_suppressions_scope_reason_check check (
    (scope = 'all' and reason = 'unsubscribe') or
    (scope = 'marketing' and reason in ('hard_bounce','opposition'))
  ) not valid;
alter table public.campaign_suppressions
  validate constraint campaign_suppressions_scope_reason_check;

create or replace function public.cold_outbound_barrier_reason(
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
begin
  if p_now is null or p_now < pg_catalog.clock_timestamp() - interval '5 minutes'
     or p_now > pg_catalog.clock_timestamp() + interval '1 minute' then
    return 'invalid_safety_clock';
  end if;
  if pg_catalog.to_regclass('public.operational_heartbeats') is null or
     pg_catalog.to_regclass('public.operational_alerts') is null or
     pg_catalog.to_regclass('public.inbound_event_ledger') is null or
     pg_catalog.to_regclass('public.inbound_alerts') is null then
    return 'safety_tables_unavailable';
  end if;
  if exists(select 1 from public.operational_alerts where severity='critical' and lifecycle<>'resolved') then
    return 'critical_alert_open';
  end if;
  select required.signal_code into v_reason
  from (values
    ('oauth',600),('mailbox',900),('reply_processor',900),
    ('unsubscribe_processor',900),('hard_bounce_processor',900)
  ) required(signal_code,max_age_seconds)
  left join public.operational_heartbeats heartbeat on heartbeat.signal_code=required.signal_code
  where heartbeat.signal_code is null or heartbeat.status<>'healthy' or
    heartbeat.observed_at < p_now-pg_catalog.make_interval(secs=>required.max_age_seconds)
  order by required.signal_code limit 1;
  if v_reason is not null then return 'heartbeat_unhealthy_or_stale:'||v_reason; end if;
  if exists(select 1 from public.inbound_event_ledger where status in ('processing','manual_review')) or
     exists(select 1 from public.inbound_alerts where status<>'resolved') then
    return 'inbound_stop_backlog';
  end if;
  return null;
end;
$$;

-- Serialize creation of inbound backlog against cold claim/JIT checks.
alter function public.claim_inbound_event(text,text,text,jsonb,integer)
  rename to claim_inbound_event_pre_safety_20260819;
create or replace function public.claim_inbound_event(
  p_provider text,p_source_event_hash text,p_event_kind text,p_evidence jsonb,p_lease_seconds integer
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_control public.outbound_delivery_control%rowtype;
begin
  select * into v_control from public.outbound_delivery_control where singleton for update;
  if not found then raise exception using errcode='55000',message='outbound_control_unavailable'; end if;
  return public.claim_inbound_event_pre_safety_20260819(
    p_provider,p_source_event_hash,p_event_kind,p_evidence,p_lease_seconds
  );
end;
$$;
revoke insert,update,delete on public.inbound_event_ledger,public.inbound_alerts from service_role;

-- Serialize critical alert materialization against cold claim/JIT checks and kill cold atomically.
alter function public.reconcile_operational_alerts(text,timestamptz,text,jsonb,text[])
  rename to reconcile_operational_alerts_pre_safety_20260819;
create or replace function public.reconcile_operational_alerts(
  p_evaluation_key text,p_evaluated_at timestamptz,p_actor_hash text,
  p_alerts jsonb,p_managed_signal_codes text[]
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_control public.outbound_delivery_control%rowtype; v_result jsonb; v_now timestamptz;
begin
  select * into v_control from public.outbound_delivery_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found then raise exception using errcode='55000',message='outbound_control_unavailable'; end if;
  v_result:=public.reconcile_operational_alerts_pre_safety_20260819(
    p_evaluation_key,p_evaluated_at,p_actor_hash,p_alerts,p_managed_signal_codes
  );
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_alerts) item where item->>'severity'='critical') then
    update public.outbound_delivery_control set cold_enabled=false,
      halt_reason='CRITICAL_OPERATIONAL_ALERT',updated_at=v_now where singleton;
  end if;
  return v_result;
end;
$$;

-- Wrap cold claim without copying scheduler logic.
alter function public.claim_cold_campaign_dispatch(uuid,text,integer)
  rename to claim_cold_campaign_dispatch_pre_safety_20260819;
create or replace function public.claim_cold_campaign_dispatch(
  p_worker_id uuid,p_worker_token text,p_lease_seconds integer default 120
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_control public.outbound_delivery_control%rowtype; v_reason text; v_now timestamptz; v_evidence text;
begin
  select * into v_control from public.outbound_delivery_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found then return pg_catalog.jsonb_build_object('accepted',false,'reason_code','control_unavailable','items','[]'::jsonb); end if;
  v_reason:=public.cold_outbound_barrier_reason(v_now);
  if v_reason is not null then
    v_evidence:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to('cold-safety-v1'||v_reason,'UTF8'),'sha256'),'hex');
    update public.outbound_delivery_control set cold_enabled=false,halt_reason='COLD_SAFETY_BARRIER',updated_at=v_now where singleton;
    insert into public.cold_campaign_scheduler_alerts(code,evidence_hash) values('COLD_SAFETY_BARRIER',v_evidence);
    return pg_catalog.jsonb_build_object('accepted',false,'reason_code',v_reason,'items','[]'::jsonb);
  end if;
  return public.claim_cold_campaign_dispatch_pre_safety_20260819(p_worker_id,p_worker_token,p_lease_seconds);
end;
$$;

-- A backlog committed after claim still blocks reservation.
alter function public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text)
  rename to bind_cold_campaign_reservation_pre_safety_20260819;
create or replace function public.bind_cold_campaign_reservation(
  p_dispatch_id uuid,p_worker_id uuid,p_worker_token text,p_mailbox_key_hash text,p_message_key_hash text,
  p_payload_sha256 text,p_finalize_capability_hash text,p_send_capability_hash text,p_opaque_marker text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_control public.outbound_delivery_control%rowtype; v_reason text; v_now timestamptz;
begin
  select * into v_control from public.outbound_delivery_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found then return pg_catalog.jsonb_build_object('authorized',false,'reason_code','control_unavailable','duplicate',false); end if;
  v_reason:=public.cold_outbound_barrier_reason(v_now);
  if v_reason is not null then
    update public.outbound_delivery_control set cold_enabled=false,halt_reason='COLD_SAFETY_BARRIER',updated_at=v_now where singleton;
    return pg_catalog.jsonb_build_object('authorized',false,'reason_code',v_reason,'duplicate',false);
  end if;
  return public.bind_cold_campaign_reservation_pre_safety_20260819(
    p_dispatch_id,p_worker_id,p_worker_token,p_mailbox_key_hash,p_message_key_hash,
    p_payload_sha256,p_finalize_capability_hash,p_send_capability_hash,p_opaque_marker
  );
end;
$$;

-- Final JIT barrier: a reserved/drafted cold message cannot authorize send while stops are stale/pending.
alter function public.authorize_graph_draft_send(uuid,text,text,text)
  rename to authorize_graph_draft_send_pre_safety_20260819;
create or replace function public.authorize_graph_draft_send(
  p_reservation_id uuid,p_send_capability_hash text,p_stop_snapshot_hash text,
  p_observed_change_key_hash text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_control public.outbound_delivery_control%rowtype; v_outbox public.graph_outbox%rowtype; v_reason text; v_now timestamptz;
begin
  select * into v_control from public.outbound_delivery_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found then return pg_catalog.jsonb_build_object('authorized',false,'duplicate',false,'reason_code','control_unavailable'); end if;
  select * into v_outbox from public.graph_outbox where reservation_id=p_reservation_id for update;
  if found and v_outbox.lane='cold' then
    v_reason:=public.cold_outbound_barrier_reason(v_now);
    if v_reason is not null then
      update public.outbound_delivery_control set cold_enabled=false,halt_reason='COLD_SAFETY_BARRIER',updated_at=v_now where singleton;
      return pg_catalog.jsonb_build_object('authorized',false,'duplicate',false,'reason_code',v_reason,'reservation_id',p_reservation_id);
    end if;
  end if;
  return public.authorize_graph_draft_send_pre_safety_20260819(
    p_reservation_id,p_send_capability_hash,p_stop_snapshot_hash,p_observed_change_key_hash
  );
end;
$$;

-- One transaction owns dedupe, event insertion and all contact/sequence stop effects.
create or replace function public.record_campaign_event_atomic(
  p_campaign_external_id text,p_contact_external_id text,p_event_name text,
  p_occurred_at timestamptz,p_source_event_id text,p_context jsonb,p_properties jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_event public.campaign_events%rowtype;
  v_duplicate boolean:=false;
  v_stop boolean;
  v_suppress_marketing boolean;
begin
  if p_campaign_external_id !~ '^[A-Za-z0-9_-]{3,100}$' or
     p_contact_external_id !~ '^[A-Za-z0-9_-]{3,100}$' or
     p_event_name not in ('landing_visit','resource_started','resource_completed','checklist_downloaded',
       'calculator_completed','webinar_registered','review_submitted','diagnostic_intent','diagnostic_requested',
       'positive_reply','meeting_booked','meeting_completed','opportunity_created','delivery_sent',
       'transactional_delivery_sent','delivery_error','reply_received','bounce_hard','unsubscribe','opposition','crm_contact_updated') or
     p_occurred_at is null or p_occurred_at>pg_catalog.clock_timestamp()+interval '5 minutes' or
     (p_source_event_id is not null and pg_catalog.length(p_source_event_id) not between 1 and 256) or
     pg_catalog.jsonb_typeof(p_context)<>'object' or pg_catalog.jsonb_typeof(p_properties)<>'object' then
    raise exception using errcode='22023',message='campaign_event_invalid';
  end if;
  select * into v_campaign from public.campaigns where external_id=p_campaign_external_id for update;
  if not found then raise exception using errcode='P0002',message='campaign_unavailable'; end if;
  select * into v_contact from public.campaign_contacts
  where campaign_id=v_campaign.id and external_contact_id=p_contact_external_id for update;
  if not found then raise exception using errcode='P0002',message='campaign_contact_unavailable'; end if;
  if p_source_event_id is not null then
    select * into v_event from public.campaign_events
    where campaign_id=v_campaign.id and source_event_id=p_source_event_id for update;
    if found then
      if v_event.campaign_contact_id<>v_contact.id or v_event.event_name<>p_event_name then
        raise exception using errcode='23505',message='campaign_source_event_collision';
      end if;
      v_duplicate:=true;
    end if;
  end if;
  if not v_duplicate then
    insert into public.campaign_events(campaign_id,campaign_contact_id,source_event_id,event_name,occurred_at,context,properties)
    values(v_campaign.id,v_contact.id,p_source_event_id,p_event_name,p_occurred_at,p_context,p_properties)
    returning * into v_event;
  end if;
  v_stop:=p_event_name in ('resource_completed','checklist_downloaded','calculator_completed','webinar_registered',
    'review_submitted','diagnostic_intent','diagnostic_requested','positive_reply','meeting_booked','meeting_completed',
    'opportunity_created','reply_received','bounce_hard','unsubscribe','opposition');
  v_suppress_marketing:=p_event_name in ('meeting_booked','meeting_completed','opportunity_created','bounce_hard','unsubscribe','opposition');
  update public.campaign_contacts set
    last_event_at=greatest(coalesce(last_event_at,p_occurred_at),p_occurred_at),
    resource_started_at=case when p_event_name='resource_started' then greatest(coalesce(resource_started_at,p_occurred_at),p_occurred_at) else resource_started_at end,
    resource_completed_at=case when p_event_name in ('resource_completed','checklist_downloaded','calculator_completed','webinar_registered','review_submitted') then greatest(coalesce(resource_completed_at,p_occurred_at),p_occurred_at) else resource_completed_at end,
    meeting_booked_at=case when p_event_name='meeting_booked' then greatest(coalesce(meeting_booked_at,p_occurred_at),p_occurred_at) else meeting_booked_at end,
    meeting_completed_at=case when p_event_name='meeting_completed' then greatest(coalesce(meeting_completed_at,p_occurred_at),p_occurred_at) else meeting_completed_at end,
    opportunity_created_at=case when p_event_name='opportunity_created' then greatest(coalesce(opportunity_created_at,p_occurred_at),p_occurred_at) else opportunity_created_at end,
    reply_received_at=case when p_event_name in ('reply_received','positive_reply') then coalesce(reply_received_at,p_occurred_at) else reply_received_at end,
    cold_sequence_status=case when v_stop then 'stopped' else cold_sequence_status end,
    intent_sequence_status=case when p_event_name in ('unsubscribe','bounce_hard','meeting_booked','meeting_completed','opportunity_created') then 'stopped' when p_event_name in ('diagnostic_intent','diagnostic_requested','positive_reply') then 'eligible_disabled' else intent_sequence_status end,
    transactional_status=case when p_event_name in ('resource_completed','checklist_downloaded','calculator_completed','webinar_registered','review_submitted') then 'pending' when p_event_name='transactional_delivery_sent' then 'sent' else transactional_status end,
    marketing_lane=case when v_stop then 'none' else marketing_lane end,
    suppression_scope=case when p_event_name='unsubscribe' then 'all' when v_suppress_marketing then 'marketing' else suppression_scope end,
    sequence_status=case when v_stop then 'stopped' else sequence_status end,
    next_delivery_status=case when v_stop then 'stopped' else next_delivery_status end,
    stopped_at=case when v_stop then coalesce(stopped_at,p_occurred_at) else stopped_at end,
    stopped_reason=case when v_stop then coalesce(stopped_reason,p_event_name) else stopped_reason end,
    suppressed_at=case when v_suppress_marketing then coalesce(suppressed_at,p_occurred_at) else suppressed_at end,
    suppression_reason=case when v_suppress_marketing then coalesce(suppression_reason,p_event_name) else suppression_reason end
  where id=v_contact.id;
  if p_event_name='opposition' then
    insert into public.campaign_suppressions(
      identity_hash,scope,reason,occurred_at,source_event_id,source_campaign_id,source_contact_id
    ) values (
      v_contact.email_hash,'marketing','opposition',p_occurred_at,p_source_event_id,v_campaign.id,v_contact.id
    ) on conflict(identity_hash) do update set
      scope=case when public.campaign_suppressions.scope='all' then 'all' else 'marketing' end,
      reason=case
        when public.campaign_suppressions.scope='all' then 'unsubscribe'
        when public.campaign_suppressions.reason='hard_bounce' then 'hard_bounce'
        else 'opposition'
      end,
      occurred_at=least(public.campaign_suppressions.occurred_at,excluded.occurred_at),
      source_event_id=coalesce(public.campaign_suppressions.source_event_id,excluded.source_event_id),
      source_campaign_id=coalesce(public.campaign_suppressions.source_campaign_id,excluded.source_campaign_id),
      source_contact_id=coalesce(public.campaign_suppressions.source_contact_id,excluded.source_contact_id),
      updated_at=pg_catalog.clock_timestamp();
    update public.campaign_contacts set
      cold_sequence_status='stopped',intent_sequence_status='stopped',marketing_lane='none',
      suppression_scope=case when suppression_scope='all' then 'all' else 'marketing' end,
      sequence_status='stopped',next_delivery_status='stopped',next_scheduled_at=null,
      locked_at=null,lock_token=null,lock_expires_at=null,
      stopped_at=coalesce(stopped_at,p_occurred_at),
      stopped_reason=coalesce(stopped_reason,'opposition'),
      suppressed_at=coalesce(suppressed_at,p_occurred_at),
      suppression_reason=coalesce(suppression_reason,'opposition')
    where email_hash=v_contact.email_hash;
    update public.campaign_executions set status='stopped',
      stopped_at=coalesce(stopped_at,p_occurred_at),
      stop_reason=coalesce(stop_reason,'opposition')
    where status='planned' and campaign_contact_id in (
      select id from public.campaign_contacts where email_hash=v_contact.email_hash
    );
  end if;
  if v_stop then
    update public.campaign_executions set status='stopped',stopped_at=coalesce(stopped_at,p_occurred_at),
      stop_reason=coalesce(stop_reason,p_event_name)
    where campaign_contact_id=v_contact.id and status='planned';
  end if;
  return pg_catalog.jsonb_build_object('id',v_event.id,'duplicate',v_duplicate);
end;
$$;

revoke execute on function public.cold_outbound_barrier_reason(timestamptz) from public,anon,authenticated,service_role;
revoke execute on function public.claim_inbound_event_pre_safety_20260819(text,text,text,jsonb,integer) from public,anon,authenticated,service_role;
revoke execute on function public.reconcile_operational_alerts_pre_safety_20260819(text,timestamptz,text,jsonb,text[]) from public,anon,authenticated,service_role;
revoke execute on function public.claim_cold_campaign_dispatch_pre_safety_20260819(uuid,text,integer) from public,anon,authenticated,service_role;
revoke execute on function public.bind_cold_campaign_reservation_pre_safety_20260819(uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.authorize_graph_draft_send_pre_safety_20260819(uuid,text,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.record_campaign_event_atomic(text,text,text,timestamptz,text,jsonb,jsonb) from public,anon,authenticated;
revoke execute on function public.claim_inbound_event(text,text,text,jsonb,integer) from public,anon,authenticated;
revoke execute on function public.reconcile_operational_alerts(text,timestamptz,text,jsonb,text[]) from public,anon,authenticated;
revoke execute on function public.claim_cold_campaign_dispatch(uuid,text,integer) from public,anon,authenticated;
revoke execute on function public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.authorize_graph_draft_send(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_campaign_event_atomic(text,text,text,timestamptz,text,jsonb,jsonb) to service_role;
grant execute on function public.claim_inbound_event(text,text,text,jsonb,integer) to service_role;
grant execute on function public.reconcile_operational_alerts(text,timestamptz,text,jsonb,text[]) to service_role;
grant execute on function public.claim_cold_campaign_dispatch(uuid,text,integer) to service_role;
grant execute on function public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text) to service_role;
grant execute on function public.authorize_graph_draft_send(uuid,text,text,text) to service_role;

commit;

-- Cover every foreign key reported by the Supabase performance advisor.
-- Additive only; outbound, retention and provisioning controls remain unchanged.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '10min';

create index if not exists cold_dispatch_reservation_fk_idx
  on public.cold_campaign_dispatch_outbox (reservation_id);
create index if not exists cold_provision_manifest_campaign_fk_idx
  on public.cold_campaign_provision_manifests (campaign_id);
create index if not exists cold_scheduler_alert_dispatch_fk_idx
  on public.cold_campaign_scheduler_alerts (dispatch_id);
create index if not exists events_campaign_fk_idx
  on public.events (campaign_id);
create index if not exists graph_outbox_mailbox_reservation_fk_idx
  on public.graph_outbox (mailbox_key_hash, reservation_id);
create index if not exists inbound_ledger_contact_fk_idx
  on public.inbound_event_ledger (campaign_contact_id);
create index if not exists inbound_ledger_campaign_fk_idx
  on public.inbound_event_ledger (campaign_id);
create index if not exists mailbox_state_active_reservation_fk_idx
  on public.mailbox_throttle_state (mailbox_key_hash, active_reservation_id);
create index if not exists mailbox_state_blocked_reservation_fk_idx
  on public.mailbox_throttle_state (mailbox_key_hash, blocked_reservation_id);
create index if not exists operational_alert_receipts_dedupe_fk_idx
  on public.operational_alert_receipts (dedupe_key);

do $$
begin
  if exists (
    select 1
    from unnest(array[
      'cold_dispatch_reservation_fk_idx',
      'cold_provision_manifest_campaign_fk_idx',
      'cold_scheduler_alert_dispatch_fk_idx',
      'events_campaign_fk_idx',
      'graph_outbox_mailbox_reservation_fk_idx',
      'inbound_ledger_contact_fk_idx',
      'inbound_ledger_campaign_fk_idx',
      'mailbox_state_active_reservation_fk_idx',
      'mailbox_state_blocked_reservation_fk_idx',
      'operational_alert_receipts_dedupe_fk_idx'
    ]) as expected(index_name)
    where pg_catalog.to_regclass('public.' || expected.index_name) is null
  ) then
    raise exception using errcode = '23514',
      message = 'advisor_fk_index_hardening_incomplete';
  end if;
end;
$$;

commit;


-- 20260819224739_hubspot_sync_outbox.sql
-- Durable, idempotent HubSpot synchronization for provisioned campaign contacts.
-- The lane is independently OFF in PostgreSQL and in the application.
begin;

alter table public.outbound_delivery_control
  add column if not exists hubspot_enabled boolean not null default false;

create or replace function public.enforce_outbound_master_dominance()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if not new.master_enabled then
    new.transactional_enabled:=false;
    new.cold_enabled:=false;
    new.hubspot_enabled:=false;
  end if;
  return new;
end;
$$;

drop trigger if exists outbound_delivery_control_master_dominance
  on public.outbound_delivery_control;
create trigger outbound_delivery_control_master_dominance
before insert or update on public.outbound_delivery_control
for each row execute function public.enforce_outbound_master_dominance();

create table if not exists public.hubspot_sync_outbox (
  campaign_contact_id uuid primary key
    references public.campaign_contacts(id) on delete restrict,
  desired_version bigint not null default 1 check (desired_version >= 1),
  claimed_version bigint check (claimed_version is null or claimed_version >= 1),
  synced_version bigint not null default 0 check (synced_version >= 0),
  status text not null default 'queued_off'
    check (status in (
      'queued_off','pending','claimed','retry_wait','synced','dead_letter','halted'
    )),
  next_attempt_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  claimed_by_hash text check (
    claimed_by_hash is null or claimed_by_hash ~ '^[a-f0-9]{64}$'
  ),
  claim_token uuid,
  claim_expires_at timestamptz,
  claimed_payload_hash text check (
    claimed_payload_hash is null or claimed_payload_hash ~ '^[a-f0-9]{64}$'
  ),
  last_error_code text,
  last_evidence_hash text check (
    last_evidence_hash is null or last_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (status='claimed' and claimed_by_hash is not null and claim_token is not null
      and claim_expires_at is not null and claimed_version is not null
      and claimed_payload_hash is not null)
    or
    (status<>'claimed' and claimed_by_hash is null and claim_token is null
      and claim_expires_at is null and claimed_version is null
      and claimed_payload_hash is null)
  )
);

create index if not exists hubspot_sync_outbox_due_idx
  on public.hubspot_sync_outbox(status,next_attempt_at,created_at)
  where status in ('queued_off','pending','retry_wait','claimed');
create index if not exists hubspot_sync_outbox_dead_letter_idx
  on public.hubspot_sync_outbox(updated_at)
  where status='dead_letter';

create or replace function public.enqueue_campaign_contact_hubspot_sync()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_target_status text;
begin
  select * into v_control
  from public.outbound_delivery_control
  where singleton;
  v_target_status:=case
    when found and v_control.master_enabled and v_control.hubspot_enabled
      then 'pending'
    else 'queued_off'
  end;

  insert into public.hubspot_sync_outbox(
    campaign_contact_id,desired_version,status,next_attempt_at,updated_at
  ) values (
    new.id,1,v_target_status,v_now,v_now
  )
  on conflict(campaign_contact_id) do update set
    desired_version=public.hubspot_sync_outbox.desired_version+1,
    status=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then 'claimed'
      else v_target_status
    end,
    next_attempt_at=v_now,
    attempt_count=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then public.hubspot_sync_outbox.attempt_count
      else 0
    end,
    claimed_by_hash=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then public.hubspot_sync_outbox.claimed_by_hash
      else null
    end,
    claim_token=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then public.hubspot_sync_outbox.claim_token
      else null
    end,
    claim_expires_at=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then public.hubspot_sync_outbox.claim_expires_at
      else null
    end,
    claimed_version=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then public.hubspot_sync_outbox.claimed_version
      else null
    end,
    claimed_payload_hash=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then public.hubspot_sync_outbox.claimed_payload_hash
      else null
    end,
    last_error_code=null,
    updated_at=v_now;
  return new;
end;
$$;

drop trigger if exists campaign_contacts_enqueue_hubspot_insert
  on public.campaign_contacts;
create trigger campaign_contacts_enqueue_hubspot_insert
after insert on public.campaign_contacts
for each row execute function public.enqueue_campaign_contact_hubspot_sync();

drop trigger if exists campaign_contacts_enqueue_hubspot_state
  on public.campaign_contacts;
create trigger campaign_contacts_enqueue_hubspot_state
after update of
  external_account_id,email_hash,contact_data,variant,magnet,company_size,
  sequence_status,suppression_scope,suppression_reason,reply_type,
  meeting_booked_at,opportunity_created_at,deal_value
on public.campaign_contacts
for each row
when (
  old.external_account_id is distinct from new.external_account_id or
  old.email_hash is distinct from new.email_hash or
  old.contact_data is distinct from new.contact_data or
  old.variant is distinct from new.variant or
  old.magnet is distinct from new.magnet or
  old.company_size is distinct from new.company_size or
  old.sequence_status is distinct from new.sequence_status or
  old.suppression_scope is distinct from new.suppression_scope or
  old.suppression_reason is distinct from new.suppression_reason or
  old.reply_type is distinct from new.reply_type or
  old.meeting_booked_at is distinct from new.meeting_booked_at or
  old.opportunity_created_at is distinct from new.opportunity_created_at or
  old.deal_value is distinct from new.deal_value
)
execute function public.enqueue_campaign_contact_hubspot_sync();

insert into public.hubspot_sync_outbox(
  campaign_contact_id,desired_version,status,next_attempt_at
)
select id,1,'queued_off',clock_timestamp()
from public.campaign_contacts
on conflict(campaign_contact_id) do nothing;

create or replace function public.claim_hubspot_sync_outbox(
  p_worker_hash text,
  p_limit integer default 50,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_now timestamptz;
  v_item record;
  v_token uuid;
  v_payload_hash text;
  v_items jsonb:='[]'::jsonb;
begin
  if p_worker_hash is null or p_worker_hash !~ '^[a-f0-9]{64}$' or
     p_limit not between 1 and 100 or p_lease_seconds not between 30 and 300 then
    return jsonb_build_object(
      'accepted',false,'reason_code','invalid_request','items','[]'::jsonb
    );
  end if;
  select * into v_control
  from public.outbound_delivery_control
  where singleton
  for update;
  v_now:=clock_timestamp();
  if not found or not v_control.master_enabled or not v_control.hubspot_enabled then
    return jsonb_build_object(
      'accepted',false,'reason_code','hubspot_off','items','[]'::jsonb
    );
  end if;

  for v_item in
    select
      o.campaign_contact_id,o.desired_version,o.status,o.attempt_count,
      cc.external_contact_id,cc.external_account_id,cc.email_hash,cc.contact_data,
      cc.variant,cc.magnet,cc.company_size,cc.sequence_status,
      c.external_id as campaign_external_id
    from public.hubspot_sync_outbox o
    join public.campaign_contacts cc on cc.id=o.campaign_contact_id
    join public.campaigns c on c.id=cc.campaign_id
    where (
      o.status in ('queued_off','pending','retry_wait') and o.next_attempt_at<=v_now
    ) or (
      o.status='claimed' and o.claim_expires_at<=v_now
    )
    order by
      case when cc.suppression_scope<>'none' or cc.sequence_status='stopped'
        then 0 else 1 end,
      o.next_attempt_at,o.created_at,o.campaign_contact_id
    limit p_limit
    for update of o skip locked
  loop
    if v_item.contact_data->>'email' is null or
       v_item.contact_data->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      update public.hubspot_sync_outbox set
        status='halted',last_error_code='identity_unavailable',
        claimed_by_hash=null,claim_token=null,claim_expires_at=null,
        claimed_version=null,claimed_payload_hash=null,updated_at=v_now
      where campaign_contact_id=v_item.campaign_contact_id;
      continue;
    end if;
    v_token:=gen_random_uuid();
    v_payload_hash:=encode(extensions.digest(convert_to(concat_ws(chr(31),
      'hubspot-contact-sync-v1',v_item.campaign_contact_id::text,
      v_item.desired_version::text,v_item.email_hash,
      v_item.contact_data->>'email',v_item.external_contact_id,
      v_item.external_account_id,v_item.campaign_external_id,v_item.variant,
      v_item.magnet,coalesce(v_item.company_size,''),
      v_item.sequence_status,coalesce(v_item.contact_data->>'first_name',''),
      coalesce(v_item.contact_data->>'last_name',''),
      coalesce(v_item.contact_data->>'company_name',''),
      coalesce(v_item.contact_data->>'job_title','')
    ),'UTF8'),'sha256'),'hex');
    update public.hubspot_sync_outbox set
      status='claimed',attempt_count=least(attempt_count+1,8),
      claimed_by_hash=p_worker_hash,claim_token=v_token,
      claim_expires_at=v_now+p_lease_seconds*interval '1 second',
      claimed_version=v_item.desired_version,
      claimed_payload_hash=v_payload_hash,updated_at=v_now
    where campaign_contact_id=v_item.campaign_contact_id;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'campaign_contact_id',v_item.campaign_contact_id,
      'version',v_item.desired_version,
      'payload_hash',v_payload_hash,
      'claim_token',v_token,
      'lead_id',v_item.email_hash,
      'external_contact_id',v_item.external_contact_id,
      'external_account_id',v_item.external_account_id,
      'email',v_item.contact_data->>'email',
      'first_name',nullif(v_item.contact_data->>'first_name',''),
      'last_name',nullif(v_item.contact_data->>'last_name',''),
      'company_name',nullif(v_item.contact_data->>'company_name',''),
      'job_title',nullif(v_item.contact_data->>'job_title',''),
      'company_size',v_item.company_size,
      'campaign_external_id',v_item.campaign_external_id,
      'variant',v_item.variant,'magnet',v_item.magnet,
      'sequence_status',v_item.sequence_status
    ));
  end loop;
  return jsonb_build_object(
    'accepted',true,'reason_code',
    case when jsonb_array_length(v_items)=0 then 'empty' else 'claimed' end,
    'items',v_items
  );
end;
$$;

create or replace function public.finalize_hubspot_sync_outbox(
  p_campaign_contact_id uuid,
  p_worker_hash text,
  p_claim_token uuid,
  p_version bigint,
  p_outcome text,
  p_hubspot_contact_id text,
  p_evidence_hash text,
  p_failure_code text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_contact public.campaign_contacts%rowtype;
  v_item public.hubspot_sync_outbox%rowtype;
  v_status text;
  v_stale boolean;
begin
  if p_campaign_contact_id is null or p_worker_hash !~ '^[a-f0-9]{64}$' or
     p_claim_token is null or p_version<1 or
     p_outcome not in ('synced','retryable_failure','definitive_failure') or
     p_evidence_hash !~ '^[a-f0-9]{64}$' or
     (p_outcome='synced' and
       (p_hubspot_contact_id is null or length(p_hubspot_contact_id) not between 1 and 128)) then
    return jsonb_build_object('accepted',false,'reason_code','invalid_request');
  end if;
  select * into v_contact
  from public.campaign_contacts
  where id=p_campaign_contact_id
  for update;
  select * into v_item
  from public.hubspot_sync_outbox
  where campaign_contact_id=p_campaign_contact_id
  for update;
  v_now:=clock_timestamp();
  if not found or v_contact.id is null or v_item.status<>'claimed' or
     v_item.claimed_by_hash<>p_worker_hash or v_item.claim_token<>p_claim_token or
     v_item.claimed_version<>p_version or v_item.claim_expires_at<=v_now then
    return jsonb_build_object('accepted',false,'reason_code','claim_unavailable');
  end if;
  v_stale:=v_item.desired_version<>p_version;
  if p_outcome='synced' then
    update public.campaign_contacts set
      hubspot_contact_id=p_hubspot_contact_id,
      hubspot_sync_status=case when v_stale then 'pending' else 'synced' end,
      hubspot_synced_at=v_now
    where id=p_campaign_contact_id;
    v_status:=case when v_stale then 'pending' else 'synced' end;
    update public.hubspot_sync_outbox set
      synced_version=greatest(synced_version,p_version),status=v_status,
      next_attempt_at=case when v_stale then v_now else next_attempt_at end,
      last_error_code=null,last_evidence_hash=p_evidence_hash,
      claimed_by_hash=null,claim_token=null,claim_expires_at=null,
      claimed_version=null,claimed_payload_hash=null,updated_at=v_now
    where campaign_contact_id=p_campaign_contact_id;
  else
    v_status:=case
      when p_outcome='definitive_failure' or v_item.attempt_count>=8
        then 'dead_letter'
      else 'retry_wait'
    end;
    update public.campaign_contacts set hubspot_sync_status=v_status
    where id=p_campaign_contact_id;
    update public.hubspot_sync_outbox set
      status=v_status,
      next_attempt_at=case when v_status='retry_wait'
        then v_now+least(3600,30*(2^least(attempt_count,6)))::integer*interval '1 second'
        else next_attempt_at end,
      last_error_code=left(coalesce(p_failure_code,'hubspot_sync_failed'),128),
      last_evidence_hash=p_evidence_hash,
      claimed_by_hash=null,claim_token=null,claim_expires_at=null,
      claimed_version=null,claimed_payload_hash=null,updated_at=v_now
    where campaign_contact_id=p_campaign_contact_id;
    if v_status='dead_letter' and
       to_regprocedure('public.enqueue_operational_alert_delivery(text,text,text,text)') is not null then
      execute
        'select public.enqueue_operational_alert_delivery($1,$2,$3,$4)'
      using
        'HUBSPOT_SYNC_DEAD_LETTER',
        encode(extensions.digest(convert_to(p_campaign_contact_id::text,'UTF8'),'sha256'),'hex'),
        p_evidence_hash,
        p_worker_hash;
    end if;
  end if;
  return jsonb_build_object(
    'accepted',true,'reason_code',v_status,'stale',v_stale,
    'desired_version',v_item.desired_version,'finalized_version',p_version
  );
end;
$$;

alter table public.hubspot_sync_outbox enable row level security;
alter table public.hubspot_sync_outbox force row level security;
revoke all privileges on table public.hubspot_sync_outbox
  from public,anon,authenticated,service_role;
revoke execute on function public.enforce_outbound_master_dominance(),
  public.enqueue_campaign_contact_hubspot_sync()
  from public,anon,authenticated,service_role;
revoke execute on function public.claim_hubspot_sync_outbox(text,integer,integer),
  public.finalize_hubspot_sync_outbox(uuid,text,uuid,bigint,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.claim_hubspot_sync_outbox(text,integer,integer),
  public.finalize_hubspot_sync_outbox(uuid,text,uuid,bigint,text,text,text,text)
  to service_role;

update public.outbound_delivery_control
set hubspot_enabled=false,updated_at=clock_timestamp()
where singleton;

commit;

-- 20260819230000_durable_operational_alert_delivery.sql
-- Durable, claimable delivery intent for critical Graph/dispatch alerts.
-- This migration only adds fail-closed persistence and retry machinery; it enables no lane.
begin;

set local lock_timeout='10s';
set local statement_timeout='10min';
set local search_path='';

alter table public.transactional_dispatch_outbox
  add column last_reason_code text check (
    last_reason_code is null or last_reason_code ~ '^[A-Z][A-Z0-9_:-]{2,63}$'
  );

alter table public.operational_alert_receipts
  add column delivery_status text not null default 'not_requested',
  add column reservation_hash text,
  add column evidence_hash text,
  add column delivery_attempt_count integer not null default 0,
  add column next_attempt_at timestamptz,
  add column claimed_by_hash text,
  add column claim_token_hash text,
  add column claim_expires_at timestamptz,
  add column delivered_at timestamptz,
  add column last_attempt_evidence_hash text,
  add column last_failure_code text,
  add column delivery_updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  add constraint operational_alert_receipts_delivery_status_check check (
    delivery_status in ('not_requested','pending','claimed','delivered','dead_letter')
  ),
  add constraint operational_alert_receipts_delivery_attempt_check check (
    delivery_attempt_count between 0 and 8
  ),
  add constraint operational_alert_receipts_delivery_hashes_check check (
    (delivery_status='not_requested' and reservation_hash is null and evidence_hash is null)
    or (delivery_status<>'not_requested' and reservation_hash is not null
      and reservation_hash ~ '^[a-f0-9]{64}$' and evidence_hash is not null
      and evidence_hash ~ '^[a-f0-9]{64}$')
  ),
  add constraint operational_alert_receipts_delivery_claim_check check (
    (delivery_status='claimed' and claimed_by_hash is not null
      and claimed_by_hash ~ '^[a-f0-9]{64}$' and claim_token_hash is not null
      and claim_token_hash ~ '^[a-f0-9]{64}$' and claim_expires_at is not null)
    or (delivery_status<>'claimed' and claimed_by_hash is null
      and claim_token_hash is null and claim_expires_at is null)
  ),
  add constraint operational_alert_receipts_delivery_terminal_check check (
    (delivery_status='delivered' and delivered_at is not null
      and last_attempt_evidence_hash is not null
      and last_attempt_evidence_hash ~ '^[a-f0-9]{64}$')
    or (delivery_status<>'delivered' and delivered_at is null)
  ),
  add constraint operational_alert_receipts_delivery_optional_hash_check check (
    last_attempt_evidence_hash is null or last_attempt_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  add constraint operational_alert_receipts_delivery_failure_check check (
    last_failure_code is null or last_failure_code ~ '^[A-Z][A-Z0-9_:-]{1,63}$'
  );

create index operational_alert_receipts_delivery_pending_idx
  on public.operational_alert_receipts(next_attempt_at,observed_at,evaluation_key,dedupe_key)
  where delivery_status='pending';
create index operational_alert_receipts_delivery_claimed_idx
  on public.operational_alert_receipts(claim_expires_at,observed_at,evaluation_key,dedupe_key)
  where delivery_status='claimed';

create or replace function fundae_private.normalize_operational_alert_code(p_code text)
returns text
language sql
immutable
set search_path=''
as $$
  select case
    when substring(
      pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_code,''),'[^A-Za-z0-9_]+','_','g'))
      from 1 for 64
    ) ~ '^[A-Z][A-Z0-9_]{2,63}$'
    then substring(
      pg_catalog.upper(pg_catalog.regexp_replace(p_code,'[^A-Za-z0-9_]+','_','g'))
      from 1 for 64
    )
    else 'AMBIGUOUS_GRAPH_OUTBOX_HALTED'
  end
$$;

revoke all on function fundae_private.normalize_operational_alert_code(text)
  from public,anon,authenticated,service_role;

create or replace function public.enqueue_operational_alert_delivery(
  p_summary_code text,
  p_reservation_hash text,
  p_evidence_hash text,
  p_actor_hash text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_summary text := fundae_private.normalize_operational_alert_code(p_summary_code);
  v_dedupe_key text;
  v_evaluation_key text;
  v_alert public.operational_alerts%rowtype;
  v_receipt public.operational_alert_receipts%rowtype;
  v_alert_inserted integer;
  v_receipt_inserted integer;
  v_previous_lifecycle text;
begin
  if p_summary_code is null or v_summary<>p_summary_code
     or p_reservation_hash is null or p_reservation_hash !~ '^[a-f0-9]{64}$'
     or p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$'
     or p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='invalid_operational_alert_delivery';
  end if;
  v_dedupe_key:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.concat_ws(pg_catalog.chr(31),'critical-alert-v1',v_summary,p_reservation_hash,p_evidence_hash),
    'UTF8'),'sha256'),'hex');
  v_evaluation_key:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.concat_ws(pg_catalog.chr(31),'critical-alert-evaluation-v1',v_dedupe_key),
    'UTF8'),'sha256'),'hex');

  insert into public.operational_alerts(
    dedupe_key,signal_code,severity,summary_code,metrics,first_detected_at,last_detected_at
  ) values (
    v_dedupe_key,'graph_outbox','critical',v_summary,
    pg_catalog.jsonb_build_object('durable_delivery',true),v_now,v_now
  ) on conflict(dedupe_key) do nothing;
  get diagnostics v_alert_inserted=row_count;
  select * into strict v_alert from public.operational_alerts
  where dedupe_key=v_dedupe_key for update;
  if v_alert.signal_code<>'graph_outbox' or v_alert.severity<>'critical'
     or v_alert.summary_code<>v_summary then
    raise exception using errcode='23505',message='operational_alert_delivery_dedupe_collision';
  end if;
  v_previous_lifecycle:=v_alert.lifecycle;

  insert into public.operational_alert_receipts(
    evaluation_key,dedupe_key,observed_at,delivery_status,reservation_hash,evidence_hash,
    next_attempt_at,delivery_updated_at
  ) values (
    v_evaluation_key,v_dedupe_key,v_now,'pending',p_reservation_hash,p_evidence_hash,
    v_now,v_now
  ) on conflict(evaluation_key,dedupe_key) do nothing;
  get diagnostics v_receipt_inserted=row_count;
  select * into strict v_receipt from public.operational_alert_receipts
  where evaluation_key=v_evaluation_key and dedupe_key=v_dedupe_key for update;
  if v_receipt.delivery_status='not_requested' then
    update public.operational_alert_receipts
    set delivery_status='pending',reservation_hash=p_reservation_hash,
      evidence_hash=p_evidence_hash,next_attempt_at=v_now,delivery_updated_at=v_now
    where evaluation_key=v_evaluation_key and dedupe_key=v_dedupe_key
    returning * into v_receipt;
    v_receipt_inserted:=1;
  elsif v_receipt.reservation_hash is distinct from p_reservation_hash
     or v_receipt.evidence_hash is distinct from p_evidence_hash then
    raise exception using errcode='23505',message='operational_alert_delivery_receipt_collision';
  end if;

  if v_receipt_inserted=1 then
    update public.operational_alerts
    set lifecycle=case when lifecycle='resolved' then 'open' else lifecycle end,
      last_detected_at=greatest(last_detected_at,v_now),
      occurrence_count=occurrence_count+case when v_alert_inserted=1 then 0 else 1 end,
      resolved_at=null,resolved_by_hash=null,updated_at=v_now
    where id=v_alert.id;
    insert into public.operational_alert_audit(
      alert_id,action,actor_hash,evaluation_key,occurred_at,evidence
    ) values (
      v_alert.id,case when v_previous_lifecycle='resolved' then 'reopened' else 'detected' end,
      p_actor_hash,v_evaluation_key,v_now,pg_catalog.jsonb_build_object('durable_delivery',true)
    ) on conflict do nothing;
  end if;
  return pg_catalog.jsonb_build_object(
    'accepted',true,'duplicate',v_receipt_inserted=0,'dedupe_key',v_dedupe_key,
    'evaluation_key',v_evaluation_key,'delivery_status',v_receipt.delivery_status
  );
end;
$$;

create or replace function public.claim_operational_alert_delivery(
  p_worker_hash text,
  p_lease_seconds integer,
  p_evaluation_key text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_receipt public.operational_alert_receipts%rowtype;
  v_summary text;
  v_token uuid;
begin
  if p_worker_hash is null or p_worker_hash !~ '^[a-f0-9]{64}$'
     or p_lease_seconds is null or p_lease_seconds not between 15 and 300
     or (p_evaluation_key is not null and p_evaluation_key !~ '^[a-f0-9]{64}$') then
    raise exception using errcode='22023',message='invalid_operational_alert_delivery_claim';
  end if;
  update public.operational_alert_receipts
  set delivery_status='dead_letter',claimed_by_hash=null,claim_token_hash=null,
    claim_expires_at=null,next_attempt_at=null,last_failure_code='ATTEMPTS_EXHAUSTED',
    delivery_updated_at=v_now
  where delivery_attempt_count>=8 and (
    delivery_status='pending' or
    (delivery_status='claimed' and claim_expires_at<=v_now)
  );

  select r.* into v_receipt
  from public.operational_alert_receipts r
  where (p_evaluation_key is null or r.evaluation_key=p_evaluation_key)
    and r.delivery_attempt_count<8 and (
      (r.delivery_status='pending' and r.next_attempt_at<=v_now)
      or (r.delivery_status='claimed' and r.claim_expires_at<=v_now)
    )
  order by r.observed_at,r.evaluation_key,r.dedupe_key
  limit 1 for update of r skip locked;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted',true,'reason_code',case when p_evaluation_key is not null and exists(
        select 1 from public.operational_alert_receipts
        where evaluation_key=p_evaluation_key and delivery_status='delivered'
      ) then 'already_delivered' else 'empty' end,'items','[]'::jsonb
    );
  end if;
  select summary_code into strict v_summary from public.operational_alerts
  where dedupe_key=v_receipt.dedupe_key;
  v_token:=extensions.gen_random_uuid();
  update public.operational_alert_receipts
  set delivery_status='claimed',delivery_attempt_count=delivery_attempt_count+1,
    claimed_by_hash=p_worker_hash,
    claim_token_hash=pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_token::text,'UTF8'),'sha256'),'hex'),
    claim_expires_at=v_now+pg_catalog.make_interval(secs=>p_lease_seconds),
    delivery_updated_at=v_now
  where evaluation_key=v_receipt.evaluation_key and dedupe_key=v_receipt.dedupe_key
  returning * into v_receipt;
  return pg_catalog.jsonb_build_object(
    'accepted',true,'reason_code','claimed','items',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'evaluation_key',v_receipt.evaluation_key,'dedupe_key',v_receipt.dedupe_key,
        'summary_code',v_summary,'reservation_hash',v_receipt.reservation_hash,
        'evidence_hash',v_receipt.evidence_hash,'attempt',v_receipt.delivery_attempt_count,
        'claim_token',v_token,'claim_expires_at',v_receipt.claim_expires_at
      )
    )
  );
end;
$$;

create or replace function public.finalize_operational_alert_delivery(
  p_evaluation_key text,
  p_dedupe_key text,
  p_worker_hash text,
  p_claim_token uuid,
  p_outcome text,
  p_attempt_evidence_hash text,
  p_failure_code text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_receipt public.operational_alert_receipts%rowtype;
  v_terminal boolean;
begin
  if p_evaluation_key is null or p_evaluation_key !~ '^[a-f0-9]{64}$'
     or p_dedupe_key is null or p_dedupe_key !~ '^[a-f0-9]{64}$'
     or p_worker_hash is null or p_worker_hash !~ '^[a-f0-9]{64}$' or p_claim_token is null
     or p_outcome is null or p_outcome not in ('delivered','retry')
     or p_attempt_evidence_hash is null or p_attempt_evidence_hash !~ '^[a-f0-9]{64}$'
     or (p_outcome='delivered' and p_failure_code is not null)
     or (p_outcome='retry' and (p_failure_code is null
       or p_failure_code !~ '^[A-Z][A-Z0-9_:-]{1,63}$')) then
    raise exception using errcode='22023',message='invalid_operational_alert_delivery_finalize';
  end if;
  select * into v_receipt from public.operational_alert_receipts
  where evaluation_key=p_evaluation_key and dedupe_key=p_dedupe_key for update;
  if not found then
    raise exception using errcode='P0002',message='operational_alert_delivery_not_found';
  end if;
  if p_outcome='delivered' and v_receipt.delivery_status='delivered'
     and v_receipt.last_attempt_evidence_hash=p_attempt_evidence_hash then
    return pg_catalog.jsonb_build_object('accepted',true,'duplicate',true,'delivery_status','delivered');
  end if;
  if p_outcome='retry' and v_receipt.delivery_status in ('pending','dead_letter')
     and v_receipt.last_attempt_evidence_hash=p_attempt_evidence_hash
     and v_receipt.last_failure_code=p_failure_code then
    return pg_catalog.jsonb_build_object('accepted',true,'duplicate',true,'delivery_status',v_receipt.delivery_status);
  end if;
  if v_receipt.delivery_status<>'claimed' or v_receipt.claimed_by_hash<>p_worker_hash
     or v_receipt.claim_expires_at<=v_now
     or v_receipt.claim_token_hash<>pg_catalog.encode(extensions.digest(
       pg_catalog.convert_to(p_claim_token::text,'UTF8'),'sha256'),'hex') then
    raise exception using errcode='55000',message='operational_alert_delivery_claim_lost';
  end if;
  v_terminal:=p_outcome='retry' and v_receipt.delivery_attempt_count>=8;
  update public.operational_alert_receipts
  set delivery_status=case when p_outcome='delivered' then 'delivered'
      when v_terminal then 'dead_letter' else 'pending' end,
    next_attempt_at=case when p_outcome='retry' and not v_terminal then
      v_now+pg_catalog.make_interval(secs=>least(3600,30*(2^(v_receipt.delivery_attempt_count-1)))::integer)
      else null end,
    claimed_by_hash=null,claim_token_hash=null,claim_expires_at=null,
    delivered_at=case when p_outcome='delivered' then v_now else null end,
    last_attempt_evidence_hash=p_attempt_evidence_hash,last_failure_code=p_failure_code,
    delivery_updated_at=v_now
  where evaluation_key=p_evaluation_key and dedupe_key=p_dedupe_key;
  return pg_catalog.jsonb_build_object(
    'accepted',true,'duplicate',false,'delivery_status',case
      when p_outcome='delivered' then 'delivered'
      when v_terminal then 'dead_letter' else 'pending' end
  );
end;
$$;

create or replace function public.halt_transactional_graph_dispatch(
  p_dispatch_id uuid,p_worker_id uuid,p_reason_code text,p_evidence_hash text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_dispatch public.transactional_dispatch_outbox%rowtype;
  v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  if p_dispatch_id is null or p_worker_id is null
     or p_reason_code is null or p_reason_code !~ '^[A-Z][A-Z0-9_:-]{2,63}$'
     or p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object('accepted',false,'reason_code','invalid_request');
  end if;
  select * into v_dispatch from public.transactional_dispatch_outbox
  where id=p_dispatch_id for update;
  if not found then return pg_catalog.jsonb_build_object('accepted',false,'reason_code','dispatch_unavailable'); end if;
  if v_dispatch.status='ambiguous_halted' and v_dispatch.last_reason_code=p_reason_code
     and v_dispatch.outcome_evidence_hash=p_evidence_hash then
    return pg_catalog.jsonb_build_object('accepted',true,'duplicate',true,'reason_code','ambiguous_halted');
  end if;
  if v_dispatch.claimed_by is distinct from p_worker_id or v_dispatch.status<>'reserved' then
    return pg_catalog.jsonb_build_object('accepted',false,'reason_code','claim_unavailable');
  end if;
  update public.transactional_dispatch_outbox
  set status='ambiguous_halted',last_reason_code=p_reason_code,
    outcome_evidence_hash=p_evidence_hash,terminal_at=v_now,updated_at=v_now
  where id=p_dispatch_id;
  update public.outbound_delivery_control
  set transactional_enabled=false,halt_reason=p_reason_code,updated_at=v_now where singleton;
  return pg_catalog.jsonb_build_object('accepted',true,'duplicate',false,'reason_code','ambiguous_halted');
end;
$$;

create or replace function public.capture_graph_outbox_ambiguity()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_code text:=fundae_private.normalize_operational_alert_code(
    coalesce(new.failure_code,'AMBIGUOUS_GRAPH_OUTBOX_HALTED')
  );
  v_actor text:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('database-alert-trigger-v1','UTF8'),'sha256'),'hex');
begin
  update public.outbound_delivery_control
  set transactional_enabled=case when new.lane='transactional' then false else transactional_enabled end,
    cold_enabled=case when new.lane='cold' then false else cold_enabled end,
    halt_reason=v_code,updated_at=pg_catalog.clock_timestamp() where singleton;
  perform public.enqueue_operational_alert_delivery(
    v_code,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(new.reservation_id::text,'UTF8'),'sha256'),'hex'),
    new.terminal_evidence_hash,v_actor
  );
  return new;
end;
$$;

create or replace function public.capture_cold_dispatch_ambiguity()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_code text:=fundae_private.normalize_operational_alert_code(
    case when new.last_reason_code like 'AMBIGUOUS_%' then new.last_reason_code
      else 'AMBIGUOUS_COLD_'||new.last_reason_code end
  );
  v_context text:=coalesce(new.reservation_id::text,new.id::text);
  v_actor text:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('database-alert-trigger-v1','UTF8'),'sha256'),'hex');
begin
  update public.outbound_delivery_control
  set cold_enabled=false,halt_reason=v_code,updated_at=pg_catalog.clock_timestamp() where singleton;
  perform public.enqueue_operational_alert_delivery(
    v_code,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_context,'UTF8'),'sha256'),'hex'),
    new.terminal_evidence_hash,v_actor
  );
  return new;
end;
$$;

create or replace function public.capture_transactional_dispatch_ambiguity()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_code text:=fundae_private.normalize_operational_alert_code(
    case when new.last_reason_code like 'AMBIGUOUS_%' then new.last_reason_code
      else 'AMBIGUOUS_'||new.last_reason_code end
  );
  v_context text:=coalesce(new.reservation_id::text,new.id::text);
  v_actor text:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('database-alert-trigger-v1','UTF8'),'sha256'),'hex');
begin
  update public.outbound_delivery_control
  set transactional_enabled=false,halt_reason=v_code,updated_at=pg_catalog.clock_timestamp() where singleton;
  perform public.enqueue_operational_alert_delivery(
    v_code,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_context,'UTF8'),'sha256'),'hex'),
    new.outcome_evidence_hash,v_actor
  );
  return new;
end;
$$;

create trigger graph_outbox_capture_ambiguity
after update of state on public.graph_outbox
for each row when (new.state='ambiguous_halted' and old.state is distinct from new.state
  and new.terminal_evidence_hash is not null)
execute function public.capture_graph_outbox_ambiguity();
create trigger cold_dispatch_capture_ambiguity
after update of status on public.cold_campaign_dispatch_outbox
for each row when (new.status='ambiguous_halted' and old.status is distinct from new.status
  and new.last_reason_code is not null and new.terminal_evidence_hash is not null)
execute function public.capture_cold_dispatch_ambiguity();
create trigger transactional_dispatch_capture_ambiguity
after update of status on public.transactional_dispatch_outbox
for each row when (new.status='ambiguous_halted' and old.status is distinct from new.status
  and new.last_reason_code is not null and new.outcome_evidence_hash is not null)
execute function public.capture_transactional_dispatch_ambiguity();

-- Backfill any pre-existing halt so migration ordering cannot lose its alert intent.
do $$
declare
  v_item record;
  v_actor text:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('database-alert-trigger-v1','UTF8'),'sha256'),'hex');
begin
  update public.transactional_dispatch_outbox
  set last_reason_code='AMBIGUOUS_TRANSACTIONAL_DISPATCH_HALTED'
  where status='ambiguous_halted' and last_reason_code is null;
  update public.outbound_delivery_control
  set transactional_enabled=case when exists(
        select 1 from public.graph_outbox where state='ambiguous_halted' and lane='transactional'
      ) or exists(
        select 1 from public.transactional_dispatch_outbox where status='ambiguous_halted'
      ) then false else transactional_enabled end,
    cold_enabled=case when exists(
        select 1 from public.graph_outbox where state='ambiguous_halted' and lane='cold'
      ) or exists(
        select 1 from public.cold_campaign_dispatch_outbox where status='ambiguous_halted'
      ) then false else cold_enabled end,
    updated_at=pg_catalog.clock_timestamp()
  where singleton;
  for v_item in
    select fundae_private.normalize_operational_alert_code(
        coalesce(failure_code,'AMBIGUOUS_GRAPH_OUTBOX_HALTED')
      ) as summary_code,
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(reservation_id::text,'UTF8'),'sha256'),'hex') as reservation_hash,
      terminal_evidence_hash as evidence_hash
    from public.graph_outbox where state='ambiguous_halted'
    union all
    select fundae_private.normalize_operational_alert_code(
        case when last_reason_code like 'AMBIGUOUS_%' then last_reason_code
          else 'AMBIGUOUS_COLD_'||last_reason_code end
      ),
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(reservation_id::text,id::text),'UTF8'),'sha256'),'hex'),
      terminal_evidence_hash
    from public.cold_campaign_dispatch_outbox
    where status='ambiguous_halted' and last_reason_code is not null
    union all
    select 'AMBIGUOUS_TRANSACTIONAL_DISPATCH_HALTED',
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        coalesce(reservation_id::text,id::text),'UTF8'
      ),'sha256'),'hex'),
      outcome_evidence_hash
    from public.transactional_dispatch_outbox
    where status='ambiguous_halted'
      and last_reason_code='AMBIGUOUS_TRANSACTIONAL_DISPATCH_HALTED'
  loop
    perform public.enqueue_operational_alert_delivery(
      v_item.summary_code,v_item.reservation_hash,v_item.evidence_hash,v_actor
    );
  end loop;
end;
$$;

revoke execute on function public.enqueue_operational_alert_delivery(text,text,text,text)
  from public,anon,authenticated;
revoke execute on function public.claim_operational_alert_delivery(text,integer,text)
  from public,anon,authenticated;
revoke execute on function public.finalize_operational_alert_delivery(text,text,text,uuid,text,text,text)
  from public,anon,authenticated;
revoke execute on function public.halt_transactional_graph_dispatch(uuid,uuid,text,text)
  from public,anon,authenticated;
revoke execute on function public.capture_graph_outbox_ambiguity(),
  public.capture_cold_dispatch_ambiguity(),public.capture_transactional_dispatch_ambiguity()
  from public,anon,authenticated,service_role;
grant execute on function public.enqueue_operational_alert_delivery(text,text,text,text),
  public.claim_operational_alert_delivery(text,integer,text),
  public.finalize_operational_alert_delivery(text,text,text,uuid,text,text,text),
  public.halt_transactional_graph_dispatch(uuid,uuid,text,text)
  to service_role;

commit;

-- 20260819233000_transactional_graph_pilot_scope.sql
-- Exact four-resource Graph pilot scope. The migration itself leaves every lane OFF.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '10min';
create extension if not exists pg_cron;

create table if not exists public.transactional_graph_pilot_runs (
  run_id text primary key check (run_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$'),
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  authorization_hash text not null check (authorization_hash ~ '^[a-f0-9]{64}$'),
  approval_evidence_hash text not null check (approval_evidence_hash ~ '^[a-f0-9]{64}$'),
  allowed_lead_id text not null check (allowed_lead_id ~ '^[a-f0-9]{64}$'),
  submission_ids text[] not null,
  submission_set_hash text not null check (submission_set_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('active', 'completed', 'halted', 'expired')),
  expires_at timestamptz not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  finish_evidence_hash text check (
    finish_evidence_hash is null or finish_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (pg_catalog.array_length(submission_ids, 1) = 4),
  check (
    (status = 'active' and finished_at is null and finish_evidence_hash is null) or
    (status <> 'active' and finished_at is not null and finish_evidence_hash is not null)
  )
);

create unique index if not exists transactional_graph_pilot_one_active_idx
  on public.transactional_graph_pilot_runs ((status)) where status = 'active';
create index if not exists transactional_graph_pilot_expiry_idx
  on public.transactional_graph_pilot_runs (expires_at) where status = 'active';

create table if not exists fundae_private.transactional_graph_pilot_authorization_grants (
  authorization_nonce_hash text primary key check (
    authorization_nonce_hash ~ '^[a-f0-9]{64}$'
  ),
  authorized_run_id text not null unique check (
    authorized_run_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$'
  ),
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  allowed_lead_id text not null check (allowed_lead_id ~ '^[a-f0-9]{64}$'),
  submission_set_hash text not null check (submission_set_hash ~ '^[a-f0-9]{64}$'),
  max_ttl_seconds integer not null check (max_ttl_seconds between 120 and 900),
  expires_at timestamptz not null,
  approval_evidence_hash text not null check (
    approval_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  consumed_at timestamptz,
  consumed_run_id text unique,
  revoked_at timestamptz,
  revocation_evidence_hash text check (
    revocation_evidence_hash is null or revocation_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check ((consumed_at is null) = (consumed_run_id is null)),
  check ((revoked_at is null) = (revocation_evidence_hash is null)),
  check (consumed_at is null or revoked_at is null)
);
create index if not exists transactional_graph_pilot_grant_expiry_idx
  on fundae_private.transactional_graph_pilot_authorization_grants (expires_at)
  where consumed_at is null and revoked_at is null;
alter table public.transactional_graph_pilot_runs
  drop constraint if exists transactional_graph_pilot_authorization_fk;
alter table public.transactional_graph_pilot_runs
  add constraint transactional_graph_pilot_authorization_fk
  foreign key (authorization_hash)
  references fundae_private.transactional_graph_pilot_authorization_grants(
    authorization_nonce_hash
  ) on delete restrict;

alter table public.transactional_dispatch_outbox
  add column if not exists pilot_run_id text;
alter table public.transactional_dispatch_outbox
  drop constraint if exists transactional_dispatch_pilot_run_fk;
alter table public.transactional_dispatch_outbox
  add constraint transactional_dispatch_pilot_run_fk foreign key (pilot_run_id)
  references public.transactional_graph_pilot_runs(run_id) on delete restrict;
create index if not exists transactional_dispatch_pilot_run_idx
  on public.transactional_dispatch_outbox (pilot_run_id, status, claim_expires_at, created_at)
  where pilot_run_id is not null;

create or replace function public.enforce_transactional_graph_pilot_binding()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.pilot_run_id is not null and
     new.pilot_run_id is distinct from old.pilot_run_id then
    raise exception using errcode = '23514', message = 'pilot_binding_immutable';
  end if;
  if new.pilot_run_id is null or
     (tg_op = 'UPDATE' and new.pilot_run_id is not distinct from old.pilot_run_id) then
    return new;
  end if;
  if not exists (
    select 1 from public.transactional_graph_pilot_runs r
    join public.leads l on l.submission_id = new.submission_id
    where r.run_id = new.pilot_run_id and r.status = 'active'
      and new.submission_id = any(r.submission_ids)
      and l.lead_id = r.allowed_lead_id and l.form_type = new.resource
  ) then
    raise exception using errcode = '23514', message = 'pilot_binding_scope_invalid';
  end if;
  return new;
end;
$$;

drop trigger if exists transactional_dispatch_pilot_binding
  on public.transactional_dispatch_outbox;
create trigger transactional_dispatch_pilot_binding
before insert or update of pilot_run_id on public.transactional_dispatch_outbox
for each row execute function public.enforce_transactional_graph_pilot_binding();

create or replace function fundae_private.transactional_graph_pilot_cohort_reason(
  p_allowed_lead_id text, p_submission_ids text[]
) returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_ids text[];
  v_unique integer;
  v_leads integer;
  v_dispatches integer;
  v_resources text[];
begin
  if p_allowed_lead_id is null or p_allowed_lead_id !~ '^[a-f0-9]{64}$' or
     p_submission_ids is null or pg_catalog.array_length(p_submission_ids, 1) <> 4 or
     pg_catalog.array_position(p_submission_ids, null) is not null then
    return 'invalid_request';
  end if;
  select pg_catalog.array_agg(x order by x), pg_catalog.count(distinct x)
    into v_ids, v_unique from pg_catalog.unnest(p_submission_ids) x;
  if v_unique <> 4 or exists (
    select 1 from pg_catalog.unnest(v_ids) x
    where x !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$'
  ) then
    return 'submission_set_invalid';
  end if;
  select pg_catalog.count(*),
         pg_catalog.array_agg(distinct l.form_type order by l.form_type)
    into v_leads, v_resources
  from public.leads l where l.submission_id = any(v_ids)
    and l.lead_id = p_allowed_lead_id
    and l.form_type = l.lead_magnet
    and l.form_type in ('calculator', 'interactive_checklist', 'checklist', 'webinar')
    and l.delivery_status = 'dead_letter'
    and l.email_delivery_status = 'pending'
    and l.accepted_by_make_at is null and l.ai_summary is null;
  if v_leads <> 4 or v_resources is distinct from
     array['calculator','checklist','interactive_checklist','webinar']::text[] then
    return 'lead_cohort_invalid';
  end if;
  if exists (
    select 1 from public.leads l
    where l.submission_id = any(v_ids) and l.lead_id <> p_allowed_lead_id
  ) then
    return 'identity_mapping_invalid';
  end if;
  if exists (
    select 1 from public.campaign_contacts c where c.email_hash = p_allowed_lead_id
  ) then
    return 'campaign_identity_conflict';
  end if;
  select pg_catalog.count(*) into v_dispatches
  from public.transactional_dispatch_outbox d
  join public.leads l on l.submission_id = d.submission_id
  where d.submission_id = any(v_ids)
    and d.resource = l.form_type and l.lead_id = p_allowed_lead_id
    and d.status in ('queued_off', 'deferred')
    and d.claimed_by is null and d.claim_expires_at is null
    and d.reservation_id is null and d.outcome_evidence_hash is null
    and d.terminal_at is null and d.pilot_run_id is null
    and d.payload_sha256 = pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(l.payload::text, 'UTF8'), 'sha256'
    ), 'hex');
  if v_dispatches <> 4 then return 'dispatch_cohort_invalid'; end if;
  return null;
end;
$$;

create or replace function fundae_private.register_transactional_graph_pilot_grant(
  p_run_id text,
  p_actor_hash text,
  p_authorization_nonce_hash text,
  p_allowed_lead_id text,
  p_submission_ids text[],
  p_max_ttl_seconds integer,
  p_expires_at timestamptz,
  p_approval_evidence_hash text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz;
  v_reason text;
  v_ids text[];
  v_set_hash text;
  v_control public.outbound_delivery_control%rowtype;
begin
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$' or
     p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_authorization_nonce_hash is null or
     p_authorization_nonce_hash !~ '^[a-f0-9]{64}$' or
     p_allowed_lead_id is null or p_allowed_lead_id !~ '^[a-f0-9]{64}$' or
     p_max_ttl_seconds is null or p_max_ttl_seconds not between 120 and 900 or
     p_expires_at is null or p_approval_evidence_hash is null or
     p_approval_evidence_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'invalid_request'
    );
  end if;
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  perform 1 from fundae_private.transactional_graph_pilot_authorization_grants
  where authorized_run_id = p_run_id for update;
  perform 1 from public.transactional_graph_pilot_runs
  where run_id = p_run_id or status = 'active' for update;
  perform 1 from public.transactional_dispatch_outbox
  where submission_id = any(p_submission_ids) for update;
  perform 1 from public.leads where submission_id = any(p_submission_ids) for update;
  v_now := pg_catalog.clock_timestamp();
  if v_control.singleton is null or v_control.master_enabled or
     v_control.transactional_enabled or v_control.cold_enabled then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'outbound_must_be_off'
    );
  end if;
  if p_expires_at < v_now + pg_catalog.make_interval(secs => p_max_ttl_seconds) or
     p_expires_at > v_now + interval '20 minutes' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'grant_expiry_invalid'
    );
  end if;
  if exists (
    select 1 from fundae_private.transactional_graph_pilot_authorization_grants
    where authorized_run_id = p_run_id
  ) or exists (
    select 1 from public.transactional_graph_pilot_runs
    where run_id = p_run_id or status = 'active'
  ) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'grant_conflict'
    );
  end if;
  select pg_catalog.array_agg(x order by x) into v_ids
  from pg_catalog.unnest(p_submission_ids) x;
  v_reason := fundae_private.transactional_graph_pilot_cohort_reason(
    p_allowed_lead_id, p_submission_ids
  );
  if v_reason is not null then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', v_reason
    );
  end if;
  v_set_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.array_to_string(v_ids, pg_catalog.chr(31)), 'UTF8'
  ), 'sha256'), 'hex');
  insert into fundae_private.transactional_graph_pilot_authorization_grants(
    authorization_nonce_hash, authorized_run_id, actor_hash, allowed_lead_id,
    submission_set_hash, max_ttl_seconds, expires_at, approval_evidence_hash
  ) values (
    p_authorization_nonce_hash, p_run_id, p_actor_hash, p_allowed_lead_id,
    v_set_hash, p_max_ttl_seconds, p_expires_at, p_approval_evidence_hash
  );
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'reason_code', 'pilot_grant_registered',
    'run_id_hash', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(p_run_id, 'UTF8'), 'sha256'
    ), 'hex'),
    'submission_set_hash', v_set_hash, 'expires_at', p_expires_at,
    'max_ttl_seconds', p_max_ttl_seconds
  );
exception when unique_violation then
  return pg_catalog.jsonb_build_object(
    'accepted', false, 'reason_code', 'grant_conflict'
  );
end;
$$;

create or replace function public.preview_transactional_graph_pilot(
  p_run_id text, p_actor_hash text, p_allowed_lead_id text,
  p_submission_ids text[], p_ttl_seconds integer
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_ids text[];
  v_set_hash text;
  v_control public.outbound_delivery_control%rowtype;
begin
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$' or
     p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_ttl_seconds is null or p_ttl_seconds not between 120 and 900 then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'dry_run', 'reason_code', 'invalid_request'
    );
  end if;
  select pg_catalog.array_agg(x order by x) into v_ids
  from pg_catalog.unnest(p_submission_ids) x;
  v_reason := fundae_private.transactional_graph_pilot_cohort_reason(
    p_allowed_lead_id, p_submission_ids
  );
  if v_reason is not null then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'dry_run', 'reason_code', v_reason,
      'run_id', p_run_id, 'resources', 0, 'submissions', 0
    );
  end if;
  if exists (select 1 from public.transactional_graph_pilot_runs where run_id = p_run_id) or
     exists (select 1 from public.transactional_graph_pilot_runs where status = 'active') then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'dry_run', 'reason_code', 'pilot_run_conflict',
      'run_id', p_run_id, 'resources', 0, 'submissions', 0
    );
  end if;
  select * into v_control from public.outbound_delivery_control where singleton;
  if not found or v_control.master_enabled or v_control.transactional_enabled or
     v_control.cold_enabled then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'dry_run', 'reason_code', 'outbound_must_be_off',
      'run_id', p_run_id, 'resources', 0, 'submissions', 0
    );
  end if;
  v_set_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.array_to_string(v_ids, pg_catalog.chr(31)), 'UTF8'
  ), 'sha256'), 'hex');
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'mode', 'dry_run', 'reason_code', 'pilot_ready',
    'run_id', p_run_id, 'resources', 4, 'submissions', 4,
    'allowed_lead_id_hash', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(p_allowed_lead_id, 'UTF8'), 'sha256'
    ), 'hex'),
    'submission_set_hash', v_set_hash,
    'authorization_required', true,
    'ttl_seconds', p_ttl_seconds,
    'controls', pg_catalog.jsonb_build_object(
      'master_enabled', false, 'transactional_enabled', false, 'cold_enabled', false
    )
  );
end;
$$;

create or replace function public.start_transactional_graph_pilot(
  p_run_id text, p_actor_hash text, p_allowed_lead_id text,
  p_submission_ids text[], p_authorization_hash text, p_ttl_seconds integer
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_ids text[];
  v_set_hash text;
  v_grant fundae_private.transactional_graph_pilot_authorization_grants%rowtype;
  v_control public.outbound_delivery_control%rowtype;
  v_now timestamptz;
begin
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$' or
     p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_allowed_lead_id is null or p_allowed_lead_id !~ '^[a-f0-9]{64}$' or
     p_authorization_hash is null or p_authorization_hash !~ '^[a-f0-9]{64}$' or
     p_submission_ids is null or
     p_ttl_seconds is null or p_ttl_seconds not between 120 and 900 then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'invalid_request'
    );
  end if;
  select pg_catalog.array_agg(x order by x) into v_ids
  from pg_catalog.unnest(p_submission_ids) x;
  v_set_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.array_to_string(v_ids, pg_catalog.chr(31)), 'UTF8'
  ), 'sha256'), 'hex');
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_grant
  from fundae_private.transactional_graph_pilot_authorization_grants
  where authorization_nonce_hash = p_authorization_hash for update;
  perform 1 from public.transactional_graph_pilot_runs where status = 'active' for update;
  perform 1 from public.transactional_dispatch_outbox
    where submission_id = any(p_submission_ids) for update;
  perform 1 from public.leads where submission_id = any(p_submission_ids) for update;
  v_now := pg_catalog.clock_timestamp();
  if v_control.singleton is null then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'control_unavailable'
    );
  end if;
  if v_control.master_enabled or v_control.transactional_enabled or v_control.cold_enabled then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'outbound_must_be_off'
    );
  end if;
  if v_grant.authorization_nonce_hash is null or
     v_grant.authorized_run_id <> p_run_id or
     v_grant.actor_hash <> p_actor_hash or
     v_grant.allowed_lead_id <> p_allowed_lead_id or
     v_grant.submission_set_hash <> v_set_hash or
     v_grant.max_ttl_seconds < p_ttl_seconds or
     v_grant.consumed_at is not null or v_grant.revoked_at is not null or
     v_grant.expires_at < v_now + pg_catalog.make_interval(secs => p_ttl_seconds) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'authorization_unavailable'
    );
  end if;
  if exists (select 1 from public.mailbox_throttle_state
       where active_reservation_id is not null or blocked_reservation_id is not null) or
     exists (select 1 from public.mailbox_delivery_reservations
       where status in ('reserved', 'reconcile_required')) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'mailbox_not_clean'
    );
  end if;
  if exists (select 1 from public.transactional_graph_pilot_runs where run_id = p_run_id) or
     exists (select 1 from public.transactional_graph_pilot_runs where status = 'active') then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'pilot_run_conflict'
    );
  end if;
  v_reason := fundae_private.transactional_graph_pilot_cohort_reason(
    p_allowed_lead_id, p_submission_ids
  );
  if v_reason is not null then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', v_reason
    );
  end if;
  update fundae_private.transactional_graph_pilot_authorization_grants
  set consumed_at = v_now, consumed_run_id = p_run_id, updated_at = v_now
  where authorization_nonce_hash = p_authorization_hash
    and authorized_run_id = p_run_id and actor_hash = p_actor_hash
    and allowed_lead_id = p_allowed_lead_id
    and submission_set_hash = v_set_hash
    and max_ttl_seconds >= p_ttl_seconds
    and expires_at >= v_now + pg_catalog.make_interval(secs => p_ttl_seconds)
    and consumed_at is null and revoked_at is null;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'authorization_unavailable'
    );
  end if;
  insert into public.transactional_graph_pilot_runs(
    run_id, actor_hash, authorization_hash, approval_evidence_hash,
    allowed_lead_id, submission_ids,
    submission_set_hash, status, expires_at, started_at
  ) values (
    p_run_id, p_actor_hash, p_authorization_hash, v_grant.approval_evidence_hash,
    p_allowed_lead_id, v_ids,
    v_set_hash, 'active', v_now + pg_catalog.make_interval(secs => p_ttl_seconds), v_now
  );
  update public.transactional_dispatch_outbox
  set pilot_run_id = p_run_id, updated_at = v_now
  where submission_id = any(v_ids) and pilot_run_id is null;
  if not found or (select pg_catalog.count(*) from public.transactional_dispatch_outbox
      where pilot_run_id = p_run_id) <> 4 then
    raise exception using errcode = '55000', message = 'pilot_binding_failed';
  end if;
  update public.outbound_delivery_control
  set master_enabled = true, transactional_enabled = true, cold_enabled = false,
      halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_ACTIVE',
      updated_by_hash = p_actor_hash, updated_at = v_now
  where singleton;
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'mode', 'live', 'reason_code', 'pilot_started',
    'run_id', p_run_id, 'resources', 4, 'submissions', 4,
    'expires_at', v_now + pg_catalog.make_interval(secs => p_ttl_seconds),
    'allowed_lead_id_hash', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(p_allowed_lead_id, 'UTF8'), 'sha256'
    ), 'hex'),
    'submission_set_hash', v_set_hash, 'ttl_seconds', p_ttl_seconds,
    'controls', pg_catalog.jsonb_build_object(
      'master_enabled', true, 'transactional_enabled', true, 'cold_enabled', false
    )
  );
exception when unique_violation then
  return pg_catalog.jsonb_build_object(
    'accepted', false, 'mode', 'live', 'reason_code', 'pilot_run_conflict'
  );
end;
$$;

alter function public.claim_transactional_graph_dispatch(uuid,integer,integer)
  rename to claim_transactional_graph_dispatch_pre_pilot_20260819;
create or replace function public.claim_transactional_graph_dispatch(
  p_worker_id uuid, p_limit integer, p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_run public.transactional_graph_pilot_runs%rowtype;
  v_result jsonb;
  v_dispatch_id uuid;
  v_reservation_id uuid;
  v_now timestamptz;
  v_evidence text;
begin
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_run from public.transactional_graph_pilot_runs
  where status = 'active' for update;
  v_now := pg_catalog.clock_timestamp();
  if not found then
    if v_control.master_enabled or v_control.transactional_enabled or v_control.cold_enabled then
      update public.outbound_delivery_control
      set master_enabled = false, transactional_enabled = false, cold_enabled = false,
          halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_SCOPE_REQUIRED', updated_at = v_now
      where singleton;
    end if;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_scope_required', 'claimed', 0,
      'recovery_required', false, 'resume_existing_reservation', false,
      'reservation_id', null, 'outbox_state', null,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null, 'lease_expires_at', null,
      'items', '[]'::jsonb
    );
  end if;
  if v_run.expires_at <= v_now then
    v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'pilot-expired:' || v_run.run_id || ':' || v_now::text, 'UTF8'
    ), 'sha256'), 'hex');
    update public.transactional_graph_pilot_runs
    set status = 'expired', finished_at = v_now, finish_evidence_hash = v_evidence,
        updated_at = v_now where run_id = v_run.run_id and status = 'active';
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_EXPIRED', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_scope_expired', 'claimed', 0,
      'recovery_required', false, 'resume_existing_reservation', false,
      'reservation_id', null, 'outbox_state', null,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null, 'lease_expires_at', null,
      'items', '[]'::jsonb
    );
  end if;
  if v_control.singleton is null or not v_control.master_enabled or not v_control.transactional_enabled or
     v_control.cold_enabled then
    v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'pilot-control-violation:' || v_run.run_id || ':' || v_now::text, 'UTF8'
    ), 'sha256'), 'hex');
    update public.transactional_graph_pilot_runs
    set status = 'halted', finished_at = v_now, finish_evidence_hash = v_evidence,
        updated_at = v_now where run_id = v_run.run_id and status = 'active';
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_CONTROL_VIOLATION', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_control_violation', 'claimed', 0,
      'recovery_required', false, 'resume_existing_reservation', false,
      'reservation_id', null, 'outbox_state', null,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null, 'lease_expires_at', null,
      'items', '[]'::jsonb
    );
  end if;
  begin
    v_result := public.claim_transactional_graph_dispatch_pre_pilot_20260819(
      p_worker_id, p_limit, p_lease_seconds
    );
    if pg_catalog.jsonb_array_length(coalesce(v_result -> 'items', '[]'::jsonb)) > 0 then
      v_dispatch_id := (v_result #>> '{items,0,dispatch_id}')::uuid;
      if not exists (
        select 1 from public.transactional_dispatch_outbox d
        where d.id = v_dispatch_id and d.pilot_run_id = v_run.run_id
          and d.submission_id = any(v_run.submission_ids)
      ) then
        raise exception using errcode = 'P0001', message = 'pilot_scope_violation';
      end if;
    end if;
    if v_result ->> 'reservation_id' is not null then
      v_reservation_id := (v_result ->> 'reservation_id')::uuid;
      if not exists (
        select 1 from public.transactional_dispatch_outbox d
        where d.reservation_id = v_reservation_id and d.pilot_run_id = v_run.run_id
          and d.submission_id = any(v_run.submission_ids)
      ) then
        raise exception using errcode = 'P0001', message = 'pilot_recovery_scope_violation';
      end if;
    end if;
  exception when others then
    v_result := null;
  end;
  if v_result is null then
    v_now := pg_catalog.clock_timestamp();
    v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'pilot-scope-violation:' || v_run.run_id || ':' || v_now::text, 'UTF8'
    ), 'sha256'), 'hex');
    update public.transactional_graph_pilot_runs
    set status = 'halted', finished_at = v_now, finish_evidence_hash = v_evidence,
        updated_at = v_now where run_id = v_run.run_id and status = 'active';
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_SCOPE_VIOLATION', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_scope_violation', 'claimed', 0,
      'recovery_required', false, 'resume_existing_reservation', false,
      'reservation_id', null, 'outbox_state', null,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null, 'lease_expires_at', null,
      'items', '[]'::jsonb
    );
  end if;
  return v_result || pg_catalog.jsonb_build_object('pilot_run_id', v_run.run_id);
end;
$$;

alter function public.reserve_claimed_transactional_graph_dispatch(
  uuid,uuid,text,text,text,text,text
) rename to reserve_claimed_transactional_graph_dispatch_pre_pilot_20260819;
create or replace function public.reserve_claimed_transactional_graph_dispatch(
  p_dispatch_id uuid, p_worker_id uuid, p_mailbox_key_hash text,
  p_finalize_capability_hash text, p_package_hmac_sha256 text,
  p_send_capability_hash text, p_opaque_marker text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_dispatch public.transactional_dispatch_outbox%rowtype;
  v_run public.transactional_graph_pilot_runs%rowtype;
  v_now timestamptz;
  v_evidence text;
begin
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_dispatch from public.transactional_dispatch_outbox
  where id = p_dispatch_id for update;
  if found and v_dispatch.pilot_run_id is not null then
    select * into v_run from public.transactional_graph_pilot_runs
    where run_id = v_dispatch.pilot_run_id for update;
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_dispatch.id is null or v_run.run_id is null or v_run.status <> 'active' or
     v_dispatch.submission_id <> all(v_run.submission_ids) or
     not exists (select 1 from public.leads l where l.submission_id = v_dispatch.submission_id
       and l.lead_id = v_run.allowed_lead_id and l.form_type = v_dispatch.resource) then
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_SCOPE_VIOLATION', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'pilot_scope_violation'
    );
  end if;
  if v_run.expires_at <= v_now then
    v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'pilot-expired:' || v_run.run_id || ':' || v_now::text, 'UTF8'
    ), 'sha256'), 'hex');
    update public.transactional_graph_pilot_runs
    set status = 'expired', finished_at = v_now, finish_evidence_hash = v_evidence,
        updated_at = v_now where run_id = v_run.run_id and status = 'active';
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_EXPIRED', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'pilot_scope_expired'
    );
  end if;
  if v_control.singleton is null or not v_control.master_enabled or not v_control.transactional_enabled or
     v_control.cold_enabled then
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_CONTROL_VIOLATION', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'pilot_control_violation'
    );
  end if;
  return public.reserve_claimed_transactional_graph_dispatch_pre_pilot_20260819(
    p_dispatch_id, p_worker_id, p_mailbox_key_hash, p_finalize_capability_hash,
    p_package_hmac_sha256, p_send_capability_hash, p_opaque_marker
  ) || pg_catalog.jsonb_build_object('pilot_run_id', v_run.run_id);
end;
$$;

alter function public.authorize_graph_draft_send(uuid,text,text,text)
  rename to authorize_graph_draft_send_pre_pilot_20260819;
create or replace function public.authorize_graph_draft_send(
  p_reservation_id uuid, p_send_capability_hash text, p_stop_snapshot_hash text,
  p_observed_change_key_hash text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_dispatch public.transactional_dispatch_outbox%rowtype;
  v_run public.transactional_graph_pilot_runs%rowtype;
  v_now timestamptz;
  v_evidence text;
begin
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select d.* into v_dispatch from public.transactional_dispatch_outbox d
  where d.reservation_id = p_reservation_id for update;
  if not found then
    return public.authorize_graph_draft_send_pre_pilot_20260819(
      p_reservation_id, p_send_capability_hash, p_stop_snapshot_hash,
      p_observed_change_key_hash
    );
  end if;
  if v_dispatch.pilot_run_id is not null then
    select * into v_run from public.transactional_graph_pilot_runs
    where run_id = v_dispatch.pilot_run_id for update;
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_run.run_id is null or v_run.status <> 'active' or
     v_dispatch.submission_id <> all(v_run.submission_ids) or
     not exists (select 1 from public.leads l where l.submission_id = v_dispatch.submission_id
       and l.lead_id = v_run.allowed_lead_id and l.form_type = v_dispatch.resource) or
     v_run.expires_at <= v_now or v_control.singleton is null or
     not v_control.master_enabled or not v_control.transactional_enabled or
     v_control.cold_enabled then
    if v_run.run_id is not null and v_run.status = 'active' then
      v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'pilot-authorization-stopped:' || v_run.run_id || ':' || v_now::text, 'UTF8'
      ), 'sha256'), 'hex');
      update public.transactional_graph_pilot_runs
      set status = case when v_run.expires_at <= v_now then 'expired' else 'halted' end,
          finished_at = v_now, finish_evidence_hash = v_evidence, updated_at = v_now
      where run_id = v_run.run_id and status = 'active';
    end if;
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_SEND_BLOCKED', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', 'draft_neutralization_required',
      'pilot_reason_code', case when v_run.expires_at <= v_now
        then 'pilot_scope_expired'
        when v_control.singleton is null or not v_control.master_enabled or
          not v_control.transactional_enabled or v_control.cold_enabled
        then 'pilot_control_violation' else 'pilot_scope_violation' end,
      'reservation_id', p_reservation_id, 'mailbox_halted', true,
      'retry_after_seconds', 0
    );
  end if;
  return public.authorize_graph_draft_send_pre_pilot_20260819(
    p_reservation_id, p_send_capability_hash, p_stop_snapshot_hash,
    p_observed_change_key_hash
  ) || pg_catalog.jsonb_build_object('pilot_run_id', v_run.run_id);
end;
$$;

create or replace function public.finish_transactional_graph_pilot(
  p_run_id text, p_actor_hash text, p_outcome text, p_evidence_hash text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_run public.transactional_graph_pilot_runs%rowtype;
  v_now timestamptz;
  v_confirmed integer := 0;
  v_complete boolean := false;
  v_reason text;
begin
  if p_run_id is null or p_actor_hash is null or
     p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_outcome is null or p_outcome not in ('completed', 'halted') or
     p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason_code', 'invalid_request');
  end if;
  perform 1 from public.outbound_delivery_control where singleton for update;
  select * into v_run from public.transactional_graph_pilot_runs
  where run_id = p_run_id for update;
  v_now := pg_catalog.clock_timestamp();
  if not found then
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_FINISH_UNKNOWN',
        updated_by_hash = p_actor_hash, updated_at = v_now where singleton;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_run_unavailable', 'scope_active', false,
      'controls', pg_catalog.jsonb_build_object(
        'master_enabled', false, 'transactional_enabled', false, 'cold_enabled', false
      )
    );
  end if;
  if v_run.actor_hash <> p_actor_hash then
    update public.transactional_graph_pilot_runs
    set status = 'halted', finished_at = v_now,
        finish_evidence_hash = pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(
            'pilot-finish-actor-mismatch:' || v_run.run_id || ':' || v_now::text,
            'UTF8'
          ), 'sha256'
        ), 'hex'), updated_at = v_now
    where run_id = v_run.run_id and status = 'active';
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_FINISH_ACTOR_MISMATCH',
        updated_at = v_now where singleton;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_actor_mismatch', 'scope_active', false,
      'controls', pg_catalog.jsonb_build_object(
        'master_enabled', false, 'transactional_enabled', false, 'cold_enabled', false
      )
    );
  end if;
  select pg_catalog.count(*) filter (where d.status = 'confirmed_sent'
      and d.outcome_evidence_hash is not null and d.reservation_id is not null
      and g.state = 'confirmed_sent'
      and g.sent_items_evidence_hash = d.outcome_evidence_hash
      and g.internet_message_id_hash is not null)
    into v_confirmed
  from public.transactional_dispatch_outbox d
  left join public.graph_outbox g on g.reservation_id = d.reservation_id
  where d.pilot_run_id = p_run_id and d.submission_id = any(v_run.submission_ids);
  v_complete := v_confirmed = 4 and
    (select pg_catalog.count(*) from public.transactional_dispatch_outbox
      where pilot_run_id = p_run_id) = 4;
  update public.outbound_delivery_control
  set master_enabled = false, transactional_enabled = false, cold_enabled = false,
      halt_reason = case when p_outcome = 'completed' and v_complete
        then 'TRANSACTIONAL_GRAPH_PILOT_COMPLETED'
        when p_outcome = 'halted' then 'TRANSACTIONAL_GRAPH_PILOT_HALTED'
        else 'TRANSACTIONAL_GRAPH_PILOT_COMPLETION_INCOMPLETE' end,
      updated_by_hash = p_actor_hash, updated_at = v_now where singleton;
  if v_run.status = 'active' then
    update public.transactional_graph_pilot_runs
    set status = case when p_outcome = 'completed' and v_complete
        then 'completed' else 'halted' end,
        finished_at = v_now, finish_evidence_hash = p_evidence_hash,
        updated_at = v_now
    where run_id = p_run_id;
  end if;
  v_reason := case when p_outcome = 'completed' and v_complete then 'pilot_completed'
    when p_outcome = 'halted' then 'pilot_halted'
    else 'pilot_completion_incomplete' end;
  return pg_catalog.jsonb_build_object(
    'accepted', p_outcome = 'halted' or v_complete,
    'reason_code', v_reason, 'run_id', p_run_id,
    'confirmed_sent_count', v_confirmed, 'scope_active', false,
    'controls', pg_catalog.jsonb_build_object(
      'master_enabled', false, 'transactional_enabled', false, 'cold_enabled', false
    )
  );
end;
$$;

alter function public.emergency_halt_outbound_delivery(text,text)
  rename to emergency_halt_outbound_delivery_pre_pilot_20260819;
create or replace function public.emergency_halt_outbound_delivery(
  p_actor_hash text, p_reason text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz;
  v_evidence text;
  v_cleared integer;
begin
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 3 and 240 then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason_code', 'invalid_request');
  end if;
  perform 1 from public.outbound_delivery_control where singleton for update;
  perform 1 from public.transactional_graph_pilot_runs where status = 'active' for update;
  v_now := pg_catalog.clock_timestamp();
  v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'emergency-halt:' || p_actor_hash || ':' || pg_catalog.btrim(p_reason) || ':' || v_now::text,
    'UTF8'
  ), 'sha256'), 'hex');
  update public.transactional_graph_pilot_runs
  set status = 'halted', finished_at = v_now, finish_evidence_hash = v_evidence,
      updated_at = v_now where status = 'active';
  get diagnostics v_cleared = row_count;
  update public.outbound_delivery_control
  set master_enabled = false, transactional_enabled = false, cold_enabled = false,
      halt_reason = pg_catalog.btrim(p_reason), updated_by_hash = p_actor_hash,
      updated_at = v_now where singleton;
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'reason_code', 'halted', 'halted_at', v_now,
    'pilot_scope_cleared', v_cleared > 0,
    'controls', pg_catalog.jsonb_build_object(
      'master_enabled', false, 'transactional_enabled', false, 'cold_enabled', false
    )
  );
end;
$$;

create or replace function fundae_private.enforce_transactional_graph_pilot_deadline()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_run public.transactional_graph_pilot_runs%rowtype;
  v_now timestamptz;
  v_evidence text;
  v_reason text;
begin
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_run from public.transactional_graph_pilot_runs
  where status = 'active' for update;
  v_now := pg_catalog.clock_timestamp();
  if v_control.singleton is null then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'control_unavailable'
    );
  end if;
  if v_run.run_id is null then
    if v_control.halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_ACTIVE' and
       (v_control.master_enabled or v_control.transactional_enabled or
        v_control.cold_enabled) then
      v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'pilot-watchdog-orphan:' || v_now::text, 'UTF8'
      ), 'sha256'), 'hex');
      update public.outbound_delivery_control
      set master_enabled = false, transactional_enabled = false, cold_enabled = false,
          halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_WATCHDOG_ORPHAN',
          updated_by_hash = v_evidence, updated_at = v_now
      where singleton;
      return pg_catalog.jsonb_build_object(
        'accepted', true, 'reason_code', 'pilot_orphan_halted', 'outbound_off', true
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'reason_code', 'pilot_inactive',
      'outbound_off', not v_control.master_enabled and
        not v_control.transactional_enabled and not v_control.cold_enabled
    );
  end if;
  if v_run.expires_at > v_now and v_control.master_enabled and
     v_control.transactional_enabled and not v_control.cold_enabled and
     v_control.halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_ACTIVE' then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'reason_code', 'pilot_scope_current',
      'run_id_hash', pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(v_run.run_id, 'UTF8'), 'sha256'
      ), 'hex'), 'outbound_off', false
    );
  end if;
  v_reason := case when v_run.expires_at <= v_now
    then 'TRANSACTIONAL_GRAPH_PILOT_EXPIRED'
    else 'TRANSACTIONAL_GRAPH_PILOT_CONTROL_VIOLATION' end;
  v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'pilot-watchdog:' || v_run.run_id || ':' || v_reason || ':' || v_now::text,
    'UTF8'
  ), 'sha256'), 'hex');
  update public.transactional_graph_pilot_runs
  set status = case when v_run.expires_at <= v_now then 'expired' else 'halted' end,
      finished_at = v_now, finish_evidence_hash = v_evidence, updated_at = v_now
  where run_id = v_run.run_id and status = 'active';
  update public.outbound_delivery_control
  set master_enabled = false, transactional_enabled = false, cold_enabled = false,
      halt_reason = v_reason, updated_by_hash = v_evidence, updated_at = v_now
  where singleton;
  return pg_catalog.jsonb_build_object(
    'accepted', true,
    'reason_code', case when v_run.expires_at <= v_now
      then 'pilot_scope_expired' else 'pilot_control_violation' end,
    'run_id_hash', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_run.run_id, 'UTF8'), 'sha256'
    ), 'hex'), 'outbound_off', true
  );
end;
$$;

create or replace function public.read_transactional_graph_pilot_ledger(
  p_run_id text, p_actor_hash text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_run public.transactional_graph_pilot_runs%rowtype;
  v_rows jsonb;
  v_row_count integer;
  v_resources integer;
  v_reservations integer;
  v_unique_reservations integer;
  v_drafts integer;
  v_unique_drafts integer;
  v_confirmed integer;
  v_confirmed_evidenced integer;
begin
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$' or
     p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason_code', 'invalid_request');
  end if;
  select * into v_run from public.transactional_graph_pilot_runs
  where run_id = p_run_id and actor_hash = p_actor_hash;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_ledger_unavailable'
    );
  end if;
  select pg_catalog.count(*), pg_catalog.count(distinct d.resource),
         pg_catalog.count(d.reservation_id),
         pg_catalog.count(distinct d.reservation_id),
         pg_catalog.count(g.graph_draft_immutable_id),
         pg_catalog.count(distinct g.graph_draft_immutable_id),
         pg_catalog.count(*) filter (where d.status = 'confirmed_sent'),
         pg_catalog.count(*) filter (where d.status = 'confirmed_sent'
           and g.state = 'confirmed_sent'
           and g.sent_items_evidence_hash = d.outcome_evidence_hash
           and g.sent_items_evidence_hash is not null
           and g.internet_message_id_hash is not null),
         coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'resource', d.resource, 'status', d.status,
           'dispatch_id_hash', pg_catalog.encode(extensions.digest(
             pg_catalog.convert_to(d.id::text, 'UTF8'), 'sha256'
           ), 'hex'),
           'reservation_id_hash', case when d.reservation_id is null then null else
             pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
               d.reservation_id::text, 'UTF8'
             ), 'sha256'), 'hex') end,
           'draft_immutable_id_hash', case when g.graph_draft_immutable_id is null then null else
             pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
               g.graph_draft_immutable_id, 'UTF8'
             ), 'sha256'), 'hex') end,
           'internet_message_id_hash', g.internet_message_id_hash,
           'evidence_hash', coalesce(
             g.sent_items_evidence_hash, g.terminal_evidence_hash, d.outcome_evidence_hash
           )
         ) order by d.resource), '[]'::jsonb)
    into v_row_count, v_resources, v_reservations, v_unique_reservations,
         v_drafts, v_unique_drafts, v_confirmed, v_confirmed_evidenced, v_rows
  from public.transactional_dispatch_outbox d
  left join public.graph_outbox g on g.reservation_id = d.reservation_id
  where d.pilot_run_id = v_run.run_id and d.submission_id = any(v_run.submission_ids);
  if v_row_count <> 4 or v_resources <> 4 or
     v_reservations <> v_unique_reservations or v_drafts <> v_unique_drafts or
     v_confirmed <> v_confirmed_evidenced then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_ledger_invariant_violation',
      'run_id_hash', pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(v_run.run_id, 'UTF8'), 'sha256'
      ), 'hex')
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'reason_code', 'pilot_ledger_read',
    'run_id_hash', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_run.run_id, 'UTF8'), 'sha256'
    ), 'hex'),
    'run_status', v_run.status, 'expires_at', v_run.expires_at, 'rows', v_rows
  );
end;
$$;

alter table public.transactional_graph_pilot_runs enable row level security;
alter table public.transactional_graph_pilot_runs force row level security;
revoke all privileges on table public.transactional_graph_pilot_runs
  from public, anon, authenticated, service_role;
alter table fundae_private.transactional_graph_pilot_authorization_grants
  enable row level security;
alter table fundae_private.transactional_graph_pilot_authorization_grants
  force row level security;
revoke all privileges on table
  fundae_private.transactional_graph_pilot_authorization_grants
  from public, anon, authenticated, service_role;

revoke execute on function public.enforce_transactional_graph_pilot_binding()
  from public, anon, authenticated, service_role;
revoke execute on function fundae_private.transactional_graph_pilot_cohort_reason(text,text[])
  from public, anon, authenticated, service_role;
revoke execute on function fundae_private.register_transactional_graph_pilot_grant(
  text,text,text,text,text[],integer,timestamptz,text
) from public, anon, authenticated, service_role;
revoke execute on function fundae_private.enforce_transactional_graph_pilot_deadline()
  from public, anon, authenticated, service_role;
revoke execute on function public.claim_transactional_graph_dispatch_pre_pilot_20260819(uuid,integer,integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.reserve_claimed_transactional_graph_dispatch_pre_pilot_20260819(uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.authorize_graph_draft_send_pre_pilot_20260819(uuid,text,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.emergency_halt_outbound_delivery_pre_pilot_20260819(text,text)
  from public, anon, authenticated, service_role;

revoke execute on function public.preview_transactional_graph_pilot(text,text,text,text[],integer)
  from public, anon, authenticated;
revoke execute on function public.start_transactional_graph_pilot(text,text,text,text[],text,integer)
  from public, anon, authenticated;
revoke execute on function public.claim_transactional_graph_dispatch(uuid,integer,integer)
  from public, anon, authenticated;
revoke execute on function public.reserve_claimed_transactional_graph_dispatch(uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.authorize_graph_draft_send(uuid,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.finish_transactional_graph_pilot(text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.read_transactional_graph_pilot_ledger(text,text)
  from public, anon, authenticated;
revoke execute on function public.emergency_halt_outbound_delivery(text,text)
  from public, anon, authenticated;

grant execute on function public.preview_transactional_graph_pilot(text,text,text,text[],integer)
  to service_role;
grant execute on function public.start_transactional_graph_pilot(text,text,text,text[],text,integer)
  to service_role;
grant execute on function public.claim_transactional_graph_dispatch(uuid,integer,integer)
  to service_role;
grant execute on function public.reserve_claimed_transactional_graph_dispatch(uuid,uuid,text,text,text,text,text)
  to service_role;
grant execute on function public.authorize_graph_draft_send(uuid,text,text,text)
  to service_role;
grant execute on function public.finish_transactional_graph_pilot(text,text,text,text)
  to service_role;
grant execute on function public.read_transactional_graph_pilot_ledger(text,text)
  to service_role;
grant execute on function public.emergency_halt_outbound_delivery(text,text)
  to service_role;
grant execute on function fundae_private.register_transactional_graph_pilot_grant(
  text,text,text,text,text[],integer,timestamptz,text
) to postgres;
grant execute on function fundae_private.enforce_transactional_graph_pilot_deadline()
  to postgres;

select cron.unschedule(jobid)
from cron.job
where jobname = 'fundae-transactional-graph-pilot-watchdog';
select cron.schedule(
  'fundae-transactional-graph-pilot-watchdog',
  '* * * * *',
  $watchdog$select fundae_private.enforce_transactional_graph_pilot_deadline();$watchdog$
);

-- Applying the contract never activates a lane or a pilot scope.
update public.outbound_delivery_control
set master_enabled = false, transactional_enabled = false, cold_enabled = false,
    halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_NOT_STARTED',
    updated_at = pg_catalog.clock_timestamp()
where singleton;

commit;

-- 20260819234000_campaign_terminal_suppression_hardening.sql
-- Centralize terminal campaign suppressions and make provisioning fail closed.
-- This migration never enables outbound and does not backfill historical rows.
begin;

create or replace function fundae_private.enforce_campaign_terminal_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.campaign_contacts%rowtype;
  v_suppression public.campaign_suppressions%rowtype;
  v_scope text;
  v_reason text;
begin
  if new.event_name not in ('unsubscribe', 'bounce_hard', 'opposition') then
    return new;
  end if;

  select * into v_contact
  from public.campaign_contacts
  where id = new.campaign_contact_id and campaign_id = new.campaign_id
  for update;
  if not found then
    raise exception using errcode = '23503',
      message = 'campaign_terminal_suppression_contact_unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_contact.email_hash, 20260819234000)
  );
  v_scope := case when new.event_name = 'unsubscribe' then 'all' else 'marketing' end;
  v_reason := case when new.event_name = 'bounce_hard' then 'hard_bounce' else new.event_name end;

  insert into public.campaign_suppressions(
    identity_hash, scope, reason, occurred_at, source_event_id,
    source_campaign_id, source_contact_id
  ) values (
    v_contact.email_hash, v_scope, v_reason, new.occurred_at,
    new.source_event_id, new.campaign_id, new.campaign_contact_id
  )
  on conflict(identity_hash) do update set
    scope = case
      when public.campaign_suppressions.scope = 'all' or excluded.scope = 'all'
        then 'all'
      else 'marketing'
    end,
    reason = case
      when public.campaign_suppressions.scope = 'all' or excluded.scope = 'all'
        then 'unsubscribe'
      when public.campaign_suppressions.reason = 'hard_bounce'
        or excluded.reason = 'hard_bounce' then 'hard_bounce'
      else 'opposition'
    end,
    occurred_at = least(public.campaign_suppressions.occurred_at, excluded.occurred_at),
    source_event_id = coalesce(
      public.campaign_suppressions.source_event_id, excluded.source_event_id
    ),
    source_campaign_id = coalesce(
      public.campaign_suppressions.source_campaign_id, excluded.source_campaign_id
    ),
    source_contact_id = coalesce(
      public.campaign_suppressions.source_contact_id, excluded.source_contact_id
    ),
    updated_at = pg_catalog.clock_timestamp()
  returning * into v_suppression;

  update public.campaign_contacts
  set cold_sequence_status = 'stopped',
      intent_sequence_status = 'stopped',
      marketing_lane = 'none',
      suppression_scope = v_suppression.scope,
      sequence_status = 'stopped',
      next_delivery_status = 'stopped',
      next_scheduled_at = null,
      locked_at = null,
      lock_token = null,
      lock_expires_at = null,
      stopped_at = case
        when stopped_at is null then v_suppression.occurred_at
        else least(stopped_at, v_suppression.occurred_at)
      end,
      stopped_reason = v_suppression.reason,
      suppressed_at = case
        when suppressed_at is null then v_suppression.occurred_at
        else least(suppressed_at, v_suppression.occurred_at)
      end,
      suppression_reason = v_suppression.reason,
      updated_at = pg_catalog.clock_timestamp()
  where email_hash = v_suppression.identity_hash;

  update public.campaign_executions
  set status = 'stopped',
      stopped_at = coalesce(stopped_at, v_suppression.occurred_at),
      stop_reason = v_suppression.reason,
      updated_at = pg_catalog.clock_timestamp()
  where status = 'planned' and campaign_contact_id in (
    select id from public.campaign_contacts
    where email_hash = v_suppression.identity_hash
  );

  return new;
end;
$$;

create or replace function fundae_private.reject_suppressed_campaign_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.marketing_lane <> 'cold' or new.suppression_scope <> 'none' then
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

drop trigger if exists campaign_events_terminal_suppression on public.campaign_events;
create trigger campaign_events_terminal_suppression
after insert on public.campaign_events
for each row
when (new.event_name in ('unsubscribe', 'bounce_hard', 'opposition'))
execute function fundae_private.enforce_campaign_terminal_suppression();

drop trigger if exists campaign_contacts_suppression_gate on public.campaign_contacts;
create trigger campaign_contacts_suppression_gate
before insert or update of email_hash, marketing_lane, suppression_scope
on public.campaign_contacts
for each row
execute function fundae_private.reject_suppressed_campaign_contact();

revoke execute on function fundae_private.enforce_campaign_terminal_suppression()
  from public, anon, authenticated, service_role;
revoke execute on function fundae_private.reject_suppressed_campaign_contact()
  from public, anon, authenticated, service_role;

-- V3 is the only accepted provisioning domain. This migration has not been
-- applied in any environment; abort rather than reinterpret legacy manifests.
do $$
begin
  if exists (select 1 from public.cold_campaign_provision_manifests)
     or exists (select 1 from public.cold_campaign_provision_batches) then
    raise exception using errcode = '55000',
      message = 'cold_campaign_v2_state_present';
  end if;
end;
$$;

alter table public.cold_campaign_provision_manifests
  add column technical_evidence_hash text;
alter table public.cold_campaign_provision_manifests
  drop constraint cold_campaign_provision_manifests_hash_domain_check;
alter table public.cold_campaign_provision_manifests
  alter column hash_domain set default 'cold-provision-v3';
alter table public.cold_campaign_provision_manifests
  alter column technical_evidence_hash set not null;
alter table public.cold_campaign_provision_manifests
  add constraint cold_campaign_provision_manifests_hash_domain_check
    check (hash_domain = 'cold-provision-v3'),
  add constraint cold_campaign_provision_manifests_technical_evidence_hash_check
    check (technical_evidence_hash ~ '^[a-f0-9]{64}$');

create or replace function public.apply_cold_campaign_provision_batch(
  p_manifest_hash text,p_logical_dataset_hash text,p_batch_index integer,p_batch_count integer,p_batch_hash text,
  p_actor_hash text,p_authorization_hash text,p_campaign_external_id text,p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_control public.cold_campaign_provision_control%rowtype;
  v_outbound public.outbound_delivery_control%rowtype;
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_existing public.cold_campaign_provision_batches%rowtype;
  v_existing_manifest public.cold_campaign_provision_manifests%rowtype;
  v_row jsonb;
  v_now timestamptz;
  v_row_count integer;
  v_computed_batch_hash text;
  v_row_hashes text[];
  v_technical_evidence_hash text;
  v_technical_evidence_max text;
  v_computed_row_hash text;
  v_token_id uuid;
  v_token text;
  v_token_occurrences integer;
  v_canonical_payload text;
begin
  if p_manifest_hash !~ '^[a-f0-9]{64}$' or p_logical_dataset_hash !~ '^[a-f0-9]{64}$' or
     p_batch_hash !~ '^[a-f0-9]{64}$' or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_authorization_hash !~ '^[a-f0-9]{64}$' or
     p_campaign_external_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_batch_count not between 1 and 100 or
     p_batch_index not between 0 and p_batch_count-1 or
     pg_catalog.jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023',message='provision_request_invalid';
  end if;
  v_row_count:=pg_catalog.jsonb_array_length(p_rows);
  if v_row_count not between 1 and 500 then
    raise exception using errcode='22023',message='provision_batch_size_invalid';
  end if;
  select
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.string_agg(item->>'row_sha256',E'\n' order by item->>'row_sha256'),'UTF8'),'sha256'),'hex'),
    pg_catalog.array_agg(item->>'row_sha256' order by item->>'row_sha256'),
    pg_catalog.min(item->>'technical_evidence_sha256'),
    pg_catalog.max(item->>'technical_evidence_sha256')
  into v_computed_batch_hash,v_row_hashes,v_technical_evidence_hash,v_technical_evidence_max
  from pg_catalog.jsonb_array_elements(p_rows) item;
  if v_computed_batch_hash<>p_batch_hash then
    raise exception using errcode='22023',message='provision_batch_hash_invalid';
  end if;
  if v_technical_evidence_hash is null or
     v_technical_evidence_hash !~ '^[a-f0-9]{64}$' or
     v_technical_evidence_hash<>v_technical_evidence_max then
    raise exception using errcode='22023',message='provision_technical_evidence_invalid';
  end if;

  -- Recompute every row before the replay shortcut. A caller cannot obtain an
  -- accepted duplicate response by pairing an old row_sha256 with drifted data.
  for v_row in select item from pg_catalog.jsonb_array_elements(p_rows) item loop
    if (select count(*) from pg_catalog.jsonb_object_keys(v_row))<>25 or
       v_row->>'campaign_external_id'<>p_campaign_external_id or
       v_row->>'technical_evidence_sha256'<>v_technical_evidence_hash or
       v_row->>'row_sha256' !~ '^[a-f0-9]{64}$' then
      raise exception using errcode='22023',message='provision_row_shape_invalid';
    end if;
    v_computed_row_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.concat_ws(pg_catalog.chr(31),
        v_row->>'campaign_external_id',v_row->>'contact_id',v_row->>'account_id',
        v_row->>'email',v_row->>'email_hash',v_row->>'variant',v_row->>'lot',
        v_row->>'step',v_row->>'scheduled_for',v_row->>'execution_key',
        v_row->>'recipient_email',v_row->>'subject',v_row->>'html_body',
        v_row->>'payload_sha256',v_row->>'token_hash',v_row->>'validation_status',
        v_row->>'unsubscribe_status',v_row->>'opposition_status',
        v_row->>'hard_bounce_status',v_row->>'suppression_status',
        v_row->>'duplicate_status',v_row->>'campaign_authorization',
        v_row->>'company_size',v_row->>'technical_evidence_sha256'
      ),'UTF8'),'sha256'),'hex');
    if v_computed_row_hash<>v_row->>'row_sha256' then
      raise exception using errcode='22023',message='provision_row_hash_invalid';
    end if;
  end loop;

  select * into v_control
  from public.cold_campaign_provision_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or not v_control.enabled or v_control.expires_at<=v_now or
     v_control.expected_manifest_hash<>p_manifest_hash or
     v_control.expected_authorization_hash<>p_authorization_hash or
     v_control.authorized_actor_hash<>p_actor_hash then
    raise exception using errcode='42501',message='provision_control_closed';
  end if;
  select * into v_outbound
  from public.outbound_delivery_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or v_outbound.master_enabled or v_outbound.cold_enabled then
    raise exception using errcode='55000',message='outbound_must_remain_off';
  end if;

  select * into v_existing_manifest
  from public.cold_campaign_provision_manifests
  where manifest_hash=p_manifest_hash for update;
  if found and (
    v_existing_manifest.hash_domain<>'cold-provision-v3' or
    v_existing_manifest.actor_hash<>p_actor_hash or
    v_existing_manifest.logical_dataset_hash<>p_logical_dataset_hash or
    v_existing_manifest.technical_evidence_hash<>v_technical_evidence_hash or
    v_existing_manifest.campaign_external_id<>p_campaign_external_id or
    v_existing_manifest.batch_count<>p_batch_count
  ) then
    raise exception using errcode='23505',message='manifest_collision';
  end if;

  select * into v_existing from public.cold_campaign_provision_batches
  where manifest_hash=p_manifest_hash and batch_index=p_batch_index for update;
  if found then
    if v_existing.batch_hash<>p_batch_hash or
       v_existing.batch_count<>p_batch_count or
       v_existing.row_count<>v_row_count or
       v_existing.actor_hash<>p_actor_hash or
       v_existing.row_hashes<>v_row_hashes then
      raise exception using errcode='23505',message='provision_batch_collision';
    end if;
    return pg_catalog.jsonb_build_object(
      'accepted',true,'duplicate',true,'reason_code','batch_replayed'
    );
  end if;

  insert into public.campaigns(name,is_active,external_id,timezone,status)
  values('FUNDAE 2026 Email Campaign',false,p_campaign_external_id,'Europe/Madrid','draft')
  on conflict(external_id) do nothing;
  select * into v_campaign
  from public.campaigns where external_id=p_campaign_external_id for update;
  if not found or v_campaign.is_active or v_campaign.status<>'draft' then
    raise exception using errcode='23505',message='campaign_collision';
  end if;
  insert into public.cold_campaign_provision_manifests(
    manifest_hash,campaign_id,actor_hash,logical_dataset_hash,
    technical_evidence_hash,campaign_external_id,hash_domain,batch_count
  ) values (
    p_manifest_hash,v_campaign.id,p_actor_hash,p_logical_dataset_hash,
    v_technical_evidence_hash,p_campaign_external_id,'cold-provision-v3',p_batch_count
  ) on conflict(manifest_hash) do nothing;
  if not exists(
    select 1 from public.cold_campaign_provision_manifests m
    where m.manifest_hash=p_manifest_hash and m.campaign_id=v_campaign.id
      and m.actor_hash=p_actor_hash
      and m.logical_dataset_hash=p_logical_dataset_hash
      and m.technical_evidence_hash=v_technical_evidence_hash
      and m.campaign_external_id=p_campaign_external_id
      and m.hash_domain='cold-provision-v3'
      and m.batch_count=p_batch_count and m.status='applying'
  ) then
    raise exception using errcode='23505',message='manifest_collision';
  end if;

  -- The stop-gate validates planned rows while MVCC keeps pilot state private.
  -- Every path restores draft before commit; any exception rolls back atomically.
  update public.campaigns set is_active=true,status='pilot' where id=v_campaign.id;

  for v_row in select item from pg_catalog.jsonb_array_elements(p_rows) item loop
    if (select count(*) from pg_catalog.jsonb_object_keys(v_row))<>25 or exists(
      select 1 from pg_catalog.jsonb_object_keys(v_row) key where key not in (
        'campaign_external_id','contact_id','account_id','email','email_hash','variant','lot','step','scheduled_for','execution_key',
        'recipient_email','subject','html_body','payload_sha256','token_hash','validation_status','unsubscribe_status','opposition_status',
        'hard_bounce_status','suppression_status','duplicate_status','campaign_authorization','row_sha256','company_size',
        'technical_evidence_sha256'
      )
    ) then
      raise exception using errcode='22023',message='provision_row_shape_invalid';
    end if;
    if v_row->>'campaign_external_id'<>p_campaign_external_id or
       v_row->>'technical_evidence_sha256'<>v_technical_evidence_hash or
       v_row->>'validation_status'<>'OK' or
       v_row->>'unsubscribe_status'<>'CLEAR' or
       v_row->>'opposition_status'<>'CLEAR' or
       v_row->>'hard_bounce_status'<>'CLEAR' or
       v_row->>'suppression_status'<>'CLEAR' or
       v_row->>'duplicate_status'<>'CLEAR' or
       v_row->>'campaign_authorization'<>'AUTHORIZED' or
       (v_row->>'step')::integer not between 1 and 5 or
       v_row->>'lot' not in ('A','B','C','D') or
       v_row->>'email_hash' !~ '^[a-f0-9]{64}$' or
       v_row->>'payload_sha256' !~ '^[a-f0-9]{64}$' or
       v_row->>'token_hash' !~ '^[a-f0-9]{64}$' or
       v_row->>'row_sha256' !~ '^[a-f0-9]{64}$' or
       v_row->>'email'<>pg_catalog.lower(v_row->>'email') or
       v_row->>'recipient_email'<>v_row->>'email' or
       not fundae_private.is_cold_campaign_hmac_identity(
         v_row->>'email',v_row->>'email_hash'
       ) or pg_catalog.strpos(v_row->>'html_body','{{unsubscribe_url}}')>0 then
      raise exception using errcode='22023',message='provision_row_gate_invalid';
    end if;
    select count(*),min(match[1]) into v_token_occurrences,v_token
    from pg_catalog.regexp_matches(
      v_row->>'html_body','(u1[.][A-Za-z0-9_-]{43})','g'
    ) match;
    if v_token_occurrences<>1 or
       pg_catalog.strpos(v_row->>'html_body','/baja?token='||v_token)=0 or
       pg_catalog.encode(extensions.digest(
         pg_catalog.convert_to(v_token,'UTF8'),'sha256'
       ),'hex')<>v_row->>'token_hash' then
      raise exception using errcode='22023',message='provision_unsubscribe_binding_invalid';
    end if;
    v_canonical_payload:='{"recipient":'||pg_catalog.to_json(v_row->>'recipient_email')::text||
      ',"subject":'||pg_catalog.to_json(v_row->>'subject')::text||
      ',"body":'||pg_catalog.to_json(v_row->>'html_body')::text||',"attachments":[]}';
    if pg_catalog.encode(extensions.digest(
         pg_catalog.convert_to(v_canonical_payload,'UTF8'),'sha256'
       ),'hex')<>v_row->>'payload_sha256' then
      raise exception using errcode='22023',message='provision_payload_hash_invalid';
    end if;
    v_computed_row_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.concat_ws(pg_catalog.chr(31),
        v_row->>'campaign_external_id',v_row->>'contact_id',v_row->>'account_id',
        v_row->>'email',v_row->>'email_hash',v_row->>'variant',v_row->>'lot',
        v_row->>'step',v_row->>'scheduled_for',v_row->>'execution_key',
        v_row->>'recipient_email',v_row->>'subject',v_row->>'html_body',
        v_row->>'payload_sha256',v_row->>'token_hash',v_row->>'validation_status',
        v_row->>'unsubscribe_status',v_row->>'opposition_status',
        v_row->>'hard_bounce_status',v_row->>'suppression_status',
        v_row->>'duplicate_status',v_row->>'campaign_authorization',
        v_row->>'company_size',v_row->>'technical_evidence_sha256'
      ),'UTF8'),'sha256'),'hex');
    if v_computed_row_hash<>v_row->>'row_sha256' then
      raise exception using errcode='22023',message='provision_row_hash_invalid';
    end if;

    insert into public.campaign_contacts(
      campaign_id,external_contact_id,external_account_id,email_hash,contact_data,
      variant,magnet,lot,company_size,current_step,sequence_status,
      next_delivery_status,marketing_lane,cold_sequence_status,suppression_scope
    ) values (
      v_campaign.id,v_row->>'contact_id',v_row->>'account_id',v_row->>'email_hash',
      pg_catalog.jsonb_build_object('email',v_row->>'email'),v_row->>'variant',
      v_row->>'variant',v_row->>'lot',nullif(v_row->>'company_size',''),1,
      'pending','pending','cold','pending','none'
    ) on conflict(campaign_id,external_contact_id) do nothing;
    select * into v_contact from public.campaign_contacts
    where campaign_id=v_campaign.id
      and external_contact_id=v_row->>'contact_id' for update;
    if not found or v_contact.external_account_id<>v_row->>'account_id' or
       v_contact.email_hash<>v_row->>'email_hash' or
       v_contact.variant<>v_row->>'variant' or v_contact.lot<>v_row->>'lot' or
       v_contact.contact_data->>'email'<>v_row->>'email' then
      raise exception using errcode='23505',message='row_collision';
    end if;

    insert into public.campaign_unsubscribe_tokens(
      campaign_id,campaign_contact_id,token_hash,token_version
    ) values (v_campaign.id,v_contact.id,v_row->>'token_hash',1)
    on conflict(campaign_contact_id,token_version) do nothing;
    select id into v_token_id from public.campaign_unsubscribe_tokens
    where campaign_contact_id=v_contact.id and token_version=1
      and token_hash=v_row->>'token_hash' and revoked_at is null;
    if not found then
      raise exception using errcode='23505',message='unsubscribe_token_collision';
    end if;

    insert into public.campaign_executions(
      campaign_id,campaign_contact_id,idempotency_key,channel,capture_method,
      action_name,step,status,scheduled_for,planned_at,metadata
    ) values (
      v_campaign.id,v_contact.id,v_row->>'execution_key','email','automation',
      'delivery_scheduled',(v_row->>'step')::integer,'planned',
      (v_row->>'scheduled_for')::timestamptz,v_now,'{}'::jsonb
    ) on conflict(campaign_id,idempotency_key) do nothing;
    select * into v_execution from public.campaign_executions
    where campaign_id=v_campaign.id
      and idempotency_key=v_row->>'execution_key' for update;
    if not found or v_execution.campaign_contact_id<>v_contact.id or
       v_execution.step<>(v_row->>'step')::integer or
       v_execution.status<>'planned' or
       v_execution.scheduled_for<>(v_row->>'scheduled_for')::timestamptz then
      raise exception using errcode='23505',message='execution_collision';
    end if;

    insert into public.cold_campaign_message_payloads(
      campaign_execution_id,recipient_email,subject,html_body,payload_sha256,
      unsubscribe_materialized
    ) values (
      v_execution.id,v_row->>'recipient_email',v_row->>'subject',
      v_row->>'html_body',v_row->>'payload_sha256',true
    ) on conflict(campaign_execution_id) do nothing;
    if not exists(
      select 1 from public.cold_campaign_message_payloads p
      where p.campaign_execution_id=v_execution.id
        and p.recipient_email=v_row->>'recipient_email'
        and p.subject=v_row->>'subject' and p.html_body=v_row->>'html_body'
        and p.payload_sha256=v_row->>'payload_sha256'
        and p.unsubscribe_materialized
    ) then
      raise exception using errcode='23505',message='payload_collision';
    end if;
  end loop;

  update public.campaigns set is_active=false,status='draft' where id=v_campaign.id;
  insert into public.cold_campaign_provision_batches(
    manifest_hash,batch_index,batch_count,batch_hash,row_count,actor_hash,row_hashes
  ) values (
    p_manifest_hash,p_batch_index,p_batch_count,p_batch_hash,v_row_count,
    p_actor_hash,v_row_hashes
  ) on conflict(manifest_hash,batch_index) do nothing;
  return pg_catalog.jsonb_build_object(
    'accepted',true,'duplicate',false,'reason_code','batch_applied',
    'row_count',v_row_count
  );
end;
$$;

create or replace function public.finalize_cold_campaign_provision(
  p_manifest_hash text,p_actor_hash text,p_authorization_hash text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_control public.cold_campaign_provision_control%rowtype;
  v_outbound public.outbound_delivery_control%rowtype;
  v_manifest public.cold_campaign_provision_manifests%rowtype;
  v_now timestamptz;
  v_batches integer;
  v_rows integer;
  v_computed_manifest_hash text;
begin
  if p_manifest_hash !~ '^[a-f0-9]{64}$' or
     p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_authorization_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='finalize_request_invalid';
  end if;
  select * into v_control
  from public.cold_campaign_provision_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or not v_control.enabled or v_control.expires_at<=v_now or
     v_control.expected_manifest_hash<>p_manifest_hash or
     v_control.expected_authorization_hash<>p_authorization_hash or
     v_control.authorized_actor_hash<>p_actor_hash then
    raise exception using errcode='42501',message='provision_control_closed';
  end if;
  select * into v_outbound
  from public.outbound_delivery_control where singleton for update;
  if not found or v_outbound.master_enabled or v_outbound.cold_enabled then
    raise exception using errcode='55000',message='outbound_must_remain_off';
  end if;
  select * into v_manifest from public.cold_campaign_provision_manifests
  where manifest_hash=p_manifest_hash for update;
  if not found or v_manifest.actor_hash<>p_actor_hash or
     v_manifest.hash_domain<>'cold-provision-v3' or
     v_manifest.technical_evidence_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='23505',message='manifest_collision';
  end if;
  if v_manifest.status='prepared_off' then
    return pg_catalog.jsonb_build_object(
      'accepted',true,'duplicate',true,'reason_code','already_prepared_off'
    );
  end if;
  select count(*),coalesce(sum(row_count),0)
  into v_batches,v_rows from public.cold_campaign_provision_batches
  where manifest_hash=p_manifest_hash;
  if v_batches<>v_manifest.batch_count or v_rows<>4695 or exists(
    select 1 from pg_catalog.generate_series(0,v_manifest.batch_count-1) expected
    where not exists(
      select 1 from public.cold_campaign_provision_batches b
      where b.manifest_hash=p_manifest_hash and b.batch_index=expected
    )
  ) then
    raise exception using errcode='55000',message='partial_batch_set';
  end if;
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.concat_ws(pg_catalog.chr(31),
      'cold-provision-v3',v_manifest.logical_dataset_hash,
      v_manifest.technical_evidence_hash,v_manifest.campaign_external_id,
      pg_catalog.string_agg(row_hash,E'\n' order by row_hash)
    ),'UTF8'),'sha256'),'hex')
  into v_computed_manifest_hash
  from public.cold_campaign_provision_batches b
  cross join lateral pg_catalog.unnest(b.row_hashes) as hashes(row_hash)
  where b.manifest_hash=p_manifest_hash;
  if v_computed_manifest_hash<>p_manifest_hash or not exists(
    select 1 from public.campaigns c
    where c.id=v_manifest.campaign_id
      and c.external_id=v_manifest.campaign_external_id
      and not c.is_active and c.status='draft'
  ) then
    raise exception using errcode='23514',message='provision_manifest_hash_invalid';
  end if;
  if (select count(*) from public.campaign_contacts
      where campaign_id=v_manifest.campaign_id)<>939 or
     (select count(*) from public.campaign_contacts
      where campaign_id=v_manifest.campaign_id and lot='A')<>235 or
     (select count(*) from public.campaign_contacts
      where campaign_id=v_manifest.campaign_id and lot='B')<>235 or
     (select count(*) from public.campaign_contacts
      where campaign_id=v_manifest.campaign_id and lot='C')<>235 or
     (select count(*) from public.campaign_contacts
      where campaign_id=v_manifest.campaign_id and lot='D')<>234 then
    raise exception using errcode='55000',message='contact_or_lot_count_invalid';
  end if;
  if (select count(*) from public.campaign_executions
      where campaign_id=v_manifest.campaign_id and channel='email'
        and action_name='delivery_scheduled')<>4695 or
     (select count(*) from public.cold_campaign_message_payloads p
      join public.campaign_executions e on e.id=p.campaign_execution_id
      where e.campaign_id=v_manifest.campaign_id)<>4695 or exists(
       select 1 from public.campaign_executions e
       where e.campaign_id=v_manifest.campaign_id
       group by e.campaign_contact_id
       having count(*) filter(
         where e.channel='email' and e.action_name='delivery_scheduled'
       )<>5 or count(distinct e.step) filter(
         where e.channel='email' and e.action_name='delivery_scheduled'
       )<>5
     ) then
    raise exception using errcode='55000',message='execution_or_payload_count_invalid';
  end if;
  update public.cold_campaign_provision_manifests
  set status='prepared_off',prepared_at=v_now where manifest_hash=p_manifest_hash;
  update public.cold_campaign_provision_control
  set enabled=false,updated_at=v_now where singleton;
  return pg_catalog.jsonb_build_object(
    'accepted',true,'duplicate',false,'reason_code','prepared_off',
    'contacts',939,'payloads',4695,'hash_domain','cold-provision-v3',
    'technical_evidence_hash',v_manifest.technical_evidence_hash
  );
end;
$$;

revoke execute on function public.apply_cold_campaign_provision_batch(
  text,text,integer,integer,text,text,text,text,jsonb
) from public,anon,authenticated;
revoke execute on function public.finalize_cold_campaign_provision(text,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_cold_campaign_provision_batch(
  text,text,integer,integer,text,text,text,text,jsonb
) to service_role;
grant execute on function public.finalize_cold_campaign_provision(text,text,text)
  to service_role;

-- Applying the contract never activates outbound or provisioning.
update public.outbound_delivery_control
set master_enabled = false, transactional_enabled = false, cold_enabled = false,
    halt_reason = 'CAMPAIGN_TERMINAL_SUPPRESSION_HARDENED',
    updated_at = pg_catalog.clock_timestamp()
where singleton;
update public.cold_campaign_provision_control
set enabled = false, updated_at = pg_catalog.clock_timestamp()
where singleton;

commit;
-- 20260819234100_campaign_contact_suppression_insert_gate.sql
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

-- 20260819234200_transactional_graph_pilot_authorization_fk_index.sql
-- Cover the pilot authorization foreign key reported by Supabase advisors.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create index if not exists transactional_graph_pilot_authorization_fk_idx
  on public.transactional_graph_pilot_runs (authorization_hash);

commit;

-- 20260819234300_transactional_graph_pilot_alert_hardening.sql
-- Keep pilot shutdown authoritative even when alert delivery is unavailable.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter function public.authorize_graph_draft_send(uuid,text,text,text)
  rename to authorize_graph_draft_send_pre_alert_20260819;

create or replace function public.authorize_graph_draft_send(
  p_reservation_id uuid,
  p_send_capability_hash text,
  p_stop_snapshot_hash text,
  p_observed_change_key_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_dispatch public.transactional_dispatch_outbox%rowtype;
  v_active_run public.transactional_graph_pilot_runs%rowtype;
  v_dispatch_found boolean := false;
  v_now timestamptz;
  v_reason text;
  v_context_hash text;
  v_evidence_hash text;
  v_actor_hash text := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('transactional-graph-pilot-authorization-guard-v1', 'UTF8'),
    'sha256'
  ), 'hex');
  v_alert_enqueued boolean := false;
begin
  select * into v_control
  from public.outbound_delivery_control
  where singleton
  for update;

  select * into v_dispatch
  from public.transactional_dispatch_outbox
  where reservation_id = p_reservation_id
  for update;
  v_dispatch_found := found;

  if v_dispatch_found and v_dispatch.pilot_run_id is not null then
    return public.authorize_graph_draft_send_pre_alert_20260819(
      p_reservation_id,
      p_send_capability_hash,
      p_stop_snapshot_hash,
      p_observed_change_key_hash
    );
  end if;

  select * into v_active_run
  from public.transactional_graph_pilot_runs
  where status = 'active'
  for update;

  if v_active_run.run_id is null and
     (v_control.singleton is null or
      v_control.halt_reason is distinct from 'TRANSACTIONAL_GRAPH_PILOT_ACTIVE') then
    return public.authorize_graph_draft_send_pre_alert_20260819(
      p_reservation_id,
      p_send_capability_hash,
      p_stop_snapshot_hash,
      p_observed_change_key_hash
    );
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_reason := case when v_active_run.run_id is null
    then 'TRANSACTIONAL_GRAPH_PILOT_ORPHAN_AUTHORIZATION'
    else 'TRANSACTIONAL_GRAPH_PILOT_UNSCOPED_AUTHORIZATION' end;
  v_context_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(p_reservation_id::text, 'UTF8'), 'sha256'
  ), 'hex');
  v_evidence_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.concat_ws(pg_catalog.chr(31), 'pilot-authorization-guard-v1',
      v_reason, coalesce(v_active_run.run_id, 'orphan'), p_reservation_id::text),
    'UTF8'
  ), 'sha256'), 'hex');

  if v_active_run.run_id is not null then
    update public.transactional_graph_pilot_runs
    set status = 'halted', finished_at = v_now,
        finish_evidence_hash = v_evidence_hash, updated_at = v_now
    where run_id = v_active_run.run_id and status = 'active';
  end if;

  update public.outbound_delivery_control
  set master_enabled = false,
      transactional_enabled = false,
      cold_enabled = false,
      halt_reason = v_reason,
      updated_by_hash = v_evidence_hash,
      updated_at = v_now
  where singleton;

  begin
    perform public.enqueue_operational_alert_delivery(
      v_reason, v_context_hash, v_evidence_hash, v_actor_hash
    );
    v_alert_enqueued := true;
  exception when others then
    v_alert_enqueued := false;
  end;

  return pg_catalog.jsonb_build_object(
    'authorized', false,
    'duplicate', false,
    'reason_code', 'draft_neutralization_required',
    'pilot_reason_code', 'pilot_scope_violation',
    'reservation_id', p_reservation_id,
    'mailbox_halted', true,
    'retry_after_seconds', 0,
    'alert_attempted', true,
    'alert_enqueued', v_alert_enqueued
  );
end;
$$;

alter function fundae_private.enforce_transactional_graph_pilot_deadline()
  rename to enforce_transactional_graph_pilot_deadline_pre_alert_20260819;

create or replace function fundae_private.enforce_transactional_graph_pilot_deadline()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_reason_code text;
  v_summary_code text;
  v_context_hash text;
  v_evidence_hash text;
  v_actor_hash text := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('transactional-graph-pilot-watchdog-v1', 'UTF8'),
    'sha256'
  ), 'hex');
  v_alert_enqueued boolean := false;
begin
  v_result := fundae_private.enforce_transactional_graph_pilot_deadline_pre_alert_20260819();
  v_reason_code := v_result ->> 'reason_code';

  if v_reason_code not in (
    'pilot_scope_expired',
    'pilot_control_violation',
    'pilot_orphan_halted',
    'control_unavailable'
  ) then
    return v_result || pg_catalog.jsonb_build_object(
      'alert_attempted', false,
      'alert_enqueued', false
    );
  end if;

  v_summary_code := case v_reason_code
    when 'pilot_scope_expired' then 'TRANSACTIONAL_GRAPH_PILOT_EXPIRED'
    when 'pilot_control_violation' then 'TRANSACTIONAL_GRAPH_PILOT_CONTROL_VIOLATION'
    when 'pilot_orphan_halted' then 'TRANSACTIONAL_GRAPH_PILOT_WATCHDOG_ORPHAN'
    else 'TRANSACTIONAL_GRAPH_PILOT_CONTROL_UNAVAILABLE'
  end;
  v_context_hash := coalesce(
    v_result ->> 'run_id_hash',
    pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to('pilot-watchdog-context-v1:' || v_summary_code, 'UTF8'),
      'sha256'
    ), 'hex')
  );
  v_evidence_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.concat_ws(pg_catalog.chr(31), 'pilot-watchdog-alert-v1',
      v_summary_code, v_context_hash),
    'UTF8'
  ), 'sha256'), 'hex');

  begin
    perform public.enqueue_operational_alert_delivery(
      v_summary_code, v_context_hash, v_evidence_hash, v_actor_hash
    );
    v_alert_enqueued := true;
  exception when others then
    v_alert_enqueued := false;
  end;

  return v_result || pg_catalog.jsonb_build_object(
    'alert_attempted', true,
    'alert_enqueued', v_alert_enqueued
  );
end;
$$;

revoke execute on function
  public.authorize_graph_draft_send_pre_alert_20260819(uuid,text,text,text),
  public.authorize_graph_draft_send(uuid,text,text,text)
from public, anon, authenticated, service_role;

grant execute on function public.authorize_graph_draft_send(uuid,text,text,text)
to service_role;

revoke execute on function
  fundae_private.enforce_transactional_graph_pilot_deadline_pre_alert_20260819(),
  fundae_private.enforce_transactional_graph_pilot_deadline()
from public, anon, authenticated, service_role;

grant execute on function fundae_private.enforce_transactional_graph_pilot_deadline()
to postgres;

commit;
-- 20260819234400_campaign_conditional_delivery_hardening.sql
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create or replace function public.apply_cold_campaign_provision_batch(
  p_manifest_hash text,p_logical_dataset_hash text,p_batch_index integer,p_batch_count integer,p_batch_hash text,
  p_actor_hash text,p_authorization_hash text,p_campaign_external_id text,p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_control public.cold_campaign_provision_control%rowtype;
  v_outbound public.outbound_delivery_control%rowtype;
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_existing public.cold_campaign_provision_batches%rowtype;
  v_existing_manifest public.cold_campaign_provision_manifests%rowtype;
  v_row jsonb;
  v_now timestamptz;
  v_row_count integer;
  v_computed_batch_hash text;
  v_row_hashes text[];
  v_technical_evidence_hash text;
  v_technical_evidence_max text;
  v_computed_row_hash text;
  v_token_id uuid;
  v_token text;
  v_token_occurrences integer;
  v_canonical_payload text;
begin
  if p_manifest_hash !~ '^[a-f0-9]{64}$' or p_logical_dataset_hash !~ '^[a-f0-9]{64}$' or
     p_batch_hash !~ '^[a-f0-9]{64}$' or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_authorization_hash !~ '^[a-f0-9]{64}$' or
     p_campaign_external_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_batch_count not between 1 and 100 or
     p_batch_index not between 0 and p_batch_count-1 or
     pg_catalog.jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023',message='provision_request_invalid';
  end if;
  v_row_count:=pg_catalog.jsonb_array_length(p_rows);
  if v_row_count not between 1 and 500 then
    raise exception using errcode='22023',message='provision_batch_size_invalid';
  end if;
  select
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.string_agg(item->>'row_sha256',E'\n' order by item->>'row_sha256'),'UTF8'),'sha256'),'hex'),
    pg_catalog.array_agg(item->>'row_sha256' order by item->>'row_sha256'),
    pg_catalog.min(item->>'technical_evidence_sha256'),
    pg_catalog.max(item->>'technical_evidence_sha256')
  into v_computed_batch_hash,v_row_hashes,v_technical_evidence_hash,v_technical_evidence_max
  from pg_catalog.jsonb_array_elements(p_rows) item;
  if v_computed_batch_hash<>p_batch_hash then
    raise exception using errcode='22023',message='provision_batch_hash_invalid';
  end if;
  if v_technical_evidence_hash is null or
     v_technical_evidence_hash !~ '^[a-f0-9]{64}$' or
     v_technical_evidence_hash<>v_technical_evidence_max then
    raise exception using errcode='22023',message='provision_technical_evidence_invalid';
  end if;

  -- Recompute every row before the replay shortcut. A caller cannot obtain an
  -- accepted duplicate response by pairing an old row_sha256 with drifted data.
  for v_row in select item from pg_catalog.jsonb_array_elements(p_rows) item loop
    if (select count(*) from pg_catalog.jsonb_object_keys(v_row))<>27 or
       v_row->>'campaign_external_id'<>p_campaign_external_id or
       v_row->>'technical_evidence_sha256'<>v_technical_evidence_hash or
       v_row->>'row_sha256' !~ '^[a-f0-9]{64}$' then
      raise exception using errcode='22023',message='provision_row_shape_invalid';
    end if;
    v_computed_row_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.concat_ws(pg_catalog.chr(31),
        v_row->>'campaign_external_id',v_row->>'contact_id',v_row->>'account_id',
        v_row->>'email',v_row->>'email_hash',v_row->>'variant',v_row->>'lot',
        v_row->>'step',v_row->>'scheduled_for',v_row->>'execution_key',
        v_row->>'recipient_email',v_row->>'subject',v_row->>'html_body',
        v_row->>'payload_sha256',v_row->>'token_hash',v_row->>'validation_status',
        v_row->>'unsubscribe_status',v_row->>'opposition_status',
        v_row->>'hard_bounce_status',v_row->>'suppression_status',
        v_row->>'duplicate_status',v_row->>'campaign_authorization',
        v_row->>'company_size',v_row->>'technical_evidence_sha256',
        v_row->>'parent_contact_id',v_row->>'conditional_delivery'
      ),'UTF8'),'sha256'),'hex');
    if v_computed_row_hash<>v_row->>'row_sha256' then
      raise exception using errcode='22023',message='provision_row_hash_invalid';
    end if;
  end loop;

  select * into v_control
  from public.cold_campaign_provision_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or not v_control.enabled or v_control.expires_at<=v_now or
     v_control.expected_manifest_hash<>p_manifest_hash or
     v_control.expected_authorization_hash<>p_authorization_hash or
     v_control.authorized_actor_hash<>p_actor_hash then
    raise exception using errcode='42501',message='provision_control_closed';
  end if;
  select * into v_outbound
  from public.outbound_delivery_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or v_outbound.master_enabled or v_outbound.cold_enabled then
    raise exception using errcode='55000',message='outbound_must_remain_off';
  end if;

  select * into v_existing_manifest
  from public.cold_campaign_provision_manifests
  where manifest_hash=p_manifest_hash for update;
  if found and (
    v_existing_manifest.hash_domain<>'cold-provision-v3' or
    v_existing_manifest.actor_hash<>p_actor_hash or
    v_existing_manifest.logical_dataset_hash<>p_logical_dataset_hash or
    v_existing_manifest.technical_evidence_hash<>v_technical_evidence_hash or
    v_existing_manifest.campaign_external_id<>p_campaign_external_id or
    v_existing_manifest.batch_count<>p_batch_count
  ) then
    raise exception using errcode='23505',message='manifest_collision';
  end if;

  select * into v_existing from public.cold_campaign_provision_batches
  where manifest_hash=p_manifest_hash and batch_index=p_batch_index for update;
  if found then
    if v_existing.batch_hash<>p_batch_hash or
       v_existing.batch_count<>p_batch_count or
       v_existing.row_count<>v_row_count or
       v_existing.actor_hash<>p_actor_hash or
       v_existing.row_hashes<>v_row_hashes then
      raise exception using errcode='23505',message='provision_batch_collision';
    end if;
    return pg_catalog.jsonb_build_object(
      'accepted',true,'duplicate',true,'reason_code','batch_replayed'
    );
  end if;

  insert into public.campaigns(name,is_active,external_id,timezone,status)
  values('FUNDAE 2026 Email Campaign',false,p_campaign_external_id,'Europe/Madrid','draft')
  on conflict(external_id) do nothing;
  select * into v_campaign
  from public.campaigns where external_id=p_campaign_external_id for update;
  if not found or v_campaign.is_active or v_campaign.status<>'draft' then
    raise exception using errcode='23505',message='campaign_collision';
  end if;
  insert into public.cold_campaign_provision_manifests(
    manifest_hash,campaign_id,actor_hash,logical_dataset_hash,
    technical_evidence_hash,campaign_external_id,hash_domain,batch_count
  ) values (
    p_manifest_hash,v_campaign.id,p_actor_hash,p_logical_dataset_hash,
    v_technical_evidence_hash,p_campaign_external_id,'cold-provision-v3',p_batch_count
  ) on conflict(manifest_hash) do nothing;
  if not exists(
    select 1 from public.cold_campaign_provision_manifests m
    where m.manifest_hash=p_manifest_hash and m.campaign_id=v_campaign.id
      and m.actor_hash=p_actor_hash
      and m.logical_dataset_hash=p_logical_dataset_hash
      and m.technical_evidence_hash=v_technical_evidence_hash
      and m.campaign_external_id=p_campaign_external_id
      and m.hash_domain='cold-provision-v3'
      and m.batch_count=p_batch_count and m.status='applying'
  ) then
    raise exception using errcode='23505',message='manifest_collision';
  end if;

  -- The stop-gate validates planned rows while MVCC keeps pilot state private.
  -- Every path restores draft before commit; any exception rolls back atomically.
  update public.campaigns set is_active=true,status='pilot' where id=v_campaign.id;

  for v_row in select item from pg_catalog.jsonb_array_elements(p_rows) item loop
    if (select count(*) from pg_catalog.jsonb_object_keys(v_row))<>27 or exists(
      select 1 from pg_catalog.jsonb_object_keys(v_row) key where key not in (
        'campaign_external_id','contact_id','account_id','email','email_hash','variant','lot','step','scheduled_for','execution_key',
        'recipient_email','subject','html_body','payload_sha256','token_hash','validation_status','unsubscribe_status','opposition_status',
        'hard_bounce_status','suppression_status','duplicate_status','campaign_authorization','row_sha256','company_size',
        'technical_evidence_sha256','parent_contact_id','conditional_delivery'
      )
    ) then
      raise exception using errcode='22023',message='provision_row_shape_invalid';
    end if;
    if v_row->>'campaign_external_id'<>p_campaign_external_id or
       v_row->>'technical_evidence_sha256'<>v_technical_evidence_hash or
       v_row->>'validation_status'<>'OK' or
       v_row->>'unsubscribe_status'<>'CLEAR' or
       v_row->>'opposition_status'<>'CLEAR' or
       v_row->>'hard_bounce_status'<>'CLEAR' or
       v_row->>'suppression_status'<>'CLEAR' or
       v_row->>'duplicate_status'<>'CLEAR' or
       v_row->>'campaign_authorization'<>'AUTHORIZED' or
       v_row->>'conditional_delivery' not in ('true','false') or
       ((v_row->>'conditional_delivery')::boolean and (
         coalesce(v_row->>'parent_contact_id','')='' or
         v_row->>'parent_contact_id'=v_row->>'contact_id'
       )) or
       (not (v_row->>'conditional_delivery')::boolean and
         coalesce(v_row->>'parent_contact_id','')<>'') or
       (v_row->>'step')::integer not between 1 and 5 or
       v_row->>'lot' not in ('A','B','C','D') or
       v_row->>'email_hash' !~ '^[a-f0-9]{64}$' or
       v_row->>'payload_sha256' !~ '^[a-f0-9]{64}$' or
       v_row->>'token_hash' !~ '^[a-f0-9]{64}$' or
       v_row->>'row_sha256' !~ '^[a-f0-9]{64}$' or
       v_row->>'email'<>pg_catalog.lower(v_row->>'email') or
       v_row->>'recipient_email'<>v_row->>'email' or
       not fundae_private.is_cold_campaign_hmac_identity(
         v_row->>'email',v_row->>'email_hash'
       ) or pg_catalog.strpos(v_row->>'html_body','{{unsubscribe_url}}')>0 then
      raise exception using errcode='22023',message='provision_row_gate_invalid';
    end if;
    select count(*),min(match[1]) into v_token_occurrences,v_token
    from pg_catalog.regexp_matches(
      v_row->>'html_body','(u1[.][A-Za-z0-9_-]{43})','g'
    ) match;
    if v_token_occurrences<>1 or
       pg_catalog.strpos(v_row->>'html_body','/baja?token='||v_token)=0 or
       pg_catalog.encode(extensions.digest(
         pg_catalog.convert_to(v_token,'UTF8'),'sha256'
       ),'hex')<>v_row->>'token_hash' then
      raise exception using errcode='22023',message='provision_unsubscribe_binding_invalid';
    end if;
    v_canonical_payload:='{"recipient":'||pg_catalog.to_json(v_row->>'recipient_email')::text||
      ',"subject":'||pg_catalog.to_json(v_row->>'subject')::text||
      ',"body":'||pg_catalog.to_json(v_row->>'html_body')::text||',"attachments":[]}';
    if pg_catalog.encode(extensions.digest(
         pg_catalog.convert_to(v_canonical_payload,'UTF8'),'sha256'
       ),'hex')<>v_row->>'payload_sha256' then
      raise exception using errcode='22023',message='provision_payload_hash_invalid';
    end if;
    v_computed_row_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.concat_ws(pg_catalog.chr(31),
        v_row->>'campaign_external_id',v_row->>'contact_id',v_row->>'account_id',
        v_row->>'email',v_row->>'email_hash',v_row->>'variant',v_row->>'lot',
        v_row->>'step',v_row->>'scheduled_for',v_row->>'execution_key',
        v_row->>'recipient_email',v_row->>'subject',v_row->>'html_body',
        v_row->>'payload_sha256',v_row->>'token_hash',v_row->>'validation_status',
        v_row->>'unsubscribe_status',v_row->>'opposition_status',
        v_row->>'hard_bounce_status',v_row->>'suppression_status',
        v_row->>'duplicate_status',v_row->>'campaign_authorization',
        v_row->>'company_size',v_row->>'technical_evidence_sha256',
        v_row->>'parent_contact_id',v_row->>'conditional_delivery'
      ),'UTF8'),'sha256'),'hex');
    if v_computed_row_hash<>v_row->>'row_sha256' then
      raise exception using errcode='22023',message='provision_row_hash_invalid';
    end if;

    insert into public.campaign_contacts(
      campaign_id,external_contact_id,external_account_id,email_hash,contact_data,
      variant,magnet,lot,company_size,parent_external_contact_id,conditional_delivery,
      current_step,sequence_status,next_delivery_status,marketing_lane,
      cold_sequence_status,suppression_scope
    ) values (
      v_campaign.id,v_row->>'contact_id',v_row->>'account_id',v_row->>'email_hash',
      pg_catalog.jsonb_build_object('email',v_row->>'email'),v_row->>'variant',
      v_row->>'variant',v_row->>'lot',nullif(v_row->>'company_size',''),
      nullif(v_row->>'parent_contact_id',''),(v_row->>'conditional_delivery')::boolean,1,
      'pending','pending','cold','pending','none'
    ) on conflict(campaign_id,external_contact_id) do nothing;
    select * into v_contact from public.campaign_contacts
    where campaign_id=v_campaign.id
      and external_contact_id=v_row->>'contact_id' for update;
    if not found or v_contact.external_account_id<>v_row->>'account_id' or
       v_contact.email_hash<>v_row->>'email_hash' or
       v_contact.variant<>v_row->>'variant' or v_contact.lot<>v_row->>'lot' or
       v_contact.parent_external_contact_id is distinct from nullif(v_row->>'parent_contact_id','') or
       v_contact.conditional_delivery is distinct from (v_row->>'conditional_delivery')::boolean or
       v_contact.contact_data->>'email'<>v_row->>'email' then
      raise exception using errcode='23505',message='row_collision';
    end if;

    insert into public.campaign_unsubscribe_tokens(
      campaign_id,campaign_contact_id,token_hash,token_version
    ) values (v_campaign.id,v_contact.id,v_row->>'token_hash',1)
    on conflict(campaign_contact_id,token_version) do nothing;
    select id into v_token_id from public.campaign_unsubscribe_tokens
    where campaign_contact_id=v_contact.id and token_version=1
      and token_hash=v_row->>'token_hash' and revoked_at is null;
    if not found then
      raise exception using errcode='23505',message='unsubscribe_token_collision';
    end if;

    insert into public.campaign_executions(
      campaign_id,campaign_contact_id,idempotency_key,channel,capture_method,
      action_name,step,status,scheduled_for,planned_at,metadata
    ) values (
      v_campaign.id,v_contact.id,v_row->>'execution_key','email','automation',
      'delivery_scheduled',(v_row->>'step')::integer,'planned',
      (v_row->>'scheduled_for')::timestamptz,v_now,'{}'::jsonb
    ) on conflict(campaign_id,idempotency_key) do nothing;
    select * into v_execution from public.campaign_executions
    where campaign_id=v_campaign.id
      and idempotency_key=v_row->>'execution_key' for update;
    if not found or v_execution.campaign_contact_id<>v_contact.id or
       v_execution.step<>(v_row->>'step')::integer or
       v_execution.status<>'planned' or
       v_execution.scheduled_for<>(v_row->>'scheduled_for')::timestamptz then
      raise exception using errcode='23505',message='execution_collision';
    end if;

    insert into public.cold_campaign_message_payloads(
      campaign_execution_id,recipient_email,subject,html_body,payload_sha256,
      unsubscribe_materialized
    ) values (
      v_execution.id,v_row->>'recipient_email',v_row->>'subject',
      v_row->>'html_body',v_row->>'payload_sha256',true
    ) on conflict(campaign_execution_id) do nothing;
    if not exists(
      select 1 from public.cold_campaign_message_payloads p
      where p.campaign_execution_id=v_execution.id
        and p.recipient_email=v_row->>'recipient_email'
        and p.subject=v_row->>'subject' and p.html_body=v_row->>'html_body'
        and p.payload_sha256=v_row->>'payload_sha256'
        and p.unsubscribe_materialized
    ) then
      raise exception using errcode='23505',message='payload_collision';
    end if;
  end loop;

  update public.campaigns set is_active=false,status='draft' where id=v_campaign.id;
  insert into public.cold_campaign_provision_batches(
    manifest_hash,batch_index,batch_count,batch_hash,row_count,actor_hash,row_hashes
  ) values (
    p_manifest_hash,p_batch_index,p_batch_count,p_batch_hash,v_row_count,
    p_actor_hash,v_row_hashes
  ) on conflict(manifest_hash,batch_index) do nothing;
  return pg_catalog.jsonb_build_object(
    'accepted',true,'duplicate',false,'reason_code','batch_applied',
    'row_count',v_row_count
  );
end;
$$;

create or replace function public.finalize_cold_campaign_provision(
  p_manifest_hash text,p_actor_hash text,p_authorization_hash text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_control public.cold_campaign_provision_control%rowtype;
  v_outbound public.outbound_delivery_control%rowtype;
  v_manifest public.cold_campaign_provision_manifests%rowtype;
  v_now timestamptz;
  v_batches integer;
  v_rows integer;
  v_computed_manifest_hash text;
begin
  if p_manifest_hash !~ '^[a-f0-9]{64}$' or
     p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_authorization_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='finalize_request_invalid';
  end if;
  select * into v_control
  from public.cold_campaign_provision_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or not v_control.enabled or v_control.expires_at<=v_now or
     v_control.expected_manifest_hash<>p_manifest_hash or
     v_control.expected_authorization_hash<>p_authorization_hash or
     v_control.authorized_actor_hash<>p_actor_hash then
    raise exception using errcode='42501',message='provision_control_closed';
  end if;
  select * into v_outbound
  from public.outbound_delivery_control where singleton for update;
  if not found or v_outbound.master_enabled or v_outbound.cold_enabled then
    raise exception using errcode='55000',message='outbound_must_remain_off';
  end if;
  select * into v_manifest from public.cold_campaign_provision_manifests
  where manifest_hash=p_manifest_hash for update;
  if not found or v_manifest.actor_hash<>p_actor_hash or
     v_manifest.hash_domain<>'cold-provision-v3' or
     v_manifest.technical_evidence_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='23505',message='manifest_collision';
  end if;
  if v_manifest.status='prepared_off' then
    return pg_catalog.jsonb_build_object(
      'accepted',true,'duplicate',true,'reason_code','already_prepared_off'
    );
  end if;
  select count(*),coalesce(sum(row_count),0)
  into v_batches,v_rows from public.cold_campaign_provision_batches
  where manifest_hash=p_manifest_hash;
  if v_batches<>v_manifest.batch_count or v_rows<>4695 or exists(
    select 1 from pg_catalog.generate_series(0,v_manifest.batch_count-1) expected
    where not exists(
      select 1 from public.cold_campaign_provision_batches b
      where b.manifest_hash=p_manifest_hash and b.batch_index=expected
    )
  ) then
    raise exception using errcode='55000',message='partial_batch_set';
  end if;
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.concat_ws(pg_catalog.chr(31),
      'cold-provision-v3',v_manifest.logical_dataset_hash,
      v_manifest.technical_evidence_hash,v_manifest.campaign_external_id,
      pg_catalog.string_agg(row_hash,E'\n' order by row_hash)
    ),'UTF8'),'sha256'),'hex')
  into v_computed_manifest_hash
  from public.cold_campaign_provision_batches b
  cross join lateral pg_catalog.unnest(b.row_hashes) as hashes(row_hash)
  where b.manifest_hash=p_manifest_hash;
  if v_computed_manifest_hash<>p_manifest_hash or not exists(
    select 1 from public.campaigns c
    where c.id=v_manifest.campaign_id
      and c.external_id=v_manifest.campaign_external_id
      and not c.is_active and c.status='draft'
  ) then
    raise exception using errcode='23514',message='provision_manifest_hash_invalid';
  end if;
  if (select count(*) from public.campaign_contacts
      where campaign_id=v_manifest.campaign_id)<>939 or
     (select count(*) from public.campaign_contacts
      where campaign_id=v_manifest.campaign_id and lot='A')<>235 or
     (select count(*) from public.campaign_contacts
      where campaign_id=v_manifest.campaign_id and lot='B')<>235 or
     (select count(*) from public.campaign_contacts
      where campaign_id=v_manifest.campaign_id and lot='C')<>235 or
     (select count(*) from public.campaign_contacts
      where campaign_id=v_manifest.campaign_id and lot='D')<>234 then
    raise exception using errcode='55000',message='contact_or_lot_count_invalid';
  end if;
  if (select count(*) from public.campaign_executions
      where campaign_id=v_manifest.campaign_id and channel='email'
        and action_name='delivery_scheduled')<>4695 or
     (select count(*) from public.cold_campaign_message_payloads p
      join public.campaign_executions e on e.id=p.campaign_execution_id
      where e.campaign_id=v_manifest.campaign_id)<>4695 or exists(
       select 1 from public.campaign_executions e
       where e.campaign_id=v_manifest.campaign_id
       group by e.campaign_contact_id
       having count(*) filter(
         where e.channel='email' and e.action_name='delivery_scheduled'
       )<>5 or count(distinct e.step) filter(
         where e.channel='email' and e.action_name='delivery_scheduled'
       )<>5
     ) then
    raise exception using errcode='55000',message='execution_or_payload_count_invalid';
  end if;
  if (select count(*) from public.campaign_contacts
      where campaign_id=v_manifest.campaign_id and conditional_delivery)<>104 or
     exists(
       select 1
       from public.campaign_contacts child
       left join public.campaign_contacts parent
         on parent.campaign_id=child.campaign_id
        and parent.external_contact_id=child.parent_external_contact_id
       where child.campaign_id=v_manifest.campaign_id and (
         (child.conditional_delivery and (
           child.parent_external_contact_id is null or parent.id is null or
           parent.id=child.id or parent.conditional_delivery or
           parent.variant<>child.variant
         )) or
         (not child.conditional_delivery and child.parent_external_contact_id is not null)
       )
     ) then
    raise exception using errcode='55000',message='conditional_contact_graph_invalid';
  end if;
  update public.cold_campaign_provision_manifests
  set status='prepared_off',prepared_at=v_now where manifest_hash=p_manifest_hash;
  update public.cold_campaign_provision_control
  set enabled=false,updated_at=v_now where singleton;
  return pg_catalog.jsonb_build_object(
    'accepted',true,'duplicate',false,'reason_code','prepared_off',
    'contacts',939,'payloads',4695,'hash_domain','cold-provision-v3',
    'technical_evidence_hash',v_manifest.technical_evidence_hash
  );
end;
$$;

revoke execute on function public.apply_cold_campaign_provision_batch(
  text,text,integer,integer,text,text,text,text,jsonb
) from public,anon,authenticated;
revoke execute on function public.finalize_cold_campaign_provision(text,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_cold_campaign_provision_batch(
  text,text,integer,integer,text,text,text,text,jsonb
) to service_role;
grant execute on function public.finalize_cold_campaign_provision(text,text,text)
  to service_role;

alter function public.claim_cold_campaign_dispatch(uuid,text,integer)
  rename to claim_cold_campaign_dispatch_pre_conditional_20260819;

create or replace function public.claim_cold_campaign_dispatch(
  p_worker_id uuid,p_worker_token text,p_lease_seconds integer default 120
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_result jsonb;
  v_dispatch public.cold_campaign_dispatch_outbox%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_child public.campaign_contacts%rowtype;
  v_parent public.campaign_contacts%rowtype;
  v_now timestamptz;
  v_invalid boolean := false;
  v_parent_stopped boolean := false;
  v_evidence text;
begin
  v_result := public.claim_cold_campaign_dispatch_pre_conditional_20260819(
    p_worker_id,p_worker_token,p_lease_seconds
  );
  if pg_catalog.jsonb_typeof(v_result->'items')<>'array' or
     pg_catalog.jsonb_array_length(v_result->'items')=0 then
    return v_result;
  end if;

  select * into v_dispatch
  from public.cold_campaign_dispatch_outbox
  where id=(v_result#>>'{items,0,dispatch_id}')::uuid
  for update;
  if not found then
    return v_result;
  end if;
  select * into v_execution
  from public.campaign_executions
  where id=v_dispatch.campaign_execution_id
  for update;
  select * into v_child
  from public.campaign_contacts
  where id=v_execution.campaign_contact_id
  for update;
  if not found or not v_child.conditional_delivery then
    return v_result;
  end if;
  select * into v_parent
  from public.campaign_contacts
  where campaign_id=v_child.campaign_id
    and external_contact_id=v_child.parent_external_contact_id
  for update;
  v_now:=pg_catalog.clock_timestamp();
  v_invalid:=not found or v_parent.id=v_child.id or
    v_parent.conditional_delivery or v_parent.variant<>v_child.variant;
  if v_invalid then
    v_evidence:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.concat_ws(pg_catalog.chr(31),'conditional-graph-invalid-v1',
        v_child.id::text,coalesce(v_child.parent_external_contact_id,'')),
      'UTF8'),'sha256'),'hex');
    update public.outbound_delivery_control
    set cold_enabled=false,halt_reason='CONDITIONAL_GRAPH_INVALID',updated_at=v_now
    where singleton;
    insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash)
    values('CONDITIONAL_GRAPH_INVALID',v_dispatch.id,v_evidence);
    if v_dispatch.reservation_id is null then
      update public.cold_campaign_dispatch_outbox
      set status='ambiguous_halted',last_reason_code='conditional_graph_invalid',
          terminal_evidence_hash=v_evidence,terminal_at=v_now,updated_at=v_now
      where id=v_dispatch.id;
      return pg_catalog.jsonb_build_object(
        'accepted',false,'reason_code','conditional_graph_invalid','items','[]'::jsonb
      );
    end if;
    return v_result || pg_catalog.jsonb_build_object(
      'reason_code','conditional_graph_invalid_recovery'
    );
  end if;

  v_parent_stopped:=v_parent.sequence_status='stopped' or
    v_parent.cold_sequence_status='stopped' or
    v_parent.marketing_lane<>'cold' or v_parent.suppression_scope<>'none' or
    v_parent.reply_received_at is not null or
    v_parent.meeting_booked_at is not null or
    v_parent.meeting_completed_at is not null or
    v_parent.opportunity_created_at is not null or exists(
      select 1 from public.campaign_suppressions s
      where s.identity_hash=v_parent.email_hash
    ) or exists(
      select 1 from public.campaign_events e
      where e.campaign_contact_id=v_parent.id and e.event_name in (
        'reply_received','positive_reply','unsubscribe','opposition',
        'bounce_hard','meeting_booked','meeting_completed','opportunity_created'
      )
    );
  if not v_parent_stopped then
    return v_result;
  end if;

  update public.campaign_contacts
  set cold_sequence_status='stopped',marketing_lane='none',
      sequence_status='stopped',next_delivery_status='stopped',
      next_scheduled_at=null,locked_at=null,lock_token=null,lock_expires_at=null,
      stopped_at=coalesce(stopped_at,v_now),
      stopped_reason=coalesce(stopped_reason,'conditional_parent_stopped')
  where id=v_child.id;
  update public.campaign_executions
  set status='stopped',stopped_at=coalesce(stopped_at,v_now),
      stop_reason=coalesce(stop_reason,'conditional_parent_stopped')
  where campaign_id=v_child.campaign_id and campaign_contact_id=v_child.id
    and status='planned';
  if v_dispatch.reservation_id is null then
    update public.cold_campaign_dispatch_outbox
    set status='suppressed',last_reason_code='conditional_parent_stopped',
        terminal_at=v_now,updated_at=v_now
    where id=v_dispatch.id;
    return pg_catalog.jsonb_build_object(
      'accepted',true,'reason_code','conditional_parent_stopped','items','[]'::jsonb
    );
  end if;
  return v_result || pg_catalog.jsonb_build_object(
    'reason_code','conditional_parent_recovery_required'
  );
end;
$$;

alter function public.authorize_graph_draft_send(uuid,text,text,text)
  rename to authorize_graph_draft_send_pre_conditional_20260819;

create or replace function public.authorize_graph_draft_send(
  p_reservation_id uuid,p_send_capability_hash text,p_stop_snapshot_hash text,
  p_observed_change_key_hash text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_outbox public.graph_outbox%rowtype;
  v_dispatch public.cold_campaign_dispatch_outbox%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_child public.campaign_contacts%rowtype;
  v_parent public.campaign_contacts%rowtype;
  v_now timestamptz;
  v_invalid boolean := false;
  v_parent_stopped boolean := false;
  v_evidence text;
begin
  select * into v_outbox
  from public.graph_outbox
  where reservation_id=p_reservation_id
  for update;
  if not found or v_outbox.lane<>'cold' then
    return public.authorize_graph_draft_send_pre_conditional_20260819(
      p_reservation_id,p_send_capability_hash,p_stop_snapshot_hash,
      p_observed_change_key_hash
    );
  end if;
  select * into v_dispatch
  from public.cold_campaign_dispatch_outbox
  where reservation_id=p_reservation_id
  for update;
  if not found then
    return public.authorize_graph_draft_send_pre_conditional_20260819(
      p_reservation_id,p_send_capability_hash,p_stop_snapshot_hash,
      p_observed_change_key_hash
    );
  end if;
  select * into v_execution
  from public.campaign_executions
  where id=v_dispatch.campaign_execution_id
  for update;
  select * into v_child
  from public.campaign_contacts
  where id=v_execution.campaign_contact_id
  for update;
  if not found or not v_child.conditional_delivery then
    return public.authorize_graph_draft_send_pre_conditional_20260819(
      p_reservation_id,p_send_capability_hash,p_stop_snapshot_hash,
      p_observed_change_key_hash
    );
  end if;
  select * into v_parent
  from public.campaign_contacts
  where campaign_id=v_child.campaign_id
    and external_contact_id=v_child.parent_external_contact_id
  for update;
  v_now:=pg_catalog.clock_timestamp();
  v_invalid:=not found or v_parent.id=v_child.id or
    v_parent.conditional_delivery or v_parent.variant<>v_child.variant;
  if v_invalid then
    v_evidence:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.concat_ws(pg_catalog.chr(31),'conditional-authorize-invalid-v1',
        v_child.id::text,p_reservation_id::text),
      'UTF8'),'sha256'),'hex');
    update public.outbound_delivery_control
    set cold_enabled=false,halt_reason='CONDITIONAL_GRAPH_INVALID',updated_at=v_now
    where singleton;
    insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash)
    values('CONDITIONAL_GRAPH_INVALID',v_dispatch.id,v_evidence);
    return pg_catalog.jsonb_build_object(
      'authorized',false,'duplicate',false,
      'reason_code','draft_neutralization_required',
      'conditional_reason_code','conditional_graph_invalid',
      'reservation_id',p_reservation_id,'mailbox_halted',true,
      'retry_after_seconds',0
    );
  end if;

  v_parent_stopped:=v_parent.sequence_status='stopped' or
    v_parent.cold_sequence_status='stopped' or
    v_parent.marketing_lane<>'cold' or v_parent.suppression_scope<>'none' or
    v_parent.reply_received_at is not null or
    v_parent.meeting_booked_at is not null or
    v_parent.meeting_completed_at is not null or
    v_parent.opportunity_created_at is not null or exists(
      select 1 from public.campaign_suppressions s
      where s.identity_hash=v_parent.email_hash
    ) or exists(
      select 1 from public.campaign_events e
      where e.campaign_contact_id=v_parent.id and e.event_name in (
        'reply_received','positive_reply','unsubscribe','opposition',
        'bounce_hard','meeting_booked','meeting_completed','opportunity_created'
      )
    );
  if not v_parent_stopped then
    return public.authorize_graph_draft_send_pre_conditional_20260819(
      p_reservation_id,p_send_capability_hash,p_stop_snapshot_hash,
      p_observed_change_key_hash
    );
  end if;

  update public.campaign_contacts
  set cold_sequence_status='stopped',marketing_lane='none',
      sequence_status='stopped',next_delivery_status='stopped',
      next_scheduled_at=null,locked_at=null,lock_token=null,lock_expires_at=null,
      stopped_at=coalesce(stopped_at,v_now),
      stopped_reason=coalesce(stopped_reason,'conditional_parent_stopped')
  where id=v_child.id;
  update public.campaign_executions
  set status='stopped',stopped_at=coalesce(stopped_at,v_now),
      stop_reason=coalesce(stop_reason,'conditional_parent_stopped')
  where campaign_id=v_child.campaign_id and campaign_contact_id=v_child.id
    and status='planned' and id<>v_execution.id;
  return pg_catalog.jsonb_build_object(
    'authorized',false,'duplicate',false,
    'reason_code','draft_neutralization_required',
    'conditional_reason_code','conditional_parent_stopped',
    'reservation_id',p_reservation_id,'mailbox_halted',false,
    'retry_after_seconds',0
  );
end;
$$;

revoke execute on function
  public.claim_cold_campaign_dispatch_pre_conditional_20260819(uuid,text,integer),
  public.claim_cold_campaign_dispatch(uuid,text,integer),
  public.authorize_graph_draft_send_pre_conditional_20260819(uuid,text,text,text),
  public.authorize_graph_draft_send(uuid,text,text,text)
from public,anon,authenticated,service_role;

grant execute on function public.claim_cold_campaign_dispatch(uuid,text,integer)
to service_role;
grant execute on function public.authorize_graph_draft_send(uuid,text,text,text)
to service_role;

update public.outbound_delivery_control
set master_enabled=false,transactional_enabled=false,cold_enabled=false,
    halt_reason='CONDITIONAL_DELIVERY_HARDENED',
    updated_at=pg_catalog.clock_timestamp()
where singleton;

commit;

-- 20260821123000_dashboard_campaign_insights.sql
-- PII-free campaign analysis for Data Brain. Read-only and service-role gated.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create or replace function public.dashboard_get_campaign_insights(
  p_actor_hash text, p_request_id text,
  p_from timestamptz, p_to timestamptz, p_campaign_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if p_request_id is null or
     p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$' or
     p_from is null or p_to is null or p_from >= p_to or
     p_to > v_now + interval '5 minutes' or
     p_to - p_from > interval '366 days' then
    raise exception using errcode = '22023', message = 'dashboard_invalid_window';
  end if;

  v_role := public.dashboard_require_role(
    p_actor_hash, array['admin', 'operator', 'auditor', 'read_only']
  );

  insert into public.dashboard_audit_log(
    request_id, actor_hash, actor_role, action, scope
  ) values (
    p_request_id, p_actor_hash, v_role, 'summary_read',
    jsonb_build_object('from', p_from, 'to', p_to, 'campaign_insights', true,
      'campaign_scoped', p_campaign_id is not null)
  ) on conflict (request_id, action) do nothing;

  with
  contact_base as materialized (
    select id, variant, magnet, reply_type, resource_started_at,
      resource_completed_at, meeting_booked_at, meeting_completed_at,
      opportunity_created_at, suppression_scope
    from public.campaign_contacts
    where created_at >= p_from and created_at < p_to
      and (p_campaign_id is null or campaign_id = p_campaign_id)
  ),
  execution_base as materialized (
    select id, campaign_contact_id, step, status, actual_at
    from public.campaign_executions
    where created_at >= p_from and created_at < p_to
      and channel = 'email'
      and (p_campaign_id is null or campaign_id = p_campaign_id)
  ),
  event_base as materialized (
    select ce.event_name, ce.occurred_at, ce.execution_id,
      ce.campaign_contact_id, ex.step
    from public.campaign_events ce
    left join public.campaign_executions ex on ex.id = ce.execution_id
    where ce.occurred_at >= p_from and ce.occurred_at < p_to
      and (p_campaign_id is null or ce.campaign_id = p_campaign_id)
  ),
  step_metrics as (
    select step,
      count(*) filter (where status = 'planned') planned,
      count(*) filter (where status = 'executed') sent,
      count(*) filter (where status = 'failed') failed
    from execution_base where step between 1 and 5 group by step
  ),
  event_step_metrics as (
    select step,
      count(*) filter (where event_name = 'email_opened') opened_directional,
      count(*) filter (where event_name = 'link_clicked') clicked,
      count(*) filter (where event_name in ('reply_received', 'positive_reply')) replied
    from event_base where step between 1 and 5 group by step
  )
  select jsonb_build_object(
    'by_variant', coalesce((select jsonb_object_agg(k, n) from (
      select coalesce(variant, 'unknown') k, count(*) n from contact_base group by 1
    ) grouped), '{}'::jsonb),
    'performance_by_email', coalesce((select jsonb_object_agg(metric, amount) from (
      select 'email_' || step || '_planned' metric, planned amount from step_metrics
      union all select 'email_' || step || '_sent', sent from step_metrics
      union all select 'email_' || step || '_failed', failed from step_metrics
      union all select 'email_' || step || '_opened_directional', opened_directional from event_step_metrics
      union all select 'email_' || step || '_clicked', clicked from event_step_metrics
      union all select 'email_' || step || '_replied', replied from event_step_metrics
    ) metrics), '{}'::jsonb),
    'events_by_hour', coalesce((select jsonb_object_agg(k, n) from (
      select lpad(extract(hour from timezone('Europe/Madrid', occurred_at))::integer::text, 2, '0') || ':00' k,
        count(*) n from event_base group by 1 order by 1
    ) grouped), '{}'::jsonb),
    'engagement_by_action', coalesce((select jsonb_object_agg(k, n) from (
      select event_name k, count(*) n from event_base
      where event_name in ('landing_visit','link_clicked','resource_started','resource_completed',
        'tool_started','tool_completed','checklist_downloaded','pdf_downloaded',
        'calculator_completed','webinar_registered','review_submitted')
      group by event_name
    ) grouped), '{}'::jsonb),
    'conversions', jsonb_build_object(
      'resource_started', (select count(*) from contact_base where resource_started_at is not null),
      'resource_completed', (select count(*) from contact_base where resource_completed_at is not null),
      'human_replies', (select count(*) from contact_base where reply_type is not null),
      'meetings_booked', (select count(*) from contact_base where meeting_booked_at is not null),
      'meetings_completed', (select count(*) from contact_base where meeting_completed_at is not null),
      'opportunities', (select count(*) from contact_base where opportunity_created_at is not null),
      'suppressed', (select count(*) from contact_base where suppression_scope <> 'none')
    ),
    'metric_contract', jsonb_build_object(
      'timezone', 'Europe/Madrid', 'opens_quality', 'directional',
      'confirmed_actions', jsonb_build_array('click','download','reply','meeting','opportunity'),
      'pii_included', false
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.dashboard_get_campaign_insights(
  text, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.dashboard_get_campaign_insights(
  text, text, timestamptz, timestamptz, uuid
) to service_role;

commit;

-- 20260821105809_data_brain_intelligence_v2.sql
-- Data Brain Intelligence v2: attributed analytics and internal revenue pipeline.
-- Additive, PII-free at RPC boundaries and unable to enable outbound delivery.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.dashboard_audit_log
  drop constraint if exists dashboard_audit_log_action_check;
alter table public.dashboard_audit_log
  add constraint dashboard_audit_log_action_check check (action in (
    'summary_read', 'sample_read', 'audit_read', 'export_requested',
    'intelligence_read', 'pipeline_write'
  ));

create schema if not exists fundae_private;

create table fundae_private.campaign_revenue_pipeline (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  campaign_contact_id uuid not null references public.campaign_contacts(id) on delete cascade,
  contact_ref text not null check (contact_ref ~ '^[a-f0-9]{64}$'),
  stage text not null check (stage in (
    'interested', 'qualified', 'meeting', 'opportunity', 'won', 'lost'
  )),
  estimated_amount numeric(14,2) not null default 0 check (estimated_amount >= 0),
  closed_amount numeric(14,2) check (closed_amount is null or closed_amount >= 0),
  probability_percent numeric(5,2) not null default 0
    check (probability_percent between 0 and 100),
  expected_close_on date,
  outcome_reason text check (
    outcome_reason is null or outcome_reason ~ '^[A-Za-z0-9_.:-]{2,64}$'
  ),
  source_execution_id uuid references public.campaign_executions(id) on delete set null,
  source_email_step integer check (source_email_step is null or source_email_step between 1 and 5),
  source_copy_key text check (
    source_copy_key is null or source_copy_key ~ '^[A-Za-z0-9_.:-]{2,64}$'
  ),
  source_variant text check (
    source_variant is null or source_variant ~ '^[A-Za-z0-9_.:-]{1,64}$'
  ),
  source_lot text check (
    source_lot is null or source_lot ~ '^[A-Za-z0-9_.:-]{1,64}$'
  ),
  source_hour smallint check (source_hour is null or source_hour between 0 and 23),
  source_tool text check (
    source_tool is null or source_tool ~ '^[A-Za-z0-9_.:-]{1,64}$'
  ),
  stage_changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  closed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_by_hash text not null check (created_by_hash ~ '^[a-f0-9]{64}$'),
  updated_by_hash text not null check (updated_by_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint campaign_revenue_pipeline_contact_key unique (campaign_id, campaign_contact_id),
  constraint campaign_revenue_pipeline_contact_ref_key unique (campaign_id, contact_ref),
  constraint campaign_revenue_pipeline_closed_state check (
    (stage in ('won', 'lost') and closed_at is not null) or
    (stage not in ('won', 'lost') and closed_at is null)
  ),
  constraint campaign_revenue_pipeline_closed_amount check (
    stage = 'won' or closed_amount is null
  )
);

create index campaign_revenue_pipeline_stage_idx
  on fundae_private.campaign_revenue_pipeline (campaign_id, stage, updated_at desc);
create index campaign_revenue_pipeline_expected_close_idx
  on fundae_private.campaign_revenue_pipeline (campaign_id, expected_close_on)
  where expected_close_on is not null and stage not in ('won', 'lost');
create index campaign_revenue_pipeline_source_execution_idx
  on fundae_private.campaign_revenue_pipeline (source_execution_id)
  where source_execution_id is not null;

alter table fundae_private.campaign_revenue_pipeline enable row level security;
alter table fundae_private.campaign_revenue_pipeline force row level security;
revoke all privileges on table fundae_private.campaign_revenue_pipeline
  from public, anon, authenticated, service_role;

create or replace function public.dashboard_upsert_revenue_pipeline(
  p_actor_hash text, p_request_id text, p_campaign_id uuid,
  p_campaign_contact_id uuid, p_stage text, p_estimated_amount numeric,
  p_closed_amount numeric, p_probability_percent numeric,
  p_expected_close_on date, p_outcome_reason text,
  p_source_execution_id uuid, p_source_tool text, p_expected_version bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_contact_ref text;
  v_contact_variant text;
  v_contact_lot text;
  v_source_step integer;
  v_source_hour smallint;
  v_source_copy_key text;
  v_existing fundae_private.campaign_revenue_pipeline%rowtype;
  v_result fundae_private.campaign_revenue_pipeline%rowtype;
  v_old_rank integer;
  v_new_rank integer;
begin
  if p_request_id is null or
     p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$' or
     p_campaign_id is null or p_campaign_contact_id is null or
     p_stage not in ('interested', 'qualified', 'meeting', 'opportunity', 'won', 'lost') or
     p_expected_version is null or p_expected_version < 0 or
     (p_estimated_amount is not null and p_estimated_amount < 0) or
     (p_closed_amount is not null and p_closed_amount < 0) or
     (p_probability_percent is not null and
       (p_probability_percent < 0 or p_probability_percent > 100)) or
     (p_outcome_reason is not null and
       p_outcome_reason !~ '^[A-Za-z0-9_.:-]{2,64}$') or
     (p_source_tool is not null and
       p_source_tool !~ '^[A-Za-z0-9_.:-]{1,64}$') or
     (p_stage = 'lost' and p_outcome_reason is null) or
     (p_stage <> 'won' and p_closed_amount is not null) then
    raise exception using errcode = '22023', message = 'dashboard_invalid_pipeline_write';
  end if;

  v_role := public.dashboard_require_role(p_actor_hash, array['admin', 'operator']);

  select
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'data-brain-contact-ref-v1:' || cc.campaign_id::text || ':' || cc.id::text,
      'UTF8'
    ), 'sha256'), 'hex'),
    cc.variant, cc.lot
  into v_contact_ref, v_contact_variant, v_contact_lot
  from public.campaign_contacts cc
  where cc.id = p_campaign_contact_id and cc.campaign_id = p_campaign_id;

  if not found then
    raise exception using errcode = '22023', message = 'dashboard_unknown_campaign_contact';
  end if;

  if p_source_execution_id is not null then
    select ce.step,
      extract(hour from pg_catalog.timezone(
        'Europe/Madrid', coalesce(ce.actual_at, ce.scheduled_for, ce.created_at)
      ))::smallint,
      'email_' || ce.step::text || ':' || v_contact_variant
    into v_source_step, v_source_hour, v_source_copy_key
    from public.campaign_executions ce
    where ce.id = p_source_execution_id and ce.campaign_id = p_campaign_id
      and ce.campaign_contact_id = p_campaign_contact_id and ce.channel = 'email';
    if not found then
      raise exception using errcode = '22023', message = 'dashboard_invalid_pipeline_source';
    end if;
  end if;

  select * into v_existing
  from fundae_private.campaign_revenue_pipeline rp
  where rp.campaign_id = p_campaign_id
    and rp.campaign_contact_id = p_campaign_contact_id
  for update;

  if not found then
    if p_expected_version <> 0 then
      raise exception using errcode = '40001', message = 'dashboard_pipeline_version_conflict';
    end if;
    insert into fundae_private.campaign_revenue_pipeline (
      campaign_id, campaign_contact_id, contact_ref, stage,
      estimated_amount, closed_amount, probability_percent, expected_close_on,
      outcome_reason, source_execution_id, source_email_step, source_copy_key,
      source_variant, source_lot, source_hour, source_tool,
      closed_at, created_by_hash, updated_by_hash
    ) values (
      p_campaign_id, p_campaign_contact_id, v_contact_ref, p_stage,
      coalesce(p_estimated_amount, 0), p_closed_amount,
      coalesce(p_probability_percent, case p_stage
        when 'interested' then 10 when 'qualified' then 25 when 'meeting' then 45
        when 'opportunity' then 70 when 'won' then 100 else 0 end),
      p_expected_close_on, p_outcome_reason, p_source_execution_id,
      v_source_step, v_source_copy_key, v_contact_variant, v_contact_lot,
      v_source_hour, p_source_tool,
      case when p_stage in ('won', 'lost') then v_now end,
      p_actor_hash, p_actor_hash
    ) returning * into v_result;
  else
    if v_existing.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'dashboard_pipeline_version_conflict';
    end if;
    if v_existing.stage in ('won', 'lost') and p_stage <> v_existing.stage then
      raise exception using errcode = '22023', message = 'dashboard_pipeline_terminal_state';
    end if;
    v_old_rank := case v_existing.stage
      when 'interested' then 1 when 'qualified' then 2 when 'meeting' then 3
      when 'opportunity' then 4 else 5 end;
    v_new_rank := case p_stage
      when 'interested' then 1 when 'qualified' then 2 when 'meeting' then 3
      when 'opportunity' then 4 else 5 end;
    if v_new_rank < v_old_rank then
      raise exception using errcode = '22023', message = 'dashboard_pipeline_stage_regression';
    end if;
    if p_stage = 'won' and v_existing.stage not in ('opportunity', 'won') then
      raise exception using errcode = '22023', message = 'dashboard_pipeline_invalid_win';
    end if;

    update fundae_private.campaign_revenue_pipeline rp set
      stage = p_stage,
      estimated_amount = coalesce(p_estimated_amount, rp.estimated_amount),
      closed_amount = case when p_stage = 'won'
        then coalesce(p_closed_amount, rp.closed_amount, p_estimated_amount, rp.estimated_amount)
        else null end,
      probability_percent = coalesce(p_probability_percent, case p_stage
        when 'interested' then 10 when 'qualified' then 25 when 'meeting' then 45
        when 'opportunity' then 70 when 'won' then 100 else 0 end),
      expected_close_on = coalesce(p_expected_close_on, rp.expected_close_on),
      outcome_reason = coalesce(p_outcome_reason, rp.outcome_reason),
      source_execution_id = coalesce(p_source_execution_id, rp.source_execution_id),
      source_email_step = coalesce(v_source_step, rp.source_email_step),
      source_copy_key = coalesce(v_source_copy_key, rp.source_copy_key),
      source_variant = coalesce(v_contact_variant, rp.source_variant),
      source_lot = coalesce(v_contact_lot, rp.source_lot),
      source_hour = coalesce(v_source_hour, rp.source_hour),
      source_tool = coalesce(p_source_tool, rp.source_tool),
      stage_changed_at = case when p_stage <> rp.stage then v_now else rp.stage_changed_at end,
      closed_at = case when p_stage in ('won', 'lost') then coalesce(rp.closed_at, v_now) end,
      version = rp.version + 1, updated_by_hash = p_actor_hash, updated_at = v_now
    where rp.id = v_existing.id returning * into v_result;
  end if;

  insert into public.dashboard_audit_log(
    request_id, actor_hash, actor_role, action, scope
  ) values (
    p_request_id, p_actor_hash, v_role, 'pipeline_write',
    pg_catalog.jsonb_build_object(
      'campaign_scoped', true, 'stage', p_stage,
      'new_version', v_result.version, 'source_email_step', v_result.source_email_step
    )
  ) on conflict (request_id, action) do nothing;

  return pg_catalog.jsonb_build_object(
    'contact_ref', v_result.contact_ref, 'stage', v_result.stage,
    'estimated_amount', v_result.estimated_amount, 'closed_amount', v_result.closed_amount,
    'probability_percent', v_result.probability_percent,
    'expected_close_on', v_result.expected_close_on,
    'source_email_step', v_result.source_email_step,
    'source_copy_key', v_result.source_copy_key,
    'source_variant', v_result.source_variant, 'source_lot', v_result.source_lot,
    'source_hour', v_result.source_hour, 'source_tool', v_result.source_tool,
    'version', v_result.version, 'updated_at', v_result.updated_at,
    'pii_included', false
  );
end;
$$;

create or replace function public.dashboard_get_intelligence_v2(
  p_actor_hash text, p_request_id text, p_from timestamptz, p_to timestamptz,
  p_campaign_id uuid, p_filters jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_email_step integer;
  v_hour integer;
  v_variant text;
  v_lot text;
  v_company_size text;
  v_tool text;
  v_copy_key text;
  v_result jsonb;
begin
  if p_request_id is null or
     p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$' or
     p_from is null or p_to is null or p_from >= p_to or
     p_to > v_now + interval '5 minutes' or p_to - p_from > interval '366 days' or
     pg_catalog.jsonb_typeof(v_filters) <> 'object' or
     exists (
       select 1 from pg_catalog.jsonb_object_keys(v_filters) filter_key
       where filter_key not in (
         'email_step', 'variant', 'lot', 'hour', 'company_size', 'tool', 'copy_key'
       )
     ) then
    raise exception using errcode = '22023', message = 'dashboard_invalid_intelligence_request';
  end if;

  if v_filters ? 'email_step' then
    if v_filters ->> 'email_step' !~ '^[1-5]$' then
      raise exception using errcode = '22023', message = 'dashboard_invalid_email_step';
    end if;
    v_email_step := (v_filters ->> 'email_step')::integer;
  end if;
  if v_filters ? 'hour' then
    if v_filters ->> 'hour' !~ '^([0-9]|1[0-9]|2[0-3])$' then
      raise exception using errcode = '22023', message = 'dashboard_invalid_hour';
    end if;
    v_hour := (v_filters ->> 'hour')::integer;
  end if;

  v_variant := nullif(v_filters ->> 'variant', '');
  v_lot := nullif(v_filters ->> 'lot', '');
  v_company_size := nullif(v_filters ->> 'company_size', '');
  v_tool := nullif(v_filters ->> 'tool', '');
  v_copy_key := nullif(v_filters ->> 'copy_key', '');

  if exists (
    select 1 from (values
      (v_variant), (v_lot), (v_company_size), (v_tool), (v_copy_key)
    ) supplied(value)
    where value is not null and value !~ '^[A-Za-z0-9_.:-]{1,64}$'
  ) then
    raise exception using errcode = '22023', message = 'dashboard_invalid_filter_value';
  end if;

  v_role := public.dashboard_require_role(
    p_actor_hash, array['admin', 'operator', 'auditor', 'read_only']
  );

  insert into public.dashboard_audit_log(
    request_id, actor_hash, actor_role, action, scope
  ) values (
    p_request_id, p_actor_hash, v_role, 'intelligence_read',
    pg_catalog.jsonb_build_object(
      'from', p_from, 'to', p_to, 'campaign_scoped', p_campaign_id is not null,
      'filters_applied', (select coalesce(pg_catalog.jsonb_agg(key), '[]'::jsonb)
        from pg_catalog.jsonb_object_keys(v_filters) key)
    )
  ) on conflict (request_id, action) do nothing;

  with
  execution_base as materialized (
    select
      ex.id, ex.campaign_id, ex.campaign_contact_id, ex.step, ex.status,
      ex.scheduled_for, ex.actual_at, ex.failed_at,
      c.external_id campaign_external_id,
      cc.variant, cc.magnet, cc.lot, cc.company_size,
      'email_' || ex.step::text || ':' || cc.variant as copy_key,
      extract(hour from pg_catalog.timezone(
        'Europe/Madrid', coalesce(ex.actual_at, ex.scheduled_for, ex.created_at)
      ))::integer as madrid_hour
    from public.campaign_executions ex
    join public.campaign_contacts cc on cc.id = ex.campaign_contact_id
    join public.campaigns c on c.id = ex.campaign_id
    where ex.channel = 'email'
      and coalesce(ex.actual_at, ex.scheduled_for, ex.created_at) >= p_from
      and coalesce(ex.actual_at, ex.scheduled_for, ex.created_at) < p_to
      and (p_campaign_id is null or ex.campaign_id = p_campaign_id)
      and (v_email_step is null or ex.step = v_email_step)
      and (v_variant is null or cc.variant = v_variant)
      and (v_lot is null or cc.lot = v_lot)
      and (v_company_size is null or cc.company_size = v_company_size)
      and (v_hour is null or extract(hour from pg_catalog.timezone(
        'Europe/Madrid', coalesce(ex.actual_at, ex.scheduled_for, ex.created_at)
      ))::integer = v_hour)
      and (v_copy_key is null or
        'email_' || ex.step::text || ':' || cc.variant = v_copy_key)
  ),
  campaign_event_base as materialized (
    select ce.execution_id, ce.campaign_contact_id, ce.event_name,
      ce.metric_quality, ce.occurred_at
    from public.campaign_events ce
    join public.campaign_contacts cc on cc.id = ce.campaign_contact_id
    left join public.campaign_executions ex on ex.id = ce.execution_id
    where ce.occurred_at >= p_from and ce.occurred_at < p_to
      and (p_campaign_id is null or ce.campaign_id = p_campaign_id)
      and (v_email_step is null or ex.step = v_email_step)
      and (v_variant is null or cc.variant = v_variant)
      and (v_lot is null or cc.lot = v_lot)
      and (v_company_size is null or cc.company_size = v_company_size)
  ),
  event_by_execution as (
    select eb.id,
      count(*) filter (where ce.event_name = 'delivery_delivered') delivered_events,
      count(*) filter (where ce.event_name in ('delivery_failed', 'bounce_hard')) bounce_events,
      count(*) filter (where ce.event_name = 'email_opened') opened_directional_events,
      count(*) filter (where ce.event_name = 'link_clicked') click_events,
      count(*) filter (where ce.event_name = 'reply_received') reply_events,
      count(*) filter (where ce.event_name = 'positive_reply') positive_reply_events,
      count(*) filter (where ce.event_name = 'meeting_booked') meeting_events,
      count(*) filter (where ce.event_name = 'opportunity_created') opportunity_events,
      min(extract(epoch from (ce.occurred_at - coalesce(
        eb.actual_at, eb.scheduled_for
      ))) / 3600) filter (where ce.event_name = 'link_clicked') hours_to_first_click,
      min(extract(epoch from (ce.occurred_at - coalesce(
        eb.actual_at, eb.scheduled_for
      ))) / 3600) filter (where ce.event_name = 'reply_received') hours_to_first_reply,
      min(extract(epoch from (ce.occurred_at - coalesce(
        eb.actual_at, eb.scheduled_for
      ))) / 3600) filter (where ce.event_name = 'meeting_booked') hours_to_first_meeting
    from execution_base eb
    left join campaign_event_base ce on ce.execution_id = eb.id
    group by eb.id
  ),
  execution_enriched as materialized (
    select eb.*,
      coalesce(ev.delivered_events, 0) delivered_events,
      coalesce(ev.bounce_events, 0) bounce_events,
      coalesce(ev.opened_directional_events, 0) opened_directional_events,
      coalesce(ev.click_events, 0) click_events,
      coalesce(ev.reply_events, 0) reply_events,
      coalesce(ev.positive_reply_events, 0) positive_reply_events,
      coalesce(ev.meeting_events, 0) meeting_events,
      coalesce(ev.opportunity_events, 0) opportunity_events,
      ev.hours_to_first_click, ev.hours_to_first_reply, ev.hours_to_first_meeting
    from execution_base eb join event_by_execution ev on ev.id = eb.id
  ),
  email_rollup as (
    select step,
      count(*) planned,
      count(*) filter (where status = 'executed') sent,
      count(*) filter (where status = 'failed') failed,
      count(*) filter (where delivered_events > 0) delivered,
      count(*) filter (where bounce_events > 0) bounced,
      count(*) filter (where opened_directional_events > 0) opened_directional,
      count(*) filter (where click_events > 0) clicked,
      count(*) filter (where reply_events > 0) replied,
      count(*) filter (where positive_reply_events > 0) positive_replies,
      count(*) filter (where meeting_events > 0) meetings,
      count(*) filter (where opportunity_events > 0) opportunities,
      round(avg(hours_to_first_click)::numeric, 2) avg_hours_to_first_click,
      round(avg(hours_to_first_reply)::numeric, 2) avg_hours_to_first_reply,
      round(avg(hours_to_first_meeting)::numeric, 2) avg_hours_to_first_meeting
    from execution_enriched where step between 1 and 5 group by step
  ),
  contact_performance as (
    select campaign_contact_id, variant, lot, company_size,
      bool_or(status = 'executed') sent,
      bool_or(delivered_events > 0) delivered,
      bool_or(click_events > 0) clicked,
      bool_or(reply_events > 0) replied,
      bool_or(positive_reply_events > 0) positive_reply,
      bool_or(meeting_events > 0) meeting,
      bool_or(opportunity_events > 0) opportunity
    from execution_enriched
    group by campaign_contact_id, variant, lot, company_size
  ),
  variant_rollup as (
    select variant,
      count(*) filter (where sent) sent_contacts,
      count(*) filter (where clicked) clicked_contacts,
      count(*) filter (where positive_reply or meeting or opportunity) qualified_contacts
    from contact_performance group by variant
  ),
  variant_stats as (
    select variant, sent_contacts, clicked_contacts, qualified_contacts,
      qualified_contacts::numeric / nullif(sent_contacts, 0) conversion_ratio
    from variant_rollup
  ),
  copy_rollup as (
    select copy_key,
      count(*) filter (where status = 'executed') sent,
      count(*) filter (where click_events > 0) clicked,
      count(*) filter (where reply_events > 0) replied,
      count(*) filter (where positive_reply_events > 0) positive_replies,
      count(*) filter (where meeting_events > 0) meetings,
      count(*) filter (where opportunity_events > 0) opportunities
    from execution_enriched group by copy_key
  ),
  campaign_rollup as (
    select campaign_external_id,
      count(distinct campaign_contact_id) contacts,
      count(*) filter (where status = 'executed') sent,
      count(*) filter (where click_events > 0) clicked,
      count(*) filter (where reply_events > 0) replied,
      count(*) filter (where meeting_events > 0) meetings,
      count(*) filter (where opportunity_events > 0) opportunities
    from execution_enriched group by campaign_external_id
  ),
  hour_rollup as (
    select madrid_hour,
      count(*) filter (where status = 'executed') sent,
      count(*) filter (where click_events > 0) clicked,
      count(*) filter (where reply_events > 0) replied,
      count(*) filter (where positive_reply_events > 0 or meeting_events > 0 or
        opportunity_events > 0) qualified
    from execution_enriched group by madrid_hour
  ),
  lot_rollup as (
    select lot, count(*) filter (where sent) sent_contacts,
      count(*) filter (where clicked) clicked_contacts,
      count(*) filter (where positive_reply or meeting or opportunity) qualified_contacts
    from contact_performance group by lot
  ),
  company_size_rollup as (
    select coalesce(company_size, 'unclassified') company_size,
      count(*) filter (where sent) sent_contacts,
      count(*) filter (where clicked) clicked_contacts,
      count(*) filter (where positive_reply or meeting or opportunity) qualified_contacts
    from contact_performance group by coalesce(company_size, 'unclassified')
  ),
  landing_base as materialized (
    select e.id, e.event_name, e.session_id, e.lead_magnet, e.occurred_at,
      c.id campaign_id, cc.id campaign_contact_id,
      cc.variant, cc.lot, cc.company_size,
      case when lower(coalesce(e.context ->> 'host', e.context ->> 'hostname', ''))
        ~ '^[a-z0-9.-]{1,128}$'
        then lower(coalesce(e.context ->> 'host', e.context ->> 'hostname'))
        else 'unattributed' end domain_key,
      coalesce(nullif(e.context ->> 'utm_source', ''), 'direct') || ':' ||
        coalesce(nullif(e.context ->> 'utm_medium', ''), 'unattributed') source_key,
      case when coalesce(e.properties ->> 'link_id', e.properties ->> 'cta_id',
        e.properties ->> 'button_id', '') ~ '^[A-Za-z0-9_.:-]{1,64}$'
        then coalesce(e.properties ->> 'link_id', e.properties ->> 'cta_id',
          e.properties ->> 'button_id') else 'unattributed' end link_key,
      coalesce(nullif(e.properties ->> 'tool_id', ''),
        nullif(e.properties ->> 'resource', ''), nullif(e.lead_magnet, ''),
        case when e.event_name in (
          'session_start', 'session_ping', 'page_view', 'section_view',
          'scroll_milestone', 'cta_click', 'form_start', 'form_step'
        ) then 'site_general' else 'unattributed' end) tool_key,
      case when lower(coalesce(
        e.context ->> 'environment', e.properties ->> 'environment', 'production'
      )) in ('test', 'staging', 'preview', 'development', 'dev') or
        lower(coalesce(e.context ->> 'is_test', e.properties ->> 'is_test', 'false')) = 'true'
      then true else false end is_test,
      case when coalesce(e.properties ->> 'section_id', e.properties ->> 'section', '')
        ~ '^[A-Za-z0-9_.:-]{1,64}$'
        then coalesce(e.properties ->> 'section_id', e.properties ->> 'section')
        else 'unattributed' end section_key,
      case when e.properties ->> 'active_seconds' ~ '^[0-9]+(\.[0-9]+)?$'
        then (e.properties ->> 'active_seconds')::numeric else 0 end active_seconds,
      case when e.properties ->> 'depth_percent' ~ '^[0-9]+(\.[0-9]+)?$'
        then least((e.properties ->> 'depth_percent')::numeric, 100) else 0 end depth_percent
    from public.events e
    left join public.campaigns c on c.external_id = e.context ->> 'utm_campaign'
    left join public.campaign_contacts cc on cc.campaign_id = c.id
      and cc.external_contact_id = e.context ->> 'utm_content'
    where e.occurred_at >= p_from and e.occurred_at < p_to
      and (p_campaign_id is null or c.id = p_campaign_id)
      and (v_variant is null or cc.variant = v_variant)
      and (v_lot is null or cc.lot = v_lot)
      and (v_company_size is null or cc.company_size = v_company_size)
  ),
  landing_attributed as materialized (
    select lb.*, sent.step attributed_email_step,
      sent.copy_key attributed_copy_key, sent.madrid_hour attributed_hour
    from landing_base lb
    left join lateral (
      select eb.step, eb.copy_key, eb.madrid_hour
      from execution_base eb
      where eb.campaign_contact_id = lb.campaign_contact_id
        and eb.status = 'executed' and eb.actual_at <= lb.occurred_at
      order by eb.actual_at desc, eb.id desc limit 1
    ) sent on true
  ),
  landing_filtered as materialized (
    select * from landing_attributed
    where (v_email_step is null or attributed_email_step = v_email_step)
      and (v_hour is null or attributed_hour = v_hour)
      and (v_copy_key is null or attributed_copy_key = v_copy_key)
      and (v_tool is null or tool_key = v_tool)
  ),
  tool_rollup as (
    select tool_key, count(*) events, count(distinct session_id) sessions,
      count(*) filter (where event_name in (
        'tool_started', 'calculator_started', 'checklist_interactive_open', 'resource_started'
      )) started,
      count(*) filter (where event_name = 'form_step') steps,
      count(*) filter (where event_name in (
        'tool_completed', 'calculator_completed', 'calculator_result',
        'resource_completed', 'resource_download', 'pdf_downloaded', 'checklist_downloaded'
      )) completed,
      count(*) filter (where event_name in ('tool_abandoned', 'resource_abandoned')) abandoned,
      round(avg(active_seconds), 2) avg_active_seconds,
      round(avg(depth_percent), 2) avg_scroll_percent
    from landing_filtered group by tool_key
  ),
  abandonment_section_rollup as (
    select tool_key, section_key,
      count(*) filter (where event_name in ('tool_abandoned', 'resource_abandoned')) abandoned,
      count(distinct session_id) filter (
        where event_name in ('tool_abandoned', 'resource_abandoned')
      ) sessions
    from landing_filtered
    where section_key <> 'unattributed'
    group by tool_key, section_key
  ),
  campaign_contact_signal_rollup as (
    select campaign_contact_id, max(occurred_at) last_signal_at,
      bool_or(event_name = 'link_clicked') clicked,
      bool_or(event_name = 'positive_reply') positive_reply,
      bool_or(event_name = 'meeting_booked') meeting,
      bool_or(event_name = 'opportunity_created') opportunity
    from campaign_event_base
    where campaign_contact_id is not null
    group by campaign_contact_id
  ),
  high_intent_candidates as (
    select distinct campaign_contact_id
    from landing_filtered
    where campaign_contact_id is not null and not is_test and event_name in (
      'cta_click', 'tool_started', 'resource_started', 'resource_download',
      'tool_completed', 'calculator_completed', 'calculator_result'
    )
    union
    select campaign_contact_id from campaign_contact_signal_rollup
    where clicked or positive_reply or meeting or opportunity
  ),
  high_intent_contacts as (
    select hc.campaign_contact_id,
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'data-brain-high-intent-v1:' || hc.campaign_contact_id::text, 'UTF8'
      ), 'sha256'), 'hex') contact_ref,
      greatest(max(lf.occurred_at), cs.last_signal_at) last_activity_at,
      max(lf.tool_key) filter (where lf.tool_key <> 'unattributed') dominant_tool,
      count(*) filter (where lf.event_name in (
        'resource_download', 'pdf_downloaded', 'checklist_downloaded',
        'tool_completed', 'calculator_completed', 'calculator_result'
      )) + case when cs.clicked then 1 else 0 end +
        case when cs.positive_reply then 1 else 0 end +
        case when cs.meeting then 1 else 0 end +
        case when cs.opportunity then 1 else 0 end confirmed_signals,
      least(100, 10 * count(*) filter (where lf.event_name = 'cta_click') +
        20 * count(*) filter (where lf.event_name in ('tool_started', 'resource_started')) +
        35 * count(*) filter (where lf.event_name in (
          'resource_download', 'tool_completed', 'calculator_completed', 'calculator_result'
        )) + case when cs.clicked then 15 else 0 end +
        case when cs.positive_reply then 45 else 0 end +
        case when cs.meeting then 65 else 0 end +
        case when cs.opportunity then 85 else 0 end) intent_score
    from high_intent_candidates hc
    left join landing_filtered lf on lf.campaign_contact_id = hc.campaign_contact_id
      and not lf.is_test
    left join campaign_contact_signal_rollup cs
      on cs.campaign_contact_id = hc.campaign_contact_id
    group by hc.campaign_contact_id, cs.last_signal_at, cs.clicked,
      cs.positive_reply, cs.meeting, cs.opportunity
  ),
  session_rollup as (
    select session_id, max(active_seconds) active_seconds,
      max(depth_percent) max_scroll_percent,
      bool_or(event_name in ('tool_started', 'calculator_started', 'resource_started')) started,
      bool_or(event_name in (
        'tool_completed', 'calculator_completed', 'resource_completed', 'resource_download'
      )) completed
    from landing_filtered where session_id is not null group by session_id
  ),
  source_rollup as (
    select domain_key, source_key, count(*) events,
      count(distinct session_id) sessions,
      count(*) filter (where event_name in (
        'resource_download', 'pdf_downloaded', 'checklist_downloaded',
        'meeting_booked', 'opportunity_created'
      )) conversions
    from landing_filtered group by domain_key, source_key
  ),
  link_rollup as (
    select link_key, count(*) clicks, count(distinct session_id) sessions
    from landing_filtered
    where event_name = 'cta_click' and link_key <> 'unattributed'
    group by link_key
  ),
  pipeline_base as materialized (
    select rp.campaign_id, rp.stage, rp.estimated_amount, rp.closed_amount, rp.probability_percent,
      rp.outcome_reason,
      rp.expected_close_on, rp.source_email_step, rp.source_copy_key,
      rp.source_variant, rp.source_lot, rp.source_hour, rp.source_tool,
      rp.created_at, rp.closed_at,
      coalesce(ex.actual_at, ex.scheduled_for) source_sent_at
    from fundae_private.campaign_revenue_pipeline rp
    join public.campaign_contacts cc on cc.id = rp.campaign_contact_id
    left join public.campaign_executions ex on ex.id = rp.source_execution_id
    where rp.created_at < p_to
      and (p_campaign_id is null or rp.campaign_id = p_campaign_id)
      and (v_email_step is null or rp.source_email_step = v_email_step)
      and (v_variant is null or rp.source_variant = v_variant)
      and (v_lot is null or rp.source_lot = v_lot)
      and (v_company_size is null or cc.company_size = v_company_size)
      and (v_hour is null or rp.source_hour = v_hour)
      and (v_tool is null or rp.source_tool = v_tool)
      and (v_copy_key is null or rp.source_copy_key = v_copy_key)
  ),
  pipeline_stage_rollup as (
    select stage, count(*) opportunities,
      coalesce(sum(estimated_amount), 0) estimated_amount,
      coalesce(sum(closed_amount), 0) closed_amount,
      coalesce(sum(estimated_amount * probability_percent / 100), 0) weighted_amount
    from pipeline_base group by stage
  ),
  pipeline_source_rollup as (
    select coalesce(
        source_copy_key,
        case when source_email_step is not null then
          'email_' || source_email_step::text || ':' ||
            coalesce(source_variant, 'unattributed') end,
        case when source_tool is not null then 'tool:' || source_tool end,
        'manual'
      ) source_key,
      count(*) records,
      coalesce(sum(estimated_amount), 0) estimated_amount,
      coalesce(sum(closed_amount), 0) closed_amount,
      coalesce(sum(estimated_amount * probability_percent / 100), 0) weighted_amount
    from pipeline_base
    group by coalesce(
      source_copy_key,
      case when source_email_step is not null then
        'email_' || source_email_step::text || ':' ||
          coalesce(source_variant, 'unattributed') end,
      case when source_tool is not null then 'tool:' || source_tool end,
      'manual'
    )
  ),
  pipeline_campaign_rollup as (
    select c.external_id campaign_external_id, count(*) records,
      coalesce(sum(pb.estimated_amount), 0) estimated_amount,
      coalesce(sum(pb.estimated_amount * pb.probability_percent / 100), 0) weighted_amount,
      coalesce(sum(pb.closed_amount) filter (where pb.stage = 'won'), 0) closed_amount
    from pipeline_base pb join public.campaigns c on c.id = pb.campaign_id
    group by c.external_id
  ),
  pipeline_outcome_reason_rollup as (
    select coalesce(
        outcome_reason,
        case when stage = 'won' then 'won' else 'unspecified' end
      ) outcome_reason,
      count(*) outcomes,
      count(*) filter (where stage = 'won') won,
      count(*) filter (where stage = 'lost') lost,
      coalesce(sum(closed_amount), 0) closed_amount
    from pipeline_base
    where stage in ('won', 'lost')
    group by coalesce(
      outcome_reason,
      case when stage = 'won' then 'won' else 'unspecified' end
    )
  ),
  time_series_events as (
    select
      pg_catalog.timezone(
        'Europe/Madrid', coalesce(actual_at, scheduled_for)
      )::date activity_date,
      count(*) filter (where status = 'executed') sent,
      count(*) filter (where click_events > 0) clicked,
      count(*) filter (where reply_events > 0) replied,
      count(*) filter (where meeting_events > 0) meetings,
      count(*) filter (where opportunity_events > 0) opportunities,
      0::numeric closed_amount
    from execution_enriched
    group by pg_catalog.timezone(
      'Europe/Madrid', coalesce(actual_at, scheduled_for)
    )::date
    union all
    select
      pg_catalog.timezone('Europe/Madrid', closed_at)::date activity_date,
      0::bigint sent, 0::bigint clicked, 0::bigint replied,
      0::bigint meetings, 0::bigint opportunities,
      coalesce(sum(closed_amount), 0) closed_amount
    from pipeline_base
    where stage = 'won' and closed_at >= p_from and closed_at < p_to
      and (source_email_step is not null or source_copy_key is not null or
        source_tool is not null)
    group by pg_catalog.timezone('Europe/Madrid', closed_at)::date
  ),
  time_series_rollup as (
    select activity_date, sum(sent) sent, sum(clicked) clicked,
      sum(replied) replied, sum(meetings) meetings,
      sum(opportunities) opportunities, sum(closed_amount) closed_amount
    from time_series_events
    where activity_date is not null
    group by activity_date
    having sum(sent) + sum(clicked) + sum(replied) + sum(meetings) +
      sum(opportunities) > 0 or sum(closed_amount) > 0
  ),
  quality as (
    select (select count(*) from landing_filtered) landing_events,
      (select count(*) from landing_filtered where campaign_id is not null) campaign_attributed,
      (select count(*) from landing_filtered where campaign_contact_id is not null) contact_attributed,
      (select count(*) from landing_filtered where attributed_email_step is not null) email_attributed,
      (select count(*) from landing_filtered where is_test) test_events,
      (select count(*) from landing_filtered where not is_test) production_events,
      (select count(*) from landing_filtered where session_id is null) incomplete_sessions,
      (select count(*) from landing_filtered where tool_key = 'unattributed') unattributed_tool_events,
      (select count(*) from campaign_event_base where execution_id is null)
        campaign_events_without_execution,
      (select coalesce(sum(duplicates), 0) from (
        select count(*) - 1 duplicates
        from public.campaign_events ce
        where ce.occurred_at >= p_from and ce.occurred_at < p_to
          and ce.source_event_id is not null
          and (p_campaign_id is null or ce.campaign_id = p_campaign_id)
        group by ce.campaign_id, ce.source_event_id having count(*) > 1
      ) duplicate_keys) duplicate_campaign_event_keys
  ),
  recommendation_rows as (
    select recommendation from (
      select case when q.landing_events > 0 and
        q.email_attributed::numeric / q.landing_events < 0.90
        then 'Improve email attribution coverage before comparing copies.' end recommendation
      from quality q
      union all
      select case when exists (
        select 1 from variant_rollup where sent_contacts between 1 and 29
      ) then 'Wait for at least 30 sent contacts per variant before declaring a winner.' end
      union all
      select case when exists (
        select 1 from email_rollup where sent > 0 and bounced::numeric / sent > 0.05
      ) then 'Review deliverability: bounce rate exceeds 5 percent.' end
      union all
      select case when exists (
        select 1 from tool_rollup where started >= 10 and
          completed::numeric / nullif(started, 0) < 0.50
      ) then 'Inspect the tool with more than 50 percent abandonment.' end
      union all
      select case when not exists (select 1 from pipeline_base)
        then 'Register internal opportunities and amounts to activate revenue attribution.' end
    ) candidates where recommendation is not null
  ),
  anomaly_rows as (
    select code, severity from (
      select case when q.landing_events > 0 and
        q.email_attributed::numeric / q.landing_events < 0.90
        then 'low_email_attribution' end code,
        'warning'::text severity from quality q
      union all
      select case when exists (
        select 1 from email_rollup where sent > 0 and bounced::numeric / sent > 0.05
      ) then 'high_bounce_rate' end, 'critical'
      union all
      select case when exists (
        select 1 from tool_rollup where started >= 10 and
          completed::numeric / nullif(started, 0) < 0.50
      ) then 'high_tool_abandonment' end, 'warning'
      union all
      select case when q.test_events > q.production_events and q.test_events > 0
        then 'test_data_dominates' end, 'warning' from quality q
    ) candidates where code is not null
  )
  select pg_catalog.jsonb_build_object(
    'meta', pg_catalog.jsonb_build_object(
      'role', v_role, 'generated_at', v_now, 'from', p_from, 'to', p_to,
      'campaign_id', p_campaign_id, 'filters', v_filters,
      'timezone', 'Europe/Madrid', 'pii_included', false
    ),
    'overview', pg_catalog.jsonb_build_object(
      'planned', (select count(*) from execution_enriched),
      'sent', (select count(*) from execution_enriched where status = 'executed'),
      'delivered', (select count(*) from execution_enriched where delivered_events > 0),
      'bounced', (select count(*) from execution_enriched where bounce_events > 0),
      'clicked', (select count(*) from execution_enriched where click_events > 0),
      'replied', (select count(*) from execution_enriched where reply_events > 0),
      'positive_replies', (select count(*) from execution_enriched where positive_reply_events > 0),
      'meetings', (select count(*) from execution_enriched where meeting_events > 0),
      'opportunities', (select count(*) from pipeline_base
        where stage in ('opportunity', 'won')),
      'won', (select count(*) from pipeline_base where stage = 'won'),
      'pipeline_estimated_amount', (select coalesce(sum(estimated_amount), 0) from pipeline_base),
      'pipeline_weighted_amount', (select coalesce(sum(
        estimated_amount * probability_percent / 100
      ), 0) from pipeline_base),
      'revenue_closed_amount', (select coalesce(sum(closed_amount), 0)
        from pipeline_base where stage = 'won')
    ),
    'funnel', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('stage', 'planned', 'count',
        (select count(*) from execution_enriched)),
      pg_catalog.jsonb_build_object('stage', 'sent', 'count',
        (select count(*) from execution_enriched where status = 'executed')),
      pg_catalog.jsonb_build_object('stage', 'delivered', 'count',
        (select count(*) from execution_enriched where delivered_events > 0)),
      pg_catalog.jsonb_build_object('stage', 'clicked', 'count',
        (select count(*) from execution_enriched where click_events > 0)),
      pg_catalog.jsonb_build_object('stage', 'replied', 'count',
        (select count(*) from execution_enriched where reply_events > 0)),
      pg_catalog.jsonb_build_object('stage', 'meeting', 'count',
        (select count(*) from pipeline_base where stage in ('meeting','opportunity','won'))),
      pg_catalog.jsonb_build_object('stage', 'opportunity', 'count',
        (select count(*) from pipeline_base where stage in ('opportunity','won'))),
      pg_catalog.jsonb_build_object('stage', 'won', 'count',
        (select count(*) from pipeline_base where stage = 'won'))
    ),
    'by_email', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'email_step', step, 'planned', planned, 'sent', sent, 'failed', failed,
        'delivered', delivered, 'bounced', bounced,
        'opened_directional', opened_directional, 'clicked', clicked,
        'replied', replied, 'positive_replies', positive_replies,
        'meetings', meetings, 'opportunities', opportunities,
        'delivery_rate', round(100 * delivered::numeric / nullif(sent, 0), 2),
        'bounce_rate', round(100 * bounced::numeric / nullif(sent, 0), 2),
        'click_rate', round(100 * clicked::numeric / nullif(delivered, 0), 2),
        'reply_rate', round(100 * replied::numeric / nullif(delivered, 0), 2),
        'positive_reply_rate', round(100 * positive_replies::numeric / nullif(delivered, 0), 2),
        'meeting_rate', round(100 * meetings::numeric / nullif(delivered, 0), 2),
        'avg_hours_to_first_click', avg_hours_to_first_click,
        'avg_hours_to_first_reply', avg_hours_to_first_reply,
        'avg_hours_to_first_meeting', avg_hours_to_first_meeting
      ) order by step
    ) from email_rollup), '[]'::jsonb),
    'by_copy', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'copy_key', copy_key, 'sent', sent, 'clicked', clicked,
        'replied', replied, 'positive_replies', positive_replies,
        'meetings', meetings, 'opportunities', opportunities,
        'click_rate', round(100 * clicked::numeric / nullif(sent, 0), 2),
        'qualified_rate', round(100 * greatest(
          positive_replies, meetings, opportunities
        )::numeric / nullif(sent, 0), 2),
        'minimum_sample_reached', sent >= 30
      ) order by copy_key
    ) from copy_rollup), '[]'::jsonb),
    'by_campaign', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'campaign', cr.campaign_external_id, 'contacts', cr.contacts,
        'sent', cr.sent, 'clicked', cr.clicked, 'replied', cr.replied,
        'meetings', cr.meetings, 'opportunities', cr.opportunities,
        'click_rate', round(100 * cr.clicked::numeric / nullif(cr.sent, 0), 2),
        'qualified_rate', round(100 * greatest(
          cr.replied, cr.meetings, cr.opportunities
        )::numeric / nullif(cr.sent, 0), 2),
        'estimated_amount', coalesce(pr.estimated_amount, 0),
        'weighted_amount', coalesce(pr.weighted_amount, 0),
        'closed_amount', coalesce(pr.closed_amount, 0)
      ) order by coalesce(pr.closed_amount, 0) desc, cr.campaign_external_id
    ) from campaign_rollup cr left join pipeline_campaign_rollup pr
      on pr.campaign_external_id = cr.campaign_external_id), '[]'::jsonb),
    'by_variant', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'variant', variant, 'sent_contacts', sent_contacts,
        'clicked_contacts', clicked_contacts, 'qualified_contacts', qualified_contacts,
        'conversion_rate', round(100 * conversion_ratio, 2),
        'lift_percentage_points', round(100 * (conversion_ratio - (
          select count(*) filter (where positive_reply or meeting or opportunity)::numeric /
            nullif(count(*) filter (where sent), 0) from contact_performance
        )), 2),
        'wilson_low_95', round(100 * (
          (conversion_ratio + 1.9208 / sent_contacts) -
          1.96 * pg_catalog.sqrt((conversion_ratio * (1 - conversion_ratio) +
            0.9604 / sent_contacts) / sent_contacts)
        ) / (1 + 3.8416 / sent_contacts), 2),
        'wilson_high_95', round(100 * (
          (conversion_ratio + 1.9208 / sent_contacts) +
          1.96 * pg_catalog.sqrt((conversion_ratio * (1 - conversion_ratio) +
            0.9604 / sent_contacts) / sent_contacts)
        ) / (1 + 3.8416 / sent_contacts), 2),
        'minimum_sample_reached', sent_contacts >= 30
      ) order by variant
    ) from variant_stats where sent_contacts > 0), '[]'::jsonb),
    'by_hour', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'hour', madrid_hour, 'sent', sent, 'clicked', clicked,
        'replied', replied, 'qualified', qualified,
        'click_rate', round(100 * clicked::numeric / nullif(sent, 0), 2),
        'qualified_rate', round(100 * qualified::numeric / nullif(sent, 0), 2)
      ) order by madrid_hour
    ) from hour_rollup), '[]'::jsonb),
    'time_series', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'date', activity_date, 'sent', sent, 'clicked', clicked,
        'replied', replied, 'meetings', meetings,
        'opportunities', opportunities, 'closed_amount', closed_amount
      ) order by activity_date
    ) from time_series_rollup), '[]'::jsonb),
    'cohorts', pg_catalog.jsonb_build_object(
      'by_lot', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'lot', lot, 'sent_contacts', sent_contacts,
          'clicked_contacts', clicked_contacts, 'qualified_contacts', qualified_contacts,
          'click_rate', round(100 * clicked_contacts::numeric / nullif(sent_contacts, 0), 2),
          'qualified_rate', round(100 * qualified_contacts::numeric /
            nullif(sent_contacts, 0), 2)
        ) order by lot
      ) from lot_rollup), '[]'::jsonb),
      'by_company_size', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'company_size', company_size, 'sent_contacts', sent_contacts,
          'clicked_contacts', clicked_contacts, 'qualified_contacts', qualified_contacts,
          'click_rate', round(100 * clicked_contacts::numeric / nullif(sent_contacts, 0), 2),
          'qualified_rate', round(100 * qualified_contacts::numeric /
            nullif(sent_contacts, 0), 2)
        ) order by company_size
      ) from company_size_rollup), '[]'::jsonb)
    ),
    'traffic', pg_catalog.jsonb_build_object(
      'by_domain_source', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'domain', domain_key, 'source', source_key, 'events', events,
          'sessions', sessions, 'conversions', conversions
        ) order by events desc, domain_key, source_key
      ) from source_rollup), '[]'::jsonb),
      'by_link', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'link', link_key, 'clicks', clicks, 'sessions', sessions
        ) order by clicks desc, link_key
      ) from link_rollup), '[]'::jsonb)
    ),
    'tools', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'tool', tool_key, 'events', events, 'sessions', sessions,
        'started', started, 'steps', steps, 'completed', completed, 'abandoned', abandoned,
        'completion_rate', round(100 * completed::numeric / nullif(started, 0), 2),
        'abandonment_rate', round(100 * greatest(started - completed, abandoned)::numeric /
          nullif(started, 0), 2),
        'avg_active_seconds', avg_active_seconds, 'avg_scroll_percent', avg_scroll_percent
      ) order by events desc, tool_key
    ) from tool_rollup), '[]'::jsonb),
    'abandonment_by_section', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'tool', tool_key, 'section', section_key,
        'abandoned', abandoned, 'sessions', sessions
      ) order by abandoned desc, tool_key, section_key
    ) from abandonment_section_rollup), '[]'::jsonb),
    'high_intent_contacts', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'contact_ref', contact_ref, 'intent_score', intent_score,
        'confirmed_signals', confirmed_signals,
        'dominant_tool', coalesce(dominant_tool, 'unattributed'),
        'last_activity_at', last_activity_at
      ) order by intent_score desc, last_activity_at desc
    ) from (select * from high_intent_contacts
      order by intent_score desc, last_activity_at desc limit 100) bounded), '[]'::jsonb),
    'journey', pg_catalog.jsonb_build_object(
      'sessions', (select count(*) from session_rollup),
      'avg_active_seconds', (select round(avg(active_seconds), 2) from session_rollup),
      'avg_scroll_percent', (select round(avg(max_scroll_percent), 2) from session_rollup),
      'started_sessions', (select count(*) from session_rollup where started),
      'completed_sessions', (select count(*) from session_rollup where completed),
      'abandoned_sessions', (select count(*) from session_rollup where started and not completed)
    ),
    'pipeline', pg_catalog.jsonb_build_object(
      'totals', pg_catalog.jsonb_build_object(
        'records', (select count(*) from pipeline_base),
        'estimated_amount', (select coalesce(sum(estimated_amount), 0) from pipeline_base),
        'weighted_amount', (select coalesce(sum(
          estimated_amount * probability_percent / 100
        ), 0) from pipeline_base),
        'closed_amount', (select coalesce(sum(closed_amount), 0)
          from pipeline_base where stage = 'won'),
        'win_rate', (select round(100 * count(*) filter (where stage = 'won')::numeric /
          nullif(count(*) filter (where stage in ('won', 'lost')), 0), 2)
          from pipeline_base),
        'avg_days_to_close', (select round(avg(
          extract(epoch from (closed_at - created_at)) / 86400
        ), 2) from pipeline_base where closed_at is not null),
        'avg_days_email_to_sale', (select round(avg(
          extract(epoch from (closed_at - source_sent_at)) / 86400
        ), 2) from pipeline_base
          where stage = 'won' and closed_at is not null and source_sent_at is not null)
      ),
      'by_stage', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'stage', stage, 'opportunities', opportunities,
          'estimated_amount', estimated_amount, 'weighted_amount', weighted_amount,
          'closed_amount', closed_amount
        ) order by case stage
          when 'interested' then 1 when 'qualified' then 2 when 'meeting' then 3
          when 'opportunity' then 4 when 'won' then 5 else 6 end
      ) from pipeline_stage_rollup), '[]'::jsonb),
      'by_source', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'source', source_key, 'records', records,
          'estimated_amount', estimated_amount,
          'weighted_amount', weighted_amount, 'closed_amount', closed_amount
        ) order by records desc, source_key
      ) from pipeline_source_rollup), '[]'::jsonb),
      'by_campaign', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'campaign', campaign_external_id, 'records', records,
          'estimated_amount', estimated_amount,
          'weighted_amount', weighted_amount, 'closed_amount', closed_amount
        ) order by closed_amount desc, campaign_external_id
      ) from pipeline_campaign_rollup), '[]'::jsonb),
      'by_outcome_reason', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'outcome_reason', outcome_reason, 'outcomes', outcomes,
          'won', won, 'lost', lost, 'closed_amount', closed_amount
        ) order by outcomes desc, outcome_reason
      ) from pipeline_outcome_reason_rollup), '[]'::jsonb)
    ),
    'quality', (select pg_catalog.jsonb_build_object(
      'landing_events', landing_events,
      'campaign_attribution_rate', round(100 * campaign_attributed::numeric /
        nullif(landing_events, 0), 2),
      'contact_attribution_rate', round(100 * contact_attributed::numeric /
        nullif(landing_events, 0), 2),
      'email_attribution_rate', round(100 * email_attributed::numeric /
        nullif(landing_events, 0), 2),
      'production_events', production_events, 'test_events', test_events,
      'incomplete_sessions', incomplete_sessions,
      'unattributed_tool_events', unattributed_tool_events,
      'campaign_events_without_execution', campaign_events_without_execution,
      'duplicate_campaign_event_keys', duplicate_campaign_event_keys,
      'opens_are_directional', true
    ) from quality),
    'anomalies', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('code', code, 'severity', severity)
    ) from anomaly_rows), '[]'::jsonb),
    'recommendations', coalesce((select pg_catalog.jsonb_agg(recommendation)
      from recommendation_rows), '[]'::jsonb),
    'available_filters', pg_catalog.jsonb_build_object(
      'email_steps', coalesce((select pg_catalog.jsonb_agg(step order by step)
        from (select distinct step from execution_base where step is not null) values_), '[]'::jsonb),
      'variants', coalesce((select pg_catalog.jsonb_agg(variant order by variant)
        from (select distinct variant from execution_base) values_), '[]'::jsonb),
      'lots', coalesce((select pg_catalog.jsonb_agg(lot order by lot)
        from (select distinct lot from execution_base) values_), '[]'::jsonb),
      'hours', coalesce((select pg_catalog.jsonb_agg(madrid_hour order by madrid_hour)
        from (select distinct madrid_hour from execution_base) values_), '[]'::jsonb),
      'company_sizes', coalesce((select pg_catalog.jsonb_agg(company_size order by company_size)
        from (select distinct company_size from execution_base
          where company_size is not null) values_), '[]'::jsonb),
      'tools', coalesce((select pg_catalog.jsonb_agg(tool_key order by tool_key)
        from (select distinct tool_key from landing_base) values_), '[]'::jsonb),
      'copy_keys', coalesce((select pg_catalog.jsonb_agg(copy_key order by copy_key)
        from (select distinct copy_key from execution_base) values_), '[]'::jsonb)
    ),
    'metric_contract', pg_catalog.jsonb_build_object(
      'version', '2.0', 'timezone', 'Europe/Madrid',
      'minimum_variant_sample', 30, 'confidence_level', 0.95,
      'open_quality', 'directional',
      'confirmed_outcomes', pg_catalog.jsonb_build_array(
        'delivered', 'click', 'reply', 'meeting', 'opportunity', 'won'
      ),
      'revenue_source', 'internal_pipeline', 'external_crm_required', false,
      'pii_included', false
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.dashboard_upsert_revenue_pipeline(
  text, text, uuid, uuid, text, numeric, numeric, numeric, date, text, uuid, text, bigint
) from public, anon, authenticated;
grant execute on function public.dashboard_upsert_revenue_pipeline(
  text, text, uuid, uuid, text, numeric, numeric, numeric, date, text, uuid, text, bigint
) to service_role;

revoke all on function public.dashboard_get_intelligence_v2(
  text, text, timestamptz, timestamptz, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.dashboard_get_intelligence_v2(
  text, text, timestamptz, timestamptz, uuid, jsonb
) to service_role;

commit;

-- 20260821130000_dashboard_revenue_fk_index.sql
-- Cover the campaign contact foreign key used by revenue reconciliation.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create index if not exists campaign_revenue_pipeline_contact_idx
  on fundae_private.campaign_revenue_pipeline (campaign_contact_id);

commit;
