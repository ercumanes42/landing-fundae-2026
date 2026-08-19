# Matriz técnica de privacidad, cookies y retención — 2026-08-19

Estado: `NO-GO` para presentar Privacidad o Cookies como definitivas. Este documento inventaría el comportamiento local verificable; no fija bases jurídicas, plazos legales, encargados, transferencias ni DPD.

## Convenciones

- `PENDIENTE`: requiere una decisión documentada de la persona responsable; no se infiere del código.
- `OFF`: existe implementación local, pero el switch, scheduler o purga permanece desactivado.
- `NO VERIFICADO`: la fuente admite la integración, pero no demuestra su configuración ni uso en el despliegue.
- Un `expires_at` o una lease operativa limita el uso de una credencial o bloqueo; no equivale a borrado físico ni a una política de conservación.

## Finalidades y datos

| Flujo técnico | Finalidad técnica observada | Categorías de datos observadas | Base jurídica publicada | Retención técnica actual | Gate |
| --- | --- | --- | --- | --- | --- |
| Preferencia de analítica | Recordar aceptar/rechazar | Estado, versión y fecha de decisión | `PENDIENTE` | `localStorage`, sin TTL | Aprobar duración y mecanismo de renovación |
| Journey web opcional | Funnel, atribución y CRO | IDs seudónimos de journey/sesión, URL y referrer, UTM, dispositivo/viewport, eventos page/video/tool/form/download | `PENDIENTE`; el código exige `accepted`, lo que no sustituye la validación jurídica | Navegador: 30 días renovables para journey; sesión con 30 minutos de inactividad; atribución sin TTL. Servidor: propuesta de 90 días, purga `OFF` | Aprobar finalidad, 90 días, terceros y retirada efectiva |
| Captación y entrega de recursos | Registrar solicitud y entregar calculadora/PDF/checklist/webinar | Nombre, email, teléfono, cargo, empresa; respuestas de formulario; atribución, journey, scoring y metadatos de entrega | `PENDIENTE` por finalidad | `public.leads` y colas asociadas sin TTL ni purga | Definir base, información, minimización y plazo |
| Consultas, diagnóstico y reuniones | Responder y gestionar reserva | Identidad/contacto, empresa, mensaje/interés, URL/UTM de reserva y estado de reunión | `PENDIENTE` | Sin TTL local; Calendly/Microsoft conservan además según configuración externa `PENDIENTE` | Aprobar base y retención en cada sistema |
| Scoring y resumen IA | Priorización y apoyo comercial | Scoring, rol, empresa, interés, respuestas, crédito estimado y journey. El resumen individual excluye nombre/email/teléfono; el analista recibe UUID de lead y atributos categóricos | `PENDIENTE` | Resultado almacenado con el lead, sin TTL separado; política del proveedor `PENDIENTE` | Aprobar campos permitidos, revisión humana y proveedor |
| Email transaccional | Entregar el recurso solicitado | Email destinatario, plantilla/recurso, adjuntos, IDs de mensaje, hashes, estados y evidencia de Sent Items | `PENDIENTE` | Claims/reservas/outbox/eventos y buzón sin política de borrado local | Aprobar conservación local y del buzón |
| Campaña comercial | Secuencia de cinco correos y seguimiento | Email directo, nombre, empresa, cargo, IDs externos, hash de email, lote/variante, cuerpo de correo, estados, replies, bounces y reuniones | Premisa operativa de clientes previos/servicios similares aportada; base RGPD, prueba y texto informativo siguen `PENDIENTE` | Contactos, mensajes, ejecuciones y eventos sin TTL ni purga | No activar hasta cerrar información, trazabilidad y exclusiones |
| Baja, oposición y supresión | Detener envíos y evitar recontacto | Hash de identidad/email, alcance, motivo, fecha; token hash y caducidad opcional | `PENDIENTE` | Sin purga. La expiración del token solo invalida su uso; no borra la supresión | Aprobar conservación mínima/máxima y excepciones a borrado |
| Reply, NDR y Calendly inbound | Correlacionar y detener secuencia | Hash de evento proveedor, clase, timestamps, IDs internos y evidencia mínima; el ledger local no persiste cuerpo ni dirección del mensaje | `PENDIENTE` | Ledger/alertas/cursor sin TTL; contenido original permanece en proveedor según política `PENDIENTE` | Aprobar retención y acceso a buzón/reservas |
| HubSpot | CRM comercial y tareas por reply positivo | Contacto, empresa, IDs idempotentes, estados de secuencia/reply/supresión y tarea | `PENDIENTE` | Sin TTL local ni política HubSpot verificada | Aprobar alcance de sync, borrado y contrato |
| Seguridad y rate limit | Prevenir abuso y limitar llamadas | Hash derivado de clave/IP y contadores de ventana | `PENDIENTE` | Expiración lógica por ventana; RPC puede borrar filas expiradas desde hace 1 día, pero no hay schedule acreditado | Aprobar plazo y ejecutar/verificar cleanup |
| Observabilidad y administración | Salud, alertas, RBAC y auditoría | Métricas/contadores, hashes de evidencia/actor, rol, acción, ruta y timestamps | `PENDIENTE` | Heartbeats, alertas, receipts y audit logs sin TTL | Aprobar acceso, granularidad y conservación |

