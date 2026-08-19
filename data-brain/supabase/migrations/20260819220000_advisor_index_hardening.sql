-- Cover every foreign key reported by the Supabase performance advisor.
-- Additive only; outbound, retention and provisioning controls remain unchanged.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '10min';

create index if not exists cold_dispatch_reservation_fk_idx
  on public.cold_campaign_dispatch_outbox (reservation_id);
create index if not exists cold_provision_manifest_campaign_fk_idx
  on public.cold_campaign_provision_manifests (campaign_id);
create index if not exists cold_scheduler_alert_dispatch_fk_idx
  on public.cold_campaign_scheduler_alerts (dispatch_id);
create index if not exists events_campaign_fk_idx
  on public.events (campaign_id);
create index if not exists graph_outbox_mailbox_reservation_fk_idx
  on public.graph_outbox (mailbox_key_hash, reservation_id);
create index if not exists inbound_ledger_contact_fk_idx
  on public.inbound_event_ledger (campaign_contact_id);
create index if not exists inbound_ledger_campaign_fk_idx
  on public.inbound_event_ledger (campaign_id);
create index if not exists mailbox_state_active_reservation_fk_idx
  on public.mailbox_throttle_state (mailbox_key_hash, active_reservation_id);
create index if not exists mailbox_state_blocked_reservation_fk_idx
  on public.mailbox_throttle_state (mailbox_key_hash, blocked_reservation_id);
create index if not exists operational_alert_receipts_dedupe_fk_idx
  on public.operational_alert_receipts (dedupe_key);

do $$
begin
  if exists (
    select 1
    from unnest(array[
      'cold_dispatch_reservation_fk_idx',
      'cold_provision_manifest_campaign_fk_idx',
      'cold_scheduler_alert_dispatch_fk_idx',
      'events_campaign_fk_idx',
      'graph_outbox_mailbox_reservation_fk_idx',
      'inbound_ledger_contact_fk_idx',
      'inbound_ledger_campaign_fk_idx',
      'mailbox_state_active_reservation_fk_idx',
      'mailbox_state_blocked_reservation_fk_idx',
      'operational_alert_receipts_dedupe_fk_idx'
    ]) as expected(index_name)
    where pg_catalog.to_regclass('public.' || expected.index_name) is null
  ) then
    raise exception using errcode = '23514',
      message = 'advisor_fk_index_hardening_incomplete';
  end if;
end;
$$;

commit;
