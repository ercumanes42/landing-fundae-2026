# Microsoft Graph backend contract

Status: local static gate PASS; Supabase staging pack PASS; release G3 BLOCKED. Runtime OFF. No Graph/live/deploy evidence.

## Runtime flow

`reservation -> register outbox -> begin draft -> POST draft (ImmutableId) -> bind exact case-sensitive id/changeKey hash -> GET and verify full draft -> second stop/lease check -> atomic authorize -> POST same draft once -> poll GET same id in Sent Items -> hash Message-ID/evidence -> confirmed_sent`.

Writes are single-attempt. Only GET operations retry. `Retry-After` is honored; when it exceeds the job budget, the job halts/defers instead of retrying early. A `202` is only `send_submitted`. Zero or multiple marker matches, parse/timeouts, changed draft content/changeKey, identity mismatch or polling exhaustion become `ambiguous_halted` plus a PII-free alert. A pre-send stop neutralizes and verifies deletion of the exact draft before releasing the reservation.

Internal endpoint: `POST /api/internal/graph/transactional`. It requires fail-closed `Authorization: Bearer $GRAPH_WORKER_SECRET`; dashboard or legacy Basic credentials are not accepted. Master and transactional lane must both be literal `true`; defaults remain false.

## SQL invariants implemented and verified in staging

1. Change `authorize_graph_draft_send` to
   `authorize_graph_draft_send(uuid,text,text,text)` by adding
   `p_observed_change_key_hash text`. Under the same mailbox/outbox locks it must refresh
   `v_now := clock_timestamp()`, compare the observed hash to stored
   `graph_change_key_hash`, re-evaluate lease/day/switch/suppression, enforce the actual
   send-authorization cadence `>=60 seconds`, then atomically consume authorization and
   move to `send_submitted`. A mismatch returns a non-sendable halt.
2. Guard every transition of a Graph-managed mailbox reservation to `sent` or `failed`,
   including `reconcile_required -> terminal`. Legacy finalize/reconcile RPCs must return
   `graph_managed` and cannot override Graph evidence. Only
   `confirm_graph_sent_item`/`finalize_graph_delivery_failure` may terminalize it.
3. Normalize marker uniqueness to lowercase hex (`^[a-f0-9]{64}$`) because Graph string
   extended-property equality is case-insensitive while PostgreSQL `C` collation is not.

## Durable capture-to-worker dispatch contract

Capture must insert one private dispatch intent in the same database transaction as each
eligible `calculator`, `interactive_checklist`, `checklist` or `webinar` lead. The intent is
created even while outbound is OFF; OFF means queued with zero Graph calls.

Required RPCs (service role only, forced RLS tables, no PII in results):

- `claim_transactional_graph_dispatch(p_worker_id uuid, p_limit integer, p_lease_seconds integer) returns jsonb`
  - Fresh result: `{accepted,reason_code,recovery_required:false,resume_existing_reservation:false,lease_expires_at,items:[{dispatch_id,submission_id,resource,payload_sha256,attempt,reservation_id:null,outbox_state:null,recovery_required:false,resume_existing_reservation:false,graph_draft_immutable_id:null,draft_neutralized:false,outcome_evidence_hash:null,lease_expires_at}]}`.
  - Lease-expired `reserved` recovery returns `reason_code=reserved_recovery`,
    `recovery_required=true`, `resume_existing_reservation=true`, and the existing
    `reservation_id/outbox_state/draft/evidence` binding. The consumer must skip
    `reserve_claimed_transactional_graph_dispatch` and must not create a draft.
  - A coherent terminal outbox is finalized under the claim locks and returns
    `reason_code=terminal_recovered`, `items=[]`; the consumer performs no package,
    worker, Graph or second finalize operation.
  - `limit=1` for the single worker. Claim uses `FOR UPDATE SKIP LOCKED`, a bounded lease and idempotent replay.
- `reserve_claimed_transactional_graph_dispatch(p_dispatch_id uuid, p_worker_id uuid, p_mailbox_key_hash text, p_finalize_capability_hash text, p_package_hmac_sha256 text, p_send_capability_hash text, p_opaque_marker text) returns jsonb`
  - Under one transaction validates the claim/lead/resource/hash and switches, creates or reuses exactly one mailbox reservation and Graph outbox, then returns `{authorized,duplicate,reason_code,reservation_id,lease_expires_at}`.
- `finalize_transactional_graph_dispatch(p_dispatch_id uuid, p_worker_id uuid, p_outcome text, p_evidence_hash text) returns jsonb`
  - Outcomes: `confirmed_sent`, `definitive_failed`, `ambiguous_halted`,
    `suppressed_before_send`, `deferred`.
  - `suppressed_before_send` requires exact terminal evidence plus verified draft
    neutralization when a draft existed; dispatch maps it internally to
    `definitive_failed` without changing the Graph outbox truth.
  - Terminal evidence must already exist in Graph outbox; ambiguity remains blocked. Replay is idempotent.

The package builder resolves server-side by `submission_id`; raw intake, finalize or send
capabilities must never be stored in the dispatch table. The independent Supabase staging pack,
postcheck, advisors and forward rollback are `STAGING_PASS`. The authorized fresh E2E gate is still
required before the worker may be enabled.

## Canonical runtime and superseded manual operation

The Data Brain Graph worker and its private dispatch routes are the only canonical Outlook runtime.
The untracked manual Make/Outlook reconciliation runbooks (`MAKE_TRANSACTIONAL_OUTLOOK_*` and
`MAKE_TRANSACTIONAL_V3_*`) are `SUPERSEDED`, excluded from the release and must not be imported,
executed or used as rollback. Make may schedule an authenticated empty worker call; it must not own
draft creation, Outlook send, reconciliation or delivery truth.

## Rollback order

Stop worker/cron, set master and lane false, inspect aggregate in-flight
`draft_creating|draft_created|send_submitted|ambiguous_halted`, then run read-only reconciliation.
Flags alone do not recall a send already authorized at the point of no return.

## Final local alignment

Implemented locally: four-argument `authorize_graph_draft_send` with observed changeKey,
fresh post-lock cadence response, Graph-managed legacy terminal guard, lowercase marker,
neutralization evidence, durable claim/reserve/finalize consumer and private
package-by-submission. `POST /api/internal/graph/dispatch` processes exactly one claim and
checks master/lane before any RPC or network call.

Fault tests cover master OFF, exact dispatch RPC shapes, fresh `send_cadence`, persisted
neutralization evidence, lease-expired post-reserve recovery with zero reserve/create,
pending suppressed-draft recovery, terminal auto-recovery with zero Graph work, legacy
terminal protection, create/send timeouts, zero/multiple markers and eventual Sent Items.

Remaining release blockers: OAuth/application-RBAC mailbox evidence, durable alert delivery,
runtime fault receipts and direct authorization for four fresh automatic E2E deliveries. Runtime
remains OFF until those gates pass.

Gate verdict: local implementation/mock fault tests PASS; G3 release/activation BLOCKED.
