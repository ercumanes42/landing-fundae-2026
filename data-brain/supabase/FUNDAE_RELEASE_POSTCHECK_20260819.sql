-- Consolidated read-only postcheck for the complete local release chain.
-- Advisors, EXPLAIN and rollback smoke remain separate mandatory gates.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '10min';
set local idle_in_transaction_session_timeout = '10min';

do $$
declare
  v_missing text;
  v_bad_rls text;
  v_bad_definers text;
  v_missing_rpc text;
  v_missing_index text;
begin
  select pg_catalog.string_agg(required_name, ', ' order by required_name)
  into v_missing
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
  ]) required(required_name)
  where pg_catalog.to_regclass('public.' || required_name) is null;
  if v_missing is not null then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_missing_tables', detail = v_missing;
  end if;

  if not exists (
    select 1 from public.outbound_delivery_control
    where singleton and not master_enabled and not transactional_enabled
      and not cold_enabled and minimum_spacing_seconds >= 60
      and cold_daily_limit <= 480 and operating_timezone = 'Europe/Madrid'
  ) or not exists (
    select 1 from public.journey_retention_control
    where singleton and raw_event_days = 90 and not purge_enabled
  ) or not exists (
    select 1 from public.cold_campaign_provision_control
    where singleton and not enabled
  ) then
    raise exception using errcode = '23514',
      message = 'fundae_release_postcheck_not_fail_closed';
  end if;

  select pg_catalog.string_agg(c.relname, ', ' order by c.relname)
  into v_bad_rls
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and c.relname = any(array[
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
    ]) and (not c.relrowsecurity or not c.relforcerowsecurity);
  if v_bad_rls is not null then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_rls_not_forced', detail = v_bad_rls;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join pg_catalog.unnest(array['anon','authenticated']) roles(role_name)
    where n.nspname = 'public' and c.relkind in ('r','p')
      and c.relname = any(array[
        'graph_outbox', 'graph_outbox_authorizations',
        'transactional_dispatch_outbox', 'dashboard_principals',
        'dashboard_audit_log', 'inbound_event_ledger', 'inbound_alerts',
        'inbound_sync_cursors', 'cold_campaign_message_payloads',
        'cold_campaign_dispatch_outbox', 'cold_campaign_scheduler_alerts',
        'operational_heartbeats', 'operational_alerts',
        'operational_alert_receipts', 'operational_alert_audit',
        'journey_retention_control', 'journey_retention_runs',
        'cold_campaign_provision_control', 'cold_campaign_provision_manifests',
        'cold_campaign_provision_batches'
      ]) and (
        pg_catalog.has_table_privilege(roles.role_name, c.oid, 'SELECT')
        or pg_catalog.has_table_privilege(roles.role_name, c.oid, 'INSERT')
        or pg_catalog.has_table_privilege(roles.role_name, c.oid, 'UPDATE')
        or pg_catalog.has_table_privilege(roles.role_name, c.oid, 'DELETE')
      )
  ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_public_table_privilege';
  end if;

  select pg_catalog.string_agg(signature, ', ' order by signature)
  into v_missing_rpc
  from pg_catalog.unnest(array[
    'public.authorize_graph_draft_send(uuid,text,text,text)',
    'public.claim_transactional_graph_dispatch(uuid,integer,integer)',
    'public.claim_inbound_event(text,text,text,jsonb,integer)',
    'public.advance_inbound_cursor(text,text,text)',
    'public.dashboard_get_summary(text,text,timestamptz,timestamptz,uuid)',
    'public.claim_cold_campaign_dispatch(uuid,text,integer)',
    'public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text)',
    'public.get_operational_observability_snapshot(timestamptz)',
    'public.purge_expired_journey_events(timestamptz,integer,boolean)',
    'public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb)',
    'public.finalize_cold_campaign_provision(text,text,text)',
    'public.record_campaign_event_atomic(text,text,text,timestamptz,text,jsonb,jsonb)'
  ]) required(signature)
  where pg_catalog.to_regprocedure(signature) is null;
  if v_missing_rpc is not null then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_missing_rpc', detail = v_missing_rpc;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      pg_catalog.coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where n.nspname = 'public'
      and p.proname = any(array[
        'authorize_graph_draft_send', 'claim_transactional_graph_dispatch',
        'claim_inbound_event', 'advance_inbound_cursor', 'dashboard_get_summary',
        'dashboard_get_sample', 'claim_cold_campaign_dispatch',
        'bind_cold_campaign_reservation', 'get_operational_observability_snapshot',
        'purge_expired_journey_events', 'apply_cold_campaign_provision_batch',
        'finalize_cold_campaign_provision', 'record_campaign_event_atomic'
      ]) and acl.privilege_type = 'EXECUTE'
      and (acl.grantee = 0 or acl.grantee in (
        select oid from pg_catalog.pg_roles where rolname in ('anon','authenticated')
      ))
  ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_rpc_public_execute';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like '%\_pre\_safety\_20260819' escape '\'
      and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_bypass_rpc_executable';
  end if;

  select pg_catalog.string_agg(p.proname, ', ' order by p.proname)
  into v_bad_definers
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname = any(array[
      'enqueue_transactional_graph_dispatch', 'dashboard_require_role',
      'dashboard_get_summary', 'dashboard_get_sample', 'claim_inbound_event',
      'finalize_inbound_event', 'advance_inbound_cursor',
      'claim_cold_campaign_dispatch', 'bind_cold_campaign_reservation',
      'finalize_cold_campaign_dispatch', 'record_operational_heartbeat',
      'reconcile_operational_alerts', 'purge_expired_journey_events',
      'apply_cold_campaign_provision_batch', 'finalize_cold_campaign_provision',
      'cold_outbound_barrier_reason', 'record_campaign_event_atomic'
    ]) and not pg_catalog.coalesce(
      p.proconfig @> array['search_path=""']::text[], false
    );
  if v_bad_definers is not null then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_insecure_definer', detail = v_bad_definers;
  end if;

  select pg_catalog.string_agg(required_index, ', ' order by required_index)
  into v_missing_index
  from pg_catalog.unnest(array[
    'graph_outbox_mailbox_draft_immutable_idx',
    'graph_outbox_marker_casefold_unique_idx',
    'cold_campaign_single_inflight_idx',
    'cold_campaign_dispatch_queue_idx',
    'inbound_event_ledger_review_idx',
    'events_journey_retention_idx',
    'operational_alerts_open_signal_idx'
  ]) required(required_index)
  where not exists (
    select 1 from pg_catalog.pg_class idx
    join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
    join pg_catalog.pg_index i on i.indexrelid = idx.oid
    where n.nspname = 'public' and idx.relname = required_index
      and i.indisvalid and i.indisready
  );
  if v_missing_index is not null then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_missing_or_invalid_index', detail = v_missing_index;
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint con
    join pg_catalog.pg_class rel on rel.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and rel.relname = any(array[
      'graph_outbox', 'cold_campaign_dispatch_outbox', 'operational_alerts',
      'journey_retention_control', 'cold_campaign_provision_manifests'
    ]) and not con.convalidated
  ) then
    raise exception using errcode = '23514',
      message = 'fundae_release_postcheck_unvalidated_constraint';
  end if;

  if exists (
    select 1 from public.campaigns
    where external_id = 'FUNDAE_2026_EMAIL_V1' and is_active
  ) then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_target_campaign_active';
  end if;

  if exists (
    select 1 from public.cold_campaign_provision_manifests m
    where m.status = 'prepared_off' and (
      (select pg_catalog.count(*) from public.campaign_contacts c
       where c.campaign_id = m.campaign_id) <> 939
      or (select pg_catalog.count(*) from public.campaign_executions e
          where e.campaign_id = m.campaign_id and e.channel = 'email'
            and e.action_name = 'delivery_scheduled') <> 4695
    )
  ) then
    raise exception using errcode = '23514',
      message = 'fundae_release_postcheck_prepared_manifest_count_mismatch';
  end if;
end;
$$;

select
  'fundae_release_postcheck_ok' as result,
  (select pg_catalog.count(*) from public.graph_outbox) as graph_outbox_rows,
  (select pg_catalog.count(*) from public.inbound_event_ledger) as inbound_ledger_rows,
  (select pg_catalog.count(*) from public.cold_campaign_dispatch_outbox) as cold_dispatch_rows,
  (select pg_catalog.count(*) from public.operational_alerts where lifecycle <> 'resolved') as open_alerts,
  (select pg_catalog.count(*) from public.cold_campaign_provision_manifests) as provision_manifests;

rollback;
