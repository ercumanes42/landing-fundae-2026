-- Exact four-resource Graph pilot scope. The migration itself leaves every lane OFF.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '10min';
create extension if not exists pg_cron;

create table if not exists public.transactional_graph_pilot_runs (
  run_id text primary key check (run_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$'),
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  authorization_hash text not null check (authorization_hash ~ '^[a-f0-9]{64}$'),
  approval_evidence_hash text not null check (approval_evidence_hash ~ '^[a-f0-9]{64}$'),
  allowed_lead_id text not null check (allowed_lead_id ~ '^[a-f0-9]{64}$'),
  submission_ids text[] not null,
  submission_set_hash text not null check (submission_set_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('active', 'completed', 'halted', 'expired')),
  expires_at timestamptz not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  finish_evidence_hash text check (
    finish_evidence_hash is null or finish_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (pg_catalog.array_length(submission_ids, 1) = 4),
  check (
    (status = 'active' and finished_at is null and finish_evidence_hash is null) or
    (status <> 'active' and finished_at is not null and finish_evidence_hash is not null)
  )
);

create unique index if not exists transactional_graph_pilot_one_active_idx
  on public.transactional_graph_pilot_runs ((status)) where status = 'active';
create index if not exists transactional_graph_pilot_expiry_idx
  on public.transactional_graph_pilot_runs (expires_at) where status = 'active';

create table if not exists fundae_private.transactional_graph_pilot_authorization_grants (
  authorization_nonce_hash text primary key check (
    authorization_nonce_hash ~ '^[a-f0-9]{64}$'
  ),
  authorized_run_id text not null unique check (
    authorized_run_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$'
  ),
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  allowed_lead_id text not null check (allowed_lead_id ~ '^[a-f0-9]{64}$'),
  submission_set_hash text not null check (submission_set_hash ~ '^[a-f0-9]{64}$'),
  max_ttl_seconds integer not null check (max_ttl_seconds between 120 and 900),
  expires_at timestamptz not null,
  approval_evidence_hash text not null check (
    approval_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  consumed_at timestamptz,
  consumed_run_id text unique,
  revoked_at timestamptz,
  revocation_evidence_hash text check (
    revocation_evidence_hash is null or revocation_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check ((consumed_at is null) = (consumed_run_id is null)),
  check ((revoked_at is null) = (revocation_evidence_hash is null)),
  check (consumed_at is null or revoked_at is null)
);
create index if not exists transactional_graph_pilot_grant_expiry_idx
  on fundae_private.transactional_graph_pilot_authorization_grants (expires_at)
  where consumed_at is null and revoked_at is null;
alter table public.transactional_graph_pilot_runs
  drop constraint if exists transactional_graph_pilot_authorization_fk;
alter table public.transactional_graph_pilot_runs
  add constraint transactional_graph_pilot_authorization_fk
  foreign key (authorization_hash)
  references fundae_private.transactional_graph_pilot_authorization_grants(
    authorization_nonce_hash
  ) on delete restrict;

alter table public.transactional_dispatch_outbox
  add column if not exists pilot_run_id text;
alter table public.transactional_dispatch_outbox
  drop constraint if exists transactional_dispatch_pilot_run_fk;
alter table public.transactional_dispatch_outbox
  add constraint transactional_dispatch_pilot_run_fk foreign key (pilot_run_id)
  references public.transactional_graph_pilot_runs(run_id) on delete restrict;
create index if not exists transactional_dispatch_pilot_run_idx
  on public.transactional_dispatch_outbox (pilot_run_id, status, claim_expires_at, created_at)
  where pilot_run_id is not null;

create or replace function public.enforce_transactional_graph_pilot_binding()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.pilot_run_id is not null and
     new.pilot_run_id is distinct from old.pilot_run_id then
    raise exception using errcode = '23514', message = 'pilot_binding_immutable';
  end if;
  if new.pilot_run_id is null or
     (tg_op = 'UPDATE' and new.pilot_run_id is not distinct from old.pilot_run_id) then
    return new;
  end if;
  if not exists (
    select 1 from public.transactional_graph_pilot_runs r
    join public.leads l on l.submission_id = new.submission_id
    where r.run_id = new.pilot_run_id and r.status = 'active'
      and new.submission_id = any(r.submission_ids)
      and l.lead_id = r.allowed_lead_id and l.form_type = new.resource
  ) then
    raise exception using errcode = '23514', message = 'pilot_binding_scope_invalid';
  end if;
  return new;
end;
$$;

drop trigger if exists transactional_dispatch_pilot_binding
  on public.transactional_dispatch_outbox;
create trigger transactional_dispatch_pilot_binding
before insert or update of pilot_run_id on public.transactional_dispatch_outbox
for each row execute function public.enforce_transactional_graph_pilot_binding();

create or replace function fundae_private.transactional_graph_pilot_cohort_reason(
  p_allowed_lead_id text, p_submission_ids text[]
) returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_ids text[];
  v_unique integer;
  v_leads integer;
  v_dispatches integer;
  v_resources text[];
begin
  if p_allowed_lead_id is null or p_allowed_lead_id !~ '^[a-f0-9]{64}$' or
     p_submission_ids is null or pg_catalog.array_length(p_submission_ids, 1) <> 4 or
     pg_catalog.array_position(p_submission_ids, null) is not null then
    return 'invalid_request';
  end if;
  select pg_catalog.array_agg(x order by x), pg_catalog.count(distinct x)
    into v_ids, v_unique from pg_catalog.unnest(p_submission_ids) x;
  if v_unique <> 4 or exists (
    select 1 from pg_catalog.unnest(v_ids) x
    where x !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$'
  ) then
    return 'submission_set_invalid';
  end if;
  select pg_catalog.count(*),
         pg_catalog.array_agg(distinct l.form_type order by l.form_type)
    into v_leads, v_resources
  from public.leads l where l.submission_id = any(v_ids)
    and l.lead_id = p_allowed_lead_id
    and l.form_type = l.lead_magnet
    and l.form_type in ('calculator', 'interactive_checklist', 'checklist', 'webinar')
    and l.delivery_status = 'dead_letter'
    and l.email_delivery_status = 'pending'
    and l.accepted_by_make_at is null and l.ai_summary is null;
  if v_leads <> 4 or v_resources is distinct from
     array['calculator','checklist','interactive_checklist','webinar']::text[] then
    return 'lead_cohort_invalid';
  end if;
  if exists (
    select 1 from public.leads l
    where l.submission_id = any(v_ids) and l.lead_id <> p_allowed_lead_id
  ) then
    return 'identity_mapping_invalid';
  end if;
  if exists (
    select 1 from public.campaign_contacts c where c.email_hash = p_allowed_lead_id
  ) then
    return 'campaign_identity_conflict';
  end if;
  select pg_catalog.count(*) into v_dispatches
  from public.transactional_dispatch_outbox d
  join public.leads l on l.submission_id = d.submission_id
  where d.submission_id = any(v_ids)
    and d.resource = l.form_type and l.lead_id = p_allowed_lead_id
    and d.status in ('queued_off', 'deferred')
    and d.claimed_by is null and d.claim_expires_at is null
    and d.reservation_id is null and d.outcome_evidence_hash is null
    and d.terminal_at is null and d.pilot_run_id is null
    and d.payload_sha256 = pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(l.payload::text, 'UTF8'), 'sha256'
    ), 'hex');
  if v_dispatches <> 4 then return 'dispatch_cohort_invalid'; end if;
  return null;
end;
$$;

create or replace function fundae_private.register_transactional_graph_pilot_grant(
  p_run_id text,
  p_actor_hash text,
  p_authorization_nonce_hash text,
  p_allowed_lead_id text,
  p_submission_ids text[],
  p_max_ttl_seconds integer,
  p_expires_at timestamptz,
  p_approval_evidence_hash text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz;
  v_reason text;
  v_ids text[];
  v_set_hash text;
  v_control public.outbound_delivery_control%rowtype;
begin
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$' or
     p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_authorization_nonce_hash is null or
     p_authorization_nonce_hash !~ '^[a-f0-9]{64}$' or
     p_allowed_lead_id is null or p_allowed_lead_id !~ '^[a-f0-9]{64}$' or
     p_max_ttl_seconds is null or p_max_ttl_seconds not between 120 and 900 or
     p_expires_at is null or p_approval_evidence_hash is null or
     p_approval_evidence_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'invalid_request'
    );
  end if;
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  perform 1 from fundae_private.transactional_graph_pilot_authorization_grants
  where authorized_run_id = p_run_id for update;
  perform 1 from public.transactional_graph_pilot_runs
  where run_id = p_run_id or status = 'active' for update;
  perform 1 from public.transactional_dispatch_outbox
  where submission_id = any(p_submission_ids) for update;
  perform 1 from public.leads where submission_id = any(p_submission_ids) for update;
  v_now := pg_catalog.clock_timestamp();
  if v_control.singleton is null or v_control.master_enabled or
     v_control.transactional_enabled or v_control.cold_enabled then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'outbound_must_be_off'
    );
  end if;
  if p_expires_at < v_now + pg_catalog.make_interval(secs => p_max_ttl_seconds) or
     p_expires_at > v_now + interval '20 minutes' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'grant_expiry_invalid'
    );
  end if;
  if exists (
    select 1 from fundae_private.transactional_graph_pilot_authorization_grants
    where authorized_run_id = p_run_id
  ) or exists (
    select 1 from public.transactional_graph_pilot_runs
    where run_id = p_run_id or status = 'active'
  ) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'grant_conflict'
    );
  end if;
  select pg_catalog.array_agg(x order by x) into v_ids
  from pg_catalog.unnest(p_submission_ids) x;
  v_reason := fundae_private.transactional_graph_pilot_cohort_reason(
    p_allowed_lead_id, p_submission_ids
  );
  if v_reason is not null then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', v_reason
    );
  end if;
  v_set_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.array_to_string(v_ids, pg_catalog.chr(31)), 'UTF8'
  ), 'sha256'), 'hex');
  insert into fundae_private.transactional_graph_pilot_authorization_grants(
    authorization_nonce_hash, authorized_run_id, actor_hash, allowed_lead_id,
    submission_set_hash, max_ttl_seconds, expires_at, approval_evidence_hash
  ) values (
    p_authorization_nonce_hash, p_run_id, p_actor_hash, p_allowed_lead_id,
    v_set_hash, p_max_ttl_seconds, p_expires_at, p_approval_evidence_hash
  );
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'reason_code', 'pilot_grant_registered',
    'run_id_hash', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(p_run_id, 'UTF8'), 'sha256'
    ), 'hex'),
    'submission_set_hash', v_set_hash, 'expires_at', p_expires_at,
    'max_ttl_seconds', p_max_ttl_seconds
  );
