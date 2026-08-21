-- PII-free campaign analysis for Data Brain. Read-only and service-role gated.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create or replace function public.dashboard_get_campaign_insights(
  p_actor_hash text, p_request_id text,
  p_from timestamptz, p_to timestamptz, p_campaign_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if p_request_id is null or
     p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$' or
     p_from is null or p_to is null or p_from >= p_to or
     p_to > v_now + interval '5 minutes' or
     p_to - p_from > interval '366 days' then
    raise exception using errcode = '22023', message = 'dashboard_invalid_window';
  end if;

  v_role := public.dashboard_require_role(
    p_actor_hash, array['admin', 'operator', 'auditor', 'read_only']
  );

  insert into public.dashboard_audit_log(
    request_id, actor_hash, actor_role, action, scope
  ) values (
    p_request_id, p_actor_hash, v_role, 'summary_read',
    jsonb_build_object('from', p_from, 'to', p_to, 'campaign_insights', true,
      'campaign_scoped', p_campaign_id is not null)
  ) on conflict (request_id, action) do nothing;

  with
  contact_base as materialized (
    select id, variant, magnet, reply_type, resource_started_at,
      resource_completed_at, meeting_booked_at, meeting_completed_at,
      opportunity_created_at, suppression_scope
    from public.campaign_contacts
    where created_at >= p_from and created_at < p_to
      and (p_campaign_id is null or campaign_id = p_campaign_id)
  ),
  execution_base as materialized (
    select id, campaign_contact_id, step, status, actual_at
    from public.campaign_executions
    where created_at >= p_from and created_at < p_to
      and channel = 'email'
      and (p_campaign_id is null or campaign_id = p_campaign_id)
  ),
  event_base as materialized (
    select ce.event_name, ce.occurred_at, ce.execution_id,
      ce.campaign_contact_id, ex.step
    from public.campaign_events ce
    left join public.campaign_executions ex on ex.id = ce.execution_id
    where ce.occurred_at >= p_from and ce.occurred_at < p_to
      and (p_campaign_id is null or ce.campaign_id = p_campaign_id)
  ),
  step_metrics as (
    select step,
      count(*) filter (where status = 'planned') planned,
      count(*) filter (where status = 'executed') sent,
      count(*) filter (where status = 'failed') failed
    from execution_base where step between 1 and 5 group by step
  ),
  event_step_metrics as (
    select step,
      count(*) filter (where event_name = 'email_opened') opened_directional,
      count(*) filter (where event_name = 'link_clicked') clicked,
      count(*) filter (where event_name in ('reply_received', 'positive_reply')) replied
    from event_base where step between 1 and 5 group by step
  )
  select jsonb_build_object(
    'by_variant', coalesce((select jsonb_object_agg(k, n) from (
      select coalesce(variant, 'unknown') k, count(*) n from contact_base group by 1
    ) grouped), '{}'::jsonb),
    'performance_by_email', coalesce((select jsonb_object_agg(metric, amount) from (
      select 'email_' || step || '_planned' metric, planned amount from step_metrics
      union all select 'email_' || step || '_sent', sent from step_metrics
      union all select 'email_' || step || '_failed', failed from step_metrics
      union all select 'email_' || step || '_opened_directional', opened_directional from event_step_metrics
      union all select 'email_' || step || '_clicked', clicked from event_step_metrics
      union all select 'email_' || step || '_replied', replied from event_step_metrics
    ) metrics), '{}'::jsonb),
    'events_by_hour', coalesce((select jsonb_object_agg(k, n) from (
      select lpad(extract(hour from timezone('Europe/Madrid', occurred_at))::integer::text, 2, '0') || ':00' k,
        count(*) n from event_base group by 1 order by 1
    ) grouped), '{}'::jsonb),
    'engagement_by_action', coalesce((select jsonb_object_agg(k, n) from (
      select event_name k, count(*) n from event_base
      where event_name in ('landing_visit','link_clicked','resource_started','resource_completed',
        'tool_started','tool_completed','checklist_downloaded','pdf_downloaded',
        'calculator_completed','webinar_registered','review_submitted')
      group by event_name
    ) grouped), '{}'::jsonb),
    'conversions', jsonb_build_object(
      'resource_started', (select count(*) from contact_base where resource_started_at is not null),
      'resource_completed', (select count(*) from contact_base where resource_completed_at is not null),
      'human_replies', (select count(*) from contact_base where reply_type is not null),
      'meetings_booked', (select count(*) from contact_base where meeting_booked_at is not null),
      'meetings_completed', (select count(*) from contact_base where meeting_completed_at is not null),
      'opportunities', (select count(*) from contact_base where opportunity_created_at is not null),
      'suppressed', (select count(*) from contact_base where suppression_scope <> 'none')
    ),
    'metric_contract', jsonb_build_object(
      'timezone', 'Europe/Madrid', 'opens_quality', 'directional',
      'confirmed_actions', jsonb_build_array('click','download','reply','meeting','opportunity'),
      'pii_included', false
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.dashboard_get_campaign_insights(
  text, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.dashboard_get_campaign_insights(
  text, text, timestamptz, timestamptz, uuid
) to service_role;

commit;
