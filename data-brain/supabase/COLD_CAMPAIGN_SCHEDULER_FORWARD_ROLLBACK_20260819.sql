-- Forward-safe rollback. Preserve payload/outbox/audit evidence; disable access and sending.
begin;
update public.outbound_delivery_control
set cold_enabled=false, halt_reason='COLD_SCHEDULER_ROLLBACK', updated_at=pg_catalog.clock_timestamp()
where singleton;
revoke execute on function public.claim_cold_campaign_dispatch(uuid,text,integer) from service_role;
revoke execute on function public.get_claimed_cold_campaign_package(uuid,uuid,text) from service_role;
revoke execute on function public.bind_cold_campaign_reservation(uuid,uuid,text,text,text,text,text,text,text) from service_role;
revoke execute on function public.finalize_cold_campaign_dispatch(uuid,uuid,text,text,text) from service_role;
revoke execute on function public.halt_cold_campaign_dispatch(uuid,uuid,text,text,text) from service_role;
update public.cold_campaign_dispatch_outbox
set status='ambiguous_halted',last_reason_code='forward_rollback',
  terminal_evidence_hash=encode(extensions.digest(convert_to('cold-forward-rollback-v1' || id::text,'UTF8'),'sha256'),'hex'),
  terminal_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
where status in ('claimed','reserved');
insert into public.cold_campaign_scheduler_alerts(code,dispatch_id,evidence_hash)
select 'FORWARD_ROLLBACK',id,terminal_evidence_hash from public.cold_campaign_dispatch_outbox where last_reason_code='forward_rollback';
commit;
