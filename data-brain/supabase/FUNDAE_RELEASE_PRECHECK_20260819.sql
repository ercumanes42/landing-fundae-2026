-- Consolidated read-only precheck for the 2026-08-19 FUNDAE release chain.
-- Run only after a verified backup. This script always rolls back.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';
set local idle_in_transaction_session_timeout = '5min';

do $$
declare
  v_missing text;
  v_existing_release_objects text;
begin
  select pg_catalog.string_agg(required_name, ', ' order by required_name)
  into v_missing
  from pg_catalog.unnest(array[
    'campaigns', 'campaign_contacts', 'campaign_events', 'campaign_executions',
    'campaign_suppressions', 'campaign_unsubscribe_tokens', 'delivery_queue',
    'events', 'leads', 'mailbox_delivery_reservations', 'mailbox_throttle_state',
    'transactional_email_events', 'transactional_intake_claims'
  ]) required(required_name)
  where pg_catalog.to_regclass('public.' || required_name) is null;

  if v_missing is not null then
    raise exception using errcode = '55000',
      message = 'fundae_release_precheck_missing_base_tables', detail = v_missing;
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')
    or not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
    or not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    raise exception using errcode = '55000',
      message = 'fundae_release_precheck_missing_supabase_roles';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null
    or pg_catalog.to_regprocedure('public.reserve_cold_mailbox_delivery(text,text,text,text)') is null then
    raise exception using errcode = '55000',
      message = 'fundae_release_precheck_missing_required_functions';
  end if;

  select pg_catalog.string_agg(object_name, ', ' order by object_name)
  into v_existing_release_objects
  from (
    select object_name
    from pg_catalog.unnest(array[
      'outbound_delivery_control', 'outbound_daily_usage', 'graph_outbox',
      'graph_outbox_authorizations', 'graph_outbox_events',
      'transactional_dispatch_outbox', 'dashboard_principals',
      'dashboard_audit_log', 'inbound_event_ledger', 'inbound_alerts',
      'inbound_sync_cursors', 'cold_campaign_message_payloads',
      'cold_campaign_dispatch_outbox', 'cold_campaign_scheduler_alerts',
      'operational_heartbeats', 'operational_alerts',
      'operational_alert_receipts', 'operational_alert_audit',
      'journey_retention_control', 'journey_retention_runs',
      'cold_campaign_provision_control', 'cold_campaign_provision_manifests',
      'cold_campaign_provision_batches'
    ]) release_object(object_name)
    where pg_catalog.to_regclass('public.' || object_name) is not null
  ) existing;

  if v_existing_release_objects is not null then
    raise exception using errcode = '55000',
      message = 'fundae_release_precheck_partial_or_already_applied',
      detail = v_existing_release_objects,
      hint = 'Do not retry blindly. Run the partial-state inventory and choose an additive recovery.';
  end if;

  if exists (
    select 1 from public.campaigns
    where external_id = 'FUNDAE_2026_EMAIL_V1'
      and (is_active or status not in ('draft', 'paused', 'completed', 'cancelled'))
  ) then
    raise exception using errcode = '55000',
      message = 'fundae_release_precheck_target_campaign_not_inert';
  end if;

  if exists (
    select 1 from public.mailbox_delivery_reservations
    where status in ('reserved', 'reconcile_required')
  ) then
    raise exception using errcode = '55000',
      message = 'fundae_release_precheck_mailbox_work_in_flight';
  end if;

  if exists (
    select 1 from public.mailbox_delivery_reservations
    where lane = 'cold' and (submission_id is not null or resource is not null)
  ) then
    raise exception using errcode = '23514',
      message = 'fundae_release_precheck_invalid_cold_claim';
  end if;

  if exists (
    select 1 from public.leads
    where submission_id is not null
    group by submission_id having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = '23505',
      message = 'fundae_release_precheck_duplicate_submission_id';
  end if;
end;
$$;

select
  'fundae_release_precheck_ok' as result,
  pg_catalog.current_database() is not null as database_reachable,
  (select pg_catalog.count(*) from public.leads) as lead_count,
  (select pg_catalog.count(*) from public.events) as journey_event_count,
  (select pg_catalog.count(*) from public.campaigns) as campaign_count,
  (select pg_catalog.count(*) from public.mailbox_delivery_reservations) as reservation_count;

rollback;
