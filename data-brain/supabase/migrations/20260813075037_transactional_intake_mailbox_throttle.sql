-- Transactional intake replay lock and shared physical-mailbox throttle.
-- Stores only hashes and non-PII claims. Does not activate Make or Outlook.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.leads drop constraint if exists leads_email_delivery_status_check;
alter table public.leads add constraint leads_email_delivery_status_check
  check (email_delivery_status in ('pending', 'email_sent', 'email_failed', 'reconcile_required')) not valid;
alter table public.leads validate constraint leads_email_delivery_status_check;

alter table public.transactional_email_events
  drop constraint if exists transactional_email_events_event_name_check;
alter table public.transactional_email_events
  add constraint transactional_email_events_event_name_check
  check (event_name in ('email_sent', 'email_failed', 'reconcile_required')) not valid;
alter table public.transactional_email_events
  validate constraint transactional_email_events_event_name_check;

create table if not exists public.transactional_intake_claims (
  submission_id text primary key
    check (submission_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$'),
  resource text not null
    check (resource in ('calculator', 'interactive_checklist', 'checklist', 'webinar')),
  payload_sha256 text not null
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  intake_capability_hash text not null unique
    check (intake_capability_hash ~ '^[a-f0-9]{64}$'),
  pilot_recipient_allowed boolean not null default false,
  claimed_at timestamptz not null default now(),
  capability_expires_at timestamptz not null,
  capability_consumed_at timestamptz,
  check (capability_expires_at > claimed_at)
);

create index if not exists transactional_intake_claims_expiry_idx
  on public.transactional_intake_claims (capability_expires_at)
  where capability_consumed_at is null;

create table if not exists public.mailbox_throttle_state (
  mailbox_key_hash text primary key
    check (mailbox_key_hash ~ '^[a-f0-9]{64}$'),
  active_reservation_id uuid,
  blocked_reservation_id uuid,
  batch_id uuid not null default gen_random_uuid(),
  batch_reservations_count smallint not null default 0
    check (batch_reservations_count between 0 and 2),
  next_allowed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mailbox_delivery_reservations (
  id uuid primary key default gen_random_uuid(),
  mailbox_key_hash text not null references public.mailbox_throttle_state(mailbox_key_hash),
  message_key_hash text not null check (message_key_hash ~ '^[a-f0-9]{64}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  submission_id text not null references public.transactional_intake_claims(submission_id),
  resource text not null check (resource in ('calculator', 'interactive_checklist', 'checklist', 'webinar')),
  lane text not null check (lane in ('transactional', 'cold')),
  batch_id uuid not null,
  batch_position smallint not null check (batch_position in (1, 2)),
  status text not null check (status in ('reserved', 'sent', 'failed', 'reconcile_required')),
  finalize_capability_hash text not null unique
    check (finalize_capability_hash ~ '^[a-f0-9]{64}$'),
  reserved_at timestamptz not null,
  lease_expires_at timestamptz not null,
  finalized_at timestamptz,
  provider_message_hash text check (provider_message_hash is null or provider_message_hash ~ '^[a-f0-9]{64}$'),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z0-9_:-]{2,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mailbox_delivery_message_unique unique (mailbox_key_hash, message_key_hash),
  constraint mailbox_delivery_mailbox_id_unique unique (mailbox_key_hash, id),
  check (lease_expires_at > reserved_at),
  check ((status = 'reserved' and finalized_at is null) or (status <> 'reserved' and finalized_at is not null)),
  constraint mailbox_delivery_terminal_fields_check check (
    (status = 'reserved' and provider_message_hash is null and failure_code is null) or
    (status = 'sent' and provider_message_hash is not null and failure_code is null) or
    (
      status = 'failed' and provider_message_hash is null
      and failure_code ~ '^DEFINITIVE_[A-Z0-9_:-]{2,53}$'
      and failure_code !~ '(TIMEOUT|429|AMBIGUOUS|UNKNOWN|RATE_LIMIT|LEASE_EXPIRED)'
    ) or
    (status = 'reconcile_required' and provider_message_hash is null and failure_code is not null)
  )
);

alter table public.mailbox_throttle_state
  add constraint mailbox_state_active_reservation_fk
  foreign key (mailbox_key_hash, active_reservation_id)
  references public.mailbox_delivery_reservations (mailbox_key_hash, id);
alter table public.mailbox_throttle_state
  add constraint mailbox_state_blocked_reservation_fk
  foreign key (mailbox_key_hash, blocked_reservation_id)
  references public.mailbox_delivery_reservations (mailbox_key_hash, id);

create unique index if not exists mailbox_one_active_reservation_idx
  on public.mailbox_delivery_reservations (mailbox_key_hash)
  where status = 'reserved';

create index if not exists mailbox_reservations_status_lease_idx
  on public.mailbox_delivery_reservations (status, lease_expires_at);

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
    submission_id,
    resource,
    payload_sha256,
    intake_capability_hash,
    pilot_recipient_allowed,
    claimed_at,
    capability_expires_at
  ) values (
    p_submission_id,
    p_resource,
    p_payload_sha256,
    p_intake_capability_hash,
    p_pilot_recipient_allowed,
    v_claimed_at,
    v_claimed_at + interval '15 minutes'
  ) on conflict (submission_id) do nothing
  returning * into v_existing;

  if not found then
    select * into v_existing
    from public.transactional_intake_claims
    where submission_id = p_submission_id;
    return jsonb_build_object(
      'authorized', false,
      'reason_code', 'replay_blocked',
      'claimed_at', v_existing.claimed_at
    );
  end if;

  return jsonb_build_object(
    'authorized', true,
    'reason_code', 'claimed',
    'claimed_at', v_claimed_at
  );
end;
$$;

create or replace function public.reserve_transactional_mailbox_delivery(
  p_mailbox_key_hash text,
  p_intake_capability_hash text,
  p_finalize_capability_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.mailbox_throttle_state%rowtype;
  v_claim public.transactional_intake_claims%rowtype;
  v_active public.mailbox_delivery_reservations%rowtype;
  v_existing public.mailbox_delivery_reservations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_message_key_hash text;
  v_position smallint;
begin
  if p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$' or
     p_intake_capability_hash is null or p_intake_capability_hash !~ '^[a-f0-9]{64}$' or
     p_finalize_capability_hash is null or p_finalize_capability_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_request');
  end if;

  insert into public.mailbox_throttle_state (mailbox_key_hash, next_allowed_at)
  values (p_mailbox_key_hash, v_now)
  on conflict (mailbox_key_hash) do nothing;

  select * into v_state
  from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash
  for update;

  if v_state.blocked_reservation_id is not null then
    return jsonb_build_object(
      'authorized', false,
      'reason_code', 'reconcile_required',
      'next_allowed_at', v_state.next_allowed_at,
      'retry_after_seconds', 0
    );
  end if;

  select * into v_claim
  from public.transactional_intake_claims
  where intake_capability_hash = p_intake_capability_hash
  for update;

  if not found then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_capability');
  end if;
  if v_claim.capability_consumed_at is not null then
    return jsonb_build_object('authorized', false, 'reason_code', 'replay_blocked');
  end if;
  if v_claim.capability_expires_at <= v_now then
    update public.transactional_intake_claims
    set capability_consumed_at = v_now
    where submission_id = v_claim.submission_id;
    return jsonb_build_object('authorized', false, 'reason_code', 'capability_expired');
  end if;
  if not v_claim.pilot_recipient_allowed then
    return jsonb_build_object('authorized', false, 'reason_code', 'recipient_not_allowed');
  end if;

  if v_state.active_reservation_id is not null then
    select * into v_active
    from public.mailbox_delivery_reservations
    where id = v_state.active_reservation_id
    for update;

    if not found or v_active.status <> 'reserved' then
      return jsonb_build_object('authorized', false, 'reason_code', 'mailbox_state_invalid');
    end if;
    if v_active.lease_expires_at <= v_now then
      update public.mailbox_delivery_reservations
      set status = 'reconcile_required',
          finalized_at = v_now,
          failure_code = 'LEASE_EXPIRED',
          updated_at = v_now
      where id = v_active.id;
      update public.mailbox_throttle_state
      set active_reservation_id = null,
          blocked_reservation_id = v_active.id,
          next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
          updated_at = v_now
      where mailbox_key_hash = p_mailbox_key_hash;
      return jsonb_build_object('authorized', false, 'reason_code', 'lease_expired_reconcile_required');
    end if;
    return jsonb_build_object(
      'authorized', false,
      'reason_code', 'lease_active',
      'lease_expires_at', v_active.lease_expires_at,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_active.lease_expires_at - v_now))))::integer
    );
  end if;

  if v_state.next_allowed_at > v_now then
    return jsonb_build_object(
      'authorized', false,
      'reason_code', 'cooldown',
      'next_allowed_at', v_state.next_allowed_at,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_state.next_allowed_at - v_now))))::integer
    );
  end if;

  v_message_key_hash := encode(extensions.digest('transactional:' || v_claim.submission_id, 'sha256'), 'hex');
  select * into v_existing
  from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash
    and message_key_hash = v_message_key_hash
  for update;
  if found then
    update public.transactional_intake_claims
    set capability_consumed_at = coalesce(capability_consumed_at, v_now)
    where submission_id = v_claim.submission_id;
    return jsonb_build_object('authorized', false, 'reason_code', 'replay_blocked');
  end if;

  v_position := v_state.batch_reservations_count + 1;
  if v_position not in (1, 2) then
    return jsonb_build_object('authorized', false, 'reason_code', 'mailbox_state_invalid');
  end if;

  insert into public.mailbox_delivery_reservations (
    mailbox_key_hash,
    message_key_hash,
    payload_sha256,
    submission_id,
    resource,
    lane,
    batch_id,
    batch_position,
    status,
    finalize_capability_hash,
    reserved_at,
    lease_expires_at
  ) values (
    p_mailbox_key_hash,
    v_message_key_hash,
    v_claim.payload_sha256,
    v_claim.submission_id,
    v_claim.resource,
    'transactional',
    v_state.batch_id,
    v_position,
    'reserved',
    p_finalize_capability_hash,
    v_now,
    v_now + interval '90 seconds'
  ) returning * into v_reservation;

  update public.transactional_intake_claims
  set capability_consumed_at = v_now
  where submission_id = v_claim.submission_id;

  update public.mailbox_throttle_state
  set active_reservation_id = v_reservation.id,
      batch_reservations_count = v_position,
      next_allowed_at = case
        when v_position = 1 then greatest(next_allowed_at, v_now + interval '60 seconds')
        else next_allowed_at
      end,
      updated_at = v_now
  where mailbox_key_hash = p_mailbox_key_hash
  returning * into v_state;

  return jsonb_build_object(
    'authorized', true,
    'reason_code', 'reserved',
    'reservation_id', v_reservation.id,
    'lease_expires_at', v_reservation.lease_expires_at,
    'next_allowed_at', v_state.next_allowed_at,
    'batch_position', v_position,
    'retry_after_seconds', 0
  );
