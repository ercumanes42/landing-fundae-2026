begin;

create table if not exists public.inbound_event_ledger (
  provider text not null check (provider in ('microsoft_graph','calendly')),
  source_event_hash text not null check (source_event_hash ~ '^[a-f0-9]{64}$'),
  event_kind text not null check (event_kind ~ '^[a-z0-9_.:-]{3,64}$'),
  status text not null check (status in ('processing','processed','manual_review','rejected')),
  claim_token uuid,
  lease_expires_at timestamptz,
  campaign_id uuid references public.campaigns(id) on delete restrict,
  campaign_contact_id uuid references public.campaign_contacts(id) on delete restrict,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  reason_code text check (reason_code is null or reason_code ~ '^[a-z0-9_:-]{2,64}$'),
  observed_at timestamptz not null default pg_catalog.clock_timestamp(),
  finalized_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (provider, source_event_hash),
  check ((status='processing' and claim_token is not null and lease_expires_at is not null and finalized_at is null) or
         (status<>'processing' and claim_token is null and lease_expires_at is null and finalized_at is not null)),
  check ((campaign_contact_id is null and campaign_id is null) or (campaign_contact_id is not null and campaign_id is not null))
);

create index if not exists inbound_event_ledger_review_idx on public.inbound_event_ledger(status, observed_at) where status='manual_review';

