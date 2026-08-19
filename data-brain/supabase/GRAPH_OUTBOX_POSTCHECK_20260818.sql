-- Read-only postcheck. Run migration list and Supabase advisors separately.
do $$
begin
  if not exists (
    select 1 from public.outbound_delivery_control
    where singleton and not master_enabled and
      not transactional_enabled and not cold_enabled and
      minimum_spacing_seconds >= 60 and cold_daily_limit <= 480 and
      operating_timezone = 'Europe/Madrid'
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_postcheck_not_fail_closed';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'outbound_delivery_control', 'outbound_daily_usage', 'graph_outbox',
        'graph_outbox_authorizations', 'graph_outbox_events',
        'transactional_dispatch_outbox'
      ) and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then
    raise exception using errcode = '42501',
      message = 'graph_outbox_postcheck_rls_not_forced';
  end if;

  if pg_catalog.has_function_privilege(
       'service_role',
       'public.reserve_cold_mailbox_delivery(text,text,text,text)',
       'execute'
     ) or not pg_catalog.has_function_privilege(
       'service_role',
       'public.reserve_cold_graph_delivery(text,text,text,text,text,text,text,text,text)',
       'execute'
     ) then
    raise exception using errcode = '42501',
      message = 'graph_outbox_postcheck_cold_rpc_boundary';
  end if;

  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.authorize_graph_draft_send(uuid,text,text,text)',
       'execute'
     ) or pg_catalog.to_regprocedure(
       'public.authorize_graph_draft_send(uuid,text,text)'
     ) is not null or not pg_catalog.has_function_privilege(
       'service_role',
       'public.claim_transactional_graph_dispatch(uuid,integer,integer)',
       'execute'
     ) or not pg_catalog.has_function_privilege(
       'service_role',
       'public.reserve_claimed_transactional_graph_dispatch(uuid,uuid,text,text,text,text,text)',
       'execute'
     ) or not pg_catalog.has_function_privilege(
       'service_role',
       'public.finalize_transactional_graph_dispatch(uuid,uuid,text,text)',
       'execute'
     ) then
    raise exception using errcode = '42501',
      message = 'graph_dispatch_rpc_contract_missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      pg_catalog.coalesce(
        p.proacl, pg_catalog.acldefault('f', p.proowner)
      )
    ) acl
    where n.nspname = 'public'
      and p.proname in (
        'claim_transactional_graph_dispatch',
        'reserve_claimed_transactional_graph_dispatch',
        'finalize_transactional_graph_dispatch',
        'enqueue_transactional_graph_dispatch',
        'enforce_transactional_pilot_reservation',
        'mark_graph_managed_reservation'
      )
      and acl.privilege_type = 'EXECUTE'
      and (
        acl.grantee = 0 or acl.grantee in (
          select oid from pg_catalog.pg_roles
          where rolname in ('anon', 'authenticated')
        )
      )
  ) then
    raise exception using errcode = '42501',
      message = 'graph_outbox_postcheck_rpc_execute_exposed';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in (
        'enqueue_transactional_graph_dispatch',
        'enforce_transactional_pilot_reservation',
        'finalize_transactional_mailbox_delivery',
        'reconcile_transactional_mailbox_delivery',
        'mark_graph_managed_reservation'
      )
      and not pg_catalog.coalesce(
        p.proconfig @> array['search_path=""']::text[], false
      )
  ) then
    raise exception using errcode = '42501',
      message = 'graph_outbox_postcheck_insecure_definer_search_path';
  end if;

  if exists (
    select 1 from public.leads l
    left join public.transactional_dispatch_outbox d
      on d.submission_id = l.submission_id
    where l.form_type in (
      'calculator', 'interactive_checklist', 'checklist', 'webinar'
    )
      and l.delivery_status = 'captured'
      and l.email_delivery_status = 'pending'
      and (
        d.id is null or d.resource <> l.form_type or
        d.payload_sha256 <> pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(l.payload::text, 'UTF8'), 'sha256'
        ), 'hex')
      )
  ) then
    raise exception using errcode = '23514',
      message = 'transactional_dispatch_backfill_incomplete';
  end if;

  if exists (
    select 1
    from public.transactional_dispatch_outbox d
    left join public.mailbox_delivery_reservations r
      on r.id = d.reservation_id
    left join public.graph_outbox o on o.reservation_id = d.reservation_id
    left join public.graph_outbox_authorizations a
      on a.reservation_id = d.reservation_id
    where d.status = 'reserved' and (
      d.reservation_id is null or r.id is null or o.reservation_id is null or
      a.reservation_id is null or not r.graph_managed or
      r.transactional_dispatch_id is distinct from d.id or
      r.payload_sha256 <> d.payload_sha256 or
      o.lane <> 'transactional' or o.payload_sha256 <> d.payload_sha256
    )
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_postcheck_recovery_binding_invalid';
  end if;
end;
$$;

select state, lane, count(*) as reservations
from public.graph_outbox
group by state, lane
order by lane, state;

select local_day, lane, reservation_count, send_submitted_count
from public.outbound_daily_usage
order by local_day desc, lane;

select
  (select count(*) from public.graph_outbox
    where opaque_marker !~ '^[a-f0-9]{64}$') as invalid_graph_markers,
  (select count(*) from public.graph_outbox o
    join public.mailbox_delivery_reservations r on r.id = o.reservation_id
    where not r.graph_managed) as unmarked_graph_reservations;
