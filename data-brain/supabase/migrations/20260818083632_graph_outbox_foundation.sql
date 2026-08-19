-- Durable Microsoft Graph outbox and one-shot cold authorization.
-- All outbound switches are inserted OFF. This migration sends no email.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- Fail before DDL when the established mailbox/campaign authority is partial.
do $$
declare
  v_missing text;
begin
  select pg_catalog.string_agg(required_table, ', ' order by required_table)
  into v_missing
  from pg_catalog.unnest(array[
    'campaigns', 'campaign_contacts', 'campaign_executions',
    'campaign_suppressions', 'campaign_unsubscribe_tokens',
    'mailbox_throttle_state', 'mailbox_delivery_reservations'
  ]) as required(required_table)
  where pg_catalog.to_regclass('public.' || required_table) is null;

  if v_missing is not null then
    raise exception using errcode = '55000',
      message = 'graph_outbox_precheck_missing_tables', detail = v_missing;
  end if;

  if pg_catalog.to_regprocedure(
    'public.reserve_cold_mailbox_delivery(text,text,text,text)'
  ) is null then
    raise exception using errcode = '55000',
      message = 'graph_outbox_precheck_missing_cold_reservation_rpc';
  end if;

  if exists (
    select 1 from public.mailbox_delivery_reservations
    where lane = 'cold' and (submission_id is not null or resource is not null)
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_precheck_invalid_cold_claim';
  end if;
end;
$$;

create table public.outbound_delivery_control (
  singleton boolean primary key default true check (singleton),
  master_enabled boolean not null default false,
  transactional_enabled boolean not null default false,
  cold_enabled boolean not null default false,
  minimum_spacing_seconds integer not null default 60
    check (minimum_spacing_seconds >= 60),
  cold_daily_limit integer not null default 480
    check (cold_daily_limit between 1 and 480),
  operating_timezone text not null default 'Europe/Madrid'
    check (operating_timezone = 'Europe/Madrid'),
  halt_reason text,
  updated_by_hash text
    check (updated_by_hash is null or updated_by_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

insert into public.outbound_delivery_control (
  singleton, master_enabled, transactional_enabled, cold_enabled, halt_reason
) values (true, false, false, false, 'MIGRATION_DEFAULT_OFF');

create table public.outbound_daily_usage (
  mailbox_key_hash text not null check (mailbox_key_hash ~ '^[a-f0-9]{64}$'),
  local_day date not null,
  lane text not null check (lane in ('transactional', 'cold')),
  reservation_count integer not null default 0
    check (
      (lane = 'cold' and reservation_count between 0 and 480) or
      (lane = 'transactional' and reservation_count >= 0)
    ),
  send_submitted_count integer not null default 0
    check (
      (lane = 'cold' and send_submitted_count between 0 and 480) or
      (lane = 'transactional' and send_submitted_count >= 0)
    ),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (mailbox_key_hash, local_day, lane)
);

create table public.graph_outbox (
  reservation_id uuid primary key,
  mailbox_key_hash text not null,
  lane text not null check (lane in ('transactional', 'cold')),
  campaign_id uuid references public.campaigns(id) on delete restrict,
  campaign_contact_id uuid references public.campaign_contacts(id) on delete restrict,
  campaign_execution_id uuid references public.campaign_executions(id) on delete restrict,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  opaque_marker text collate "C" not null check (
    pg_catalog.length(opaque_marker) between 32 and 128 and
    opaque_marker ~ '^[A-Za-z0-9_-]+$'
  ),
  state text not null default 'reserved' check (state in (
    'reserved', 'draft_creating', 'draft_created', 'send_submitted',
    'confirmed_sent', 'definitive_failed', 'ambiguous_halted',
    'suppressed_before_send'
  )),
  graph_draft_immutable_id text collate "C",
  graph_change_key_hash text check (
    graph_change_key_hash is null or graph_change_key_hash ~ '^[a-f0-9]{64}$'
  ),
  internet_message_id_hash text check (
    internet_message_id_hash is null or internet_message_id_hash ~ '^[a-f0-9]{64}$'
  ),
  sent_items_evidence_hash text check (
    sent_items_evidence_hash is null or sent_items_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  terminal_evidence_hash text check (
    terminal_evidence_hash is null or terminal_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  failure_code text check (
    failure_code is null or failure_code ~ '^[A-Z0-9_:-]{2,64}$'
  ),
  quota_reservation_day date not null,
  quota_send_day date,
  draft_started_at timestamptz,
  draft_created_at timestamptz,
  send_submitted_at timestamptz,
  confirmed_sent_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint graph_outbox_reservation_mailbox_fk
    foreign key (mailbox_key_hash, reservation_id)
    references public.mailbox_delivery_reservations(mailbox_key_hash, id)
    on delete restrict,
  constraint graph_outbox_marker_unique unique (opaque_marker),
  constraint graph_outbox_lane_binding_check check (
    (lane = 'transactional' and campaign_id is null and
      campaign_contact_id is null and campaign_execution_id is null) or
    (lane = 'cold' and campaign_id is not null and
      campaign_contact_id is not null and campaign_execution_id is not null)
  ),
  constraint graph_outbox_draft_id_presence_check check (
    state not in ('draft_created', 'send_submitted', 'confirmed_sent') or
    (graph_draft_immutable_id is not null and
      pg_catalog.length(graph_draft_immutable_id) between 1 and 1024)
  ),
  constraint graph_outbox_confirmed_evidence_check check (
    state <> 'confirmed_sent' or (
      internet_message_id_hash is not null and sent_items_evidence_hash is not null and
      confirmed_sent_at is not null and terminal_at is not null
    )
  ),
  constraint graph_outbox_terminal_failure_check check (
    state not in ('definitive_failed', 'ambiguous_halted', 'suppressed_before_send') or
    (failure_code is not null and terminal_evidence_hash is not null and terminal_at is not null)
  )
);

-- Graph immutable ids are case-sensitive. C collation makes that contract explicit.
create unique index graph_outbox_mailbox_draft_immutable_idx
  on public.graph_outbox (mailbox_key_hash, graph_draft_immutable_id collate "C")
  where graph_draft_immutable_id is not null;
create index graph_outbox_state_created_idx
  on public.graph_outbox (state, created_at);
create index graph_outbox_campaign_contact_idx
  on public.graph_outbox (campaign_contact_id, created_at desc)
  where campaign_contact_id is not null;
create index graph_outbox_campaign_execution_idx
  on public.graph_outbox (campaign_execution_id)
  where campaign_execution_id is not null;
create index graph_outbox_campaign_id_idx
  on public.graph_outbox (campaign_id) where campaign_id is not null;

create table public.graph_outbox_authorizations (
  reservation_id uuid primary key
    references public.graph_outbox(reservation_id) on delete cascade,
  send_capability_hash text not null unique
    check (send_capability_hash ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  second_stop_checked_at timestamptz,
  stop_snapshot_hash text check (
    stop_snapshot_hash is null or stop_snapshot_hash ~ '^[a-f0-9]{64}$'
  ),
  check (expires_at > issued_at),
  check (
    (consumed_at is null and second_stop_checked_at is null and
      stop_snapshot_hash is null) or
    (consumed_at is not null and second_stop_checked_at is not null and
      stop_snapshot_hash is not null)
  )
);

create index graph_outbox_authorizations_expiry_idx
  on public.graph_outbox_authorizations (expires_at) where consumed_at is null;

create table public.graph_outbox_events (
  id bigint generated always as identity primary key,
  reservation_id uuid not null
    references public.graph_outbox(reservation_id) on delete cascade,
  state text not null,
  source_event_key text not null unique,
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  evidence_hash text check (
    evidence_hash is null or evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  metadata jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(metadata) = 'object'),
  constraint graph_outbox_events_metadata_no_pii check (not (metadata ?| array[
    'email', 'email_address', 'name', 'first_name', 'last_name', 'phone',
    'company', 'company_name', 'subject', 'body', 'message', 'address', 'ip'
  ]))
);

create index graph_outbox_events_reservation_time_idx
  on public.graph_outbox_events (reservation_id, occurred_at desc);

-- Safe advisor remediations: Postgres does not index FK columns automatically.
create index if not exists campaign_suppressions_source_campaign_idx
  on public.campaign_suppressions (source_campaign_id)
  where source_campaign_id is not null;
create index if not exists campaign_suppressions_source_contact_idx
  on public.campaign_suppressions (source_contact_id)
  where source_contact_id is not null;
create index if not exists campaign_unsubscribe_tokens_campaign_idx
  on public.campaign_unsubscribe_tokens (campaign_id);
create index if not exists mailbox_reservations_submission_idx
  on public.mailbox_delivery_reservations (submission_id)
  where submission_id is not null;

create or replace function public.enforce_graph_outbox_transition()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if row(
    new.reservation_id, new.mailbox_key_hash, new.lane, new.campaign_id,
    new.campaign_contact_id, new.campaign_execution_id, new.payload_sha256,
    new.opaque_marker, new.quota_reservation_day, new.created_at
  ) is distinct from row(
    old.reservation_id, old.mailbox_key_hash, old.lane, old.campaign_id,
    old.campaign_contact_id, old.campaign_execution_id, old.payload_sha256,
    old.opaque_marker, old.quota_reservation_day, old.created_at
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_immutable_field_changed';
  end if;

  if old.graph_draft_immutable_id is not null and
     new.graph_draft_immutable_id is distinct from old.graph_draft_immutable_id then
    raise exception using errcode = '23514',
      message = 'graph_outbox_draft_id_changed';
  end if;

  if old.state <> new.state and not (
    (old.state = 'reserved' and new.state in (
      'draft_creating', 'definitive_failed', 'ambiguous_halted',
      'suppressed_before_send'
    )) or
    (old.state = 'draft_creating' and new.state in (
      'draft_created', 'definitive_failed', 'ambiguous_halted',
      'suppressed_before_send'
    )) or
    (old.state = 'draft_created' and new.state in (
      'send_submitted', 'definitive_failed', 'ambiguous_halted',
      'suppressed_before_send'
    )) or
    (old.state = 'send_submitted' and new.state in (
      'confirmed_sent', 'definitive_failed', 'ambiguous_halted'
    )) or
    (old.state = 'ambiguous_halted' and new.state in (
      'confirmed_sent', 'definitive_failed'
    ))
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_invalid_state_transition';
  end if;

  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger graph_outbox_enforce_transition
before update on public.graph_outbox
for each row execute function public.enforce_graph_outbox_transition();

create or replace function public.record_graph_outbox_state_event()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    insert into public.graph_outbox_events (
      reservation_id, state, source_event_key, evidence_hash, metadata
    ) values (
      new.reservation_id,
      new.state,
      'graph-outbox:' || new.reservation_id::text || ':' || new.state,
      case
        when new.state = 'confirmed_sent' then new.sent_items_evidence_hash
        when new.state in (
          'definitive_failed', 'ambiguous_halted', 'suppressed_before_send'
        ) then new.terminal_evidence_hash
        else null
      end,
      pg_catalog.jsonb_build_object('lane', new.lane)
    ) on conflict (source_event_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger graph_outbox_record_state_event
after insert or update of state on public.graph_outbox
for each row execute function public.record_graph_outbox_state_event();

-- The historical registry only represented unsubscribe/all. Widen it so a
-- permanent bounce suppresses marketing globally while transactional mail stays legal.
alter table public.campaign_suppressions
  drop constraint if exists campaign_suppressions_scope_check;
alter table public.campaign_suppressions
  drop constraint if exists campaign_suppressions_reason_check;
alter table public.campaign_suppressions
  add constraint campaign_suppressions_scope_reason_check check (
    (scope = 'all' and reason = 'unsubscribe') or
    (scope = 'marketing' and reason = 'hard_bounce')
  ) not valid;
alter table public.campaign_suppressions
  validate constraint campaign_suppressions_scope_reason_check;

create or replace function public.enforce_campaign_suppression_on_contact()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_suppression public.campaign_suppressions%rowtype;
begin
  select * into v_suppression
  from public.campaign_suppressions
  where identity_hash = new.email_hash;

  if not found then
    return new;
  end if;

  new.cold_sequence_status := 'stopped';
  new.intent_sequence_status := 'stopped';
  new.marketing_lane := 'none';
  new.suppression_scope := v_suppression.scope;
  new.sequence_status := 'stopped';
  new.next_delivery_status := 'stopped';
  new.next_scheduled_at := null;
  new.locked_at := null;
  new.lock_token := null;
  new.lock_expires_at := null;
  new.stopped_at := coalesce(new.stopped_at, v_suppression.occurred_at);
  new.stopped_reason := coalesce(new.stopped_reason, v_suppression.reason);
  new.suppressed_at := coalesce(new.suppressed_at, v_suppression.occurred_at);
  new.suppression_reason := coalesce(
    new.suppression_reason, v_suppression.reason
  );
  return new;
end;
$$;

create or replace function public.apply_campaign_hard_bounce_suppression(
  p_identity_hash text,
  p_occurred_at timestamptz,
  p_source_event_id text default null,
  p_source_campaign_id uuid default null,
  p_source_contact_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_suppression public.campaign_suppressions%rowtype;
  v_contacts integer;
begin
  if p_identity_hash is null or
     p_identity_hash !~ '^[A-Za-z0-9_:-]{16,160}$' or
     p_occurred_at is null or
     (p_source_event_id is not null and
       p_source_event_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$') then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  insert into public.campaign_suppressions (
    identity_hash, scope, reason, occurred_at, source_event_id,
    source_campaign_id, source_contact_id
  ) values (
    p_identity_hash, 'marketing', 'hard_bounce', p_occurred_at,
    p_source_event_id, p_source_campaign_id, p_source_contact_id
  ) on conflict (identity_hash) do update set
    scope = case when campaign_suppressions.scope = 'all'
      then 'all' else 'marketing' end,
    reason = case when campaign_suppressions.scope = 'all'
      then 'unsubscribe' else 'hard_bounce' end,
    occurred_at = least(
      campaign_suppressions.occurred_at, excluded.occurred_at
    ),
    source_event_id = coalesce(
      campaign_suppressions.source_event_id, excluded.source_event_id
    ),
    source_campaign_id = coalesce(
      campaign_suppressions.source_campaign_id, excluded.source_campaign_id
    ),
    source_contact_id = coalesce(
      campaign_suppressions.source_contact_id, excluded.source_contact_id
    ),
    updated_at = pg_catalog.clock_timestamp()
  returning * into v_suppression;

  -- Lock every representation of the identity before propagating the stop.
  perform 1 from public.campaign_contacts
  where email_hash = p_identity_hash
  order by id for update;

  update public.campaign_contacts
  set cold_sequence_status = 'stopped',
      intent_sequence_status = 'stopped',
      marketing_lane = 'none',
      suppression_scope = v_suppression.scope,
      sequence_status = 'stopped',
      next_delivery_status = 'stopped',
      next_scheduled_at = null,
      locked_at = null,
      lock_token = null,
      lock_expires_at = null,
      stopped_at = coalesce(stopped_at, p_occurred_at),
      stopped_reason = coalesce(stopped_reason, v_suppression.reason),
      suppressed_at = coalesce(suppressed_at, p_occurred_at),
      suppression_reason = coalesce(
        suppression_reason, v_suppression.reason
      )
  where email_hash = p_identity_hash;
  get diagnostics v_contacts = row_count;

  update public.campaign_executions
  set status = 'stopped',
      stopped_at = coalesce(stopped_at, p_occurred_at),
      stop_reason = coalesce(stop_reason, v_suppression.reason)
  where status = 'planned'
    and campaign_contact_id in (
      select id from public.campaign_contacts where email_hash = p_identity_hash
    );

  return pg_catalog.jsonb_build_object(
    'accepted', true,
    'duplicate', v_suppression.occurred_at < p_occurred_at,
    'reason_code', v_suppression.reason,
    'scope', v_suppression.scope,
    'contacts_stopped', v_contacts
  );
end;
$$;

create or replace function public.register_transactional_graph_outbox(
  p_reservation_id uuid,
  p_finalize_capability_hash text,
  p_payload_sha256 text,
  p_send_capability_hash text,
  p_opaque_marker text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_control public.outbound_delivery_control%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_existing public.graph_outbox%rowtype;
  v_today date;
begin
  if p_reservation_id is null or
     p_finalize_capability_hash is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' or
     p_send_capability_hash is null or
     p_send_capability_hash !~ '^[a-f0-9]{64}$' or
     p_opaque_marker is null or
     pg_catalog.length(p_opaque_marker) not between 32 and 128 or
     p_opaque_marker !~ '^[A-Za-z0-9_-]+$' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  if not found or not v_control.master_enabled or
     not v_control.transactional_enabled then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'master_or_lane_disabled'
    );
  end if;
  v_today := (v_now at time zone v_control.operating_timezone)::date;

  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id and lane = 'transactional' for update;
  if not found or v_reservation.status <> 'reserved' or
     v_reservation.finalize_capability_hash <> p_finalize_capability_hash or
     v_reservation.payload_sha256 <> p_payload_sha256 then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'reservation_unavailable'
    );
  end if;

  select * into v_existing from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if found then
    if v_existing.payload_sha256 = p_payload_sha256 and
       v_existing.opaque_marker = p_opaque_marker then
      return pg_catalog.jsonb_build_object(
        'authorized', true, 'duplicate', true, 'reason_code', v_existing.state,
        'reservation_id', v_existing.reservation_id
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'reservation_collision'
    );
  end if;

  insert into public.graph_outbox (
    reservation_id, mailbox_key_hash, lane, payload_sha256, opaque_marker,
    quota_reservation_day
  ) values (
    v_reservation.id, v_reservation.mailbox_key_hash, 'transactional',
    p_payload_sha256, p_opaque_marker, v_today
  );

  insert into public.graph_outbox_authorizations (
    reservation_id, send_capability_hash, issued_at, expires_at
  ) values (
    v_reservation.id, p_send_capability_hash, v_now, v_now + interval '20 minutes'
  );

  return pg_catalog.jsonb_build_object(
    'authorized', true, 'duplicate', false, 'reason_code', 'reserved',
    'reservation_id', v_reservation.id,
    'authorization_expires_at', v_now + interval '20 minutes'
  );
end;
$$;

create or replace function public.reserve_cold_graph_delivery(
  p_campaign_external_id text,
  p_contact_id text,
  p_execution_key text,
  p_mailbox_key_hash text,
  p_message_key_hash text,
  p_payload_sha256 text,
  p_finalize_capability_hash text,
  p_send_capability_hash text,
  p_opaque_marker text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today date;
  v_control public.outbound_delivery_control%rowtype;
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_state public.mailbox_throttle_state%rowtype;
  v_active public.mailbox_delivery_reservations%rowtype;
  v_existing_reservation public.mailbox_delivery_reservations%rowtype;
  v_existing_outbox public.graph_outbox%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_usage public.outbound_daily_usage%rowtype;
  v_position smallint;
begin
  if p_campaign_external_id is null or
     p_campaign_external_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_contact_id is null or
     p_contact_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_execution_key is null or
     p_execution_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' or
     p_mailbox_key_hash is null or p_mailbox_key_hash !~ '^[a-f0-9]{64}$' or
     p_message_key_hash is null or p_message_key_hash !~ '^[a-f0-9]{64}$' or
     p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' or
     p_finalize_capability_hash is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_send_capability_hash is null or
     p_send_capability_hash !~ '^[a-f0-9]{64}$' or
     p_opaque_marker is null or
     pg_catalog.length(p_opaque_marker) not between 32 and 128 or
     p_opaque_marker !~ '^[A-Za-z0-9_-]+$' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  if not found or not v_control.master_enabled or not v_control.cold_enabled then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'master_or_lane_disabled'
    );
  end if;
  v_today := (v_now at time zone v_control.operating_timezone)::date;

  select * into v_campaign from public.campaigns
  where external_id = p_campaign_external_id for update;
  if not found or not v_campaign.is_active or
     v_campaign.status not in ('active', 'running', 'pilot') then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'campaign_inactive'
    );
  end if;

  select * into v_contact from public.campaign_contacts
  where campaign_id = v_campaign.id and external_contact_id = p_contact_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'contact_unavailable'
    );
  end if;

  if exists (
    select 1 from public.campaign_suppressions
    where identity_hash = v_contact.email_hash
  ) or v_contact.suppression_scope <> 'none' or
     v_contact.marketing_lane <> 'cold' or
     v_contact.cold_sequence_status not in ('pending', 'active') then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'suppressed'
    );
  end if;

  select * into v_execution from public.campaign_executions
  where campaign_id = v_campaign.id and campaign_contact_id = v_contact.id
    and idempotency_key = p_execution_key for update;
  if not found or v_execution.status <> 'planned' or
     v_execution.channel <> 'email' or
     v_execution.action_name <> 'delivery_scheduled' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'execution_unavailable'
    );
  end if;

  insert into public.mailbox_throttle_state (mailbox_key_hash, next_allowed_at)
  values (p_mailbox_key_hash, v_now) on conflict (mailbox_key_hash) do nothing;
  select * into v_state from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash for update;

  if v_state.blocked_reservation_id is not null then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'ambiguous_halted'
    );
  end if;

  select * into v_existing_reservation from public.mailbox_delivery_reservations
  where mailbox_key_hash = p_mailbox_key_hash
    and message_key_hash = p_message_key_hash for update;
  if found then
    select * into v_existing_outbox from public.graph_outbox
    where reservation_id = v_existing_reservation.id;
    if found and v_existing_outbox.campaign_execution_id = v_execution.id and
       v_existing_outbox.payload_sha256 = p_payload_sha256 and
       v_existing_outbox.opaque_marker = p_opaque_marker then
      return pg_catalog.jsonb_build_object(
        'authorized', true, 'duplicate', true,
        'reason_code', v_existing_outbox.state,
        'reservation_id', v_existing_outbox.reservation_id
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'message_key_collision'
    );
  end if;

  if v_state.active_reservation_id is not null then
    select * into v_active from public.mailbox_delivery_reservations
    where id = v_state.active_reservation_id for update;
    if not found or v_active.status <> 'reserved' then
      return pg_catalog.jsonb_build_object(
        'authorized', false, 'duplicate', false, 'reason_code', 'mailbox_state_invalid'
      );
    end if;
    if v_active.lease_expires_at <= v_now then
      update public.graph_outbox
      set state = 'ambiguous_halted', failure_code = 'LEASE_EXPIRED',
          terminal_evidence_hash = v_active.payload_sha256, terminal_at = v_now
      where reservation_id = v_active.id
        and state in ('reserved', 'draft_creating', 'draft_created', 'send_submitted');
      update public.mailbox_delivery_reservations
      set status = 'reconcile_required', finalized_at = v_now,
          failure_code = 'LEASE_EXPIRED', updated_at = v_now
      where id = v_active.id;
      update public.mailbox_throttle_state
      set active_reservation_id = null, blocked_reservation_id = v_active.id,
          next_allowed_at = greatest(
            next_allowed_at, v_now + interval '120 seconds'
          ), updated_at = v_now
      where mailbox_key_hash = p_mailbox_key_hash;
      return pg_catalog.jsonb_build_object(
        'authorized', false, 'duplicate', false,
        'reason_code', 'lease_expired_ambiguous_halted'
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'lease_active',
      'lease_expires_at', v_active.lease_expires_at
    );
  end if;

  if v_state.next_allowed_at > v_now then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'cooldown',
      'next_allowed_at', v_state.next_allowed_at,
      'retry_after_seconds', greatest(
        1, pg_catalog.ceil(extract(epoch from
          (v_state.next_allowed_at - v_now)))
      )::integer
    );
  end if;

  insert into public.outbound_daily_usage (
    mailbox_key_hash, local_day, lane, reservation_count
  ) values (p_mailbox_key_hash, v_today, 'cold', 0)
  on conflict (mailbox_key_hash, local_day, lane) do nothing;
  select * into v_usage from public.outbound_daily_usage
  where mailbox_key_hash = p_mailbox_key_hash and local_day = v_today
    and lane = 'cold' for update;
  if v_usage.reservation_count >= v_control.cold_daily_limit then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'daily_limit'
    );
  end if;

  v_position := v_state.batch_reservations_count + 1;
  if v_position not in (1, 2) then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'mailbox_state_invalid'
    );
  end if;

  insert into public.mailbox_delivery_reservations (
    mailbox_key_hash, message_key_hash, payload_sha256, submission_id, resource,
    lane, batch_id, batch_position, status, finalize_capability_hash,
    reserved_at, lease_expires_at
  ) values (
    p_mailbox_key_hash, p_message_key_hash, p_payload_sha256, null, null,
    'cold', v_state.batch_id, v_position, 'reserved', p_finalize_capability_hash,
    v_now, v_now + interval '30 minutes'
  ) returning * into v_reservation;

  insert into public.graph_outbox (
    reservation_id, mailbox_key_hash, lane, campaign_id, campaign_contact_id,
    campaign_execution_id, payload_sha256, opaque_marker, quota_reservation_day
  ) values (
    v_reservation.id, p_mailbox_key_hash, 'cold', v_campaign.id, v_contact.id,
    v_execution.id, p_payload_sha256, p_opaque_marker, v_today
  );
  insert into public.graph_outbox_authorizations (
    reservation_id, send_capability_hash, issued_at, expires_at
  ) values (
    v_reservation.id, p_send_capability_hash, v_now, v_now + interval '20 minutes'
  );

  update public.outbound_daily_usage
  set reservation_count = reservation_count + 1, updated_at = v_now
  where mailbox_key_hash = p_mailbox_key_hash and local_day = v_today
    and lane = 'cold';
  update public.mailbox_throttle_state
  set active_reservation_id = v_reservation.id,
      batch_reservations_count = v_position,
      next_allowed_at = greatest(
        next_allowed_at,
        v_now + pg_catalog.make_interval(
          secs => v_control.minimum_spacing_seconds
        )
      ),
      updated_at = v_now
  where mailbox_key_hash = p_mailbox_key_hash;

  return pg_catalog.jsonb_build_object(
    'authorized', true, 'duplicate', false, 'reason_code', 'reserved',
    'reservation_id', v_reservation.id,
    'lease_expires_at', v_reservation.lease_expires_at,
    'authorization_expires_at', v_now + interval '20 minutes',
    'next_allowed_at', greatest(
      v_state.next_allowed_at,
      v_now + pg_catalog.make_interval(secs => v_control.minimum_spacing_seconds)
    ),
    'batch_position', v_position
  );
end;
$$;

create or replace function public.begin_graph_draft_creation(
  p_reservation_id uuid,
  p_finalize_capability_hash text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_outbox public.graph_outbox%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_reservation_id is null or p_finalize_capability_hash is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'outbox_unavailable'
    );
  end if;
  if not v_control.master_enabled or
     (v_outbox.lane = 'cold' and not v_control.cold_enabled) or
     (v_outbox.lane = 'transactional' and not v_control.transactional_enabled) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'master_or_lane_disabled'
    );
  end if;

  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id
    and finalize_capability_hash = p_finalize_capability_hash for update;
  if not found or v_reservation.status <> 'reserved' or
     v_reservation.lease_expires_at <= v_now then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'reservation_unavailable'
    );
  end if;

  if v_outbox.state = 'draft_creating' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', true, 'reason_code', 'draft_recovery_required',
      'reservation_id', p_reservation_id, 'opaque_marker', v_outbox.opaque_marker
    );
  end if;
  if v_outbox.state <> 'reserved' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;

  update public.graph_outbox
  set state = 'draft_creating', draft_started_at = v_now
  where reservation_id = p_reservation_id;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', 'draft_creating',
    'reservation_id', p_reservation_id, 'opaque_marker', v_outbox.opaque_marker,
    'payload_sha256', v_outbox.payload_sha256
  );
