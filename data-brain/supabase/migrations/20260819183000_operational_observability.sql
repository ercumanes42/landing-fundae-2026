-- Aggregated operational observability and idempotent alert lifecycle.
-- Local artifact only. This migration enables no worker, channel or outbound lane.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '10min';

do $$
declare
  v_missing text;
begin
  select pg_catalog.string_agg(required_table, ', ' order by required_table)
  into v_missing
  from pg_catalog.unnest(array[
    'graph_outbox', 'outbound_delivery_control', 'outbound_daily_usage',
    'campaign_events', 'campaign_contacts', 'cold_campaign_dispatch_outbox',
    'cold_campaign_scheduler_alerts', 'inbound_event_ledger', 'inbound_alerts'
  ]) as required(required_table)
  where pg_catalog.to_regclass('public.' || required_table) is null;

  if v_missing is not null then
    raise exception using errcode = '55000',
      message = 'operational_observability_precheck_missing_tables', detail = v_missing;
  end if;
end;
$$;

create or replace function public.operational_metrics_are_safe(p_metrics jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_metrics) = 'object'
    and (select count(*) from pg_catalog.jsonb_object_keys(p_metrics)) <= 32
    and not exists (
      select 1
      from pg_catalog.jsonb_each(p_metrics) as metric(key, value)
      where metric.key !~ '^[a-z][a-z0-9_]{0,63}$'
        or pg_catalog.jsonb_typeof(metric.value) not in ('number', 'boolean', 'null')
    )
$$;

