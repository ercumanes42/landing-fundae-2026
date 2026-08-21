# Make scheduler setup

La guía ejecutable y los criterios de piloto están en `MAKE_PRODUCTION_CHECKLIST.md`. Este archivo resume el
contrato; no sustituye el blueprint real exportado ni una prueba end-to-end.

## Scenario 1: Cold campaign scheduler (vigente, OFF)

La implementación anterior basada en Google Sheets, Make Data Store y envío directo con Outlook queda **retirada y no operativa**. Se conserva únicamente como historia en Git; no debe reconstruirse ni usarse como rollback.

El único contrato aprobado es:

1. Make programa una sola llamada `POST` con body vacío a `/api/internal/graph/campaign-dispatch`.
2. La ruta exige `Authorization: Bearer GRAPH_WORKER_SECRET`; Basic no autoriza.
3. Data Brain decide contacto, paso, copy materializado, baja, stops, cadencia, cuota, idempotencia y recuperación.
4. Microsoft Graph crea un draft con ImmutableId, envía ese mismo draft y exige evidencia de Sent Items.
5. Make no usa Google Sheets, Data Store, Router, Outlook ni contiene destinatario, copy, token de baja o lógica de decisión.
6. `OUTBOUND_MASTER_ENABLED=false`, `COLD_CAMPAIGN_ENABLED=false` y DB `cold_enabled=false` hasta superar gates y recibir autorización directa.

`make/email_sender_blueprint.json` sigue siendo `importable=false` y `production_ready=false`: faltan slug/conexión/IDs verificados en Make. Véase `../docs/fundae-release/COLD_CAMPAIGN_SCHEDULER_CONTRACT.md`.
## Scenario 2: inbound mailbox tick (vigente, OFF)

1. Make programa una llamada `POST` con body vacío a `/api/internal/inbound/mailbox` cada 5 minutos.
2. La ruta exige `Authorization: Bearer GRAPH_WORKER_SECRET`; Basic no autoriza.
3. Data Brain posee Microsoft Graph delta, cursor CAS, correlación, clasificación, idempotencia y stop rules.
4. Make no observa Outlook, no recibe cuerpos y no clasifica replies o NDR.
5. `INBOUND_MAILBOX_ENABLED=false` hasta configurar un bootstrap ISO y superar los gates.
6. `/baja` resolves the opaque token server-side to `email_hash` and atomically suppresses that identity across
   campaigns, cancels pending/locked work and emits one idempotent `unsubscribe`.
7. Never log query strings, tokens or PII; show the same public completion response for valid/repeated/invalid/expired.

`make/reply_monitor_blueprint.json` permanece `importable=false` y `production_ready=false`.

## Scenario 3: transactional dispatch tick (vigente, OFF)

1. La captura pública crea el intent privado en la misma transacción; no llama Make ni Graph.
2. Make programa una llamada `POST` con body vacío a `/api/internal/graph/dispatch` cada 60 segundos.
3. Data Brain reclama un intent y ejecuta una transición Graph con draft, ImmutableId y prueba de Sent Items.
4. Make no recibe payload de lead, destinatario, copy, adjunto, token de baja ni capacidades Graph.
5. `OUTBOUND_MASTER_ENABLED=false` y `TRANSACTIONAL_OUTLOOK_ENABLED=false` hasta superar los gates y recibir autorización directa para el sandbox 4/4.

`make/transactional_dispatch_blueprint.json` permanece `importable=false` y `production_ready=false`.

## Calendly

Calendly entrega `invitee.created` directamente a `/api/webhooks/calendly`. Data Brain verifica la firma del body
crudo, evita replay y materializa el stop. Make no termina, re-firma ni correlaciona este webhook.

## Readiness

Follow `UNSUBSCRIBE_SETUP.md` for the separate workbook, legal evidence values and tests. The master remains
immutable. JSON blueprints remain configuration specifications, not Make exports or proof of production readiness.

Los contratos HMAC, callbacks y conciliación manual de Make/Outlook pertenecen al gateway legacy retirado. No son
operación final, fallback ni rollback. Los tres escenarios Make vigentes son exclusivamente schedulers privados.