end;
$$;

create or replace function public.bind_graph_draft_immutable_id(
  p_reservation_id uuid,
  p_finalize_capability_hash text,
  p_graph_draft_immutable_id text,
  p_graph_change_key_hash text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_outbox public.graph_outbox%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_reservation_id is null or p_finalize_capability_hash is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_graph_draft_immutable_id is null or
     pg_catalog.length(p_graph_draft_immutable_id) not between 1 and 1024 or
     p_graph_change_key_hash is null or
     p_graph_change_key_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'outbox_unavailable'
    );
  end if;
  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id
    and finalize_capability_hash = p_finalize_capability_hash for update;
  if not found or v_reservation.status <> 'reserved' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'reservation_unavailable'
    );
  end if;

  if v_outbox.state = 'draft_created' and
     v_outbox.graph_draft_immutable_id = p_graph_draft_immutable_id collate "C" and
     v_outbox.graph_change_key_hash = p_graph_change_key_hash then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', true, 'reason_code', 'draft_created',
      'reservation_id', p_reservation_id
    );
  end if;
  if v_outbox.state <> 'draft_creating' or
     v_outbox.graph_draft_immutable_id is not null then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;

  update public.graph_outbox
  set state = 'draft_created',
      graph_draft_immutable_id = p_graph_draft_immutable_id,
      graph_change_key_hash = p_graph_change_key_hash,
      draft_created_at = v_now
  where reservation_id = p_reservation_id;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', 'draft_created',
    'reservation_id', p_reservation_id
  );
