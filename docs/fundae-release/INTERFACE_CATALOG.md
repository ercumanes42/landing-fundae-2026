# Interface catalog

## Control switches

| Switch | Default | Contract |
|---|---:|---|
| `OUTBOUND_MASTER_ENABLED` | `false` | Dominante: `false` prohíbe cualquier entrega outbound. |
| `TRANSACTIONAL_OUTLOOK_ENABLED` | `false` | Solo habilita lane transaccional tras G3. |
| `LEGACY_MAKE_DELIVERY_ENABLED` | `false` | Cola legacy inerte; captura no depende de su disponibilidad. |
| `LEGACY_DELIVERY_RETRY_ENABLED` | `false` | Retry exige además Basic Auth admin y confirmación explícita. |
| `OPERATIONAL_OBSERVABILITY_ENABLED` | `false` | Endpoint/RPC agregado; OFF retorna antes de cualquier RPC o red. |
| campaign activation | `false` | Requiere G0-G9 y autorización directa del usuario. |

`accepted_by_make` significa handoff aceptado por Make; nunca equivale a email enviado.

## Capture boundary

- Entrada: payload validado, consentimiento y contexto de journey permitido.
- Salida: lead/event persistido y respuesta estable al navegador.
- Respuesta de lead: `capture_status=captured`, `delivery_status=captured`; `email_delivery_status=pending` nunca confirma envío.
- Invariante: fallo/pausa de Make, Graph, HubSpot o campaign worker no invalida captura.
- Prohibido: enqueue o delivery síncrono como condición de éxito de captura.
- La landing no usa webhooks directos como fallback cuando falta Data Brain.

## Legacy retry boundary

- Requiere simultáneamente master, lane Make y lane retry en `true`.
- Requiere Basic Auth admin y `confirmation=RETRY_LEGACY_DELIVERIES`.
- Dead letters requieren además `deadLetterConfirmation=REQUEUE_LEGACY_DEAD_LETTERS`.
- El resultado `delivered` de esta cola significa aceptación por Make, no email confirmado.

## Transactional Graph outbox

- Clave idempotente: reserva/delivery única por recurso y submission.
- Secuencia: reservar -> crear draft con `Prefer: IdType="ImmutableId"` -> persistir ImmutableId -> enviar el mismo draft -> sondear Sent Items -> persistir Internet Message-ID, hash y `confirmed_sent` -> liberar.
- Invariantes: una reserva crea como máximo un draft; retry reutiliza el draft; timeout/resultado ambiguo detiene y alerta; nunca recrear y reenviar sin reconciliar.

## Journey events

Tipos mínimos: `page_view`, quartiles de vídeo, `tool_start`, steps, `tool_complete`, `tool_abandon`, `download`, `form_submit`, `email_*`, `reply`, `bounce`, `unsubscribe`, `meeting`.

- Cliente: `journey_id`/`session_id` seudónimos, sin PII, solo tras consentimiento aplicable.
- Servidor: unión con `lead_id` únicamente server-side; conservar first/last touch, UTM, referrer sanitizado, magnet y fase.
- Calendly es señal de alta intención atribuida al magnet, no un sexto magnet.

## Data Brain and HubSpot

- Data Brain: fuente analítica, eventos, scoring, entrega y observabilidad.
- HubSpot: CRM comercial; upsert idempotente por `lead_id`.
- Reply positivo: crea/actualiza tarea comercial idempotente.
- Baja, oposición o rebote permanente: supresión inmediata y sincronización convergente en ambos sistemas.

## Campaign worker

- Un worker; `>=60 s` entre envíos; `<=480/día`; `Europe/Madrid`.
- Stop terminal: reply humano, baja/oposición, rebote permanente o reunión Calendly.
- Cada uno de los 4695 emails materializados incluye identificación y baja sencilla.
- Cualquier discrepancia de elegibilidad, draft, estado o correlación: halt + alert; no best-effort send.

## Operational observability

- Endpoint service-only: `GET|POST /api/internal/observability`, bearer dedicado; solo heartbeat/evaluate con actor máquina HMAC derivado en servidor. No expone acknowledge/resolve hasta integrar RBAC dashboard.
- RPC: `record_operational_heartbeat`, `get_operational_observability_snapshot`, `reconcile_operational_alerts`, `transition_operational_alert`.
- Solo agregados y métricas escalares; sin PII, payloads, IDs Graph, Message-ID, emails ni tablas completas.
- Alertas deduplicadas con receipts de evaluación; `open -> acknowledged -> resolved`, con reapertura y auditoría append-only.
- Umbrales, canarios, point-of-no-return y rollback: `OBSERVABILITY_ROLLOUT_RUNBOOK.md`.
