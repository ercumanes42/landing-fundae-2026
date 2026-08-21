-- Anchor mailbox leases and cooldowns after acquiring the authoritative row lock.
-- A timestamp captured before SELECT ... FOR UPDATE can become stale while waiting
-- and shorten the required 60/120 second windows.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create or replace function public.reserve_transactional_mailbox_delivery(
  p_mailbox_key_hash text,
  p_intake_capability_hash text,
  p_finalize_capability_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
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
  v_now := clock_timestamp();

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
  v_now := clock_timestamp();

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
    v_now := clock_timestamp();

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
  v_now := clock_timestamp();
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
  v_now := clock_timestamp();
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
  v_now := clock_timestamp();

  if v_state.blocked_reservation_id is not null then
    return jsonb_build_object('authorized', false, 'reason_code', 'reconcile_required', 'retry_after_seconds', 0);
  end if;

  select * into v_existing
  from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash and message_key_hash = p_message_key_hash
  for update;
  v_now := clock_timestamp();
  if found then
    return jsonb_build_object('authorized', false, 'reason_code', 'replay_blocked');
  end if;

  if v_state.active_reservation_id is not null then
    select * into v_active
    from public.mailbox_delivery_reservations
    where id = v_state.active_reservation_id
    for update;
    v_now := clock_timestamp();
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
  v_now := clock_timestamp();
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

revoke execute on function public.reserve_transactional_mailbox_delivery(text,text,text)
  from public, anon, authenticated;
revoke execute on function public.finalize_transactional_mailbox_delivery(text,text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.reserve_cold_mailbox_delivery(text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.finalize_cold_mailbox_delivery(text,text,text,text,text)
  from public, anon, authenticated;

grant execute on function public.reserve_transactional_mailbox_delivery(text,text,text)
  to service_role;
grant execute on function public.finalize_transactional_mailbox_delivery(text,text,text,text,text)
  to service_role;
grant execute on function public.reserve_cold_mailbox_delivery(text,text,text,text)
  to service_role;
grant execute on function public.finalize_cold_mailbox_delivery(text,text,text,text,text)
  to service_role;

commit;