exception
  when unique_violation then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false,
      'reason_code', 'graph_draft_id_collision'
    );
end;
$$;

create or replace function public.authorize_graph_draft_send(
  p_reservation_id uuid,
  p_send_capability_hash text,
  p_stop_snapshot_hash text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today date;
  v_control public.outbound_delivery_control%rowtype;
  v_outbox public.graph_outbox%rowtype;
  v_authorization public.graph_outbox_authorizations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_campaign public.campaigns%rowtype;
  v_contact public.campaign_contacts%rowtype;
  v_execution public.campaign_executions%rowtype;
  v_usage public.outbound_daily_usage%rowtype;
begin
  if p_reservation_id is null or p_send_capability_hash is null or
     p_send_capability_hash !~ '^[a-f0-9]{64}$' or
     p_stop_snapshot_hash is null or p_stop_snapshot_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'outbox_unavailable'
    );
  end if;
  if not v_control.master_enabled or
     (v_outbox.lane = 'cold' and not v_control.cold_enabled) or
     (v_outbox.lane = 'transactional' and not v_control.transactional_enabled) then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'master_or_lane_disabled'
    );
  end if;
  if v_outbox.state = 'send_submitted' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', true, 'reason_code', 'replay_blocked'
    );
  end if;
  if v_outbox.state <> 'draft_created' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;

  select * into v_authorization from public.graph_outbox_authorizations
  where reservation_id = p_reservation_id
    and send_capability_hash = p_send_capability_hash for update;
  if not found or v_authorization.consumed_at is not null or
     v_authorization.expires_at <= v_now then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', 'authorization_unavailable'
    );
  end if;

  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id for update;
  if not found or v_reservation.status <> 'reserved' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'reservation_unavailable'
    );
  end if;
  if v_reservation.lease_expires_at <= v_now then
    update public.graph_outbox
    set state = 'ambiguous_halted', failure_code = 'LEASE_EXPIRED',
        terminal_evidence_hash = p_stop_snapshot_hash, terminal_at = v_now
    where reservation_id = p_reservation_id;
    update public.mailbox_delivery_reservations
    set status = 'reconcile_required', finalized_at = v_now,
        failure_code = 'LEASE_EXPIRED', updated_at = v_now
    where id = p_reservation_id;
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        blocked_reservation_id = p_reservation_id,
        next_allowed_at = greatest(
          next_allowed_at, v_now + interval '120 seconds'
        ), updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', 'lease_expired_ambiguous_halted'
    );
  end if;

  if v_outbox.lane = 'cold' then
    select * into v_campaign from public.campaigns
    where id = v_outbox.campaign_id for update;
    select * into v_contact from public.campaign_contacts
    where id = v_outbox.campaign_contact_id for update;
    select * into v_execution from public.campaign_executions
    where id = v_outbox.campaign_execution_id for update;

    if not found or not v_campaign.is_active or
       v_campaign.status not in ('active', 'running', 'pilot') or
       v_execution.status <> 'planned' or v_execution.channel <> 'email' or
       v_execution.action_name <> 'delivery_scheduled' or
       exists (
         select 1 from public.campaign_suppressions
         where identity_hash = v_contact.email_hash
       ) or v_contact.suppression_scope <> 'none' or
       v_contact.marketing_lane <> 'cold' or
       v_contact.cold_sequence_status not in ('pending', 'active') then
      update public.graph_outbox
      set state = 'suppressed_before_send', failure_code = 'DEFINITIVE_SUPPRESSED',
          terminal_evidence_hash = p_stop_snapshot_hash, terminal_at = v_now
      where reservation_id = p_reservation_id;
      update public.graph_outbox_authorizations
      set consumed_at = v_now, second_stop_checked_at = v_now,
          stop_snapshot_hash = p_stop_snapshot_hash
      where reservation_id = p_reservation_id;
      update public.mailbox_delivery_reservations
      set status = 'failed', finalized_at = v_now,
          failure_code = 'DEFINITIVE_SUPPRESSED', updated_at = v_now
      where id = p_reservation_id;
      update public.campaign_executions
      set status = 'stopped', stopped_at = v_now,
          stop_reason = coalesce(stop_reason, 'suppressed_before_send')
      where id = v_outbox.campaign_execution_id and status = 'planned';
      update public.mailbox_throttle_state
      set active_reservation_id = null,
          batch_id = case when v_reservation.batch_position = 2
            then extensions.gen_random_uuid() else batch_id end,
          batch_reservations_count = case when v_reservation.batch_position = 2
            then 0 else batch_reservations_count end,
          next_allowed_at = greatest(
            next_allowed_at,
            v_now + case when v_reservation.batch_position = 2
              then interval '120 seconds' else interval '0 seconds' end
          ), updated_at = v_now
      where mailbox_key_hash = v_outbox.mailbox_key_hash;
      return pg_catalog.jsonb_build_object(
        'authorized', false, 'duplicate', false,
        'reason_code', 'suppressed_before_send'
      );
    end if;
  end if;

  v_today := (v_now at time zone v_control.operating_timezone)::date;
  insert into public.outbound_daily_usage (
    mailbox_key_hash, local_day, lane, send_submitted_count
  ) values (v_outbox.mailbox_key_hash, v_today, v_outbox.lane, 0)
  on conflict (mailbox_key_hash, local_day, lane) do nothing;
  select * into v_usage from public.outbound_daily_usage
  where mailbox_key_hash = v_outbox.mailbox_key_hash
    and local_day = v_today and lane = v_outbox.lane for update;
  if v_outbox.lane = 'cold' and
     v_usage.send_submitted_count >= v_control.cold_daily_limit then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'daily_limit'
    );
  end if;

  update public.graph_outbox_authorizations
  set consumed_at = v_now, second_stop_checked_at = v_now,
      stop_snapshot_hash = p_stop_snapshot_hash
  where reservation_id = p_reservation_id;
  update public.graph_outbox
  set state = 'send_submitted', send_submitted_at = v_now,
      quota_send_day = v_today
  where reservation_id = p_reservation_id;
  update public.outbound_daily_usage
  set send_submitted_count = send_submitted_count + 1, updated_at = v_now
  where mailbox_key_hash = v_outbox.mailbox_key_hash
    and local_day = v_today and lane = v_outbox.lane;

  return pg_catalog.jsonb_build_object(
    'authorized', true, 'duplicate', false, 'reason_code', 'send_submitted',
    'reservation_id', p_reservation_id,
    'graph_draft_immutable_id', v_outbox.graph_draft_immutable_id,
    'opaque_marker', v_outbox.opaque_marker
  );
