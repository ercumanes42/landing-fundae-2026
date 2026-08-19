-- OFF-by-default, idempotent cold campaign provisioning. Local artifact only.
begin;

create table public.cold_campaign_provision_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  expected_manifest_hash text check (expected_manifest_hash is null or expected_manifest_hash ~ '^[a-f0-9]{64}$'),
  expected_authorization_hash text check (expected_authorization_hash is null or expected_authorization_hash ~ '^[a-f0-9]{64}$'),
  authorized_actor_hash text check (authorized_actor_hash is null or authorized_actor_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (not enabled or (expected_manifest_hash is not null and expected_authorization_hash is not null and authorized_actor_hash is not null and expires_at is not null))
);
insert into public.cold_campaign_provision_control(singleton,enabled) values(true,false);

create table public.cold_campaign_provision_manifests (
  manifest_hash text primary key check (manifest_hash ~ '^[a-f0-9]{64}$'),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  logical_dataset_hash text not null check (logical_dataset_hash ~ '^[a-f0-9]{64}$'),
  campaign_external_id text not null check (campaign_external_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$'),
  hash_domain text not null default 'cold-provision-v2' check (hash_domain='cold-provision-v2'),
  batch_count integer not null check (batch_count between 1 and 100),
  expected_contacts integer not null default 939 check (expected_contacts=939),
  expected_payloads integer not null default 4695 check (expected_payloads=4695),
  status text not null default 'applying' check (status in ('applying','prepared_off')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  prepared_at timestamptz
);

create table public.cold_campaign_provision_batches (
  manifest_hash text not null references public.cold_campaign_provision_manifests(manifest_hash) on delete restrict,
  batch_index integer not null check (batch_index between 0 and 99),
  batch_count integer not null check (batch_count between 1 and 100),
  batch_hash text not null check (batch_hash ~ '^[a-f0-9]{64}$'),
  row_count integer not null check (row_count between 1 and 500),
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  row_hashes text[] not null,
  applied_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(manifest_hash,batch_index),
  check (batch_index < batch_count)
);

alter table public.cold_campaign_provision_control enable row level security;
alter table public.cold_campaign_provision_control force row level security;
alter table public.cold_campaign_provision_manifests enable row level security;
alter table public.cold_campaign_provision_manifests force row level security;
alter table public.cold_campaign_provision_batches enable row level security;
alter table public.cold_campaign_provision_batches force row level security;
revoke all on public.cold_campaign_provision_control,public.cold_campaign_provision_manifests,public.cold_campaign_provision_batches from public,anon,authenticated,service_role;

create or replace function public.apply_cold_campaign_provision_batch(
  p_manifest_hash text,p_logical_dataset_hash text,p_batch_index integer,p_batch_count integer,p_batch_hash text,
  p_actor_hash text,p_authorization_hash text,p_campaign_external_id text,p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_control public.cold_campaign_provision_control%rowtype;
  v_outbound public.outbound_delivery_control%rowtype;
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_existing public.cold_campaign_provision_batches%rowtype;
  v_row jsonb;
  v_now timestamptz;
  v_row_count integer;
  v_computed_batch_hash text;
  v_row_hashes text[];
  v_computed_manifest_hash text;
  v_computed_row_hash text;
  v_token_id uuid;
  v_token text;
  v_token_occurrences integer;
  v_canonical_payload text;
begin
  if p_manifest_hash !~ '^[a-f0-9]{64}$' or p_logical_dataset_hash !~ '^[a-f0-9]{64}$' or p_batch_hash !~ '^[a-f0-9]{64}$' or
     p_actor_hash !~ '^[a-f0-9]{64}$' or p_authorization_hash !~ '^[a-f0-9]{64}$' or
     p_campaign_external_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_batch_count not between 1 and 100 or p_batch_index not between 0 and p_batch_count-1 or
     pg_catalog.jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023',message='provision_request_invalid';
  end if;
  v_row_count:=pg_catalog.jsonb_array_length(p_rows);
  if v_row_count not between 1 and 500 then raise exception using errcode='22023',message='provision_batch_size_invalid'; end if;
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.string_agg(item->>'row_sha256',E'\n' order by item->>'row_sha256'),'UTF8'),'sha256'),'hex'),
    pg_catalog.array_agg(item->>'row_sha256' order by item->>'row_sha256')
  into v_computed_batch_hash,v_row_hashes from pg_catalog.jsonb_array_elements(p_rows) item;
  if v_computed_batch_hash<>p_batch_hash then raise exception using errcode='22023',message='provision_batch_hash_invalid'; end if;

  select * into v_control from public.cold_campaign_provision_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or not v_control.enabled or v_control.expires_at<=v_now or
     v_control.expected_manifest_hash<>p_manifest_hash or v_control.expected_authorization_hash<>p_authorization_hash or
     v_control.authorized_actor_hash<>p_actor_hash then
    raise exception using errcode='42501',message='provision_control_closed';
  end if;
  select * into v_outbound from public.outbound_delivery_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or v_outbound.master_enabled or v_outbound.cold_enabled then
    raise exception using errcode='55000',message='outbound_must_remain_off';
  end if;

  select * into v_existing from public.cold_campaign_provision_batches
  where manifest_hash=p_manifest_hash and batch_index=p_batch_index for update;
  if found then
    if v_existing.batch_hash<>p_batch_hash or v_existing.batch_count<>p_batch_count or v_existing.row_count<>v_row_count or v_existing.actor_hash<>p_actor_hash or v_existing.row_hashes<>v_row_hashes then
      raise exception using errcode='23505',message='provision_batch_collision';
    end if;
    return pg_catalog.jsonb_build_object('accepted',true,'duplicate',true,'reason_code','batch_replayed');
  end if;

  insert into public.campaigns(name,is_active,external_id,timezone,status)
  values('FUNDAE 2026 Email Campaign',false,p_campaign_external_id,'Europe/Madrid','draft')
  on conflict(external_id) do nothing;
  select * into v_campaign from public.campaigns where external_id=p_campaign_external_id for update;
  if not found or v_campaign.is_active or v_campaign.status<>'draft' then
    raise exception using errcode='23505',message='campaign_collision';
  end if;
  insert into public.cold_campaign_provision_manifests(manifest_hash,campaign_id,actor_hash,logical_dataset_hash,campaign_external_id,batch_count)
  values(p_manifest_hash,v_campaign.id,p_actor_hash,p_logical_dataset_hash,p_campaign_external_id,p_batch_count)
  on conflict(manifest_hash) do nothing;
  if not exists(select 1 from public.cold_campaign_provision_manifests m where m.manifest_hash=p_manifest_hash and m.campaign_id=v_campaign.id and m.actor_hash=p_actor_hash and m.logical_dataset_hash=p_logical_dataset_hash and m.campaign_external_id=p_campaign_external_id and m.batch_count=p_batch_count and m.status='applying') then
    raise exception using errcode='23505',message='manifest_collision';
  end if;

  -- The stop-gate validates planned rows while MVCC keeps pilot state private.
  -- Every path restores draft before commit; any exception rolls the transaction back.
  update public.campaigns set is_active=true,status='pilot' where id=v_campaign.id;

  for v_row in select item from pg_catalog.jsonb_array_elements(p_rows) item loop
    if (select count(*) from pg_catalog.jsonb_object_keys(v_row))<>24 or exists(
      select 1 from pg_catalog.jsonb_object_keys(v_row) key where key not in (
        'campaign_external_id','contact_id','account_id','email','email_hash','variant','lot','step','scheduled_for','execution_key',
        'recipient_email','subject','html_body','payload_sha256','token_hash','validation_status','unsubscribe_status','opposition_status',
        'hard_bounce_status','suppression_status','duplicate_status','campaign_authorization','row_sha256','company_size'
      )) then raise exception using errcode='22023',message='provision_row_shape_invalid'; end if;
    if v_row->>'campaign_external_id'<>p_campaign_external_id or v_row->>'validation_status'<>'OK' or
       v_row->>'unsubscribe_status'<>'CLEAR' or v_row->>'opposition_status'<>'CLEAR' or
       v_row->>'hard_bounce_status'<>'CLEAR' or v_row->>'suppression_status'<>'CLEAR' or
       v_row->>'duplicate_status'<>'CLEAR' or v_row->>'campaign_authorization'<>'AUTHORIZED' or
       (v_row->>'step')::integer not between 1 and 5 or v_row->>'lot' not in ('A','B','C','D') or
       v_row->>'email_hash' !~ '^[a-f0-9]{64}$' or v_row->>'payload_sha256' !~ '^[a-f0-9]{64}$' or
       v_row->>'token_hash' !~ '^[a-f0-9]{64}$' or v_row->>'row_sha256' !~ '^[a-f0-9]{64}$' or
       v_row->>'email'<>pg_catalog.lower(v_row->>'email') or
       v_row->>'recipient_email'<>v_row->>'email' or
       pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.lower(v_row->>'email'),'UTF8'),'sha256'),'hex')<>v_row->>'email_hash' or
       pg_catalog.strpos(v_row->>'html_body','{{unsubscribe_url}}')>0 then
      raise exception using errcode='22023',message='provision_row_gate_invalid';
    end if;
    select count(*),min(match[1]) into v_token_occurrences,v_token
    from pg_catalog.regexp_matches(v_row->>'html_body','(u1[.][A-Za-z0-9_-]{43})','g') match;
    if v_token_occurrences<>1 or pg_catalog.strpos(v_row->>'html_body','/baja?token='||v_token)=0 or
       pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_token,'UTF8'),'sha256'),'hex')<>v_row->>'token_hash' then
      raise exception using errcode='22023',message='provision_unsubscribe_binding_invalid';
    end if;
    v_canonical_payload:='{"recipient":'||pg_catalog.to_json(v_row->>'recipient_email')::text||
      ',"subject":'||pg_catalog.to_json(v_row->>'subject')::text||
      ',"body":'||pg_catalog.to_json(v_row->>'html_body')::text||',"attachments":[]}';
    if pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_canonical_payload,'UTF8'),'sha256'),'hex')<>v_row->>'payload_sha256' then
      raise exception using errcode='22023',message='provision_payload_hash_invalid';
    end if;
    v_computed_row_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.concat_ws(pg_catalog.chr(31),
      v_row->>'campaign_external_id',v_row->>'contact_id',v_row->>'account_id',v_row->>'email',v_row->>'email_hash',
      v_row->>'variant',v_row->>'lot',v_row->>'step',v_row->>'scheduled_for',v_row->>'execution_key',v_row->>'recipient_email',
      v_row->>'subject',v_row->>'html_body',v_row->>'payload_sha256',v_row->>'token_hash',v_row->>'validation_status',
      v_row->>'unsubscribe_status',v_row->>'opposition_status',v_row->>'hard_bounce_status',v_row->>'suppression_status',
      v_row->>'duplicate_status',v_row->>'campaign_authorization',v_row->>'company_size'),'UTF8'),'sha256'),'hex');
    if v_computed_row_hash<>v_row->>'row_sha256' then raise exception using errcode='22023',message='provision_row_hash_invalid'; end if;

    insert into public.campaign_contacts(campaign_id,external_contact_id,external_account_id,email_hash,contact_data,variant,magnet,lot,company_size,current_step,sequence_status,next_delivery_status,marketing_lane,cold_sequence_status,suppression_scope)
    values(v_campaign.id,v_row->>'contact_id',v_row->>'account_id',v_row->>'email_hash',pg_catalog.jsonb_build_object('email',v_row->>'email'),
      v_row->>'variant',v_row->>'variant',v_row->>'lot',nullif(v_row->>'company_size',''),1,'pending','pending','cold','pending','none')
    on conflict(campaign_id,external_contact_id) do nothing;
    select * into v_contact from public.campaign_contacts where campaign_id=v_campaign.id and external_contact_id=v_row->>'contact_id' for update;
    if not found or v_contact.external_account_id<>v_row->>'account_id' or v_contact.email_hash<>v_row->>'email_hash' or
       v_contact.variant<>v_row->>'variant' or v_contact.lot<>v_row->>'lot' or v_contact.contact_data->>'email'<>v_row->>'email' then
      raise exception using errcode='23505',message='row_collision';
    end if;

    insert into public.campaign_unsubscribe_tokens(campaign_id,campaign_contact_id,token_hash,token_version)
    values(v_campaign.id,v_contact.id,v_row->>'token_hash',1) on conflict(campaign_contact_id,token_version) do nothing;
    select id into v_token_id from public.campaign_unsubscribe_tokens where campaign_contact_id=v_contact.id and token_version=1 and token_hash=v_row->>'token_hash' and revoked_at is null;
    if not found then raise exception using errcode='23505',message='unsubscribe_token_collision'; end if;

    insert into public.campaign_executions(campaign_id,campaign_contact_id,idempotency_key,channel,capture_method,action_name,step,status,scheduled_for,planned_at,metadata)
    values(v_campaign.id,v_contact.id,v_row->>'execution_key','email','automation','delivery_scheduled',(v_row->>'step')::integer,'planned',(v_row->>'scheduled_for')::timestamptz,v_now,'{}'::jsonb)
    on conflict(campaign_id,idempotency_key) do nothing;
    select * into v_execution from public.campaign_executions where campaign_id=v_campaign.id and idempotency_key=v_row->>'execution_key' for update;
    if not found or v_execution.campaign_contact_id<>v_contact.id or v_execution.step<>(v_row->>'step')::integer or v_execution.status<>'planned' or v_execution.scheduled_for<>(v_row->>'scheduled_for')::timestamptz then
      raise exception using errcode='23505',message='execution_collision';
    end if;

    insert into public.cold_campaign_message_payloads(campaign_execution_id,recipient_email,subject,html_body,payload_sha256,unsubscribe_materialized)
    values(v_execution.id,v_row->>'recipient_email',v_row->>'subject',v_row->>'html_body',v_row->>'payload_sha256',true)
    on conflict(campaign_execution_id) do nothing;
    if not exists(select 1 from public.cold_campaign_message_payloads p where p.campaign_execution_id=v_execution.id and p.recipient_email=v_row->>'recipient_email' and p.subject=v_row->>'subject' and p.html_body=v_row->>'html_body' and p.payload_sha256=v_row->>'payload_sha256' and p.unsubscribe_materialized) then
      raise exception using errcode='23505',message='payload_collision';
    end if;
  end loop;

  update public.campaigns set is_active=false,status='draft' where id=v_campaign.id;

  insert into public.cold_campaign_provision_batches(manifest_hash,batch_index,batch_count,batch_hash,row_count,actor_hash,row_hashes)
  values(p_manifest_hash,p_batch_index,p_batch_count,p_batch_hash,v_row_count,p_actor_hash,v_row_hashes)
  on conflict (manifest_hash,batch_index) do nothing;
  return pg_catalog.jsonb_build_object('accepted',true,'duplicate',false,'reason_code','batch_applied','row_count',v_row_count);
