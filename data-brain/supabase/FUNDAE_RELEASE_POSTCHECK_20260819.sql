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
    'cold_campaign_provision_batches', 'transactional_graph_pilot_runs',
    'hubspot_sync_outbox'
  ]) required(required_name)
  where pg_catalog.to_regclass('public.' || required_name) is null;
  if v_missing is not null then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_missing_tables', detail = v_missing;
  end if;

  if not exists (
    select 1 from public.outbound_delivery_control
    where singleton and not master_enabled and not transactional_enabled
      and not cold_enabled and not hubspot_enabled and minimum_spacing_seconds >= 60
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
      'cold_campaign_provision_batches', 'transactional_graph_pilot_runs',
      'hubspot_sync_outbox'
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
        'cold_campaign_provision_batches', 'transactional_graph_pilot_runs',
        'hubspot_sync_outbox'
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

  if pg_catalog.to_regclass(
       'fundae_private.campaign_revenue_pipeline'
     ) is null then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_intelligence_table_missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'fundae_private'
      and c.relname = 'campaign_revenue_pipeline'
      and c.relkind = 'r'
      and c.relrowsecurity
      and c.relforcerowsecurity
  ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_intelligence_rls_invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    left join pg_catalog.pg_roles roles on roles.oid = acl.grantee
    where n.nspname = 'fundae_private'
      and c.relname = 'campaign_revenue_pipeline'
      and (acl.grantee = 0 or roles.rolname in (
        'anon', 'authenticated', 'service_role'
      ))
  ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_intelligence_table_acl_invalid';
  end if;

  if pg_catalog.to_regprocedure(
       'public.dashboard_get_intelligence_v2(text,text,timestamptz,timestamptz,uuid,jsonb)'
     ) is null or pg_catalog.to_regprocedure(
       'public.dashboard_upsert_revenue_pipeline(text,text,uuid,uuid,text,numeric,numeric,numeric,date,text,uuid,text,bigint)'
     ) is null then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_intelligence_rpc_missing';
  end if;

  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.dashboard_get_intelligence_v2(text,text,timestamptz,timestamptz,uuid,jsonb)',
       'EXECUTE'
     ) or not pg_catalog.has_function_privilege(
       'service_role',
       'public.dashboard_upsert_revenue_pipeline(text,text,uuid,uuid,text,numeric,numeric,numeric,date,text,uuid,text,bigint)',
       'EXECUTE'
     ) or exists (
       select 1
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       cross join lateral pg_catalog.aclexplode(
         coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
       ) acl
       left join pg_catalog.pg_roles roles on roles.oid = acl.grantee
       where n.nspname = 'public'
         and p.proname in (
           'dashboard_get_intelligence_v2',
           'dashboard_upsert_revenue_pipeline'
         )
         and (acl.grantee = 0 or roles.rolname in ('anon', 'authenticated'))
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_intelligence_rpc_acl_invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'dashboard_get_intelligence_v2',
        'dashboard_upsert_revenue_pipeline'
      )
      and (not p.prosecdef or not coalesce(
        p.proconfig @> array['search_path=""']::text[], false
      ))
  ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_intelligence_rpc_security_invalid';
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
    'public.enqueue_operational_alert_delivery(text,text,text,text)',
    'public.claim_operational_alert_delivery(text,integer,text)',
    'public.finalize_operational_alert_delivery(text,text,text,uuid,text,text,text)',
    'public.halt_transactional_graph_dispatch(uuid,uuid,text,text)',
    'public.preview_transactional_graph_pilot(text,text,text,text[],integer)',
    'public.start_transactional_graph_pilot(text,text,text,text[],text,integer)',
    'public.finish_transactional_graph_pilot(text,text,text,text)',
    'public.read_transactional_graph_pilot_ledger(text,text)',
    'public.record_campaign_event_atomic(text,text,text,timestamptz,text,jsonb,jsonb)',
    'public.claim_hubspot_sync_outbox(text,integer,integer)',
    'public.finalize_hubspot_sync_outbox(uuid,text,uuid,bigint,text,text,text,text)'
  ]) required(signature)
  where pg_catalog.to_regprocedure(signature) is null;
  if v_missing_rpc is not null then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_missing_rpc', detail = v_missing_rpc;
  end if;

  if exists (
    select 1 from pg_catalog.unnest(array[
      'public.preview_transactional_graph_pilot(text,text,text,text[],integer)',
      'public.start_transactional_graph_pilot(text,text,text,text[],text,integer)',
      'public.claim_transactional_graph_dispatch(uuid,integer,integer)',
      'public.reserve_claimed_transactional_graph_dispatch(uuid,uuid,text,text,text,text,text)',
      'public.authorize_graph_draft_send(uuid,text,text,text)',
      'public.finish_transactional_graph_pilot(text,text,text,text)',
      'public.read_transactional_graph_pilot_ledger(text,text)',
      'public.emergency_halt_outbound_delivery(text,text)',
      'public.claim_hubspot_sync_outbox(text,integer,integer)',
      'public.finalize_hubspot_sync_outbox(uuid,text,uuid,bigint,text,text,text,text)'
    ]) required(signature)
    where not pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
  ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_pilot_rpc_service_grant_missing';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array[
      'preview_transactional_graph_pilot', 'start_transactional_graph_pilot',
      'claim_transactional_graph_dispatch',
      'reserve_claimed_transactional_graph_dispatch', 'authorize_graph_draft_send',
      'finish_transactional_graph_pilot', 'read_transactional_graph_pilot_ledger',
      'emergency_halt_outbound_delivery', 'claim_hubspot_sync_outbox',
      'finalize_hubspot_sync_outbox'
    ]) and (not p.prosecdef or not coalesce(
      p.proconfig @> array['search_path=""']::text[], false
    ))
  ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_pilot_rpc_security_invalid';
  end if;

  if pg_catalog.to_regprocedure(
    'fundae_private.is_cold_campaign_hmac_identity(text,text)'
  ) is null then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_missing_hmac_identity_helper';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_namespace n
    cross join lateral pg_catalog.aclexplode(
      coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))
    ) acl
    where n.nspname='fundae_private' and acl.privilege_type='USAGE'
      and (acl.grantee=0 or acl.grantee in (
        select oid from pg_catalog.pg_roles
        where rolname in ('anon','authenticated','service_role')
      ))
  ) or exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
    ) acl
    where n.nspname='fundae_private'
      and p.proname='is_cold_campaign_hmac_identity'
      and acl.privilege_type='EXECUTE'
      and (acl.grantee=0 or acl.grantee in (
        select oid from pg_catalog.pg_roles
        where rolname in ('anon','authenticated','service_role')
      ))
  ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_hmac_helper_exposed';
  end if;

  if pg_catalog.to_regprocedure(
    'fundae_private.enforce_campaign_terminal_suppression()'
  ) is null or pg_catalog.to_regprocedure(
    'fundae_private.reject_suppressed_campaign_contact()'
  ) is null then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_suppression_helpers_missing';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'fundae_private'
      and p.proname in (
        'enforce_campaign_terminal_suppression',
        'reject_suppressed_campaign_contact'
      ) and (not p.prosecdef or not coalesce(
        p.proconfig @> array['search_path=""']::text[], false
      ))
  ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_suppression_helper_security_invalid';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where n.nspname = 'fundae_private'
      and p.proname in (
        'enforce_campaign_terminal_suppression',
        'reject_suppressed_campaign_contact'
      ) and acl.privilege_type = 'EXECUTE'
      and (acl.grantee = 0 or acl.grantee in (
        select oid from pg_catalog.pg_roles
        where rolname in ('anon','authenticated','service_role')
      ))
  ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_suppression_helper_exposed';
  end if;

  if exists (
    select 1 from pg_catalog.unnest(array[
      'campaign_events_terminal_suppression',
      'campaign_contacts_suppression_gate'
    ]) required(trigger_name)
    where not exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgname = required.trigger_name
        and not t.tgisinternal and t.tgenabled <> 'D'
    )
  ) then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_suppression_trigger_missing';
  end if;

  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
       'fundae_private.enforce_campaign_terminal_suppression()'
     )), 'insert into public.campaign_suppressions') = 0 or
     pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
       'fundae_private.reject_suppressed_campaign_contact()'
     )), 'where identity_hash = new.email_hash') = 0 or
     pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
       'fundae_private.reject_suppressed_campaign_contact()'
     )), 'if tg_op <> ''INSERT''') = 0 then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_suppression_contract_invalid';
  end if;

  if pg_catalog.strpos(
       pg_catalog.regexp_replace(
         pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
           'public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb)'
         )),
         '[[:space:]]', '', 'g'
       ),
       'notfundae_private.is_cold_campaign_hmac_identity(v_row->>''email'',v_row->>''email_hash'')'
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
         'public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb)'
       )),
       'pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.lower(v_row->>''email''),''UTF8''),''sha256''),''hex'')<>v_row->>''email_hash'''
     ) <> 0 then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_provision_identity_predicate_invalid';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'cold_campaign_provision_manifests'
      and a.attname = 'technical_evidence_hash'
      and a.attnum > 0 and not a.attisdropped and a.attnotnull
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.cold_campaign_provision_manifests'::regclass
      and con.contype = 'c'
      and pg_catalog.strpos(
        pg_catalog.pg_get_constraintdef(con.oid),
        'hash_domain = ''cold-provision-v3''::text'
      ) > 0
  ) then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_provision_v3_schema_invalid';
  end if;

  if pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
         'public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb)'
       )),
       'v_row->>''company_size'',v_row->>''technical_evidence_sha256'''
     ) = 0 or
     pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
         'public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb)'
       )),
       'v_existing_manifest.technical_evidence_hash<>v_technical_evidence_hash'
     ) = 0 or
     pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
         'public.finalize_cold_campaign_provision(text,text,text)'
       )),
       '''cold-provision-v3'',v_manifest.logical_dataset_hash'
     ) = 0 or
     pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
         'public.finalize_cold_campaign_provision(text,text,text)'
       )),
       'v_manifest.technical_evidence_hash,v_manifest.campaign_external_id'
     ) = 0 or
     pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
         'public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb)'
       )), 'cold-provision-v2'
     ) <> 0 or
     pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
         'public.finalize_cold_campaign_provision(text,text,text)'
       )), 'cold-provision-v2'
     ) <> 0 then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_provision_v3_binding_invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where n.nspname = 'public'
      and p.proname = any(array[
        'authorize_graph_draft_send', 'claim_transactional_graph_dispatch',
        'claim_inbound_event', 'advance_inbound_cursor', 'dashboard_get_summary',
        'dashboard_get_sample', 'claim_cold_campaign_dispatch',
        'bind_cold_campaign_reservation', 'get_operational_observability_snapshot',
        'purge_expired_journey_events', 'apply_cold_campaign_provision_batch',
        'finalize_cold_campaign_provision', 'record_campaign_event_atomic',
        'enqueue_operational_alert_delivery', 'claim_operational_alert_delivery',
        'finalize_operational_alert_delivery', 'halt_transactional_graph_dispatch',
        'preview_transactional_graph_pilot', 'start_transactional_graph_pilot',
        'finish_transactional_graph_pilot', 'read_transactional_graph_pilot_ledger'
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
      and (p.proname like '%\_pre\_safety\_20260819' escape '\'
        or p.proname like '%\_pre\_pilot\_20260819' escape '\')
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
      'cold_outbound_barrier_reason', 'record_campaign_event_atomic',
      'enqueue_operational_alert_delivery', 'claim_operational_alert_delivery',
      'finalize_operational_alert_delivery', 'halt_transactional_graph_dispatch',
      'capture_graph_outbox_ambiguity', 'capture_cold_dispatch_ambiguity',
      'capture_transactional_dispatch_ambiguity',
      'preview_transactional_graph_pilot', 'start_transactional_graph_pilot',
      'claim_transactional_graph_dispatch',
      'reserve_claimed_transactional_graph_dispatch', 'authorize_graph_draft_send',
      'finish_transactional_graph_pilot', 'read_transactional_graph_pilot_ledger',
      'emergency_halt_outbound_delivery'
    ]) and not coalesce(
      p.proconfig @> array['search_path=""']::text[], false
    );
  if v_bad_definers is not null then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_insecure_definer', detail = v_bad_definers;
  end if;

  if exists (
    select 1 from pg_catalog.unnest(array[
      'delivery_status','reservation_hash','evidence_hash','delivery_attempt_count',
      'next_attempt_at','claimed_by_hash','claim_token_hash','claim_expires_at',
      'delivered_at','last_attempt_evidence_hash','last_failure_code','delivery_updated_at'
    ]) required(column_name)
    where not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid='public.operational_alert_receipts'::regclass
        and a.attname=required.column_name and a.attnum>0 and not a.attisdropped
    )
  ) then
    raise exception using errcode='55000',
      message='fundae_release_postcheck_alert_delivery_columns_missing';
  end if;

  if exists (
    select 1 from pg_catalog.unnest(array[
      'graph_outbox_capture_ambiguity','cold_dispatch_capture_ambiguity',
      'transactional_dispatch_capture_ambiguity'
    ]) required(trigger_name)
    where not exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgname=required.trigger_name and not t.tgisinternal and t.tgenabled<>'D'
    )
  ) then
    raise exception using errcode='55000',
      message='fundae_release_postcheck_alert_delivery_trigger_missing';
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
    'operational_alerts_open_signal_idx',
    'operational_alert_receipts_delivery_pending_idx',
    'operational_alert_receipts_delivery_claimed_idx'
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
    select 1 from public.transactional_graph_pilot_runs where status = 'active'
  ) or exists (
    select 1 from public.transactional_graph_pilot_runs
    where pg_catalog.array_length(submission_ids, 1) <> 4
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.transactional_graph_pilot_runs', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.transactional_graph_pilot_runs', 'INSERT'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.transactional_graph_pilot_runs', 'UPDATE'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.transactional_graph_pilot_runs', 'DELETE'
  ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_pilot_scope_not_closed';
  end if;

  if pg_catalog.to_regclass(
    'public.transactional_graph_pilot_authorization_fk_idx'
  ) is null then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_pilot_authorization_fk_index_missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'transactional_dispatch_outbox'
      and t.tgname = 'transactional_dispatch_pilot_binding' and not t.tgisinternal
  ) or pg_catalog.to_regclass('public.transactional_graph_pilot_one_active_idx') is null
     or pg_catalog.to_regclass('public.transactional_dispatch_pilot_run_idx') is null then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_pilot_scope_contract_missing';
  end if;

  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
       'public.read_transactional_graph_pilot_ledger(text,text)'
     )), '''draft_immutable_id_hash''') = 0 or
     pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
       'public.read_transactional_graph_pilot_ledger(text,text)'
     )), 'g.sent_items_evidence_hash = d.outcome_evidence_hash') = 0 or
     pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
       'public.read_transactional_graph_pilot_ledger(text,text)'
     )), 'pg_catalog.count(distinct g.graph_draft_immutable_id)') = 0 then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_pilot_ledger_contract_invalid';
  end if;

  if pg_catalog.to_regclass(
       'fundae_private.transactional_graph_pilot_authorization_grants'
     ) is null or
     not exists (
       select 1 from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'fundae_private'
         and c.relname = 'transactional_graph_pilot_authorization_grants'
         and c.relrowsecurity and c.relforcerowsecurity
     ) or
     pg_catalog.has_table_privilege(
       'service_role',
       'fundae_private.transactional_graph_pilot_authorization_grants',
       'SELECT'
     ) or pg_catalog.has_table_privilege(
       'service_role',
       'fundae_private.transactional_graph_pilot_authorization_grants',
       'INSERT'
     ) or pg_catalog.has_table_privilege(
       'service_role',
       'fundae_private.transactional_graph_pilot_authorization_grants',
       'UPDATE'
     ) or pg_catalog.has_table_privilege(
       'service_role',
       'fundae_private.transactional_graph_pilot_authorization_grants',
       'DELETE'
     ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_pilot_grant_acl_invalid';
  end if;

  if pg_catalog.has_function_privilege(
       'service_role',
       'fundae_private.register_transactional_graph_pilot_grant(text,text,text,text,text[],integer,timestamptz,text)',
       'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'service_role',
       'fundae_private.enforce_transactional_graph_pilot_deadline()',
       'EXECUTE'
     ) or pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
       'public.preview_transactional_graph_pilot(text,text,text,text[],integer)'
     )), 'required_authorization_hash') > 0 or
     pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
       'public.preview_transactional_graph_pilot(text,text,text,text[],integer)'
     )), '''authorization_required'', true') = 0 or
     pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
       'public.start_transactional_graph_pilot(text,text,text,text[],text,integer)'
     )), 'consumed_at is null and revoked_at is null') = 0 or
     pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
       'public.start_transactional_graph_pilot(text,text,text,text[],text,integer)'
     )), 'for update') = 0 then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_pilot_grant_contract_invalid';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname = 'fundae-transactional-graph-pilot-watchdog'
      and schedule = '* * * * *'
      and active
      and command =
        'select fundae_private.enforce_transactional_graph_pilot_deadline();'
  ) then
    raise exception using errcode = '55000',
      message = 'fundae_release_postcheck_pilot_watchdog_missing';
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

  if exists (
    select 1 from public.cold_campaign_provision_manifests m
    where m.status = 'prepared_off' and (
      (select pg_catalog.count(*) from public.campaign_contacts c
       where c.campaign_id=m.campaign_id and c.conditional_delivery) <> 104
      or exists (
        select 1
        from public.campaign_contacts child
        left join public.campaign_contacts parent
          on parent.campaign_id=child.campaign_id
         and parent.external_contact_id=child.parent_external_contact_id
        where child.campaign_id=m.campaign_id and (
          (child.conditional_delivery and (
            child.parent_external_contact_id is null or parent.id is null or
            parent.id=child.id or parent.conditional_delivery or
            parent.variant<>child.variant
          )) or
          (not child.conditional_delivery and child.parent_external_contact_id is not null)
        )
      )
    )
  ) then
    raise exception using errcode = '23514',
      message = 'fundae_release_postcheck_conditional_graph_invalid';
  end if;

  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
       'public.claim_cold_campaign_dispatch(uuid,text,integer)'
     )), 'claim_cold_campaign_dispatch_pre_conditional_20260819') = 0 or
     pg_catalog.strpos(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
       'public.authorize_graph_draft_send(uuid,text,text,text)'
     )), 'authorize_graph_draft_send_pre_conditional_20260819') = 0 or
     pg_catalog.has_function_privilege(
       'service_role',
       'public.claim_cold_campaign_dispatch_pre_conditional_20260819(uuid,text,integer)',
       'EXECUTE'
     ) or
     pg_catalog.has_function_privilege(
       'service_role',
       'public.authorize_graph_draft_send_pre_conditional_20260819(uuid,text,text,text)',
       'EXECUTE'
     ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_conditional_rpc_contract_invalid';
  end if;

  if exists (
    select 1 from public.campaign_contacts c
    join public.campaigns campaign on campaign.id=c.campaign_id
    where campaign.external_id='FUNDAE_2026_EMAIL_V1'
      and c.contact_data->>'email' is not null
      and not fundae_private.is_cold_campaign_hmac_identity(
        c.contact_data->>'email',c.email_hash
      )
  ) then
    raise exception using errcode = '23514',
      message = 'fundae_release_postcheck_legacy_or_invalid_identity_hash';
  end if;

  if exists (
    select 1
    from unnest(array[
      'cold_dispatch_reservation_fk_idx',
      'cold_provision_manifest_campaign_fk_idx',
      'cold_scheduler_alert_dispatch_fk_idx',
      'events_campaign_fk_idx',
      'graph_outbox_mailbox_reservation_fk_idx',
      'inbound_ledger_contact_fk_idx',
      'inbound_ledger_campaign_fk_idx',
      'mailbox_state_active_reservation_fk_idx',
      'mailbox_state_blocked_reservation_fk_idx',
      'operational_alert_receipts_dedupe_fk_idx'
      ,'graph_outbox_pkey'
      ,'graph_outbox_mailbox_draft_immutable_idx'
      ,'transactional_graph_pilot_one_active_idx'
      ,'transactional_dispatch_pilot_run_idx'
      ,'campaign_revenue_pipeline_contact_idx'
    ]) as expected(index_name)
    where coalesce(
      pg_catalog.to_regclass('public.' || expected.index_name),
      pg_catalog.to_regclass('fundae_private.' || expected.index_name)
    ) is null
  ) then
    raise exception using errcode = '23514',
      message = 'fundae_release_postcheck_fk_index_missing';
  end if;

  if pg_catalog.has_table_privilege(
       'service_role','public.hubspot_sync_outbox','SELECT'
     ) or pg_catalog.has_table_privilege(
       'service_role','public.hubspot_sync_outbox','INSERT'
     ) or pg_catalog.has_table_privilege(
       'service_role','public.hubspot_sync_outbox','UPDATE'
     ) or pg_catalog.has_table_privilege(
       'service_role','public.hubspot_sync_outbox','DELETE'
     ) or not exists (
       select 1 from pg_catalog.pg_trigger t
       where t.tgrelid='public.campaign_contacts'::regclass
         and not t.tgisinternal
         and t.tgname in (
           'campaign_contacts_enqueue_hubspot_insert',
           'campaign_contacts_enqueue_hubspot_state'
         )
       group by t.tgrelid having pg_catalog.count(*)=2
     ) then
    raise exception using errcode = '42501',
      message = 'fundae_release_postcheck_hubspot_outbox_contract_invalid';
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
