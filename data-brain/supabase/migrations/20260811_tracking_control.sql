-- Canonical journey and calendar/control. Additive; apply manually after backup.
-- Depends on 20260811_production_hardening.sql.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

do $$
begin
  if to_regclass('public.campaigns') is null or
     to_regclass('public.campaign_contacts') is null or
     to_regclass('public.campaign_events') is null then
    raise exception 'Campaign foundation is incomplete; apply campaign V5 and production hardening first';
  end if;
end;
$$;

create table if not exists public.campaign_executions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  campaign_contact_id uuid not null references public.campaign_contacts(id) on delete cascade,
  idempotency_key text not null,
  channel text not null check (channel in ('email', 'linkedin', 'manual')),
  capture_method text not null check (capture_method in ('automation', 'provider_webhook', 'official_api', 'manual')),
  action_name text not null,
  step integer check (step is null or step between 1 and 5),
  status text not null check (status in ('planned', 'executed', 'failed', 'stopped')),
  scheduled_for timestamptz,
  planned_at timestamptz,
  actual_at timestamptz,
  failed_at timestamptz,
  stopped_at timestamptz,
  failure_code text,
  stop_reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_executions_key_format check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$'),
  constraint campaign_executions_linkedin_safe check (channel <> 'linkedin' or capture_method in ('official_api', 'manual')),
  constraint campaign_executions_manual_safe check (channel <> 'manual' or capture_method = 'manual'),
  constraint campaign_executions_metadata_no_pii check (not (metadata ?| array[
    'email','email_address','name','first_name','last_name','phone','mobile','company',
    'company_name','job_title','message','answers','contact','address','ip','ip_address'
  ]))
);

create unique index if not exists campaign_executions_idempotency_idx
  on public.campaign_executions (campaign_id, idempotency_key);
create index if not exists campaign_executions_calendar_idx
  on public.campaign_executions (campaign_id, scheduled_for, channel, status);
create index if not exists campaign_executions_contact_time_idx
  on public.campaign_executions (campaign_contact_id, created_at desc);

drop trigger if exists campaign_executions_touch_updated_at on public.campaign_executions;
create trigger campaign_executions_touch_updated_at before update on public.campaign_executions
for each row execute function public.touch_updated_at();

alter table public.campaign_events
  add column if not exists execution_id uuid references public.campaign_executions(id) on delete set null,
  add column if not exists channel text,
  add column if not exists capture_method text,
  add column if not exists metric_quality text not null default 'confirmed';

create index if not exists campaign_events_execution_idx on public.campaign_events (execution_id)
where execution_id is not null;