exception when unique_violation then
  return pg_catalog.jsonb_build_object(
    'accepted', false, 'reason_code', 'grant_conflict'
  );
end;
$$;

create or replace function public.preview_transactional_graph_pilot(
  p_run_id text, p_actor_hash text, p_allowed_lead_id text,
  p_submission_ids text[], p_ttl_seconds integer
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_ids text[];
  v_set_hash text;
  v_control public.outbound_delivery_control%rowtype;
begin
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$' or
     p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_ttl_seconds is null or p_ttl_seconds not between 120 and 900 then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'dry_run', 'reason_code', 'invalid_request'
    );
  end if;
  select pg_catalog.array_agg(x order by x) into v_ids
  from pg_catalog.unnest(p_submission_ids) x;
  v_reason := fundae_private.transactional_graph_pilot_cohort_reason(
    p_allowed_lead_id, p_submission_ids
  );
  if v_reason is not null then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'dry_run', 'reason_code', v_reason,
      'run_id', p_run_id, 'resources', 0, 'submissions', 0
    );
  end if;
  if exists (select 1 from public.transactional_graph_pilot_runs where run_id = p_run_id) or
     exists (select 1 from public.transactional_graph_pilot_runs where status = 'active') then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'dry_run', 'reason_code', 'pilot_run_conflict',
      'run_id', p_run_id, 'resources', 0, 'submissions', 0
    );
  end if;
  select * into v_control from public.outbound_delivery_control where singleton;
  if not found or v_control.master_enabled or v_control.transactional_enabled or
     v_control.cold_enabled then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'dry_run', 'reason_code', 'outbound_must_be_off',
      'run_id', p_run_id, 'resources', 0, 'submissions', 0
    );
  end if;
  v_set_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.array_to_string(v_ids, pg_catalog.chr(31)), 'UTF8'
  ), 'sha256'), 'hex');
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'mode', 'dry_run', 'reason_code', 'pilot_ready',
    'run_id', p_run_id, 'resources', 4, 'submissions', 4,
    'allowed_lead_id_hash', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(p_allowed_lead_id, 'UTF8'), 'sha256'
    ), 'hex'),
    'submission_set_hash', v_set_hash,
    'authorization_required', true,
    'ttl_seconds', p_ttl_seconds,
    'controls', pg_catalog.jsonb_build_object(
      'master_enabled', false, 'transactional_enabled', false, 'cold_enabled', false
    )
  );
