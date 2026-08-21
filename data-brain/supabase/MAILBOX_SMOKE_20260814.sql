-- Synthetic mailbox smoke. It never calls Make or Outlook and always rolls back.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';

do $$
declare
  v_result jsonb;
  v_first_reservation uuid;
  v_second_reservation uuid;
begin
  insert into public.leads (
    lead_id, form_type, lead_magnet, payload, submission_id
  ) values (
    'MAILBOX_SMOKE_LEAD_1',
    'calculator',
    'calculator',
    jsonb_build_object(
      'submission_id', 'MAILBOX_SMOKE_SUBMISSION_1',
      'consent', jsonb_build_object('privacy_accepted', true)
    ),
    'MAILBOX_SMOKE_SUBMISSION_1'
  );

  v_result := public.claim_transactional_intake(
    'MAILBOX_SMOKE_SUBMISSION_1', 'calculator', repeat('a', 64), repeat('b', 64), true
  );
  if v_result ->> 'reason_code' <> 'claimed' or not (v_result ->> 'authorized')::boolean then
    raise exception 'Transactional smoke claim failed';
  end if;

  v_result := public.reserve_transactional_mailbox_delivery(
    repeat('c', 64), repeat('b', 64), repeat('d', 64)
  );
  if v_result ->> 'reason_code' <> 'reserved'
     or not (v_result ->> 'authorized')::boolean
     or (v_result ->> 'batch_position')::integer <> 1 then
    raise exception 'First transactional reservation failed';
  end if;
  v_first_reservation := (v_result ->> 'reservation_id')::uuid;

  if not exists (
    select 1
    from public.mailbox_delivery_reservations r
    join public.mailbox_throttle_state s on s.mailbox_key_hash = r.mailbox_key_hash
    where r.id = v_first_reservation
      and r.status = 'reserved'
      and r.lease_expires_at >= r.reserved_at + interval '90 seconds'
      and s.active_reservation_id = r.id
      and s.next_allowed_at >= r.reserved_at + interval '60 seconds'
  ) then
    raise exception 'First reservation timing invariant failed';
  end if;

  v_result := public.reserve_cold_mailbox_delivery(
    repeat('c', 64), repeat('e', 64), repeat('f', 64), repeat('1', 64)
  );
  if v_result ->> 'reason_code' <> 'lease_active'
     or (v_result ->> 'authorized')::boolean then
    raise exception 'Shared transactional/cold lease did not block concurrency';
  end if;

  v_result := public.finalize_transactional_mailbox_delivery(
    repeat('c', 64), repeat('d', 64), 'sent', repeat('2', 64), null
  );
  if v_result ->> 'reason_code' <> 'sent'
     or not (v_result ->> 'accepted')::boolean
     or (v_result ->> 'duplicate')::boolean then
    raise exception 'Transactional finalization failed';
  end if;

  -- Advance only the synthetic state so position 2 can be exercised immediately.
  update public.mailbox_throttle_state
  set next_allowed_at = clock_timestamp() - interval '1 second'
  where mailbox_key_hash = repeat('c', 64);

  v_result := public.reserve_cold_mailbox_delivery(
    repeat('c', 64), repeat('e', 64), repeat('f', 64), repeat('1', 64)
  );
  if v_result ->> 'reason_code' <> 'reserved'
     or not (v_result ->> 'authorized')::boolean
     or (v_result ->> 'batch_position')::integer <> 2 then
    raise exception 'Second shared-lane reservation failed';
  end if;
  v_second_reservation := (v_result ->> 'reservation_id')::uuid;

  v_result := public.finalize_cold_mailbox_delivery(
    repeat('c', 64), repeat('1', 64), 'sent', repeat('3', 64), null
  );
  if v_result ->> 'reason_code' <> 'sent'
     or not (v_result ->> 'accepted')::boolean
     or (v_result ->> 'duplicate')::boolean then
    raise exception 'Cold finalization failed';
  end if;

  if not exists (
    select 1
    from public.mailbox_delivery_reservations r
    join public.mailbox_throttle_state s on s.mailbox_key_hash = r.mailbox_key_hash
    where r.id = v_second_reservation
      and r.status = 'sent'
      and s.active_reservation_id is null
      and s.batch_reservations_count = 0
      and s.next_allowed_at >= r.finalized_at + interval '120 seconds'
  ) then
    raise exception 'Second-reservation cooldown invariant failed';
  end if;

  v_result := public.finalize_cold_mailbox_delivery(
    repeat('c', 64), repeat('1', 64), 'sent', repeat('3', 64), null
  );
  if not (v_result ->> 'accepted')::boolean
     or not (v_result ->> 'duplicate')::boolean
     or v_result ->> 'reason_code' <> 'duplicate' then
    raise exception 'Cold finalizer is not idempotent';
  end if;

  v_result := public.reserve_cold_mailbox_delivery(
    repeat('c', 64), repeat('e', 64), repeat('f', 64), repeat('4', 64)
  );
  if v_result ->> 'reason_code' <> 'replay_blocked'
     or (v_result ->> 'authorized')::boolean then
    raise exception 'Cold message replay was not blocked';
  end if;

  insert into public.leads (
    lead_id, form_type, lead_magnet, payload, submission_id
  ) values (
    'MAILBOX_SMOKE_LEAD_2',
    'webinar',
    'webinar',
    jsonb_build_object(
      'submission_id', 'MAILBOX_SMOKE_SUBMISSION_2',
      'consent', jsonb_build_object('privacy_accepted', true)
    ),
    'MAILBOX_SMOKE_SUBMISSION_2'
  );

  v_result := public.claim_transactional_intake(
    'MAILBOX_SMOKE_SUBMISSION_2', 'webinar', repeat('5', 64), repeat('6', 64), true
  );
  if v_result ->> 'reason_code' <> 'claimed' or not (v_result ->> 'authorized')::boolean then
    raise exception 'Reconciliation smoke claim failed';
  end if;

  v_result := public.reserve_transactional_mailbox_delivery(
    repeat('7', 64), repeat('6', 64), repeat('8', 64)
  );
  if v_result ->> 'reason_code' <> 'reserved' or not (v_result ->> 'authorized')::boolean then
    raise exception 'Reconciliation smoke reservation failed';
  end if;

  v_result := public.finalize_transactional_mailbox_delivery(
    repeat('7', 64), repeat('8', 64), 'reconcile_required', null, 'OUTLOOK_TIMEOUT'
  );
  if v_result ->> 'reason_code' <> 'reconcile_required'
     or not (v_result ->> 'accepted')::boolean
     or not (v_result ->> 'mailbox_halted')::boolean then
    raise exception 'Ambiguous outcome did not halt the mailbox';
  end if;

  v_result := public.reserve_cold_mailbox_delivery(
    repeat('7', 64), repeat('9', 64), repeat('a', 64), repeat('0', 64)
  );
  if v_result ->> 'reason_code' <> 'reconcile_required'
     or (v_result ->> 'authorized')::boolean then
    raise exception 'Reconciliation lock did not block the cold lane';
  end if;
end
$$;

select
  'mailbox_smoke_ok' as result,
  (select count(*) from public.transactional_intake_claims
    where submission_id like 'MAILBOX_SMOKE_SUBMISSION_%') as synthetic_claims,
  (select count(*) from public.mailbox_throttle_state
    where mailbox_key_hash in (repeat('c', 64), repeat('7', 64))) as synthetic_mailbox_states,
  (select count(*) from public.mailbox_delivery_reservations
    where mailbox_key_hash in (repeat('c', 64), repeat('7', 64))) as synthetic_reservations,
  (select count(*) from public.transactional_email_events
    where submission_id like 'MAILBOX_SMOKE_SUBMISSION_%') as synthetic_transactional_events;

rollback;
