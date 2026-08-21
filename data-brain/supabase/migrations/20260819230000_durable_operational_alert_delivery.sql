-- Durable, claimable delivery intent for critical Graph/dispatch alerts.
-- This migration only adds fail-closed persistence and retry machinery; it enables no lane.
begin;

set local lock_timeout='10s';
set local statement_timeout='10min';
set local search_path='';

alter table public.transactional_dispatch_outbox
  add column last_reason_code text check (
    last_reason_code is null or last_reason_code ~ '^[A-Z][A-Z0-9_:-]{2,63}$'
  );

alter table public.operational_alert_receipts
  add column delivery_status text not null default 'not_requested',
  add column reservation_hash text,
  add column evidence_hash text,
  add column delivery_attempt_count integer not null default 0,
  add column next_attempt_at timestamptz,
  add column claimed_by_hash text,
  add column claim_token_hash text,
  add column claim_expires_at timestamptz,
  add column delivered_at timestamptz,
  add column last_attempt_evidence_hash text,
  add column last_failure_code text,
  add column delivery_updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  add constraint operational_alert_receipts_delivery_status_check check (
    delivery_status in ('not_requested','pending','claimed','delivered','dead_letter')
  ),
  add constraint operational_alert_receipts_delivery_attempt_check check (
    delivery_attempt_count between 0 and 8
  ),
  add constraint operational_alert_receipts_delivery_hashes_check check (
    (delivery_status='not_requested' and reservation_hash is null and evidence_hash is null)
    or (delivery_status<>'not_requested' and reservation_hash is not null
      and reservation_hash ~ '^[a-f0-9]{64}$' and evidence_hash is not null
      and evidence_hash ~ '^[a-f0-9]{64}$')
  ),
  add constraint operational_alert_receipts_delivery_claim_check check (
    (delivery_status='claimed' and claimed_by_hash is not null
      and claimed_by_hash ~ '^[a-f0-9]{64}$' and claim_token_hash is not null
      and claim_token_hash ~ '^[a-f0-9]{64}$' and claim_expires_at is not null)
    or (delivery_status<>'claimed' and claimed_by_hash is null
      and claim_token_hash is null and claim_expires_at is null)
  ),
  add constraint operational_alert_receipts_delivery_terminal_check check (
    (delivery_status='delivered' and delivered_at is not null
      and last_attempt_evidence_hash is not null
      and last_attempt_evidence_hash ~ '^[a-f0-9]{64}$')
    or (delivery_status<>'delivered' and delivered_at is null)
  ),
  add constraint operational_alert_receipts_delivery_optional_hash_check check (
    last_attempt_evidence_hash is null or last_attempt_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  add constraint operational_alert_receipts_delivery_failure_check check (
    last_failure_code is null or last_failure_code ~ '^[A-Z][A-Z0-9_:-]{1,63}$'
  );

create index operational_alert_receipts_delivery_pending_idx
  on public.operational_alert_receipts(next_attempt_at,observed_at,evaluation_key,dedupe_key)
  where delivery_status='pending';
create index operational_alert_receipts_delivery_claimed_idx
  on public.operational_alert_receipts(claim_expires_at,observed_at,evaluation_key,dedupe_key)
  where delivery_status='claimed';

create or replace function fundae_private.normalize_operational_alert_code(p_code text)
returns text
language sql
immutable
set search_path=''
as $$
  select case
    when substring(
      pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_code,''),'[^A-Za-z0-9_]+','_','g'))
      from 1 for 64
    ) ~ '^[A-Z][A-Z0-9_]{2,63}$'
    then substring(
      pg_catalog.upper(pg_catalog.regexp_replace(p_code,'[^A-Za-z0-9_]+','_','g'))
      from 1 for 64
    )
    else 'AMBIGUOUS_GRAPH_OUTBOX_HALTED'
  end
$$;

revoke all on function fundae_private.normalize_operational_alert_code(text)
  from public,anon,authenticated,service_role;