end;
$$;

create or replace function public.start_transactional_graph_pilot(
  p_run_id text, p_actor_hash text, p_allowed_lead_id text,
  p_submission_ids text[], p_authorization_hash text, p_ttl_seconds integer
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_ids text[];
  v_set_hash text;
  v_grant fundae_private.transactional_graph_pilot_authorization_grants%rowtype;
  v_control public.outbound_delivery_control%rowtype;
  v_now timestamptz;
begin
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$' or
     p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_allowed_lead_id is null or p_allowed_lead_id !~ '^[a-f0-9]{64}$' or
     p_authorization_hash is null or p_authorization_hash !~ '^[a-f0-9]{64}$' or
     p_submission_ids is null or
     p_ttl_seconds is null or p_ttl_seconds not between 120 and 900 then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'invalid_request'
    );
  end if;
  select pg_catalog.array_agg(x order by x) into v_ids
  from pg_catalog.unnest(p_submission_ids) x;
  v_set_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.array_to_string(v_ids, pg_catalog.chr(31)), 'UTF8'
  ), 'sha256'), 'hex');
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_grant
  from fundae_private.transactional_graph_pilot_authorization_grants
  where authorization_nonce_hash = p_authorization_hash for update;
  perform 1 from public.transactional_graph_pilot_runs where status = 'active' for update;
  perform 1 from public.transactional_dispatch_outbox
    where submission_id = any(p_submission_ids) for update;
  perform 1 from public.leads where submission_id = any(p_submission_ids) for update;
  v_now := pg_catalog.clock_timestamp();
  if v_control.singleton is null then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'control_unavailable'
    );
  end if;
  if v_control.master_enabled or v_control.transactional_enabled or v_control.cold_enabled then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'outbound_must_be_off'
    );
  end if;
  if v_grant.authorization_nonce_hash is null or
     v_grant.authorized_run_id <> p_run_id or
     v_grant.actor_hash <> p_actor_hash or
     v_grant.allowed_lead_id <> p_allowed_lead_id or
     v_grant.submission_set_hash <> v_set_hash or
     v_grant.max_ttl_seconds < p_ttl_seconds or
     v_grant.consumed_at is not null or v_grant.revoked_at is not null or
     v_grant.expires_at < v_now + pg_catalog.make_interval(secs => p_ttl_seconds) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'authorization_unavailable'
    );
  end if;
  if exists (select 1 from public.mailbox_throttle_state
       where active_reservation_id is not null or blocked_reservation_id is not null) or
     exists (select 1 from public.mailbox_delivery_reservations
       where status in ('reserved', 'reconcile_required')) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'mailbox_not_clean'
    );
  end if;
  if exists (select 1 from public.transactional_graph_pilot_runs where run_id = p_run_id) or
     exists (select 1 from public.transactional_graph_pilot_runs where status = 'active') then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'pilot_run_conflict'
    );
  end if;
  v_reason := fundae_private.transactional_graph_pilot_cohort_reason(
    p_allowed_lead_id, p_submission_ids
  );
  if v_reason is not null then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', v_reason
    );
  end if;
  update fundae_private.transactional_graph_pilot_authorization_grants
  set consumed_at = v_now, consumed_run_id = p_run_id, updated_at = v_now
  where authorization_nonce_hash = p_authorization_hash
    and authorized_run_id = p_run_id and actor_hash = p_actor_hash
    and allowed_lead_id = p_allowed_lead_id
    and submission_set_hash = v_set_hash
    and max_ttl_seconds >= p_ttl_seconds
    and expires_at >= v_now + pg_catalog.make_interval(secs => p_ttl_seconds)
    and consumed_at is null and revoked_at is null;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'mode', 'live', 'reason_code', 'authorization_unavailable'
    );
  end if;
  insert into public.transactional_graph_pilot_runs(
    run_id, actor_hash, authorization_hash, approval_evidence_hash,
    allowed_lead_id, submission_ids,
    submission_set_hash, status, expires_at, started_at
  ) values (
    p_run_id, p_actor_hash, p_authorization_hash, v_grant.approval_evidence_hash,
    p_allowed_lead_id, v_ids,
    v_set_hash, 'active', v_now + pg_catalog.make_interval(secs => p_ttl_seconds), v_now
  );
  update public.transactional_dispatch_outbox
  set pilot_run_id = p_run_id, updated_at = v_now
  where submission_id = any(v_ids) and pilot_run_id is null;
  if not found or (select pg_catalog.count(*) from public.transactional_dispatch_outbox
      where pilot_run_id = p_run_id) <> 4 then
    raise exception using errcode = '55000', message = 'pilot_binding_failed';
  end if;
  update public.outbound_delivery_control
  set master_enabled = true, transactional_enabled = true, cold_enabled = false,
      halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_ACTIVE',
      updated_by_hash = p_actor_hash, updated_at = v_now
  where singleton;
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'mode', 'live', 'reason_code', 'pilot_started',
    'run_id', p_run_id, 'resources', 4, 'submissions', 4,
    'expires_at', v_now + pg_catalog.make_interval(secs => p_ttl_seconds),
    'allowed_lead_id_hash', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(p_allowed_lead_id, 'UTF8'), 'sha256'
    ), 'hex'),
    'submission_set_hash', v_set_hash, 'ttl_seconds', p_ttl_seconds,
    'controls', pg_catalog.jsonb_build_object(
      'master_enabled', true, 'transactional_enabled', true, 'cold_enabled', false
    )
  );
