-- Share the physical-mailbox lock with a server-only cold lane.
-- This migration creates no HTTP endpoint and does not activate cold delivery.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.mailbox_delivery_reservations
  alter column submission_id drop not null,
  alter column resource drop not null;

alter table public.mailbox_delivery_reservations
  drop constraint if exists mailbox_delivery_lane_claim_check;
alter table public.mailbox_delivery_reservations
  add constraint mailbox_delivery_lane_claim_check check (
    (lane = 'transactional' and submission_id is not null and resource is not null) or
    (lane = 'cold' and submission_id is null and resource is null)
  ) not valid;
alter table public.mailbox_delivery_reservations
  validate constraint mailbox_delivery_lane_claim_check;

create or replace function public.reserve_cold_mailbox_delivery(
  p_mailbox_key_hash text,
  p_message_key_hash text,
  p_payload_sha256 text,
  p_finalize_capability_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.mailbox_throttle_state%rowtype;
  v_active public.mailbox_delivery_reservations%rowtype;
  v_existing public.mailbox_delivery_reservations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_position smallint;
begin
  if p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$'
     or p_message_key_hash is null or p_message_key_hash !~ '^[a-f0-9]{64}$'
     or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$'
     or p_finalize_capability_hash is null or p_finalize_capability_hash !~ '^[a-f0-9]{64}$' then
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
    return jsonb_build_object('authorized', false, 'reason_code', 'reconcile_required', 'retry_after_seconds', 0);
  end if;

  select * into v_existing
  from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash and message_key_hash = p_message_key_hash
  for update;
  if found then
    return jsonb_build_object('authorized', false, 'reason_code', 'replay_blocked');
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
      set status = 'reconcile_required', finalized_at = v_now,
          failure_code = 'LEASE_EXPIRED', updated_at = v_now
      where id = v_active.id;
      update public.mailbox_throttle_state
      set active_reservation_id = null, blocked_reservation_id = v_active.id,
          next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
          updated_at = v_now
      where mailbox_key_hash = p_mailbox_key_hash;
      return jsonb_build_object('authorized', false, 'reason_code', 'lease_expired_reconcile_required');
    end if;
    return jsonb_build_object(
      'authorized', false, 'reason_code', 'lease_active',
      'lease_expires_at', v_active.lease_expires_at,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_active.lease_expires_at - v_now))))::integer
    );
  end if;

  if v_state.next_allowed_at > v_now then
    return jsonb_build_object(
      'authorized', false, 'reason_code', 'cooldown',
      'next_allowed_at', v_state.next_allowed_at,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_state.next_allowed_at - v_now))))::integer
    );
  end if;

  v_position := v_state.batch_reservations_count + 1;
  if v_position not in (1, 2) then
    return jsonb_build_object('authorized', false, 'reason_code', 'mailbox_state_invalid');
  end if;

  insert into public.mailbox_delivery_reservations (
    mailbox_key_hash, message_key_hash, payload_sha256, submission_id, resource,
    lane, batch_id, batch_position, status, finalize_capability_hash,
    reserved_at, lease_expires_at
  ) values (
    p_mailbox_key_hash, p_message_key_hash, p_payload_sha256, null, null,
    'cold', v_state.batch_id, v_position, 'reserved', p_finalize_capability_hash,
    v_now, v_now + interval '90 seconds'
  ) returning * into v_reservation;

  update public.mailbox_throttle_state
  set active_reservation_id = v_reservation.id,
      batch_reservations_count = v_position,
      next_allowed_at = case when v_position = 1
        then greatest(next_allowed_at, v_now + interval '60 seconds')
        else next_allowed_at end,
      updated_at = v_now
  where mailbox_key_hash = p_mailbox_key_hash
  returning * into v_state;

  return jsonb_build_object(
    'authorized', true, 'reason_code', 'reserved',
    'reservation_id', v_reservation.id,
    'lease_expires_at', v_reservation.lease_expires_at,
    'next_allowed_at', v_state.next_allowed_at,
    'batch_position', v_position, 'retry_after_seconds', 0
  );
end;
$$;

create or replace function public.finalize_cold_mailbox_delivery(
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
begin
  if p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$'
     or p_finalize_capability_hash is null or p_finalize_capability_hash !~ '^[a-f0-9]{64}$'
     or p_state is null or p_state not in ('sent', 'failed', 'reconcile_required')
     or (p_provider_message_hash is not null and p_provider_message_hash !~ '^[a-f0-9]{64}$')
     or (p_failure_code is not null and p_failure_code !~ '^[A-Z0-9_:-]{2,64}$')
     or (p_state = 'sent' and (p_provider_message_hash is null or p_failure_code is not null))
     or (p_state <> 'sent' and (p_failure_code is null or p_provider_message_hash is not null)) then
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
    and lane = 'cold'
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'duplicate', false, 'reason_code', 'invalid_capability');
  end if;

  if v_reservation.status <> 'reserved' then
    if v_reservation.status = p_state
       and v_reservation.provider_message_hash is not distinct from p_provider_message_hash
       and v_reservation.failure_code is not distinct from p_failure_code then
      return jsonb_build_object(
        'accepted', true, 'duplicate', true, 'reason_code', 'duplicate',
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
  set status = p_state, finalized_at = v_now,
      provider_message_hash = p_provider_message_hash,
      failure_code = p_failure_code, updated_at = v_now
  where id = v_reservation.id;

  if p_state = 'reconcile_required' then
    update public.mailbox_throttle_state
    set active_reservation_id = null, blocked_reservation_id = v_reservation.id,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  elsif v_reservation.batch_position = 2 then
    update public.mailbox_throttle_state
    set active_reservation_id = null, batch_id = gen_random_uuid(),
        batch_reservations_count = 0,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  else
    update public.mailbox_throttle_state
    set active_reservation_id = null, updated_at = v_now
    where mailbox_key_hash = p_mailbox_key_hash
    returning * into v_state;
  end if;

  return jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', p_state,
    'reservation_id', v_reservation.id,
    'next_allowed_at', v_state.next_allowed_at,
    'mailbox_halted', v_state.blocked_reservation_id is not null
  );
end;
$$;

revoke execute on function public.reserve_cold_mailbox_delivery(text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.finalize_cold_mailbox_delivery(text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.reserve_cold_mailbox_delivery(text,text,text,text)
  to service_role;
grant execute on function public.finalize_cold_mailbox_delivery(text,text,text,text,text)
  to service_role;

commit;