## Inventario de navegador

| Clave | Medio | Escritura actual | Caducidad/borrado implementado |
| --- | --- | --- | --- |
| `fundae_analytics_consent_v1` | `localStorage` | Al aceptar o rechazar | Sin TTL; una versión ausente, inválida o distinta vuelve a `unknown` y purga identificadores analíticos |
| `fundae_journey_v2` | `localStorage` | Solo dentro del tracker consentido | 30 días deslizantes; se elimina al rechazar |
| `fundae_first_touch_v2` | `localStorage` | Solo dentro del tracker consentido | Sin TTL; se elimina al rechazar |
| `fundae_last_touch_v2` | `localStorage` | Solo dentro del tracker consentido | Sin TTL; se elimina al rechazar |
| `fundae_session_v2` | `sessionStorage` | Solo dentro del tracker consentido | Se rota tras 30 minutos de inactividad y termina con la sesión; se elimina al rechazar |
| `fundae_campaign_context_v1` | `sessionStorage` | Contexto UTM de campaña dentro del tracker consentido | Vida de sesión; se elimina al rechazar |
| `fundae_utm` | `sessionStorage` | Hook presente, sin consumidor/importación localizada | Dormante; sin TTL propio si se conectase |
| `fundae_pending_leads` | `localStorage` | No se escribe; solo se elimina como residuo legacy | No es una cola activa |
| `fundae_identity_v1`, `fundae_session_v1`, `fundae_first_touch_v1`, `fundae_last_touch_v1` | Ambos storages | No se escriben; solo figuran en la lista de limpieza | Se eliminan al rechazar o invalidar la versión de consentimiento |

La búsqueda estática no localiza escrituras a `document.cookie` ni carga propia de scripts GA/LinkedIn. `window.gtag` y `window.posthog` se usan si otro runtime los inyecta; además existe envío directo al endpoint PostHog si se configura su key. Por ello, la ausencia de cookies en fuente no sustituye un escaneo del dominio desplegado antes y después de aceptar/rechazar/retirar.

## Datasets servidor y borrado físico

| Dataset | Datos relevantes | Política/TTL local verificado |
| --- | --- | --- |
| `events` | Journey raw seudónimo y propiedades de interacción | Control propuesto de 90 días; `purge_enabled=false`; sin cron. Es el único borrado de datos de journey implementado |
| `sessions` y agregados | Sesión, duración, país/dispositivo/browser y conversión | Tabla referenciada por el dashboard; plazo `PENDIENTE`; no hay borrado en las migraciones revisadas |
| `leads`, `delivery_queue`, intake/reservas/dispatch transaccional | PII, formularios, scores, recursos, estados e idempotencia | Sin TTL/purga |
| `campaigns`, `campaign_contacts`, `campaign_events`, ejecuciones, payloads y dispatch | PII comercial, cuerpos, estados y eventos | Sin TTL/purga |
| `campaign_suppressions`, `campaign_unsubscribe_tokens` | Hashes de identidad, motivo y token | Sin purga; `expires_at` del token no elimina la fila |
| `graph_outbox`, autorizaciones y eventos | IDs/hash de mensaje, estados, evidencias y timestamps | Sin TTL/purga; leases/capabilities no son conservación |
| `inbound_event_ledger`, alertas y cursores | Hashes/metadatos de Graph/Calendly y correlación interna | Sin TTL/purga |
| `operational_*`, `dashboard_principals`, `dashboard_audit_log` | Salud, alertas, hashes/roles/auditoría | Sin TTL/purga |
| `cold_campaign_provision_*` | Manifiestos, hashes, batches y autorización | Sin TTL/purga; expiración solo cierra la capacidad de provisioning |
| `rate_limit_buckets` | Hash y contador | Caduca para la decisión; cleanup físico por RPC y sin scheduler acreditado |

En las migraciones revisadas solo existen dos `DELETE` de mantenimiento: `public.events` mediante la purga acotada y `public.rate_limit_buckets` mediante su RPC de cleanup. No hay prueba local de ejecución en staging o producción.

