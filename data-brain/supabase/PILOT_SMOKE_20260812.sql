-- Live synthetic verification for the FUNDAE pilot release.
-- Uses no PII and always rolls back.
begin;
set local statement_timeout = '5min';

do $$
declare
  v_campaign_id uuid;
  v_primary_contact_id uuid;
  v_sibling_contact_id uuid;
  v_result jsonb;
begin
  insert into public.campaigns (
    name, external_id, status, is_active, intent_enabled
  ) values (
    'FUNDAE synthetic rollback smoke',
    'FUNDAE_PILOT_SMOKE_ROLLBACK_20260812',
    'pilot',
    true,
    false
  ) returning id into v_campaign_id;

  insert into public.campaign_contacts (
    campaign_id, external_contact_id, external_account_id, email_hash,
    contact_data, variant, magnet, lot, current_step, sequence_status,
    next_delivery_status, cold_sequence_status, intent_sequence_status,
    marketing_lane, suppression_scope
  ) values (
    v_campaign_id, 'SYNTHETIC_CONTACT_A', 'SYNTHETIC_ACCOUNT',
    'synthetic_identity_hash_20260812_abcdef',
    jsonb_build_object('synthetic', true), 'A', 'Checklist', 'A', 1, 'active',
    'pending', 'active', 'not_eligible', 'cold', 'none'
  ) returning id into v_primary_contact_id;

  insert into public.campaign_contacts (
    campaign_id, external_contact_id, external_account_id, email_hash,
    contact_data, variant, magnet, lot, current_step, sequence_status,
    next_delivery_status, cold_sequence_status, intent_sequence_status,
    marketing_lane, suppression_scope
  ) values (
    v_campaign_id, 'SYNTHETIC_CONTACT_B', 'SYNTHETIC_ACCOUNT',
    'synthetic_identity_hash_20260812_abcdef',
    jsonb_build_object('synthetic', true), 'B', 'Calculadora', 'B', 1, 'active',
    'pending', 'active', 'not_eligible', 'cold', 'none'
  ) returning id into v_sibling_contact_id;

  v_result := public.record_campaign_tracking_event(
    'FUNDAE_PILOT_SMOKE_ROLLBACK_20260812',
    'SYNTHETIC_CONTACT_A',
    'synthetic.schedule.20260812',
    'synthetic.execution.20260812',
    'delivery_scheduled',
    'email',
    'automation',
    now(),
    now() + interval '5 minutes',
    1,
    jsonb_build_object('synthetic', true),
    '{}'::jsonb,
    'confirmed',
    'planned'
  );
  if coalesce((v_result ->> 'duplicate')::boolean, true) then
    raise exception 'First tracking event was not created';
  end if;

  v_result := public.record_campaign_tracking_event(
    'FUNDAE_PILOT_SMOKE_ROLLBACK_20260812',
    'SYNTHETIC_CONTACT_A',
    'synthetic.schedule.20260812',
    'synthetic.execution.20260812',
    'delivery_scheduled',
    'email',
    'automation',
    now(),
    now() + interval '5 minutes',
    1,
    jsonb_build_object('synthetic', true),
    '{}'::jsonb,
    'confirmed',
    'planned'
  );
  if not coalesce((v_result ->> 'duplicate')::boolean, false) then
    raise exception 'Tracking idempotency failed';
  end if;

  v_result := public.authorize_campaign_delivery(
    'FUNDAE_PILOT_SMOKE_ROLLBACK_20260812',
    'SYNTHETIC_CONTACT_A',
    'synthetic.execution.20260812',
    now()
  );
  if not coalesce((v_result ->> 'authorized')::boolean, false) then
    raise exception 'JIT authorization did not authorize the eligible synthetic execution';
  end if;

  v_result := public.issue_campaign_unsubscribe_token(
    'FUNDAE_PILOT_SMOKE_ROLLBACK_20260812',
    'SYNTHETIC_CONTACT_A',
    repeat('a', 64),
    1,
    now() + interval '1 day'
  );
  if not coalesce((v_result ->> 'issued')::boolean, false) then
    raise exception 'Synthetic unsubscribe token was not issued';
  end if;

  v_result := public.consume_campaign_unsubscribe_token(
    repeat('a', 64),
    now(),
    'unsubscribe:' || repeat('b', 48)
  );
  if not coalesce((v_result ->> 'accepted')::boolean, false) or
     coalesce((v_result ->> 'duplicate')::boolean, true) then
    raise exception 'First synthetic unsubscribe was not accepted';
  end if;

  v_result := public.consume_campaign_unsubscribe_token(
    repeat('a', 64),
    now(),
    'unsubscribe:' || repeat('b', 48)
  );
  if not coalesce((v_result ->> 'accepted')::boolean, false) or
     not coalesce((v_result ->> 'duplicate')::boolean, false) then
    raise exception 'Synthetic unsubscribe retry was not idempotent';
  end if;

  if (select count(*) from public.campaign_contacts
      where id in (v_primary_contact_id, v_sibling_contact_id)
        and suppression_scope = 'all'
        and marketing_lane = 'none'
        and sequence_status = 'stopped'
        and next_delivery_status = 'stopped'
        and lock_token is null
        and lock_expires_at is null) <> 2 then
    raise exception 'Global suppression did not stop both synthetic sibling contacts';
  end if;

  if exists (
    select 1 from public.campaign_executions
    where campaign_id = v_campaign_id and status = 'planned'
  ) then
    raise exception 'A planned synthetic execution survived global suppression';
  end if;

  v_result := public.authorize_campaign_delivery(
    'FUNDAE_PILOT_SMOKE_ROLLBACK_20260812',
    'SYNTHETIC_CONTACT_A',
    'synthetic.execution.20260812',
    now()
  );
  if coalesce((v_result ->> 'authorized')::boolean, true) or
     v_result ->> 'reason_code' <> 'suppressed' then
    raise exception 'JIT authorization did not fail closed after suppression';
  end if;

  v_result := public.consume_rate_limit(repeat('c', 64), 2, 60, now());
  if not coalesce((v_result ->> 'allowed')::boolean, false) then
    raise exception 'Rate limit rejected the first synthetic request';
  end if;
  v_result := public.consume_rate_limit(repeat('c', 64), 2, 60, now());
  if not coalesce((v_result ->> 'allowed')::boolean, false) then
    raise exception 'Rate limit rejected the second synthetic request';
  end if;
  v_result := public.consume_rate_limit(repeat('c', 64), 2, 60, now());
  if coalesce((v_result ->> 'allowed')::boolean, true) then
    raise exception 'Rate limit accepted a request above the synthetic limit';
  end if;
end;
$$;

select
  'pilot_smoke_ok' as result,
  (select count(*) from public.campaign_contacts
    where campaign_id = (
      select id from public.campaigns
      where external_id = 'FUNDAE_PILOT_SMOKE_ROLLBACK_20260812'
    )) as synthetic_contacts,
  (select count(*) from public.campaign_suppressions
    where identity_hash = 'synthetic_identity_hash_20260812_abcdef') as synthetic_suppressions,
  (select count(*) from public.campaign_events
    where campaign_id = (
      select id from public.campaigns
      where external_id = 'FUNDAE_PILOT_SMOKE_ROLLBACK_20260812'
    )) as synthetic_events,
  (select count(*) from public.campaign_executions
    where campaign_id = (
      select id from public.campaigns
      where external_id = 'FUNDAE_PILOT_SMOKE_ROLLBACK_20260812'
    ) and status = 'planned') as remaining_planned_executions;

rollback;
