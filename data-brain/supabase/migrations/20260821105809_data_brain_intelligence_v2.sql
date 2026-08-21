-- Data Brain Intelligence v2: attributed analytics and internal revenue pipeline.
-- Additive, PII-free at RPC boundaries and unable to enable outbound delivery.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.dashboard_audit_log
  drop constraint if exists dashboard_audit_log_action_check;
alter table public.dashboard_audit_log
  add constraint dashboard_audit_log_action_check check (action in (
    'summary_read', 'sample_read', 'audit_read', 'export_requested',
    'intelligence_read', 'pipeline_write'
  ));

create schema if not exists fundae_private;

create table fundae_private.campaign_revenue_pipeline (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  campaign_contact_id uuid not null references public.campaign_contacts(id) on delete cascade,
  contact_ref text not null check (contact_ref ~ '^[a-f0-9]{64}$'),
  stage text not null check (stage in (
    'interested', 'qualified', 'meeting', 'opportunity', 'won', 'lost'
  )),
  estimated_amount numeric(14,2) not null default 0 check (estimated_amount >= 0),
  closed_amount numeric(14,2) check (closed_amount is null or closed_amount >= 0),
  probability_percent numeric(5,2) not null default 0
    check (probability_percent between 0 and 100),
  expected_close_on date,
  outcome_reason text check (
    outcome_reason is null or outcome_reason ~ '^[A-Za-z0-9_.:-]{2,64}$'
  ),
  source_execution_id uuid references public.campaign_executions(id) on delete set null,
  source_email_step integer check (source_email_step is null or source_email_step between 1 and 5),
  source_copy_key text check (
    source_copy_key is null or source_copy_key ~ '^[A-Za-z0-9_.:-]{2,64}$'
  ),
  source_variant text check (
    source_variant is null or source_variant ~ '^[A-Za-z0-9_.:-]{1,64}$'
  ),
  source_lot text check (
    source_lot is null or source_lot ~ '^[A-Za-z0-9_.:-]{1,64}$'
  ),
  source_hour smallint check (source_hour is null or source_hour between 0 and 23),
  source_tool text check (
    source_tool is null or source_tool ~ '^[A-Za-z0-9_.:-]{1,64}$'
  ),
  stage_changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  closed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_by_hash text not null check (created_by_hash ~ '^[a-f0-9]{64}$'),
  updated_by_hash text not null check (updated_by_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint campaign_revenue_pipeline_contact_key unique (campaign_id, campaign_contact_id),
  constraint campaign_revenue_pipeline_contact_ref_key unique (campaign_id, contact_ref),
  constraint campaign_revenue_pipeline_closed_state check (
    (stage in ('won', 'lost') and closed_at is not null) or
    (stage not in ('won', 'lost') and closed_at is null)
  ),
  constraint campaign_revenue_pipeline_closed_amount check (
    stage = 'won' or closed_amount is null
  )
);

create index campaign_revenue_pipeline_stage_idx
  on fundae_private.campaign_revenue_pipeline (campaign_id, stage, updated_at desc);
create index campaign_revenue_pipeline_expected_close_idx
  on fundae_private.campaign_revenue_pipeline (campaign_id, expected_close_on)
  where expected_close_on is not null and stage not in ('won', 'lost');
create index campaign_revenue_pipeline_source_execution_idx
  on fundae_private.campaign_revenue_pipeline (source_execution_id)
  where source_execution_id is not null;

alter table fundae_private.campaign_revenue_pipeline enable row level security;
alter table fundae_private.campaign_revenue_pipeline force row level security;
revoke all privileges on table fundae_private.campaign_revenue_pipeline
  from public, anon, authenticated, service_role;

create or replace function public.dashboard_upsert_revenue_pipeline(
  p_actor_hash text, p_request_id text, p_campaign_id uuid,
  p_campaign_contact_id uuid, p_stage text, p_estimated_amount numeric,
  p_closed_amount numeric, p_probability_percent numeric,
  p_expected_close_on date, p_outcome_reason text,
  p_source_execution_id uuid, p_source_tool text, p_expected_version bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_contact_ref text;
  v_contact_variant text;
  v_contact_lot text;
  v_source_step integer;
  v_source_hour smallint;
  v_source_copy_key text;
  v_existing fundae_private.campaign_revenue_pipeline%rowtype;
  v_result fundae_private.campaign_revenue_pipeline%rowtype;
  v_old_rank integer;
  v_new_rank integer;
begin
  if p_request_id is null or
     p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$' or
     p_campaign_id is null or p_campaign_contact_id is null or
     p_stage not in ('interested', 'qualified', 'meeting', 'opportunity', 'won', 'lost') or
     p_expected_version is null or p_expected_version < 0 or
     (p_estimated_amount is not null and p_estimated_amount < 0) or
     (p_closed_amount is not null and p_closed_amount < 0) or
     (p_probability_percent is not null and
       (p_probability_percent < 0 or p_probability_percent > 100)) or
     (p_outcome_reason is not null and
       p_outcome_reason !~ '^[A-Za-z0-9_.:-]{2,64}$') or
     (p_source_tool is not null and
       p_source_tool !~ '^[A-Za-z0-9_.:-]{1,64}$') or
     (p_stage = 'lost' and p_outcome_reason is null) or
     (p_stage <> 'won' and p_closed_amount is not null) then
    raise exception using errcode = '22023', message = 'dashboard_invalid_pipeline_write';
  end if;

  v_role := public.dashboard_require_role(p_actor_hash, array['admin', 'operator']);

  select
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'data-brain-contact-ref-v1:' || cc.campaign_id::text || ':' || cc.id::text,
      'UTF8'
    ), 'sha256'), 'hex'),
    cc.variant, cc.lot
  into v_contact_ref, v_contact_variant, v_contact_lot
  from public.campaign_contacts cc
  where cc.id = p_campaign_contact_id and cc.campaign_id = p_campaign_id;

  if not found then
    raise exception using errcode = '22023', message = 'dashboard_unknown_campaign_contact';
  end if;

  if p_source_execution_id is not null then
    select ce.step,
      extract(hour from pg_catalog.timezone(
        'Europe/Madrid', coalesce(ce.actual_at, ce.scheduled_for, ce.created_at)
      ))::smallint,
      'email_' || ce.step::text || ':' || v_contact_variant
    into v_source_step, v_source_hour, v_source_copy_key
    from public.campaign_executions ce
    where ce.id = p_source_execution_id and ce.campaign_id = p_campaign_id
      and ce.campaign_contact_id = p_campaign_contact_id and ce.channel = 'email';
    if not found then
      raise exception using errcode = '22023', message = 'dashboard_invalid_pipeline_source';
    end if;
  end if;

  select * into v_existing
  from fundae_private.campaign_revenue_pipeline rp
  where rp.campaign_id = p_campaign_id
    and rp.campaign_contact_id = p_campaign_contact_id
  for update;

  if not found then
    if p_expected_version <> 0 then
      raise exception using errcode = '40001', message = 'dashboard_pipeline_version_conflict';
    end if;
    insert into fundae_private.campaign_revenue_pipeline (
      campaign_id, campaign_contact_id, contact_ref, stage,
      estimated_amount, closed_amount, probability_percent, expected_close_on,
      outcome_reason, source_execution_id, source_email_step, source_copy_key,
      source_variant, source_lot, source_hour, source_tool,
      closed_at, created_by_hash, updated_by_hash
    ) values (
      p_campaign_id, p_campaign_contact_id, v_contact_ref, p_stage,
      coalesce(p_estimated_amount, 0), p_closed_amount,
      coalesce(p_probability_percent, case p_stage
        when 'interested' then 10 when 'qualified' then 25 when 'meeting' then 45
        when 'opportunity' then 70 when 'won' then 100 else 0 end),
      p_expected_close_on, p_outcome_reason, p_source_execution_id,
      v_source_step, v_source_copy_key, v_contact_variant, v_contact_lot,
      v_source_hour, p_source_tool,
      case when p_stage in ('won', 'lost') then v_now end,
      p_actor_hash, p_actor_hash
    ) returning * into v_result;
  else
    if v_existing.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'dashboard_pipeline_version_conflict';
    end if;
    if v_existing.stage in ('won', 'lost') and p_stage <> v_existing.stage then
      raise exception using errcode = '22023', message = 'dashboard_pipeline_terminal_state';
    end if;
    v_old_rank := case v_existing.stage
      when 'interested' then 1 when 'qualified' then 2 when 'meeting' then 3
      when 'opportunity' then 4 else 5 end;
    v_new_rank := case p_stage
      when 'interested' then 1 when 'qualified' then 2 when 'meeting' then 3
      when 'opportunity' then 4 else 5 end;
    if v_new_rank < v_old_rank then
      raise exception using errcode = '22023', message = 'dashboard_pipeline_stage_regression';
    end if;
    if p_stage = 'won' and v_existing.stage not in ('opportunity', 'won') then
      raise exception using errcode = '22023', message = 'dashboard_pipeline_invalid_win';
    end if;

    update fundae_private.campaign_revenue_pipeline rp set
      stage = p_stage,
      estimated_amount = coalesce(p_estimated_amount, rp.estimated_amount),
      closed_amount = case when p_stage = 'won'
        then coalesce(p_closed_amount, rp.closed_amount, p_estimated_amount, rp.estimated_amount)
        else null end,
      probability_percent = coalesce(p_probability_percent, case p_stage
        when 'interested' then 10 when 'qualified' then 25 when 'meeting' then 45
        when 'opportunity' then 70 when 'won' then 100 else 0 end),
      expected_close_on = coalesce(p_expected_close_on, rp.expected_close_on),
      outcome_reason = coalesce(p_outcome_reason, rp.outcome_reason),
      source_execution_id = coalesce(p_source_execution_id, rp.source_execution_id),
      source_email_step = coalesce(v_source_step, rp.source_email_step),
      source_copy_key = coalesce(v_source_copy_key, rp.source_copy_key),
      source_variant = coalesce(v_contact_variant, rp.source_variant),
      source_lot = coalesce(v_contact_lot, rp.source_lot),
      source_hour = coalesce(v_source_hour, rp.source_hour),
      source_tool = coalesce(p_source_tool, rp.source_tool),
      stage_changed_at = case when p_stage <> rp.stage then v_now else rp.stage_changed_at end,
      closed_at = case when p_stage in ('won', 'lost') then coalesce(rp.closed_at, v_now) end,
      version = rp.version + 1, updated_by_hash = p_actor_hash, updated_at = v_now
    where rp.id = v_existing.id returning * into v_result;
  end if;

  insert into public.dashboard_audit_log(
    request_id, actor_hash, actor_role, action, scope
  ) values (
    p_request_id, p_actor_hash, v_role, 'pipeline_write',
    pg_catalog.jsonb_build_object(
      'campaign_scoped', true, 'stage', p_stage,
      'new_version', v_result.version, 'source_email_step', v_result.source_email_step
    )
  ) on conflict (request_id, action) do nothing;

  return pg_catalog.jsonb_build_object(
    'contact_ref', v_result.contact_ref, 'stage', v_result.stage,
    'estimated_amount', v_result.estimated_amount, 'closed_amount', v_result.closed_amount,
    'probability_percent', v_result.probability_percent,
    'expected_close_on', v_result.expected_close_on,
    'source_email_step', v_result.source_email_step,
    'source_copy_key', v_result.source_copy_key,
    'source_variant', v_result.source_variant, 'source_lot', v_result.source_lot,
    'source_hour', v_result.source_hour, 'source_tool', v_result.source_tool,
    'version', v_result.version, 'updated_at', v_result.updated_at,
    'pii_included', false
  );
