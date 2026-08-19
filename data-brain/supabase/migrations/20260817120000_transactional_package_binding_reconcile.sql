-- Bind the rendered delivery package to the atomic reservation and provide a
-- service-role-only, audited resolution for ambiguous Outlook outcomes.
-- This migration does not activate Outlook or send email.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.mailbox_delivery_reservations
  add column if not exists package_hmac_sha256 text,
  add column if not exists reconciliation_resolution text,
  add column if not exists reconciliation_evidence_hash text,
  add column if not exists reconciled_at timestamptz;

alter table public.mailbox_delivery_reservations
  drop constraint if exists mailbox_delivery_package_hmac_check;
alter table public.mailbox_delivery_reservations
  add constraint mailbox_delivery_package_hmac_check
  check (package_hmac_sha256 is null or package_hmac_sha256 ~ '^[a-f0-9]{64}$') not valid;
alter table public.mailbox_delivery_reservations
  validate constraint mailbox_delivery_package_hmac_check;

alter table public.mailbox_delivery_reservations
  drop constraint if exists mailbox_delivery_reconciliation_fields_check;
alter table public.mailbox_delivery_reservations
  add constraint mailbox_delivery_reconciliation_fields_check check (
    (
      reconciliation_resolution is null and
      reconciliation_evidence_hash is null and
      reconciled_at is null
    ) or (
      reconciliation_resolution in ('confirmed_sent', 'confirmed_not_sent') and
      reconciliation_evidence_hash ~ '^[a-f0-9]{64}$' and
      reconciled_at is not null
    )
  ) not valid;
alter table public.mailbox_delivery_reservations
  validate constraint mailbox_delivery_reconciliation_fields_check;

create or replace function public.reserve_transactional_mailbox_delivery(
  p_mailbox_key_hash text,
  p_intake_capability_hash text,
  p_finalize_capability_hash text,
  p_package_hmac_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_result jsonb;
  v_updated integer;
begin
  if p_package_hmac_sha256 is null or p_package_hmac_sha256 !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('authorized', false, 'reason_code', 'invalid_request');
  end if;

  v_result := public.reserve_transactional_mailbox_delivery(
    p_mailbox_key_hash,
    p_intake_capability_hash,
    p_finalize_capability_hash
  );

  if coalesce((v_result ->> 'authorized')::boolean, false) then
    update public.mailbox_delivery_reservations
    set package_hmac_sha256 = p_package_hmac_sha256,
        updated_at = clock_timestamp()
    where id = (v_result ->> 'reservation_id')::uuid
      and lane = 'transactional'
      and status = 'reserved'
      and package_hmac_sha256 is null;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using errcode = '23514', message = 'package_binding_failed';
    end if;
  end if;

  return v_result;
end;
$$;

create or replace function public.reconcile_transactional_mailbox_delivery(
  p_reservation_id uuid,
  p_resolution text,
  p_provider_message_hash text,
  p_evidence_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_state public.mailbox_throttle_state%rowtype;
  v_lead_id text;
  v_status text;
  v_event_name text;
  v_failure_code text;
  v_reason_code text;
begin
  if p_reservation_id is null or
     p_resolution not in ('confirmed_sent', 'confirmed_not_sent') or
     p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$' or
     (p_resolution = 'confirmed_sent' and
       (p_provider_message_hash is null or p_provider_message_hash !~ '^[a-f0-9]{64}$')) or
     (p_resolution = 'confirmed_not_sent' and p_provider_message_hash is not null) then
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'reason_code', 'invalid_request',
      'mailbox_halted', true
    );
  end if;

  select * into v_reservation
  from public.mailbox_delivery_reservations
  where id = p_reservation_id
    and lane = 'transactional'
  for update;
  if not found then
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'reason_code', 'reservation_unavailable',
      'mailbox_halted', true
    );
  end if;

  select * into v_state
  from public.mailbox_throttle_state
  where mailbox_key_hash = v_reservation.mailbox_key_hash
  for update;
  if not found then
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'reason_code', 'mailbox_unavailable',
      'mailbox_halted', true
    );
  end if;

  v_status := case p_resolution when 'confirmed_sent' then 'sent' else 'failed' end;
  v_event_name := case p_resolution when 'confirmed_sent' then 'email_sent' else 'email_failed' end;
  v_failure_code := case p_resolution when 'confirmed_not_sent' then 'DEFINITIVE_RECONCILED_NOT_SENT' else null end;
  v_reason_code := case p_resolution when 'confirmed_sent' then 'reconciled_sent' else 'reconciled_not_sent' end;

  if v_reservation.reconciliation_resolution is not null then
    if v_reservation.reconciliation_resolution = p_resolution and
       v_reservation.reconciliation_evidence_hash = p_evidence_hash and
       v_reservation.provider_message_hash is not distinct from p_provider_message_hash and
       v_reservation.status = v_status then
      return jsonb_build_object(
        'accepted', true,
        'duplicate', true,
        'reason_code', v_reason_code,
        'mailbox_halted', v_state.blocked_reservation_id is not null
      );
    end if;
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'reason_code', 'reconciliation_conflict',
      'mailbox_halted', v_state.blocked_reservation_id is not null
    );
  end if;

  if v_reservation.status <> 'reconcile_required' or
     v_state.blocked_reservation_id is distinct from v_reservation.id or
     v_state.active_reservation_id is not null then
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'reason_code', 'reconciliation_state_invalid',
      'mailbox_halted', v_state.blocked_reservation_id is not null
    );
  end if;

  update public.mailbox_delivery_reservations
  set status = v_status,
      finalized_at = v_now,
      provider_message_hash = p_provider_message_hash,
      failure_code = v_failure_code,
      reconciliation_resolution = p_resolution,
      reconciliation_evidence_hash = p_evidence_hash,
      reconciled_at = v_now,
      updated_at = v_now
  where id = v_reservation.id;

  if v_reservation.batch_position = 2 then
    update public.mailbox_throttle_state
    set blocked_reservation_id = null,
        active_reservation_id = null,
        batch_id = extensions.gen_random_uuid(),
        batch_reservations_count = 0,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = v_reservation.mailbox_key_hash;
  else
    update public.mailbox_throttle_state
    set blocked_reservation_id = null,
        active_reservation_id = null,
        next_allowed_at = greatest(next_allowed_at, v_now + interval '120 seconds'),
        updated_at = v_now
    where mailbox_key_hash = v_reservation.mailbox_key_hash;
  end if;

  select lead_id into strict v_lead_id
  from public.leads
  where submission_id = v_reservation.submission_id
  for update;

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
    'mailbox:' || v_reservation.id::text || ':reconciled:' || p_resolution,
    v_now,
    p_provider_message_hash,
    v_failure_code
  );

  update public.leads
  set email_delivery_status = v_event_name,
      email_delivery_updated_at = v_now
  where submission_id = v_reservation.submission_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'reason_code', v_reason_code,
    'mailbox_halted', false
  );
end;
$$;

revoke execute on function public.reserve_transactional_mailbox_delivery(text,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.reserve_transactional_mailbox_delivery(text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.reconcile_transactional_mailbox_delivery(uuid,text,text,text)
  from public, anon, authenticated;

grant execute on function public.reserve_transactional_mailbox_delivery(text,text,text,text)
  to service_role;
grant execute on function public.reconcile_transactional_mailbox_delivery(uuid,text,text,text)
  to service_role;

commit;