exception when unique_violation then
  return pg_catalog.jsonb_build_object(
    'accepted', false, 'mode', 'live', 'reason_code', 'pilot_run_conflict'
  );
end;
$$;

alter function public.claim_transactional_graph_dispatch(uuid,integer,integer)
  rename to claim_transactional_graph_dispatch_pre_pilot_20260819;
create or replace function public.claim_transactional_graph_dispatch(
  p_worker_id uuid, p_limit integer, p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_run public.transactional_graph_pilot_runs%rowtype;
  v_result jsonb;
  v_dispatch_id uuid;
  v_reservation_id uuid;
  v_now timestamptz;
  v_evidence text;
begin
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_run from public.transactional_graph_pilot_runs
  where status = 'active' for update;
  v_now := pg_catalog.clock_timestamp();
  if not found then
    if v_control.master_enabled or v_control.transactional_enabled or v_control.cold_enabled then
      update public.outbound_delivery_control
      set master_enabled = false, transactional_enabled = false, cold_enabled = false,
          halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_SCOPE_REQUIRED', updated_at = v_now
      where singleton;
    end if;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_scope_required', 'claimed', 0,
      'recovery_required', false, 'resume_existing_reservation', false,
      'reservation_id', null, 'outbox_state', null,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null, 'lease_expires_at', null,
      'items', '[]'::jsonb
    );
  end if;
  if v_run.expires_at <= v_now then
    v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'pilot-expired:' || v_run.run_id || ':' || v_now::text, 'UTF8'
    ), 'sha256'), 'hex');
    update public.transactional_graph_pilot_runs
    set status = 'expired', finished_at = v_now, finish_evidence_hash = v_evidence,
        updated_at = v_now where run_id = v_run.run_id and status = 'active';
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_EXPIRED', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_scope_expired', 'claimed', 0,
      'recovery_required', false, 'resume_existing_reservation', false,
      'reservation_id', null, 'outbox_state', null,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null, 'lease_expires_at', null,
      'items', '[]'::jsonb
    );
  end if;
  if v_control.singleton is null or not v_control.master_enabled or not v_control.transactional_enabled or
     v_control.cold_enabled then
    v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'pilot-control-violation:' || v_run.run_id || ':' || v_now::text, 'UTF8'
    ), 'sha256'), 'hex');
    update public.transactional_graph_pilot_runs
    set status = 'halted', finished_at = v_now, finish_evidence_hash = v_evidence,
        updated_at = v_now where run_id = v_run.run_id and status = 'active';
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_CONTROL_VIOLATION', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_control_violation', 'claimed', 0,
      'recovery_required', false, 'resume_existing_reservation', false,
      'reservation_id', null, 'outbox_state', null,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null, 'lease_expires_at', null,
      'items', '[]'::jsonb
    );
  end if;
  begin
    v_result := public.claim_transactional_graph_dispatch_pre_pilot_20260819(
      p_worker_id, p_limit, p_lease_seconds
    );
    if pg_catalog.jsonb_array_length(coalesce(v_result -> 'items', '[]'::jsonb)) > 0 then
      v_dispatch_id := (v_result #>> '{items,0,dispatch_id}')::uuid;
      if not exists (
        select 1 from public.transactional_dispatch_outbox d
        where d.id = v_dispatch_id and d.pilot_run_id = v_run.run_id
          and d.submission_id = any(v_run.submission_ids)
      ) then
        raise exception using errcode = 'P0001', message = 'pilot_scope_violation';
      end if;
    end if;
    if v_result ->> 'reservation_id' is not null then
      v_reservation_id := (v_result ->> 'reservation_id')::uuid;
      if not exists (
        select 1 from public.transactional_dispatch_outbox d
        where d.reservation_id = v_reservation_id and d.pilot_run_id = v_run.run_id
          and d.submission_id = any(v_run.submission_ids)
      ) then
        raise exception using errcode = 'P0001', message = 'pilot_recovery_scope_violation';
      end if;
    end if;
  exception when others then
    v_result := null;
  end;
  if v_result is null then
    v_now := pg_catalog.clock_timestamp();
    v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'pilot-scope-violation:' || v_run.run_id || ':' || v_now::text, 'UTF8'
    ), 'sha256'), 'hex');
    update public.transactional_graph_pilot_runs
    set status = 'halted', finished_at = v_now, finish_evidence_hash = v_evidence,
        updated_at = v_now where run_id = v_run.run_id and status = 'active';
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_SCOPE_VIOLATION', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_scope_violation', 'claimed', 0,
      'recovery_required', false, 'resume_existing_reservation', false,
      'reservation_id', null, 'outbox_state', null,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null, 'lease_expires_at', null,
      'items', '[]'::jsonb
    );
  end if;
  return v_result || pg_catalog.jsonb_build_object('pilot_run_id', v_run.run_id);
