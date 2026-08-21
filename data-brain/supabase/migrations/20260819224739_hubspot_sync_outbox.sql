-- Durable, idempotent HubSpot synchronization for provisioned campaign contacts.
-- The lane is independently OFF in PostgreSQL and in the application.
begin;

alter table public.outbound_delivery_control
  add column if not exists hubspot_enabled boolean not null default false;

create or replace function public.enforce_outbound_master_dominance()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if not new.master_enabled then
    new.transactional_enabled:=false;
    new.cold_enabled:=false;
    new.hubspot_enabled:=false;
  end if;
  return new;
end;
$$;

drop trigger if exists outbound_delivery_control_master_dominance
  on public.outbound_delivery_control;
create trigger outbound_delivery_control_master_dominance
before insert or update on public.outbound_delivery_control
for each row execute function public.enforce_outbound_master_dominance();

create table if not exists public.hubspot_sync_outbox (
  campaign_contact_id uuid primary key
    references public.campaign_contacts(id) on delete restrict,
  desired_version bigint not null default 1 check (desired_version >= 1),
  claimed_version bigint check (claimed_version is null or claimed_version >= 1),
  synced_version bigint not null default 0 check (synced_version >= 0),
  status text not null default 'queued_off'
    check (status in (
      'queued_off','pending','claimed','retry_wait','synced','dead_letter','halted'
    )),
  next_attempt_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  claimed_by_hash text check (
    claimed_by_hash is null or claimed_by_hash ~ '^[a-f0-9]{64}$'
  ),
  claim_token uuid,
  claim_expires_at timestamptz,
  claimed_payload_hash text check (
    claimed_payload_hash is null or claimed_payload_hash ~ '^[a-f0-9]{64}$'
  ),
  last_error_code text,
  last_evidence_hash text check (
    last_evidence_hash is null or last_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (status='claimed' and claimed_by_hash is not null and claim_token is not null
      and claim_expires_at is not null and claimed_version is not null
      and claimed_payload_hash is not null)
    or
    (status<>'claimed' and claimed_by_hash is null and claim_token is null
      and claim_expires_at is null and claimed_version is null
      and claimed_payload_hash is null)
  )
);

create index if not exists hubspot_sync_outbox_due_idx
  on public.hubspot_sync_outbox(status,next_attempt_at,created_at)
  where status in ('queued_off','pending','retry_wait','claimed');
create index if not exists hubspot_sync_outbox_dead_letter_idx
  on public.hubspot_sync_outbox(updated_at)
  where status='dead_letter';

create or replace function public.enqueue_campaign_contact_hubspot_sync()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_target_status text;
begin
  select * into v_control
  from public.outbound_delivery_control
  where singleton;
  v_target_status:=case
    when found and v_control.master_enabled and v_control.hubspot_enabled
      then 'pending'
    else 'queued_off'
  end;

  insert into public.hubspot_sync_outbox(
    campaign_contact_id,desired_version,status,next_attempt_at,updated_at
  ) values (
    new.id,1,v_target_status,v_now,v_now
  )
  on conflict(campaign_contact_id) do update set
    desired_version=public.hubspot_sync_outbox.desired_version+1,
    status=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then 'claimed'
      else v_target_status
    end,
    next_attempt_at=v_now,
    attempt_count=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then public.hubspot_sync_outbox.attempt_count
      else 0
    end,
    claimed_by_hash=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then public.hubspot_sync_outbox.claimed_by_hash
      else null
    end,
    claim_token=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then public.hubspot_sync_outbox.claim_token
      else null
    end,
    claim_expires_at=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then public.hubspot_sync_outbox.claim_expires_at
      else null
    end,
    claimed_version=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then public.hubspot_sync_outbox.claimed_version
      else null
    end,
    claimed_payload_hash=case
      when public.hubspot_sync_outbox.status='claimed'
        and public.hubspot_sync_outbox.claim_expires_at>v_now
        then public.hubspot_sync_outbox.claimed_payload_hash
      else null
    end,
    last_error_code=null,
    updated_at=v_now;
  return new;
end;
$$;

drop trigger if exists campaign_contacts_enqueue_hubspot_insert
  on public.campaign_contacts;
create trigger campaign_contacts_enqueue_hubspot_insert
after insert on public.campaign_contacts
for each row execute function public.enqueue_campaign_contact_hubspot_sync();

drop trigger if exists campaign_contacts_enqueue_hubspot_state
  on public.campaign_contacts;
create trigger campaign_contacts_enqueue_hubspot_state
after update of
  external_account_id,email_hash,contact_data,variant,magnet,company_size,
  sequence_status,suppression_scope,suppression_reason,reply_type,
  meeting_booked_at,opportunity_created_at,deal_value
