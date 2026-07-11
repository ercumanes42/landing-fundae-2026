# FUNDAE Campaign Operations

This folder contains the local, non-production tooling for the FUNDAE 2026 outbound campaign.

The workbook is always the immutable source file. Keep it in `data-private/`, which is ignored by Git. Google Sheets is the visible Make queue. HubSpot is the commercial CRM. Data Brain is the analytics and audit layer.

## Safety Defaults

- `CAMPAIGN_DRY_RUN=true` is the default for every import.
- No script sends an Outlook email.
- The master workbook is read-only; Make updates only the Google Sheets operational copy.
- A campaign cannot be imported with `CAMPAIGN_DRY_RUN=false` unless every row has `validacion_pre_envio=OK`.

## Local Commands

```powershell
$env:CAMPAIGN_FILE = "$HOME\Downloads\Base_FUNDAE_2026_LISTA_MAKE_939.xlsx"
npm run campaign:validate
npm run campaign:tracking
npm run campaign:rebalance
```

To dry-run the Data Brain import, configure the secrets described in [MAKE_SETUP.md](MAKE_SETUP.md), keep `CAMPAIGN_DRY_RUN=true`, then run:

```powershell
npm run campaign:import
```

Read [ARCHITECTURE.md](ARCHITECTURE.md), [FIELD_MAPPING.md](FIELD_MAPPING.md), and [MAKE_SETUP.md](MAKE_SETUP.md) before configuring external services.
