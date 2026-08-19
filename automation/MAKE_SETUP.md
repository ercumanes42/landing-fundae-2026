# Make + Outlook 365 Setup

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
## Scenario 2: reply and unsubscribe

1. Watch Outlook and match only stored `conversation_id`/`message_id`.
2. Classify POSITIVA, NEGATIVA, INFORMACION, DERIVACION, REUNION or BAJA.
3. Stop sequence, clear locks and POST the canonical event.
4. `/baja` resolves the opaque token server-side to `email_hash` and atomically suppresses that identity across
   campaigns, cancels pending/locked work and emits one idempotent `unsubscribe`.
5. Never log query strings, tokens or PII; show the same public completion response for valid/repeated/invalid/expired.

## Contrato HMAC transaccional vigente

Data Brain firma el JSON textual antes de enviarlo a Make: HMAC-SHA256 hex minúsculo sobre
`timestamp + "." + rawBody`, con Unix seconds y tolerancia de cinco minutos. Make reenvía a
`/api/transactional/intake-authorization` el body textual idéntico y únicamente los headers originales
`X-Make-Signature` y `X-Make-Timestamp`.

Make nunca almacena, recibe ni calcula `MAKE_WEBHOOK_SECRET`. Los pasos posteriores usan capabilities opacas
de un solo uso. Body reserializado, header ausente/duplicado, timestamp vencido o firma inválida fallan cerrado.

## Readiness

Follow `UNSUBSCRIBE_SETUP.md` for the separate workbook, legal evidence values and tests. The master remains
immutable. JSON blueprints remain configuration specifications, not Make exports or proof of production readiness.

## Fase transaccional desplegada, todavía OFF

- Fase 1 compatible con procesamiento secuencial: `gateway:CustomWebHook` -> `http:ActionSendData`.
- No usar `gateway:WebhookRespond`: Make no lo admite cuando `sequential=true`. El Router se añadirá solo
  cuando cada rama tenga su primer consumidor real.
- Sin Microsoft, conexiones, destinatarios, copy, PDF, mailbox, callback ni capacidad de envío.
- Próxima prueba: ventana manual `Run once`, sonda sin PII, `400 invalid_request` con firma válida y
  `401 invalid_signature` al alterar un byte. Cerrar con escenario OFF, hook desactivado, cola cero y deltas DB cero.
- No probar mailbox/callback en producción durante esta fase. Nunca activar los 939.
