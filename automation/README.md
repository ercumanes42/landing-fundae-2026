# FUNDAE Campaign Operations

This folder contains the local, non-production tooling for the FUNDAE 2026 outbound campaign.

The canonical mail runtime is the private Data Brain Microsoft Graph worker. Legacy manual reconciliation
runbooks are `SUPERSEDED`, excluded from the release and must not be executed or used as rollback. Make may
only schedule authenticated empty calls to the canonical worker routes.

The workbook is an immutable import source kept in `data-private/`, which is ignored by Git. Data Brain/PostgreSQL
is the campaign state and delivery authority. HubSpot is the commercial CRM; Make is scheduler-only.

## Safety Defaults

- `CAMPAIGN_DRY_RUN=true` is the default for every import.
- No preparation or validation script sends email.
- The master workbook is read-only; runtime state is materialized in Data Brain/PostgreSQL.
- A campaign cannot be imported with `CAMPAIGN_DRY_RUN=false` unless every row has `validacion_pre_envio=OK`.
- Readiness also requires all 4,695 HTML bodies to contain `{{unsubscribe_url}}` or the final opaque HTTPS `/baja?...token=...` URL.
- Data Brain materializes each contact-specific opaque opt-out URL before a campaign reservation can be sent.
- The preparation script creates a separate operational workbook and refuses to overwrite the master.

## Local Commands

```powershell
$campaignWorkbook = Resolve-Path ".\outputs\019f2767-1254-75b2-8b07-6266b084e94f\Base_FUNDAE_2026_CONTROLADA_GFS_CADENCIA_APROBADA.xlsx"
$env:CAMPAIGN_FILE = $campaignWorkbook.Path
npm run campaign:validate
npm run campaign:tracking
npm run campaign:rebalance
node automation/scripts/validate-operations.mjs
npm run campaign:unsubscribe:test
```

To dry-run the Data Brain import, configure the secrets described in [MAKE_SETUP.md](MAKE_SETUP.md), keep `CAMPAIGN_DRY_RUN=true`, then run:

```powershell
npm run campaign:import
```

To prepare the separate operational copy, follow [UNSUBSCRIBE_SETUP.md](UNSUBSCRIBE_SETUP.md). Generating
the copy does not make the campaign ready: the live unsubscribe handler, atomic global suppression check,
verified Graph worker configuration and controlled internal pilot remain mandatory.

Read [ARCHITECTURE.md](ARCHITECTURE.md), [FIELD_MAPPING.md](FIELD_MAPPING.md), and [MAKE_SETUP.md](MAKE_SETUP.md) before configuring external services.

The JSON files under `automation/make/` are configuration specifications, not Make exports. They remain
`importable=false` and `production_ready=false` until Juan connects and exports the real scenarios.

`make/fundae_transactional_email_matrix_v1.json` contains only the four immediate fulfilment messages
for calculator, interactive checklist, checklist and webinar requests. It is separate from the cold
campaign matrix: it contains no commercial follow-up and no unsubscribe link. Validate its placeholders
and legal separation with `npm run email:transactional:test` before provisioning it in Data Brain.