end;
$$;

alter function public.reserve_claimed_transactional_graph_dispatch(
  uuid,uuid,text,text,text,text,text
) rename to reserve_claimed_transactional_graph_dispatch_pre_pilot_20260819;
create or replace function public.reserve_claimed_transactional_graph_dispatch(
  p_dispatch_id uuid, p_worker_id uuid, p_mailbox_key_hash text,
  p_finalize_capability_hash text, p_package_hmac_sha256 text,
  p_send_capability_hash text, p_opaque_marker text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_dispatch public.transactional_dispatch_outbox%rowtype;
  v_run public.transactional_graph_pilot_runs%rowtype;
  v_now timestamptz;
  v_evidence text;
begin
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_dispatch from public.transactional_dispatch_outbox
  where id = p_dispatch_id for update;
  if found and v_dispatch.pilot_run_id is not null then
    select * into v_run from public.transactional_graph_pilot_runs
    where run_id = v_dispatch.pilot_run_id for update;
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_dispatch.id is null or v_run.run_id is null or v_run.status <> 'active' or
     v_dispatch.submission_id <> all(v_run.submission_ids) or
     not exists (select 1 from public.leads l where l.submission_id = v_dispatch.submission_id
       and l.lead_id = v_run.allowed_lead_id and l.form_type = v_dispatch.resource) then
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_SCOPE_VIOLATION', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'pilot_scope_violation'
    );
  end if;
  if v_run.expires_at <= v_now then
    v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'pilot-expired:' || v_run.run_id || ':' || v_now::text, 'UTF8'
    ), 'sha256'), 'hex');
    update public.transactional_graph_pilot_runs
    set status = 'expired', finished_at = v_now, finish_evidence_hash = v_evidence,
        updated_at = v_now where run_id = v_run.run_id and status = 'active';
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_EXPIRED', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'pilot_scope_expired'
    );
  end if;
  if v_control.singleton is null or not v_control.master_enabled or not v_control.transactional_enabled or
     v_control.cold_enabled then
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_CONTROL_VIOLATION', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'pilot_control_violation'
    );
  end if;
  return public.reserve_claimed_transactional_graph_dispatch_pre_pilot_20260819(
    p_dispatch_id, p_worker_id, p_mailbox_key_hash, p_finalize_capability_hash,
    p_package_hmac_sha256, p_send_capability_hash, p_opaque_marker
  ) || pg_catalog.jsonb_build_object('pilot_run_id', v_run.run_id);
end;
$$;

alter function public.authorize_graph_draft_send(uuid,text,text,text)
  rename to authorize_graph_draft_send_pre_pilot_20260819;
create or replace function public.authorize_graph_draft_send(
  p_reservation_id uuid, p_send_capability_hash text, p_stop_snapshot_hash text,
  p_observed_change_key_hash text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_dispatch public.transactional_dispatch_outbox%rowtype;
  v_run public.transactional_graph_pilot_runs%rowtype;
  v_now timestamptz;
  v_evidence text;
begin
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select d.* into v_dispatch from public.transactional_dispatch_outbox d
  where d.reservation_id = p_reservation_id for update;
  if not found then
    return public.authorize_graph_draft_send_pre_pilot_20260819(
      p_reservation_id, p_send_capability_hash, p_stop_snapshot_hash,
      p_observed_change_key_hash
    );
  end if;
  if v_dispatch.pilot_run_id is not null then
    select * into v_run from public.transactional_graph_pilot_runs
    where run_id = v_dispatch.pilot_run_id for update;
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_run.run_id is null or v_run.status <> 'active' or
     v_dispatch.submission_id <> all(v_run.submission_ids) or
     not exists (select 1 from public.leads l where l.submission_id = v_dispatch.submission_id
       and l.lead_id = v_run.allowed_lead_id and l.form_type = v_dispatch.resource) or
     v_run.expires_at <= v_now or v_control.singleton is null or
     not v_control.master_enabled or not v_control.transactional_enabled or
     v_control.cold_enabled then
    if v_run.run_id is not null and v_run.status = 'active' then
      v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'pilot-authorization-stopped:' || v_run.run_id || ':' || v_now::text, 'UTF8'
      ), 'sha256'), 'hex');
      update public.transactional_graph_pilot_runs
      set status = case when v_run.expires_at <= v_now then 'expired' else 'halted' end,
          finished_at = v_now, finish_evidence_hash = v_evidence, updated_at = v_now
      where run_id = v_run.run_id and status = 'active';
    end if;
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_SEND_BLOCKED', updated_at = v_now
    where singleton;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', 'draft_neutralization_required',
      'pilot_reason_code', case when v_run.expires_at <= v_now
        then 'pilot_scope_expired'
        when v_control.singleton is null or not v_control.master_enabled or
          not v_control.transactional_enabled or v_control.cold_enabled
        then 'pilot_control_violation' else 'pilot_scope_violation' end,
      'reservation_id', p_reservation_id, 'mailbox_halted', true,
      'retry_after_seconds', 0
    );
  end if;
  return public.authorize_graph_draft_send_pre_pilot_20260819(
    p_reservation_id, p_send_capability_hash, p_stop_snapshot_hash,
    p_observed_change_key_hash
  ) || pg_catalog.jsonb_build_object('pilot_run_id', v_run.run_id);
