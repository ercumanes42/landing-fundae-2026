-- Final fail-closed barriers for cold outbound and atomic campaign event materialization.
-- Local artifact only. This migration leaves every outbound lane OFF and sends nothing.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '10min';

alter table public.campaign_contacts
  add column if not exists reply_received_at timestamptz;

alter table public.campaign_suppressions
  drop constraint if exists campaign_suppressions_scope_reason_check;
alter table public.campaign_suppressions
  add constraint campaign_suppressions_scope_reason_check check (
    (scope = 'all' and reason = 'unsubscribe') or
    (scope = 'marketing' and reason in ('hard_bounce','opposition'))
  ) not valid;
alter table public.campaign_suppressions
  validate constraint campaign_suppressions_scope_reason_check;

create or replace function public.cold_outbound_barrier_reason(
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
begin
  if p_now is null or p_now < pg_catalog.clock_timestamp() - interval '5 minutes'
     or p_now > pg_catalog.clock_timestamp() + interval '1 minute' then
    return 'invalid_safety_clock';
  end if;
  if pg_catalog.to_regclass('public.operational_heartbeats') is null or
     pg_catalog.to_regclass('public.operational_alerts') is null or
     pg_catalog.to_regclass('public.inbound_event_ledger') is null or
     pg_catalog.to_regclass('public.inbound_alerts') is null then
    return 'safety_tables_unavailable';
  end if;
  if exists(select 1 from public.operational_alerts where severity='critical' and lifecycle<>'resolved') then
    return 'critical_alert_open';
  end if;
  select required.signal_code into v_reason
  from (values
    ('oauth',600),('mailbox',900),('reply_processor',900),
    ('unsubscribe_processor',900),('hard_bounce_processor',900)
  ) required(signal_code,max_age_seconds)
  left join public.operational_heartbeats heartbeat on heartbeat.signal_code=required.signal_code
  where heartbeat.signal_code is null or heartbeat.status<>'healthy' or
    heartbeat.observed_at < p_now-pg_catalog.make_interval(secs=>required.max_age_seconds)
  order by required.signal_code limit 1;
  if v_reason is not null then return 'heartbeat_unhealthy_or_stale:'||v_reason; end if;
  if exists(select 1 from public.inbound_event_ledger where status in ('processing','manual_review')) or
     exists(select 1 from public.inbound_alerts where status<>'resolved') then
    return 'inbound_stop_backlog';
  end if;
  return null;
end;
$$;

-- Serialize creation of inbound backlog against cold claim/JIT checks.
alter function public.claim_inbound_event(text,text,text,jsonb,integer)
  rename to claim_inbound_event_pre_safety_20260819;
create or replace function public.claim_inbound_event(
  p_provider text,p_source_event_hash text,p_event_kind text,p_evidence jsonb,p_lease_seconds integer
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_control public.outbound_delivery_control%rowtype;
begin
  select * into v_control from public.outbound_delivery_control where singleton for update;
  if not found then raise exception using errcode='55000',message='outbound_control_unavailable'; end if;
  return public.claim_inbound_event_pre_safety_20260819(
    p_provider,p_source_event_hash,p_event_kind,p_evidence,p_lease_seconds
  );
end;
$$;
revoke insert,update,delete on public.inbound_event_ledger,public.inbound_alerts from service_role;

-- Serialize critical alert materialization against cold claim/JIT checks and kill cold atomically.
alter function public.reconcile_operational_alerts(text,timestamptz,text,jsonb,text[])
  rename to reconcile_operational_alerts_pre_safety_20260819;
create or replace function public.reconcile_operational_alerts(
  p_evaluation_key text,p_evaluated_at timestamptz,p_actor_hash text,
  p_alerts jsonb,p_managed_signal_codes text[]
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_control public.outbound_delivery_control%rowtype; v_result jsonb; v_now timestamptz;
begin
  select * into v_control from public.outbound_delivery_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found then raise exception using errcode='55000',message='outbound_control_unavailable'; end if;
  v_result:=public.reconcile_operational_alerts_pre_safety_20260819(
    p_evaluation_key,p_evaluated_at,p_actor_hash,p_alerts,p_managed_signal_codes
  );
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_alerts) item where item->>'severity'='critical') then
    update public.outbound_delivery_control set cold_enabled=false,
      halt_reason='CRITICAL_OPERATIONAL_ALERT',updated_at=v_now where singleton;
  end if;
  return v_result;
end;
$$;

-- Wrap cold claim without copying scheduler logic.
alter function public.claim_cold_campaign_dispatch(uuid,text,integer)
  rename to claim_cold_campaign_dispatch_pre_safety_20260819;
create or replace function public.claim_cold_campaign_dispatch(
  p_worker_id uuid,p_worker_token text,p_lease_seconds integer default 120
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_control public.outbound_delivery_control%rowtype; v_reason text; v_now timestamptz; v_evidence text;
begin
  select * into v_control from public.outbound_delivery_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found then return pg_catalog.jsonb_build_object('accepted',false,'reason_code','control_unavailable','items','[]'::jsonb); end if;
  v_reason:=public.cold_outbound_barrier_reason(v_now);
  if v_reason is not null then
    v_evidence:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to('cold-safety-v1'||v_reason,'UTF8'),'sha256'),'hex');
    update public.outbound_delivery_control set cold_enabled=false,halt_reason='COLD_SAFETY_BARRIER',updated_at=v_now where singleton;
    insert into public.cold_campaign_scheduler_alerts(code,evidence_hash) values('COLD_SAFETY_BARRIER',v_evidence);
    return pg_catalog.jsonb_build_object('accepted',false,'reason_code',v_reason,'items','[]'::jsonb);
  end if;
  return public.claim_cold_campaign_dispatch_pre_safety_20260819(p_worker_id,p_worker_token,p_lease_seconds);
