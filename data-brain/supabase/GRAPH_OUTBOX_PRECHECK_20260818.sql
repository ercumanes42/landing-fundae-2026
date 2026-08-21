-- Read-only precheck. Run after backup and before applying the Graph outbox migration.
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

  if exists (
    select 1 from public.mailbox_delivery_reservations
    where lane = 'cold' and (submission_id is not null or resource is not null)
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_precheck_invalid_cold_claim';
  end if;
end;
$$;

select
  (select count(*) from public.mailbox_delivery_reservations
    where status = 'reserved') as active_reservations,
  (select count(*) from public.mailbox_delivery_reservations
    where status = 'reserved'
      and lease_expires_at <= pg_catalog.clock_timestamp()
  ) as expired_reservations_requiring_recovery,
  (select count(*) from public.mailbox_delivery_reservations
    where status = 'reconcile_required') as unresolved_reservations,
  (select count(*) from public.campaign_suppressions) as suppressed_identities,
  (select count(*) from public.campaign_executions
    where status = 'planned') as planned_executions;

select
  (select count(*) from (
    select submission_id from public.leads
    where submission_id is not null
    group by submission_id having count(*) > 1
  ) duplicate_submissions) as duplicate_lead_submission_ids,
  (select count(*) from public.leads
    where form_type in ('calculator','interactive_checklist','checklist','webinar')
      and (submission_id is null or payload is null)
  ) as eligible_leads_missing_dispatch_identity;
