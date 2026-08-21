do $$
begin
  if not exists(select 1 from public.outbound_delivery_control where singleton and not cold_enabled) then
    raise exception 'cold_scheduler_postcheck_not_off';
  end if;
  if pg_catalog.to_regclass('public.cold_campaign_dispatch_outbox') is null or
     pg_catalog.to_regprocedure('public.claim_cold_campaign_dispatch(uuid,text,integer)') is null or
     has_function_privilege('anon','public.claim_cold_campaign_dispatch(uuid,text,integer)','EXECUTE') or
     has_function_privilege('authenticated','public.claim_cold_campaign_dispatch(uuid,text,integer)','EXECUTE') then
    raise exception 'cold_scheduler_postcheck_contract_missing';
  end if;
end $$;
