# Journey retention contract

Status: implemented locally, purge `OFF`. No migration, SQL, scheduler or deletion has run live.

## Scope and policy

- `tracking-contract.ts` defines 90 days for raw consented journey events and 30 days for the browser pseudonym.
- Migration `20260819190000_journey_retention_control.sql` applies only to `public.events`, the raw page/video/tool/form journey table.
- `sessions` is an aggregate and has no approved retention period yet. Campaign, transactional, Graph, inbound and alert evidence are excluded and require their own approved policies.

## Safety contract

- `purge_expired_journey_events(p_before, p_limit, p_apply=false)` requires an explicit cutoff and accepts only cutoffs at least 90 days old.
- Dry-run is the default. Apply also requires the singleton database kill switch `purge_enabled=true`; its migration default is `false`.
- Apply locks the policy row, refreshes `clock_timestamp()`, then deletes at most 10,000 rows selected with `FOR UPDATE SKIP LOCKED` in stable timestamp/ID order.
- Control and audit tables use forced RLS, have no direct service-role table grants, and expose only the service-role RPC. No `pg_cron` schedule is created.
- Each applied batch records cutoff, eligible cutoff, requested limit, candidates and deleted rows without event content or identifiers.

## Activation gate

Before enabling purge: approve the 90-day policy and aggregate retention separately; apply in authorized staging; verify backup, explain/index usage, concurrent workers, dry-run counts, one bounded apply and audit row; then schedule externally only under a separate approved change. G4 remains non-PASS until that evidence exists.
