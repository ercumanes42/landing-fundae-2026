-- Forward-safe operational rollback. It disables capabilities and preserves all evidence.
-- Before running, set app.operator_hash to SHA-256(operator stable id) in this transaction.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';

-- Example, intentionally commented: set local app.operator_hash = '<64 lowercase hex>';
do $$
declare
  v_actor_hash text := pg_catalog.current_setting('app.operator_hash', true);
  v_result jsonb;
begin
  if v_actor_hash is null or v_actor_hash !~ '^[a-f0-9]{64}$' or
     v_actor_hash = pg_catalog.repeat('0', 64) then
    raise exception using errcode = '22023',
      message = 'graph_outbox_forward_rollback_operator_hash_required';
  end if;

  v_result := public.emergency_halt_outbound_delivery(
    v_actor_hash,
    'FORWARD_ROLLBACK_OPERATOR_HALT'
  );
  if not pg_catalog.coalesce((v_result ->> 'accepted')::boolean, false) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_forward_rollback_rejected';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from public.outbound_delivery_control
    where singleton and (
      master_enabled or transactional_enabled or cold_enabled
    )
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_forward_rollback_failed';
  end if;
end;
$$;

commit;

-- Read-only reconciliation inventory after the kill switch is durably OFF.
select status,
  count(*) as dispatches,
  count(*) filter (
    where status = 'reserved'
      and claim_expires_at <= pg_catalog.clock_timestamp()
  ) as expired_recovery_required
from public.transactional_dispatch_outbox
where status in ('claimed', 'reserved', 'ambiguous_halted')
group by status order by status;

select reservation_id, state,
  graph_draft_immutable_id is not null as draft_exists,
  draft_neutralized_at is not null as neutralized,
  terminal_evidence_hash is not null as terminal_evidence_present
from public.graph_outbox
where state in (
  'draft_creating', 'draft_created', 'send_submitted',
  'ambiguous_halted', 'suppressed_before_send'
)
order by created_at;