end;
$$;

create or replace function public.confirm_graph_sent_item(
  p_reservation_id uuid,
  p_finalize_capability_hash text,
  p_graph_draft_immutable_id text,
  p_internet_message_id_hash text,
  p_sent_items_evidence_hash text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_outbox public.graph_outbox%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
begin
  if p_reservation_id is null or p_finalize_capability_hash is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_graph_draft_immutable_id is null or
     pg_catalog.length(p_graph_draft_immutable_id) not between 1 and 1024 or
     p_internet_message_id_hash is null or
     p_internet_message_id_hash !~ '^[a-f0-9]{64}$' or
     p_sent_items_evidence_hash is null or
     p_sent_items_evidence_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'outbox_unavailable'
    );
  end if;
  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id
    and finalize_capability_hash = p_finalize_capability_hash for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_capability'
    );
  end if;

  if v_outbox.state = 'confirmed_sent' and
     v_outbox.graph_draft_immutable_id = p_graph_draft_immutable_id collate "C" and
     v_outbox.internet_message_id_hash = p_internet_message_id_hash and
     v_outbox.sent_items_evidence_hash = p_sent_items_evidence_hash then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', true, 'reason_code', 'confirmed_sent',
      'reservation_id', p_reservation_id
    );
  end if;
  if v_outbox.state not in ('send_submitted', 'ambiguous_halted') or
     v_reservation.status not in ('reserved', 'reconcile_required') or
     v_outbox.graph_draft_immutable_id <> p_graph_draft_immutable_id collate "C" then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_or_id_conflict'
    );
  end if;

  update public.graph_outbox
  set state = 'confirmed_sent',
      internet_message_id_hash = p_internet_message_id_hash,
      sent_items_evidence_hash = p_sent_items_evidence_hash,
      failure_code = null,
      terminal_evidence_hash = null,
      confirmed_sent_at = v_now,
      terminal_at = v_now
  where reservation_id = p_reservation_id;
  update public.mailbox_delivery_reservations
  set status = 'sent', finalized_at = v_now,
      provider_message_hash = p_internet_message_id_hash,
      failure_code = null, updated_at = v_now
  where id = p_reservation_id;

  if v_reservation.batch_position = 2 then
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        blocked_reservation_id = null,
        batch_id = extensions.gen_random_uuid(),
        batch_reservations_count = 0,
        next_allowed_at = greatest(
          next_allowed_at, v_now + interval '120 seconds'
        ), updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
  else
    update public.mailbox_throttle_state
    set active_reservation_id = null, blocked_reservation_id = null,
        updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
  end if;

  if v_outbox.lane = 'cold' then
    update public.campaign_executions
    set status = 'executed', actual_at = v_now
    where id = v_outbox.campaign_execution_id and status = 'planned';

    insert into public.campaign_events (
      campaign_id, campaign_contact_id, execution_id, source_event_id,
      event_name, occurred_at, channel, capture_method, metric_quality,
      context, properties
    ) values (
      v_outbox.campaign_id,
      v_outbox.campaign_contact_id,
      v_outbox.campaign_execution_id,
      'graph-confirmed:' || p_reservation_id::text,
      'delivery_sent', v_now, 'email', 'automation', 'confirmed',
      pg_catalog.jsonb_build_object('source', 'graph_sent_items'),
      pg_catalog.jsonb_build_object(
        'provider_message_hash', p_internet_message_id_hash,
        'evidence_hash', p_sent_items_evidence_hash
      )
    ) on conflict (campaign_id, source_event_id)
      where source_event_id is not null do nothing;
  end if;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', 'confirmed_sent',
    'reservation_id', p_reservation_id, 'mailbox_halted', false
  );
end;
$$;

create or replace function public.finalize_graph_delivery_failure(
  p_reservation_id uuid,
  p_finalize_capability_hash text,
  p_outcome text,
  p_failure_code text,
  p_evidence_hash text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_outbox public.graph_outbox%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_target_reservation_status text;
begin
  if p_reservation_id is null or p_finalize_capability_hash is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_outcome is null or p_outcome not in ('definitive_failed', 'ambiguous_halted') or
     p_failure_code is null or p_failure_code !~ '^[A-Z0-9_:-]{2,64}$' or
     p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$' or
     (p_outcome = 'definitive_failed' and (
       p_failure_code !~ '^DEFINITIVE_[A-Z0-9_:-]{2,53}$' or
       p_failure_code ~ '(TIMEOUT|429|AMBIGUOUS|UNKNOWN|RATE_LIMIT|LEASE_EXPIRED)'
     )) or
     (p_outcome = 'ambiguous_halted' and
       p_failure_code !~ '(TIMEOUT|429|AMBIGUOUS|UNKNOWN|RATE_LIMIT|LEASE_EXPIRED)') then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;

  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'outbox_unavailable'
    );
  end if;
  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id
    and finalize_capability_hash = p_finalize_capability_hash for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_capability'
    );
  end if;

  if v_outbox.state = p_outcome and v_outbox.failure_code = p_failure_code and
     v_outbox.terminal_evidence_hash = p_evidence_hash then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', true, 'reason_code', p_outcome,
      'reservation_id', p_reservation_id,
      'mailbox_halted', p_outcome = 'ambiguous_halted'
    );
  end if;
  if not (
    (v_outbox.state in (
    'reserved', 'draft_creating', 'draft_created', 'send_submitted'
    ) and v_reservation.status = 'reserved') or
    (v_outbox.state = 'ambiguous_halted' and
      p_outcome = 'definitive_failed' and
      v_reservation.status = 'reconcile_required')
  ) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;

  update public.graph_outbox
  set state = p_outcome, failure_code = p_failure_code,
      terminal_evidence_hash = p_evidence_hash, terminal_at = v_now
  where reservation_id = p_reservation_id;

  v_target_reservation_status := case p_outcome
    when 'definitive_failed' then 'failed' else 'reconcile_required' end;
  update public.mailbox_delivery_reservations
  set status = v_target_reservation_status,
      finalized_at = v_now, provider_message_hash = null,
      failure_code = p_failure_code, updated_at = v_now
  where id = p_reservation_id;

  if p_outcome = 'ambiguous_halted' then
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        blocked_reservation_id = p_reservation_id,
        next_allowed_at = greatest(
          next_allowed_at, v_now + interval '120 seconds'
        ), updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
  elsif v_reservation.batch_position = 2 then
    update public.mailbox_throttle_state
    set active_reservation_id = null,
        blocked_reservation_id = null,
        batch_id = extensions.gen_random_uuid(),
        batch_reservations_count = 0,
        next_allowed_at = greatest(
          next_allowed_at, v_now + interval '120 seconds'
        ), updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
  else
    update public.mailbox_throttle_state
    set active_reservation_id = null, blocked_reservation_id = null,
        updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
  end if;

  if v_outbox.lane = 'cold' then
    update public.campaign_executions
    set status = case p_outcome
          when 'definitive_failed' then 'failed' else 'stopped' end,
        failed_at = case p_outcome
          when 'definitive_failed' then v_now else failed_at end,
        stopped_at = case p_outcome
          when 'ambiguous_halted' then v_now else stopped_at end,
        failure_code = case p_outcome
          when 'definitive_failed' then p_failure_code else failure_code end,
        stop_reason = case p_outcome
          when 'ambiguous_halted' then p_failure_code else stop_reason end
    where id = v_outbox.campaign_execution_id and status = 'planned';
  end if;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', p_outcome,
    'reservation_id', p_reservation_id,
    'mailbox_halted', p_outcome = 'ambiguous_halted'
  );
end;
$$;

-- Forward-safe rollback: this only disables capabilities. It never deletes
-- drafts, reservations, audit evidence, or migration history.
create or replace function public.emergency_halt_outbound_delivery(
  p_actor_hash text,
  p_reason text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or
     p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 3 and 240 then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason_code', 'invalid_request');
  end if;

  update public.outbound_delivery_control
  set master_enabled = false,
      transactional_enabled = false,
      cold_enabled = false,
      halt_reason = pg_catalog.btrim(p_reason),
      updated_by_hash = p_actor_hash,
      updated_at = v_now
  where singleton;

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'reason_code', 'halted', 'halted_at', v_now
  );
end;
$$;

-- Once a reservation is attached to Graph, only verified outbox terminal states
-- may finalize it. Legacy reservations keep their historical behavior.
create or replace function public.enforce_mailbox_terminal_transition()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_graph_state text;
begin
  if old.status <> 'reserved' or new.status not in ('sent', 'failed') then
    return new;
  end if;

  select state into v_graph_state from public.graph_outbox
  where reservation_id = old.id;
  if found then
    if (new.status = 'sent' and v_graph_state <> 'confirmed_sent') or
       (new.status = 'failed' and v_graph_state not in (
         'definitive_failed', 'suppressed_before_send'
       )) then
      raise exception using errcode = '23514',
        message = 'graph_outbox_terminal_evidence_required';
    end if;
    return new;
  end if;

  if old.lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '23514',
      message = 'lease_expired_requires_reconcile';
  end if;
  return new;
end;
$$;

alter table public.outbound_delivery_control enable row level security;
alter table public.outbound_delivery_control force row level security;
alter table public.outbound_daily_usage enable row level security;
alter table public.outbound_daily_usage force row level security;
alter table public.graph_outbox enable row level security;
alter table public.graph_outbox force row level security;
alter table public.graph_outbox_authorizations enable row level security;
alter table public.graph_outbox_authorizations force row level security;
alter table public.graph_outbox_events enable row level security;
alter table public.graph_outbox_events force row level security;

revoke all privileges on table public.outbound_delivery_control
  from public, anon, authenticated;
revoke all privileges on table public.outbound_daily_usage
  from public, anon, authenticated;
revoke all privileges on table public.graph_outbox
  from public, anon, authenticated;
revoke all privileges on table public.graph_outbox_authorizations
  from public, anon, authenticated;
revoke all privileges on table public.graph_outbox_events
  from public, anon, authenticated;
revoke all privileges on sequence public.graph_outbox_events_id_seq
  from public, anon, authenticated;

grant select, update on table public.outbound_delivery_control to service_role;
grant select, insert, update on table public.outbound_daily_usage to service_role;
grant select, insert, update on table public.graph_outbox to service_role;
grant select, insert, update on table public.graph_outbox_authorizations to service_role;
grant select, insert on table public.graph_outbox_events to service_role;
grant usage, select on sequence public.graph_outbox_events_id_seq to service_role;
grant select, insert, update on table public.campaign_suppressions to service_role;
grant select, update on table public.campaigns to service_role;
grant select, update on table public.campaign_contacts to service_role;
grant select, insert, update on table public.campaign_executions to service_role;
grant select, insert on table public.campaign_events to service_role;