end;
$$;

create or replace function public.finish_transactional_graph_pilot(
  p_run_id text, p_actor_hash text, p_outcome text, p_evidence_hash text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_run public.transactional_graph_pilot_runs%rowtype;
  v_now timestamptz;
  v_confirmed integer := 0;
  v_complete boolean := false;
  v_reason text;
begin
  if p_run_id is null or p_actor_hash is null or
     p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_outcome is null or p_outcome not in ('completed', 'halted') or
     p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason_code', 'invalid_request');
  end if;
  perform 1 from public.outbound_delivery_control where singleton for update;
  select * into v_run from public.transactional_graph_pilot_runs
  where run_id = p_run_id for update;
  v_now := pg_catalog.clock_timestamp();
  if not found then
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_FINISH_UNKNOWN',
        updated_by_hash = p_actor_hash, updated_at = v_now where singleton;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_run_unavailable', 'scope_active', false,
      'controls', pg_catalog.jsonb_build_object(
        'master_enabled', false, 'transactional_enabled', false, 'cold_enabled', false
      )
    );
  end if;
  if v_run.actor_hash <> p_actor_hash then
    update public.transactional_graph_pilot_runs
    set status = 'halted', finished_at = v_now,
        finish_evidence_hash = pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(
            'pilot-finish-actor-mismatch:' || v_run.run_id || ':' || v_now::text,
            'UTF8'
          ), 'sha256'
        ), 'hex'), updated_at = v_now
    where run_id = v_run.run_id and status = 'active';
    update public.outbound_delivery_control
    set master_enabled = false, transactional_enabled = false, cold_enabled = false,
        halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_FINISH_ACTOR_MISMATCH',
        updated_at = v_now where singleton;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_actor_mismatch', 'scope_active', false,
      'controls', pg_catalog.jsonb_build_object(
        'master_enabled', false, 'transactional_enabled', false, 'cold_enabled', false
      )
    );
  end if;
  select pg_catalog.count(*) filter (where d.status = 'confirmed_sent'
      and d.outcome_evidence_hash is not null and d.reservation_id is not null
      and g.state = 'confirmed_sent'
      and g.sent_items_evidence_hash = d.outcome_evidence_hash
      and g.internet_message_id_hash is not null)
    into v_confirmed
  from public.transactional_dispatch_outbox d
  left join public.graph_outbox g on g.reservation_id = d.reservation_id
  where d.pilot_run_id = p_run_id and d.submission_id = any(v_run.submission_ids);
  v_complete := v_confirmed = 4 and
    (select pg_catalog.count(*) from public.transactional_dispatch_outbox
      where pilot_run_id = p_run_id) = 4;
  update public.outbound_delivery_control
  set master_enabled = false, transactional_enabled = false, cold_enabled = false,
      halt_reason = case when p_outcome = 'completed' and v_complete
        then 'TRANSACTIONAL_GRAPH_PILOT_COMPLETED'
        when p_outcome = 'halted' then 'TRANSACTIONAL_GRAPH_PILOT_HALTED'
        else 'TRANSACTIONAL_GRAPH_PILOT_COMPLETION_INCOMPLETE' end,
      updated_by_hash = p_actor_hash, updated_at = v_now where singleton;
  if v_run.status = 'active' then
    update public.transactional_graph_pilot_runs
    set status = case when p_outcome = 'completed' and v_complete
        then 'completed' else 'halted' end,
        finished_at = v_now, finish_evidence_hash = p_evidence_hash,
        updated_at = v_now
    where run_id = p_run_id;
  end if;
  v_reason := case when p_outcome = 'completed' and v_complete then 'pilot_completed'
    when p_outcome = 'halted' then 'pilot_halted'
    else 'pilot_completion_incomplete' end;
  return pg_catalog.jsonb_build_object(
    'accepted', p_outcome = 'halted' or v_complete,
    'reason_code', v_reason, 'run_id', p_run_id,
    'confirmed_sent_count', v_confirmed, 'scope_active', false,
    'controls', pg_catalog.jsonb_build_object(
      'master_enabled', false, 'transactional_enabled', false, 'cold_enabled', false
    )
  );
end;
$$;

alter function public.emergency_halt_outbound_delivery(text,text)
  rename to emergency_halt_outbound_delivery_pre_pilot_20260819;