create or replace function public.record_campaign_tracking_event(
  p_campaign_external_id text, p_contact_id text, p_source_event_id text,
  p_execution_key text, p_event_name text, p_channel text, p_capture_method text,
  p_occurred_at timestamptz, p_scheduled_for timestamptz, p_step integer,
  p_context jsonb, p_properties jsonb, p_metric_quality text, p_execution_status text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_event_id uuid;
  v_execution_id uuid;
  v_existing_contact_id uuid;
  v_existing_event_name text;
  v_existing_execution_key text;
  v_duplicate boolean := false;
begin
  if p_event_name <> all(array[
    'delivery_scheduled','delivery_sent','delivery_delivered','delivery_failed','email_opened','link_clicked',
    'reply_received','bounce_hard','unsubscribe','tool_started','tool_completed',
    'pdf_downloaded','transactional_delivery_sent','transactional_delivery_failed',
    'meeting_booked','meeting_completed','opportunity_created'
  ]) then raise exception 'Unsupported canonical campaign event'; end if;
  if p_source_event_id is null or p_source_event_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' then raise exception 'Invalid source event id'; end if;
  if p_execution_key is null or p_execution_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' then raise exception 'Invalid execution key'; end if;
  if p_occurred_at is null then raise exception 'occurred_at is required'; end if;
  if p_channel not in ('email','linkedin','manual') then raise exception 'Invalid channel'; end if;
  if p_capture_method not in ('automation','provider_webhook','official_api','manual') then raise exception 'Invalid capture method'; end if;
  if p_channel = 'linkedin' and p_capture_method not in ('official_api','manual') then raise exception 'LinkedIn capture must be manual or official_api'; end if;
  if p_channel = 'manual' and p_capture_method <> 'manual' then raise exception 'Manual channel requires manual capture'; end if;
  if p_event_name = 'email_opened' and (p_channel <> 'email' or p_metric_quality <> 'directional') then raise exception 'Email opens must be directional'; end if;
  if p_execution_status not in ('planned','executed','failed','stopped') then raise exception 'Invalid execution status'; end if;
  if jsonb_typeof(coalesce(p_context, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_properties, '{}'::jsonb)) <> 'object' then raise exception 'Metadata must be JSON objects'; end if;

  select * into v_campaign from public.campaigns where external_id = p_campaign_external_id;
  if not found then raise exception 'Unknown campaign'; end if;
  select * into v_contact from public.campaign_contacts
    where campaign_id = v_campaign.id and external_contact_id = p_contact_id for update;
  if not found then raise exception 'Unknown campaign contact'; end if;

  select ce.id, ce.execution_id, ce.campaign_contact_id, ce.event_name, ex.idempotency_key
    into v_event_id, v_execution_id, v_existing_contact_id, v_existing_event_name, v_existing_execution_key
    from public.campaign_events ce
    left join public.campaign_executions ex on ex.id = ce.execution_id
    where ce.campaign_id = v_campaign.id and ce.source_event_id = p_source_event_id limit 1;
  if found then
    if v_existing_contact_id <> v_contact.id or v_existing_event_name <> p_event_name then raise exception 'source_event_id collision'; end if;
    if v_existing_execution_key <> p_execution_key then raise exception 'source_event_id execution collision'; end if;
    v_duplicate := true;
  else
    if p_event_name = 'delivery_scheduled' and (
      not v_campaign.is_active or v_campaign.status not in ('active','running','pilot') or
      v_contact.suppression_scope <> 'none' or v_contact.marketing_lane = 'none' or
      (v_contact.marketing_lane = 'cold' and v_contact.cold_sequence_status not in ('pending','active')) or
      (v_contact.marketing_lane = 'intent' and v_contact.intent_sequence_status not in ('pending','active'))
    ) then raise exception 'Campaign stop gate rejected outbound action'; end if;

    insert into public.campaign_executions (
      campaign_id,campaign_contact_id,idempotency_key,channel,capture_method,action_name,step,
      status,scheduled_for,planned_at,actual_at,failed_at,stopped_at,failure_code,stop_reason,metadata
    ) values (
      v_campaign.id,v_contact.id,p_execution_key,p_channel,p_capture_method,p_event_name,p_step,
      p_execution_status,p_scheduled_for,
      case when p_execution_status='planned' then p_occurred_at end,
      case when p_execution_status='executed' then p_occurred_at end,
      case when p_execution_status='failed' then p_occurred_at end,
      case when p_execution_status='stopped' then p_occurred_at end,
      case when p_execution_status='failed' then p_properties->>'reason_code' end,
      case when p_execution_status='stopped' then p_event_name end,
      coalesce(p_context,'{}'::jsonb) || coalesce(p_properties,'{}'::jsonb) || jsonb_build_object('event_name',p_event_name,'metric_quality',p_metric_quality)
    ) on conflict (campaign_id,idempotency_key) do update set
      action_name=excluded.action_name,
      status=case
        when campaign_executions.status='stopped' or excluded.status='stopped' then 'stopped'
        when campaign_executions.status='executed' or excluded.status='executed' then 'executed'
        when campaign_executions.status='failed' or excluded.status='failed' then 'failed'
        else excluded.status end,
      scheduled_for=coalesce(campaign_executions.scheduled_for,excluded.scheduled_for),
      planned_at=coalesce(campaign_executions.planned_at,excluded.planned_at),
      actual_at=coalesce(campaign_executions.actual_at,excluded.actual_at),
      failed_at=coalesce(campaign_executions.failed_at,excluded.failed_at),
      stopped_at=coalesce(campaign_executions.stopped_at,excluded.stopped_at),
      failure_code=coalesce(campaign_executions.failure_code,excluded.failure_code),
      stop_reason=coalesce(campaign_executions.stop_reason,excluded.stop_reason),
      metadata=campaign_executions.metadata || excluded.metadata
      where campaign_executions.campaign_contact_id=excluded.campaign_contact_id
    returning id into v_execution_id;
    if v_execution_id is null then raise exception 'Execution key belongs to another contact'; end if;

    insert into public.campaign_events (
      campaign_id,campaign_contact_id,execution_id,source_event_id,event_name,occurred_at,
      channel,capture_method,metric_quality,context,properties
    ) values (
      v_campaign.id,v_contact.id,v_execution_id,p_source_event_id,p_event_name,p_occurred_at,
      p_channel,p_capture_method,p_metric_quality,coalesce(p_context,'{}'::jsonb),coalesce(p_properties,'{}'::jsonb)
    ) returning id into v_event_id;
  end if;

  -- Reconciliation is intentionally reapplied on retries after a partial caller failure.
  update public.campaign_contacts set
    last_event_at = greatest(coalesce(last_event_at,p_occurred_at),p_occurred_at),
    resource_started_at = case when p_event_name='tool_started' then coalesce(resource_started_at,p_occurred_at) else resource_started_at end,
    resource_completed_at = case when p_event_name in ('tool_completed','pdf_downloaded') then coalesce(resource_completed_at,p_occurred_at) else resource_completed_at end,
    meeting_booked_at = case when p_event_name='meeting_booked' then coalesce(meeting_booked_at,p_occurred_at) else meeting_booked_at end,
    meeting_completed_at = case when p_event_name='meeting_completed' then coalesce(meeting_completed_at,p_occurred_at) else meeting_completed_at end,
    opportunity_created_at = case when p_event_name='opportunity_created' then coalesce(opportunity_created_at,p_occurred_at) else opportunity_created_at end,
    cold_sequence_status = case when p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then 'stopped' else cold_sequence_status end,
    intent_sequence_status = case when p_event_name in ('bounce_hard','unsubscribe','meeting_booked','meeting_completed','opportunity_created') then 'stopped' else intent_sequence_status end,
    marketing_lane = case when p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then 'none' else marketing_lane end,
    suppression_scope = case when p_event_name='unsubscribe' then 'all' when p_event_name in ('bounce_hard','meeting_booked','meeting_completed','opportunity_created') then 'marketing' else suppression_scope end,
    sequence_status = case when p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then 'stopped' else sequence_status end,
    next_delivery_status = case when p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then 'stopped' else next_delivery_status end,
    transactional_status = case when p_event_name in ('tool_completed','pdf_downloaded') then 'pending' when p_event_name='transactional_delivery_sent' then 'sent' when p_event_name='transactional_delivery_failed' then 'retrying' else transactional_status end,
    stopped_at = case when p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then coalesce(stopped_at,p_occurred_at) else stopped_at end,
    stopped_reason = case when p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then coalesce(stopped_reason,p_event_name) else stopped_reason end
  where id=v_contact.id;

  if p_event_name in ('reply_received','bounce_hard','unsubscribe','tool_completed','pdf_downloaded','meeting_booked','meeting_completed','opportunity_created') then
    update public.campaign_executions set status='stopped',stopped_at=coalesce(stopped_at,p_occurred_at),stop_reason=coalesce(stop_reason,p_event_name)
    where campaign_contact_id=v_contact.id and status='planned';
  end if;

  return jsonb_build_object('event_id',v_event_id,'execution_id',v_execution_id,'duplicate',v_duplicate);
end;
$$;

alter table public.campaign_executions enable row level security;
revoke all privileges on table public.campaign_executions from anon, authenticated;
revoke execute on function public.record_campaign_tracking_event(text,text,text,text,text,text,text,timestamptz,timestamptz,integer,jsonb,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.record_campaign_tracking_event(text,text,text,text,text,text,text,timestamptz,timestamptz,integer,jsonb,jsonb,text,text) to service_role;

commit;