-- Remove the bypassable cold lane. New cold sends must enter through the atomic
-- campaign + mailbox + quota + Graph reservation RPC above.
revoke execute on function public.reserve_cold_mailbox_delivery(text,text,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.finalize_cold_mailbox_delivery(text,text,text,text,text)
  from public, anon, authenticated, service_role;

alter default privileges in schema public
  revoke execute on functions from public;
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

revoke execute on function public.enforce_graph_outbox_transition()
  from public, anon, authenticated, service_role;
revoke execute on function public.record_graph_outbox_state_event()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_campaign_suppression_on_contact()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_mailbox_terminal_transition()
  from public, anon, authenticated, service_role;

revoke execute on function public.apply_campaign_hard_bounce_suppression(
  text,timestamptz,text,uuid,uuid
) from public, anon, authenticated;
revoke execute on function public.register_transactional_graph_outbox(
  uuid,text,text,text,text
) from public, anon, authenticated;
revoke execute on function public.reserve_cold_graph_delivery(
  text,text,text,text,text,text,text,text,text
) from public, anon, authenticated;
revoke execute on function public.begin_graph_draft_creation(uuid,text)
  from public, anon, authenticated;
revoke execute on function public.bind_graph_draft_immutable_id(uuid,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.authorize_graph_draft_send(uuid,text,text)
  from public, anon, authenticated;
revoke execute on function public.confirm_graph_sent_item(uuid,text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.finalize_graph_delivery_failure(uuid,text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.emergency_halt_outbound_delivery(text,text)
  from public, anon, authenticated;

grant execute on function public.apply_campaign_hard_bounce_suppression(
  text,timestamptz,text,uuid,uuid
) to service_role;
grant execute on function public.register_transactional_graph_outbox(
  uuid,text,text,text,text
) to service_role;
grant execute on function public.reserve_cold_graph_delivery(
  text,text,text,text,text,text,text,text,text
) to service_role;
grant execute on function public.begin_graph_draft_creation(uuid,text)
  to service_role;
grant execute on function public.bind_graph_draft_immutable_id(uuid,text,text,text)
  to service_role;
grant execute on function public.authorize_graph_draft_send(uuid,text,text)
  to service_role;
grant execute on function public.confirm_graph_sent_item(uuid,text,text,text,text)
  to service_role;
grant execute on function public.finalize_graph_delivery_failure(uuid,text,text,text,text)
  to service_role;
grant execute on function public.emergency_halt_outbound_delivery(text,text)
  to service_role;

-- Postcheck: migration success means OFF, private, indexed, invoker-only RPCs.
do $$
declare
  v_insecure_functions text;
begin
  if not exists (
    select 1 from public.outbound_delivery_control
    where singleton and not master_enabled and
      not transactional_enabled and not cold_enabled and
      minimum_spacing_seconds >= 60 and cold_daily_limit <= 480 and
      operating_timezone = 'Europe/Madrid'
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_postcheck_control_not_fail_closed';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'outbound_delivery_control', 'outbound_daily_usage', 'graph_outbox',
        'graph_outbox_authorizations', 'graph_outbox_events'
      ) and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then
    raise exception using errcode = '42501',
      message = 'graph_outbox_postcheck_rls_not_forced';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.graph_outbox', 'select') or
     pg_catalog.has_table_privilege('authenticated', 'public.graph_outbox', 'select') or
     pg_catalog.has_table_privilege(
       'anon', 'public.graph_outbox_authorizations', 'select'
     ) or pg_catalog.has_table_privilege(
       'authenticated', 'public.graph_outbox_authorizations', 'select'
     ) then
    raise exception using errcode = '42501',
      message = 'graph_outbox_postcheck_public_table_access';
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

  select pg_catalog.string_agg(p.proname, ', ' order by p.proname)
  into v_insecure_functions
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'apply_campaign_hard_bounce_suppression',
      'register_transactional_graph_outbox',
      'reserve_cold_graph_delivery',
      'begin_graph_draft_creation',
      'bind_graph_draft_immutable_id',
      'authorize_graph_draft_send',
      'confirm_graph_sent_item',
      'finalize_graph_delivery_failure',
      'emergency_halt_outbound_delivery',
      'enforce_graph_outbox_transition',
      'record_graph_outbox_state_event',
      'enforce_campaign_suppression_on_contact',
      'enforce_mailbox_terminal_transition'
    ) and (
      p.prosecdef or
      not coalesce(
        pg_catalog.array_to_string(p.proconfig, ','), ''
      ) like '%search_path=%'
    );
  if v_insecure_functions is not null then
    raise exception using errcode = '42501',
      message = 'graph_outbox_postcheck_insecure_functions',
      detail = v_insecure_functions;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'graph_outbox_mailbox_draft_immutable_idx'
      and indexdef like '%UNIQUE%'
  ) then
    raise exception using errcode = '23514',
      message = 'graph_outbox_postcheck_draft_unique_missing';
  end if;
end;
$$;

commit;

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.mailbox_throttle_state
  add column if not exists last_graph_send_authorized_at timestamptz;
alter table public.mailbox_delivery_reservations
  add column if not exists graph_managed boolean not null default false,
  add column if not exists transactional_dispatch_id uuid;
create table if not exists public.transactional_dispatch_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  submission_id text not null unique
    check (submission_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$'),
  resource text not null check (
    resource in ('calculator', 'interactive_checklist', 'checklist', 'webinar')
  ),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued_off' check (status in (
    'queued_off', 'claimed', 'reserved', 'confirmed_sent',
    'definitive_failed', 'ambiguous_halted', 'deferred'
  )),
  claimed_by uuid,
  claim_expires_at timestamptz,
  attempt integer not null default 0 check (attempt between 0 and 1000),
  reservation_id uuid,
  outcome_evidence_hash text check (
    outcome_evidence_hash is null or outcome_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  terminal_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (
    (status in ('claimed', 'reserved') and claimed_by is not null and
      claim_expires_at is not null) or status not in ('claimed', 'reserved')
  ),
  check (
    (status in ('confirmed_sent', 'definitive_failed', 'ambiguous_halted') and
      outcome_evidence_hash is not null and terminal_at is not null) or
    status not in ('confirmed_sent', 'definitive_failed', 'ambiguous_halted')
  )
);

create or replace function public.claim_transactional_graph_dispatch(
  p_worker_id uuid, p_limit integer, p_lease_seconds integer
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_item public.transactional_dispatch_outbox%rowtype;
  v_outbox public.graph_outbox%rowtype;
  v_authorization public.graph_outbox_authorizations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_dispatch_outcome text;
  v_outcome_evidence_hash text;
  v_now timestamptz;
begin
  if p_worker_id is null or p_limit <> 1 or
     p_lease_seconds not between 30 and 300 then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'invalid_request', 'claimed', 0,
      'recovery_required', false, 'resume_existing_reservation', false,
      'reservation_id', null, 'outbox_state', null,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null,
      'lease_expires_at', null, 'items', '[]'::jsonb
    );
  end if;
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  v_now := pg_catalog.clock_timestamp();
  if not v_control.master_enabled or not v_control.transactional_enabled then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason_code', 'master_or_lane_disabled',
      'claimed', 0, 'recovery_required', false,
      'resume_existing_reservation', false,
      'reservation_id', null, 'outbox_state', null,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null,
      'lease_expires_at', null, 'items', '[]'::jsonb
    );
  end if;
  select * into v_item from public.transactional_dispatch_outbox
  where status = 'claimed' and claimed_by = p_worker_id
    and claim_expires_at > v_now
  order by created_at, id limit 1 for update;
  v_now := pg_catalog.clock_timestamp();
  if not found then
    select * into v_item from public.transactional_dispatch_outbox
    where status = 'reserved' and reservation_id is not null
      and claim_expires_at <= v_now
    order by created_at, id limit 1 for update skip locked;
    v_now := pg_catalog.clock_timestamp();
    if found and v_item.claim_expires_at <= v_now then
      select * into v_outbox from public.graph_outbox
      where reservation_id = v_item.reservation_id for update;
      if not found then
        return pg_catalog.jsonb_build_object(
          'accepted', false, 'reason_code', 'reserved_recovery_binding_conflict',
          'recovery_required', true, 'resume_existing_reservation', true,
          'reservation_id', v_item.reservation_id, 'outbox_state', null,
          'lease_expires_at', null, 'items', '[]'::jsonb
        );
      end if;
      select * into v_authorization from public.graph_outbox_authorizations
      where reservation_id = v_item.reservation_id for update;
      if not found then
        return pg_catalog.jsonb_build_object(
          'accepted', false, 'reason_code', 'reserved_recovery_binding_conflict',
          'recovery_required', true, 'resume_existing_reservation', true,
          'reservation_id', v_item.reservation_id,
          'outbox_state', v_outbox.state,
          'lease_expires_at', null, 'items', '[]'::jsonb
        );
      end if;
      select * into v_reservation from public.mailbox_delivery_reservations
      where id = v_item.reservation_id for update;
      if not found or not v_reservation.graph_managed or
         v_reservation.transactional_dispatch_id is distinct from v_item.id or
         v_reservation.payload_sha256 <> v_item.payload_sha256 or
         v_outbox.lane <> 'transactional' or
         v_outbox.payload_sha256 <> v_item.payload_sha256 then
        return pg_catalog.jsonb_build_object(
          'accepted', false, 'reason_code', 'reserved_recovery_binding_conflict',
          'recovery_required', true, 'resume_existing_reservation', true,
          'reservation_id', v_item.reservation_id,
          'outbox_state', v_outbox.state,
          'lease_expires_at', null, 'items', '[]'::jsonb
        );
      end if;

      v_dispatch_outcome := case v_outbox.state
        when 'confirmed_sent' then 'confirmed_sent'
        when 'definitive_failed' then 'definitive_failed'
        when 'ambiguous_halted' then 'ambiguous_halted'
        when 'suppressed_before_send' then 'definitive_failed'
        else null
      end;
      v_outcome_evidence_hash := case v_outbox.state
        when 'confirmed_sent' then v_outbox.sent_items_evidence_hash
        when 'definitive_failed' then v_outbox.terminal_evidence_hash
        when 'ambiguous_halted' then v_outbox.terminal_evidence_hash
        when 'suppressed_before_send' then v_outbox.terminal_evidence_hash
        else null
      end;
      if v_outbox.state = 'suppressed_before_send' and
         v_outbox.graph_draft_immutable_id is null and
         v_outcome_evidence_hash is not null and
         v_reservation.status = 'reserved' then
        v_now := pg_catalog.clock_timestamp();
        update public.mailbox_delivery_reservations
        set status = 'failed', finalized_at = v_now,
            failure_code = 'DEFINITIVE_SUPPRESSED', updated_at = v_now
        where id = v_reservation.id and status = 'reserved';
        update public.mailbox_throttle_state
        set active_reservation_id = null, updated_at = v_now
        where mailbox_key_hash = v_outbox.mailbox_key_hash
          and active_reservation_id = v_reservation.id;
        v_reservation.status := 'failed';
      end if;
      if v_dispatch_outcome is not null and
         v_outcome_evidence_hash ~ '^[a-f0-9]{64}$' and (
           (v_outbox.state = 'confirmed_sent' and
             v_reservation.status = 'sent') or
           (v_outbox.state = 'definitive_failed' and
             v_reservation.status = 'failed') or
           (v_outbox.state = 'ambiguous_halted' and
             v_reservation.status = 'reconcile_required') or
           (v_outbox.state = 'suppressed_before_send' and
             v_reservation.status = 'failed' and (
               v_outbox.graph_draft_immutable_id is null or (
                 v_outbox.draft_neutralized_at is not null and
                 v_outbox.neutralization_evidence_hash is not null
               )
             ))
         ) then
        v_now := pg_catalog.clock_timestamp();
        update public.transactional_dispatch_outbox
        set status = v_dispatch_outcome, claimed_by = p_worker_id,
            claim_expires_at = null,
            outcome_evidence_hash = v_outcome_evidence_hash,
            terminal_at = v_now, updated_at = v_now
        where id = v_item.id and status = 'reserved';
        return pg_catalog.jsonb_build_object(
          'accepted', true, 'reason_code', 'terminal_recovered', 'claimed', 0,
          'recovery_required', false, 'resume_existing_reservation', false,
          'reservation_id', v_reservation.id, 'outbox_state', v_outbox.state,
          'outcome', v_outbox.state, 'dispatch_outcome', v_dispatch_outcome,
          'outcome_evidence_hash', v_outcome_evidence_hash,
          'lease_expires_at', null, 'items', '[]'::jsonb
        );
      elsif v_dispatch_outcome is not null and not (
        v_outbox.state = 'suppressed_before_send' and
        v_outbox.graph_draft_immutable_id is not null and
        (v_outbox.draft_neutralized_at is null or
          v_outbox.neutralization_evidence_hash is null)
      ) then
        return pg_catalog.jsonb_build_object(
          'accepted', false, 'reason_code', 'reserved_recovery_binding_conflict',
          'recovery_required', true, 'resume_existing_reservation', true,
          'reservation_id', v_reservation.id, 'outbox_state', v_outbox.state,
          'outcome_evidence_hash', v_outcome_evidence_hash,
          'lease_expires_at', null, 'items', '[]'::jsonb
        );
      end if;

      v_now := pg_catalog.clock_timestamp();
      update public.transactional_dispatch_outbox
      set claimed_by = p_worker_id,
          claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
          attempt = attempt + 1, updated_at = v_now
      where id = v_item.id and status = 'reserved'
      returning * into v_item;
      if not found then
        return pg_catalog.jsonb_build_object(
          'accepted', false, 'reason_code', 'reserved_recovery_lost',
          'recovery_required', true, 'resume_existing_reservation', true,
          'reservation_id', v_reservation.id,
          'outbox_state', v_outbox.state,
          'lease_expires_at', null, 'items', '[]'::jsonb
        );
      end if;
      update public.mailbox_delivery_reservations
      set lease_expires_at = v_item.claim_expires_at, updated_at = v_now
      where id = v_reservation.id and status = 'reserved';
      update public.graph_outbox_authorizations
      set expires_at = least(
        v_item.claim_expires_at, v_now + interval '90 seconds'
      )
      where reservation_id = v_reservation.id and consumed_at is null
        and v_outbox.state in ('reserved', 'draft_creating', 'draft_created');

      return pg_catalog.jsonb_build_object(
        'accepted', true, 'reason_code', 'reserved_recovery', 'claimed', 1,
        'recovery_required', true, 'resume_existing_reservation', true,
        'reservation_id', v_reservation.id, 'outbox_state', v_outbox.state,
        'graph_draft_immutable_id', v_outbox.graph_draft_immutable_id,
        'draft_neutralized', v_outbox.draft_neutralized_at is not null,
        'outcome_evidence_hash', v_outcome_evidence_hash,
        'lease_expires_at', v_item.claim_expires_at,
        'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'dispatch_id', v_item.id, 'submission_id', v_item.submission_id,
          'resource', v_item.resource, 'payload_sha256', v_item.payload_sha256,
          'attempt', v_item.attempt, 'reservation_id', v_reservation.id,
          'outbox_state', v_outbox.state, 'recovery_required', true,
          'resume_existing_reservation', true,
          'graph_draft_immutable_id', v_outbox.graph_draft_immutable_id,
          'draft_neutralized', v_outbox.draft_neutralized_at is not null,
          'outcome_evidence_hash', v_outcome_evidence_hash,
          'lease_expires_at', v_item.claim_expires_at
        ))
      );
    end if;

    select * into v_item from public.transactional_dispatch_outbox
    where status in ('queued_off', 'deferred') or
      (status = 'claimed' and claim_expires_at <= v_now)
    order by created_at, id limit 1 for update skip locked;
    v_now := pg_catalog.clock_timestamp();
    if not found then
      return pg_catalog.jsonb_build_object(
        'accepted', true, 'reason_code', 'empty',
        'claimed', 0, 'recovery_required', false,
        'resume_existing_reservation', false,
        'reservation_id', null, 'outbox_state', null,
        'graph_draft_immutable_id', null, 'draft_neutralized', false,
        'outcome_evidence_hash', null,
        'lease_expires_at', null, 'items', '[]'::jsonb
      );
    end if;
    update public.transactional_dispatch_outbox
    set status = 'claimed', claimed_by = p_worker_id,
        claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
        attempt = attempt + 1, updated_at = v_now
    where id = v_item.id returning * into v_item;
  end if;
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'reason_code', 'claimed', 'claimed', 1,
    'recovery_required', false, 'resume_existing_reservation', false,
    'reservation_id', null, 'outbox_state', null,
    'graph_draft_immutable_id', null, 'draft_neutralized', false,
    'outcome_evidence_hash', null,
    'lease_expires_at', v_item.claim_expires_at,
    'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'dispatch_id', v_item.id, 'submission_id', v_item.submission_id,
      'resource', v_item.resource, 'payload_sha256', v_item.payload_sha256,
      'attempt', v_item.attempt, 'reservation_id', null,
      'outbox_state', null, 'recovery_required', false,
      'resume_existing_reservation', false,
      'graph_draft_immutable_id', null, 'draft_neutralized', false,
      'outcome_evidence_hash', null,
      'lease_expires_at', v_item.claim_expires_at
    ))
  );