## Proveedores y transferencias

| Sistema admitido por la fuente | Datos que podría recibir | Activación acreditada por esta auditoría | Encargado, región, subencargados y transferencia |
| --- | --- | --- | --- |
| Vercel/runtime web | Requests, IP/headers y logs según despliegue | Proyecto preparado para Vercel; configuración live no revisada | `PENDIENTE` |
| Supabase | Todos los datasets persistentes anteriores | Código y migraciones presentes; proyecto/región live no revisados | `PENDIENTE` |
| Microsoft 365 / Graph | Destinatarios, correos, adjuntos, drafts, Sent Items, replies y NDR | Runtime implementado; switches deben seguir `OFF` | `PENDIENTE` |
| HubSpot | Contactos, empresas, estados y tareas | Implementado con `HUBSPOT_SYNC_ENABLED=false` por defecto | `PENDIENTE` |
| Calendly | Datos completos de reserva; localmente solo se conserva correlación mínima | Webhook con switch `false` por defecto; URL pública configurable | `PENDIENTE` |
| PostHog | Journey seudónimo, URL/referrer, UTM, dispositivo y eventos | Opcional; key/activación live no verificadas. El host EU del ejemplo no prueba región contractual | `PENDIENTE` |
| Google Analytics (`window.gtag`) | Payload de journey si un script externo lo inyecta | No se carga script en la fuente revisada | `PENDIENTE` o retirar configuración no usada |
| OpenAI | Proyección de lead y contexto analítico seudónimo/categórico | Llamadas implementadas si existe API key y se invocan las rutas | `PENDIENTE` |
| Make | Payloads de automatización si se habilita legacy/scheduler | Legacy `OFF`; blueprints operativos aún no acreditados | `PENDIENTE` |
| Webhook de notificación sin proveedor identificado | La función dormante incluye nombre, email, teléfono, empresa, score y resumen IA; alertas Graph usan hashes | URL opcional; la función de lead prioritario no tiene consumidor localizado | `PENDIENTE`; identificar o eliminar antes de activar |
| Airtable | Variables e indicador de integración | No se localiza llamada API en código productivo | `PENDIENTE` o retirar configuración no usada |

La dependencia `@google/genai`, los identificadores GA4/LinkedIn y el texto “Hotjar” no demuestran tratamientos activos: no se localizó una llamada productiva correspondiente. Deben retirarse si no forman parte del diseño aprobado o incorporarse al inventario contractual y runtime si se activan.

## Decisiones requeridas

1. Aprobar base jurídica e información por cada finalidad, separando entrega solicitada, seguimiento comercial, analítica, IA, seguridad, auditoría y supresión.
2. Aprobar TTL o criterio para cada dataset y proveedor, incluyendo backups, logs, mailbox, CRM, tokens, auditoría y conservación probatoria de bajas/oposiciones.
3. Confirmar canal de derechos y procedimiento; documentar si existe DPD sin inferirlo.
4. Identificar los proveedores realmente contratados, región, subencargados, DPA y mecanismo de transferencia aplicable.
5. Elegir analítica efectiva; ejecutar inventario live antes/después de aceptar, rechazar y retirar; validar que no haya emisión previa.
6. Aprobar qué campos pueden salir a OpenAI y al webhook de notificación; confirmar minimización, acceso y política contractual.
7. Aprobar política de Microsoft 365/Graph para drafts, Sent Items, replies, NDR, adjuntos y auditoría local.
8. Documentar procedencia/prueba de relación previa de los 939 contactos, categorías y texto de primera comunicación, sin confundir la excepción LSSI con la base RGPD.
9. Definir propagación de acceso/rectificación/supresión entre Supabase, HubSpot, Microsoft, Calendly, PostHog, Make y backups, preservando solo la supresión estrictamente necesaria cuando proceda.
10. Aprobar o rechazar la propuesta de 90 días; solo después validar la purga en staging, habilitar su kill switch y crear un scheduler bajo cambio separado.

## Gates

- `PRIVACY-POLICY`: `NO-GO` hasta cerrar decisiones 1–4 y 6–9.
- `COOKIE-POLICY`: `NO-GO` hasta cerrar decisión 5 con evidencia del dominio desplegado.
- `JOURNEY-RETENTION`: implementación local `OFF`; no `PASS` hasta aprobación de 90 días, ejecución en staging, backup/rollback, dry-run, batch aplicado y auditoría.
- `CAMPAIGN-ACTIVATION`: `NO-GO`; esta matriz no autoriza importación, activación ni envío.
- `LIVE-EVIDENCE`: ausente; no se hizo deploy, consulta de proveedor, migración ni borrado.
