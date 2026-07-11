# Landing FUNDAE + Data Brain

Este proyecto mantiene la landing actual en Vite + React y añade una app separada en `data-brain/` para ingesta, scoring, resumen IA, cola comercial y panel privado.

## Apps

- Landing Vite: captura eventos, UTMs, identidad anonima y formularios.
- Data Brain Next.js: guarda leads en Supabase, calcula scoring 0-100, genera `ai_summary` con OpenAI y sincroniza con Make.

## Imanes confirmados

- Checklist PDF 10 errores: `/checklist-10-errores` -> `#checklist`
- Calculadora: `/calculadora` -> `#calculadora`
- Webinar: `/webinar` -> `#webinar`
- Revision rapida: `/autodiagnostico` -> `#interactive-checklist`
- Diagnostico / Calendly: conversion comercial comun, no iman independiente

## Landing

```bash
npm install
npm run dev
```

Variables principales:

```text
VITE_POSTHOG_KEY
VITE_POSTHOG_HOST
VITE_ENABLE_ANALYTICS
VITE_DATA_BRAIN_INGEST_URL
VITE_CALENDLY_URL
VITE_CHECKLIST_PDF_URL
VITE_WEBINAR_DATE
VITE_WEBINAR_TIME
```

La analitica opcional solo se activa tras el consentimiento del visitante. Los formularios completos van a `/api/leads/ingest`; los enlaces de campana con `cid` se atribuyen a `/api/campaign/events` sin enviar PII a PostHog.

## Data Brain

```bash
cd data-brain
npm install
npm run dev
```

Variables requeridas:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
LEAD_HASH_SECRET
OPENAI_API_KEY
OPENAI_MODEL_SUMMARY=gpt-4o-mini
OPENAI_MODEL_ANALYST=gpt-4o
DATA_BRAIN_ADMIN_USER
DATA_BRAIN_ADMIN_PASSWORD
DATA_BRAIN_ALLOWED_IPS
MAKE_WEBHOOK_URL
AIRTABLE_API_KEY
AIRTABLE_BASE_ID
POSTHOG_PROJECT_API_KEY
LANDING_ALLOWED_ORIGINS
CAMPAIGN_IMPORT_SECRET
MAKE_WEBHOOK_SECRET
HUBSPOT_WEBHOOK_SECRET
HUBSPOT_ACCESS_TOKEN
HUBSPOT_PORTAL_ID
```

Los defaults de arranque son `gpt-4o-mini` para resumen y `gpt-4o` para analista:

```text
OPENAI_MODEL_SUMMARY=gpt-4o-mini
OPENAI_MODEL_ANALYST=gpt-4o
```

Upgrade recomendado cuando la cuenta lo permita:

```text
OPENAI_MODEL_SUMMARY=gpt-5.4-mini
OPENAI_MODEL_ANALYST=gpt-5.5
```

## OpenAI

`POST /api/ai/lead-summary` usa backend y fuerza JSON con Responses API:

```ts
text: {
  format: { type: "json_object" }
}
```

`POST /api/ai/analyst` usa `OPENAI_MODEL_ANALYST` para consultas privadas del panel sobre datos/contexto.

Antes de guardar en Supabase:

```ts
if (summary.confidence < 0.5) {
  summary.recommended_action = "revisar_manual";
}
```

## Supabase

Ejecuta `data-brain/supabase/schema.sql` antes de operar el sistema.

## Campana FUNDAE 2026

El Excel maestro se mantiene fuera de Git en `data-private/`. Consulta [automation/README.md](automation/README.md) antes de importar o configurar Make. Los comandos locales validan el fichero, sus UTMs, los 104 contactos secundarios y la preparacion de la cola antes de cualquier activacion.

## Test plan

- Validar JSON estructurado en `/api/ai/lead-summary`.
- Validar `confidence < 0.5` -> `revisar_manual`.
- Validar error claro si faltan envs criticas.
- Validar que PostHog no recibe PII.
- Enviar formularios de los cuatro imanes.
- Simular fallo de Make y confirmar retries + `dead_letter`.
- Validar scoring `cold`, `warm`, `hot` y `priority`.
- Validar rutas sin UTMs: `direct / none / unattributed`.