create or replace function public.enqueue_operational_alert_delivery(
  p_summary_code text,
  p_reservation_hash text,
  p_evidence_hash text,
  p_actor_hash text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_summary text := fundae_private.normalize_operational_alert_code(p_summary_code);
  v_dedupe_key text;
  v_evaluation_key text;
  v_alert public.operational_alerts%rowtype;
  v_receipt public.operational_alert_receipts%rowtype;
  v_alert_inserted integer;
  v_receipt_inserted integer;
  v_previous_lifecycle text;
begin
  if p_summary_code is null or v_summary<>p_summary_code
     or p_reservation_hash is null or p_reservation_hash !~ '^[a-f0-9]{64}$'
     or p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$'
     or p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='invalid_operational_alert_delivery';
  end if;
  v_dedupe_key:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.concat_ws(pg_catalog.chr(31),'critical-alert-v1',v_summary,p_reservation_hash,p_evidence_hash),
    'UTF8'),'sha256'),'hex');
  v_evaluation_key:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.concat_ws(pg_catalog.chr(31),'critical-alert-evaluation-v1',v_dedupe_key),
    'UTF8'),'sha256'),'hex');

  insert into public.operational_alerts(
    dedupe_key,signal_code,severity,summary_code,metrics,first_detected_at,last_detected_at
  ) values (
    v_dedupe_key,'graph_outbox','critical',v_summary,
    pg_catalog.jsonb_build_object('durable_delivery',true),v_now,v_now
  ) on conflict(dedupe_key) do nothing;
  get diagnostics v_alert_inserted=row_count;
  select * into strict v_alert from public.operational_alerts
  where dedupe_key=v_dedupe_key for update;
  if v_alert.signal_code<>'graph_outbox' or v_alert.severity<>'critical'
     or v_alert.summary_code<>v_summary then
    raise exception using errcode='23505',message='operational_alert_delivery_dedupe_collision';
  end if;
  v_previous_lifecycle:=v_alert.lifecycle;

  insert into public.operational_alert_receipts(
    evaluation_key,dedupe_key,observed_at,delivery_status,reservation_hash,evidence_hash,
    next_attempt_at,delivery_updated_at
  ) values (
    v_evaluation_key,v_dedupe_key,v_now,'pending',p_reservation_hash,p_evidence_hash,
    v_now,v_now
  ) on conflict(evaluation_key,dedupe_key) do nothing;
  get diagnostics v_receipt_inserted=row_count;
  select * into strict v_receipt from public.operational_alert_receipts
  where evaluation_key=v_evaluation_key and dedupe_key=v_dedupe_key for update;
  if v_receipt.delivery_status='not_requested' then
    update public.operational_alert_receipts
    set delivery_status='pending',reservation_hash=p_reservation_hash,
      evidence_hash=p_evidence_hash,next_attempt_at=v_now,delivery_updated_at=v_now
    where evaluation_key=v_evaluation_key and dedupe_key=v_dedupe_key
    returning * into v_receipt;
    v_receipt_inserted:=1;
  elsif v_receipt.reservation_hash is distinct from p_reservation_hash
     or v_receipt.evidence_hash is distinct from p_evidence_hash then
    raise exception using errcode='23505',message='operational_alert_delivery_receipt_collision';
  end if;

  if v_receipt_inserted=1 then
    update public.operational_alerts
    set lifecycle=case when lifecycle='resolved' then 'open' else lifecycle end,
      last_detected_at=greatest(last_detected_at,v_now),
      occurrence_count=occurrence_count+case when v_alert_inserted=1 then 0 else 1 end,
      resolved_at=null,resolved_by_hash=null,updated_at=v_now
    where id=v_alert.id;
    insert into public.operational_alert_audit(
      alert_id,action,actor_hash,evaluation_key,occurred_at,evidence
    ) values (
      v_alert.id,case when v_previous_lifecycle='resolved' then 'reopened' else 'detected' end,
      p_actor_hash,v_evaluation_key,v_now,pg_catalog.jsonb_build_object('durable_delivery',true)
    ) on conflict do nothing;
  end if;
  return pg_catalog.jsonb_build_object(
    'accepted',true,'duplicate',v_receipt_inserted=0,'dedupe_key',v_dedupe_key,
    'evaluation_key',v_evaluation_key,'delivery_status',v_receipt.delivery_status
  );
