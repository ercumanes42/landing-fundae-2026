# FUNDAE Campaign Operations

This folder contains the local, non-production tooling for the FUNDAE 2026 outbound campaign.

The workbook is always the immutable source file. Keep it in `data-private/`, which is ignored by Git. Google Sheets is the visible Make queue. HubSpot is the commercial CRM. Data Brain is the analytics and audit layer.

## Safety Defaults

- `CAMPAIGN_DRY_RUN=true` is the default for every import.
- No script sends an Outlook email.
- The master workbook is read-only; Make updates only the Google Sheets operational copy.
- A campaign cannot be imported with `CAMPAIGN_DRY_RUN=false` unless every row has `validacion_pre_envio=OK`.
- Readiness also requires all 4,695 HTML bodies to contain `{{unsubscribe_url}}` or the final opaque HTTPS `/baja?...token=...` URL.
- The operational Google Sheet, never the immutable master, is responsible for injecting each contact-specific opt-out URL.
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
Make export and controlled Outlook pilot remain mandatory.

Read [ARCHITECTURE.md](ARCHITECTURE.md), [FIELD_MAPPING.md](FIELD_MAPPING.md), and [MAKE_SETUP.md](MAKE_SETUP.md) before configuring external services.

The JSON files under `automation/make/` are configuration specifications, not Make exports. They remain
`importable=false` and `production_ready=false` until Juan connects and exports the real scenarios.

`make/fundae_transactional_email_matrix_v1.json` contains only the four immediate fulfilment messages
for calculator, interactive checklist, checklist and webinar requests. It is separate from the cold
campaign matrix: it contains no commercial follow-up and no unsubscribe link. Validate its placeholders
and legal separation with `npm run email:transactional:test` before mapping it in Make.
