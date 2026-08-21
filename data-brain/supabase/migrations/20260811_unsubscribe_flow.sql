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
