-- Private cold-campaign identity guard and adaptive repair for environments
-- where the later provisioning migration was already applied.
begin;

set local search_path='';

create schema if not exists fundae_private;
revoke all on schema fundae_private from public,anon,authenticated,service_role;

-- HMAC_IDENTITY_HELPER_BEGIN
create or replace function fundae_private.is_cold_campaign_hmac_identity(
  p_email text,
  p_identity_hash text
) returns boolean
language sql
immutable
parallel safe
set search_path=''
as $$
  select coalesce(
    p_email is not null
    and p_identity_hash ~ '^[a-f0-9]{64}$'
    and p_identity_hash <> pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(p_email)),'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    false
  );
$$;
-- HMAC_IDENTITY_HELPER_END

revoke all on function fundae_private.is_cold_campaign_hmac_identity(text,text)
  from public,anon,authenticated,service_role;

do $$
declare
  v_signature constant text := 'public.apply_cold_campaign_provision_batch(text,text,integer,integer,text,text,text,text,jsonb)';
  v_function regprocedure := pg_catalog.to_regprocedure(v_signature);
  v_definition text;
  v_patched_definition text;
  v_legacy_predicate constant text := $legacy$pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.lower(v_row->>'email'),'UTF8'),'sha256'),'hex')<>v_row->>'email_hash'$legacy$;
  v_hmac_predicate constant text := $hmac$not fundae_private.is_cold_campaign_hmac_identity(v_row->>'email',v_row->>'email_hash')$hmac$;
  v_occurrences integer;
  v_security_definer boolean;
  v_config text[];
begin
  -- Fresh databases reach this migration before the provisioning function exists.
  if v_function is null then
    return;
  end if;

  select pg_catalog.pg_get_functiondef(p.oid),p.prosecdef,p.proconfig
  into strict v_definition,v_security_definer,v_config
  from pg_catalog.pg_proc p
  where p.oid=v_function;

  if not v_security_definer or not coalesce(
    v_config @> array['search_path=""']::text[],false
  ) then
    raise exception using errcode='55000',
      message='cold_campaign_hmac_patch_insecure_function_metadata';
  end if;

  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition,v_legacy_predicate,''))
  ) / pg_catalog.length(v_legacy_predicate);
  if v_occurrences<>1 then
    raise exception using errcode='55000',
      message='cold_campaign_hmac_patch_source_drift',
      detail=pg_catalog.format('expected_legacy_occurrences=1 actual=%s',v_occurrences);
  end if;

  v_patched_definition := pg_catalog.replace(
    v_definition,v_legacy_predicate,v_hmac_predicate
  );
  execute v_patched_definition;

  select pg_catalog.pg_get_functiondef(p.oid),p.prosecdef,p.proconfig
  into strict v_definition,v_security_definer,v_config
  from pg_catalog.pg_proc p
  where p.oid=v_function;

  if pg_catalog.strpos(v_definition,v_legacy_predicate)<>0
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition,v_hmac_predicate,''))
     ) / pg_catalog.length(v_hmac_predicate)<>1
     or not v_security_definer
     or not coalesce(v_config @> array['search_path=""']::text[],false) then
    raise exception using errcode='55000',
      message='cold_campaign_hmac_patch_verification_failed';
  end if;

  execute pg_catalog.format(
    'revoke execute on function %s from public,anon,authenticated',v_signature
  );
  execute pg_catalog.format(
    'grant execute on function %s to service_role',v_signature
  );
end;
$$;

commit;
