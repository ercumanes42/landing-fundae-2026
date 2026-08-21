-- Rollback-only behavioral smoke for durable HubSpot synchronization.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '10min';
set local idle_in_transaction_session_timeout = '10min';

do $$
declare
  v_suffix text:=pg_catalog.replace(extensions.gen_random_uuid()::text,'-','');
  v_campaign uuid;
  v_contact uuid;
  v_worker text:=pg_catalog.repeat('a',64);
  v_result jsonb;
  v_item jsonb;
begin
  if not exists (
    select 1 from public.outbound_delivery_control
    where singleton and not master_enabled and not transactional_enabled
      and not cold_enabled and not hubspot_enabled
  ) then
    raise exception using errcode='55000',
      message='hubspot_sync_smoke_requires_all_switches_off';
  end if;

  insert into public.campaigns(name,external_id,is_active,status)
  values ('HubSpot sync smoke','HUBSPOT_SYNC_SMOKE_'||v_suffix,false,'draft')
  returning id into v_campaign;

  insert into public.campaign_contacts(
    campaign_id,external_contact_id,external_account_id,email_hash,
    contact_data,variant,magnet,lot,company_size
  ) values (
    v_campaign,'contact_'||v_suffix,'account_'||v_suffix,
    pg_catalog.repeat('b',64),
    jsonb_build_object(
      'email','hubspot-smoke-'||v_suffix||'@example.invalid',
      'first_name','Smoke','last_name','Contact','company_name','Example'
    ),'Checklist','Checklist','A','1-9'
  ) returning id into v_contact;

  if not exists (
    select 1 from public.hubspot_sync_outbox
    where campaign_contact_id=v_contact and status='queued_off'
      and desired_version=1 and synced_version=0
  ) then
    raise exception using errcode='23514',
      message='hubspot_insert_was_not_queued_off';
  end if;

  v_result:=public.claim_hubspot_sync_outbox(v_worker,1,120);
  if v_result->>'reason_code'<>'hubspot_off' or
     pg_catalog.jsonb_array_length(v_result->'items')<>0 then
    raise exception using errcode='23514',
      message='hubspot_off_claim_was_accepted';
  end if;

  update public.hubspot_sync_outbox
  set next_attempt_at='infinity'::timestamptz
  where campaign_contact_id<>v_contact;
  update public.outbound_delivery_control
  set master_enabled=true,hubspot_enabled=true,
      transactional_enabled=false,cold_enabled=false,
      updated_at=pg_catalog.clock_timestamp()
  where singleton;

  v_result:=public.claim_hubspot_sync_outbox(v_worker,1,120);
  if not (v_result->>'accepted')::boolean or
     v_result->>'reason_code'<>'claimed' or
     pg_catalog.jsonb_array_length(v_result->'items')<>1 then
    raise exception using errcode='23514',
      message='hubspot_claim_failed';
  end if;
  v_item:=v_result->'items'->0;
  if (v_item->>'campaign_contact_id')::uuid<>v_contact or
     (v_item->>'version')::bigint<>1 then
    raise exception using errcode='23514',
      message='hubspot_claim_identity_mismatch';
  end if;

  update public.campaign_contacts
  set contact_data=jsonb_set(contact_data,'{job_title}','"Updated"'::jsonb)
  where id=v_contact;
  if not exists (
    select 1 from public.hubspot_sync_outbox
    where campaign_contact_id=v_contact and status='claimed'
      and desired_version=2 and claimed_version=1
  ) then
    raise exception using errcode='23514',
      message='hubspot_claim_was_not_versioned_during_update';
  end if;

  v_result:=public.finalize_hubspot_sync_outbox(
    v_contact,v_worker,(v_item->>'claim_token')::uuid,1,
    'synced','hubspot-smoke-id',pg_catalog.repeat('c',64),null
  );
  if not (v_result->>'accepted')::boolean or
     not (v_result->>'stale')::boolean or
     v_result->>'reason_code'<>'pending' or not exists (
       select 1 from public.hubspot_sync_outbox
       where campaign_contact_id=v_contact and status='pending'
         and desired_version=2 and synced_version=1
     ) then
    raise exception using errcode='23514',
      message='hubspot_stale_finalize_not_requeued';
  end if;

  v_result:=public.claim_hubspot_sync_outbox(v_worker,1,120);
  v_item:=v_result->'items'->0;
  v_result:=public.finalize_hubspot_sync_outbox(
    v_contact,v_worker,(v_item->>'claim_token')::uuid,2,
    'retryable_failure',null,pg_catalog.repeat('d',64),'upstream_unavailable'
  );
  if not (v_result->>'accepted')::boolean or
     v_result->>'reason_code'<>'retry_wait' then
    raise exception using errcode='23514',
      message='hubspot_retry_was_not_durable';
  end if;

  update public.outbound_delivery_control
  set master_enabled=false,updated_at=pg_catalog.clock_timestamp()
  where singleton;
  if not exists (
    select 1 from public.outbound_delivery_control
    where singleton and not master_enabled and not transactional_enabled
      and not cold_enabled and not hubspot_enabled
  ) then
    raise exception using errcode='23514',
      message='hubspot_master_dominance_failed';
  end if;
end;
$$;

select 'fundae_release_hubspot_sync_smoke_ok' as result;

rollback;
