# Supabase pilot release evidence — 2026-08-12

## Scope

- Project ref: `vftwranrgvbtqfiwtqjz`
- Project name: `data-brain-fundae`
- Campaign: `FUNDAE_2026_EMAIL_V1`
- Safety state during the release: `status=draft`, `is_active=false`
- No Make or Outlook send was enabled and no campaign email was sent.

## Backup

Backup directory:

`C:\Users\JuanMartínezCarrillo\Documents\FUNDAE-Supabase-Backups\20260812T100522Z-pre-release-vftwranrgvbtqfiwtqjz`

| Dump | Bytes | SHA-256 |
| --- | ---: | --- |
| Schema | 17,877 | `414ED91CF1FD8024340AA36F362F00D67FA075296D032B772D6CE91F5A876ECB` |
| Data | 1,363,805 | `FEF8E326B140DBBD7744336E4DC251F07EAA1DDD087852CCEF8B59D0DEE6AC05` |
| Roles | 358 | `4350A72B5EC109888E740C17F3EB4DA2FCD95AB73AF26499538ED0BF615DB543` |

The directory ACL was restricted to the current Windows user and `SYSTEM`. Each dump was encrypted with Windows EFS and its hash was verified again after encryption. The dumps were structurally inspected. A restore into a separate Supabase project was not executed.

## SQL artifacts

| Artifact | SHA-256 |
| --- | --- |
| `20260811_release_gate.sql` | `6E792E6CADCAFFF6315992F141EB0DB433E625262A20E8B672332534157D4253` |
| `20260811_preflight.sql` | `7BE6E44C8651E07C676B41F7FAAD645C64EC52893935464023561D38EFD47257` |
| `20260811_production_hardening.sql` | `856E322A8641D1AD30022B51924EA9CAC62C3A6BDCC4ABC5371010167869285E` |
| `20260811_tracking_control.sql` | `CDEB66D5C6F6493BC2373EB64D78CDA086EF8C5A49585D5EF43E4E94B7B4E8A7` |
| `20260811_unsubscribe_flow.sql` | `983D3C2208B96117075C4A7187B39F50A8DB533EADAD237443B75B2FEE6F62EF` |
| `20260812_distributed_rate_limit.sql` | `3894DB93397F01746AEDEE21AC4076E4EE38453C63BA4FBA77757B758C0DFDB4` |
| `20260811_postcheck.sql` | `042FD9FEA35090165386FA9E0AFBF643403E5FDAD10704F2589FAD7AC4E2246C` |
| `PILOT_SMOKE_20260812.sql` | `7A4E7EE97F83BF73F6DF2264C37D61B9908F958C6C5556645DF19E751D5FA1A3` |

## Execution record

1. Release gate passed with `release_gate_ok`.
2. Read-only preflight passed. Optional analytics tables `sessions` and `crm_deals` were present.
3. `20260811_production_hardening.sql` applied successfully.
4. `20260811_tracking_control.sql` applied successfully.
5. The first unsubscribe migration attempt failed inside its transaction because PostgreSQL does not allow a record variable in a multi-item `INTO` list. The transaction rolled back completely.
6. The unsubscribe function was corrected to load the contact row and campaign state in separate `SELECT INTO` statements. The bootstrap schema and regression tests were updated with the same invariant.
7. The corrected `20260811_unsubscribe_flow.sql` applied successfully.
8. `20260812_distributed_rate_limit.sql` applied successfully.
9. Postcheck passed with `migration_postcheck_ok`.
10. A PII-free, rollback-only smoke test passed with `pilot_smoke_ok`:
    - 2 synthetic contacts
    - delivery scheduling idempotency
    - just-in-time authorization
    - opaque unsubscribe token issue and consumption
    - global suppression propagated to sibling contacts
    - authorization failed closed after suppression
    - distributed rate limit allowed two requests and blocked the third
11. The smoke transaction rolled back. Baseline counts were unchanged: 13 leads, 697 events, 13 delivery queue rows, 1 campaign, 0 campaign contacts, 0 campaign events, 0 executions, 0 suppressions, 0 unsubscribe tokens and 0 rate-limit buckets.
12. Network schema verification passed for all required tables and RPCs.

## Application verification

- Functional tests: 61 passed, 0 failed.
- Setup/readiness tests: 10 passed, 0 failed.
- TypeScript check: passed.
- Next.js production build: passed.

## Remaining release gates

- The operational workbook has 939 contacts, but 0/939 are currently legally ready for a real campaign.
- The operational copy still requires unsubscribe content injection across 4,695 message bodies.
- Make and Outlook remain disabled until a synthetic allowlist-only E2E is configured and approved.
- OpenAI integration remains optional and disabled.
- The temporary Supabase personal access token must be revoked after this release session.
