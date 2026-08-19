begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create table if not exists public.rate_limit_buckets (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  request_count integer not null check (request_count > 0),
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (expires_at > window_started_at)
);

create index if not exists rate_limit_buckets_expires_at_idx
  on public.rate_limit_buckets (expires_at);

create or replace function public.consume_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_expires_at timestamptz;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' or
     p_limit is null or p_limit < 1 or p_limit > 100000 or
     p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 or
     p_now is null then
    raise exception 'Invalid rate limit input';
  end if;

  insert into public.rate_limit_buckets as bucket (
    key_hash, request_count, window_started_at, expires_at, updated_at
  ) values (
    p_key_hash, 1, p_now, p_now + make_interval(secs => p_window_seconds), p_now
  )
  on conflict (key_hash) do update set
    request_count = case
      when bucket.expires_at <= p_now then 1
      else bucket.request_count + 1
    end,
    window_started_at = case
      when bucket.expires_at <= p_now then p_now
      else bucket.window_started_at
    end,
    expires_at = case
      when bucket.expires_at <= p_now then p_now + make_interval(secs => p_window_seconds)
      else bucket.expires_at
    end,
    updated_at = p_now
  returning request_count, expires_at into v_count, v_expires_at;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'retry_after_seconds', case
      when v_count <= p_limit then 0
      else greatest(1, ceil(extract(epoch from (v_expires_at - p_now))))::integer
    end
  );
end;
$$;

create or replace function public.cleanup_expired_rate_limits(
  p_before timestamptz default now() - interval '1 day',
  p_batch_size integer default 5000
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_before is null or p_batch_size is null or p_batch_size < 1 or p_batch_size > 50000 then
    raise exception 'Invalid cleanup input';
  end if;

  with expired as (
    select ctid
    from public.rate_limit_buckets
    where expires_at < p_before
    order by expires_at
    limit p_batch_size
    for update skip locked
  )
  delete from public.rate_limit_buckets bucket
  using expired
  where bucket.ctid = expired.ctid;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

alter table public.rate_limit_buckets enable row level security;
revoke all privileges on table public.rate_limit_buckets from public, anon, authenticated;
revoke execute on function public.consume_rate_limit(text,integer,integer,timestamptz) from public, anon, authenticated;
revoke execute on function public.cleanup_expired_rate_limits(timestamptz,integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer,timestamptz) to service_role;
grant execute on function public.cleanup_expired_rate_limits(timestamptz,integer) to service_role;

commit;