end;
$$;

create or replace function public.resolve_transactional_intake_capability(
  p_intake_capability_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.transactional_intake_claims%rowtype;
begin
  if p_intake_capability_hash is null or p_intake_capability_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('valid', false, 'reason_code', 'invalid_capability');
  end if;

  select * into v_claim
  from public.transactional_intake_claims
  where intake_capability_hash = p_intake_capability_hash;

  if not found or v_claim.capability_consumed_at is not null or v_claim.capability_expires_at <= clock_timestamp() then
    return jsonb_build_object('valid', false, 'reason_code', 'capability_unavailable');
  end if;

  return jsonb_build_object(
    'valid', true,
    'reason_code', 'valid',
    'submission_id', v_claim.submission_id,
    'resource', v_claim.resource,
    'payload_sha256', v_claim.payload_sha256
  );
end;
$$;

create or replace function public.finalize_transactional_mailbox_delivery(
  p_mailbox_key_hash text,
  p_finalize_capability_hash text,
  p_state text,
  p_provider_message_hash text,
  p_failure_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.mailbox_throttle_state%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_lead_id text;
  v_event_name text;
  v_source_event_id text;
begin
  if p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$' or
     p_finalize_capability_hash is null or p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_state is null or p_state not in ('sent', 'failed', 'reconcile_required') or
     (p_provider_message_hash is not null and p_provider_message_hash !~ '^[a-f0-9]{64}$') or
     (p_failure_code is not null and p_failure_code !~ '^[A-Z0-9_:-]{2,64}$') or
     (p_state = 'sent' and (p_provider_message_hash is null or p_failure_code is not null)) or
     (p_state <> 'sent' and (p_failure_code is null or p_provider_message_hash is not null)) then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'invalid_request');
  end if;

  select * into v_state
  from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'mailbox_unavailable');
  end if;

  select * into v_reservation
  from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash
    and finalize_capability_hash = p_finalize_capability_hash
    and lane = 'transactional'
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'invalid_capability');
  end if;

  if v_reservation.status <> 'reserved' then
    if v_reservation.status = p_state and
       v_reservation.provider_message_hash is not distinct from p_provider_message_hash and
       v_reservation.failure_code is not distinct from p_failure_code then
      return jsonb_build_object(
        'accepted', true,
        'duplicate', true,
        'reason_code', 'duplicate',
        'reservation_id', v_reservation.id,
        'next_allowed_at', v_state.next_allowed_at,
        'mailbox_halted', v_state.blocked_reservation_id is not null
      );
    end if;
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'callback_conflict');
  end if;

  if v_state.active_reservation_id is distinct from v_reservation.id then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'mailbox_state_invalid');
  end if;

  update public.mailbox_delivery_reservations
  set status = p_state,
      finalized_at = v_now,
      provider_message_hash = p_provider_message_hash,
      failure_code = p_failure_code,
      updated_at = v_now
  where id = v_reservation.id;

  if p_state = 'reconcile_required' then
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        blocked_reservation_id = v_reservation.id,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  elsif v_reservation.batch_position = 2 then
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        batch_id = gen_random_uuid(),
        batch_reservations_count = 0,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  else
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  end if;

  select lead_id into strict v_lead_id
  from public.leads
  where submission_id = v_reservation.submission_id
  for update;

  v_event_name := case p_state
    when 'sent' then 'email_sent'
    when 'failed' then 'email_failed'
    else 'reconcile_required'
  end;
  v_source_event_id := 'mailbox:' || v_reservation.id::text || ':' || p_state;

  insert into public.transactional_email_events (
    submission_id,
    lead_id,
    event_name,
    source_event_id,
    occurred_at,
    provider_message_hash,
    failure_code
  ) values (
    v_reservation.submission_id,
    v_lead_id,
    v_event_name,
    v_source_event_id,
    v_now,
    p_provider_message_hash,
    p_failure_code
  );

  update public.leads
  set email_delivery_status = v_event_name,
      email_delivery_updated_at = v_now
  where submission_id = v_reservation.submission_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'reason_code', p_state,
    'reservation_id', v_reservation.id,
    'next_allowed_at', v_state.next_allowed_at,
    'mailbox_halted', v_state.blocked_reservation_id is not null
  );
