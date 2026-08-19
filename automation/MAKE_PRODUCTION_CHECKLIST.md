# Checklist ejecutable: Make + Outlook + Calendly

Estado: **paquete local de construcción**. Los JSON de `automation/make/` son especificaciones, no blueprints
importables. Esta checklist no prueba conexiones, permisos, datos reales ni producción.

> **Bloqueo vigente:** la campaña fría y sus 939 contactos permanecen apagados. Las secciones 3–5 documentan
> arquitectura futura, no autorizan su construcción ni ejecución. Make nunca almacena, conoce ni calcula
> `MAKE_WEBHOOK_SECRET`; tampoco persiste firmas, bodies, cabeceras o capacidades en variables, blueprints,
> logs o Data Stores.

## 0. Puertas antes de abrir Make

- [ ] Migraciones `production_hardening`, `tracking_control` y `unsubscribe_flow` aplicadas y postcheck sin errores.
- [ ] Copia operacional de Google Sheets creada desde el Excel controlado; el maestro permanece intacto.
- [ ] `validacion_pre_envio=OK` solo en contactos con las cuatro evidencias jurídicas documentadas.
- [ ] Campaña en Data Brain con estado `pilot`, activa, contactos internos importados y secuencia de intención apagada.
- [ ] Data Brain publicado por HTTPS y con `MAKE_WEBHOOK_SECRET` fuerte, almacenado solo en Data Brain. Make no
      conoce este secreto.
- [ ] `UNSUBSCRIBE_PUBLIC_BASE_URL` apunta al dominio HTTPS definitivo y `/baja` funciona por GET y POST.
- [ ] Los cinco HTML contienen exactamente un `{{unsubscribe_url}}`; emails 6 y 7 no están en la cola.
- [ ] Remitente, reply-to, firma y pie legal revisados para España: `jgpino@gfs.es`.

Si una puerta falla, no activar escenarios ni hacer pruebas con destinatarios externos.

## 1. Conexiones y almacenes

Crear con nombres inequívocos:

1. `M365 GFS - jgpino@gfs.es`: conexión Microsoft 365 Email. Verificar el buzón mostrado antes de guardar.
   Permisos mínimos según los módulos usados: `Mail.Send`; el monitor y las respuestas también requieren
   `Mail.Read`/`Mail.ReadWrite`, `offline_access` y `User.Read`.
2. `Sheets GFS - FUNDAE operational`: acceso solo a la copia operacional. Prohibido seleccionar el Excel maestro.
3. `Calendly GFS - Diagnostico`: cuenta y tipo de evento definitivos. Los webhooks de Calendly requieren un plan
   compatible; usar `invitee.created` para reservas confirmadas.
4. `HTTP Data Brain`: conexión/base URL HTTPS sin barra final y **sin secretos HMAC**. Las capacidades opacas solo
   pueden viajar en el bundle en memoria durante la ejecución autorizada; nunca se guardan en variables de escenario,
   Sheets, URLs, logs, blueprints ni Data Stores.
5. Data Store `FUNDAE_DELIVERY_LOCKS_V1`: clave `campaign_id:contact_id:paso_actual`; valor con `execution_key`,
   `lock_token`, `locked_at`, `expires_at`, `status` y provider IDs no sensibles.
6. Data Store `FUNDAE_MANUAL_REVIEW_V1`: incidencias sin cuerpo del correo ni PII; guardar solo IDs opacos, código,
   escenario y fecha.

Microsoft publica límites superiores de Exchange, pero también recomienda un proveedor especializado para correo
comercial masivo. Esta campaña aplica límites internos más conservadores: un destinatario por mensaje, 60 segundos
mínimos, 60/hora y 480/día. Verificar además en Exchange Admin Center los límites reales del tenant y el buzón.

## 2. Límites de confianza y autorización

### 2.1 Piloto transaccional aprobado

1. Data Brain serializa una sola vez el payload de salida, firma
   `timestamp + "." + rawBody` con HMAC-SHA256 y envía la firma hexadecimal minúscula. El secreto solo existe en
   Data Brain.