end;
$$;

create or replace function public.claim_operational_alert_delivery(
  p_worker_hash text,
  p_lease_seconds integer,
  p_evaluation_key text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_receipt public.operational_alert_receipts%rowtype;
  v_summary text;
  v_token uuid;
begin
  if p_worker_hash is null or p_worker_hash !~ '^[a-f0-9]{64}$'
     or p_lease_seconds is null or p_lease_seconds not between 15 and 300
     or (p_evaluation_key is not null and p_evaluation_key !~ '^[a-f0-9]{64}$') then
    raise exception using errcode='22023',message='invalid_operational_alert_delivery_claim';
  end if;
  update public.operational_alert_receipts
  set delivery_status='dead_letter',claimed_by_hash=null,claim_token_hash=null,
    claim_expires_at=null,next_attempt_at=null,last_failure_code='ATTEMPTS_EXHAUSTED',
    delivery_updated_at=v_now
  where delivery_attempt_count>=8 and (
    delivery_status='pending' or
    (delivery_status='claimed' and claim_expires_at<=v_now)
  );

  select r.* into v_receipt
  from public.operational_alert_receipts r
  where (p_evaluation_key is null or r.evaluation_key=p_evaluation_key)
    and r.delivery_attempt_count<8 and (
      (r.delivery_status='pending' and r.next_attempt_at<=v_now)
      or (r.delivery_status='claimed' and r.claim_expires_at<=v_now)
    )
  order by r.observed_at,r.evaluation_key,r.dedupe_key
  limit 1 for update of r skip locked;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted',true,'reason_code',case when p_evaluation_key is not null and exists(
        select 1 from public.operational_alert_receipts
        where evaluation_key=p_evaluation_key and delivery_status='delivered'
      ) then 'already_delivered' else 'empty' end,'items','[]'::jsonb
    );
  end if;
  select summary_code into strict v_summary from public.operational_alerts
  where dedupe_key=v_receipt.dedupe_key;
  v_token:=extensions.gen_random_uuid();
  update public.operational_alert_receipts
  set delivery_status='claimed',delivery_attempt_count=delivery_attempt_count+1,
    claimed_by_hash=p_worker_hash,
    claim_token_hash=pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_token::text,'UTF8'),'sha256'),'hex'),
    claim_expires_at=v_now+pg_catalog.make_interval(secs=>p_lease_seconds),
    delivery_updated_at=v_now
  where evaluation_key=v_receipt.evaluation_key and dedupe_key=v_receipt.dedupe_key
  returning * into v_receipt;
  return pg_catalog.jsonb_build_object(
    'accepted',true,'reason_code','claimed','items',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'evaluation_key',v_receipt.evaluation_key,'dedupe_key',v_receipt.dedupe_key,
        'summary_code',v_summary,'reservation_hash',v_receipt.reservation_hash,
        'evidence_hash',v_receipt.evidence_hash,'attempt',v_receipt.delivery_attempt_count,
        'claim_token',v_token,'claim_expires_at',v_receipt.claim_expires_at
      )
    )
  );
end;
$$;