end;
$$;

create or replace function public.reserve_claimed_transactional_graph_dispatch(
  p_dispatch_id uuid, p_worker_id uuid, p_mailbox_key_hash text,
  p_finalize_capability_hash text, p_package_hmac_sha256 text,
  p_send_capability_hash text, p_opaque_marker text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_dispatch public.transactional_dispatch_outbox%rowtype;
  v_state public.mailbox_throttle_state%rowtype;
  v_active public.mailbox_delivery_reservations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_hash text;
  v_now timestamptz;
  v_position smallint;
begin
  if p_dispatch_id is null or p_worker_id is null or
     p_mailbox_key_hash !~ '^[a-f0-9]{64}$' or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_package_hmac_sha256 !~ '^[a-f0-9]{64}$' or
     p_send_capability_hash !~ '^[a-f0-9]{64}$' or
     p_opaque_marker !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_dispatch from public.transactional_dispatch_outbox
  where id = p_dispatch_id for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_dispatch.claimed_by is distinct from p_worker_id then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'claim_unavailable'
    );
  end if;
  if v_dispatch.status = 'reserved' and v_dispatch.reservation_id is not null then
    return pg_catalog.jsonb_build_object(
      'authorized', true, 'duplicate', true, 'reason_code', 'reserved',
      'reservation_id', v_dispatch.reservation_id,
      'lease_expires_at', v_dispatch.claim_expires_at
    );
  end if;
  if v_dispatch.status <> 'claimed' or v_dispatch.claim_expires_at <= v_now then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'claim_expired'
    );
  end if;
  if not v_control.master_enabled or not v_control.transactional_enabled then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'master_or_lane_disabled'
    );
  end if;
  select pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(l.payload::text, 'UTF8'), 'sha256'
  ), 'hex') into v_hash
  from public.leads l
  where l.submission_id = v_dispatch.submission_id
    and l.form_type = v_dispatch.resource for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_hash <> v_dispatch.payload_sha256 then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'lead_binding_conflict'
    );
  end if;
  insert into public.mailbox_throttle_state(mailbox_key_hash, next_allowed_at)
  values (p_mailbox_key_hash, v_now) on conflict (mailbox_key_hash) do nothing;
  select * into v_state from public.mailbox_throttle_state
  where mailbox_key_hash = p_mailbox_key_hash for update;
  v_now := pg_catalog.clock_timestamp();
  if v_state.blocked_reservation_id is not null then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'reconcile_required'
    );
  end if;
  if v_state.active_reservation_id is not null then
    select * into v_active from public.mailbox_delivery_reservations
    where id = v_state.active_reservation_id for update;
    v_now := pg_catalog.clock_timestamp();
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', case when found and v_active.status = 'reserved' and
        v_active.lease_expires_at > v_now then 'lease_active'
        else 'mailbox_reconcile_required' end,
      'lease_expires_at', case when found then v_active.lease_expires_at else null end
    );
  end if;
  v_position := v_state.batch_reservations_count + 1;
  if v_position not in (1, 2) then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'mailbox_state_invalid'
    );
  end if;
  insert into public.transactional_intake_claims(
    submission_id, resource, payload_sha256, intake_capability_hash,
    pilot_recipient_allowed, claimed_at, capability_expires_at, capability_consumed_at
  ) values (
    v_dispatch.submission_id, v_dispatch.resource, v_dispatch.payload_sha256,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'dispatch:' || v_dispatch.id::text, 'UTF8'
    ), 'sha256'), 'hex'), true, v_now, v_dispatch.claim_expires_at, v_now
  ) on conflict (submission_id) do nothing;
  if not exists (
    select 1 from public.transactional_intake_claims
    where submission_id = v_dispatch.submission_id
      and resource = v_dispatch.resource
      and payload_sha256 = v_dispatch.payload_sha256
  ) then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'intake_binding_conflict'
    );
  end if;
  insert into public.mailbox_delivery_reservations(
    mailbox_key_hash, message_key_hash, payload_sha256, submission_id, resource,
    lane, batch_id, batch_position, status, finalize_capability_hash,
    package_hmac_sha256, reserved_at, lease_expires_at, graph_managed,
    transactional_dispatch_id
  ) values (
    p_mailbox_key_hash,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'transactional:' || v_dispatch.submission_id, 'UTF8'
    ), 'sha256'), 'hex'),
    v_dispatch.payload_sha256, v_dispatch.submission_id, v_dispatch.resource,
    'transactional', v_state.batch_id, v_position, 'reserved',
    p_finalize_capability_hash, p_package_hmac_sha256, v_now,
    v_dispatch.claim_expires_at, true, v_dispatch.id
  ) returning * into v_reservation;
  insert into public.graph_outbox(
    reservation_id, mailbox_key_hash, lane, payload_sha256, opaque_marker,
    quota_reservation_day
  ) values (
    v_reservation.id, p_mailbox_key_hash, 'transactional',
    v_dispatch.payload_sha256, p_opaque_marker,
    (v_now at time zone v_control.operating_timezone)::date
  );
  insert into public.graph_outbox_authorizations(
    reservation_id, send_capability_hash, authorized_at, expires_at
  ) values (
    v_reservation.id, p_send_capability_hash, v_now,
    least(v_dispatch.claim_expires_at, v_now + interval '90 seconds')
  );
  update public.mailbox_throttle_state
  set active_reservation_id = v_reservation.id,
      batch_reservations_count = v_position, updated_at = v_now
  where mailbox_key_hash = p_mailbox_key_hash;
  update public.transactional_dispatch_outbox
  set status = 'reserved', reservation_id = v_reservation.id, updated_at = v_now
  where id = v_dispatch.id;
  return pg_catalog.jsonb_build_object(
    'authorized', true, 'duplicate', false, 'reason_code', 'reserved',
    'reservation_id', v_reservation.id,
    'lease_expires_at', v_reservation.lease_expires_at
  );
exception when unique_violation then
  return pg_catalog.jsonb_build_object(
    'authorized', false, 'duplicate', false, 'reason_code', 'binding_collision'
  );
end;
$$;

