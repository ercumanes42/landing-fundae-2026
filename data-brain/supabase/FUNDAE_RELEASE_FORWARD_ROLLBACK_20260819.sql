-- Forward-only containment. Preserves rows and evidence; disables entry points.
-- Requires psql variable operator_hash (64 lowercase hex). Run only when authorized.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';
set local idle_in_transaction_session_timeout = '5min';
set local app.operator_hash = :'operator_hash';

do $$
declare
  v_actor text := pg_catalog.current_setting('app.operator_hash', true);
  v_result jsonb;
begin
  if v_actor is null or v_actor !~ '^[a-f0-9]{64}$'
    or v_actor = pg_catalog.repeat('0', 64) then
    raise exception using errcode = '22023',
      message = 'fundae_forward_rollback_operator_hash_required';
  end if;
  v_result := public.emergency_halt_outbound_delivery(
    v_actor, 'FUNDAE_RELEASE_FORWARD_ROLLBACK'
  );
  if not coalesce((v_result->>'accepted')::boolean, false) then
    raise exception using errcode = '23514',
      message = 'fundae_forward_rollback_halt_rejected';
  end if;
end;
$$;

update public.cold_campaign_provision_control
set enabled = false, updated_at = pg_catalog.clock_timestamp()
where singleton;

update public.journey_retention_control
set purge_enabled = false, updated_at = pg_catalog.clock_timestamp()
where singleton;

update public.dashboard_principals
set is_active = false, revoked_at = coalesce(revoked_at, pg_catalog.clock_timestamp()),
    updated_at = pg_catalog.clock_timestamp()
where is_active;

with halted as (
  update public.cold_campaign_dispatch_outbox
  set status = 'ambiguous_halted', last_reason_code = 'forward_rollback',
      terminal_evidence_hash = pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to('cold-forward-rollback-v2' || id::text, 'UTF8'), 'sha256'
      ), 'hex'), terminal_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where status in ('claimed', 'reserved')
  returning id, terminal_evidence_hash
)
insert into public.cold_campaign_scheduler_alerts(code, dispatch_id, evidence_hash)
select 'FORWARD_ROLLBACK', id, terminal_evidence_hash from halted;

update public.transactional_dispatch_outbox
set status = 'ambiguous_halted',
    outcome_evidence_hash = pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to('transactional-forward-rollback-v2' || id::text, 'UTF8'), 'sha256'
    ), 'hex'), terminal_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
where status in ('claimed', 'reserved');

revoke execute on function public.claim_transactional_graph_dispatch(uuid,integer,integer) from service_role;
revoke execute on function public.reserve_claimed_transactional_graph_dispatch(uuid,uuid,text,text,text,text,text) from service_role;
revoke execute on function public.reserve_cold_graph_delivery(text,text,text,text,text,text,text,text,text) from service_role;
revoke execute on function public.begin_graph_draft_creation(uuid,text) from service_role;
revoke execute on function public.authorize_graph_draft_send(uuid,text,text,text) from service_role;
revoke execute on function public.claim_cold_campaign_dispatch(uuid,text,integer) from service_role;
revoke execute on function public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text) from service_role;
revoke execute on function public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb) from service_role;
revoke execute on function public.finalize_cold_campaign_provision(text,text,text) from service_role;
revoke execute on function public.purge_expired_journey_events(timestamptz,integer,boolean) from service_role;
revoke execute on function public.dashboard_get_summary(text,text,timestamptz,timestamptz,uuid) from service_role;
revoke execute on function public.dashboard_get_sample(text,text,text,timestamptz,timestamptz,integer,integer) from service_role;

commit;

select
  'fundae_release_forward_rollback_committed' as result,
  (select pg_catalog.count(*) from public.graph_outbox
   where state in ('draft_creating','draft_created','send_submitted','ambiguous_halted'))
    as graph_rows_requiring_reconciliation;
