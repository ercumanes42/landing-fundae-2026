# Checklist ejecutable: Make como scheduler privado

Estado: **OFF / no importable / no production ready**.

Make no es autoridad de datos ni de entrega. No observa Outlook, no contiene destinatarios o copies, no calcula
HMAC, no usa Google Sheets o Data Stores y no envía correos. Data Brain/PostgreSQL posee estado, stop rules,
idempotencia, cadencia, Microsoft Graph y evidencia.

## 0. Gates previos

- [ ] Release selectiva reproducible y CI verde.
- [ ] Migraciones Supabase aplicadas con postcheck, advisors y rollback verificados.
- [ ] Vercel preview con todos los flags outbound exactamente OFF.
- [ ] OAuth de Microsoft Graph y Exchange Application RBAC limitados al buzón piloto.
- [ ] Endpoint privado responde OFF sin reclamar reserva, crear draft ni llamar Graph.
- [ ] Equipo Make y conexión HTTP seleccionados explícitamente por el usuario.
- [ ] Slug y versión exactos del módulo HTTP verificados con las herramientas Make.

Si falta un gate, los escenarios permanecen inactivos.

## 1. Conexión Make

Crear una conexión HTTP para la URL HTTPS de Data Brain. Guardar el bearer en la conexión segura de Make; nunca
en el blueprint, logs, variables, body o query string. Antes de crear escenarios se debe listar las conexiones
disponibles y el usuario debe elegir cuál usar.

No crear conexiones Outlook, Sheets, Calendly ni Data Store para estos flujos.

## 2. Escenario A — campaña fría

- Schedule: cada 60 segundos, Europe/Madrid, una ejecución concurrente.
- Único módulo: POST /api/internal/graph/campaign-dispatch.
- Body: vacío.
- Auth: Authorization: Bearer GRAPH_WORKER_SECRET.
- Spec: make/email_sender_blueprint.json.
- Flags obligatorios OFF durante construcción:
  OUTBOUND_MASTER_ENABLED=false, COLD_CAMPAIGN_ENABLED=false y DB cold_enabled=false.

Data Brain selecciona un único trabajo, revalida stops y freshness, aplica >=60 s entre envíos y <=480/día,
materializa baja, usa el draft ImmutableId, comprueba Sent Items y detiene ante ambigüedad.

## 3. Escenario B — buzón inbound

- Schedule: cada 5 minutos, una ejecución concurrente.
- Único módulo: POST /api/internal/inbound/mailbox.
- Body: vacío.
- Auth: Authorization: Bearer GRAPH_WORKER_SECRET.
- Spec: make/reply_monitor_blueprint.json.
- Flag obligatorio OFF durante construcción: INBOUND_MAILBOX_ENABLED=false.
- Antes del primer tick: INBOUND_MAILBOX_BOOTSTRAP_FROM debe ser un ISO explícito.

Data Brain posee Graph delta, cursor CAS, References/In-Reply-To, replies, NDR, bajas, reuniones, manual review y
stops. Make no lee ni clasifica correos.

## 4. Escenario C — transaccionales

- Schedule: cada 60 segundos, una ejecución concurrente.
- Único módulo: POST /api/internal/graph/dispatch.
- Body: vacío.
- Auth: Authorization: Bearer GRAPH_WORKER_SECRET.
- Spec: make/transactional_dispatch_blueprint.json.
- Flags obligatorios OFF durante construcción:
  OUTBOUND_MASTER_ENABLED=false y TRANSACTIONAL_OUTLOOK_ENABLED=false.

La captura crea un intent privado en su transacción. Data Brain reclama un intent, crea exactamente un draft,
conserva ImmutableId, envía ese mismo draft y confirma solo con evidencia de Sent Items. Make no recibe PII ni
capabilities.

## 5. Calendly

No crear escenario Make. Calendly entrega invitee.created directamente a /api/webhooks/calendly; Data Brain
verifica firma y replay, correlaciona identificadores soportados y materializa el stop.

## 6. Prueba OFF

Para cada escenario:

1. Crearlo inactivo.
2. Verificar URL, método, body vacío, bearer y concurrencia.
3. Ejecutar un único Run once con todos los flags OFF.
4. Exigir respuesta off/deferred, cero reservas, cero drafts y cero tráfico Graph.
5. Repetir el tick y comprobar el mismo resultado.
6. Guardar export sin connection IDs, secretos ni metadata privada.
7. Mantener importable=false, production_ready=false y el escenario inactivo.

## 7. Gates de activación

- Transaccional 4/4: requiere autorización directa separada porque produce cuatro correos internos reales.
- HubSpot sandbox: requiere portal y autorización de escritura separados.
- Campaña: secuencia interna, 10 clientes, microbatch 25 y lotes requieren gates y autorizaciones sucesivas.
- Cualquier timeout de envío, estado ambiguo, alerta crítica o backlog inbound detiene la lane; nunca retry ciego.

La conciliación manual Make/Outlook, los callbacks legacy y el envío directo desde Make están retirados y no son
fallback ni rollback.