end;
$$;

-- A backlog committed after claim still blocks reservation.
alter function public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text)
  rename to bind_cold_campaign_reservation_pre_safety_20260819;
create or replace function public.bind_cold_campaign_reservation(
  p_dispatch_id uuid,p_worker_id uuid,p_worker_token text,p_mailbox_key_hash text,p_message_key_hash text,
  p_payload_sha256 text,p_finalize_capability_hash text,p_send_capability_hash text,p_opaque_marker text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_control public.outbound_delivery_control%rowtype; v_reason text; v_now timestamptz;
begin
  select * into v_control from public.outbound_delivery_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found then return pg_catalog.jsonb_build_object('authorized',false,'reason_code','control_unavailable','duplicate',false); end if;
  v_reason:=public.cold_outbound_barrier_reason(v_now);
  if v_reason is not null then
    update public.outbound_delivery_control set cold_enabled=false,halt_reason='COLD_SAFETY_BARRIER',updated_at=v_now where singleton;
    return pg_catalog.jsonb_build_object('authorized',false,'reason_code',v_reason,'duplicate',false);
  end if;
  return public.bind_cold_campaign_reservation_pre_safety_20260819(
    p_dispatch_id,p_worker_id,p_worker_token,p_mailbox_key_hash,p_message_key_hash,
    p_payload_sha256,p_finalize_capability_hash,p_send_capability_hash,p_opaque_marker
  );
end;
$$;

-- Final JIT barrier: a reserved/drafted cold message cannot authorize send while stops are stale/pending.
alter function public.authorize_graph_draft_send(uuid,text,text,text)
  rename to authorize_graph_draft_send_pre_safety_20260819;
create or replace function public.authorize_graph_draft_send(
  p_reservation_id uuid,p_send_capability_hash text,p_stop_snapshot_hash text,
  p_observed_change_key_hash text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_control public.outbound_delivery_control%rowtype; v_outbox public.graph_outbox%rowtype; v_reason text; v_now timestamptz;
begin
  select * into v_control from public.outbound_delivery_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found then return pg_catalog.jsonb_build_object('authorized',false,'duplicate',false,'reason_code','control_unavailable'); end if;
  select * into v_outbox from public.graph_outbox where reservation_id=p_reservation_id for update;
  if found and v_outbox.lane='cold' then
    v_reason:=public.cold_outbound_barrier_reason(v_now);
    if v_reason is not null then
      update public.outbound_delivery_control set cold_enabled=false,halt_reason='COLD_SAFETY_BARRIER',updated_at=v_now where singleton;
      return pg_catalog.jsonb_build_object('authorized',false,'duplicate',false,'reason_code',v_reason,'reservation_id',p_reservation_id);
    end if;
  end if;
  return public.authorize_graph_draft_send_pre_safety_20260819(
    p_reservation_id,p_send_capability_hash,p_stop_snapshot_hash,p_observed_change_key_hash
  );
end;
$$;

-- One transaction owns dedupe, event insertion and all contact/sequence stop effects.
create or replace function public.record_campaign_event_atomic(
  p_campaign_external_id text,p_contact_external_id text,p_event_name text,
  p_occurred_at timestamptz,p_source_event_id text,p_context jsonb,p_properties jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_event public.campaign_events%rowtype;
  v_duplicate boolean:=false;
  v_stop boolean;
  v_suppress_marketing boolean;
begin
  if p_campaign_external_id !~ '^[A-Za-z0-9_-]{3,100}$' or
     p_contact_external_id !~ '^[A-Za-z0-9_-]{3,100}$' or
     p_event_name not in ('landing_visit','resource_started','resource_completed','checklist_downloaded',
       'calculator_completed','webinar_registered','review_submitted','diagnostic_intent','diagnostic_requested',
       'positive_reply','meeting_booked','meeting_completed','opportunity_created','delivery_sent',
       'transactional_delivery_sent','delivery_error','reply_received','bounce_hard','unsubscribe','opposition','crm_contact_updated') or
     p_occurred_at is null or p_occurred_at>pg_catalog.clock_timestamp()+interval '5 minutes' or
     (p_source_event_id is not null and pg_catalog.length(p_source_event_id) not between 1 and 256) or
     pg_catalog.jsonb_typeof(p_context)<>'object' or pg_catalog.jsonb_typeof(p_properties)<>'object' then
    raise exception using errcode='22023',message='campaign_event_invalid';
  end if;
  select * into v_campaign from public.campaigns where external_id=p_campaign_external_id for update;
  if not found then raise exception using errcode='P0002',message='campaign_unavailable'; end if;
  select * into v_contact from public.campaign_contacts
  where campaign_id=v_campaign.id and external_contact_id=p_contact_external_id for update;
  if not found then raise exception using errcode='P0002',message='campaign_contact_unavailable'; end if;
  if p_source_event_id is not null then
    select * into v_event from public.campaign_events
    where campaign_id=v_campaign.id and source_event_id=p_source_event_id for update;
    if found then
      if v_event.campaign_contact_id<>v_contact.id or v_event.event_name<>p_event_name then
        raise exception using errcode='23505',message='campaign_source_event_collision';
      end if;
      v_duplicate:=true;
    end if;
  end if;
  if not v_duplicate then
    insert into public.campaign_events(campaign_id,campaign_contact_id,source_event_id,event_name,occurred_at,context,properties)
    values(v_campaign.id,v_contact.id,p_source_event_id,p_event_name,p_occurred_at,p_context,p_properties)
    returning * into v_event;
  end if;
  v_stop:=p_event_name in ('resource_completed','checklist_downloaded','calculator_completed','webinar_registered',
    'review_submitted','diagnostic_intent','diagnostic_requested','positive_reply','meeting_booked','meeting_completed',
    'opportunity_created','reply_received','bounce_hard','unsubscribe','opposition');
  v_suppress_marketing:=p_event_name in ('meeting_booked','meeting_completed','opportunity_created','bounce_hard','unsubscribe','opposition');
  update public.campaign_contacts set
    last_event_at=greatest(coalesce(last_event_at,p_occurred_at),p_occurred_at),
    resource_started_at=case when p_event_name='resource_started' then greatest(coalesce(resource_started_at,p_occurred_at),p_occurred_at) else resource_started_at end,
    resource_completed_at=case when p_event_name in ('resource_completed','checklist_downloaded','calculator_completed','webinar_registered','review_submitted') then greatest(coalesce(resource_completed_at,p_occurred_at),p_occurred_at) else resource_completed_at end,
    meeting_booked_at=case when p_event_name='meeting_booked' then greatest(coalesce(meeting_booked_at,p_occurred_at),p_occurred_at) else meeting_booked_at end,
    meeting_completed_at=case when p_event_name='meeting_completed' then greatest(coalesce(meeting_completed_at,p_occurred_at),p_occurred_at) else meeting_completed_at end,
    opportunity_created_at=case when p_event_name='opportunity_created' then greatest(coalesce(opportunity_created_at,p_occurred_at),p_occurred_at) else opportunity_created_at end,
    reply_received_at=case when p_event_name in ('reply_received','positive_reply') then coalesce(reply_received_at,p_occurred_at) else reply_received_at end,
    cold_sequence_status=case when v_stop then 'stopped' else cold_sequence_status end,
    intent_sequence_status=case when p_event_name in ('unsubscribe','bounce_hard','meeting_booked','meeting_completed','opportunity_created') then 'stopped' when p_event_name in ('diagnostic_intent','diagnostic_requested','positive_reply') then 'eligible_disabled' else intent_sequence_status end,
    transactional_status=case when p_event_name in ('resource_completed','checklist_downloaded','calculator_completed','webinar_registered','review_submitted') then 'pending' when p_event_name='transactional_delivery_sent' then 'sent' else transactional_status end,
    marketing_lane=case when v_stop then 'none' else marketing_lane end,
    suppression_scope=case when p_event_name='unsubscribe' then 'all' when v_suppress_marketing then 'marketing' else suppression_scope end,
    sequence_status=case when v_stop then 'stopped' else sequence_status end,
    next_delivery_status=case when v_stop then 'stopped' else next_delivery_status end,
    stopped_at=case when v_stop then coalesce(stopped_at,p_occurred_at) else stopped_at end,
    stopped_reason=case when v_stop then coalesce(stopped_reason,p_event_name) else stopped_reason end,
    suppressed_at=case when v_suppress_marketing then coalesce(suppressed_at,p_occurred_at) else suppressed_at end,
    suppression_reason=case when v_suppress_marketing then coalesce(suppression_reason,p_event_name) else suppression_reason end
  where id=v_contact.id;
  if p_event_name='opposition' then
    insert into public.campaign_suppressions(
      identity_hash,scope,reason,occurred_at,source_event_id,source_campaign_id,source_contact_id
    ) values (
      v_contact.email_hash,'marketing','opposition',p_occurred_at,p_source_event_id,v_campaign.id,v_contact.id
    ) on conflict(identity_hash) do update set
      scope=case when public.campaign_suppressions.scope='all' then 'all' else 'marketing' end,
      reason=case
        when public.campaign_suppressions.scope='all' then 'unsubscribe'
        when public.campaign_suppressions.reason='hard_bounce' then 'hard_bounce'
        else 'opposition'
      end,
      occurred_at=least(public.campaign_suppressions.occurred_at,excluded.occurred_at),
      source_event_id=coalesce(public.campaign_suppressions.source_event_id,excluded.source_event_id),
      source_campaign_id=coalesce(public.campaign_suppressions.source_campaign_id,excluded.source_campaign_id),
      source_contact_id=coalesce(public.campaign_suppressions.source_contact_id,excluded.source_contact_id),
      updated_at=pg_catalog.clock_timestamp();
    update public.campaign_contacts set
      cold_sequence_status='stopped',intent_sequence_status='stopped',marketing_lane='none',
      suppression_scope=case when suppression_scope='all' then 'all' else 'marketing' end,
      sequence_status='stopped',next_delivery_status='stopped',next_scheduled_at=null,
      locked_at=null,lock_token=null,lock_expires_at=null,
      stopped_at=coalesce(stopped_at,p_occurred_at),
      stopped_reason=coalesce(stopped_reason,'opposition'),
      suppressed_at=coalesce(suppressed_at,p_occurred_at),
      suppression_reason=coalesce(suppression_reason,'opposition')
    where email_hash=v_contact.email_hash;
    update public.campaign_executions set status='stopped',
      stopped_at=coalesce(stopped_at,p_occurred_at),
      stop_reason=coalesce(stop_reason,'opposition')
    where status='planned' and campaign_contact_id in (
      select id from public.campaign_contacts where email_hash=v_contact.email_hash
    );
  end if;
  if v_stop then
    update public.campaign_executions set status='stopped',stopped_at=coalesce(stopped_at,p_occurred_at),
      stop_reason=coalesce(stop_reason,p_event_name)
    where campaign_contact_id=v_contact.id and status='planned';
  end if;
  return pg_catalog.jsonb_build_object('id',v_event.id,'duplicate',v_duplicate);
end;
$$;

revoke execute on function public.cold_outbound_barrier_reason(timestamptz) from public,anon,authenticated,service_role;
revoke execute on function public.claim_inbound_event_pre_safety_20260819(text,text,text,jsonb,integer) from public,anon,authenticated,service_role;
revoke execute on function public.reconcile_operational_alerts_pre_safety_20260819(text,timestamptz,text,jsonb,text[]) from public,anon,authenticated,service_role;
revoke execute on function public.claim_cold_campaign_dispatch_pre_safety_20260819(uuid,text,integer) from public,anon,authenticated,service_role;
revoke execute on function public.bind_cold_campaign_reservation_pre_safety_20260819(uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.authorize_graph_draft_send_pre_safety_20260819(uuid,text,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.record_campaign_event_atomic(text,text,text,timestamptz,text,jsonb,jsonb) from public,anon,authenticated;
revoke execute on function public.claim_inbound_event(text,text,text,jsonb,integer) from public,anon,authenticated;
revoke execute on function public.reconcile_operational_alerts(text,timestamptz,text,jsonb,text[]) from public,anon,authenticated;
revoke execute on function public.claim_cold_campaign_dispatch(uuid,text,integer) from public,anon,authenticated;
revoke execute on function public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.authorize_graph_draft_send(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_campaign_event_atomic(text,text,text,timestamptz,text,jsonb,jsonb) to service_role;
grant execute on function public.claim_inbound_event(text,text,text,jsonb,integer) to service_role;
grant execute on function public.reconcile_operational_alerts(text,timestamptz,text,jsonb,text[]) to service_role;
grant execute on function public.claim_cold_campaign_dispatch(uuid,text,integer) to service_role;
grant execute on function public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text) to service_role;
grant execute on function public.authorize_graph_draft_send(uuid,text,text,text) to service_role;

commit;
