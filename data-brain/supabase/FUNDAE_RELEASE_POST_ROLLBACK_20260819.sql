-- Read-only proof that forward containment is durable. Always rolls back.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';
set local idle_in_transaction_session_timeout = '5min';

do $$
begin
  if not exists (
    select 1 from public.outbound_delivery_control
    where singleton and not master_enabled and not transactional_enabled and not cold_enabled
      and halt_reason = 'FUNDAE_RELEASE_FORWARD_ROLLBACK'
  ) or exists (
    select 1 from public.cold_campaign_provision_control where singleton and enabled
  ) or exists (
    select 1 from public.journey_retention_control where singleton and purge_enabled
  ) then
    raise exception using errcode = '23514',
      message = 'fundae_post_rollback_switch_not_off';
  end if;

  if exists (select 1 from public.dashboard_principals where is_active)
    or exists (select 1 from public.cold_campaign_dispatch_outbox where status in ('claimed','reserved'))
    or exists (select 1 from public.transactional_dispatch_outbox where status in ('claimed','reserved')) then
    raise exception using errcode = '23514',
      message = 'fundae_post_rollback_work_still_active';
  end if;

  if pg_catalog.has_function_privilege(
       'service_role', 'public.claim_transactional_graph_dispatch(uuid,integer,integer)', 'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'service_role', 'public.reserve_claimed_transactional_graph_dispatch(uuid,uuid,text,text,text,text,text)', 'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'service_role', 'public.begin_graph_draft_creation(uuid,text)', 'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'service_role', 'public.authorize_graph_draft_send(uuid,text,text,text)', 'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'service_role', 'public.claim_cold_campaign_dispatch(uuid,text,integer)', 'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'service_role', 'public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text)', 'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'service_role', 'public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb)', 'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'service_role', 'public.purge_expired_journey_events(timestamptz,integer,boolean)', 'EXECUTE'
     ) then
    raise exception using errcode = '42501',
      message = 'fundae_post_rollback_entrypoint_still_executable';
  end if;
end;
$$;

select
  'fundae_release_post_rollback_ok' as result,
  (select pg_catalog.count(*) from public.graph_outbox
   where state in ('draft_creating','draft_created','send_submitted','ambiguous_halted'))
    as graph_rows_requiring_reconciliation,
  (select pg_catalog.count(*) from public.graph_outbox
   where state = 'send_submitted' and sent_items_evidence_hash is null)
    as sent_submitted_without_confirmation;

rollback;