2. `Custom Webhook` conserva el body textual y las cabeceras `X-Make-Timestamp` y `X-Make-Signature` originales.
   Make reenvía ambos **sin parsear, normalizar ni reserializar el body** a
   `/api/transactional/intake-authorization`.
3. Solo una respuesta autorizada entrega claims sin PII, `payload_sha256` y una capacidad opaca de un solo uso.
   Make nunca persiste ni registra body, cabeceras, firma, claims o capacidades.
4. PDF, reserva de buzón y callback usan las capacidades opacas emitidas por Data Brain. Ningún módulo Make calcula
   HMAC ni recibe `MAKE_WEBHOOK_SECRET`.
5. El gate de buzón atómico se ejecuta inmediatamente antes de Outlook. Un único worker procesa secuencialmente:
   máximo 2 correos por tanda, al menos 60 segundos entre ambos y al menos 120 segundos antes de otra tanda.
6. Timeout ambiguo o 429 detiene el flujo y exige conciliación; nunca activa un retry automático de Outlook.
7. En la prueba inicial Outlook está ausente, el escenario permanece OFF y `MAKE_WEBHOOK_URL` no se configura.

### 2.2 Campaña fría bloqueada

Las llamadas Data Brain descritas en las secciones 3–5 requieren un mecanismo futuro de autorización server-side
basado en capacidades. Make no puede firmarlas ni calcular HMAC. Mientras ese mecanismo no exista, esos escenarios
deben permanecer OFF y no se puede cargar, programar ni procesar ningún destinatario de la campaña fría.

Para cualquier llamada autorizada, solo HTTP 2xx con el JSON esperado permite continuar. Timeout, 401, 400, 429,
5xx, JSON inválido o campo ambiguo detienen la ruta. Nunca registrar cabeceras, body, enlace de baja ni token.

Identificadores canónicos: entre 3 y 128 caracteres, solo letras, números, `_ . : -`. Para IDs de Outlook o
Calendly, usar un SHA-256 hex y prefijo estable; no enviar el ID crudo si contiene `@`, `<`, `>` o PII.

## 3. Escenario A — `FUNDAE 2026 Email Sender`

Configuración: cada 5 minutos, `Europe/Madrid`, solo 09:00–18:00, procesamiento secuencial, una ejecución simultánea,
máximo 5 filas por ciclo.

Orden exacto:

1. **Scheduler**.
2. **Google Sheets / Search Rows** ordenado por `proximo_envio_at`, `lote_envio`, `orden_envio_franja`, `contact_id`.
   Filtro: vencida; `PENDING`; paso 1–5; `validacion_pre_envio=OK`; evidencia jurídica completa; sin respuesta,
   baja, hard bounce, reunión, oportunidad, supresión, recurso completado ni lock vivo.
3. **Data Store / Get a record**. Si existe lock vivo o resultado definitivo para la clave, detener ese bundle.
4. **Filtro condicional**. Cuando el contacto depende del primario, detener si el primario ya interactuó o paró.
5. **Set variables**: `execution_key=campaign_id:contact_id:email:E{paso_actual}` y `source_event_id` único.
6. **HTTP Data Brain / tracking `delivery_scheduled`**, sujeto a la autorización server-side aún no disponible,
   con `scheduled_for` y `properties.step`. Continuar solo si
   `ok === true` y `eventId`, `executionId` y `duplicate` tienen el tipo esperado. `duplicate:true` es un retry
   idempotente válido; no significa que el email ya se enviara.
7. **Google Sheets / LOCKED** y **Data Store / Put record** solo después de la planificación confirmada. Lease local
   máximo 120 segundos; si vence, reconciliar antes de desbloquear.
8. **HTTP Data Brain / unsubscribe-link**, sujeto a autorización server-side. Exigir URL HTTPS del origen
   configurado, ruta `/baja`, un único parámetro
   `token=u1.<43 base64url>`. Sustituir `{{unsubscribe_url}}` solo en memoria y comprobar que no quede el placeholder.