create or replace function public.finalize_operational_alert_delivery(
  p_evaluation_key text,
  p_dedupe_key text,
  p_worker_hash text,
  p_claim_token uuid,
  p_outcome text,
  p_attempt_evidence_hash text,
  p_failure_code text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_receipt public.operational_alert_receipts%rowtype;
  v_terminal boolean;
begin
  if p_evaluation_key is null or p_evaluation_key !~ '^[a-f0-9]{64}$'
     or p_dedupe_key is null or p_dedupe_key !~ '^[a-f0-9]{64}$'
     or p_worker_hash is null or p_worker_hash !~ '^[a-f0-9]{64}$' or p_claim_token is null
     or p_outcome is null or p_outcome not in ('delivered','retry')
     or p_attempt_evidence_hash is null or p_attempt_evidence_hash !~ '^[a-f0-9]{64}$'
     or (p_outcome='delivered' and p_failure_code is not null)
     or (p_outcome='retry' and (p_failure_code is null
       or p_failure_code !~ '^[A-Z][A-Z0-9_:-]{1,63}$')) then
    raise exception using errcode='22023',message='invalid_operational_alert_delivery_finalize';
  end if;
  select * into v_receipt from public.operational_alert_receipts
  where evaluation_key=p_evaluation_key and dedupe_key=p_dedupe_key for update;
  if not found then
    raise exception using errcode='P0002',message='operational_alert_delivery_not_found';
  end if;
  if p_outcome='delivered' and v_receipt.delivery_status='delivered'
     and v_receipt.last_attempt_evidence_hash=p_attempt_evidence_hash then
    return pg_catalog.jsonb_build_object('accepted',true,'duplicate',true,'delivery_status','delivered');
  end if;
  if p_outcome='retry' and v_receipt.delivery_status in ('pending','dead_letter')
     and v_receipt.last_attempt_evidence_hash=p_attempt_evidence_hash
     and v_receipt.last_failure_code=p_failure_code then
    return pg_catalog.jsonb_build_object('accepted',true,'duplicate',true,'delivery_status',v_receipt.delivery_status);
  end if;
  if v_receipt.delivery_status<>'claimed' or v_receipt.claimed_by_hash<>p_worker_hash
     or v_receipt.claim_expires_at<=v_now
     or v_receipt.claim_token_hash<>pg_catalog.encode(extensions.digest(
       pg_catalog.convert_to(p_claim_token::text,'UTF8'),'sha256'),'hex') then
    raise exception using errcode='55000',message='operational_alert_delivery_claim_lost';
  end if;
  v_terminal:=p_outcome='retry' and v_receipt.delivery_attempt_count>=8;
  update public.operational_alert_receipts
  set delivery_status=case when p_outcome='delivered' then 'delivered'
      when v_terminal then 'dead_letter' else 'pending' end,
    next_attempt_at=case when p_outcome='retry' and not v_terminal then
      v_now+pg_catalog.make_interval(secs=>least(3600,30*(2^(v_receipt.delivery_attempt_count-1)))::integer)
      else null end,
    claimed_by_hash=null,claim_token_hash=null,claim_expires_at=null,
    delivered_at=case when p_outcome='delivered' then v_now else null end,
    last_attempt_evidence_hash=p_attempt_evidence_hash,last_failure_code=p_failure_code,
    delivery_updated_at=v_now
  where evaluation_key=p_evaluation_key and dedupe_key=p_dedupe_key;
  return pg_catalog.jsonb_build_object(
    'accepted',true,'duplicate',false,'delivery_status',case
      when p_outcome='delivered' then 'delivered'
      when v_terminal then 'dead_letter' else 'pending' end
  );
end;
$$;

create or replace function public.halt_transactional_graph_dispatch(
  p_dispatch_id uuid,p_worker_id uuid,p_reason_code text,p_evidence_hash text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_dispatch public.transactional_dispatch_outbox%rowtype;
  v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  if p_dispatch_id is null or p_worker_id is null
     or p_reason_code is null or p_reason_code !~ '^[A-Z][A-Z0-9_:-]{2,63}$'
     or p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object('accepted',false,'reason_code','invalid_request');
  end if;
  select * into v_dispatch from public.transactional_dispatch_outbox
  where id=p_dispatch_id for update;
  if not found then return pg_catalog.jsonb_build_object('accepted',false,'reason_code','dispatch_unavailable'); end if;
  if v_dispatch.status='ambiguous_halted' and v_dispatch.last_reason_code=p_reason_code
     and v_dispatch.outcome_evidence_hash=p_evidence_hash then
    return pg_catalog.jsonb_build_object('accepted',true,'duplicate',true,'reason_code','ambiguous_halted');
  end if;
  if v_dispatch.claimed_by is distinct from p_worker_id or v_dispatch.status<>'reserved' then
    return pg_catalog.jsonb_build_object('accepted',false,'reason_code','claim_unavailable');
  end if;
  update public.transactional_dispatch_outbox
  set status='ambiguous_halted',last_reason_code=p_reason_code,
    outcome_evidence_hash=p_evidence_hash,terminal_at=v_now,updated_at=v_now
  where id=p_dispatch_id;
  update public.outbound_delivery_control
  set transactional_enabled=false,halt_reason=p_reason_code,updated_at=v_now where singleton;
  return pg_catalog.jsonb_build_object('accepted',true,'duplicate',false,'reason_code','ambiguous_halted');
end;
$$;

create or replace function public.capture_graph_outbox_ambiguity()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_code text:=fundae_private.normalize_operational_alert_code(
    coalesce(new.failure_code,'AMBIGUOUS_GRAPH_OUTBOX_HALTED')
  );
  v_actor text:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('database-alert-trigger-v1','UTF8'),'sha256'),'hex');
