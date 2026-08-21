-- Synthetic, PII-free, rollback-only campaign suppression smoke.
-- It never enables outbound, provisions contacts or calls an external provider.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';
set local idle_in_transaction_session_timeout = '5min';

do $$
declare
  v_suffix text := pg_catalog.replace(extensions.gen_random_uuid()::text, '-', '');
  v_identity_hash text := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(extensions.gen_random_uuid()::text, 'UTF8'), 'sha256'
  ), 'hex');
  v_campaign_a uuid;
  v_campaign_b uuid;
  v_contact_a uuid;
  v_contact_b uuid;
begin
  if not exists (
    select 1 from public.outbound_delivery_control
    where singleton and not master_enabled and not transactional_enabled and not cold_enabled
  ) or not exists (
    select 1 from public.cold_campaign_provision_control
    where singleton and not enabled
  ) then
    raise exception using errcode = '55000',
      message = 'campaign_suppression_smoke_requires_all_switches_off';
  end if;

  insert into public.campaigns(name, external_id, is_active, status)
  values ('Suppression smoke A', 'SUPPRESSION_SMOKE_A_' || v_suffix, true, 'pilot')
  returning id into v_campaign_a;
  insert into public.campaigns(name, external_id, is_active, status)
  values ('Suppression smoke B', 'SUPPRESSION_SMOKE_B_' || v_suffix, true, 'pilot')
  returning id into v_campaign_b;

  insert into public.campaign_contacts(
    campaign_id, external_contact_id, external_account_id, email_hash,
    variant, magnet, lot
  ) values (
    v_campaign_a, 'contact_a_' || v_suffix, 'account_a_' || v_suffix,
    v_identity_hash, 'Checklist', 'Checklist', 'A'
  ) returning id into v_contact_a;
  insert into public.campaign_contacts(
    campaign_id, external_contact_id, external_account_id, email_hash,
    variant, magnet, lot
  ) values (
    v_campaign_b, 'contact_b_' || v_suffix, 'account_b_' || v_suffix,
    v_identity_hash, 'Checklist', 'Checklist', 'B'
  ) returning id into v_contact_b;

  insert into public.campaign_executions(
    campaign_id, campaign_contact_id, idempotency_key, channel,
    capture_method, action_name, step, status, planned_at
  ) values
    (v_campaign_a, v_contact_a, 'smoke_a_' || v_suffix, 'email',
     'automation', 'delivery_scheduled', 1, 'planned', pg_catalog.clock_timestamp()),
    (v_campaign_b, v_contact_b, 'smoke_b_' || v_suffix, 'email',
     'automation', 'delivery_scheduled', 1, 'planned', pg_catalog.clock_timestamp());

  insert into public.campaign_events(
    campaign_id, campaign_contact_id, source_event_id, event_name, occurred_at
  ) values (
    v_campaign_a, v_contact_a, 'opposition_' || v_suffix, 'opposition',
    pg_catalog.clock_timestamp() - interval '3 minutes'
  );
  if not exists (
    select 1 from public.campaign_suppressions
    where identity_hash = v_identity_hash and scope = 'marketing' and reason = 'opposition'
  ) or (select pg_catalog.count(*) from public.campaign_contacts
        where email_hash = v_identity_hash and sequence_status = 'stopped'
          and suppression_scope = 'marketing') <> 2
     or (select pg_catalog.count(*) from public.campaign_executions
         where campaign_contact_id in (v_contact_a, v_contact_b)
           and status = 'stopped') <> 2 then
    raise exception using errcode = '23514',
      message = 'campaign_opposition_suppression_smoke_failed';
  end if;

  insert into public.campaign_events(
    campaign_id, campaign_contact_id, source_event_id, event_name, occurred_at
  ) values (
    v_campaign_b, v_contact_b, 'bounce_' || v_suffix, 'bounce_hard',
    pg_catalog.clock_timestamp() - interval '2 minutes'
  );
  if not exists (
    select 1 from public.campaign_suppressions
    where identity_hash = v_identity_hash and scope = 'marketing' and reason = 'hard_bounce'
  ) then
    raise exception using errcode = '23514',
      message = 'campaign_hard_bounce_precedence_smoke_failed';
  end if;

  insert into public.campaign_events(
    campaign_id, campaign_contact_id, source_event_id, event_name, occurred_at
  ) values (
    v_campaign_a, v_contact_a, 'unsubscribe_' || v_suffix, 'unsubscribe',
    pg_catalog.clock_timestamp() - interval '1 minute'
  );
  if not exists (
    select 1 from public.campaign_suppressions
    where identity_hash = v_identity_hash and scope = 'all' and reason = 'unsubscribe'
  ) or (select pg_catalog.count(*) from public.campaign_contacts
        where email_hash = v_identity_hash and suppression_scope = 'all'
          and suppression_reason = 'unsubscribe') <> 2 then
    raise exception using errcode = '23514',
      message = 'campaign_unsubscribe_precedence_smoke_failed';
  end if;

  begin
    insert into public.campaign_contacts(
      campaign_id, external_contact_id, external_account_id, email_hash,
      variant, magnet, lot
    ) values (
      v_campaign_b, 'contact_rejected_' || v_suffix, 'account_rejected_' || v_suffix,
      v_identity_hash, 'Checklist', 'Checklist', 'B'
    );
    raise exception using errcode = 'P0001',
      message = 'suppressed_campaign_contact_was_accepted';
  exception when check_violation then
    if sqlerrm <> 'campaign_contact_suppressed' then
      raise;
    end if;
  end;

  if exists (
    select 1 from public.outbound_delivery_control
    where singleton and (master_enabled or transactional_enabled or cold_enabled)
  ) or exists (
    select 1 from public.cold_campaign_provision_control
    where singleton and enabled
  ) then
    raise exception using errcode = '23514',
      message = 'campaign_suppression_smoke_changed_switches';
  end if;
