# HubSpot idempotency contract

Estado: implementación local OFF. No se ha conectado una cuenta, creado propiedades ni ejecutado sandbox/live.

## Prerrequisitos de portal

Crear y verificar antes de activar:

| Objeto | Propiedad | Contrato |
|---|---|---|
| Contact | `fundae_contact_id` | `string`, `hasUniqueValue=true`; autoridad runtime: `campaign_contacts.external_contact_id`, nunca email. Si el origen es un lead, su identificador estable debe materializarse previamente en ese campo |
| Company | `fundae_account_id` | `string`, `hasUniqueValue=true` |
| Task | `fundae_task_idempotency_key` | `string`, `hasUniqueValue=true` |

HubSpot documenta propiedades custom únicas y su uso como `idProperty`: [Properties API](https://developers.hubspot.com/docs/api-reference/latest/crm/properties/guide). El upsert parcial de contactos requiere una propiedad custom única; email no ofrece ese contrato: [Contacts API](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/contacts/guide).

## Escrituras

- Contactos: `POST /crm/objects/2026-03/contacts/batch/upsert`, `idProperty=fundae_contact_id`.
- Empresas: `POST /crm/objects/2026-03/companies/batch/upsert`, `idProperty=fundae_account_id`.
- Tareas de reply positivo: `POST /crm/objects/2026-03/tasks/batch/upsert`, `idProperty=fundae_task_idempotency_key`; después asociación idempotente `task_to_contact`. HubSpot publica ambos contratos en [Tasks API](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/tasks/guide) y [Task batch upsert](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/tasks/batch/upsert-tasks).
- Updates parciales omiten `undefined`/`null`; `""` solo se envía si el llamador pide explícitamente limpiar el campo.
- Cada input usa `objectWriteTraceId`. Un 207 solo se acepta si todos los éxitos y fallos se correlacionan; respuesta ambigua detiene el sync.
- Replay usa la misma propiedad única y no usa endpoints `batch/create` para contactos ni tareas.

## Webhooks

`eventId` no es único y HubSpot puede duplicar o desordenar notificaciones. La idempotency key local hashea portal, app, subscription, event, object, timestamp, tipo y propiedad. Se exige `contact.propertyChange`, portal configurado y binding DB único; colisiones se rechazan.

La ruta acepta firma v3; si la cabecera v3 no existe, acepta exclusivamente firma CRM v1. Una firma v3 inválida nunca baja a v1. Referencias: [Webhook payload/retries](https://developers.hubspot.com/docs/api-reference/legacy/webhooks/guide) y [request signatures](https://developers.hubspot.com/docs/apps/legacy-apps/authentication/validating-requests).

## Activación

`HUBSPOT_SYNC_ENABLED` debe ser literalmente `true` y debe existir token. El default es OFF. Antes de cambiarlo: verificar las tres propiedades únicas con el endpoint admin de conexión, sandbox/replay, scopes mínimos, portal ID, firma y alertas. Esto no habilita outbound ni campaña.
