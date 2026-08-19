-- Keep trigger-only functions out of the public RPC surface.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function public.touch_campaign_updated_at() set search_path = public, pg_temp;

revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.touch_campaign_updated_at() from public, anon, authenticated;
revoke execute on function public.enforce_campaign_execution_stop_gate() from public, anon, authenticated;
revoke execute on function public.enforce_campaign_suppression_on_contact() from public, anon, authenticated;
revoke execute on function public.propagate_campaign_unsubscribe_event() from public, anon, authenticated;

grant execute on function public.touch_updated_at() to service_role;
grant execute on function public.touch_campaign_updated_at() to service_role;
grant execute on function public.enforce_campaign_execution_stop_gate() to service_role;
grant execute on function public.enforce_campaign_suppression_on_contact() to service_role;
grant execute on function public.propagate_campaign_unsubscribe_event() to service_role;

commit;
