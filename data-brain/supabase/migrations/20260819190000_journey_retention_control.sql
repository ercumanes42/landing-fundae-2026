begin;

-- Raw consented journey events have a 90-day policy in tracking-contract.ts.
-- Purging remains disabled until an authorized staging review enables it.
create table if not exists public.journey_retention_control (
  singleton boolean primary key default true check (singleton),
  raw_event_days integer not null default 90 check (raw_event_days between 1 and 3650),
  purge_enabled boolean not null default false,
  last_run_at timestamptz,
  last_before timestamptz,
  last_deleted_count integer check (last_deleted_count is null or last_deleted_count >= 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

insert into public.journey_retention_control(singleton, raw_event_days, purge_enabled)
values (true, 90, false)
on conflict (singleton) do nothing;

create table if not exists public.journey_retention_runs (
  id uuid primary key default gen_random_uuid(),
  requested_before timestamptz not null,
  eligible_before timestamptz not null,
  requested_limit integer not null check (requested_limit between 1 and 10000),
  candidate_count integer not null check (candidate_count >= 0),
  deleted_count integer not null check (deleted_count >= 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index if not exists events_journey_retention_idx
  on public.events (occurred_at, id);
create index if not exists journey_retention_runs_created_idx
  on public.journey_retention_runs (created_at desc);

alter table public.journey_retention_control enable row level security;
alter table public.journey_retention_control force row level security;
alter table public.journey_retention_runs enable row level security;
alter table public.journey_retention_runs force row level security;

revoke all privileges on table public.journey_retention_control
  from public, anon, authenticated, service_role;
revoke all privileges on table public.journey_retention_runs
  from public, anon, authenticated, service_role;

create or replace function public.purge_expired_journey_events(
  p_before timestamptz,
  p_limit integer default 1000,
  p_apply boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control public.journey_retention_control%rowtype;
  v_now timestamptz;
  v_eligible_before timestamptz;
  v_candidate_count integer := 0;
  v_deleted_count integer := 0;
  v_run_id uuid;
begin
  if p_before is null then
    raise exception 'p_before is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'p_limit must be between 1 and 10000';
  end if;

  select * into v_control
  from public.journey_retention_control
  where singleton = true
  for update;
  v_now := pg_catalog.clock_timestamp();

  if not found then
    return jsonb_build_object(
      'accepted', false, 'applied', false, 'reason_code', 'policy_unconfigured',
      'candidate_count', 0, 'deleted_count', 0
    );
  end if;

  v_eligible_before := v_now - pg_catalog.make_interval(days => v_control.raw_event_days);
  if p_before > v_eligible_before then
    return jsonb_build_object(
      'accepted', false, 'applied', false, 'reason_code', 'cutoff_too_recent',
      'eligible_before', v_eligible_before, 'candidate_count', 0, 'deleted_count', 0
    );
  end if;

  select pg_catalog.count(*)::integer into v_candidate_count
  from (
    select id
    from public.events
    where occurred_at < p_before
    order by occurred_at, id
    limit p_limit
  ) candidates;

  if not p_apply then
    return jsonb_build_object(
      'accepted', true, 'applied', false, 'reason_code', 'dry_run',
      'eligible_before', v_eligible_before, 'candidate_count', v_candidate_count,
      'deleted_count', 0
    );
  end if;

  if not v_control.purge_enabled then
    return jsonb_build_object(
      'accepted', false, 'applied', false, 'reason_code', 'purge_disabled',
      'eligible_before', v_eligible_before, 'candidate_count', v_candidate_count,
      'deleted_count', 0
    );
  end if;

  with candidates as (
    select id
    from public.events
    where occurred_at < p_before
    order by occurred_at, id
    for update skip locked
    limit p_limit
  ), deleted as (
    delete from public.events event
    using candidates
    where event.id = candidates.id
    returning event.id
  )
  select pg_catalog.count(*)::integer into v_deleted_count from deleted;

  insert into public.journey_retention_runs(
    requested_before, eligible_before, requested_limit, candidate_count, deleted_count
  ) values (
    p_before, v_eligible_before, p_limit, v_candidate_count, v_deleted_count
  ) returning id into v_run_id;

  update public.journey_retention_control
  set last_run_at = v_now,
      last_before = p_before,
      last_deleted_count = v_deleted_count,
      updated_at = v_now
  where singleton = true;

  return jsonb_build_object(
    'accepted', true, 'applied', true, 'reason_code', 'purged',
    'eligible_before', v_eligible_before, 'candidate_count', v_candidate_count,
    'deleted_count', v_deleted_count, 'run_id', v_run_id
  );
end;
$$;

revoke execute on function public.purge_expired_journey_events(timestamptz, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.purge_expired_journey_events(timestamptz, integer, boolean)
  to service_role;

commit;