create or replace function public.finalize_transactional_graph_dispatch(
  p_dispatch_id uuid, p_worker_id uuid, p_outcome text, p_evidence_hash text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_dispatch public.transactional_dispatch_outbox%rowtype;
  v_outbox public.graph_outbox%rowtype;
  v_dispatch_outcome text;
  v_now timestamptz;
begin
  if p_dispatch_id is null or p_worker_id is null or
     p_outcome not in (
       'confirmed_sent', 'definitive_failed', 'ambiguous_halted',
       'suppressed_before_send', 'deferred'
     ) or p_evidence_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;
  v_dispatch_outcome := case p_outcome
    when 'suppressed_before_send' then 'definitive_failed'
    else p_outcome
  end;
  select * into v_dispatch from public.transactional_dispatch_outbox
  where id = p_dispatch_id for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_dispatch.claimed_by is distinct from p_worker_id then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'dispatch_unavailable'
    );
  end if;
  if p_outcome = 'deferred' then
    if v_dispatch.status = 'deferred' and
       v_dispatch.outcome_evidence_hash is null then
      return pg_catalog.jsonb_build_object(
        'accepted', true, 'duplicate', true, 'reason_code', 'deferred',
        'outcome', 'deferred', 'dispatch_outcome', 'deferred',
        'graph_outbox_state', null
      );
    end if;
    if v_dispatch.status <> 'claimed' or v_dispatch.reservation_id is not null then
      return pg_catalog.jsonb_build_object(
        'accepted', false, 'duplicate', false, 'reason_code', 'state_conflict'
      );
    end if;
    update public.transactional_dispatch_outbox
    set status = 'deferred', claimed_by = null, claim_expires_at = null,
        updated_at = v_now where id = p_dispatch_id;
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', false, 'reason_code', 'deferred',
      'outcome', 'deferred', 'dispatch_outcome', 'deferred',
      'graph_outbox_state', null
    );
  end if;
  if v_dispatch.reservation_id is null or
     v_dispatch.status not in (
       'reserved', 'confirmed_sent', 'definitive_failed', 'ambiguous_halted'
     ) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;
  select * into v_outbox from public.graph_outbox
  where reservation_id = v_dispatch.reservation_id for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_outbox.state <> p_outcome or
     (p_outcome = 'confirmed_sent' and
       v_outbox.sent_items_evidence_hash is distinct from p_evidence_hash) or
     (p_outcome <> 'confirmed_sent' and
       v_outbox.terminal_evidence_hash is distinct from p_evidence_hash) or
     (p_outcome = 'suppressed_before_send' and
       v_outbox.graph_draft_immutable_id is not null and (
         v_outbox.draft_neutralized_at is null or
         v_outbox.neutralization_evidence_hash is null
       )) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false,
      'reason_code', 'graph_terminal_evidence_required'
    );
  end if;
  if v_dispatch.status = v_dispatch_outcome and
     v_dispatch.outcome_evidence_hash = p_evidence_hash then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', true, 'reason_code', p_outcome,
      'outcome', p_outcome, 'dispatch_outcome', v_dispatch_outcome,
      'graph_outbox_state', v_outbox.state
    );
  end if;
  if v_dispatch.status <> 'reserved' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;
  update public.transactional_dispatch_outbox
  set status = v_dispatch_outcome, outcome_evidence_hash = p_evidence_hash,
      terminal_at = v_now, updated_at = v_now where id = p_dispatch_id;
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', p_outcome,
    'outcome', p_outcome, 'dispatch_outcome', v_dispatch_outcome,
    'graph_outbox_state', v_outbox.state
  );
end;
$$;

alter table public.transactional_dispatch_outbox enable row level security;
alter table public.transactional_dispatch_outbox force row level security;
revoke all privileges on table public.transactional_dispatch_outbox
  from public, anon, authenticated;
grant select, insert, update on table public.transactional_dispatch_outbox
  to service_role;
revoke execute on function public.claim_transactional_graph_dispatch(uuid,integer,integer)
  from public, anon, authenticated;
revoke execute on function public.reserve_claimed_transactional_graph_dispatch(
  uuid,uuid,text,text,text,text,text
) from public, anon, authenticated;
revoke execute on function public.finalize_transactional_graph_dispatch(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.claim_transactional_graph_dispatch(uuid,integer,integer)
  to service_role;
grant execute on function public.reserve_claimed_transactional_graph_dispatch(
  uuid,uuid,text,text,text,text,text
) to service_role;
grant execute on function public.finalize_transactional_graph_dispatch(uuid,uuid,text,text)
  to service_role;

commit;

-- Contract correction: durable capture dispatch and Graph-owned authority.
-- Remains fail-closed/OFF; no network or provider operation is performed.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.graph_outbox
  drop constraint if exists graph_outbox_opaque_marker_check;
alter table public.graph_outbox
  add constraint graph_outbox_opaque_marker_check
  check (opaque_marker ~ '^[a-f0-9]{64}$') not valid;
alter table public.graph_outbox
  validate constraint graph_outbox_opaque_marker_check;
create unique index if not exists graph_outbox_marker_casefold_unique_idx
  on public.graph_outbox ((pg_catalog.lower(opaque_marker)));

alter table public.graph_outbox
  add column if not exists draft_neutralized_at timestamptz,
  add column if not exists neutralization_evidence_hash text;
alter table public.graph_outbox
  drop constraint if exists graph_outbox_neutralization_evidence_check;
alter table public.graph_outbox
  add constraint graph_outbox_neutralization_evidence_check check (
    (draft_neutralized_at is null and neutralization_evidence_hash is null) or
    (draft_neutralized_at is not null and
      neutralization_evidence_hash ~ '^[a-f0-9]{64}$')
  ) not valid;
alter table public.graph_outbox
  validate constraint graph_outbox_neutralization_evidence_check;

alter table public.mailbox_throttle_state
  add column if not exists last_graph_send_authorized_at timestamptz;
alter table public.mailbox_delivery_reservations
  add column if not exists graph_managed boolean not null default false,
  add column if not exists transactional_dispatch_id uuid;

create table if not exists public.transactional_dispatch_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  submission_id text not null unique
    check (submission_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$'),
  resource text not null
    check (resource in ('calculator', 'interactive_checklist', 'checklist', 'webinar')),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued_off' check (status in (
    'queued_off', 'claimed', 'reserved', 'confirmed_sent',
    'definitive_failed', 'ambiguous_halted', 'deferred'
  )),
  claimed_by uuid,
  claim_expires_at timestamptz,
  attempt integer not null default 0 check (attempt between 0 and 1000),
  reservation_id uuid,
  outcome_evidence_hash text check (
    outcome_evidence_hash is null or outcome_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  terminal_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (
    (status in ('claimed', 'reserved') and claimed_by is not null and
      claim_expires_at is not null) or status not in ('claimed', 'reserved')
  ),
  check (
    (status in ('confirmed_sent', 'definitive_failed', 'ambiguous_halted') and
      outcome_evidence_hash is not null and terminal_at is not null) or
    status not in ('confirmed_sent', 'definitive_failed', 'ambiguous_halted')
  )
);
alter table public.transactional_dispatch_outbox
  add constraint transactional_dispatch_reservation_fk
  foreign key (reservation_id) references public.mailbox_delivery_reservations(id)
  on delete restrict;
alter table public.mailbox_delivery_reservations
  add constraint mailbox_transactional_dispatch_fk
  foreign key (transactional_dispatch_id)
  references public.transactional_dispatch_outbox(id) on delete restrict;
create unique index mailbox_transactional_dispatch_unique_idx
  on public.mailbox_delivery_reservations(transactional_dispatch_id)
  where transactional_dispatch_id is not null;
create index transactional_dispatch_claim_idx
  on public.transactional_dispatch_outbox(status, claim_expires_at, created_at);
create index transactional_dispatch_reservation_idx
  on public.transactional_dispatch_outbox(reservation_id)
  where reservation_id is not null;

create or replace function public.enqueue_transactional_graph_dispatch()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_hash text;
  v_existing public.transactional_dispatch_outbox%rowtype;
begin
  if new.form_type not in (
    'calculator', 'interactive_checklist', 'checklist', 'webinar'
  ) then return new; end if;
  if new.submission_id is null or
     new.submission_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$' then
    raise exception using errcode = '23514', message = 'dispatch_submission_invalid';
  end if;
  v_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(new.payload::text, 'UTF8'), 'sha256'
  ), 'hex');
  insert into public.transactional_dispatch_outbox(
    submission_id, resource, payload_sha256, status
  ) values (new.submission_id, new.form_type, v_hash, 'queued_off')
  on conflict (submission_id) do nothing;
  select * into strict v_existing from public.transactional_dispatch_outbox
  where submission_id = new.submission_id;
  if v_existing.resource <> new.form_type or v_existing.payload_sha256 <> v_hash then
    raise exception using errcode = '23505', message = 'dispatch_submission_collision';
  end if;
  return new;
end;
$$;
drop trigger if exists leads_transactional_graph_dispatch on public.leads;
create trigger leads_transactional_graph_dispatch after insert on public.leads
for each row execute function public.enqueue_transactional_graph_dispatch();

-- Backfill only still-pending captures so historical confirmed E2E rows cannot
-- become sendable. Existing rows remain queued while both DB controls are OFF.
insert into public.transactional_dispatch_outbox(
  submission_id, resource, payload_sha256, status
)
select l.submission_id, l.form_type,
  pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(l.payload::text, 'UTF8'), 'sha256'
  ), 'hex'),
  'queued_off'
from public.leads l
where l.form_type in ('calculator', 'interactive_checklist', 'checklist', 'webinar')
  and l.submission_id is not null
  and l.delivery_status = 'captured'
  and l.email_delivery_status = 'pending'
on conflict (submission_id) do nothing;

do $$
begin
  if exists (
    select 1 from public.leads l
    join public.transactional_dispatch_outbox d using (submission_id)
    where l.delivery_status = 'captured'
      and l.email_delivery_status = 'pending'
      and (d.resource <> l.form_type or d.payload_sha256 <>
        pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(l.payload::text, 'UTF8'), 'sha256'
        ), 'hex'))
  ) then
    raise exception using errcode = '23505',
      message = 'dispatch_backfill_collision';
  end if;
end;
$$;

create or replace function public.enforce_transactional_pilot_reservation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.lane <> 'transactional' or new.graph_managed then return new; end if;
  perform 1 from public.mailbox_throttle_state
  where mailbox_key_hash = new.mailbox_key_hash for update;
  if not found then
    raise exception using errcode = '23514', message = 'mailbox_state_unavailable';
  end if;
  if exists (
    select 1 from public.mailbox_delivery_reservations
    where mailbox_key_hash = new.mailbox_key_hash and lane = 'transactional'
      and resource = new.resource and not graph_managed
  ) then
    raise exception using errcode = '23514', message = 'pilot_resource_quota_reached';
  end if;
  if (select pg_catalog.count(*) from public.mailbox_delivery_reservations
      where mailbox_key_hash = new.mailbox_key_hash and lane = 'transactional'
        and not graph_managed) >= 4 then
    raise exception using errcode = '23514', message = 'pilot_mailbox_quota_reached';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_mailbox_terminal_transition()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare v_outbox public.graph_outbox%rowtype;
begin
  if new.status not in ('sent', 'failed') or new.status = old.status then
    return new;
  end if;
  select * into v_outbox from public.graph_outbox where reservation_id = old.id;
  if found or old.graph_managed or new.graph_managed then
    if not found or
       (new.status = 'sent' and (
         v_outbox.state <> 'confirmed_sent' or
         v_outbox.sent_items_evidence_hash is null or
         v_outbox.internet_message_id_hash is null
       )) or
       (new.status = 'failed' and (
         v_outbox.state not in ('definitive_failed', 'suppressed_before_send') or
         v_outbox.terminal_evidence_hash is null or
         (v_outbox.state = 'suppressed_before_send' and
          v_outbox.neutralization_evidence_hash is null)
       )) then
      raise exception using errcode = '23514',
        message = 'graph_outbox_terminal_evidence_required';
    end if;
    return new;
  end if;
  if old.status = 'reserved' and
     old.lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '23514',
      message = 'lease_expired_requires_reconcile';
  end if;
  return new;
end;
$$;

do $$
begin
  if pg_catalog.to_regprocedure(
    'public.finalize_transactional_mailbox_delivery_legacy_20260818(text,text,text,text,text)'
  ) is null then
    alter function public.finalize_transactional_mailbox_delivery(text,text,text,text,text)
      rename to finalize_transactional_mailbox_delivery_legacy_20260818;
  end if;
  if pg_catalog.to_regprocedure(
    'public.reconcile_transactional_mailbox_delivery_legacy_20260818(uuid,text,text,text)'
  ) is null then
    alter function public.reconcile_transactional_mailbox_delivery(uuid,text,text,text)
      rename to reconcile_transactional_mailbox_delivery_legacy_20260818;
  end if;