end;
$$;

create or replace function public.dashboard_get_intelligence_v2(
  p_actor_hash text, p_request_id text, p_from timestamptz, p_to timestamptz,
  p_campaign_id uuid, p_filters jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_email_step integer;
  v_hour integer;
  v_variant text;
  v_lot text;
  v_company_size text;
  v_tool text;
  v_copy_key text;
  v_result jsonb;
begin
  if p_request_id is null or
     p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$' or
     p_from is null or p_to is null or p_from >= p_to or
     p_to > v_now + interval '5 minutes' or p_to - p_from > interval '366 days' or
     pg_catalog.jsonb_typeof(v_filters) <> 'object' or
     exists (
       select 1 from pg_catalog.jsonb_object_keys(v_filters) filter_key
       where filter_key not in (
         'email_step', 'variant', 'lot', 'hour', 'company_size', 'tool', 'copy_key'
       )
     ) then
    raise exception using errcode = '22023', message = 'dashboard_invalid_intelligence_request';
  end if;

  if v_filters ? 'email_step' then
    if v_filters ->> 'email_step' !~ '^[1-5]$' then
      raise exception using errcode = '22023', message = 'dashboard_invalid_email_step';
    end if;
    v_email_step := (v_filters ->> 'email_step')::integer;
  end if;
  if v_filters ? 'hour' then
    if v_filters ->> 'hour' !~ '^([0-9]|1[0-9]|2[0-3])$' then
      raise exception using errcode = '22023', message = 'dashboard_invalid_hour';
    end if;
    v_hour := (v_filters ->> 'hour')::integer;
  end if;

  v_variant := nullif(v_filters ->> 'variant', '');
  v_lot := nullif(v_filters ->> 'lot', '');
  v_company_size := nullif(v_filters ->> 'company_size', '');
  v_tool := nullif(v_filters ->> 'tool', '');
  v_copy_key := nullif(v_filters ->> 'copy_key', '');

  if exists (
    select 1 from (values
      (v_variant), (v_lot), (v_company_size), (v_tool), (v_copy_key)
    ) supplied(value)
    where value is not null and value !~ '^[A-Za-z0-9_.:-]{1,64}$'
  ) then
    raise exception using errcode = '22023', message = 'dashboard_invalid_filter_value';
  end if;

  v_role := public.dashboard_require_role(
    p_actor_hash, array['admin', 'operator', 'auditor', 'read_only']
  );

  insert into public.dashboard_audit_log(
    request_id, actor_hash, actor_role, action, scope
  ) values (
    p_request_id, p_actor_hash, v_role, 'intelligence_read',
    pg_catalog.jsonb_build_object(
      'from', p_from, 'to', p_to, 'campaign_scoped', p_campaign_id is not null,
      'filters_applied', (select coalesce(pg_catalog.jsonb_agg(key), '[]'::jsonb)
        from pg_catalog.jsonb_object_keys(v_filters) key)
    )
  ) on conflict (request_id, action) do nothing;

  with
  execution_base as materialized (
    select
      ex.id, ex.campaign_id, ex.campaign_contact_id, ex.step, ex.status,
      ex.scheduled_for, ex.actual_at, ex.failed_at,
      c.external_id campaign_external_id,
      cc.variant, cc.magnet, cc.lot, cc.company_size,
      'email_' || ex.step::text || ':' || cc.variant as copy_key,
      extract(hour from pg_catalog.timezone(
        'Europe/Madrid', coalesce(ex.actual_at, ex.scheduled_for, ex.created_at)
      ))::integer as madrid_hour
    from public.campaign_executions ex
    join public.campaign_contacts cc on cc.id = ex.campaign_contact_id
    join public.campaigns c on c.id = ex.campaign_id
    where ex.channel = 'email'
      and coalesce(ex.actual_at, ex.scheduled_for, ex.created_at) >= p_from
      and coalesce(ex.actual_at, ex.scheduled_for, ex.created_at) < p_to
      and (p_campaign_id is null or ex.campaign_id = p_campaign_id)
      and (v_email_step is null or ex.step = v_email_step)
      and (v_variant is null or cc.variant = v_variant)
      and (v_lot is null or cc.lot = v_lot)
      and (v_company_size is null or cc.company_size = v_company_size)
      and (v_hour is null or extract(hour from pg_catalog.timezone(
        'Europe/Madrid', coalesce(ex.actual_at, ex.scheduled_for, ex.created_at)
      ))::integer = v_hour)
      and (v_copy_key is null or
        'email_' || ex.step::text || ':' || cc.variant = v_copy_key)
  ),
  campaign_event_base as materialized (
    select ce.execution_id, ce.campaign_contact_id, ce.event_name,
      ce.metric_quality, ce.occurred_at
    from public.campaign_events ce
    join public.campaign_contacts cc on cc.id = ce.campaign_contact_id
    left join public.campaign_executions ex on ex.id = ce.execution_id
    where ce.occurred_at >= p_from and ce.occurred_at < p_to
      and (p_campaign_id is null or ce.campaign_id = p_campaign_id)
      and (v_email_step is null or ex.step = v_email_step)
      and (v_variant is null or cc.variant = v_variant)
      and (v_lot is null or cc.lot = v_lot)
      and (v_company_size is null or cc.company_size = v_company_size)
  ),
  event_by_execution as (
    select eb.id,
      count(*) filter (where ce.event_name = 'delivery_delivered') delivered_events,
      count(*) filter (where ce.event_name in ('delivery_failed', 'bounce_hard')) bounce_events,
      count(*) filter (where ce.event_name = 'email_opened') opened_directional_events,
      count(*) filter (where ce.event_name = 'link_clicked') click_events,
      count(*) filter (where ce.event_name = 'reply_received') reply_events,
      count(*) filter (where ce.event_name = 'positive_reply') positive_reply_events,
      count(*) filter (where ce.event_name = 'meeting_booked') meeting_events,
      count(*) filter (where ce.event_name = 'opportunity_created') opportunity_events,
      min(extract(epoch from (ce.occurred_at - coalesce(
        eb.actual_at, eb.scheduled_for
      ))) / 3600) filter (where ce.event_name = 'link_clicked') hours_to_first_click,
      min(extract(epoch from (ce.occurred_at - coalesce(
        eb.actual_at, eb.scheduled_for
      ))) / 3600) filter (where ce.event_name = 'reply_received') hours_to_first_reply,
      min(extract(epoch from (ce.occurred_at - coalesce(
        eb.actual_at, eb.scheduled_for
      ))) / 3600) filter (where ce.event_name = 'meeting_booked') hours_to_first_meeting
    from execution_base eb
    left join campaign_event_base ce on ce.execution_id = eb.id
    group by eb.id
  ),
  execution_enriched as materialized (
    select eb.*,
      coalesce(ev.delivered_events, 0) delivered_events,
      coalesce(ev.bounce_events, 0) bounce_events,
      coalesce(ev.opened_directional_events, 0) opened_directional_events,
      coalesce(ev.click_events, 0) click_events,
      coalesce(ev.reply_events, 0) reply_events,
      coalesce(ev.positive_reply_events, 0) positive_reply_events,
      coalesce(ev.meeting_events, 0) meeting_events,
      coalesce(ev.opportunity_events, 0) opportunity_events,
      ev.hours_to_first_click, ev.hours_to_first_reply, ev.hours_to_first_meeting
    from execution_base eb join event_by_execution ev on ev.id = eb.id
  ),
  email_rollup as (
    select step,
      count(*) planned,
      count(*) filter (where status = 'executed') sent,
      count(*) filter (where status = 'failed') failed,
      count(*) filter (where delivered_events > 0) delivered,
      count(*) filter (where bounce_events > 0) bounced,
      count(*) filter (where opened_directional_events > 0) opened_directional,
      count(*) filter (where click_events > 0) clicked,
      count(*) filter (where reply_events > 0) replied,
      count(*) filter (where positive_reply_events > 0) positive_replies,
      count(*) filter (where meeting_events > 0) meetings,
      count(*) filter (where opportunity_events > 0) opportunities,
      round(avg(hours_to_first_click)::numeric, 2) avg_hours_to_first_click,
      round(avg(hours_to_first_reply)::numeric, 2) avg_hours_to_first_reply,
      round(avg(hours_to_first_meeting)::numeric, 2) avg_hours_to_first_meeting
    from execution_enriched where step between 1 and 5 group by step
  ),
  contact_performance as (
    select campaign_contact_id, variant, lot, company_size,
      bool_or(status = 'executed') sent,
      bool_or(delivered_events > 0) delivered,
      bool_or(click_events > 0) clicked,
      bool_or(reply_events > 0) replied,
      bool_or(positive_reply_events > 0) positive_reply,
      bool_or(meeting_events > 0) meeting,
      bool_or(opportunity_events > 0) opportunity
    from execution_enriched
    group by campaign_contact_id, variant, lot, company_size
  ),
  variant_rollup as (
    select variant,
      count(*) filter (where sent) sent_contacts,
      count(*) filter (where clicked) clicked_contacts,
      count(*) filter (where positive_reply or meeting or opportunity) qualified_contacts
    from contact_performance group by variant
  ),
  variant_stats as (
    select variant, sent_contacts, clicked_contacts, qualified_contacts,
      qualified_contacts::numeric / nullif(sent_contacts, 0) conversion_ratio
    from variant_rollup
  ),
  copy_rollup as (
    select copy_key,
      count(*) filter (where status = 'executed') sent,
      count(*) filter (where click_events > 0) clicked,
      count(*) filter (where reply_events > 0) replied,
      count(*) filter (where positive_reply_events > 0) positive_replies,
      count(*) filter (where meeting_events > 0) meetings,
      count(*) filter (where opportunity_events > 0) opportunities
    from execution_enriched group by copy_key
  ),
  campaign_rollup as (
    select campaign_external_id,
      count(distinct campaign_contact_id) contacts,
      count(*) filter (where status = 'executed') sent,
      count(*) filter (where click_events > 0) clicked,
      count(*) filter (where reply_events > 0) replied,
      count(*) filter (where meeting_events > 0) meetings,
      count(*) filter (where opportunity_events > 0) opportunities
    from execution_enriched group by campaign_external_id
  ),
  hour_rollup as (
    select madrid_hour,
      count(*) filter (where status = 'executed') sent,
      count(*) filter (where click_events > 0) clicked,
      count(*) filter (where reply_events > 0) replied,
      count(*) filter (where positive_reply_events > 0 or meeting_events > 0 or
        opportunity_events > 0) qualified
    from execution_enriched group by madrid_hour
  ),
  lot_rollup as (
    select lot, count(*) filter (where sent) sent_contacts,
      count(*) filter (where clicked) clicked_contacts,
      count(*) filter (where positive_reply or meeting or opportunity) qualified_contacts
    from contact_performance group by lot
  ),
  company_size_rollup as (
    select coalesce(company_size, 'unclassified') company_size,
      count(*) filter (where sent) sent_contacts,
      count(*) filter (where clicked) clicked_contacts,
      count(*) filter (where positive_reply or meeting or opportunity) qualified_contacts
    from contact_performance group by coalesce(company_size, 'unclassified')
  ),
  landing_base as materialized (
    select e.id, e.event_name, e.session_id, e.lead_magnet, e.occurred_at,
      c.id campaign_id, cc.id campaign_contact_id,
      cc.variant, cc.lot, cc.company_size,
      case when lower(coalesce(e.context ->> 'host', e.context ->> 'hostname', ''))
        ~ '^[a-z0-9.-]{1,128}$'
        then lower(coalesce(e.context ->> 'host', e.context ->> 'hostname'))
        else 'unattributed' end domain_key,
      coalesce(nullif(e.context ->> 'utm_source', ''), 'direct') || ':' ||
        coalesce(nullif(e.context ->> 'utm_medium', ''), 'unattributed') source_key,
      case when coalesce(e.properties ->> 'link_id', e.properties ->> 'cta_id',
        e.properties ->> 'button_id', '') ~ '^[A-Za-z0-9_.:-]{1,64}$'
        then coalesce(e.properties ->> 'link_id', e.properties ->> 'cta_id',
          e.properties ->> 'button_id') else 'unattributed' end link_key,
      coalesce(nullif(e.properties ->> 'tool_id', ''),
        nullif(e.properties ->> 'resource', ''), nullif(e.lead_magnet, ''),
        case when e.event_name in (
          'session_start', 'session_ping', 'page_view', 'section_view',
          'scroll_milestone', 'cta_click', 'form_start', 'form_step'
        ) then 'site_general' else 'unattributed' end) tool_key,
      case when lower(coalesce(
        e.context ->> 'environment', e.properties ->> 'environment', 'production'
      )) in ('test', 'staging', 'preview', 'development', 'dev') or
        lower(coalesce(e.context ->> 'is_test', e.properties ->> 'is_test', 'false')) = 'true'
      then true else false end is_test,
      case when coalesce(e.properties ->> 'section_id', e.properties ->> 'section', '')
        ~ '^[A-Za-z0-9_.:-]{1,64}$'
        then coalesce(e.properties ->> 'section_id', e.properties ->> 'section')
        else 'unattributed' end section_key,
      case when e.properties ->> 'active_seconds' ~ '^[0-9]+(\.[0-9]+)?$'
        then (e.properties ->> 'active_seconds')::numeric else 0 end active_seconds,
      case when e.properties ->> 'depth_percent' ~ '^[0-9]+(\.[0-9]+)?$'
        then least((e.properties ->> 'depth_percent')::numeric, 100) else 0 end depth_percent
    from public.events e
    left join public.campaigns c on c.external_id = e.context ->> 'utm_campaign'
    left join public.campaign_contacts cc on cc.campaign_id = c.id
      and cc.external_contact_id = e.context ->> 'utm_content'
    where e.occurred_at >= p_from and e.occurred_at < p_to
      and (p_campaign_id is null or c.id = p_campaign_id)
      and (v_variant is null or cc.variant = v_variant)
      and (v_lot is null or cc.lot = v_lot)
      and (v_company_size is null or cc.company_size = v_company_size)
  ),
  landing_attributed as materialized (
    select lb.*, sent.step attributed_email_step,
      sent.copy_key attributed_copy_key, sent.madrid_hour attributed_hour
    from landing_base lb
    left join lateral (
      select eb.step, eb.copy_key, eb.madrid_hour
      from execution_base eb
      where eb.campaign_contact_id = lb.campaign_contact_id
        and eb.status = 'executed' and eb.actual_at <= lb.occurred_at
      order by eb.actual_at desc, eb.id desc limit 1
    ) sent on true
  ),
  landing_filtered as materialized (
    select * from landing_attributed
    where (v_email_step is null or attributed_email_step = v_email_step)
      and (v_hour is null or attributed_hour = v_hour)
      and (v_copy_key is null or attributed_copy_key = v_copy_key)
      and (v_tool is null or tool_key = v_tool)
  ),
  tool_rollup as (
    select tool_key, count(*) events, count(distinct session_id) sessions,
      count(*) filter (where event_name in (
        'tool_started', 'calculator_started', 'checklist_interactive_open', 'resource_started'
      )) started,
      count(*) filter (where event_name = 'form_step') steps,
      count(*) filter (where event_name in (
        'tool_completed', 'calculator_completed', 'calculator_result',
        'resource_completed', 'resource_download', 'pdf_downloaded', 'checklist_downloaded'
      )) completed,
      count(*) filter (where event_name in ('tool_abandoned', 'resource_abandoned')) abandoned,
      round(avg(active_seconds), 2) avg_active_seconds,
      round(avg(depth_percent), 2) avg_scroll_percent
    from landing_filtered group by tool_key
  ),
  abandonment_section_rollup as (
    select tool_key, section_key,
      count(*) filter (where event_name in ('tool_abandoned', 'resource_abandoned')) abandoned,
      count(distinct session_id) filter (
        where event_name in ('tool_abandoned', 'resource_abandoned')
      ) sessions
    from landing_filtered
    where section_key <> 'unattributed'
    group by tool_key, section_key
  ),
  campaign_contact_signal_rollup as (
    select campaign_contact_id, max(occurred_at) last_signal_at,
      bool_or(event_name = 'link_clicked') clicked,
      bool_or(event_name = 'positive_reply') positive_reply,
      bool_or(event_name = 'meeting_booked') meeting,
      bool_or(event_name = 'opportunity_created') opportunity
    from campaign_event_base
    where campaign_contact_id is not null
    group by campaign_contact_id
  ),
  high_intent_candidates as (
    select distinct campaign_contact_id
    from landing_filtered
    where campaign_contact_id is not null and not is_test and event_name in (
      'cta_click', 'tool_started', 'resource_started', 'resource_download',
      'tool_completed', 'calculator_completed', 'calculator_result'
    )
    union
    select campaign_contact_id from campaign_contact_signal_rollup
    where clicked or positive_reply or meeting or opportunity
  ),
  high_intent_contacts as (
    select hc.campaign_contact_id,
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'data-brain-high-intent-v1:' || hc.campaign_contact_id::text, 'UTF8'
      ), 'sha256'), 'hex') contact_ref,
      greatest(max(lf.occurred_at), cs.last_signal_at) last_activity_at,
      max(lf.tool_key) filter (where lf.tool_key <> 'unattributed') dominant_tool,
      count(*) filter (where lf.event_name in (
        'resource_download', 'pdf_downloaded', 'checklist_downloaded',
        'tool_completed', 'calculator_completed', 'calculator_result'
      )) + case when cs.clicked then 1 else 0 end +
        case when cs.positive_reply then 1 else 0 end +
        case when cs.meeting then 1 else 0 end +
        case when cs.opportunity then 1 else 0 end confirmed_signals,
      least(100, 10 * count(*) filter (where lf.event_name = 'cta_click') +
        20 * count(*) filter (where lf.event_name in ('tool_started', 'resource_started')) +
        35 * count(*) filter (where lf.event_name in (
          'resource_download', 'tool_completed', 'calculator_completed', 'calculator_result'
        )) + case when cs.clicked then 15 else 0 end +
        case when cs.positive_reply then 45 else 0 end +
        case when cs.meeting then 65 else 0 end +
        case when cs.opportunity then 85 else 0 end) intent_score
    from high_intent_candidates hc
    left join landing_filtered lf on lf.campaign_contact_id = hc.campaign_contact_id
      and not lf.is_test
    left join campaign_contact_signal_rollup cs
      on cs.campaign_contact_id = hc.campaign_contact_id
    group by hc.campaign_contact_id, cs.last_signal_at, cs.clicked,
      cs.positive_reply, cs.meeting, cs.opportunity
  ),
  session_rollup as (
    select session_id, max(active_seconds) active_seconds,
      max(depth_percent) max_scroll_percent,
      bool_or(event_name in ('tool_started', 'calculator_started', 'resource_started')) started,
      bool_or(event_name in (
        'tool_completed', 'calculator_completed', 'resource_completed', 'resource_download'
      )) completed
    from landing_filtered where session_id is not null group by session_id
  ),
  source_rollup as (
    select domain_key, source_key, count(*) events,
      count(distinct session_id) sessions,
      count(*) filter (where event_name in (
        'resource_download', 'pdf_downloaded', 'checklist_downloaded',
        'meeting_booked', 'opportunity_created'
      )) conversions
    from landing_filtered group by domain_key, source_key
  ),
  link_rollup as (
    select link_key, count(*) clicks, count(distinct session_id) sessions
    from landing_filtered
    where event_name = 'cta_click' and link_key <> 'unattributed'
    group by link_key
  ),
  pipeline_base as materialized (
    select rp.campaign_id, rp.stage, rp.estimated_amount, rp.closed_amount, rp.probability_percent,
      rp.outcome_reason,
      rp.expected_close_on, rp.source_email_step, rp.source_copy_key,
      rp.source_variant, rp.source_lot, rp.source_hour, rp.source_tool,
      rp.created_at, rp.closed_at,
      coalesce(ex.actual_at, ex.scheduled_for) source_sent_at
    from fundae_private.campaign_revenue_pipeline rp
    join public.campaign_contacts cc on cc.id = rp.campaign_contact_id
    left join public.campaign_executions ex on ex.id = rp.source_execution_id
    where rp.created_at < p_to
      and (p_campaign_id is null or rp.campaign_id = p_campaign_id)
      and (v_email_step is null or rp.source_email_step = v_email_step)
      and (v_variant is null or rp.source_variant = v_variant)
      and (v_lot is null or rp.source_lot = v_lot)
      and (v_company_size is null or cc.company_size = v_company_size)
      and (v_hour is null or rp.source_hour = v_hour)
      and (v_tool is null or rp.source_tool = v_tool)
      and (v_copy_key is null or rp.source_copy_key = v_copy_key)
  ),
  pipeline_stage_rollup as (
    select stage, count(*) opportunities,
      coalesce(sum(estimated_amount), 0) estimated_amount,
      coalesce(sum(closed_amount), 0) closed_amount,
      coalesce(sum(estimated_amount * probability_percent / 100), 0) weighted_amount
    from pipeline_base group by stage
  ),
  pipeline_source_rollup as (
    select coalesce(
        source_copy_key,
        case when source_email_step is not null then
          'email_' || source_email_step::text || ':' ||
            coalesce(source_variant, 'unattributed') end,
        case when source_tool is not null then 'tool:' || source_tool end,
        'manual'
      ) source_key,
      count(*) records,
      coalesce(sum(estimated_amount), 0) estimated_amount,
      coalesce(sum(closed_amount), 0) closed_amount,
      coalesce(sum(estimated_amount * probability_percent / 100), 0) weighted_amount
    from pipeline_base
    group by coalesce(
      source_copy_key,
      case when source_email_step is not null then
        'email_' || source_email_step::text || ':' ||
          coalesce(source_variant, 'unattributed') end,
      case when source_tool is not null then 'tool:' || source_tool end,
      'manual'
    )
  ),
  pipeline_campaign_rollup as (
    select c.external_id campaign_external_id, count(*) records,
      coalesce(sum(pb.estimated_amount), 0) estimated_amount,
      coalesce(sum(pb.estimated_amount * pb.probability_percent / 100), 0) weighted_amount,
      coalesce(sum(pb.closed_amount) filter (where pb.stage = 'won'), 0) closed_amount
    from pipeline_base pb join public.campaigns c on c.id = pb.campaign_id
    group by c.external_id
  ),
  pipeline_outcome_reason_rollup as (
    select coalesce(
        outcome_reason,
        case when stage = 'won' then 'won' else 'unspecified' end
      ) outcome_reason,
      count(*) outcomes,
      count(*) filter (where stage = 'won') won,
      count(*) filter (where stage = 'lost') lost,
      coalesce(sum(closed_amount), 0) closed_amount
    from pipeline_base
    where stage in ('won', 'lost')
    group by coalesce(
      outcome_reason,
      case when stage = 'won' then 'won' else 'unspecified' end
    )
  ),
  time_series_events as (
    select
      pg_catalog.timezone(
        'Europe/Madrid', coalesce(actual_at, scheduled_for)
      )::date activity_date,
      count(*) filter (where status = 'executed') sent,
      count(*) filter (where click_events > 0) clicked,
      count(*) filter (where reply_events > 0) replied,
      count(*) filter (where meeting_events > 0) meetings,
      count(*) filter (where opportunity_events > 0) opportunities,
      0::numeric closed_amount
    from execution_enriched
    group by pg_catalog.timezone(
      'Europe/Madrid', coalesce(actual_at, scheduled_for)
    )::date
    union all
    select
      pg_catalog.timezone('Europe/Madrid', closed_at)::date activity_date,
      0::bigint sent, 0::bigint clicked, 0::bigint replied,
      0::bigint meetings, 0::bigint opportunities,
      coalesce(sum(closed_amount), 0) closed_amount
    from pipeline_base
    where stage = 'won' and closed_at >= p_from and closed_at < p_to
      and (source_email_step is not null or source_copy_key is not null or
        source_tool is not null)
    group by pg_catalog.timezone('Europe/Madrid', closed_at)::date
  ),
  time_series_rollup as (
    select activity_date, sum(sent) sent, sum(clicked) clicked,
      sum(replied) replied, sum(meetings) meetings,
      sum(opportunities) opportunities, sum(closed_amount) closed_amount
    from time_series_events
    where activity_date is not null
    group by activity_date
    having sum(sent) + sum(clicked) + sum(replied) + sum(meetings) +
      sum(opportunities) > 0 or sum(closed_amount) > 0
  ),
  quality as (
    select (select count(*) from landing_filtered) landing_events,
      (select count(*) from landing_filtered where campaign_id is not null) campaign_attributed,
      (select count(*) from landing_filtered where campaign_contact_id is not null) contact_attributed,
      (select count(*) from landing_filtered where attributed_email_step is not null) email_attributed,
      (select count(*) from landing_filtered where is_test) test_events,
      (select count(*) from landing_filtered where not is_test) production_events,
      (select count(*) from landing_filtered where session_id is null) incomplete_sessions,
      (select count(*) from landing_filtered where tool_key = 'unattributed') unattributed_tool_events,
      (select count(*) from campaign_event_base where execution_id is null)
        campaign_events_without_execution,
      (select coalesce(sum(duplicates), 0) from (
        select count(*) - 1 duplicates
        from public.campaign_events ce
        where ce.occurred_at >= p_from and ce.occurred_at < p_to
          and ce.source_event_id is not null
          and (p_campaign_id is null or ce.campaign_id = p_campaign_id)
        group by ce.campaign_id, ce.source_event_id having count(*) > 1
      ) duplicate_keys) duplicate_campaign_event_keys
  ),
  recommendation_rows as (
    select recommendation from (
      select case when q.landing_events > 0 and
        q.email_attributed::numeric / q.landing_events < 0.90
        then 'Improve email attribution coverage before comparing copies.' end recommendation
      from quality q
      union all
      select case when exists (
        select 1 from variant_rollup where sent_contacts between 1 and 29
      ) then 'Wait for at least 30 sent contacts per variant before declaring a winner.' end
      union all
      select case when exists (
        select 1 from email_rollup where sent > 0 and bounced::numeric / sent > 0.05
      ) then 'Review deliverability: bounce rate exceeds 5 percent.' end
      union all
      select case when exists (
        select 1 from tool_rollup where started >= 10 and
          completed::numeric / nullif(started, 0) < 0.50
      ) then 'Inspect the tool with more than 50 percent abandonment.' end
      union all
      select case when not exists (select 1 from pipeline_base)
        then 'Register internal opportunities and amounts to activate revenue attribution.' end
    ) candidates where recommendation is not null
  ),
  anomaly_rows as (
    select code, severity from (
      select case when q.landing_events > 0 and
        q.email_attributed::numeric / q.landing_events < 0.90
        then 'low_email_attribution' end code,
        'warning'::text severity from quality q
      union all
      select case when exists (
        select 1 from email_rollup where sent > 0 and bounced::numeric / sent > 0.05
      ) then 'high_bounce_rate' end, 'critical'
      union all
      select case when exists (
        select 1 from tool_rollup where started >= 10 and
          completed::numeric / nullif(started, 0) < 0.50
      ) then 'high_tool_abandonment' end, 'warning'
      union all
      select case when q.test_events > q.production_events and q.test_events > 0
        then 'test_data_dominates' end, 'warning' from quality q
    ) candidates where code is not null
  )
  select pg_catalog.jsonb_build_object(
    'meta', pg_catalog.jsonb_build_object(
      'role', v_role, 'generated_at', v_now, 'from', p_from, 'to', p_to,
      'campaign_id', p_campaign_id, 'filters', v_filters,
      'timezone', 'Europe/Madrid', 'pii_included', false
    ),
    'overview', pg_catalog.jsonb_build_object(
      'planned', (select count(*) from execution_enriched),
      'sent', (select count(*) from execution_enriched where status = 'executed'),
      'delivered', (select count(*) from execution_enriched where delivered_events > 0),
      'bounced', (select count(*) from execution_enriched where bounce_events > 0),
      'clicked', (select count(*) from execution_enriched where click_events > 0),
      'replied', (select count(*) from execution_enriched where reply_events > 0),
      'positive_replies', (select count(*) from execution_enriched where positive_reply_events > 0),
      'meetings', (select count(*) from execution_enriched where meeting_events > 0),
      'opportunities', (select count(*) from pipeline_base
        where stage in ('opportunity', 'won')),
      'won', (select count(*) from pipeline_base where stage = 'won'),
      'pipeline_estimated_amount', (select coalesce(sum(estimated_amount), 0) from pipeline_base),
      'pipeline_weighted_amount', (select coalesce(sum(
        estimated_amount * probability_percent / 100
      ), 0) from pipeline_base),
      'revenue_closed_amount', (select coalesce(sum(closed_amount), 0)
        from pipeline_base where stage = 'won')
    ),
    'funnel', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('stage', 'planned', 'count',
        (select count(*) from execution_enriched)),
      pg_catalog.jsonb_build_object('stage', 'sent', 'count',
        (select count(*) from execution_enriched where status = 'executed')),
      pg_catalog.jsonb_build_object('stage', 'delivered', 'count',
        (select count(*) from execution_enriched where delivered_events > 0)),
      pg_catalog.jsonb_build_object('stage', 'clicked', 'count',
        (select count(*) from execution_enriched where click_events > 0)),
      pg_catalog.jsonb_build_object('stage', 'replied', 'count',
        (select count(*) from execution_enriched where reply_events > 0)),
      pg_catalog.jsonb_build_object('stage', 'meeting', 'count',
        (select count(*) from pipeline_base where stage in ('meeting','opportunity','won'))),
      pg_catalog.jsonb_build_object('stage', 'opportunity', 'count',
        (select count(*) from pipeline_base where stage in ('opportunity','won'))),
      pg_catalog.jsonb_build_object('stage', 'won', 'count',
        (select count(*) from pipeline_base where stage = 'won'))
    ),
    'by_email', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'email_step', step, 'planned', planned, 'sent', sent, 'failed', failed,
        'delivered', delivered, 'bounced', bounced,
        'opened_directional', opened_directional, 'clicked', clicked,
        'replied', replied, 'positive_replies', positive_replies,
        'meetings', meetings, 'opportunities', opportunities,
        'delivery_rate', round(100 * delivered::numeric / nullif(sent, 0), 2),
        'bounce_rate', round(100 * bounced::numeric / nullif(sent, 0), 2),
        'click_rate', round(100 * clicked::numeric / nullif(delivered, 0), 2),
        'reply_rate', round(100 * replied::numeric / nullif(delivered, 0), 2),
        'positive_reply_rate', round(100 * positive_replies::numeric / nullif(delivered, 0), 2),
        'meeting_rate', round(100 * meetings::numeric / nullif(delivered, 0), 2),
        'avg_hours_to_first_click', avg_hours_to_first_click,
        'avg_hours_to_first_reply', avg_hours_to_first_reply,
        'avg_hours_to_first_meeting', avg_hours_to_first_meeting
      ) order by step
    ) from email_rollup), '[]'::jsonb),
    'by_copy', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'copy_key', copy_key, 'sent', sent, 'clicked', clicked,
        'replied', replied, 'positive_replies', positive_replies,
        'meetings', meetings, 'opportunities', opportunities,
        'click_rate', round(100 * clicked::numeric / nullif(sent, 0), 2),
        'qualified_rate', round(100 * greatest(
          positive_replies, meetings, opportunities
        )::numeric / nullif(sent, 0), 2),
        'minimum_sample_reached', sent >= 30
      ) order by copy_key
    ) from copy_rollup), '[]'::jsonb),
    'by_campaign', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'campaign', cr.campaign_external_id, 'contacts', cr.contacts,
        'sent', cr.sent, 'clicked', cr.clicked, 'replied', cr.replied,
        'meetings', cr.meetings, 'opportunities', cr.opportunities,
        'click_rate', round(100 * cr.clicked::numeric / nullif(cr.sent, 0), 2),
        'qualified_rate', round(100 * greatest(
          cr.replied, cr.meetings, cr.opportunities
        )::numeric / nullif(cr.sent, 0), 2),
        'estimated_amount', coalesce(pr.estimated_amount, 0),
        'weighted_amount', coalesce(pr.weighted_amount, 0),
        'closed_amount', coalesce(pr.closed_amount, 0)
      ) order by coalesce(pr.closed_amount, 0) desc, cr.campaign_external_id
    ) from campaign_rollup cr left join pipeline_campaign_rollup pr
      on pr.campaign_external_id = cr.campaign_external_id), '[]'::jsonb),
    'by_variant', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'variant', variant, 'sent_contacts', sent_contacts,
        'clicked_contacts', clicked_contacts, 'qualified_contacts', qualified_contacts,
        'conversion_rate', round(100 * conversion_ratio, 2),
        'lift_percentage_points', round(100 * (conversion_ratio - (
          select count(*) filter (where positive_reply or meeting or opportunity)::numeric /
            nullif(count(*) filter (where sent), 0) from contact_performance
        )), 2),
        'wilson_low_95', round(100 * (
          (conversion_ratio + 1.9208 / sent_contacts) -
          1.96 * pg_catalog.sqrt((conversion_ratio * (1 - conversion_ratio) +
            0.9604 / sent_contacts) / sent_contacts)
        ) / (1 + 3.8416 / sent_contacts), 2),
        'wilson_high_95', round(100 * (
          (conversion_ratio + 1.9208 / sent_contacts) +
          1.96 * pg_catalog.sqrt((conversion_ratio * (1 - conversion_ratio) +
            0.9604 / sent_contacts) / sent_contacts)
        ) / (1 + 3.8416 / sent_contacts), 2),
        'minimum_sample_reached', sent_contacts >= 30
      ) order by variant
    ) from variant_stats where sent_contacts > 0), '[]'::jsonb),
    'by_hour', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'hour', madrid_hour, 'sent', sent, 'clicked', clicked,
        'replied', replied, 'qualified', qualified,
        'click_rate', round(100 * clicked::numeric / nullif(sent, 0), 2),
        'qualified_rate', round(100 * qualified::numeric / nullif(sent, 0), 2)
      ) order by madrid_hour
    ) from hour_rollup), '[]'::jsonb),
    'time_series', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'date', activity_date, 'sent', sent, 'clicked', clicked,
        'replied', replied, 'meetings', meetings,
        'opportunities', opportunities, 'closed_amount', closed_amount
      ) order by activity_date
    ) from time_series_rollup), '[]'::jsonb),
    'cohorts', pg_catalog.jsonb_build_object(
      'by_lot', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'lot', lot, 'sent_contacts', sent_contacts,
          'clicked_contacts', clicked_contacts, 'qualified_contacts', qualified_contacts,
          'click_rate', round(100 * clicked_contacts::numeric / nullif(sent_contacts, 0), 2),
          'qualified_rate', round(100 * qualified_contacts::numeric /
            nullif(sent_contacts, 0), 2)
        ) order by lot
      ) from lot_rollup), '[]'::jsonb),
      'by_company_size', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'company_size', company_size, 'sent_contacts', sent_contacts,
          'clicked_contacts', clicked_contacts, 'qualified_contacts', qualified_contacts,
          'click_rate', round(100 * clicked_contacts::numeric / nullif(sent_contacts, 0), 2),
          'qualified_rate', round(100 * qualified_contacts::numeric /
            nullif(sent_contacts, 0), 2)
        ) order by company_size
      ) from company_size_rollup), '[]'::jsonb)
    ),
    'traffic', pg_catalog.jsonb_build_object(
      'by_domain_source', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'domain', domain_key, 'source', source_key, 'events', events,
          'sessions', sessions, 'conversions', conversions
        ) order by events desc, domain_key, source_key
      ) from source_rollup), '[]'::jsonb),
      'by_link', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'link', link_key, 'clicks', clicks, 'sessions', sessions
        ) order by clicks desc, link_key
      ) from link_rollup), '[]'::jsonb)
    ),
    'tools', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'tool', tool_key, 'events', events, 'sessions', sessions,
        'started', started, 'steps', steps, 'completed', completed, 'abandoned', abandoned,
        'completion_rate', round(100 * completed::numeric / nullif(started, 0), 2),
        'abandonment_rate', round(100 * greatest(started - completed, abandoned)::numeric /
          nullif(started, 0), 2),
        'avg_active_seconds', avg_active_seconds, 'avg_scroll_percent', avg_scroll_percent
      ) order by events desc, tool_key
    ) from tool_rollup), '[]'::jsonb),
    'abandonment_by_section', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'tool', tool_key, 'section', section_key,
        'abandoned', abandoned, 'sessions', sessions
      ) order by abandoned desc, tool_key, section_key
    ) from abandonment_section_rollup), '[]'::jsonb),
    'high_intent_contacts', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'contact_ref', contact_ref, 'intent_score', intent_score,
        'confirmed_signals', confirmed_signals,
        'dominant_tool', coalesce(dominant_tool, 'unattributed'),
        'last_activity_at', last_activity_at
      ) order by intent_score desc, last_activity_at desc
    ) from (select * from high_intent_contacts
      order by intent_score desc, last_activity_at desc limit 100) bounded), '[]'::jsonb),
    'journey', pg_catalog.jsonb_build_object(
      'sessions', (select count(*) from session_rollup),
      'avg_active_seconds', (select round(avg(active_seconds), 2) from session_rollup),
      'avg_scroll_percent', (select round(avg(max_scroll_percent), 2) from session_rollup),
      'started_sessions', (select count(*) from session_rollup where started),
      'completed_sessions', (select count(*) from session_rollup where completed),
      'abandoned_sessions', (select count(*) from session_rollup where started and not completed)
    ),
    'pipeline', pg_catalog.jsonb_build_object(
      'totals', pg_catalog.jsonb_build_object(
        'records', (select count(*) from pipeline_base),
        'estimated_amount', (select coalesce(sum(estimated_amount), 0) from pipeline_base),
        'weighted_amount', (select coalesce(sum(
          estimated_amount * probability_percent / 100
        ), 0) from pipeline_base),
        'closed_amount', (select coalesce(sum(closed_amount), 0)
          from pipeline_base where stage = 'won'),
        'win_rate', (select round(100 * count(*) filter (where stage = 'won')::numeric /
          nullif(count(*) filter (where stage in ('won', 'lost')), 0), 2)
          from pipeline_base),
        'avg_days_to_close', (select round(avg(
          extract(epoch from (closed_at - created_at)) / 86400
        ), 2) from pipeline_base where closed_at is not null),
        'avg_days_email_to_sale', (select round(avg(
          extract(epoch from (closed_at - source_sent_at)) / 86400
        ), 2) from pipeline_base
          where stage = 'won' and closed_at is not null and source_sent_at is not null)
      ),
      'by_stage', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'stage', stage, 'opportunities', opportunities,
          'estimated_amount', estimated_amount, 'weighted_amount', weighted_amount,
          'closed_amount', closed_amount
        ) order by case stage
          when 'interested' then 1 when 'qualified' then 2 when 'meeting' then 3
          when 'opportunity' then 4 when 'won' then 5 else 6 end
      ) from pipeline_stage_rollup), '[]'::jsonb),
      'by_source', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'source', source_key, 'records', records,
          'estimated_amount', estimated_amount,
          'weighted_amount', weighted_amount, 'closed_amount', closed_amount
        ) order by records desc, source_key
      ) from pipeline_source_rollup), '[]'::jsonb),
      'by_campaign', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'campaign', campaign_external_id, 'records', records,
          'estimated_amount', estimated_amount,
          'weighted_amount', weighted_amount, 'closed_amount', closed_amount
        ) order by closed_amount desc, campaign_external_id
      ) from pipeline_campaign_rollup), '[]'::jsonb),
      'by_outcome_reason', coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'outcome_reason', outcome_reason, 'outcomes', outcomes,
          'won', won, 'lost', lost, 'closed_amount', closed_amount
        ) order by outcomes desc, outcome_reason
      ) from pipeline_outcome_reason_rollup), '[]'::jsonb)
    ),
    'quality', (select pg_catalog.jsonb_build_object(
      'landing_events', landing_events,
      'campaign_attribution_rate', round(100 * campaign_attributed::numeric /
        nullif(landing_events, 0), 2),
      'contact_attribution_rate', round(100 * contact_attributed::numeric /
        nullif(landing_events, 0), 2),
      'email_attribution_rate', round(100 * email_attributed::numeric /
        nullif(landing_events, 0), 2),
      'production_events', production_events, 'test_events', test_events,
      'incomplete_sessions', incomplete_sessions,
      'unattributed_tool_events', unattributed_tool_events,
      'campaign_events_without_execution', campaign_events_without_execution,
      'duplicate_campaign_event_keys', duplicate_campaign_event_keys,
      'opens_are_directional', true
    ) from quality),
    'anomalies', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('code', code, 'severity', severity)
    ) from anomaly_rows), '[]'::jsonb),
    'recommendations', coalesce((select pg_catalog.jsonb_agg(recommendation)
      from recommendation_rows), '[]'::jsonb),
    'available_filters', pg_catalog.jsonb_build_object(
      'email_steps', coalesce((select pg_catalog.jsonb_agg(step order by step)
        from (select distinct step from execution_base where step is not null) values_), '[]'::jsonb),
      'variants', coalesce((select pg_catalog.jsonb_agg(variant order by variant)
        from (select distinct variant from execution_base) values_), '[]'::jsonb),
      'lots', coalesce((select pg_catalog.jsonb_agg(lot order by lot)
        from (select distinct lot from execution_base) values_), '[]'::jsonb),
      'hours', coalesce((select pg_catalog.jsonb_agg(madrid_hour order by madrid_hour)
        from (select distinct madrid_hour from execution_base) values_), '[]'::jsonb),
      'company_sizes', coalesce((select pg_catalog.jsonb_agg(company_size order by company_size)
        from (select distinct company_size from execution_base
          where company_size is not null) values_), '[]'::jsonb),
      'tools', coalesce((select pg_catalog.jsonb_agg(tool_key order by tool_key)
        from (select distinct tool_key from landing_base) values_), '[]'::jsonb),
      'copy_keys', coalesce((select pg_catalog.jsonb_agg(copy_key order by copy_key)
        from (select distinct copy_key from execution_base) values_), '[]'::jsonb)
    ),
    'metric_contract', pg_catalog.jsonb_build_object(
      'version', '2.0', 'timezone', 'Europe/Madrid',
      'minimum_variant_sample', 30, 'confidence_level', 0.95,
      'open_quality', 'directional',
      'confirmed_outcomes', pg_catalog.jsonb_build_array(
        'delivered', 'click', 'reply', 'meeting', 'opportunity', 'won'
      ),
      'revenue_source', 'internal_pipeline', 'external_crm_required', false,
      'pii_included', false
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.dashboard_upsert_revenue_pipeline(
  text, text, uuid, uuid, text, numeric, numeric, numeric, date, text, uuid, text, bigint
) from public, anon, authenticated;
grant execute on function public.dashboard_upsert_revenue_pipeline(
  text, text, uuid, uuid, text, numeric, numeric, numeric, date, text, uuid, text, bigint
) to service_role;

revoke all on function public.dashboard_get_intelligence_v2(
  text, text, timestamptz, timestamptz, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.dashboard_get_intelligence_v2(
  text, text, timestamptz, timestamptz, uuid, jsonb
) to service_role;

commit;
