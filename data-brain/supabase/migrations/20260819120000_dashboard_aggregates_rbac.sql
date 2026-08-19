-- Server-side dashboard aggregates, bounded samples and application RBAC.
-- Additive and fail-closed. It does not enable outbound capabilities.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create table public.dashboard_principals (
  actor_hash text primary key check (actor_hash ~ '^[a-f0-9]{64}$'),
  role text not null check (role in ('admin', 'operator', 'auditor', 'read_only')),
  is_active boolean not null default true,
  granted_by_hash text check (
    granted_by_hash is null or granted_by_hash ~ '^[a-f0-9]{64}$'
  ),
  granted_at timestamptz not null default pg_catalog.clock_timestamp(),
  revoked_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check ((is_active and revoked_at is null) or (not is_active and revoked_at is not null))
);

create table public.dashboard_audit_log (
  id bigint generated always as identity primary key,
  request_id text not null check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$'),
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  actor_role text not null check (
    actor_role in ('admin', 'operator', 'auditor', 'read_only')
  ),
  action text not null check (
    action in ('summary_read', 'sample_read', 'audit_read', 'export_requested')
  ),
  scope jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(scope) = 'object'),
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint dashboard_audit_log_request_action_key unique (request_id, action),
  constraint dashboard_audit_log_scope_no_pii check (not (scope ?| array[
    'email', 'name', 'phone', 'company', 'address', 'ip', 'payload', 'message',
    'graph_draft_immutable_id', 'internet_message_id'
  ]))
);

create index dashboard_audit_log_actor_time_idx
  on public.dashboard_audit_log (actor_hash, occurred_at desc);
create index dashboard_audit_log_action_time_idx
  on public.dashboard_audit_log (action, occurred_at desc);

alter table public.dashboard_principals enable row level security;
alter table public.dashboard_principals force row level security;
alter table public.dashboard_audit_log enable row level security;
alter table public.dashboard_audit_log force row level security;

revoke all privileges on table public.dashboard_principals
  from public, anon, authenticated, service_role;
revoke all privileges on table public.dashboard_audit_log
  from public, anon, authenticated, service_role;

create or replace function public.dashboard_require_role(
  p_actor_hash text, p_allowed_roles text[]
) returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
begin
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_allowed_roles is null or pg_catalog.cardinality(p_allowed_roles) = 0 or
     exists (
       select 1 from pg_catalog.unnest(p_allowed_roles) allowed(role)
       where role not in ('admin', 'operator', 'auditor', 'read_only')
     ) then
    raise exception using errcode = '22023', message = 'dashboard_invalid_authorization';
  end if;

  select role into v_role
  from public.dashboard_principals
  where actor_hash = p_actor_hash and is_active and revoked_at is null;

  if not found or v_role <> all(p_allowed_roles) then
    raise exception using errcode = '42501', message = 'dashboard_access_denied';
  end if;
  return v_role;
end;
$$;

create or replace function public.prevent_dashboard_audit_mutation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'dashboard_audit_is_append_only';
end;
$$;

create trigger dashboard_audit_append_only
before update or delete on public.dashboard_audit_log
for each row execute function public.prevent_dashboard_audit_mutation();

