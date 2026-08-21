-- Enforce pilot quota and terminal-state safety in the database authority.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mailbox_delivery_reservations'::regclass
      and conname = 'mailbox_delivery_mailbox_id_unique'
  ) then
    alter table public.mailbox_delivery_reservations
      add constraint mailbox_delivery_mailbox_id_unique unique (mailbox_key_hash, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mailbox_throttle_state'::regclass
      and conname = 'mailbox_state_active_reservation_fk'
  ) then
    alter table public.mailbox_throttle_state
      add constraint mailbox_state_active_reservation_fk
      foreign key (mailbox_key_hash, active_reservation_id)
      references public.mailbox_delivery_reservations (mailbox_key_hash, id)
      not valid;
    alter table public.mailbox_throttle_state
      validate constraint mailbox_state_active_reservation_fk;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mailbox_throttle_state'::regclass
      and conname = 'mailbox_state_blocked_reservation_fk'
  ) then
    alter table public.mailbox_throttle_state
      add constraint mailbox_state_blocked_reservation_fk
      foreign key (mailbox_key_hash, blocked_reservation_id)
      references public.mailbox_delivery_reservations (mailbox_key_hash, id)
      not valid;
    alter table public.mailbox_throttle_state
      validate constraint mailbox_state_blocked_reservation_fk;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mailbox_delivery_reservations'::regclass
      and conname = 'mailbox_delivery_terminal_fields_check'
  ) then
    alter table public.mailbox_delivery_reservations
      add constraint mailbox_delivery_terminal_fields_check check (
        (status = 'reserved' and provider_message_hash is null and failure_code is null) or
        (status = 'sent' and provider_message_hash is not null and failure_code is null) or
        (
          status = 'failed' and provider_message_hash is null
          and failure_code ~ '^DEFINITIVE_[A-Z0-9_:-]{2,53}$'
          and failure_code !~ '(TIMEOUT|429|AMBIGUOUS|UNKNOWN|RATE_LIMIT|LEASE_EXPIRED)'
        ) or
        (status = 'reconcile_required' and provider_message_hash is null and failure_code is not null)
      ) not valid;
    alter table public.mailbox_delivery_reservations
      validate constraint mailbox_delivery_terminal_fields_check;
  end if;
end
$$;

create unique index if not exists mailbox_transactional_pilot_resource_unique
  on public.mailbox_delivery_reservations (mailbox_key_hash, resource)
  where lane = 'transactional';

create or replace function public.enforce_transactional_pilot_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lane <> 'transactional' then
    return new;
  end if;

  perform 1
  from public.mailbox_throttle_state
  where mailbox_key_hash = new.mailbox_key_hash
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'mailbox_state_unavailable';
  end if;

  if exists (
    select 1
    from public.mailbox_delivery_reservations
    where mailbox_key_hash = new.mailbox_key_hash
      and lane = 'transactional'
      and resource = new.resource
  ) then
    raise exception using errcode = '23514', message = 'pilot_resource_quota_reached';
  end if;

  if (
    select count(*)
    from public.mailbox_delivery_reservations
    where mailbox_key_hash = new.mailbox_key_hash
      and lane = 'transactional'
  ) >= 4 then
    raise exception using errcode = '23514', message = 'pilot_mailbox_quota_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists mailbox_transactional_pilot_quota on public.mailbox_delivery_reservations;
create trigger mailbox_transactional_pilot_quota
before insert on public.mailbox_delivery_reservations
for each row
execute function public.enforce_transactional_pilot_reservation();

create or replace function public.enforce_mailbox_terminal_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'reserved'
     and old.lease_expires_at <= clock_timestamp()
     and new.status in ('sent', 'failed') then
    raise exception using errcode = '23514', message = 'lease_expired_requires_reconcile';
  end if;
  return new;
end;
$$;

drop trigger if exists mailbox_terminal_transition on public.mailbox_delivery_reservations;
create trigger mailbox_terminal_transition
before update of status on public.mailbox_delivery_reservations
for each row
execute function public.enforce_mailbox_terminal_transition();

create or replace function public.record_transactional_lease_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id text;
begin
  if new.lane <> 'transactional' or new.failure_code <> 'LEASE_EXPIRED' then
    return new;
  end if;

  select lead_id into strict v_lead_id
  from public.leads
  where submission_id = new.submission_id
  for update;

  insert into public.transactional_email_events (
    submission_id, lead_id, event_name, source_event_id, occurred_at, failure_code
  ) values (
    new.submission_id, v_lead_id, 'reconcile_required',
    'mailbox:' || new.id::text || ':reconcile_required',
    coalesce(new.finalized_at, clock_timestamp()), 'LEASE_EXPIRED'
  ) on conflict (source_event_id) do nothing;

  update public.leads
  set email_delivery_status = 'reconcile_required',
      email_delivery_updated_at = coalesce(new.finalized_at, clock_timestamp())
  where submission_id = new.submission_id;

  return new;
end;
$$;

drop trigger if exists mailbox_transactional_lease_expiry on public.mailbox_delivery_reservations;
create trigger mailbox_transactional_lease_expiry
after update of status on public.mailbox_delivery_reservations
for each row
when (
  old.status = 'reserved' and
  new.status = 'reconcile_required' and
  new.failure_code = 'LEASE_EXPIRED'
)
execute function public.record_transactional_lease_expiry();

create or replace function public.claim_transactional_intake(
  p_submission_id text,
  p_resource text,
  p_payload_sha256 text,
  p_intake_capability_hash text,
  p_pilot_recipient_allowed boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.transactional_intake_claims%rowtype;
  v_claimed_at timestamptz := clock_timestamp();
begin
  if p_submission_id is null or p_submission_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_resource is null or p_resource not in ('calculator', 'interactive_checklist', 'checklist', 'webinar') or
     p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' or
     p_intake_capability_hash is null or p_intake_capability_hash !~ '^[a-f0-9]{64}$' or
     p_pilot_recipient_allowed is null then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_request');
  end if;

  perform 1
  from public.leads
  where submission_id = p_submission_id
    and form_type = p_resource
    and lead_magnet = p_resource
    and payload #>> '{consent,privacy_accepted}' = 'true'
  for update;
  if not found then
    return jsonb_build_object('authorized', false, 'reason_code', 'lead_unavailable');
  end if;

  insert into public.transactional_intake_claims (
    submission_id, resource, payload_sha256, intake_capability_hash,
    pilot_recipient_allowed, claimed_at, capability_expires_at
  ) values (
    p_submission_id, p_resource, p_payload_sha256, p_intake_capability_hash,
    p_pilot_recipient_allowed, v_claimed_at, v_claimed_at + interval '15 minutes'
  ) on conflict (submission_id) do nothing
  returning * into v_existing;

  if not found then
    select * into v_existing
    from public.transactional_intake_claims
    where submission_id = p_submission_id;
    return jsonb_build_object(
      'authorized', false, 'reason_code', 'replay_blocked',
      'claimed_at', v_existing.claimed_at
    );
  end if;

  return jsonb_build_object(
    'authorized', true, 'reason_code', 'claimed',
    'claimed_at', v_claimed_at
  );
end;
$$;

revoke execute on function public.enforce_transactional_pilot_reservation() from public, anon, authenticated;
revoke execute on function public.enforce_mailbox_terminal_transition() from public, anon, authenticated;
revoke execute on function public.record_transactional_lease_expiry() from public, anon, authenticated;
revoke execute on function public.claim_transactional_intake(text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.claim_transactional_intake(text,text,text,text,boolean) to service_role;

commit;
