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
RATE_LIMIT_TRUSTED_IP_HEADER
LANDING_ALLOWED_ORIGINS
CAMPAIGN_IMPORT_SECRET
MAKE_WEBHOOK_SECRET
UNSUBSCRIBE_TOKEN_SECRET
UNSUBSCRIBE_PUBLIC_BASE_URL
HUBSPOT_WEBHOOK_SECRET
HUBSPOT_ACCESS_TOKEN
HUBSPOT_PORTAL_ID
```

Los defaults de arranque son:
## Puerta de configuracion

Antes de un piloto o despliegue:

```powershell
npm.cmd run verify:release
npm.cmd run db:verify:network
```

La primera orden no usa red y falla ante secretos debiles/repetidos, password administrativo menor de 16 bytes,
origenes inseguros o URL de baja local en produccion. La segunda valida explicitamente la conectividad y el esquema
de campana requerido en Supabase (tablas y RPC). OpenAI, HubSpot, PostHog y alertas son integraciones opcionales;
su ausencia debe mostrarse como funcion desactivada, no como exito.

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
- `POST /api/campaign/unsubscribe-link`: firmado por Make; emite un enlace opaco sin PII para un contacto de campaña.
- `GET /baja`: muestra confirmación; nunca modifica datos para evitar bajas provocadas por escáneres de enlaces.
- `POST /baja`: registra la baja global e idempotente, cancela ejecuciones planificadas y limpia locks.
- `POST /api/campaign/delivery-authorization`: gate HMAC obligatorio inmediatamente antes de Outlook.
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

## Baja y autorización de envío

Orden de produccion (con copia de seguridad confirmada):

1. Pausar ingesta y escenarios de Make.
2. Ejecutar `supabase/migrations/20260811_preflight.sql` (solo lectura).
3. Ejecutar `20260811_production_hardening.sql`, `20260811_tracking_control.sql` y `20260811_unsubscribe_flow.sql`, en ese orden.
4. Ejecutar `supabase/migrations/20260811_postcheck.sql` (solo lectura).
5. Reanudar escritores solo si devuelve `migration_postcheck_ok`.

El bootstrap `supabase/schema.sql` mantiene paridad exacta con los tres bloques mutantes.

Aplica `supabase/migrations/20260811_unsubscribe_flow.sql` después de las migraciones de hardening y tracking, siempre con copia de seguridad. El bootstrap `supabase/schema.sql` contiene el mismo bloque.

Secuencia obligatoria en Make:

1. Generar el enlace con `POST /api/campaign/unsubscribe-link` y añadirlo al cuerpo y a los encabezados `List-Unsubscribe`/`List-Unsubscribe-Post`.
2. Registrar `delivery_scheduled` con una `execution_key` única.
3. Justo antes del módulo Outlook, llamar a `POST /api/campaign/delivery-authorization` con `campaign_external_id`, `contact_id` y `execution_key`.
4. Enviar únicamente cuando la respuesta contenga `authorized: true`. Todo error, timeout o `authorized: false` detiene esa ejecución.
5. Registrar `delivery_sent` solo después de que Outlook confirme el envío.

Los enlaces usan un token opaco HMAC; la URL no contiene email, `email_hash`, `contact_id` ni payload decodificable. Supabase guarda solo SHA-256 del token. La baja se propaga por `email_hash` a todas las campañas y el trigger impide reactivar o reimportar accidentalmente una identidad suprimida.

`MAKE_WEBHOOK_SECRET` y `UNSUBSCRIBE_TOKEN_SECRET` deben ser secretos diferentes, aleatorios, de al menos 32 bytes. Los placeholders se rechazan en runtime.

El gate JIT reduce al mínimo la carrera con una baja, pero ningún sistema externo puede eliminar por completo el intervalo entre recibir `authorized: true` y la llamada a Outlook. Por eso Make debe colocar ambos módulos consecutivos, sin reintentos ciegos ni pasos intermedios.
