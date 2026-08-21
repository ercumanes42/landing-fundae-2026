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