end;
$$;

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

alter table public.transactional_intake_claims enable row level security;
alter table public.mailbox_throttle_state enable row level security;
alter table public.mailbox_delivery_reservations enable row level security;

revoke all privileges on table public.transactional_intake_claims from public, anon, authenticated;
revoke all privileges on table public.mailbox_throttle_state from public, anon, authenticated;
revoke all privileges on table public.mailbox_delivery_reservations from public, anon, authenticated;

revoke execute on function public.claim_transactional_intake(text,text,text,text,boolean) from public, anon, authenticated;
revoke execute on function public.resolve_transactional_intake_capability(text) from public, anon, authenticated;
revoke execute on function public.reserve_transactional_mailbox_delivery(text,text,text) from public, anon, authenticated;
revoke execute on function public.finalize_transactional_mailbox_delivery(text,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.record_transactional_lease_expiry() from public, anon, authenticated;

grant select, insert, update on table public.transactional_intake_claims to service_role;
grant select, insert, update on table public.mailbox_throttle_state to service_role;
grant select, insert, update on table public.mailbox_delivery_reservations to service_role;
grant execute on function public.claim_transactional_intake(text,text,text,text,boolean) to service_role;
grant execute on function public.resolve_transactional_intake_capability(text) to service_role;
grant execute on function public.reserve_transactional_mailbox_delivery(text,text,text) to service_role;
grant execute on function public.finalize_transactional_mailbox_delivery(text,text,text,text,text) to service_role;

commit;
