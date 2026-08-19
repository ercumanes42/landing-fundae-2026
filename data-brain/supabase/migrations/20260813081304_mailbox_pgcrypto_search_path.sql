-- Production hotfix for the already-created function: pgcrypto is installed
-- in Supabase's non-writable extensions schema.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter function public.reserve_transactional_mailbox_delivery(text,text,text)
  set search_path = pg_catalog, extensions;

revoke execute on function public.reserve_transactional_mailbox_delivery(text,text,text)
  from public, anon, authenticated;
grant execute on function public.reserve_transactional_mailbox_delivery(text,text,text)
  to service_role;

commit;