on public.campaign_contacts
for each row
when (
  old.external_account_id is distinct from new.external_account_id or
  old.email_hash is distinct from new.email_hash or
  old.contact_data is distinct from new.contact_data or
  old.variant is distinct from new.variant or
  old.magnet is distinct from new.magnet or
  old.company_size is distinct from new.company_size or
  old.sequence_status is distinct from new.sequence_status or
  old.suppression_scope is distinct from new.suppression_scope or
  old.suppression_reason is distinct from new.suppression_reason or
  old.reply_type is distinct from new.reply_type or
  old.meeting_booked_at is distinct from new.meeting_booked_at or
  old.opportunity_created_at is distinct from new.opportunity_created_at or
  old.deal_value is distinct from new.deal_value
)
execute function public.enqueue_campaign_contact_hubspot_sync();

insert into public.hubspot_sync_outbox(
  campaign_contact_id,desired_version,status,next_attempt_at
)
select id,1,'queued_off',clock_timestamp()
from public.campaign_contacts
on conflict(campaign_contact_id) do nothing;

create or replace function public.claim_hubspot_sync_outbox(
  p_worker_hash text,
  p_limit integer default 50,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_now timestamptz;
  v_item record;
  v_token uuid;
  v_payload_hash text;
  v_items jsonb:='[]'::jsonb;
begin
  if p_worker_hash is null or p_worker_hash !~ '^[a-f0-9]{64}$' or
     p_limit not between 1 and 100 or p_lease_seconds not between 30 and 300 then
    return jsonb_build_object(
      'accepted',false,'reason_code','invalid_request','items','[]'::jsonb
    );
  end if;
  select * into v_control
  from public.outbound_delivery_control
  where singleton
  for update;
  v_now:=clock_timestamp();
  if not found or not v_control.master_enabled or not v_control.hubspot_enabled then
    return jsonb_build_object(
      'accepted',false,'reason_code','hubspot_off','items','[]'::jsonb
    );
  end if;

  for v_item in
    select
      o.campaign_contact_id,o.desired_version,o.status,o.attempt_count,
      cc.external_contact_id,cc.external_account_id,cc.email_hash,cc.contact_data,
      cc.variant,cc.magnet,cc.company_size,cc.sequence_status,
      c.external_id as campaign_external_id
    from public.hubspot_sync_outbox o
    join public.campaign_contacts cc on cc.id=o.campaign_contact_id
    join public.campaigns c on c.id=cc.campaign_id
    where (
      o.status in ('queued_off','pending','retry_wait') and o.next_attempt_at<=v_now
    ) or (
      o.status='claimed' and o.claim_expires_at<=v_now
    )
    order by
      case when cc.suppression_scope<>'none' or cc.sequence_status='stopped'
        then 0 else 1 end,
      o.next_attempt_at,o.created_at,o.campaign_contact_id
    limit p_limit
    for update of o skip locked
  loop
    if v_item.contact_data->>'email' is null or
       v_item.contact_data->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      update public.hubspot_sync_outbox set
        status='halted',last_error_code='identity_unavailable',
        claimed_by_hash=null,claim_token=null,claim_expires_at=null,
        claimed_version=null,claimed_payload_hash=null,updated_at=v_now
      where campaign_contact_id=v_item.campaign_contact_id;
      continue;
    end if;
    v_token:=gen_random_uuid();
    v_payload_hash:=encode(extensions.digest(convert_to(concat_ws(chr(31),
      'hubspot-contact-sync-v1',v_item.campaign_contact_id::text,
      v_item.desired_version::text,v_item.email_hash,
      v_item.contact_data->>'email',v_item.external_contact_id,
      v_item.external_account_id,v_item.campaign_external_id,v_item.variant,
      v_item.magnet,coalesce(v_item.company_size,''),
      v_item.sequence_status,coalesce(v_item.contact_data->>'first_name',''),
      coalesce(v_item.contact_data->>'last_name',''),
      coalesce(v_item.contact_data->>'company_name',''),
      coalesce(v_item.contact_data->>'job_title','')
    ),'UTF8'),'sha256'),'hex');
    update public.hubspot_sync_outbox set
      status='claimed',attempt_count=least(attempt_count+1,8),
      claimed_by_hash=p_worker_hash,claim_token=v_token,
      claim_expires_at=v_now+p_lease_seconds*interval '1 second',
      claimed_version=v_item.desired_version,
      claimed_payload_hash=v_payload_hash,updated_at=v_now
    where campaign_contact_id=v_item.campaign_contact_id;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'campaign_contact_id',v_item.campaign_contact_id,
      'version',v_item.desired_version,
      'payload_hash',v_payload_hash,
      'claim_token',v_token,
      'lead_id',v_item.email_hash,
      'external_contact_id',v_item.external_contact_id,
      'external_account_id',v_item.external_account_id,
      'email',v_item.contact_data->>'email',
      'first_name',nullif(v_item.contact_data->>'first_name',''),
      'last_name',nullif(v_item.contact_data->>'last_name',''),
      'company_name',nullif(v_item.contact_data->>'company_name',''),
      'job_title',nullif(v_item.contact_data->>'job_title',''),
      'company_size',v_item.company_size,
      'campaign_external_id',v_item.campaign_external_id,
      'variant',v_item.variant,'magnet',v_item.magnet,
      'sequence_status',v_item.sequence_status
    ));
  end loop;
  return jsonb_build_object(
    'accepted',true,'reason_code',
    case when jsonb_array_length(v_items)=0 then 'empty' else 'claimed' end,
    'items',v_items
  );