9. **HTTP Data Brain / delivery-authorization**, inmediatamente antes de Outlook y sujeto a autorización
   server-side, con el mismo `execution_key`. Solo
   `authorized === true` y lease vigente permiten seguir. No reintentar automáticamente una autorización consumida.
10. **Microsoft 365 Email**: `Send an Email` para E1; para E2–E5 usar `Reply to an Email` solo si el provider ID
    almacenado corresponde al hilo. Un destinatario, sin BCC masivo.
11. **Confirmación y persistencia**: guardar `message_id`, `internet_message_id`, `conversation_id` y `sent_at` solo
    después de respuesta confirmada del proveedor.
12. **HTTP Data Brain / tracking**, sujeto a autorización server-side: `delivery_sent` tras confirmación o
    `delivery_failed` tras fallo conocido. Mismo
    `execution_key`; `source_event_id` distinto y derivado del hash del evento/proveedor.
13. **Sheets + Data Store**: resultado final, incrementar paso y calcular siguiente fecha. Después de E5, `COMPLETED`.
14. **Sleep** mínimo 60 segundos antes del siguiente bundle.

Error handlers:

- Timeout desconocido de Outlook: marcar `RECONCILE_REQUIRED`, buscar en Sent Items por provider IDs/ventana y no
  reenviar hasta resolver. Si aparece, registrar `delivery_sent`; si se confirma ausencia, liberar manualmente.
- 429/transitorio antes de Outlook: 1 min, 15 min y 1 h; después `MANUAL_REVIEW`. La planificación es idempotente.
- Fallo después de Outlook confirmado: reintentar solo tracking/persistencia, nunca Outlook.

Payload mínimo de planificación:

```json
{"campaign_external_id":"FUNDAE_2026_EMAIL_V1","contact_id":"F26-A-0001","event_name":"delivery_scheduled","source_event_id":"make:schedule:<safe-id>","execution_key":"FUNDAE_2026_EMAIL_V1:F26-A-0001:email:E1","channel":"email","capture_method":"automation","occurred_at":"<ISO>","scheduled_for":"<ISO>","properties":{"step":1,"template_id":"email_1"},"context":{"provider":"make","campaign_version":"v1","timezone":"Europe/Madrid"}}
```

## 4. Escenario B — `FUNDAE 2026 Reply and NDR Monitor`

Configuración: `Microsoft 365 Email > Watch Emails`, buzón `jgpino@gfs.es`, cada 5 minutos. Procesar solo mensajes
nuevos; guardar cursor/checkpoint del módulo.

Orden exacto:

1. Watch Emails.
2. Router: respuesta humana / NDR / irrelevante.
3. Correlación determinista: respuestas por `conversation_id`, `In-Reply-To` o `References`; NDR por
   `original_internet_message_id` y destinatario original. El email solo no es correlación suficiente.
4. Si no hay una coincidencia única, crear `MANUAL_REVIEW`; no cambiar estado ni emitir evento.
5. Respuesta humana: clasificar `POSITIVA`, `NEGATIVA`, `INFORMACION`, `DERIVACION`, `REUNION` o `BAJA`. La IA puede
   sugerir, pero baja, reunión y ambigüedad requieren reglas deterministas o revisión humana.
6. Para cualquier respuesta confirmada, detener la secuencia en Sheets, limpiar lock y emitir `reply_received` con
   `properties.reply_type`; nunca enviar el cuerpo o datos personales a Data Brain.
7. `BAJA`: solo tras una clasificación determinista o revisión humana, solicitar autorización server-side y
   emitir `unsubscribe` al
   endpoint canónico `/api/campaign/tracking`, con `source_event_id` idempotente derivado del mensaje y sin PII.
   La inserción activa `campaign_events_propagate_unsubscribe`, que aplica la supresión global por `email_hash`,
   detiene identidades hermanas y cancela ejecuciones planificadas. Exigir `ok === true`.
8. NDR: emitir `bounce_hard` solo con DSN permanente confirmado (por ejemplo clase 5.x.x). Soft bounce o causa
   desconocida va a retry/revisión y no crea supresión permanente.
9. Solicitar autorización server-side para `reply_received`/`bounce_hard` y exigir `ok === true`; misma
   `execution_key` del email correlacionado y `source_event_id` derivado del hash del mensaje.

