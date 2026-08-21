# ADR-0005: Preserve the superseded cold-scheduler timestamp as an audited no-op

Decision ID: `FUNDAE-ADR-20260819-COLD-SCHEDULER-SUPERSEDED`
Status: accepted locally; no staging or live execution
Date: 2026-08-19

## Context

`20260819072840_cold_campaign_scheduler.sql` existed as a zero-byte migration.
Deleting or renaming it would make migration histories diverge. Adding scheduler
DDL would duplicate the authoritative implementation in
`20260819170000_cold_campaign_scheduler.sql`.

## Decision

Preserve the timestamp with one deterministic read-only statement that returns no
rows. Its raw-byte SHA-256 is
`e5588fcaebd98e3d917cba8cfa2de557b908021b3171c5dea48d5b27f14e0f67`.
The release runner accepts only that hash, the exact decision ID and the exact
successor marker. `.gitattributes` pins this file to LF so the raw-byte hash is
reproducible across checkouts. Empty files and arbitrary non-empty replacements
fail closed.

## Consequences

- The migration has no schema, data, grant or runtime side effect.
- The timestamp remains immutable and auditable.
- Any byte-level edit requires a new reviewed decision and coordinated gate update.
- G2 remains blocked until authorized staging, advisors and rollback evidence exist.

## Validation

`npm.cmd run test:supabase-gate-pack` and
`npm.cmd run release:supabase:gates:static` must both pass locally. Neither command
connects to Supabase or promotes G2.
