-- EMPTY_MIGRATION_DECISION_ID: FUNDAE-ADR-20260819-COLD-SCHEDULER-SUPERSEDED
-- PURPOSE: Preserve the immutable migration timestamp without duplicating schema changes.
-- SUPERSEDED_BY: 20260819170000_cold_campaign_scheduler.sql
-- SAFETY: This statement is deterministic, read-only and returns no rows.
select 1
where false;
