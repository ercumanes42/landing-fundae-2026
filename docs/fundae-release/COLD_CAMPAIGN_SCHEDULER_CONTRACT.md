# Cold campaign scheduler contract

Status: implemented locally and OFF; `G7` remains `BLOCKED`. No SQL, Make, Graph, deploy or send was executed.

## Authority and flow

```text
Make schedule (one HTTP POST, empty body)
  -> /api/internal/graph/campaign-dispatch (Bearer worker secret)
  -> claim_cold_campaign_dispatch (one row, one DB worker lease)
  -> private materialized payload + exact unsubscribe URL
  -> reserve_cold_graph_delivery (lane=cold)
  -> secure Graph draft/ImmutableId/same-draft/Sent Items worker
  -> finalize_cold_campaign_dispatch with terminal evidence
```

Data Brain/PostgreSQL is the only campaign authority. Make may schedule one call; it never reads Google Sheets, uses Make Data Store, selects contacts, renders copy, evaluates stops or sends through an Outlook module. The transactional dispatch and `TRANSACTIONAL_OUTLOOK_ENABLED` are not reused.

## Invariants

- Defaults: `OUTBOUND_MASTER_ENABLED=false`, `COLD_CAMPAIGN_ENABLED=false`, DB `master_enabled=false`, DB `cold_enabled=false`.
- One partial unique in-flight row and the control-row lock serialize workers. Each tick claims at most one transition.
- Expired claims recover the same dispatch, reservation, Graph state, ImmutableId, neutralization state and terminal evidence. Recovery never creates a second draft. Any ambiguity atomically sets DB `cold_enabled=false`, records evidence and an alert; the next tick performs no reservation or Graph call.
- The package is private and must contain one materialized `/baja?token=` URL. Recipient, subject, body and attachments are bound to `payload_sha256` before reservation or Graph.
- The existing cold reservation plus JIT Graph authorization enforce `Europe/Madrid`, at least 60 seconds between `send_submitted` authorizations, at most 480 cold submissions per local day and the second stop-check immediately before send.
- A step is eligible only when `execution.step = contact.current_step` and every prior step is `executed` with cold dispatch `confirmed_sent`; overdue rows cannot skip order and a failed/ambiguous step blocks later steps.
- Finalization locks the contact. A reply, unsubscribe, opposition, bounce, suppression or meeting committed before finalize remains stopped and all later planned email steps become stopped; step 5 keeps `current_step=5` and marks the sequence completed.
- Terminal stops converge with Echo/Campaign vocabulary: human/positive reply, unsubscribe, opposition, hard bounce, marketing/global suppression, duplicate and Calendly meeting.

## Make configuration status

`automation/make/email_sender_blueprint.json` is deliberately a non-importable configuration specification. The exact HTTP module slug, connection, scenario/team IDs and secret mapping were not verified; per Make skills they cannot be guessed or auto-selected. It must remain inactive.

## Materialization blocker

`automation/scripts/import-campaign.mjs` remains deprecated: its legacy Basic-auth/network contract is incompatible and it cannot materialize cold payloads. `automation/scripts/provision-cold-campaign.mjs` is the replacement: dry-run is mandatory, reads only the hash-pinned canonical controlled copy under `data-private`, emits no PII and performs no network. The current copy fails closed on exactly three gates: `VALIDATION_NOT_OK`, `TECHNICAL_EXCLUSIONS_NOT_CLEAR` and `CAMPAIGN_NOT_AUTHORIZED`; therefore no apply package or write is prepared and `G7` remains `BLOCKED`.

Before any authorized provisioning implementation/write:

1. Produce a deterministic dry-run report with private dataset hash, exactly 939 unique contacts, lots 235/235/235/234 and 4,695 bodies.
2. Require every technical exclusion `CLEAR`, campaign authorization `AUTHORIZED`, copy identification and one valid unsubscribe URL in every payload.
3. Reconcile executions 1:1 with payloads and verify canonical payload hashes.
4. Require explicit `--apply`, approved environment, backup, staging SQL gates and direct user authorization. Dry-run remains the default.

## Rollback and gates

Forward rollback disables DB cold, revokes worker RPC execution, halts in-flight rows and preserves payload/outbox/alerts. Before `G7`: apply migration in authorized staging; run pre/post, RLS/grants/advisors, two-worker and crash concurrency tests; materialize 4,695/4,695; validate Make module/blueprint with the chosen connection; run internal sequence and approved canaries. No real customer send is authorized.
