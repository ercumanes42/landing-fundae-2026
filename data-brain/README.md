# Data Brain FUNDAE

App Next.js separada para ingesta, scoring, resumen IA, cola comercial y panel privado.

## Arranque

```bash
cd data-brain
npm install
npm run dev
```

La app corre por defecto en `http://localhost:3005`.

## Variables de entorno

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

Los defaults de arranque son:

```text
OPENAI_MODEL_SUMMARY=gpt-4o-mini
OPENAI_MODEL_ANALYST=gpt-4o
```

Upgrade recomendado cuando la cuenta lo permita:

```text
OPENAI_MODEL_SUMMARY=gpt-5.4-mini
OPENAI_MODEL_ANALYST=gpt-5.5
```

## Supabase

Ejecuta `supabase/schema.sql` en Supabase antes del despliegue. El backend usa `SUPABASE_SERVICE_ROLE_KEY`, por eso esta app no debe exponer claves al frontend.

## Endpoints

- `POST /api/events/ingest`: eventos anonimos de comportamiento, sin PII.
- `POST /api/leads/ingest`: formularios de calculadora, checklist, autodiagnostico, webinar y diagnostico.
- `POST /api/ai/lead-summary`: privado con Basic Auth. Fuerza JSON con OpenAI Responses API usando `text.format: { type: "json_object" }`.
- `POST /api/ai/analyst`: privado con Basic Auth. Usa `OPENAI_MODEL_ANALYST` para preguntas ejecutivas sobre datos/contexto.
- `POST /api/deliveries/retry`: privado con Basic Auth. Reintenta entregas pendientes.
- `POST /api/campaign/import`: privado; recibe lotes de hasta 100 contactos y solo permite carga real con secreto de importacion.
- `POST /api/campaign/operations`: recibe eventos firmados de Make/Outlook.
- `POST /api/campaign/events`: recibe atribucion de la landing mediante `cid`, sin PII.
- `POST /api/webhooks/hubspot`: webhook firmado de HubSpot para cambios comerciales.

## Regla IA critica

Antes de guardar el resumen en Supabase:

```ts
if (summary.confidence < 0.5) {
  summary.recommended_action = "revisar_manual";
}
```

## Reintentos

La cola usa esta secuencia: inmediato, 1 min, 5 min, 15 min, 1 h, 6 h. Si falla todo, el estado pasa a `dead_letter`.

## Verificacion minima

- `/api/ai/lead-summary` devuelve JSON estructurado.
- `confidence < 0.5` fuerza `recommended_action = revisar_manual`.
- Faltan envs criticas -> error claro.
- PostHog y `/api/events/ingest` no reciben PII.
- Los cuatro formularios llegan a `/api/leads/ingest`.
- Fallo de Make genera retry y termina en `dead_letter`.
