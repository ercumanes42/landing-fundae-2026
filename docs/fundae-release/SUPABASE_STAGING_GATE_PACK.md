# Supabase staging gate pack

Status: `VERIFIED_LOCAL` only. Creating this pack executed no database, network,
migration, advisor, smoke or rollback.

## Scope and authority

The pack covers Graph, dashboard/RBAC, inbound, cold scheduler, observability,
journey retention, provisioning and final safety barriers. It authorizes neither
production nor Graph/Make/HubSpot, private-data provisioning, journey deletion or
email. Each requires its own direct authorization; any staging connection also
requires direct authorization and a verified restorable encrypted backup.

## Audited no-op decision

`migrations/20260819072840_cold_campaign_scheduler.sql` is preserved, not deleted,
renamed or skipped. ADR-0005 records that its schema work is superseded by
`20260819170000_cold_campaign_scheduler.sql`. The earlier timestamp contains only:

```sql
-- EMPTY_MIGRATION_DECISION_ID: FUNDAE-ADR-20260819-COLD-SCHEDULER-SUPERSEDED
-- PURPOSE: Preserve the immutable migration timestamp without duplicating schema changes.
-- SUPERSEDED_BY: 20260819170000_cold_campaign_scheduler.sql
-- SAFETY: This statement is deterministic, read-only and returns no rows.
select 1
where false;
```

Raw-byte SHA-256:
`e5588fcaebd98e3d917cba8cfa2de557b908021b3171c5dea48d5b27f14e0f67`.
The file is pinned to `eol=lf` in `.gitattributes`. The runner rejects an empty
file, a different hash, decision ID or successor.

Graph has four independent transactions. Failure after an early commit is a
partial apply: stop, preserve output, inventory state and use additive recovery.
Never retry blindly.

## Files

- `FUNDAE_RELEASE_PRECHECK_20260819.sql`: rollback-only dependencies, inert state,
  collisions and partial-state detection.
- `FUNDAE_RELEASE_POSTCHECK_20260819.sql`: rollback-only switches, RLS/FORCE,
  grants, RPCs, definers, indexes and constraints.
- `FUNDAE_RELEASE_BEHAVIOR_SMOKE_20260819.sql`: synthetic PII-free smoke; outbound,
  purge and provisioning stay OFF; final `ROLLBACK`.
- `FUNDAE_RELEASE_FORWARD_ROLLBACK_20260819.sql`: committed containment without
  deleting evidence.
- `FUNDAE_RELEASE_POST_ROLLBACK_20260819.sql`: containment proof and Graph
  reconciliation inventory.

Forward rollback is tested only in a disposable staging clone because it revokes
RPC execution and is intentionally not auto-reversible.

## Local validation

```powershell
npm.cmd run test:supabase-gate-pack
powershell.exe -NoProfile -File .\scripts\release\run-supabase-staging-gates.ps1 -Mode Static
```

Both commands must pass. They hash every input and validate the exact no-op; they
perform no SQL connection or mutation and never promote G2.

## Authorized staging

Configure `PGHOST`, `PGDATABASE`, `PGUSER`, credentials through the approved
secret mechanism and `PGSSLMODE=require` or stronger. Never put a connection URL
in arguments/logs. Set `FUNDAE_STAGING_PGHOST_SHA256` to lowercase SHA-256 of the
approved lowercase host, then during the authorized window:

```powershell
$env:FUNDAE_SUPABASE_GATE_ACK = 'I_AUTHORIZE_STAGING_SQL_GATES'
powershell.exe -NoProfile -File .\scripts\release\run-supabase-staging-gates.ps1 -Mode ApplyAndSmoke -Environment staging
```

The runner uses `psql.exe -X`, `ON_ERROR_STOP=1`, TLS, session timeouts and hashes.
Order: `precheck -> Graph -> audited no-op -> dashboard -> inbound ->
scheduler -> observability -> journey -> provisioning -> safety -> postcheck ->
behavior smoke`.

After SQL passes, inspect `supabase db advisors --help`, run the pinned advisors,
and preserve output. Also run representative `EXPLAIN (ANALYZE, BUFFERS)` for
dashboard aggregates, scheduler claim and retention lookup.

For an authorized disposable clone:

```powershell
$env:FUNDAE_SQL_OPERATOR_HASH = '<64-lowercase-hex>'
powershell.exe -NoProfile -File .\scripts\release\run-supabase-staging-gates.ps1 -Mode RollbackSmoke -Environment disposable-staging
```

Store evidence outside the repo: approver/operator hashes, UTC timestamps,
environment fingerprint, backup and SQL hashes, stdout/stderr, exit codes,
advisors and aggregate counts. Never store secrets, PII or message bodies.

Static/local success never promotes G2. G2 still requires authorized staging,
advisors, concurrency/fault evidence and disposable rollback proof.
