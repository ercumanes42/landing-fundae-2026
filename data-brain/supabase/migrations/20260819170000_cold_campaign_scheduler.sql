-- Data Brain-authoritative cold campaign scheduler. Local artifact only; defaults OFF.
begin;

create table public.cold_campaign_message_payloads (
  campaign_execution_id uuid primary key references public.campaign_executions(id) on delete restrict,
  recipient_email text not null check (recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  subject text not null check (length(subject) between 1 and 200 and subject !~ E'[\r\n]'),
  html_body text not null check (length(html_body) between 100 and 100000),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  unsubscribe_materialized boolean not null default false check (unsubscribe_materialized),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint cold_payload_unsubscribe_present check (html_body like '%/baja?token=%')
);

create table public.cold_campaign_dispatch_outbox (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true check (singleton),
  campaign_execution_id uuid not null unique references public.campaign_executions(id) on delete restrict,
  status text not null default 'queued' check (status in (
    'queued','claimed','reserved','confirmed_sent','definitive_failed','suppressed','ambiguous_halted'
  )),
  worker_id uuid,
  worker_token_hash text check (worker_token_hash is null or worker_token_hash ~ '^[a-f0-9]{64}$'),
  claim_attempt integer not null default 0 check (claim_attempt between 0 and 20),
  claim_expires_at timestamptz,
  reservation_id uuid references public.mailbox_delivery_reservations(id) on delete restrict,
  last_reason_code text,
  terminal_evidence_hash text check (terminal_evidence_hash is null or terminal_evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  terminal_at timestamptz,
  constraint cold_dispatch_claim_shape check (
    (status = 'queued' and worker_id is null and worker_token_hash is null and claim_expires_at is null) or
    (status in ('claimed','reserved') and worker_id is not null and worker_token_hash is not null and claim_expires_at is not null) or
    (status in ('confirmed_sent','definitive_failed','suppressed','ambiguous_halted') and terminal_at is not null)
  )
);

create unique index cold_campaign_single_inflight_idx
  on public.cold_campaign_dispatch_outbox(singleton)
  where status in ('claimed','reserved');
create index cold_campaign_dispatch_queue_idx
  on public.cold_campaign_dispatch_outbox(status, created_at, id);

create table public.cold_campaign_scheduler_alerts (
  id bigint generated always as identity primary key,
  code text not null check (code ~ '^[A-Z0-9_]{3,64}$'),
  dispatch_id uuid references public.cold_campaign_dispatch_outbox(id) on delete restrict,
  evidence_hash text check (evidence_hash is null or evidence_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  acknowledged_at timestamptz
);
create index cold_campaign_alerts_open_idx on public.cold_campaign_scheduler_alerts(occurred_at)
  where acknowledged_at is null;

alter table public.cold_campaign_message_payloads enable row level security;
alter table public.cold_campaign_message_payloads force row level security;
alter table public.cold_campaign_dispatch_outbox enable row level security;
alter table public.cold_campaign_dispatch_outbox force row level security;
alter table public.cold_campaign_scheduler_alerts enable row level security;
alter table public.cold_campaign_scheduler_alerts force row level security;
revoke all on public.cold_campaign_message_payloads, public.cold_campaign_dispatch_outbox,
  public.cold_campaign_scheduler_alerts from public, anon, authenticated, service_role;

create or replace function public.claim_cold_campaign_dispatch(
  p_worker_id uuid, p_worker_token text, p_lease_seconds integer default 120
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz;
  v_control public.outbound_delivery_control%rowtype;
  v_dispatch public.cold_campaign_dispatch_outbox%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_campaign public.campaigns%rowtype;
  v_outbox public.graph_outbox%rowtype;
  v_stop text;
  v_evidence text;
begin
  if p_worker_id is null or p_worker_token is null or p_worker_token !~ '^[A-Za-z0-9_-]{43}$' or
     p_lease_seconds not between 60 and 300 then
    return jsonb_build_object('accepted',false,'reason_code','invalid_request','items','[]'::jsonb);
  end if;
  select * into v_control from public.outbound_delivery_control where singleton for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or not v_control.master_enabled or not v_control.cold_enabled then
    return jsonb_build_object('accepted',false,'reason_code','master_or_lane_disabled','items','[]'::jsonb);
  end if;
  if v_control.operating_timezone <> 'Europe/Madrid' or v_control.minimum_spacing_seconds < 60 or
     v_control.cold_daily_limit > 480 then
    return jsonb_build_object('accepted',false,'reason_code','control_drift','items','[]'::jsonb);
  end if;

  select * into v_dispatch from public.cold_campaign_dispatch_outbox
  where status in ('claimed','reserved') and claim_expires_at <= v_now
  order by created_at, id for update limit 1;
  if not found then
    insert into public.cold_campaign_dispatch_outbox(campaign_execution_id)
    select ce.id from public.campaign_executions ce
    join public.cold_campaign_message_payloads mp on mp.campaign_execution_id = ce.id
    join public.campaign_contacts cc on cc.id = ce.campaign_contact_id
    where ce.status = 'planned' and ce.channel = 'email' and ce.action_name = 'delivery_scheduled'
      and ce.step = cc.current_step
      and not exists (
        select 1 from pg_catalog.generate_series(1, ce.step - 1) prior_step
        where not exists (
          select 1 from public.campaign_executions prior
          join public.cold_campaign_dispatch_outbox prior_dispatch on prior_dispatch.campaign_execution_id = prior.id
          where prior.campaign_id = ce.campaign_id and prior.campaign_contact_id = ce.campaign_contact_id
            and prior.channel = 'email' and prior.action_name = 'delivery_scheduled'
            and prior.step = prior_step and prior.status = 'executed'
            and prior_dispatch.status = 'confirmed_sent'
        )
      )
      and ce.scheduled_for <= v_now
      and not exists (select 1 from public.cold_campaign_dispatch_outbox d where d.campaign_execution_id = ce.id)
    order by ce.scheduled_for, ce.id limit 1
    on conflict (campaign_execution_id) do nothing;
    select * into v_dispatch from public.cold_campaign_dispatch_outbox
    where status = 'queued' order by created_at, id for update skip locked limit 1;
  end if;
  if not found then
    return jsonb_build_object('accepted',true,'reason_code','empty','items','[]'::jsonb);
  end if;

  select * into v_execution from public.campaign_executions where id = v_dispatch.campaign_execution_id for update;
  select * into v_contact from public.campaign_contacts where id = v_execution.campaign_contact_id for update;
  select * into v_campaign from public.campaigns where id = v_execution.campaign_id for update;
  v_now := pg_catalog.clock_timestamp();
  if v_dispatch.claim_attempt >= 20 then
    v_evidence := encode(extensions.digest(convert_to('cold-claim-attempts-exhausted-v1' || v_dispatch.id::text,'UTF8'),'sha256'),'hex');
    update public.cold_campaign_dispatch_outbox set status='ambiguous_halted',last_reason_code='claim_attempts_exhausted',terminal_evidence_hash=v_evidence,terminal_at=v_now,updated_at=v_now where id=v_dispatch.id;
    update public.outbound_delivery_control set cold_enabled=false,halt_reason='CLAIM_ATTEMPTS_EXHAUSTED',updated_at=v_now where singleton;
    insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash) values('CLAIM_ATTEMPTS_EXHAUSTED',v_dispatch.id,v_evidence);
    return jsonb_build_object('accepted',false,'reason_code','ambiguous_halted','items','[]'::jsonb);
  end if;
  if not v_campaign.is_active or v_campaign.status not in ('active','running','pilot') then v_stop := 'campaign_inactive';
  elsif v_execution.status <> 'planned' or v_execution.channel <> 'email' or v_execution.action_name <> 'delivery_scheduled' then v_stop := 'execution_unavailable';
  elsif v_execution.step is null or v_execution.step <> v_contact.current_step or exists (
      select 1 from pg_catalog.generate_series(1, v_execution.step - 1) prior_step
      where not exists (
        select 1 from public.campaign_executions prior
        join public.cold_campaign_dispatch_outbox prior_dispatch on prior_dispatch.campaign_execution_id=prior.id
        where prior.campaign_id=v_execution.campaign_id and prior.campaign_contact_id=v_execution.campaign_contact_id
          and prior.channel='email' and prior.action_name='delivery_scheduled' and prior.step=prior_step
          and prior.status='executed' and prior_dispatch.status='confirmed_sent'
      )) then v_stop := 'sequence_prerequisite_unmet';
  elsif v_contact.suppression_scope <> 'none' or v_contact.marketing_lane <> 'cold' or
        v_contact.cold_sequence_status not in ('pending','active') then v_stop := 'suppressed';
  elsif v_contact.reply_received_at is not null then v_stop := 'reply_human';
  elsif v_contact.meeting_booked_at is not null or v_contact.meeting_completed_at is not null then v_stop := 'meeting';
  elsif exists (select 1 from public.campaign_suppressions s where s.identity_hash = v_contact.email_hash) then v_stop := 'suppression';
  elsif exists (select 1 from public.campaign_contacts other where other.campaign_id=v_contact.campaign_id
        and other.email_hash=v_contact.email_hash and other.id<>v_contact.id and other.sequence_status not in ('stopped','completed')) then v_stop := 'duplicate';
  elsif exists (select 1 from public.campaign_events e where e.campaign_contact_id=v_contact.id and
        e.event_name in ('reply_received','positive_reply','unsubscribe','opposition','bounce_hard','meeting_booked','meeting_completed')) then v_stop := 'terminal_event';
  end if;
  if v_stop is not null then
    update public.cold_campaign_dispatch_outbox set status='suppressed', last_reason_code=v_stop,
      terminal_at=v_now, updated_at=v_now where id=v_dispatch.id;
    update public.campaign_executions set status='stopped', stopped_at=v_now, stop_reason=v_stop where id=v_execution.id;
    return jsonb_build_object('accepted',true,'reason_code','suppressed','items','[]'::jsonb);
  end if;

  if v_dispatch.reservation_id is not null then
    select * into v_outbox from public.graph_outbox where reservation_id=v_dispatch.reservation_id and lane='cold';
    if not found then
      v_evidence := encode(extensions.digest(convert_to('cold-reservation-binding-missing-v1' || v_dispatch.id::text,'UTF8'),'sha256'),'hex');
      update public.cold_campaign_dispatch_outbox set status='ambiguous_halted', last_reason_code='reservation_binding_missing',
        terminal_evidence_hash=v_evidence,terminal_at=v_now, updated_at=v_now where id=v_dispatch.id;
      update public.outbound_delivery_control set cold_enabled=false,halt_reason='RESERVATION_BINDING_MISSING',updated_at=v_now where singleton;
      insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash) values('RESERVATION_BINDING_MISSING',v_dispatch.id,v_evidence);
      return jsonb_build_object('accepted',false,'reason_code','ambiguous_halted','items','[]'::jsonb);
    end if;
  end if;
  v_now := pg_catalog.clock_timestamp();
  update public.cold_campaign_dispatch_outbox set status=case when reservation_id is null then 'claimed' else 'reserved' end,
    worker_id=p_worker_id, worker_token_hash=encode(extensions.digest(convert_to(p_worker_token,'UTF8'),'sha256'),'hex'),
    claim_attempt=claim_attempt+1, claim_expires_at=v_now+make_interval(secs=>p_lease_seconds), updated_at=v_now
  where id=v_dispatch.id returning * into v_dispatch;
  return jsonb_build_object('accepted',true,'reason_code',case when v_dispatch.reservation_id is null then 'claimed' else 'reserved_recovery' end,
    'lease_expires_at',v_dispatch.claim_expires_at,'items',jsonb_build_array(jsonb_build_object(
      'dispatch_id',v_dispatch.id,'campaign_execution_id',v_execution.id,'campaign_external_id',v_campaign.external_id,
      'contact_id',v_contact.external_contact_id,'execution_key',v_execution.idempotency_key,'step',v_execution.step,
      'reservation_id',v_dispatch.reservation_id,'recovery_required',(v_dispatch.reservation_id is not null),
      'outbox_state',v_outbox.state,'graph_draft_immutable_id',v_outbox.graph_draft_immutable_id,
      'draft_neutralized',(v_outbox.draft_neutralized_at is not null),
      'outcome_evidence_hash',case when v_outbox.state='confirmed_sent' then v_outbox.sent_items_evidence_hash else v_outbox.terminal_evidence_hash end)));
end;
$$;

create or replace function public.get_claimed_cold_campaign_package(
  p_dispatch_id uuid, p_worker_id uuid, p_worker_token text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_dispatch public.cold_campaign_dispatch_outbox%rowtype; v_payload public.cold_campaign_message_payloads%rowtype; v_now timestamptz;
begin
  select * into v_dispatch from public.cold_campaign_dispatch_outbox where id=p_dispatch_id for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or v_dispatch.status not in ('claimed','reserved') or v_dispatch.worker_id<>p_worker_id or
    v_dispatch.worker_token_hash<>encode(extensions.digest(convert_to(p_worker_token,'UTF8'),'sha256'),'hex') or v_dispatch.claim_expires_at<=v_now then
    return jsonb_build_object('packaged',false,'reason_code','claim_unavailable');
  end if;
  select * into v_payload from public.cold_campaign_message_payloads where campaign_execution_id=v_dispatch.campaign_execution_id;
  if not found or not v_payload.unsubscribe_materialized then return jsonb_build_object('packaged',false,'reason_code','payload_unavailable'); end if;
  return jsonb_build_object('packaged',true,'recipient_email',v_payload.recipient_email,'subject',v_payload.subject,
    'html_body',v_payload.html_body,'payload_sha256',v_payload.payload_sha256);
end;
$$;

create or replace function public.bind_cold_campaign_reservation(
  p_dispatch_id uuid,p_worker_id uuid,p_worker_token text,p_mailbox_key_hash text,p_message_key_hash text,
  p_payload_sha256 text,p_finalize_capability_hash text,p_send_capability_hash text,p_opaque_marker text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_d public.cold_campaign_dispatch_outbox%rowtype; v_e public.campaign_executions%rowtype; v_c public.campaign_contacts%rowtype;
  v_campaign public.campaigns%rowtype; v_result jsonb; v_now timestamptz;
begin
  select * into v_d from public.cold_campaign_dispatch_outbox where id=p_dispatch_id for update; v_now:=pg_catalog.clock_timestamp();
  if not found or v_d.status not in ('claimed','reserved') or v_d.worker_id<>p_worker_id or v_d.claim_expires_at<=v_now or
    v_d.worker_token_hash<>encode(extensions.digest(convert_to(p_worker_token,'UTF8'),'sha256'),'hex') then
    return jsonb_build_object('authorized',false,'reason_code','claim_unavailable','duplicate',false);
  end if;
  if v_d.reservation_id is not null then
    return jsonb_build_object('authorized',true,'reason_code','reserved','duplicate',true,'reservation_id',v_d.reservation_id,'lease_expires_at',v_d.claim_expires_at);
  end if;
  select * into v_e from public.campaign_executions where id=v_d.campaign_execution_id;
  select * into v_c from public.campaign_contacts where id=v_e.campaign_contact_id;
  select * into v_campaign from public.campaigns where id=v_e.campaign_id;
  v_result:=public.reserve_cold_graph_delivery(v_campaign.external_id,v_c.external_contact_id,v_e.idempotency_key,
    p_mailbox_key_hash,p_message_key_hash,p_payload_sha256,p_finalize_capability_hash,p_send_capability_hash,p_opaque_marker);
  if (v_result->>'authorized')::boolean then
    update public.cold_campaign_dispatch_outbox set status='reserved',reservation_id=(v_result->>'reservation_id')::uuid,
      updated_at=v_now where id=v_d.id;
  end if;
  return v_result;
end;
$$;

create or replace function public.finalize_cold_campaign_dispatch(
  p_dispatch_id uuid,p_worker_id uuid,p_worker_token text,p_outcome text,p_evidence_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_d public.cold_campaign_dispatch_outbox%rowtype; v_o public.graph_outbox%rowtype; v_e public.campaign_executions%rowtype; v_c public.campaign_contacts%rowtype; v_control public.outbound_delivery_control%rowtype; v_now timestamptz; v_terminal_stop boolean;
begin
  if p_outcome not in ('confirmed_sent','definitive_failed','suppressed_before_send','ambiguous_halted') or p_evidence_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('accepted',false,'reason_code','invalid_request'); end if;
  select * into v_control from public.outbound_delivery_control where singleton for update;
  if not found then return jsonb_build_object('accepted',false,'reason_code','control_unavailable'); end if;
  select * into v_d from public.cold_campaign_dispatch_outbox where id=p_dispatch_id for update; v_now:=pg_catalog.clock_timestamp();
  if not found or v_d.worker_id<>p_worker_id or v_d.worker_token_hash<>encode(extensions.digest(convert_to(p_worker_token,'UTF8'),'sha256'),'hex') or v_d.reservation_id is null then
    return jsonb_build_object('accepted',false,'reason_code','claim_unavailable'); end if;
  select * into v_o from public.graph_outbox where reservation_id=v_d.reservation_id for update;
  if not found or v_o.lane<>'cold' or v_o.state<>p_outcome or coalesce(v_o.sent_items_evidence_hash,v_o.terminal_evidence_hash)<>p_evidence_hash then
    update public.cold_campaign_dispatch_outbox set status='ambiguous_halted',last_reason_code='terminal_evidence_mismatch',terminal_evidence_hash=p_evidence_hash,terminal_at=v_now,updated_at=v_now where id=v_d.id;
    update public.outbound_delivery_control set cold_enabled=false,halt_reason='TERMINAL_EVIDENCE_MISMATCH',updated_at=v_now where singleton;
    insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash) values('TERMINAL_EVIDENCE_MISMATCH',v_d.id,p_evidence_hash);
    return jsonb_build_object('accepted',false,'reason_code','ambiguous_halted');
  end if;
  select * into v_e from public.campaign_executions where id=v_d.campaign_execution_id for update;
  select * into v_c from public.campaign_contacts where id=v_e.campaign_contact_id for update;
  v_terminal_stop := v_c.sequence_status in ('stopped','completed') or v_c.cold_sequence_status in ('stopped','completed') or
    v_c.marketing_lane <> 'cold' or v_c.suppression_scope <> 'none' or v_c.reply_received_at is not null or
    v_c.meeting_booked_at is not null or v_c.meeting_completed_at is not null or exists (
      select 1 from public.campaign_suppressions s where s.identity_hash=v_c.email_hash
    );
  update public.cold_campaign_dispatch_outbox set status=case p_outcome when 'suppressed_before_send' then 'suppressed' else p_outcome end,
    terminal_evidence_hash=p_evidence_hash,terminal_at=v_now,updated_at=v_now where id=v_d.id;
  if p_outcome='ambiguous_halted' then
    update public.outbound_delivery_control set cold_enabled=false,halt_reason='GRAPH_AMBIGUOUS_HALTED',updated_at=v_now where singleton;
    insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash) values('GRAPH_AMBIGUOUS_HALTED',v_d.id,p_evidence_hash);
  end if;
  if p_outcome='confirmed_sent' then
    update public.campaign_executions set status='executed',actual_at=v_now where id=v_e.id;
    if v_terminal_stop then
      update public.campaign_contacts set last_delivery_status='confirmed_sent',lock_expires_at=null,locked_at=null
        where id=v_e.campaign_contact_id;
      update public.campaign_executions set status='stopped',stopped_at=v_now,stop_reason='terminal_stop_before_finalize'
        where campaign_id=v_e.campaign_id and campaign_contact_id=v_e.campaign_contact_id and channel='email'
          and action_name='delivery_scheduled' and status='planned' and step>v_e.step;
    else
      update public.campaign_contacts set current_step=least(5,current_step+1),
        cold_sequence_status=case when v_e.step>=5 then 'completed' else 'active' end,
        sequence_status=case when v_e.step>=5 then 'completed' else sequence_status end,
        next_delivery_status=case when v_e.step>=5 then 'completed' else 'pending' end,
        last_delivery_status='confirmed_sent',lock_expires_at=null,locked_at=null where id=v_e.campaign_contact_id;
    end if;
  else
    update public.campaign_executions set status=case when p_outcome='suppressed_before_send' then 'stopped' else 'failed' end,
      failed_at=case when p_outcome<>'suppressed_before_send' then v_now else failed_at end,
      stopped_at=case when p_outcome='suppressed_before_send' then v_now else stopped_at end,
      failure_code=p_outcome where id=v_e.id;
  end if;
  return jsonb_build_object('accepted',true,'reason_code',p_outcome,'reservation_id',v_d.reservation_id);
end;
$$;

create or replace function public.halt_cold_campaign_dispatch(
  p_dispatch_id uuid,p_worker_id uuid,p_worker_token text,p_reason_code text,p_evidence_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_d public.cold_campaign_dispatch_outbox%rowtype; v_control public.outbound_delivery_control%rowtype; v_now timestamptz;
begin
  if p_reason_code !~ '^[A-Z0-9_]{3,64}$' or p_evidence_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('accepted',false,'reason_code','invalid_request'); end if;
  select * into v_control from public.outbound_delivery_control where singleton for update;
  if not found then return jsonb_build_object('accepted',false,'reason_code','control_unavailable'); end if;
  select * into v_d from public.cold_campaign_dispatch_outbox where id=p_dispatch_id for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or v_d.worker_id<>p_worker_id or
    v_d.worker_token_hash<>encode(extensions.digest(convert_to(p_worker_token,'UTF8'),'sha256'),'hex') then
    return jsonb_build_object('accepted',false,'reason_code','claim_unavailable'); end if;
  update public.cold_campaign_dispatch_outbox set status='ambiguous_halted',last_reason_code=p_reason_code,
    terminal_evidence_hash=p_evidence_hash,terminal_at=v_now,updated_at=v_now where id=v_d.id;
  update public.outbound_delivery_control set cold_enabled=false,halt_reason=p_reason_code,updated_at=v_now where singleton;
  insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash)
    values(p_reason_code,v_d.id,p_evidence_hash);
  return jsonb_build_object('accepted',true,'reason_code','ambiguous_halted');
end;
$$;revoke execute on function public.claim_cold_campaign_dispatch(uuid,text,integer) from public,anon,authenticated;
revoke execute on function public.get_claimed_cold_campaign_package(uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.finalize_cold_campaign_dispatch(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke execute on function public.halt_cold_campaign_dispatch(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.halt_cold_campaign_dispatch(uuid,uuid,text,text,text) to service_role;
grant execute on function public.claim_cold_campaign_dispatch(uuid,text,integer) to service_role;
grant execute on function public.get_claimed_cold_campaign_package(uuid,uuid,text) to service_role;
grant execute on function public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text) to service_role;
grant execute on function public.finalize_cold_campaign_dispatch(uuid,uuid,text,text,text) to service_role;

commit;