begin
  update public.outbound_delivery_control
  set transactional_enabled=case when new.lane='transactional' then false else transactional_enabled end,
    cold_enabled=case when new.lane='cold' then false else cold_enabled end,
    halt_reason=v_code,updated_at=pg_catalog.clock_timestamp() where singleton;
  perform public.enqueue_operational_alert_delivery(
    v_code,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(new.reservation_id::text,'UTF8'),'sha256'),'hex'),
    new.terminal_evidence_hash,v_actor
  );
  return new;
end;
$$;

create or replace function public.capture_cold_dispatch_ambiguity()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_code text:=fundae_private.normalize_operational_alert_code(
    case when new.last_reason_code like 'AMBIGUOUS_%' then new.last_reason_code
      else 'AMBIGUOUS_COLD_'||new.last_reason_code end
  );
  v_context text:=coalesce(new.reservation_id::text,new.id::text);
  v_actor text:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('database-alert-trigger-v1','UTF8'),'sha256'),'hex');
begin
  update public.outbound_delivery_control
  set cold_enabled=false,halt_reason=v_code,updated_at=pg_catalog.clock_timestamp() where singleton;
  perform public.enqueue_operational_alert_delivery(
    v_code,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_context,'UTF8'),'sha256'),'hex'),
    new.terminal_evidence_hash,v_actor
  );
  return new;
end;
$$;

create or replace function public.capture_transactional_dispatch_ambiguity()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_code text:=fundae_private.normalize_operational_alert_code(
    case when new.last_reason_code like 'AMBIGUOUS_%' then new.last_reason_code
      else 'AMBIGUOUS_'||new.last_reason_code end
  );
  v_context text:=coalesce(new.reservation_id::text,new.id::text);
  v_actor text:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('database-alert-trigger-v1','UTF8'),'sha256'),'hex');
begin
  update public.outbound_delivery_control
  set transactional_enabled=false,halt_reason=v_code,updated_at=pg_catalog.clock_timestamp() where singleton;
  perform public.enqueue_operational_alert_delivery(
    v_code,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_context,'UTF8'),'sha256'),'hex'),
    new.outcome_evidence_hash,v_actor
  );
  return new;
end;
$$;

create trigger graph_outbox_capture_ambiguity
after update of state on public.graph_outbox
for each row when (new.state='ambiguous_halted' and old.state is distinct from new.state
  and new.terminal_evidence_hash is not null)
execute function public.capture_graph_outbox_ambiguity();
create trigger cold_dispatch_capture_ambiguity
after update of status on public.cold_campaign_dispatch_outbox
for each row when (new.status='ambiguous_halted' and old.status is distinct from new.status
  and new.last_reason_code is not null and new.terminal_evidence_hash is not null)