end;
$$;

create or replace function public.finalize_hubspot_sync_outbox(
  p_campaign_contact_id uuid,
  p_worker_hash text,
  p_claim_token uuid,
  p_version bigint,
  p_outcome text,
  p_hubspot_contact_id text,
  p_evidence_hash text,
  p_failure_code text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_contact public.campaign_contacts%rowtype;
  v_item public.hubspot_sync_outbox%rowtype;
  v_status text;
  v_stale boolean;
begin
  if p_campaign_contact_id is null or p_worker_hash !~ '^[a-f0-9]{64}$' or
     p_claim_token is null or p_version<1 or
     p_outcome not in ('synced','retryable_failure','definitive_failure') or
     p_evidence_hash !~ '^[a-f0-9]{64}$' or
     (p_outcome='synced' and
       (p_hubspot_contact_id is null or length(p_hubspot_contact_id) not between 1 and 128)) then
    return jsonb_build_object('accepted',false,'reason_code','invalid_request');
  end if;
  select * into v_contact
  from public.campaign_contacts
  where id=p_campaign_contact_id
  for update;
  select * into v_item
  from public.hubspot_sync_outbox
  where campaign_contact_id=p_campaign_contact_id
  for update;
  v_now:=clock_timestamp();
  if not found or v_contact.id is null or v_item.status<>'claimed' or
     v_item.claimed_by_hash<>p_worker_hash or v_item.claim_token<>p_claim_token or
     v_item.claimed_version<>p_version or v_item.claim_expires_at<=v_now then
    return jsonb_build_object('accepted',false,'reason_code','claim_unavailable');
  end if;
  v_stale:=v_item.desired_version<>p_version;
  if p_outcome='synced' then
    update public.campaign_contacts set
      hubspot_contact_id=p_hubspot_contact_id,
      hubspot_sync_status=case when v_stale then 'pending' else 'synced' end,
      hubspot_synced_at=v_now
    where id=p_campaign_contact_id;
    v_status:=case when v_stale then 'pending' else 'synced' end;
    update public.hubspot_sync_outbox set
      synced_version=greatest(synced_version,p_version),status=v_status,
      next_attempt_at=case when v_stale then v_now else next_attempt_at end,
      last_error_code=null,last_evidence_hash=p_evidence_hash,
      claimed_by_hash=null,claim_token=null,claim_expires_at=null,
      claimed_version=null,claimed_payload_hash=null,updated_at=v_now
    where campaign_contact_id=p_campaign_contact_id;
  else
    v_status:=case
      when p_outcome='definitive_failure' or v_item.attempt_count>=8
        then 'dead_letter'
      else 'retry_wait'
    end;
    update public.campaign_contacts set hubspot_sync_status=v_status
    where id=p_campaign_contact_id;
    update public.hubspot_sync_outbox set
      status=v_status,
      next_attempt_at=case when v_status='retry_wait'
        then v_now+least(3600,30*(2^least(attempt_count,6)))::integer*interval '1 second'
        else next_attempt_at end,
      last_error_code=left(coalesce(p_failure_code,'hubspot_sync_failed'),128),
      last_evidence_hash=p_evidence_hash,
      claimed_by_hash=null,claim_token=null,claim_expires_at=null,
      claimed_version=null,claimed_payload_hash=null,updated_at=v_now
    where campaign_contact_id=p_campaign_contact_id;
    if v_status='dead_letter' and
       to_regprocedure('public.enqueue_operational_alert_delivery(text,text,text,text)') is not null then
      execute
        'select public.enqueue_operational_alert_delivery($1,$2,$3,$4)'
      using
        'HUBSPOT_SYNC_DEAD_LETTER',
        encode(extensions.digest(convert_to(p_campaign_contact_id::text,'UTF8'),'sha256'),'hex'),
        p_evidence_hash,
        p_worker_hash;
    end if;
  end if;
  return jsonb_build_object(
    'accepted',true,'reason_code',v_status,'stale',v_stale,
    'desired_version',v_item.desired_version,'finalized_version',p_version
  );
end;
$$;

alter table public.hubspot_sync_outbox enable row level security;
alter table public.hubspot_sync_outbox force row level security;
revoke all privileges on table public.hubspot_sync_outbox
  from public,anon,authenticated,service_role;
revoke execute on function public.enforce_outbound_master_dominance(),
  public.enqueue_campaign_contact_hubspot_sync()
  from public,anon,authenticated,service_role;
revoke execute on function public.claim_hubspot_sync_outbox(text,integer,integer),
  public.finalize_hubspot_sync_outbox(uuid,text,uuid,bigint,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.claim_hubspot_sync_outbox(text,integer,integer),
  public.finalize_hubspot_sync_outbox(uuid,text,uuid,bigint,text,text,text,text)
  to service_role;

update public.outbound_delivery_control
set hubspot_enabled=false,updated_at=clock_timestamp()
where singleton;

commit;