create or replace function public.emergency_halt_outbound_delivery(
  p_actor_hash text, p_reason text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz;
  v_evidence text;
  v_cleared integer;
begin
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 3 and 240 then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason_code', 'invalid_request');
  end if;
  perform 1 from public.outbound_delivery_control where singleton for update;
  perform 1 from public.transactional_graph_pilot_runs where status = 'active' for update;
  v_now := pg_catalog.clock_timestamp();
  v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'emergency-halt:' || p_actor_hash || ':' || pg_catalog.btrim(p_reason) || ':' || v_now::text,
    'UTF8'
  ), 'sha256'), 'hex');
  update public.transactional_graph_pilot_runs
  set status = 'halted', finished_at = v_now, finish_evidence_hash = v_evidence,
      updated_at = v_now where status = 'active';
  get diagnostics v_cleared = row_count;
  update public.outbound_delivery_control
  set master_enabled = false, transactional_enabled = false, cold_enabled = false,
      halt_reason = pg_catalog.btrim(p_reason), updated_by_hash = p_actor_hash,
      updated_at = v_now where singleton;
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'reason_code', 'halted', 'halted_at', v_now,
    'pilot_scope_cleared', v_cleared > 0,
    'controls', pg_catalog.jsonb_build_object(
      'master_enabled', false, 'transactional_enabled', false, 'cold_enabled', false
    )
  );
end;
$$;

create or replace function fundae_private.enforce_transactional_graph_pilot_deadline()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_run public.transactional_graph_pilot_runs%rowtype;
  v_now timestamptz;
  v_evidence text;
  v_reason text;
begin
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_run from public.transactional_graph_pilot_runs
  where status = 'active' for update;
  v_now := pg_catalog.clock_timestamp();
  if v_control.singleton is null then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'control_unavailable'
    );
  end if;
  if v_run.run_id is null then
    if v_control.halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_ACTIVE' and
       (v_control.master_enabled or v_control.transactional_enabled or
        v_control.cold_enabled) then
      v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'pilot-watchdog-orphan:' || v_now::text, 'UTF8'
      ), 'sha256'), 'hex');
      update public.outbound_delivery_control
      set master_enabled = false, transactional_enabled = false, cold_enabled = false,
          halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_WATCHDOG_ORPHAN',
          updated_by_hash = v_evidence, updated_at = v_now
      where singleton;
      return pg_catalog.jsonb_build_object(
        'accepted', true, 'reason_code', 'pilot_orphan_halted', 'outbound_off', true
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'reason_code', 'pilot_inactive',
      'outbound_off', not v_control.master_enabled and
        not v_control.transactional_enabled and not v_control.cold_enabled
    );
  end if;
  if v_run.expires_at > v_now and v_control.master_enabled and
     v_control.transactional_enabled and not v_control.cold_enabled and
     v_control.halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_ACTIVE' then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'reason_code', 'pilot_scope_current',
      'run_id_hash', pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(v_run.run_id, 'UTF8'), 'sha256'
      ), 'hex'), 'outbound_off', false
    );
  end if;
  v_reason := case when v_run.expires_at <= v_now
    then 'TRANSACTIONAL_GRAPH_PILOT_EXPIRED'
    else 'TRANSACTIONAL_GRAPH_PILOT_CONTROL_VIOLATION' end;
  v_evidence := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'pilot-watchdog:' || v_run.run_id || ':' || v_reason || ':' || v_now::text,
    'UTF8'
  ), 'sha256'), 'hex');
  update public.transactional_graph_pilot_runs
  set status = case when v_run.expires_at <= v_now then 'expired' else 'halted' end,
      finished_at = v_now, finish_evidence_hash = v_evidence, updated_at = v_now
  where run_id = v_run.run_id and status = 'active';
  update public.outbound_delivery_control
  set master_enabled = false, transactional_enabled = false, cold_enabled = false,
      halt_reason = v_reason, updated_by_hash = v_evidence, updated_at = v_now
  where singleton;
  return pg_catalog.jsonb_build_object(
    'accepted', true,
    'reason_code', case when v_run.expires_at <= v_now
      then 'pilot_scope_expired' else 'pilot_control_violation' end,
    'run_id_hash', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_run.run_id, 'UTF8'), 'sha256'
    ), 'hex'), 'outbound_off', true
  );
end;
$$;