end;
$$;

do $$
declare
  v_suffix text := pg_catalog.replace(extensions.gen_random_uuid()::text, '-', '');
  v_campaign_id uuid;
  v_apply_definition text := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb)'
  ));
  v_finalize_definition text := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.finalize_cold_campaign_provision(text,text,text)'
  ));
begin
  if pg_catalog.strpos(v_apply_definition, 'cold-provision-v2') <> 0 or
     pg_catalog.strpos(v_finalize_definition, 'cold-provision-v2') <> 0 or
     pg_catalog.strpos(
       v_apply_definition,
       'v_row->>''company_size'',v_row->>''technical_evidence_sha256'''
     ) = 0 or
     pg_catalog.strpos(
       v_finalize_definition,
       '''cold-provision-v3'',v_manifest.logical_dataset_hash'
     ) = 0 or
     pg_catalog.strpos(
       v_finalize_definition,
       'v_manifest.technical_evidence_hash,v_manifest.campaign_external_id'
     ) = 0 then
    raise exception using errcode = '23514',
      message = 'campaign_provision_v3_function_binding_smoke_failed';
  end if;

  insert into public.campaigns(name, external_id, is_active, status)
  values (
    'Provision v3 smoke', 'PROVISION_V3_SMOKE_' || v_suffix, false, 'draft'
  ) returning id into v_campaign_id;

  begin
    insert into public.cold_campaign_provision_manifests(
      manifest_hash,campaign_id,actor_hash,logical_dataset_hash,
      technical_evidence_hash,campaign_external_id,hash_domain,batch_count
    ) values (
      pg_catalog.repeat('1',64),v_campaign_id,pg_catalog.repeat('2',64),
      pg_catalog.repeat('3',64),pg_catalog.repeat('4',64),
      'PROVISION_V3_SMOKE_' || v_suffix,'cold-provision-v2',10
    );
    raise exception using errcode = 'P0001',
      message = 'campaign_provision_v2_manifest_was_accepted';
  exception when check_violation then
    if sqlerrm not like '%cold_campaign_provision_manifests_hash_domain_check%' then
      raise;
    end if;
  end;

  begin
    insert into public.cold_campaign_provision_manifests(
      manifest_hash,campaign_id,actor_hash,logical_dataset_hash,
      technical_evidence_hash,campaign_external_id,hash_domain,batch_count
    ) values (
      pg_catalog.repeat('5',64),v_campaign_id,pg_catalog.repeat('6',64),
      pg_catalog.repeat('7',64),null,
      'PROVISION_V3_SMOKE_' || v_suffix,'cold-provision-v3',10
    );
    raise exception using errcode = 'P0001',
      message = 'campaign_provision_manifest_without_evidence_was_accepted';
  exception when not_null_violation then
    if sqlerrm not like '%technical_evidence_hash%' then
      raise;
    end if;
  end;

  if exists (
    select 1 from public.outbound_delivery_control
    where singleton and (master_enabled or transactional_enabled or cold_enabled)
  ) or exists (
    select 1 from public.cold_campaign_provision_control
    where singleton and enabled
  ) then
    raise exception using errcode = '23514',
      message = 'campaign_provision_v3_smoke_changed_switches';
  end if;
end;
$$;

select 'fundae_release_campaign_suppression_smoke_ok' as result;
select 'fundae_release_campaign_provision_v3_smoke_ok' as result;

rollback;
