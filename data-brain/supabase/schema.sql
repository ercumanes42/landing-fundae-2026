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