create or replace function public.read_transactional_graph_pilot_ledger(
  p_run_id text, p_actor_hash text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_run public.transactional_graph_pilot_runs%rowtype;
  v_rows jsonb;
  v_row_count integer;
  v_resources integer;
  v_reservations integer;
  v_unique_reservations integer;
  v_drafts integer;
  v_unique_drafts integer;
  v_confirmed integer;
  v_confirmed_evidenced integer;
begin
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$' or
     p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason_code', 'invalid_request');
  end if;
  select * into v_run from public.transactional_graph_pilot_runs
  where run_id = p_run_id and actor_hash = p_actor_hash;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_ledger_unavailable'
    );
  end if;
  select pg_catalog.count(*), pg_catalog.count(distinct d.resource),
         pg_catalog.count(d.reservation_id),
         pg_catalog.count(distinct d.reservation_id),
         pg_catalog.count(g.graph_draft_immutable_id),
         pg_catalog.count(distinct g.graph_draft_immutable_id),
         pg_catalog.count(*) filter (where d.status = 'confirmed_sent'),
         pg_catalog.count(*) filter (where d.status = 'confirmed_sent'
           and g.state = 'confirmed_sent'
           and g.sent_items_evidence_hash = d.outcome_evidence_hash
           and g.sent_items_evidence_hash is not null
           and g.internet_message_id_hash is not null),
         coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'resource', d.resource, 'status', d.status,
           'dispatch_id_hash', pg_catalog.encode(extensions.digest(
             pg_catalog.convert_to(d.id::text, 'UTF8'), 'sha256'
           ), 'hex'),
           'reservation_id_hash', case when d.reservation_id is null then null else
             pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
               d.reservation_id::text, 'UTF8'
             ), 'sha256'), 'hex') end,
           'draft_immutable_id_hash', case when g.graph_draft_immutable_id is null then null else
             pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
               g.graph_draft_immutable_id, 'UTF8'
             ), 'sha256'), 'hex') end,
           'internet_message_id_hash', g.internet_message_id_hash,
           'evidence_hash', coalesce(
             g.sent_items_evidence_hash, g.terminal_evidence_hash, d.outcome_evidence_hash
           )
         ) order by d.resource), '[]'::jsonb)
    into v_row_count, v_resources, v_reservations, v_unique_reservations,
         v_drafts, v_unique_drafts, v_confirmed, v_confirmed_evidenced, v_rows
  from public.transactional_dispatch_outbox d
  left join public.graph_outbox g on g.reservation_id = d.reservation_id
  where d.pilot_run_id = v_run.run_id and d.submission_id = any(v_run.submission_ids);
  if v_row_count <> 4 or v_resources <> 4 or
     v_reservations <> v_unique_reservations or v_drafts <> v_unique_drafts or
     v_confirmed <> v_confirmed_evidenced then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'pilot_ledger_invariant_violation',
      'run_id_hash', pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(v_run.run_id, 'UTF8'), 'sha256'
      ), 'hex')
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'reason_code', 'pilot_ledger_read',
    'run_id_hash', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_run.run_id, 'UTF8'), 'sha256'
    ), 'hex'),
    'run_status', v_run.status, 'expires_at', v_run.expires_at, 'rows', v_rows
  );
end;
$$;

alter table public.transactional_graph_pilot_runs enable row level security;
alter table public.transactional_graph_pilot_runs force row level security;
revoke all privileges on table public.transactional_graph_pilot_runs
  from public, anon, authenticated, service_role;
alter table fundae_private.transactional_graph_pilot_authorization_grants
  enable row level security;
alter table fundae_private.transactional_graph_pilot_authorization_grants
  force row level security;
revoke all privileges on table
  fundae_private.transactional_graph_pilot_authorization_grants
  from public, anon, authenticated, service_role;

revoke execute on function public.enforce_transactional_graph_pilot_binding()
  from public, anon, authenticated, service_role;
revoke execute on function fundae_private.transactional_graph_pilot_cohort_reason(text,text[])
  from public, anon, authenticated, service_role;
revoke execute on function fundae_private.register_transactional_graph_pilot_grant(
  text,text,text,text,text[],integer,timestamptz,text
) from public, anon, authenticated, service_role;
revoke execute on function fundae_private.enforce_transactional_graph_pilot_deadline()
  from public, anon, authenticated, service_role;
revoke execute on function public.claim_transactional_graph_dispatch_pre_pilot_20260819(uuid,integer,integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.reserve_claimed_transactional_graph_dispatch_pre_pilot_20260819(uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.authorize_graph_draft_send_pre_pilot_20260819(uuid,text,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.emergency_halt_outbound_delivery_pre_pilot_20260819(text,text)
  from public, anon, authenticated, service_role;

revoke execute on function public.preview_transactional_graph_pilot(text,text,text,text[],integer)
  from public, anon, authenticated;
revoke execute on function public.start_transactional_graph_pilot(text,text,text,text[],text,integer)
  from public, anon, authenticated;
revoke execute on function public.claim_transactional_graph_dispatch(uuid,integer,integer)
  from public, anon, authenticated;
revoke execute on function public.reserve_claimed_transactional_graph_dispatch(uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.authorize_graph_draft_send(uuid,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.finish_transactional_graph_pilot(text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.read_transactional_graph_pilot_ledger(text,text)
  from public, anon, authenticated;
revoke execute on function public.emergency_halt_outbound_delivery(text,text)
  from public, anon, authenticated;

grant execute on function public.preview_transactional_graph_pilot(text,text,text,text[],integer)
  to service_role;
grant execute on function public.start_transactional_graph_pilot(text,text,text,text[],text,integer)
  to service_role;
grant execute on function public.claim_transactional_graph_dispatch(uuid,integer,integer)
  to service_role;
grant execute on function public.reserve_claimed_transactional_graph_dispatch(uuid,uuid,text,text,text,text,text)
  to service_role;
grant execute on function public.authorize_graph_draft_send(uuid,text,text,text)
  to service_role;
grant execute on function public.finish_transactional_graph_pilot(text,text,text,text)
  to service_role;
grant execute on function public.read_transactional_graph_pilot_ledger(text,text)
  to service_role;
grant execute on function public.emergency_halt_outbound_delivery(text,text)
  to service_role;
grant execute on function fundae_private.register_transactional_graph_pilot_grant(
  text,text,text,text,text[],integer,timestamptz,text
) to postgres;
grant execute on function fundae_private.enforce_transactional_graph_pilot_deadline()
  to postgres;

select cron.unschedule(jobid)
from cron.job
where jobname = 'fundae-transactional-graph-pilot-watchdog';
select cron.schedule(
  'fundae-transactional-graph-pilot-watchdog',
  '* * * * *',
  $watchdog$select fundae_private.enforce_transactional_graph_pilot_deadline();$watchdog$
);

-- Applying the contract never activates a lane or a pilot scope.
update public.outbound_delivery_control
set master_enabled = false, transactional_enabled = false, cold_enabled = false,
    halt_reason = 'TRANSACTIONAL_GRAPH_PILOT_NOT_STARTED',
    updated_at = pg_catalog.clock_timestamp()
where singleton;

commit;
