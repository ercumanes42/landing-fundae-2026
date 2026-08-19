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

`LEAD_HASH_SECRET` es server-only y debe contener al menos 32 bytes UTF-8 reales, sin espacios iniciales/finales ni marcadores de ejemplo (`replace-with`, `change-me`, `placeholder`, etc.). El setup, `buildLeadId`, los hashes operativos asociados y el aprovisionador cold aplican la misma política y abortan con un código constante sin reflejar el secreto.

## Gate de identidad previo a sandbox

El sandbox queda bloqueado si existe una sola fila cold histórica cuyo `email_hash` proceda del SHA-256 simple legacy, o si no puede acreditarse que captación, importación de campaña y aprovisionamiento cold usaron el mismo `LEAD_HASH_SECRET`. Cambiar o rotar `LEAD_HASH_SECRET` cambia todos los `lead_id`: exige reaprovisionamiento o backfill controlado y una nueva prueba de colisiones/replay antes de cualquier escritura HubSpot.

Este cambio de código no migra filas existentes. Hasta ejecutar y verificar ese reaprovisionamiento/backfill fuera de este alcance, no se considera resuelto el gate de datos ni se autoriza el sandbox.

### Rotación y versionado fail-closed

La versión de la clave se registra como metadato en el gestor de secretos y en la evidencia de release; no se incorpora al `lead_id`, que conserva el contrato hexadecimal de 64 caracteres. El runtime admite exactamente una clave activa: no existe fallback, dual-read ni prueba silenciosa con claves antiguas.

Una rotación es una migración de identidad, no un cambio ordinario de variable. Requiere, en este orden: mantener outbound/import/HubSpot OFF; inventariar todas las identidades y allowlists afectadas; registrar versiones antigua/nueva sin guardar las claves; reaprovisionar o backfillear de forma coordinada; verificar conteos, ausencia de colisiones, replay e integridad HubSpot; cambiar la clave de forma atómica; y retirar la anterior solo tras superar esos gates. Si falta cualquier evidencia o aparece una mezcla de versiones, la activación permanece bloqueada.

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

### Preflight administrativo GET-only

`GET /api/campaign/hubspot/test` reutiliza la autenticación PBKDF2 del dashboard,
aplica rate-limit fail-closed y responde siempre con
`Cache-Control: private, no-store`. Una petición no autenticada no alcanza el
rate-limit compartido ni ejecuta ningún fetch HubSpot.

El preflight compara `HUBSPOT_PORTAL_ID` con
`GET /account-info/2026-03/details` y descarga, solo mediante GET, los catálogos
de propiedades de contacts, companies y tasks. El manifiesto declarativo
`HUBSPOT_PROPERTY_MANIFEST` contiene las 33 propiedades estándar/custom que el
runtime lee o escribe, junto con tipo y unicidad esperados. El reporte no expone
token, portal ID, cuerpo upstream, correlation ID ni mensajes HubSpot; solo
estado, conteos y un código/check estable.

Un missing, tipo/unicidad incorrectos, portal distinto, 401/403, 207 o respuesta
mal formada mantiene el preflight en NO-GO. Este gate estático no acredita por sí
solo scopes, asociaciones, webhooks ni replay: requieren sandbox autorizado.