execute function public.capture_cold_dispatch_ambiguity();
create trigger transactional_dispatch_capture_ambiguity
after update of status on public.transactional_dispatch_outbox
for each row when (new.status='ambiguous_halted' and old.status is distinct from new.status
  and new.last_reason_code is not null and new.outcome_evidence_hash is not null)
execute function public.capture_transactional_dispatch_ambiguity();

-- Backfill any pre-existing halt so migration ordering cannot lose its alert intent.
do $$
declare
  v_item record;
  v_actor text:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('database-alert-trigger-v1','UTF8'),'sha256'),'hex');
begin
  update public.transactional_dispatch_outbox
  set last_reason_code='AMBIGUOUS_TRANSACTIONAL_DISPATCH_HALTED'
  where status='ambiguous_halted' and last_reason_code is null;
  update public.outbound_delivery_control
  set transactional_enabled=case when exists(
        select 1 from public.graph_outbox where state='ambiguous_halted' and lane='transactional'
      ) or exists(
        select 1 from public.transactional_dispatch_outbox where status='ambiguous_halted'
      ) then false else transactional_enabled end,
    cold_enabled=case when exists(
        select 1 from public.graph_outbox where state='ambiguous_halted' and lane='cold'
      ) or exists(
        select 1 from public.cold_campaign_dispatch_outbox where status='ambiguous_halted'
      ) then false else cold_enabled end,
    updated_at=pg_catalog.clock_timestamp()
  where singleton;
  for v_item in
    select fundae_private.normalize_operational_alert_code(
        coalesce(failure_code,'AMBIGUOUS_GRAPH_OUTBOX_HALTED')
      ) as summary_code,
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(reservation_id::text,'UTF8'),'sha256'),'hex') as reservation_hash,
      terminal_evidence_hash as evidence_hash
    from public.graph_outbox where state='ambiguous_halted'
    union all
    select fundae_private.normalize_operational_alert_code(
        case when last_reason_code like 'AMBIGUOUS_%' then last_reason_code
          else 'AMBIGUOUS_COLD_'||last_reason_code end
      ),
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(reservation_id::text,id::text),'UTF8'),'sha256'),'hex'),
      terminal_evidence_hash
    from public.cold_campaign_dispatch_outbox
    where status='ambiguous_halted' and last_reason_code is not null
    union all
    select 'AMBIGUOUS_TRANSACTIONAL_DISPATCH_HALTED',
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        coalesce(reservation_id::text,id::text),'UTF8'
      ),'sha256'),'hex'),
      outcome_evidence_hash
    from public.transactional_dispatch_outbox
    where status='ambiguous_halted'
      and last_reason_code='AMBIGUOUS_TRANSACTIONAL_DISPATCH_HALTED'
  loop
    perform public.enqueue_operational_alert_delivery(
      v_item.summary_code,v_item.reservation_hash,v_item.evidence_hash,v_actor
    );
  end loop;
end;
$$;

revoke execute on function public.enqueue_operational_alert_delivery(text,text,text,text)
  from public,anon,authenticated;
revoke execute on function public.claim_operational_alert_delivery(text,integer,text)
  from public,anon,authenticated;
revoke execute on function public.finalize_operational_alert_delivery(text,text,text,uuid,text,text,text)
  from public,anon,authenticated;
revoke execute on function public.halt_transactional_graph_dispatch(uuid,uuid,text,text)
  from public,anon,authenticated;
revoke execute on function public.capture_graph_outbox_ambiguity(),
  public.capture_cold_dispatch_ambiguity(),public.capture_transactional_dispatch_ambiguity()
  from public,anon,authenticated,service_role;
grant execute on function public.enqueue_operational_alert_delivery(text,text,text,text),
  public.claim_operational_alert_delivery(text,integer,text),
  public.finalize_operational_alert_delivery(text,text,text,uuid,text,text,text),
  public.halt_transactional_graph_dispatch(uuid,uuid,text,text)
  to service_role;

commit;
