-- Rollback-only, PII-free SQL smoke for the exact four-resource Graph pilot scope.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '10min';
set local idle_in_transaction_session_timeout = '10min';

do $$
declare
  v_actor text := pg_catalog.repeat('a', 64);
  v_lead_id text := pg_catalog.repeat('b', 64);
  v_run_id text := 'FUNDAE_PILOT_SMOKE_20260819';
  v_resources text[] := array['calculator','interactive_checklist','checklist','webinar'];
  v_submission_ids text[] := array[]::text[];
  v_resource text;
  v_submission_id text;
  v_preview jsonb;
  v_grant jsonb;
  v_start jsonb;
  v_ledger jsonb;
  v_claim jsonb;
  v_halt jsonb;
  v_watchdog jsonb;
  v_authorization_id text := '018f1e20-7b5d-7d20-8c3a-4b5c6d7e8f91';
  v_authorization_hash text;
  v_approval_evidence text := pg_catalog.repeat('e', 64);
  v_worker_one uuid := extensions.gen_random_uuid();
  v_worker_two uuid := extensions.gen_random_uuid();
  v_outside_submission text := 'FUNDAE_PILOT_SMOKE_OUTSIDE_20260819';
  v_raw_id text;
begin
  if not exists (
    select 1 from public.outbound_delivery_control
    where singleton and not master_enabled and not transactional_enabled and not cold_enabled
  ) then
    raise exception using errcode = '55000', message = 'pilot_smoke_requires_outbound_off';
  end if;

  foreach v_resource in array v_resources loop
    v_submission_id := 'FUNDAE_PILOT_SMOKE_' || v_resource || '_20260819';
    v_submission_ids := pg_catalog.array_append(v_submission_ids, v_submission_id);
    insert into public.leads(
      lead_id, form_type, lead_magnet, payload, submission_id,
      delivery_status, email_delivery_status, accepted_by_make_at, ai_summary
    ) values (
      v_lead_id, v_resource, v_resource,
      pg_catalog.jsonb_build_object(
        'lead_id', v_lead_id, 'submission_id', v_submission_id,
        'form_type', v_resource, 'lead_magnet', v_resource,
        'consent', pg_catalog.jsonb_build_object('privacy_accepted', true)
      ),
      v_submission_id, 'dead_letter', 'pending', null, null
    );
  end loop;

  v_preview := public.preview_transactional_graph_pilot(
    v_run_id, v_actor, v_lead_id, v_submission_ids, 120
  );
  if v_preview ->> 'reason_code' <> 'pilot_ready' or
     not (v_preview ->> 'accepted')::boolean or
     v_preview #>> '{controls,master_enabled}' <> 'false' or
     v_preview #>> '{controls,transactional_enabled}' <> 'false' or
     v_preview #>> '{controls,cold_enabled}' <> 'false' or
     v_preview ->> 'authorization_required' <> 'true' or
     v_preview ? 'required_authorization_hash' then
    raise exception using errcode = '55000', message = 'pilot_preview_failed';
  end if;
  if exists (select 1 from public.transactional_graph_pilot_runs where run_id = v_run_id) or
     exists (select 1 from public.transactional_dispatch_outbox
       where submission_id = any(v_submission_ids) and pilot_run_id is not null) then
    raise exception using errcode = '55000', message = 'pilot_preview_mutated_state';
  end if;

  v_authorization_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'fundae-transactional-graph-pilot-authorization:v1:' || v_authorization_id,
    'UTF8'
  ), 'sha256'), 'hex');
  v_grant := fundae_private.register_transactional_graph_pilot_grant(
    v_run_id, v_actor, v_authorization_hash, v_lead_id, v_submission_ids, 120,
    pg_catalog.clock_timestamp() + interval '5 minutes', v_approval_evidence
  );
  if v_grant ->> 'reason_code' <> 'pilot_grant_registered' or
     not (v_grant ->> 'accepted')::boolean or
     v_grant ? 'authorization_id' then
    raise exception using errcode = '55000', message = 'pilot_grant_registration_failed';
  end if;

  v_start := public.start_transactional_graph_pilot(
    v_run_id, v_actor, v_lead_id, v_submission_ids, pg_catalog.repeat('f', 64), 120
  );
  if v_start ->> 'reason_code' <> 'authorization_unavailable' or
     exists (select 1 from public.transactional_graph_pilot_runs where run_id = v_run_id) or
     exists (
       select 1 from fundae_private.transactional_graph_pilot_authorization_grants
       where authorized_run_id = v_run_id and consumed_at is not null
     ) or exists (
       select 1 from public.outbound_delivery_control
       where singleton and (master_enabled or transactional_enabled or cold_enabled)
     ) then
    raise exception using errcode = '55000', message = 'pilot_wrong_grant_not_fail_closed';
  end if;

  v_start := public.start_transactional_graph_pilot(
    v_run_id, v_actor, v_lead_id, v_submission_ids,
    v_authorization_hash, 120
  );
  if v_start ->> 'reason_code' <> 'pilot_started' or
     not (v_start ->> 'accepted')::boolean or
     v_start #>> '{controls,master_enabled}' <> 'true' or
     v_start #>> '{controls,transactional_enabled}' <> 'true' or
     v_start #>> '{controls,cold_enabled}' <> 'false' or
     (select pg_catalog.count(*) from public.transactional_dispatch_outbox
       where pilot_run_id = v_run_id) <> 4 or
     not exists (
       select 1 from fundae_private.transactional_graph_pilot_authorization_grants
       where authorized_run_id = v_run_id and consumed_run_id = v_run_id
         and consumed_at is not null and approval_evidence_hash = v_approval_evidence
     ) then
    raise exception using errcode = '55000', message = 'pilot_start_failed';
  end if;

  v_ledger := public.read_transactional_graph_pilot_ledger(v_run_id, v_actor);
  if v_ledger ->> 'reason_code' <> 'pilot_ledger_read' or
     not (v_ledger ->> 'accepted')::boolean or
     pg_catalog.jsonb_array_length(v_ledger -> 'rows') <> 4 or
     v_ledger::text like '%' || v_lead_id || '%' or
     exists (select 1 from pg_catalog.unnest(v_submission_ids) x
       where pg_catalog.strpos(v_ledger::text, x) > 0) then
    raise exception using errcode = '55000', message = 'pilot_ledger_redaction_failed';
  end if;
  for v_raw_id in select id::text from public.transactional_dispatch_outbox
    where pilot_run_id = v_run_id loop
    if pg_catalog.strpos(v_ledger::text, v_raw_id) > 0 then
      raise exception using errcode = '55000', message = 'pilot_ledger_raw_id_exposed';
    end if;
  end loop;
  if (public.read_transactional_graph_pilot_ledger(
      v_run_id, pg_catalog.repeat('c', 64)
    ) ->> 'reason_code') <> 'pilot_ledger_unavailable' then
    raise exception using errcode = '55000', message = 'pilot_ledger_actor_bypass';
  end if;

  v_claim := public.claim_transactional_graph_dispatch(v_worker_one, 1, 60);
  if v_claim ->> 'reason_code' <> 'claimed' or
     (v_claim ->> 'claimed')::integer <> 1 or
     v_claim ->> 'pilot_run_id' <> v_run_id or
     not ((v_claim #>> '{items,0,submission_id}') = any(v_submission_ids)) then
    raise exception using errcode = '55000', message = 'pilot_scoped_claim_failed';
  end if;

  update public.transactional_dispatch_outbox
  set status = 'claimed', claimed_by = extensions.gen_random_uuid(),
      claim_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes'
  where pilot_run_id = v_run_id;
  insert into public.leads(
    lead_id, form_type, lead_magnet, payload, submission_id,
    delivery_status, email_delivery_status, accepted_by_make_at, ai_summary
  ) values (
    pg_catalog.repeat('d', 64), 'calculator', 'calculator',
    pg_catalog.jsonb_build_object(
      'lead_id', pg_catalog.repeat('d', 64), 'submission_id', v_outside_submission,
      'form_type', 'calculator', 'lead_magnet', 'calculator'
    ),
    v_outside_submission, 'dead_letter', 'pending', null, null
  );
  v_claim := public.claim_transactional_graph_dispatch(v_worker_two, 1, 60);
  if v_claim ->> 'reason_code' <> 'pilot_scope_violation' or
     (v_claim ->> 'accepted')::boolean or
     not exists (select 1 from public.transactional_dispatch_outbox
       where submission_id = v_outside_submission and status = 'queued_off'
         and claimed_by is null and pilot_run_id is null) or
     not exists (select 1 from public.transactional_graph_pilot_runs
       where run_id = v_run_id and status = 'halted') or
     not exists (select 1 from public.outbound_delivery_control
       where singleton and not master_enabled and not transactional_enabled and not cold_enabled) then
    raise exception using errcode = '55000', message = 'pilot_scope_escape_not_halted';
  end if;

  v_halt := public.emergency_halt_outbound_delivery(
    v_actor, 'TRANSACTIONAL_GRAPH_PILOT_SMOKE_COMPLETE'
  );
  if not (v_halt ->> 'accepted')::boolean or
     v_halt #>> '{controls,master_enabled}' <> 'false' or
     v_halt #>> '{controls,transactional_enabled}' <> 'false' or
     v_halt #>> '{controls,cold_enabled}' <> 'false' then
    raise exception using errcode = '55000', message = 'pilot_emergency_halt_failed';
  end if;

  update public.transactional_graph_pilot_runs
  set status = 'active', expires_at = pg_catalog.clock_timestamp() - interval '1 second',
      finished_at = null, finish_evidence_hash = null,
      updated_at = pg_catalog.clock_timestamp()
  where run_id = v_run_id;
  update public.outbound_delivery_control
  set master_enabled = true, transactional_enabled = true, cold_enabled = false,
      halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_ACTIVE',
      updated_at = pg_catalog.clock_timestamp()
  where singleton;
  v_watchdog := fundae_private.enforce_transactional_graph_pilot_deadline();
  if v_watchdog ->> 'reason_code' <> 'pilot_scope_expired' or
     v_watchdog ->> 'outbound_off' <> 'true' or
     not exists (
       select 1 from public.transactional_graph_pilot_runs
       where run_id = v_run_id and status = 'expired'
     ) or exists (
       select 1 from public.outbound_delivery_control
       where singleton and (master_enabled or transactional_enabled or cold_enabled)
     ) then
    raise exception using errcode = '55000', message = 'pilot_watchdog_failed';
  end if;
end;
$$;

select 'fundae_release_transactional_graph_pilot_smoke_ok' as result;
rollback;
