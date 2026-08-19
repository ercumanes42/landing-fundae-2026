# Operational observability and rollout runbook

Status: local implementation, `OPERATIONAL_OBSERVABILITY_ENABLED=false` and `OPERATIONAL_ALERT_DELIVERY_ENABLED=false`. The durable-delivery SQL was applied to the independent authorized staging project; postcheck and rollback-only behavior smoke passed, outbound controls remained OFF, and the project was returned to `PAUSED`. Production is unchanged, no external alert channel is configured, and no live canary or email was sent.

## Signal contract

`POST /api/internal/observability` and `GET /api/internal/observability` require a bearer `OBSERVABILITY_WORKER_SECRET` of at least 32 characters. Heartbeat/evaluate audit as a fixed server-derived HMAC machine actor; caller-supplied actor identity is ignored. The endpoint does not expose acknowledge/resolve until dashboard RBAC (`admin`/`operator`) is integrated. Bodies are read as a bounded stream with an 8 KiB hard limit, including requests without `Content-Length`. The switch is independent from outbound and defaults to `false`; while OFF the endpoint returns before any RPC or network call.

The service-only RPC returns bounded aggregate counts only. Heartbeat metrics are flat numeric/boolean/null values; strings, nested JSON and PII-bearing payloads are rejected. Direct tables have forced RLS and no grants. Evaluation receipts make alert replay idempotent. Graph/dispatch ambiguity additionally materializes a PII-free delivery receipt in the same DB transaction that sets `ambiguous_halted` and disables the affected lane.

`deliver_alert` performs one bounded claim. The worker posts only the stored `code`, reservation hash and evidence hash. A failed/timeout webhook is finalized as `pending` with exponential backoff; an expired lease is reclaimable, attempt 8 becomes `dead_letter`, and `delivered` replay performs zero webhook calls. External delivery is best-effort; persistence is mandatory and precedes it.

| Signal | Warning | Critical / kill |
|---|---|---|
| OAuth | age `>5m` or degraded | absent/unavailable or age `>10m` |
| mailbox | age `>10m` or degraded | absent/unavailable or age `>15m` |
| Graph outbox | any in-flight age `>10m` | age `>30m`, ambiguous or definitive-failure/DLQ |
| Sent confirmation | — | any `send_submitted` unconfirmed `>10m` |
| reply/baja/hard-bounce processors | backlog warning | absent/unavailable, failure/collision, or age `>15m` |
| inbound manual review | any open | oldest `>30m` |
| HubSpot | backlog or age `>15m` | failure/collision, unavailable or age `>30m` |
| Make scheduler | age `>5m` | absent/unavailable or age `>10m` |
| campaign | queue age `>15m` or daily usage `>=432` | ambiguity, spacing `<60s`, or usage `>480/day` |
| dashboard | age `>15m` | absent/unavailable or age `>30m` |

Replies, unsubscribes and hard bounces are also exposed as 24-hour counts. Counts themselves are not campaign-wide kill conditions; any unprocessed stop backlog blocks the next claim until drained.

## Canary order and gates

Every phase starts with all outbound switches false and advances only after its evidence is recorded. A PASS authorizes the next technical check, not a live mutation.

1. **Capture-only:** master, transactional, cold, legacy and HubSpot remain false. Submit representative records; prove capture succeeds, no outbound RPC/provider call occurs, no duplicate lead is created and dashboard freshness is healthy.
2. **Four transactional resources:** after G2/G3 and direct authorization, enable only master + transactional for one fresh calculator, interactive PDF, checklist PDF and webinar delivery. Each requires one reservation, one immutable draft, same-draft send and exact Sent Items confirmation. Disable the lane immediately after 4/4.
3. **Internal sequence:** use internal allowlisted recipients only; run all five approved steps, stop/reply/baja/bounce/meeting faults and replay. Require zero ambiguity, zero duplicate task/send and correct suppression convergence.
4. **Ten customers:** requires direct user authorization for this exact tranche. Keep one worker, `>=60s`, `<=480/day`, Europe/Madrid. Pause on any critical alert or undrained stop backlog.
5. **Microbatch 25:** requires the same technical gates and a fresh authorization boundary. Send at most 25, then force a two-hour pause with no new claims. Reconcile Sent Items, replies, bajas, NDR, Calendly, HubSpot and alert state before continuing.
6. **Lots:** execute `235/235/235/234` progressively, preserving the approved cadence/copies. Never compensate a stopped/failed send by exceeding the daily quota. Each lot starts only with zero open critical alerts, zero ambiguous in-flight items and drained stop processors.

## Kill switches and rollback

Kill on any ambiguous Graph result, duplicate reservation/draft/send evidence, spacing violation, quota overflow, stale OAuth/mailbox, unconfirmed Sent Item, correlation collision, suppression failure or open critical alert.

Rollback order:

1. Stop cron/worker ingress; do not start another claim.
2. Set `OUTBOUND_MASTER_ENABLED=false`, `TRANSACTIONAL_OUTLOOK_ENABLED=false`, `COLD_CAMPAIGN_ENABLED=false`, `HUBSPOT_SYNC_ENABLED=false`, `OPERATIONAL_ALERT_DELIVERY_ENABLED=false` and keep legacy flags false. Pending alert intent remains stored.
3. Snapshot aggregate states: `reserved`, `draft_creating`, `draft_created`, `send_submitted`, `ambiguous_halted`, queued/claimed campaign work and pending inbound stops.
4. Before send authorization, neutralize and verify the exact draft, then release only through the canonical terminal RPC.
5. Point of no return: once authorization is consumed and the Graph send POST is submitted, a flag cannot recall the message. Stop later claims and perform read-only same-ID/Sent Items reconciliation; never create a replacement draft.
6. Resolve/acknowledge only through the private RPC under a controlled operator procedure until dashboard RBAC is integrated; never through the shared worker endpoint. Preserve audit and receipts.

## Remaining release evidence

- Preserve the staging evidence for `20260819230000_durable_operational_alert_delivery.sql`: authorized independent project, postcheck and rollback-only behavior smoke PASS, outbound OFF, project `PAUSED`. Production application remains pending and requires its own authorization, backup and precheck.
- Verify grants/RLS and concurrent reconcile/ack/resolve semantics in PostgreSQL; run advisors and representative `EXPLAIN (ANALYZE, BUFFERS)`.
- Connect real heartbeat producers and an approved alert receiver; inject each fault and retain alert receipts.
- Keep G8 `IN_PROGRESS`, G9/G10 `BLOCKED` until live-scoped evidence and direct authorization exist.