create table public.operational_heartbeats (
  signal_code text primary key check (signal_code in (
    'oauth', 'mailbox', 'graph_worker', 'reply_processor', 'unsubscribe_processor',
    'hard_bounce_processor', 'hubspot_sync', 'make_scheduler', 'campaign_worker',
    'dashboard'
  )),
  status text not null check (status in ('healthy', 'degraded', 'unavailable', 'unknown')),
  observed_at timestamptz not null,
  metrics jsonb not null default '{}'::jsonb
    check (public.operational_metrics_are_safe(metrics)),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table public.operational_alerts (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (dedupe_key ~ '^[a-f0-9]{64}$'),
  signal_code text not null check (signal_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  severity text not null check (severity in ('warning', 'critical')),
  summary_code text not null check (summary_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  lifecycle text not null default 'open'
    check (lifecycle in ('open', 'acknowledged', 'resolved')),
  metrics jsonb not null default '{}'::jsonb
    check (public.operational_metrics_are_safe(metrics)),
  first_detected_at timestamptz not null,
  last_detected_at timestamptz not null,
  occurrence_count integer not null default 1 check (occurrence_count between 1 and 2147483647),
  acknowledged_at timestamptz,
  acknowledged_by_hash text check (
    acknowledged_by_hash is null or acknowledged_by_hash ~ '^[a-f0-9]{64}$'
  ),
  resolved_at timestamptz,
  resolved_by_hash text check (
    resolved_by_hash is null or resolved_by_hash ~ '^[a-f0-9]{64}$'
  ),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (last_detected_at >= first_detected_at),
  check ((lifecycle <> 'acknowledged') or
    (acknowledged_at is not null and acknowledged_by_hash is not null)),
  check ((lifecycle <> 'resolved') or
    (resolved_at is not null and resolved_by_hash is not null))
);

create index operational_alerts_open_signal_idx
  on public.operational_alerts (signal_code, severity, last_detected_at)
  where lifecycle <> 'resolved';

create table public.operational_alert_receipts (
  evaluation_key text not null check (evaluation_key ~ '^[a-f0-9]{64}$'),
  dedupe_key text not null references public.operational_alerts(dedupe_key) on delete restrict,
  observed_at timestamptz not null,
  primary key (evaluation_key, dedupe_key)
);

create table public.operational_alert_audit (
  id bigint generated always as identity primary key,
  alert_id uuid not null references public.operational_alerts(id) on delete restrict,
  action text not null check (action in ('detected', 'reopened', 'acknowledged', 'resolved')),
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  evaluation_key text check (evaluation_key is null or evaluation_key ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  evidence jsonb not null default '{}'::jsonb
    check (public.operational_metrics_are_safe(evidence)),
  constraint operational_alert_audit_replay_key
    unique nulls not distinct (alert_id, action, evaluation_key)
);

create index operational_alert_audit_alert_time_idx
  on public.operational_alert_audit (alert_id, occurred_at desc);

create index campaign_events_operational_signal_idx
  on public.campaign_events (event_name, occurred_at desc)
  where event_name in ('reply_received', 'unsubscribe', 'bounce_hard');

alter table public.operational_heartbeats enable row level security;
alter table public.operational_heartbeats force row level security;
alter table public.operational_alerts enable row level security;
alter table public.operational_alerts force row level security;
alter table public.operational_alert_receipts enable row level security;
alter table public.operational_alert_receipts force row level security;
alter table public.operational_alert_audit enable row level security;
alter table public.operational_alert_audit force row level security;

revoke all privileges on table public.operational_heartbeats,
  public.operational_alerts, public.operational_alert_receipts,
  public.operational_alert_audit from public, anon, authenticated, service_role;
revoke all privileges on sequence public.operational_alert_audit_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.record_operational_heartbeat(
  p_signal_code text,
  p_status text,
  p_observed_at timestamptz,
  p_metrics jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_signal_code not in (
      'oauth', 'mailbox', 'graph_worker', 'reply_processor', 'unsubscribe_processor',
      'hard_bounce_processor', 'hubspot_sync', 'make_scheduler', 'campaign_worker',
      'dashboard'
    ) or p_status not in ('healthy', 'degraded', 'unavailable', 'unknown')
    or p_observed_at is null or p_observed_at > v_now + interval '1 minute'
    or not public.operational_metrics_are_safe(coalesce(p_metrics, '{}'::jsonb)) then
    raise exception using errcode = '22023', message = 'invalid_operational_heartbeat';
  end if;

  insert into public.operational_heartbeats(signal_code, status, observed_at, metrics, updated_at)
  values (p_signal_code, p_status, p_observed_at, coalesce(p_metrics, '{}'::jsonb), v_now)
  on conflict (signal_code) do update
  set status = excluded.status,
      observed_at = excluded.observed_at,
      metrics = excluded.metrics,
      updated_at = v_now
  where public.operational_heartbeats.observed_at <= excluded.observed_at;

  return pg_catalog.jsonb_build_object('accepted', true, 'signal_code', p_signal_code);
end;
$$;

create or replace function public.get_operational_observability_snapshot(
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.clock_timestamp());
  v_day date;
  v_result jsonb;
begin
  if v_now < pg_catalog.clock_timestamp() - interval '5 minutes'
    or v_now > pg_catalog.clock_timestamp() + interval '1 minute' then
    raise exception using errcode = '22023', message = 'invalid_observability_clock';
  end if;
  select (v_now at time zone 'Europe/Madrid')::date into v_day;

  with heartbeat_data as (
    select signal_code, status, observed_at, metrics
    from public.operational_heartbeats
  ), graph_data as (
    select
      count(*) filter (where state in ('reserved','draft_creating','draft_created')
        and created_at <= v_now - interval '10 minutes') as aged_10m,
      count(*) filter (where state in ('reserved','draft_creating','draft_created')
        and created_at <= v_now - interval '30 minutes') as aged_30m,
      count(*) filter (where state = 'ambiguous_halted') as ambiguous,
      count(*) filter (where state = 'definitive_failed') as dlq,
      count(*) filter (where state = 'send_submitted'
        and send_submitted_at <= v_now - interval '10 minutes') as sent_unconfirmed_10m
    from public.graph_outbox
    where state not in ('confirmed_sent','suppressed_before_send')
  ), inbound_data as (
    select count(*) as manual_review_open,
      coalesce(pg_catalog.extract(epoch from (v_now - min(observed_at)))::integer, 0)
        as manual_review_oldest_seconds
    from public.inbound_event_ledger where status = 'manual_review'
  ), campaign_data as (
    select
      count(*) filter (where status = 'queued' and created_at <= v_now - interval '15 minutes')
        as queued_aged_15m,
      count(*) filter (where status = 'ambiguous_halted') as ambiguous,
      count(*) filter (where status in ('claimed','reserved')) as in_flight
    from public.cold_campaign_dispatch_outbox
    where status not in ('confirmed_sent','definitive_failed','suppressed')
  ), pacing_data as (
    select coalesce(sum(send_submitted_count), 0)::integer as cold_sent_today
    from public.outbound_daily_usage
    where local_day = v_day and lane = 'cold'
  ), spacing_data as (
    select count(*)::integer as spacing_violations
    from (
      select send_submitted_at,
        pg_catalog.lag(send_submitted_at) over (order by send_submitted_at) as previous_sent_at
      from public.graph_outbox
      where lane = 'cold' and quota_send_day = v_day and send_submitted_at is not null
    ) sends
    where previous_sent_at is not null
      and send_submitted_at < previous_sent_at + interval '60 seconds'
  ), event_data as (
    select
      count(*) filter (where event_name = 'reply_received')::integer as replies_24h,
      count(*) filter (where event_name = 'unsubscribe')::integer as unsubscribes_24h,
      count(*) filter (where event_name = 'bounce_hard')::integer as hard_bounces_24h
    from public.campaign_events
    where event_name in ('reply_received','unsubscribe','bounce_hard')
      and occurred_at >= v_now - interval '24 hours'
  ), alert_data as (
    select
      count(*) filter (where lifecycle = 'open')::integer as open,
      count(*) filter (where lifecycle = 'acknowledged')::integer as acknowledged,
      count(*) filter (where lifecycle <> 'resolved' and severity = 'critical')::integer as critical
    from public.operational_alerts
  )
  select pg_catalog.jsonb_build_object(
    'generated_at', v_now,
    'heartbeats', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'signal_code', signal_code, 'status', status, 'observed_at', observed_at,
      'metrics', metrics) order by signal_code) from heartbeat_data), '[]'::jsonb),
    'graph', (select pg_catalog.to_jsonb(graph_data) from graph_data),
    'inbound', (select pg_catalog.to_jsonb(inbound_data) from inbound_data),
    'campaign', (select pg_catalog.to_jsonb(campaign_data) from campaign_data),
    'pacing', (select pg_catalog.to_jsonb(pacing_data) || pg_catalog.to_jsonb(spacing_data)
      from pacing_data cross join spacing_data),
    'events_24h', (select pg_catalog.to_jsonb(event_data) from event_data),
    'alerts', (select pg_catalog.to_jsonb(alert_data) from alert_data)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.reconcile_operational_alerts(
  p_evaluation_key text,
  p_evaluated_at timestamptz,
  p_actor_hash text,
  p_alerts jsonb,
  p_managed_signal_codes text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_alert public.operational_alerts%rowtype;
  v_inserted_receipt_count integer;
  v_previous_lifecycle text;
  v_active_dedupe text[] := array[]::text[];
  v_touched integer := 0;
  v_resolved integer := 0;
begin
  if p_evaluation_key !~ '^[a-f0-9]{64}$'
    or p_actor_hash !~ '^[a-f0-9]{64}$'
    or p_evaluated_at is null
    or pg_catalog.jsonb_typeof(p_alerts) <> 'array'
    or pg_catalog.jsonb_array_length(p_alerts) > 64
    or pg_catalog.coalesce(pg_catalog.array_length(p_managed_signal_codes, 1), 0) > 64 then
    raise exception using errcode = '22023', message = 'invalid_operational_reconciliation';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_alerts)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
      or (v_item->>'dedupe_key') !~ '^[a-f0-9]{64}$'
      or (v_item->>'signal_code') !~ '^[a-z][a-z0-9_]{1,63}$'
      or (v_item->>'severity') not in ('warning','critical')
      or (v_item->>'summary_code') !~ '^[A-Z][A-Z0-9_]{2,63}$'
      or not public.operational_metrics_are_safe(coalesce(v_item->'metrics', '{}'::jsonb))
      or not ((v_item->>'signal_code') = any(p_managed_signal_codes)) then
      raise exception using errcode = '22023', message = 'invalid_operational_alert';
    end if;

    insert into public.operational_alerts(
      dedupe_key, signal_code, severity, summary_code, metrics,
      first_detected_at, last_detected_at
    ) values (
      v_item->>'dedupe_key', v_item->>'signal_code', v_item->>'severity',
      v_item->>'summary_code', coalesce(v_item->'metrics', '{}'::jsonb),
      p_evaluated_at, p_evaluated_at
    )
    on conflict (dedupe_key) do nothing;

    select * into v_alert from public.operational_alerts
    where dedupe_key = v_item->>'dedupe_key' for update;
    if v_alert.signal_code <> v_item->>'signal_code'
      or v_alert.summary_code <> v_item->>'summary_code' then
      raise exception using errcode = '23505', message = 'operational_alert_dedupe_collision';
    end if;

    v_previous_lifecycle := v_alert.lifecycle;
    insert into public.operational_alert_receipts(evaluation_key, dedupe_key, observed_at)
    values (p_evaluation_key, v_alert.dedupe_key, p_evaluated_at)
    on conflict do nothing;
    get diagnostics v_inserted_receipt_count = row_count;
    v_active_dedupe := pg_catalog.array_append(v_active_dedupe, v_alert.dedupe_key);

    if v_inserted_receipt_count = 1 then
      update public.operational_alerts
      set severity = v_item->>'severity', metrics = coalesce(v_item->'metrics', '{}'::jsonb),
        lifecycle = case when lifecycle = 'resolved' then 'open' else lifecycle end,
        last_detected_at = pg_catalog.greatest(last_detected_at, p_evaluated_at),
        occurrence_count = occurrence_count + case when first_detected_at = p_evaluated_at then 0 else 1 end,
        resolved_at = null, resolved_by_hash = null, updated_at = pg_catalog.clock_timestamp()
      where id = v_alert.id returning * into v_alert;
      insert into public.operational_alert_audit(
        alert_id, action, actor_hash, evaluation_key, occurred_at, evidence
      ) values (
        v_alert.id, case when v_previous_lifecycle = 'resolved' then 'reopened' else 'detected' end,
        p_actor_hash, p_evaluation_key, p_evaluated_at, v_alert.metrics
      ) on conflict do nothing;
      v_touched := v_touched + 1;
    end if;
  end loop;

  with resolved_rows as (
    update public.operational_alerts
    set lifecycle = 'resolved', resolved_at = p_evaluated_at,
      resolved_by_hash = p_actor_hash, updated_at = pg_catalog.clock_timestamp()
    where lifecycle <> 'resolved'
      and signal_code = any(p_managed_signal_codes)
      and not (dedupe_key = any(v_active_dedupe))
    returning id, metrics
  ), audited as (
    insert into public.operational_alert_audit(
      alert_id, action, actor_hash, evaluation_key, occurred_at, evidence
    ) select id, 'resolved', p_actor_hash, p_evaluation_key, p_evaluated_at, metrics
    from resolved_rows on conflict do nothing returning 1
  ) select count(*) into v_resolved from audited;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'evaluation_key', p_evaluation_key,
    'touched', v_touched, 'resolved', v_resolved
  );
end;
$$;

create or replace function public.transition_operational_alert(
  p_dedupe_key text,
  p_action text,
  p_actor_hash text,
  p_evidence jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.operational_alerts%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_dedupe_key !~ '^[a-f0-9]{64}$'
    or p_action not in ('acknowledged','resolved')
    or p_actor_hash !~ '^[a-f0-9]{64}$'
    or not public.operational_metrics_are_safe(coalesce(p_evidence, '{}'::jsonb)) then
    raise exception using errcode = '22023', message = 'invalid_operational_alert_transition';
  end if;
  select * into v_alert from public.operational_alerts
  where dedupe_key = p_dedupe_key for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'operational_alert_not_found';
  end if;
  if v_alert.lifecycle = p_action then
    return pg_catalog.jsonb_build_object('accepted', true, 'duplicate', true, 'lifecycle', p_action);
  end if;
  if v_alert.lifecycle = 'resolved' then
    raise exception using errcode = '55000', message = 'operational_alert_already_resolved';
  end if;
  update public.operational_alerts set lifecycle = p_action,
    acknowledged_at = case when p_action = 'acknowledged' then v_now else acknowledged_at end,
    acknowledged_by_hash = case when p_action = 'acknowledged' then p_actor_hash else acknowledged_by_hash end,
    resolved_at = case when p_action = 'resolved' then v_now else resolved_at end,
    resolved_by_hash = case when p_action = 'resolved' then p_actor_hash else resolved_by_hash end,
    updated_at = v_now where id = v_alert.id;
  insert into public.operational_alert_audit(alert_id, action, actor_hash, occurred_at, evidence)
  values (v_alert.id, p_action, p_actor_hash, v_now, coalesce(p_evidence, '{}'::jsonb));
  return pg_catalog.jsonb_build_object('accepted', true, 'duplicate', false, 'lifecycle', p_action);
end;
$$;

revoke execute on function public.operational_metrics_are_safe(jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.record_operational_heartbeat(text,text,timestamptz,jsonb)
  from public, anon, authenticated;
revoke execute on function public.get_operational_observability_snapshot(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.reconcile_operational_alerts(text,timestamptz,text,jsonb,text[])
  from public, anon, authenticated;
revoke execute on function public.transition_operational_alert(text,text,text,jsonb)
  from public, anon, authenticated;

grant execute on function public.record_operational_heartbeat(text,text,timestamptz,jsonb)
  to service_role;
grant execute on function public.get_operational_observability_snapshot(timestamptz)
  to service_role;
grant execute on function public.reconcile_operational_alerts(text,timestamptz,text,jsonb,text[])
  to service_role;
grant execute on function public.transition_operational_alert(text,text,text,jsonb)
  to service_role;

commit;
