-- Rollback-only, synthetic and PII-free smoke for Data Brain Intelligence v2.
-- This gate must observe every outbound switch OFF and never changes those controls.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';
set local idle_in_transaction_session_timeout = '5min';

do $$
declare
  v_suffix text := pg_catalog.replace(extensions.gen_random_uuid()::text, '-', '');
  v_actor text := pg_catalog.repeat('a', 64);
  v_campaign uuid;
  v_contact uuid;
  v_execution uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_result jsonb;
  v_series jsonb;
begin
  if not exists (
    select 1 from public.outbound_delivery_control
    where singleton and not master_enabled and not transactional_enabled
      and not cold_enabled and not hubspot_enabled
  ) or not exists (
    select 1 from public.cold_campaign_provision_control
    where singleton and not enabled
  ) then
    raise exception using errcode = '55000',
      message = 'fundae_release_intelligence_v2_smoke_requires_all_switches_off';
  end if;

  insert into public.dashboard_principals(actor_hash, role, granted_by_hash)
  values (v_actor, 'operator', v_actor)
  on conflict (actor_hash) do update set role = 'operator', is_active = true,
    revoked_at = null, updated_at = pg_catalog.clock_timestamp();

  insert into public.campaigns(name, external_id, is_active, status)
  values (
    'Intelligence v2 smoke',
    'INTELLIGENCE_V2_SMOKE_' || v_suffix,
    false,
    'draft'
  ) returning id into v_campaign;

  insert into public.campaign_contacts(
    campaign_id, external_contact_id, external_account_id, email_hash,
    contact_data, variant, magnet, lot, company_size
  ) values (
    v_campaign,
    'contact_' || v_suffix,
    'account_' || v_suffix,
    pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to('intelligence-v2-smoke:' || v_suffix, 'UTF8'),
      'sha256'
    ), 'hex'),
    '{}'::jsonb,
    'Checklist',
    'Checklist',
    'A',
    '11-50'
  ) returning id into v_contact;

  insert into public.campaign_executions(
    campaign_id, campaign_contact_id, idempotency_key, channel,
    capture_method, action_name, step, status, scheduled_for,
    planned_at, actual_at, metadata
  ) values (
    v_campaign,
    v_contact,
    'intelligence_v2_' || v_suffix,
    'email',
    'manual',
    'delivery_sent',
    1,
    'executed',
    v_now - interval '2 hours',
    v_now - interval '2 hours',
    v_now - interval '2 hours',
    '{}'::jsonb
  ) returning id into v_execution;

  insert into public.campaign_events(
    campaign_id, campaign_contact_id, execution_id, source_event_id,
    event_name, occurred_at, channel, capture_method, metric_quality,
    context, properties
  ) values
    (v_campaign, v_contact, v_execution, 'click_' || v_suffix,
      'link_clicked', v_now - interval '90 minutes', 'email', 'manual',
      'confirmed', '{}'::jsonb, '{}'::jsonb),
    (v_campaign, v_contact, v_execution, 'reply_' || v_suffix,
      'reply_received', v_now - interval '80 minutes', 'email', 'manual',
      'confirmed', '{}'::jsonb, '{}'::jsonb),
    (v_campaign, v_contact, v_execution, 'meeting_' || v_suffix,
      'meeting_booked', v_now - interval '70 minutes', 'email', 'manual',
      'confirmed', '{}'::jsonb, '{}'::jsonb),
    (v_campaign, v_contact, v_execution, 'opportunity_' || v_suffix,
      'opportunity_created', v_now - interval '60 minutes', 'email', 'manual',
      'confirmed', '{}'::jsonb, '{}'::jsonb);

  v_result := public.dashboard_upsert_revenue_pipeline(
    v_actor, 'INTELLIGENCE_V2_PIPELINE_CREATE_' || v_suffix,
    v_campaign, v_contact, 'opportunity', 1200, null, 70,
    current_date + 14, null, v_execution, 'checklist', 0
  );
  if v_result ->> 'stage' <> 'opportunity' or
     (v_result ->> 'version')::bigint <> 1 or
     coalesce((v_result ->> 'pii_included')::boolean, true) then
    raise exception using errcode = '23514',
      message = 'fundae_release_intelligence_v2_smoke_pipeline_create_failed';
  end if;

  v_result := public.dashboard_upsert_revenue_pipeline(
    v_actor, 'INTELLIGENCE_V2_PIPELINE_WIN_' || v_suffix,
    v_campaign, v_contact, 'won', 1200, 1200, 100,
    current_date, 'closed_won', v_execution, 'checklist', 1
  );
  if v_result ->> 'stage' <> 'won' or
     (v_result ->> 'version')::bigint <> 2 or
     (v_result ->> 'closed_amount')::numeric <> 1200 then
    raise exception using errcode = '23514',
      message = 'fundae_release_intelligence_v2_smoke_pipeline_version_failed';
  end if;

  begin
    perform public.dashboard_upsert_revenue_pipeline(
      v_actor, 'INTELLIGENCE_V2_PIPELINE_STALE_' || v_suffix,
      v_campaign, v_contact, 'won', 1200, 1200, 100,
      current_date, 'closed_won', v_execution, 'checklist', 1
    );
    raise exception using errcode = '23514',
      message = 'fundae_release_intelligence_v2_smoke_stale_version_accepted';
  exception
    when sqlstate '40001' then
      if sqlerrm <> 'dashboard_pipeline_version_conflict' then
        raise;
      end if;
  end;

  v_result := public.dashboard_get_intelligence_v2(
    v_actor, 'INTELLIGENCE_V2_READ_' || v_suffix,
    v_now - interval '1 day', v_now + interval '1 minute',
    v_campaign, '{}'::jsonb
  );

  select pg_catalog.jsonb_build_object(
    'sent', coalesce(sum((item ->> 'sent')::bigint), 0),
    'clicked', coalesce(sum((item ->> 'clicked')::bigint), 0),
    'replied', coalesce(sum((item ->> 'replied')::bigint), 0),
    'meetings', coalesce(sum((item ->> 'meetings')::bigint), 0),
    'opportunities', coalesce(sum((item ->> 'opportunities')::bigint), 0),
    'closed_amount', coalesce(sum((item ->> 'closed_amount')::numeric), 0)
  ) into v_series
  from pg_catalog.jsonb_array_elements(v_result -> 'time_series') item;

  if pg_catalog.jsonb_typeof(v_result) <> 'object' or
     coalesce((v_result #>> '{meta,pii_included}')::boolean, true) or
     (v_result #>> '{pipeline,totals,records}')::bigint <> 1 or
     (v_result #>> '{pipeline,totals,closed_amount}')::numeric <> 1200 or
     (v_result #>> '{pipeline,totals,avg_days_email_to_sale}')::numeric <= 0 or
     pg_catalog.jsonb_array_length(v_result #> '{pipeline,by_source}') <> 1 or
     pg_catalog.jsonb_array_length(v_result -> 'by_copy') <> 1 or
     pg_catalog.jsonb_array_length(v_result -> 'by_campaign') <> 1 or
     pg_catalog.jsonb_array_length(v_result -> 'high_intent_contacts') <> 1 or
     (v_result #>> '{by_email,0,avg_hours_to_first_meeting}')::numeric <= 0 or
     v_series is null or
     (v_series ->> 'sent')::bigint <> 1 or
     (v_series ->> 'clicked')::bigint <> 1 or
     (v_series ->> 'replied')::bigint <> 1 or
     (v_series ->> 'meetings')::bigint <> 1 or
     (v_series ->> 'opportunities')::bigint <> 1 or
     (v_series ->> 'closed_amount')::numeric <> 1200 then
    raise exception using errcode = '23514',
      message = 'fundae_release_intelligence_v2_smoke_read_contract_failed';
  end if;

  if exists (
    select 1 from public.outbound_delivery_control
    where singleton and (
      master_enabled or transactional_enabled or cold_enabled or hubspot_enabled
    )
  ) or exists (
    select 1 from public.cold_campaign_provision_control
    where singleton and enabled
  ) then
    raise exception using errcode = '55000',
      message = 'fundae_release_intelligence_v2_smoke_changed_outbound_state';
  end if;
end;
$$;

select 'fundae_release_intelligence_v2_smoke_ok' as result;

rollback;