create or replace function public.dashboard_get_summary(
  p_actor_hash text, p_request_id text,
  p_from timestamptz, p_to timestamptz, p_campaign_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_result jsonb;
begin
  if p_request_id is null or
     p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$' or
     p_from is null or p_to is null or p_from >= p_to or
     p_to > v_now + interval '5 minutes' or
     p_to - p_from > interval '366 days' then
    raise exception using errcode = '22023', message = 'dashboard_invalid_window';
  end if;
  v_role := public.dashboard_require_role(
    p_actor_hash, array['admin', 'operator', 'auditor', 'read_only']
  );

  insert into public.dashboard_audit_log(
    request_id, actor_hash, actor_role, action, scope
  ) values (
    p_request_id, p_actor_hash, v_role, 'summary_read',
    pg_catalog.jsonb_build_object(
      'from', p_from, 'to', p_to, 'campaign_scoped', p_campaign_id is not null
    )
  ) on conflict (request_id, action) do nothing;

  with
  lead_base as materialized (
    select lead_magnet, lead_classification, lead_score
    from public.leads where created_at >= p_from and created_at < p_to
  ),
  event_base as materialized (
    select event_name, anonymous_id, session_id, lead_magnet, context, occurred_at
    from public.events where occurred_at >= p_from and occurred_at < p_to
  ),
  campaign_contact_base as materialized (
    select lot, current_step, marketing_lane, suppression_scope, deal_value,
      hubspot_sync_status, hubspot_contact_id, lock_expires_at,
      opportunity_created_at
    from public.campaign_contacts
    where created_at >= p_from and created_at < p_to
      and (p_campaign_id is null or campaign_id = p_campaign_id)
  ),
  campaign_event_base as materialized (
    select ce.event_name
    from public.campaign_events ce
    where ce.occurred_at >= p_from and ce.occurred_at < p_to
      and (p_campaign_id is null or ce.campaign_id = p_campaign_id)
  ),
  campaign_execution_base as materialized (
    select ce.status
    from public.campaign_executions ce
    where ce.created_at >= p_from and ce.created_at < p_to
      and (p_campaign_id is null or ce.campaign_id = p_campaign_id)
  )
  select pg_catalog.jsonb_build_object(
    'meta', pg_catalog.jsonb_build_object(
      'role', v_role, 'generated_at', v_now, 'from', p_from, 'to', p_to,
      'campaign_id', p_campaign_id, 'freshness_target_seconds', 60,
      'aggregate_complete', true, 'pii_included', false
    ),
    'funnel', pg_catalog.jsonb_build_object(
      'leads', (select count(*) from lead_base),
      'by_magnet', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select coalesce(lead_magnet, 'unknown') k, count(*) n
          from lead_base group by 1) grouped), '{}'::jsonb),
      'by_classification', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select coalesce(lead_classification, 'unknown') k, count(*) n
          from lead_base group by 1) grouped), '{}'::jsonb),
      'by_score_band', pg_catalog.jsonb_build_object(
        '0_39', (select count(*) from lead_base where lead_score between 0 and 39),
        '40_59', (select count(*) from lead_base where lead_score between 40 and 59),
        '60_79', (select count(*) from lead_base where lead_score between 60 and 79),
        '80_plus', (select count(*) from lead_base where lead_score >= 80)
      ),
      'events_by_name', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select event_name k, count(*) n from event_base group by 1) grouped),
        '{}'::jsonb)
    ),
    'journey', pg_catalog.jsonb_build_object(
      'events', (select count(*) from event_base),
      'unique_visitors', (select count(distinct anonymous_id) from event_base),
      'unique_sessions', (select count(distinct session_id) from event_base),
      'consented_events', (select count(*) from event_base
        where context ->> 'consent_state' = 'accepted'),
      'latest_event_at', (select max(occurred_at) from event_base),
      'by_magnet', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select coalesce(lead_magnet, 'unknown') k, count(*) n
          from event_base group by 1) grouped), '{}'::jsonb)
    ),
    'transactional', pg_catalog.jsonb_build_object(
      'dispatch_by_status', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select status k, count(*) n from public.transactional_dispatch_outbox
          where created_at >= p_from and created_at < p_to group by status) grouped),
        '{}'::jsonb),
      'graph_by_state', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select state k, count(*) n from public.graph_outbox
          where lane = 'transactional' and created_at >= p_from and created_at < p_to
          group by state) grouped), '{}'::jsonb),
      'reservations_by_status', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select status k, count(*) n from public.mailbox_delivery_reservations
          where lane = 'transactional' and reserved_at >= p_from and reserved_at < p_to
          group by status) grouped), '{}'::jsonb),
      'tx_events_by_name', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select event_name k, count(*) n from public.transactional_email_events
          where occurred_at >= p_from and occurred_at < p_to group by event_name) grouped),
        '{}'::jsonb),
      'claims_total', (select count(*) from public.transactional_intake_claims
        where claimed_at >= p_from and claimed_at < p_to),
      'claims_unconsumed', (select count(*) from public.transactional_intake_claims
        where claimed_at >= p_from and claimed_at < p_to
          and capability_consumed_at is null)
    ),
    'campaign', pg_catalog.jsonb_build_object(
      'contacts', (select count(*) from campaign_contact_base),
      'by_lane', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select marketing_lane k, count(*) n from campaign_contact_base group by 1) grouped),
        '{}'::jsonb),
      'by_lot', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select lot k, count(*) n from campaign_contact_base group by 1) grouped), '{}'::jsonb),
      'by_step', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select current_step::text k, count(*) n from campaign_contact_base group by 1) grouped),
        '{}'::jsonb),
      'events_by_name', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select event_name k, count(*) n from campaign_event_base group by 1) grouped),
        '{}'::jsonb),
      'executions_by_status', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select status k, count(*) n from campaign_execution_base group by 1) grouped),
        '{}'::jsonb),
      'pipeline_value', (select coalesce(sum(deal_value), 0)
        from campaign_contact_base where opportunity_created_at is not null),
      'hubspot_unlinked', (select count(*) from campaign_contact_base
        where hubspot_contact_id is null or hubspot_sync_status <> 'synced'),
      'suppressed', (select count(*) from campaign_contact_base
        where suppression_scope <> 'none')
    ),
    'health', pg_catalog.jsonb_build_object(
      'queue_by_status', coalesce((select pg_catalog.jsonb_object_agg(k, n)
        from (select status k, count(*) n from public.delivery_queue
          where created_at >= p_from and created_at < p_to group by status) grouped),
        '{}'::jsonb),
      'expired_contact_locks', (select count(*) from campaign_contact_base
        where lock_expires_at <= v_now),
      'expired_reservation_leases', (select count(*)
        from public.mailbox_delivery_reservations
        where status = 'reserved' and lease_expires_at <= v_now),
      'mailboxes_active', (select count(*) from public.mailbox_throttle_state
        where active_reservation_id is not null),
      'mailboxes_blocked', (select count(*) from public.mailbox_throttle_state
        where blocked_reservation_id is not null),
      'outbox_ambiguous', (select count(*) from public.graph_outbox
        where state = 'ambiguous_halted'),
      'outbox_in_flight', (select count(*) from public.graph_outbox
        where state in ('draft_creating', 'draft_created', 'send_submitted')),
      'control', (select pg_catalog.jsonb_build_object(
        'master_enabled', master_enabled,
        'transactional_enabled', transactional_enabled,
        'cold_enabled', cold_enabled,
        'minimum_spacing_seconds', minimum_spacing_seconds,
        'cold_daily_limit', cold_daily_limit,
        'operating_timezone', operating_timezone,
        'updated_at', updated_at
      ) from public.outbound_delivery_control where singleton)
    )
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.dashboard_get_sample(
  p_actor_hash text, p_request_id text, p_dataset text,
  p_from timestamptz, p_to timestamptz, p_offset integer, p_limit integer
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_limit integer;
  v_total bigint;
  v_rows jsonb := '[]'::jsonb;
begin
  if p_request_id is null or
     p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$' or
     p_dataset not in (
       'leads', 'events', 'reservations', 'transactional_events',
       'campaign_executions', 'graph_events', 'audit'
     ) or p_from is null or p_to is null or p_from >= p_to or
     p_to > v_now + interval '5 minutes' or
     p_to - p_from > interval '366 days' or
     p_offset is null or p_offset < 0 or p_offset > 100000 or
     p_limit is null or p_limit < 1 then
    raise exception using errcode = '22023', message = 'dashboard_invalid_sample_request';
  end if;
  v_role := public.dashboard_require_role(
    p_actor_hash, array['admin', 'operator', 'auditor']
  );
  if (p_dataset in ('leads', 'events', 'audit') and
      v_role not in ('admin', 'auditor')) then
    raise exception using errcode = '42501', message = 'dashboard_dataset_access_denied';
  end if;
  v_limit := least(
    p_limit, case when v_role in ('admin', 'operator') then 100 else 50 end
  );

  insert into public.dashboard_audit_log(
    request_id, actor_hash, actor_role, action, scope
  ) values (
    p_request_id, p_actor_hash, v_role,
    case when p_dataset = 'audit' then 'audit_read' else 'sample_read' end,
    pg_catalog.jsonb_build_object(
      'dataset', p_dataset, 'from', p_from, 'to', p_to,
      'offset', p_offset, 'limit', v_limit
    )
  ) on conflict (request_id, action) do nothing;

  case p_dataset
    when 'leads' then
      select count(*) into v_total from public.leads
      where created_at >= p_from and created_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'id', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(id::text, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'lead_magnet', lead_magnet, 'lead_classification', lead_classification,
          'lead_score', lead_score, 'delivery_status', delivery_status,
          'email_delivery_status', email_delivery_status, 'created_at', created_at
        ) row_data
        from public.leads
        where created_at >= p_from and created_at < p_to
        order by created_at desc, id desc offset p_offset limit v_limit
      ) sample;
    when 'events' then
      select count(*) into v_total from public.events
      where occurred_at >= p_from and occurred_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'id', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(id::text, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'event_name', event_name, 'lead_magnet', lead_magnet,
          'consent_state', context ->> 'consent_state', 'occurred_at', occurred_at
        ) row_data
        from public.events
        where occurred_at >= p_from and occurred_at < p_to
        order by occurred_at desc, id desc offset p_offset limit v_limit
      ) sample;
    when 'reservations' then
      select count(*) into v_total from public.mailbox_delivery_reservations
      where reserved_at >= p_from and reserved_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'id', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(id::text, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'lane', lane, 'resource', resource, 'status', status,
          'reserved_at', reserved_at, 'lease_expires_at', lease_expires_at,
          'finalized_at', finalized_at, 'failure_code', failure_code
        ) row_data
        from public.mailbox_delivery_reservations
        where reserved_at >= p_from and reserved_at < p_to
        order by reserved_at desc, id desc offset p_offset limit v_limit
      ) sample;
    when 'transactional_events' then
      select count(*) into v_total from public.transactional_email_events
      where occurred_at >= p_from and occurred_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'id', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(id::text, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'submission', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(submission_id, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'event_name', event_name, 'occurred_at', occurred_at,
          'failure_code', failure_code,
          'provider_evidence_present', provider_message_hash is not null
        ) row_data
        from public.transactional_email_events
        where occurred_at >= p_from and occurred_at < p_to
        order by occurred_at desc, id desc offset p_offset limit v_limit
      ) sample;
    when 'campaign_executions' then
      select count(*) into v_total from public.campaign_executions
      where created_at >= p_from and created_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'id', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(id::text, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'channel', channel, 'step', step,
          'status', status, 'scheduled_for', scheduled_for,
          'actual_at', actual_at, 'failure_code', failure_code
        ) row_data
        from public.campaign_executions
        where created_at >= p_from and created_at < p_to
        order by created_at desc, id desc offset p_offset limit v_limit
      ) sample;
    when 'graph_events' then
      select count(*) into v_total from public.graph_outbox_events
      where occurred_at >= p_from and occurred_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'reservation', substring(pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(reservation_id::text, 'UTF8'), 'sha256'
          ), 'hex') from 1 for 24),
          'state', state, 'occurred_at', occurred_at,
          'evidence_present', evidence_hash is not null
        ) row_data
        from public.graph_outbox_events
        where occurred_at >= p_from and occurred_at < p_to
        order by occurred_at desc, id desc offset p_offset limit v_limit
      ) sample;
    when 'audit' then
      select count(*) into v_total from public.dashboard_audit_log
      where occurred_at >= p_from and occurred_at < p_to;
      select coalesce(pg_catalog.jsonb_agg(row_data), '[]'::jsonb)
      into v_rows from (
        select pg_catalog.jsonb_build_object(
          'request_id', request_id,
          'actor', substring(actor_hash from 1 for 16),
          'actor_role', actor_role, 'action', action,
          'scope', scope, 'occurred_at', occurred_at
        ) row_data
        from public.dashboard_audit_log
        where occurred_at >= p_from and occurred_at < p_to
        order by occurred_at desc, id desc offset p_offset limit v_limit
      ) sample;
  end case;

  return pg_catalog.jsonb_build_object(
    'dataset', p_dataset, 'role', v_role, 'offset', p_offset,
    'limit', v_limit, 'total', v_total,
    'has_more', p_offset + pg_catalog.jsonb_array_length(v_rows) < v_total,
    'pii_included', false, 'rows', v_rows
  );
end;
$$;

revoke execute on function public.dashboard_require_role(text,text[])
  from public, anon, authenticated, service_role;
revoke execute on function public.prevent_dashboard_audit_mutation()
  from public, anon, authenticated, service_role;
revoke execute on function public.dashboard_get_summary(
  text,text,timestamptz,timestamptz,uuid
) from public, anon, authenticated;
revoke execute on function public.dashboard_get_sample(
  text,text,text,timestamptz,timestamptz,integer,integer
) from public, anon, authenticated;
grant execute on function public.dashboard_get_summary(
  text,text,timestamptz,timestamptz,uuid
) to service_role;
grant execute on function public.dashboard_get_sample(
  text,text,text,timestamptz,timestamptz,integer,integer
) to service_role;

commit;