end;
$$;

create or replace function public.finalize_transactional_mailbox_delivery(
  p_mailbox_key_hash text, p_finalize_capability_hash text, p_state text,
  p_provider_message_hash text, p_failure_code text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.mailbox_delivery_reservations
    where mailbox_key_hash = p_mailbox_key_hash
      and finalize_capability_hash = p_finalize_capability_hash and graph_managed
  ) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'graph_managed'
    );
  end if;
  return public.finalize_transactional_mailbox_delivery_legacy_20260818(
    p_mailbox_key_hash, p_finalize_capability_hash, p_state,
    p_provider_message_hash, p_failure_code
  );
end;
$$;

create or replace function public.reconcile_transactional_mailbox_delivery(
  p_reservation_id uuid, p_resolution text, p_provider_message_hash text,
  p_evidence_hash text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.mailbox_delivery_reservations
    where id = p_reservation_id and graph_managed
  ) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'graph_managed',
      'mailbox_halted', true
    );
  end if;
  return public.reconcile_transactional_mailbox_delivery_legacy_20260818(
    p_reservation_id, p_resolution, p_provider_message_hash, p_evidence_hash
  );
end;
$$;

commit;

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create or replace function public.mark_graph_managed_reservation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.mailbox_delivery_reservations
  set graph_managed = true, updated_at = pg_catalog.clock_timestamp()
  where id = new.reservation_id and not graph_managed;
  return new;
end;
$$;
drop trigger if exists graph_outbox_mark_reservation on public.graph_outbox;
create trigger graph_outbox_mark_reservation
after insert on public.graph_outbox for each row
execute function public.mark_graph_managed_reservation();
update public.mailbox_delivery_reservations r set graph_managed = true
where exists (
  select 1 from public.graph_outbox o where o.reservation_id = r.id
) and not r.graph_managed;

create or replace function public.confirm_graph_draft_neutralized(
  p_reservation_id uuid, p_finalize_capability_hash text,
  p_graph_draft_immutable_id text, p_neutralization_evidence_hash text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_outbox public.graph_outbox%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_now timestamptz;
begin
  if p_reservation_id is null or
     p_finalize_capability_hash !~ '^[a-f0-9]{64}$' or
     p_graph_draft_immutable_id is null or
     p_neutralization_evidence_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;
  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id
    and finalize_capability_hash = p_finalize_capability_hash for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_outbox.state <> 'suppressed_before_send' or
     v_outbox.graph_draft_immutable_id <>
       p_graph_draft_immutable_id collate "C" then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'duplicate', false, 'reason_code', 'state_or_id_conflict'
    );
  end if;
  if v_outbox.neutralization_evidence_hash = p_neutralization_evidence_hash and
     v_reservation.status = 'failed' then
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', true, 'reason_code', 'draft_neutralized'
    );
  end if;
  update public.graph_outbox
  set neutralization_evidence_hash = p_neutralization_evidence_hash,
      draft_neutralized_at = v_now, updated_at = v_now
  where reservation_id = p_reservation_id;
  update public.mailbox_delivery_reservations
  set status = 'failed', finalized_at = v_now,
      failure_code = 'DEFINITIVE_SUPPRESSED', updated_at = v_now
  where id = p_reservation_id;
  update public.mailbox_throttle_state
  set active_reservation_id = null, updated_at = v_now
  where mailbox_key_hash = v_outbox.mailbox_key_hash
    and active_reservation_id = p_reservation_id;
  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'reason_code', 'draft_neutralized'
  );
end;
$$;

drop function if exists public.authorize_graph_draft_send(uuid,text,text);
create or replace function public.authorize_graph_draft_send(
  p_reservation_id uuid, p_send_capability_hash text,
  p_stop_snapshot_hash text, p_observed_change_key_hash text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_control public.outbound_delivery_control%rowtype;
  v_outbox public.graph_outbox%rowtype;
  v_authorization public.graph_outbox_authorizations%rowtype;
  v_reservation public.mailbox_delivery_reservations%rowtype;
  v_mailbox public.mailbox_throttle_state%rowtype;
  v_usage public.outbound_daily_usage%rowtype;
  v_now timestamptz;
  v_today date;
  v_stopped boolean := false;
begin
  if p_reservation_id is null or
     p_send_capability_hash !~ '^[a-f0-9]{64}$' or
     p_stop_snapshot_hash !~ '^[a-f0-9]{64}$' or
     p_observed_change_key_hash !~ '^[a-f0-9]{64}$' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'invalid_request'
    );
  end if;
  select * into v_control from public.outbound_delivery_control
  where singleton for update;
  select * into v_outbox from public.graph_outbox
  where reservation_id = p_reservation_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'outbox_unavailable'
    );
  end if;
  select * into v_authorization from public.graph_outbox_authorizations
  where reservation_id = p_reservation_id
    and send_capability_hash = p_send_capability_hash for update;
  select * into v_reservation from public.mailbox_delivery_reservations
  where id = p_reservation_id for update;
  select * into v_mailbox from public.mailbox_throttle_state
  where mailbox_key_hash = v_outbox.mailbox_key_hash for update;
  v_now := pg_catalog.clock_timestamp();

  if v_outbox.state = 'send_submitted' then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', true, 'reason_code', 'replay_blocked'
    );
  end if;
  if v_outbox.state <> 'draft_created' or
     v_reservation.status <> 'reserved' or not v_reservation.graph_managed then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'state_conflict'
    );
  end if;
  if v_outbox.graph_change_key_hash is distinct from p_observed_change_key_hash then
    update public.graph_outbox set state = 'ambiguous_halted',
      failure_code = 'AMBIGUOUS_CHANGE_KEY_MISMATCH',
      terminal_evidence_hash = p_stop_snapshot_hash, terminal_at = v_now,
      updated_at = v_now where reservation_id = p_reservation_id;
    update public.mailbox_delivery_reservations set status = 'reconcile_required',
      finalized_at = v_now, failure_code = 'AMBIGUOUS_CHANGE_KEY_MISMATCH',
      updated_at = v_now where id = p_reservation_id;
    update public.mailbox_throttle_state set active_reservation_id = null,
      blocked_reservation_id = p_reservation_id, updated_at = v_now
    where mailbox_key_hash = v_outbox.mailbox_key_hash;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', 'change_key_mismatch_ambiguous_halted'
    );
  end if;

  v_stopped := not v_control.master_enabled or
    (v_outbox.lane = 'cold' and not v_control.cold_enabled) or
    (v_outbox.lane = 'transactional' and not v_control.transactional_enabled);
  if v_outbox.lane = 'cold' and not v_stopped then
    v_stopped := exists (
      select 1
      from public.campaign_contacts cc
      join public.campaign_executions ce
        on ce.id = v_outbox.campaign_execution_id
      join public.campaigns c on c.id = v_outbox.campaign_id
      where cc.id = v_outbox.campaign_contact_id and (
        not c.is_active or c.status not in ('active', 'running', 'pilot') or
        ce.status <> 'planned' or ce.channel <> 'email' or
        cc.suppression_scope <> 'none' or cc.marketing_lane <> 'cold' or
        cc.cold_sequence_status not in ('pending', 'active') or
        exists (select 1 from public.campaign_suppressions s
          where s.identity_hash = cc.email_hash)
      )
    );
  end if;
  if v_stopped then
    update public.graph_outbox set state = 'suppressed_before_send',
      failure_code = 'DEFINITIVE_SUPPRESSED',
      terminal_evidence_hash = p_stop_snapshot_hash, terminal_at = v_now,
      updated_at = v_now where reservation_id = p_reservation_id;
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', 'draft_neutralization_required',
      'reservation_id', p_reservation_id
    );
  end if;

  if v_authorization.consumed_at is not null or
     v_authorization.expires_at <= v_now or
     v_reservation.lease_expires_at <= v_now then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false,
      'reason_code', 'authorization_or_lease_expired'
    );
  end if;
  if v_mailbox.last_graph_send_authorized_at is not null and
     v_now < v_mailbox.last_graph_send_authorized_at +
       pg_catalog.make_interval(secs => v_control.minimum_spacing_seconds) then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'send_cadence',
      'retry_after_seconds', greatest(1, pg_catalog.ceil(
        extract(epoch from (
          v_mailbox.last_graph_send_authorized_at +
          pg_catalog.make_interval(secs => v_control.minimum_spacing_seconds) - v_now
        ))
      ))::integer
    );
  end if;

  v_today := (v_now at time zone v_control.operating_timezone)::date;
  insert into public.outbound_daily_usage(
    mailbox_key_hash, local_day, lane, send_submitted_count
  ) values (v_outbox.mailbox_key_hash, v_today, v_outbox.lane, 0)
  on conflict (mailbox_key_hash, local_day, lane) do nothing;
  select * into v_usage from public.outbound_daily_usage
  where mailbox_key_hash = v_outbox.mailbox_key_hash
    and local_day = v_today and lane = v_outbox.lane for update;
  v_now := pg_catalog.clock_timestamp();
  v_today := (v_now at time zone v_control.operating_timezone)::date;
  if v_usage.local_day <> v_today then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'day_boundary_retry'
    );
  end if;
  if v_outbox.lane = 'cold' and
     v_usage.send_submitted_count >= v_control.cold_daily_limit then
    return pg_catalog.jsonb_build_object(
      'authorized', false, 'duplicate', false, 'reason_code', 'daily_limit'
    );
  end if;

  update public.graph_outbox_authorizations
  set consumed_at = v_now, second_stop_checked_at = v_now,
      stop_snapshot_hash = p_stop_snapshot_hash
  where reservation_id = p_reservation_id;
  update public.graph_outbox
  set state = 'send_submitted', send_submitted_at = v_now,
      quota_send_day = v_today, updated_at = v_now
  where reservation_id = p_reservation_id;
  update public.outbound_daily_usage
  set send_submitted_count = send_submitted_count + 1, updated_at = v_now
  where mailbox_key_hash = v_outbox.mailbox_key_hash
    and local_day = v_today and lane = v_outbox.lane;
  update public.mailbox_throttle_state
  set last_graph_send_authorized_at = v_now, updated_at = v_now
  where mailbox_key_hash = v_outbox.mailbox_key_hash;
  return pg_catalog.jsonb_build_object(
    'authorized', true, 'duplicate', false, 'reason_code', 'send_submitted',
    'reservation_id', p_reservation_id,
    'graph_draft_immutable_id', v_outbox.graph_draft_immutable_id,
    'opaque_marker', v_outbox.opaque_marker
  );
end;
$$;

revoke execute on function public.mark_graph_managed_reservation()
  from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_transactional_graph_dispatch()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_transactional_pilot_reservation()
  from public, anon, authenticated, service_role;
revoke execute on function public.finalize_transactional_mailbox_delivery(
  text,text,text,text,text
) from public, anon, authenticated;
revoke execute on function public.reconcile_transactional_mailbox_delivery(
  uuid,text,text,text
) from public, anon, authenticated;
revoke execute on function public.confirm_graph_draft_neutralized(uuid,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.authorize_graph_draft_send(uuid,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.finalize_transactional_mailbox_delivery_legacy_20260818(
  text,text,text,text,text
) from public, anon, authenticated, service_role;
revoke execute on function public.reconcile_transactional_mailbox_delivery_legacy_20260818(
  uuid,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.confirm_graph_draft_neutralized(uuid,text,text,text)
  to service_role;
grant execute on function public.authorize_graph_draft_send(uuid,text,text,text)
  to service_role;
grant execute on function public.finalize_transactional_mailbox_delivery(
  text,text,text,text,text
) to service_role;
grant execute on function public.reconcile_transactional_mailbox_delivery(
  uuid,text,text,text
) to service_role;

commit;
