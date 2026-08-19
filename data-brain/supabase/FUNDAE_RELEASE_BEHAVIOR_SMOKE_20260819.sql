-- Synthetic, PII-free, rollback-only behavior smoke.
-- It never enables outbound, calls Graph/Make/HubSpot, or deletes journey data.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '10min';
set local idle_in_transaction_session_timeout = '10min';

do $$
declare
  v_actor text := pg_catalog.repeat('a', 64);
  v_claim_hash text := pg_catalog.repeat('b', 64);
  v_alert_key text := pg_catalog.repeat('c', 64);
  v_eval_key text := pg_catalog.repeat('d', 64);
  v_result jsonb;
  v_claim_token uuid;
  v_cursor_hash text;
begin
  if not exists (
    select 1 from public.outbound_delivery_control
    where singleton and not master_enabled and not transactional_enabled and not cold_enabled
  ) then
    raise exception using errcode = '55000', message = 'smoke_requires_outbound_off';
  end if;

  insert into public.dashboard_principals(actor_hash, role, granted_by_hash)
  values (v_actor, 'auditor', v_actor)
  on conflict (actor_hash) do update set role = 'auditor', is_active = true,
    revoked_at = null, updated_at = pg_catalog.clock_timestamp();

  v_result := public.dashboard_get_summary(
    v_actor, 'STAGING_SMOKE_SUMMARY_20260819',
    pg_catalog.clock_timestamp() - interval '1 day',
    pg_catalog.clock_timestamp(), null
  );
  if pg_catalog.jsonb_typeof(v_result) <> 'object' then
    raise exception using errcode = '23514', message = 'dashboard_smoke_failed';
  end if;

  v_result := public.record_operational_heartbeat(
    'dashboard', 'healthy', pg_catalog.clock_timestamp(),
    pg_catalog.jsonb_build_object('smoke', true)
  );
  if not coalesce((v_result->>'accepted')::boolean, false) then
    raise exception using errcode = '23514', message = 'heartbeat_smoke_failed';
  end if;

  v_result := public.reconcile_operational_alerts(
    v_eval_key, pg_catalog.clock_timestamp(), v_actor,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'dedupe_key', v_alert_key, 'signal_code', 'dashboard',
      'severity', 'warning', 'summary_code', 'STAGING_SMOKE',
      'metrics', '{}'::jsonb
    )), array['dashboard']::text[]
  );
  if not coalesce((v_result->>'accepted')::boolean, false) then
    raise exception using errcode = '23514', message = 'alert_reconcile_smoke_failed';
  end if;

  v_result := public.transition_operational_alert(v_alert_key, 'acknowledged', v_actor, '{}'::jsonb);
  if not coalesce((v_result->>'accepted')::boolean, false) then
    raise exception using errcode = '23514', message = 'alert_transition_smoke_failed';
  end if;

  v_result := public.claim_inbound_event(
    'microsoft_graph', v_claim_hash, 'reply_received', '{}'::jsonb, 60
  );
  if not coalesce((v_result->>'accepted')::boolean, false) then
    raise exception using errcode = '23514', message = 'inbound_claim_smoke_failed';
  end if;
  v_claim_token := (v_result->>'claimToken')::uuid;
  v_result := public.finalize_inbound_event(
    'microsoft_graph', v_claim_hash, v_claim_token,
    'manual_review', null, null, 'staging_smoke'
  );
  if not coalesce((v_result->>'accepted')::boolean, false) then
    raise exception using errcode = '23514', message = 'inbound_finalize_smoke_failed';
  end if;
  v_result := public.claim_inbound_event(
    'microsoft_graph', v_claim_hash, 'reply_received', '{}'::jsonb, 60
  );
  if not coalesce((v_result->>'duplicate')::boolean, false) then
    raise exception using errcode = '23514', message = 'inbound_replay_smoke_failed';
  end if;

  v_result := public.advance_inbound_cursor(
    'microsoft_graph.smoke', null, 'staging-smoke-cursor-0001'
  );
  v_cursor_hash := v_result->>'cursor_hash';
  v_result := public.advance_inbound_cursor(
    'microsoft_graph.smoke', v_cursor_hash, 'staging-smoke-cursor-0002'
  );
  if not coalesce((v_result->>'accepted')::boolean, false) then
    raise exception using errcode = '23514', message = 'inbound_cursor_cas_smoke_failed';
  end if;

  v_result := public.purge_expired_journey_events(
    pg_catalog.clock_timestamp() - interval '100 days', 10, false
  );
  if v_result->>'reason_code' <> 'dry_run' or (v_result->>'deleted_count')::integer <> 0 then
    raise exception using errcode = '23514', message = 'journey_dry_run_smoke_failed';
  end if;
  v_result := public.purge_expired_journey_events(
    pg_catalog.clock_timestamp() - interval '100 days', 10, true
  );
  if v_result->>'reason_code' <> 'purge_disabled' or (v_result->>'deleted_count')::integer <> 0 then
    raise exception using errcode = '23514', message = 'journey_kill_switch_smoke_failed';
  end if;

  v_result := public.claim_cold_campaign_dispatch(
    extensions.gen_random_uuid(), pg_catalog.repeat('w', 43), 60
  );
  if coalesce((v_result->>'accepted')::boolean, false) then
    raise exception using errcode = '23514', message = 'cold_claim_authorized_while_off';
  end if;

  v_result := public.authorize_graph_draft_send(
    extensions.gen_random_uuid(), pg_catalog.repeat('e',64),
    pg_catalog.repeat('f',64), pg_catalog.repeat('1',64)
  );
  if coalesce((v_result->>'authorized')::boolean, false) then
    raise exception using errcode = '23514', message = 'graph_send_authorized_while_off';
  end if;

  begin
    perform public.apply_cold_campaign_provision_batch(
      pg_catalog.repeat('2',64), pg_catalog.repeat('3',64), 0, 1,
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        pg_catalog.repeat('6',64), 'UTF8'
      ), 'sha256'), 'hex'),
      v_actor, pg_catalog.repeat('5',64), 'FUNDAE_STAGING_SMOKE',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'row_sha256', pg_catalog.repeat('6',64)
      ))
    );
    raise exception using errcode = '23514', message = 'provisioning_accepted_while_closed';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select
  'fundae_release_behavior_smoke_ok' as result,
  not (select master_enabled or transactional_enabled or cold_enabled
       from public.outbound_delivery_control where singleton) as outbound_remained_off,
  not (select purge_enabled from public.journey_retention_control where singleton) as purge_remained_off,
  not (select enabled from public.cold_campaign_provision_control where singleton) as provisioning_remained_off;

rollback;
