-- Read-only production postcheck for the shared mailbox authority.
-- Returns aggregate counts only; never selects identifiers, hashes, payloads or recipients.
begin;

set local transaction read only;
set local statement_timeout = '15s';

do $$
declare
  v_signature text;
  v_function regprocedure;
  v_proconfig text[];
begin
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260814070713'
  ) then
    raise exception 'Mailbox lock-clock migration is not applied';
  end if;

  if (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'transactional_intake_claims',
        'mailbox_throttle_state',
        'mailbox_delivery_reservations'
      )
  ) <> 3 then
    raise exception 'Mailbox tables are incomplete';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'transactional_intake_claims',
        'mailbox_throttle_state',
        'mailbox_delivery_reservations'
      )
      and not c.relrowsecurity
  ) then
    raise exception 'RLS is disabled on a mailbox table';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) ax
    left join pg_roles r on r.oid = ax.grantee
    where n.nspname = 'public'
      and c.relname in (
        'transactional_intake_claims',
        'mailbox_throttle_state',
        'mailbox_delivery_reservations'
      )
      and ax.privilege_type in (
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      )
      and (ax.grantee = 0 or r.rolname in ('anon', 'authenticated'))
  ) then
    raise exception 'Mailbox table privileges are unsafe';
  end if;

  for v_signature in
    select unnest(array[
      'public.claim_transactional_intake(text,text,text,text,boolean)',
      'public.resolve_transactional_intake_capability(text)',
      'public.reserve_transactional_mailbox_delivery(text,text,text)',
      'public.finalize_transactional_mailbox_delivery(text,text,text,text,text)',
      'public.reserve_cold_mailbox_delivery(text,text,text,text)',
      'public.finalize_cold_mailbox_delivery(text,text,text,text,text)'
    ])
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'Required mailbox function is missing';
    end if;
    if not (select prosecdef from pg_proc where oid = v_function) then
      raise exception 'Mailbox function is not SECURITY DEFINER';
    end if;
    if not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'service_role cannot execute a mailbox function';
    end if;
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE')
       or exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) ax
         where p.oid = v_function and ax.grantee = 0 and ax.privilege_type = 'EXECUTE'
       ) then
      raise exception 'Mailbox function privileges are unsafe';
    end if;

    select proconfig into v_proconfig from pg_proc where oid = v_function;
    if not exists (
      select 1 from unnest(coalesce(v_proconfig, array[]::text[])) cfg
      where cfg like 'search_path=%'
    ) or exists (
      select 1 from unnest(coalesce(v_proconfig, array[]::text[])) cfg
      where cfg like 'search_path=%'
        and (cfg ~ '(^|[,=] *)public([, ]|$)' or cfg ~ '(^|[,=] *)pg_temp([, ]|$)')
    ) then
      raise exception 'Mailbox function search_path is unsafe';
    end if;
  end loop;

  if (
    select count(*)
    from pg_constraint
    where convalidated
      and conname in (
        'mailbox_delivery_lane_claim_check',
        'mailbox_delivery_terminal_fields_check',
        'mailbox_state_active_reservation_fk',
        'mailbox_state_blocked_reservation_fk'
      )
  ) <> 4 then
    raise exception 'Mailbox constraints are missing or not validated';
  end if;

  if (
    select count(*)
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_namespace n on n.oid = idx.relnamespace
    where n.nspname = 'public'
      and i.indisvalid
      and i.indisunique
      and idx.relname in (
        'mailbox_one_active_reservation_idx',
        'mailbox_transactional_pilot_resource_unique'
      )
  ) <> 2 then
    raise exception 'Mailbox unique indexes are missing or invalid';
  end if;

  if (
    select count(*)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'mailbox_delivery_reservations'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgname in (
        'mailbox_transactional_pilot_quota',
        'mailbox_terminal_transition',
        'mailbox_transactional_lease_expiry'
      )
  ) <> 3 then
    raise exception 'Mailbox safety triggers are missing or disabled';
  end if;

  if exists (select 1 from public.transactional_intake_claims)
     or exists (select 1 from public.mailbox_throttle_state)
     or exists (select 1 from public.mailbox_delivery_reservations)
     or exists (select 1 from public.transactional_email_events) then
    raise exception 'Mailbox pilot state is not empty';
  end if;

  if exists (
    select 1
    from public.campaigns
    where external_id = 'FUNDAE_2026_EMAIL_V1'
      and (is_active or status in ('active', 'running', 'pilot'))
  ) then
    raise exception 'Cold campaign is active';
  end if;

  if exists (
    select 1
    from public.campaign_executions e
    join public.campaigns c on c.id = e.campaign_id
    where c.external_id = 'FUNDAE_2026_EMAIL_V1'
      and e.status = 'planned'
  ) then
    raise exception 'Cold campaign has planned executions';
  end if;

  if exists (
    select 1
    from public.campaign_contacts cc
    join public.campaigns c on c.id = cc.campaign_id
    where c.external_id = 'FUNDAE_2026_EMAIL_V1'
      and cc.lock_expires_at > clock_timestamp()
  ) then
    raise exception 'Cold campaign has a live contact lock';
  end if;
end
$$;

select
  'mailbox_postcheck_ok' as result,
  (select count(*) from public.transactional_intake_claims) as claims,
  (select count(*) from public.mailbox_throttle_state) as mailbox_states,
  (select count(*) from public.mailbox_delivery_reservations) as reservations,
  (select count(*) from public.transactional_email_events) as transactional_events,
  (
    select count(*)
    from public.campaign_executions e
    join public.campaigns c on c.id = e.campaign_id
    where c.external_id = 'FUNDAE_2026_EMAIL_V1' and e.status = 'planned'
  ) as cold_planned_executions;

rollback;