end;
$$;

create or replace function public.finalize_cold_campaign_provision(
  p_manifest_hash text,p_actor_hash text,p_authorization_hash text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_control public.cold_campaign_provision_control%rowtype;
  v_outbound public.outbound_delivery_control%rowtype;
  v_manifest public.cold_campaign_provision_manifests%rowtype;
  v_now timestamptz;
  v_batches integer;
  v_rows integer;
  v_computed_manifest_hash text;
begin
  if p_manifest_hash !~ '^[a-f0-9]{64}$' or p_actor_hash !~ '^[a-f0-9]{64}$' or p_authorization_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='finalize_request_invalid';
  end if;
  select * into v_control from public.cold_campaign_provision_control where singleton for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or not v_control.enabled or v_control.expires_at<=v_now or v_control.expected_manifest_hash<>p_manifest_hash or
     v_control.expected_authorization_hash<>p_authorization_hash or v_control.authorized_actor_hash<>p_actor_hash then
    raise exception using errcode='42501',message='provision_control_closed';
  end if;
  select * into v_outbound from public.outbound_delivery_control where singleton for update;
  if not found or v_outbound.master_enabled or v_outbound.cold_enabled then raise exception using errcode='55000',message='outbound_must_remain_off'; end if;
  select * into v_manifest from public.cold_campaign_provision_manifests where manifest_hash=p_manifest_hash for update;
  if not found or v_manifest.actor_hash<>p_actor_hash then raise exception using errcode='23505',message='manifest_collision'; end if;
  if v_manifest.status='prepared_off' then return pg_catalog.jsonb_build_object('accepted',true,'duplicate',true,'reason_code','already_prepared_off'); end if;
  select count(*),coalesce(sum(row_count),0) into v_batches,v_rows from public.cold_campaign_provision_batches where manifest_hash=p_manifest_hash;
  if v_batches<>v_manifest.batch_count or v_rows<>4695 or exists(
      select 1 from pg_catalog.generate_series(0,v_manifest.batch_count-1) expected
      where not exists(select 1 from public.cold_campaign_provision_batches b where b.manifest_hash=p_manifest_hash and b.batch_index=expected)
    ) then raise exception using errcode='55000',message='partial_batch_set'; end if;
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.concat_ws(pg_catalog.chr(31),
      'cold-provision-v2',v_manifest.logical_dataset_hash,v_manifest.campaign_external_id,
      pg_catalog.string_agg(row_hash,E'\n' order by row_hash)),'UTF8'),'sha256'),'hex')
  into v_computed_manifest_hash
  from public.cold_campaign_provision_batches b
  cross join lateral pg_catalog.unnest(b.row_hashes) as hashes(row_hash)
  where b.manifest_hash=p_manifest_hash;
  if v_computed_manifest_hash<>p_manifest_hash or not exists(
      select 1 from public.campaigns c where c.id=v_manifest.campaign_id and c.external_id=v_manifest.campaign_external_id
    ) then raise exception using errcode='23514',message='provision_manifest_hash_invalid'; end if;
  if (select count(*) from public.campaign_contacts where campaign_id=v_manifest.campaign_id)<>939 or
     (select count(*) from public.campaign_contacts where campaign_id=v_manifest.campaign_id and lot='A')<>235 or
     (select count(*) from public.campaign_contacts where campaign_id=v_manifest.campaign_id and lot='B')<>235 or
     (select count(*) from public.campaign_contacts where campaign_id=v_manifest.campaign_id and lot='C')<>235 or
     (select count(*) from public.campaign_contacts where campaign_id=v_manifest.campaign_id and lot='D')<>234 then
    raise exception using errcode='55000',message='contact_or_lot_count_invalid';
  end if;
  if (select count(*) from public.campaign_executions where campaign_id=v_manifest.campaign_id and channel='email' and action_name='delivery_scheduled')<>4695 or
     (select count(*) from public.cold_campaign_message_payloads p join public.campaign_executions e on e.id=p.campaign_execution_id where e.campaign_id=v_manifest.campaign_id)<>4695 or
     exists(select 1 from public.campaign_executions e where e.campaign_id=v_manifest.campaign_id group by e.campaign_contact_id having count(*) filter(where e.channel='email' and e.action_name='delivery_scheduled')<>5 or count(distinct e.step) filter(where e.channel='email' and e.action_name='delivery_scheduled')<>5) then
    raise exception using errcode='55000',message='execution_or_payload_count_invalid';
  end if;
  update public.cold_campaign_provision_manifests set status='prepared_off',prepared_at=v_now where manifest_hash=p_manifest_hash;
  update public.cold_campaign_provision_control set enabled=false,updated_at=v_now where singleton;
  return pg_catalog.jsonb_build_object('accepted',true,'duplicate',false,'reason_code','prepared_off','contacts',939,'payloads',4695);
end;
$$;

revoke execute on function public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.finalize_cold_campaign_provision(text,text,text) from public,anon,authenticated;
grant execute on function public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb) to service_role;
grant execute on function public.finalize_cold_campaign_provision(text,text,text) to service_role;

commit;
