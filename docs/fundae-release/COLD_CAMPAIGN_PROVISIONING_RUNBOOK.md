# Cold campaign provisioning runbook

Status: local implementation only, OFF and `G7 NO-GO`. No SQL, network, deploy or send has been executed.

## Safe dry-run

Run `npm run campaign:provision:dry-run`. It reads only `data-private/Base_FUNDAE_2026_CONTROLADA_OFF_V1.xlsx` and the controlled report, verifies their hashes, 939 contacts, 4,695 payloads, lots 235/235/235/234, the approved five-date cadence/copies and unsubscribe placeholder coverage. Output is aggregate and contains no PII.

Current expected result is exit code 2 with exactly: `VALIDATION_NOT_OK`, `TECHNICAL_EXCLUSIONS_NOT_CLEAR`, `CAMPAIGN_NOT_AUTHORIZED`. Any gate prevents row/manifest preparation and all network.

## Explicit apply boundary

`npm run campaign:provision:apply` exists but is prohibited until the controlled workbook is READY, every exclusion is CLEAR, authorization is AUTHORIZED, migration `20260819200000_cold_campaign_provisioning.sql` is applied in an authorized staging environment and the user directly authorizes this phase.

Apply additionally requires all independent gates: DB `cold_campaign_provision_control.enabled=true` bound to the exact manifest, authorization hash, actor hash and expiry; outbound master/cold both OFF; `COLD_CAMPAIGN_PROVISIONING_ENABLED=true`; exact apply acknowledgement; actor hash; authorization token; HTTPS Supabase endpoint; service role; and unsubscribe secret/origin. No Basic credential is accepted.

The RPC imports idempotent batches of at most 500, rejects replay drift/collisions, binds lower-case email, recipient, token, payload and row hashes, and finalizes only 939/4,695 complete rows. A successful prepare persists the campaign as inactive/draft and disables provisioning again. It never enables the sender.

## Rollback / evidence

Before any staging apply, preserve a DB backup and the aggregate manifest hash. Rollback is forward-only: set provisioning control OFF, retain manifest/batch audit rows and keep outbound master/cold OFF. Partial batches cannot finalize and must not be deleted. A new controlled copy or authorization requires a new manifest binding.