create table if not exists public.inbound_alerts (
  provider text not null,
  source_event_hash text not null,
  reason_code text not null check (reason_code ~ '^[a-z0-9_:-]{2,64}$'),
  status text not null default 'pending' check (status in ('pending','acknowledged','resolved')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (provider, source_event_hash),
  foreign key (provider, source_event_hash) references public.inbound_event_ledger(provider, source_event_hash) on delete cascade
);

create table if not exists public.inbound_sync_cursors (
  source text primary key check (source ~ '^[a-z0-9_.:-]{3,64}$'),
  cursor_value text not null check (length(cursor_value) between 16 and 16384),
  cursor_hash text not null check (cursor_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table public.inbound_event_ledger enable row level security;
alter table public.inbound_sync_cursors enable row level security;
alter table public.inbound_alerts enable row level security;
alter table public.inbound_event_ledger force row level security;
alter table public.inbound_sync_cursors force row level security;
alter table public.inbound_alerts force row level security;
revoke all on public.inbound_event_ledger, public.inbound_sync_cursors, public.inbound_alerts from public, anon, authenticated;
grant select, insert, update on public.inbound_event_ledger, public.inbound_sync_cursors, public.inbound_alerts to service_role;

create or replace function public.claim_inbound_event(p_provider text,p_source_event_hash text,p_event_kind text,p_evidence jsonb,p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_now timestamptz := pg_catalog.clock_timestamp(); v_row public.inbound_event_ledger%rowtype; v_token uuid := gen_random_uuid();
begin
  if p_provider not in ('microsoft_graph','calendly') or p_source_event_hash !~ '^[a-f0-9]{64}$' or
     p_event_kind !~ '^[a-z0-9_.:-]{3,64}$' or jsonb_typeof(p_evidence)<>'object' or p_lease_seconds not between 30 and 600 then
    raise exception 'invalid inbound claim';
  end if;
  insert into public.inbound_event_ledger(provider,source_event_hash,event_kind,status,claim_token,lease_expires_at,evidence)
  values(p_provider,p_source_event_hash,p_event_kind,'processing',v_token,v_now+make_interval(secs=>p_lease_seconds),p_evidence)
  on conflict do nothing;
  select * into v_row from public.inbound_event_ledger where provider=p_provider and source_event_hash=p_source_event_hash for update;
  v_now := pg_catalog.clock_timestamp();
  if v_row.status<>'processing' then return jsonb_build_object('accepted',false,'duplicate',true,'busy',false,'claimToken',null,'status',v_row.status); end if;
  if v_row.claim_token=v_token then return jsonb_build_object('accepted',true,'duplicate',false,'busy',false,'claimToken',v_token,'status','processing'); end if;
  if v_row.lease_expires_at>v_now then return jsonb_build_object('accepted',false,'duplicate',false,'busy',true,'claimToken',null,'status','processing'); end if;
  update public.inbound_event_ledger set claim_token=v_token,lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),updated_at=v_now where provider=p_provider and source_event_hash=p_source_event_hash;
  return jsonb_build_object('accepted',true,'duplicate',false,'busy',false,'claimToken',v_token,'status','processing');
end $$;

create or replace function public.finalize_inbound_event(p_provider text,p_source_event_hash text,p_claim_token uuid,p_status text,p_campaign_id uuid,p_campaign_contact_id uuid,p_reason_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_now timestamptz := pg_catalog.clock_timestamp(); v_row public.inbound_event_ledger%rowtype;
begin
  if p_status not in ('processed','manual_review','rejected') or p_reason_code !~ '^[a-z0-9_:-]{2,64}$' then raise exception 'invalid inbound finalization'; end if;
  select * into v_row from public.inbound_event_ledger where provider=p_provider and source_event_hash=p_source_event_hash for update;
  if not found or v_row.status<>'processing' or v_row.claim_token<>p_claim_token then raise exception 'inbound claim conflict'; end if;
  if p_campaign_contact_id is not null and not exists(select 1 from public.campaign_contacts where id=p_campaign_contact_id and campaign_id=p_campaign_id) then raise exception 'inbound correlation conflict'; end if;
  update public.inbound_event_ledger set status=p_status,claim_token=null,lease_expires_at=null,campaign_id=p_campaign_id,campaign_contact_id=p_campaign_contact_id,reason_code=p_reason_code,finalized_at=v_now,updated_at=v_now where provider=p_provider and source_event_hash=p_source_event_hash;
  if p_status='manual_review' then
    insert into public.inbound_alerts(provider,source_event_hash,reason_code)
    values(p_provider,p_source_event_hash,p_reason_code)
    on conflict(provider,source_event_hash) do update set reason_code=excluded.reason_code,updated_at=v_now;
  end if;
  return jsonb_build_object('accepted',true,'status',p_status);
end $$;

create or replace function public.advance_inbound_cursor(p_source text,p_expected_cursor_hash text,p_next_cursor text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.inbound_sync_cursors%rowtype; v_hash text := pg_catalog.encode(extensions.digest(p_next_cursor,'sha256'),'hex');
begin
  if p_source !~ '^[a-z0-9_.:-]{3,64}$' or length(p_next_cursor) not between 16 and 16384 or (p_expected_cursor_hash is not null and p_expected_cursor_hash !~ '^[a-f0-9]{64}$') then raise exception 'invalid inbound cursor'; end if;
  select * into v_row from public.inbound_sync_cursors where source=p_source for update;
  if not found then
    if p_expected_cursor_hash is not null then raise exception 'inbound cursor conflict'; end if;
    insert into public.inbound_sync_cursors(source,cursor_value,cursor_hash) values(p_source,p_next_cursor,v_hash);
  else
    if v_row.cursor_hash is distinct from p_expected_cursor_hash then raise exception 'inbound cursor conflict'; end if;
    update public.inbound_sync_cursors set cursor_value=p_next_cursor,cursor_hash=v_hash,updated_at=pg_catalog.clock_timestamp() where source=p_source;
  end if;
  return jsonb_build_object('accepted',true,'cursor_hash',v_hash);
end $$;

revoke execute on function public.claim_inbound_event(text,text,text,jsonb,integer), public.finalize_inbound_event(text,text,uuid,text,uuid,uuid,text), public.advance_inbound_cursor(text,text,text) from public, anon, authenticated;
grant execute on function public.claim_inbound_event(text,text,text,jsonb,integer), public.finalize_inbound_event(text,text,uuid,text,uuid,uuid,text), public.advance_inbound_cursor(text,text,text) to service_role;

commit;
