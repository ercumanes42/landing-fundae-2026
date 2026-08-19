# HubSpot idempotency contract

Estado: implementación local OFF. No se ha conectado una cuenta, creado propiedades ni ejecutado sandbox/live.

## Prerrequisitos de portal

Crear y verificar antes de activar:

| Objeto | Propiedad | Contrato |
|---|---|---|
| Contact | `fundae_lead_id` | `string`, `hasUniqueValue=true`; autoridad runtime: el `lead_id` HMAC canónico persistido en `campaign_contacts.email_hash` |
| Company | `fundae_account_id` | `string`, `hasUniqueValue=true` |
| Task | `fundae_task_idempotency_key` | `string`, `hasUniqueValue=true` |

`fundae_contact_id` es una correlación de campaña no única. Dos `external_contact_id` de campañas distintas con el mismo `lead_id` deben resolver al mismo contacto HubSpot. El aprovisionador cold y la importación API calculan `email_hash` con HMAC-SHA256 y `LEAD_HASH_SECRET`; SHA-256 simple no forma parte del contrato.

La captación `/api/leads/ingest` y la importación de campaña invocan la misma función `buildLeadId`, incluida la misma normalización trim/lowercase; existe un test de contrato que falla si cualquiera de los dos caminos deja de usarla.

## Gate de identidad previo a sandbox

El sandbox queda bloqueado si existe una sola fila cold histórica cuyo `email_hash` proceda del SHA-256 simple legacy, o si no puede acreditarse que captación, importación de campaña y aprovisionamiento cold usaron el mismo `LEAD_HASH_SECRET`. Cambiar o rotar `LEAD_HASH_SECRET` cambia todos los `lead_id`: exige reaprovisionamiento o backfill controlado y una nueva prueba de colisiones/replay antes de cualquier escritura HubSpot.

Este cambio de código no migra filas existentes. Hasta ejecutar y verificar ese reaprovisionamiento/backfill fuera de este alcance, no se considera resuelto el gate de datos ni se autoriza el sandbox.

HubSpot documenta propiedades custom únicas y su uso como `idProperty`: [Properties API](https://developers.hubspot.com/docs/api-reference/latest/crm/properties/guide). El upsert parcial de contactos requiere una propiedad custom única; email no ofrece ese contrato: [Contacts API](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/contacts/guide).

## Escrituras

- Contactos: `POST /crm/objects/2026-03/contacts/batch/upsert`, `idProperty=fundae_lead_id`.
- Empresas: `POST /crm/objects/2026-03/companies/batch/upsert`, `idProperty=fundae_account_id`.
- Tareas de reply positivo: el hecho primario ejecuta `POST /crm/objects/2026-03/tasks/batch/upsert`, `idProperty=fundae_task_idempotency_key`, y después la asociación idempotente `task_to_contact`. Replay conserva una única clave/tarea lógica; el eco `contact.propertyChange` de HubSpot registra el hecho local pero crea cero tareas. HubSpot publica ambos contratos en [Tasks API](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/tasks/guide) y [Task batch upsert](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/tasks/batch/upsert-tasks).
- Updates parciales omiten `undefined`/`null`; `""` solo se envía si el llamador pide explícitamente limpiar el campo.
- Cada input usa `objectWriteTraceId`. Un 207 solo se acepta si todos los éxitos y fallos se correlacionan; respuesta ambigua detiene el sync.
- Replay usa la misma propiedad única y no usa endpoints `batch/create` para contactos ni tareas.
- La asociación contact-company usa `POST /crm/associations/2026-03/contacts/companies/batch/associate/default`. Solo se acepta `status=COMPLETE` cuando el campo existe; cualquier otro estado, `numErrors` no entero, `numErrors > 0` o `errors` se materializa como fallo correlacionado y nunca como éxito.

## Webhooks

`eventId` no es único y HubSpot puede duplicar o desordenar notificaciones. La idempotency key local hashea portal, app, subscription, event, object, timestamp, tipo y propiedad. Se exige `contact.propertyChange`, portal configurado y binding DB único; colisiones se rechazan.

La ruta acepta firma v3; si la cabecera v3 no existe, acepta exclusivamente firma CRM v1. Una firma v3 inválida nunca baja a v1. Referencias: [Webhook payload/retries](https://developers.hubspot.com/docs/api-reference/legacy/webhooks/guide) y [request signatures](https://developers.hubspot.com/docs/apps/legacy-apps/authentication/validating-requests).

## Activación

`HUBSPOT_SYNC_ENABLED` debe ser literalmente `true`, el master outbound también y debe existir token para cualquier escritura. El default es OFF. El preflight de propiedades es exclusivamente GET: exige token pero funciona con master y lane OFF. Antes de activar escrituras: verificar las tres propiedades únicas con el endpoint admin de conexión, sandbox/replay, scopes mínimos, portal ID, firma y alertas.