## 5. Escenario C — `FUNDAE 2026 Calendly Confirmed Bookings`

Prerequisito: la landing debe enviar `utm_source=fundae_landing`, `utm_medium=campaign`,
`utm_campaign=<campaign_external_id>` y `utm_content=<contact_id>`. Mantiene `cid`/`campaign_id` por compatibilidad,
pero Make solo confía en los UTM admitidos por Calendly. No hay email ni nombre en esos valores.

Orden exacto:

1. Trigger oficial/native Calendly o webhook registrado para `invitee.created`.
2. Filtrar el tipo de evento definitivo de diagnóstico FUNDAE.
3. Extraer `campaign_external_id=tracking.utm_campaign` y `contact_id=tracking.utm_content`.
4. Validar formato y buscar una única fila por ambos IDs. Si falta UTM, el contacto no existe o hay duplicados,
   enviar a conciliación manual; nunca correlacionar automáticamente solo por email.
5. Construir `execution_key=campaign_id:contact_id:meeting:<hash-event>` y `source_event_id=calendly:booked:<hash>`.
6. Detener la secuencia fría y limpiar locks en Sheets.
7. POST autorizado server-side de `meeting_booked` con `channel=email`, `capture_method=provider_webhook`,
   `properties.platform=calendly`.
8. Exigir `ok === true` y persistir event URI/hash y fecha sin PII.

`invitee.canceled` no equivale a “reanudar marketing”, y una reprogramación genera cancelación más una nueva reserva.
`meeting_completed` requiere evidencia posterior del calendario/CRM; `opportunity_created` pertenece a HubSpot o al
proceso comercial, no a este escenario.

## 6. Piloto bloqueado contra envío accidental

1. El escenario transaccional único permanece OFF; no duplicar ni clonar escenarios históricos.
2. Fijar una allowlist de como máximo 4 destinatarios internos controlados, uno por recurso. El gate atómico
   compartido es obligatorio inmediatamente antes de Outlook; el filtro local no es autoridad suficiente.
3. Ejecutar primero sin módulo Outlook y comprobar autorización, lock de submission, router de cuatro recursos,
   PDF, reservas y callback simulado.
4. Solo tras autorización explícita, incorporar Outlook para un máximo total de 4 envíos internos, uno por recurso,
   respetando el gate 2/60/120 y la conciliación de timeout/429.
5. Repetir cada webhook/evento: debe devolver `duplicate:true` sin duplicar ejecución, evento o email.
6. Verificar dashboard, Sheets, Data Store, Sent Items y Supabase contra los mismos IDs.
7. Aceptación: cero duplicados, cero externos, cero PII en tracking/logs, baja y reunión bloquean el siguiente envío,
   ambigüedad falla cerrada y cada email conserva baja funcional.
8. Exportar el blueprint real desde Make, quitar connection IDs/secretos del archivo y guardarlo para
   revisión. Solo entonces puede cambiarse `production_ready` tras una revisión independiente.

## 7. Activación gradual

- Microlote real únicamente con aprobación jurídica documentada, monitoring y plan de rollback; observar 48 horas.
- Aumentar 10 → 25 → 50 contactos como máximo por ola, revisando quejas, rebotes, respuestas, bajas y entregabilidad.
- Mantener el tope interno 480/día; reducirlo ante degradación. No usar Outlook como plataforma de bulk si la política
  del tenant, Microsoft o la entregabilidad lo desaconsejan.
- Botón de emergencia: escenario sender OFF + campaña inactiva. El endpoint JIT debe entonces responder
  `authorized:false`; replies, NDR y bajas permanecen operativos.

## Evidencia mínima para declarar producción

- Export de los tres blueprints reales; capturas de scheduling, filtros, conexiones y error handlers.
- Resultado del piloto por los 4 contactos y prueba idempotente repetida.
- Message trace de Exchange, Supabase postcheck, dashboard y registro de supresión sin PII.
- Responsable, fecha, versión de copys, base jurídica y autorización firmada de la campaña.
