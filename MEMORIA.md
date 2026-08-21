# Memoria de continuidad — Landing FUNDAE

Actualizado: 19 de agosto de 2026, Europe/Madrid

## REANUDADO

El usuario indicó `continua`. La pausa anterior terminó. El trabajo local se reanudó, manteniendo prohibidos deploy, migraciones, activación y envíos sin sus gates y autorizaciones específicas.

El objetivo persistente del agente raíz sigue activo; no está completado ni marcado como bloqueado.

## Objetivo vigente

Implementar de extremo a extremo el plan aprobado: release reproducible; captura separada de la cola legacy; cuatro correos transaccionales con Microsoft Graph draft + ImmutableId + verificación automática en Sent Items; journey consentido; Data Brain y HubSpot; campaña de 939 clientes en 4 lotes y 5 correos; observabilidad, canarios, kill switches y rollback.

La campaña real no puede activarse ni enviar sin gates técnicos y autorización directa del usuario.

## Decisiones vigentes

- Activación: captura segura → transaccionales → Data Brain/HubSpot → campaña.
- Data Brain/Supabase es autoridad de estado, entrega y analítica.
- Make será scheduler/orquestador; no decide si se puede enviar.
- HubSpot es CRM comercial y debe sincronizar por lead_id.
- Graph opera at-most-once: una reserva = un draft.
- Crear draft con Prefer IdType=ImmutableId, enviar el mismo ID y confirmar automáticamente el mismo mensaje en Sent Items.
- 202 Accepted no significa enviado.
- Ambigüedad implica HALT + alerta; nunca retry ciego de escrituras.
- Segundo stop-check inmediatamente antes de enviar.
- Master kill domina todos los lanes; defaults OFF.
- Backlog legacy permanece almacenado e inerte.
- Los 939 registros se tratan conforme a la decisión aprobada: excluir bajas, oposiciones, hard bounces, supresiones y duplicados; identificación y baja sencilla obligatorias. No reabrir revisión jurídica individual.
- Cadencia: 235/235/235/234, máximo 4.695 correos, un worker, >=60 s entre envíos, <=480/día, Europe/Madrid.
- Reply humano, baja, hard bounce o Calendly detienen la secuencia.

## Arquitectura multiagente

Se diseñaron 14 roles: Minerva, Atlas, Ceres, Janus, Hermes, Mnemosyne, Prisma, Clara, Nexo, Tempo, Echo, Lidia, Argos y Maat.

Protocolo:

- Oleadas de hasta 3 especialistas más el coordinador.
- Ownership exclusivo por rutas.
- Handoffs con evidencia, riesgos, rollback y claims.
- Consenso por seguridad → corrección → idempotencia → observabilidad → reversibilidad → simplicidad.
- Comité adversarial antes de aceptar gates.

Contexto compartido: docs/fundae-release/.

## Estado implementado localmente

### Release

- Shared Context Bundle, ADRs, gate matrix, risk register, evidence index y manifests.
- CI separada para landing, Data Brain y automation.
- Node 22.18.0 y npm 11.11.0 fijados.
- Clean Windows-safe y E2E con servidor fresco.
- G0 sigue incompleto: core crítico continúa untracked y GitHub CI/npm ci limpio no se han ejecutado.

### Captura

- /api/leads/ingest ya no llama Make, notificaciones ni delivery_queue.
- Estado de captura: captured; email_delivery_status=pending no significa enviado.
- Body máximo 64 KiB antes de JSON.
- Allowlist profunda y payload canónico.
- Idempotencia concurrente; colisión de identidad/form/payload devuelve 409.
- Cuatro recursos crean intent durable queued_off; diagnostic queda fuera.
- Master kill domina mailbox y legacy.
- Producción exige cabecera de IP confiable.
- Backlog legacy inerte y retry masivo protegido.

### Supabase / Graph outbox

- Migración canónica: data-brain/supabase/migrations/20260818083632_graph_outbox_foundation.sql.
- Espejo en data-brain/supabase/schema.sql.
- Precheck, postcheck y rollback forward-safe.
- Outbox transaccional durable y backfill queued_off.
- Estados Graph, marker lowercase, RLS/grants mínimos, clocks tras locks, changeKey JIT, cadencia en authorize, límite diario y guards graph-managed.
- Neutralización exige evidencia antes de liberar.
- No se aplicó SQL live.

### Backend Graph

- Canónico: data-brain/src/lib/graph-secure-client.ts.
- También: graph-outbox-repository.ts, graph-worker.ts, graph-runtime.ts y ruta privada /api/internal/graph/transactional.
- Draft/ImmutableId, marker recovery, mismo draft, stop-check, changeKey, Sent Items, Message-ID hash, HALT y neutralización implementados con mocks.
- graph-client.ts es un borrador no importado; no borrar sin inventario explícito.

## Validación verificada antes de la pausa

- Landing: unit 13/13, typecheck PASS, build PASS, E2E fresco 16/16.
- Data Brain tras Ceres/Janus: 172/172, setup/readiness 18/18, typecheck PASS, build PASS.
- Graph focal tras alineación parcial: 17/17 y TypeScript PASS.
- SQL contractual: 2/2 y diff-check PASS.
- Automation/release baseline: 63/63 en la selección offline de Atlas.
- Supabase local real: BLOQUEADO; 127.0.0.1:54322 rechazó conexión.
- Sin Graph live, Make live, HubSpot live, migraciones live, Vercel deploy ni envíos.

## Findings adversariales

Maat y Argos detectaron y provocaron correcciones de:

- master kill omitido en reserva legacy;
- bypass de reconciliación manual sobre reservas Graph;
- carrera de doble draft;
- reloj obsoleto antes de locks;
- cadencia medida desde reserva;
- falta de dispatch captura→Graph;
- payload público permisivo y sin límite;
- carrera submission_id;
- marcador case-insensitive;
- changeKey no verificado;
- drafts huérfanos;
- rollback con envíos in-flight;
- readiness que podía quedar verde sin Graph.

## Dos pendientes SQL detectados justo antes de la pausa

Hermes detectó dos edges después de la última alineación. La tarea de corrección de Ceres no llegó a iniciarse por límite de threads:

1. claim_transactional_graph_dispatch debe recuperar de forma segura un dispatch reserved con lease vencido tras crash, entrando en modo recovery y sin crear otro draft.
2. finalize_transactional_graph_dispatch debe aceptar el terminal seguro producido por neutralización (suppressed_before_send) sin exigir igualdad literal con definitive_failed.

El código actual falla cerrado ante estos casos; no produce false success. G2/G3 permanecen NO-GO.

## Trabajo interrumpido

- Atlas estaba terminando readiness Graph, SHA de Actions, docs y manifest final.
- Hermes estaba alineando consumidor dispatch/worker con SQL final y preparando full suite/build.
- Ambos agentes fueron interrumpidos por la pausa del usuario.

## Secuencia exacta al reanudar

1. Reanudar Ceres para corregir los dos edges SQL y actualizar migration/schema/pre-post/tests.
2. Reanudar Hermes para alinear firmas y ejecutar Graph fault suite + full Data Brain tests/typecheck/build.
3. Reanudar Atlas para cerrar readiness/CI/docs/manifest.
4. Ejecutar revisión adversarial Maat + Argos sobre los cambios.
5. Levantar PostgreSQL local o staging autorizado; aplicar migración allí, ejecutar pre/postcheck, advisors y pruebas de concurrencia. No producción todavía.
6. Solo con G2/G3 PASS continuar oleada producto: journey consentido; agregados server-side, RBAC/auditoría y dashboard; HubSpot idempotente por lead_id.
7. Después oleada campaña: Make importable OFF; replies/NDR/Calendly; copies, identificación y 4.695 bajas.
8. Comité adversarial, QA completa, preview y rollout por gates.
9. Solicitar autorización directa antes de 10 clientes, microbatch 25 o cualquier envío real.

## Gates actuales

- G0 Release: IN_PROGRESS.
- G1 Captura: localmente corregido; pendiente evidencia de entorno/edge.
- G2 Supabase: BLOCKED por falta de PostgreSQL real/staging y dos edges SQL.
- G3 Graph: BLOCKED por G2, full rerun y E2E automático real.
- G4 Journey: pendiente.
- G5 Data Brain/RBAC: pendiente.
- G6 HubSpot: pendiente.
- G7 Campaña seca: artefacto local 939/4695 verificado; readiness, rechecks de exclusión y autorización siguen bloqueados.
- G8–G11 rollout: prohibidos hasta gates y autorización.

## Seguridad operacional

- Mantener OUTBOUND_MASTER_ENABLED=false.
- Mantener lanes legacy, Graph transaccional y campaña en false.
- No usar el .env local antiguo como prueba de cierre.
- No mostrar URLs Make/webhook, tokens, emails, Graph IDs o Message-IDs.
- No reset, cleanup, checkout destructivo, borrado ni git add ..
- Working tree muy sucio; preservar todos los cambios.

## Criterio de cierre

No afirmar 100%, producción o E2E live hasta: release reproducible; SQL real y advisors; 4/4 Graph automáticos desde captura hasta Sent Items; journey consentido; dashboard agregado con RBAC; HubSpot por lead_id; Make/replies/NDR/Calendly operativos; 939/4.695 validados; observabilidad/rollback; canarios autorizados y gates completos.

## Actualización tras reanudar - 19 de agosto de 2026

### Graph / SQL crash-safe

- Los dos pendientes SQL anteriores están corregidos localmente.
- `claim_transactional_graph_dispatch` recupera reservas expiradas conservando la misma reserva, outbox y draft; nunca vuelve a reservar ni crear.
- Los terminales coherentes se cierran bajo lock como `terminal_recovered`; un claim así no ejecuta package, worker, Graph ni finalize adicional.
- `suppressed_before_send` exige evidencia y, si existió draft, neutralización verificada; el dispatch se materializa como `definitive_failed` conservando el outcome Graph.
- Migración canónica, `schema.sql`, precheck, postcheck y rollback están sincronizados. Se repararon bloques truncados del espejo.
- Validación raíz: Data Brain 185/185 tests PASS, setup/readiness 25/25 PASS, typecheck PASS y build PASS.
- Sigue pendiente el gate autoritativo: aplicar en PostgreSQL staging/preview, ejecutar pre/postcheck, advisors y concurrencia real. Nada se aplicó live.

### Release

- G0 local dispone de manifiesto schema 2 y CI con 7/7 Actions fijadas por SHA.
- Snapshot: 165 tracked, 274 core y 163 core untracked; por ello G0-CI continúa bloqueado honestamente.
- No se hizo `git add`, commit, deploy ni limpieza del árbol.

### Campaña privada

- El Excel privado existe y se validó sin exponer PII.
- Estructura PASS: 939 contactos únicos; lotes A/B/C/D = 235/235/235/234; cinco pasos; 104 contactos condicionados.
- Sigue NO-GO: 939 filas están `PENDIENTE` y 0/4695 cuerpos de la copia operativa contienen la baja.
- La matriz canónica `automation/make/fundae_copy_matrix_v1.json` sí incluye `{{unsubscribe_url}}` en los 20 templates.
- El original privado no debe modificarse; crear una copia controlada derivada, validarla 4695/4695 y mantenerla OFF.

### Oleada activa

- Journey consentido y seudonimizado: en implementación/revisión.
- Dashboard agregado server-side y RBAC: en implementación/revisión.
- HubSpot idempotente por `lead_id`: en implementación/revisión.
- Después: Make scheduler-only, replies/NDR/Calendly, materialización de copies y comité adversarial.

## Snapshot QA autoritativo local — 19 de agosto de 2026

- Snapshot pre-documentación post-oposición: `releaseInputsDigest=048703143b6fb44fd1d9bacc88a45d9116fa82b0ed0c38cae7d4097aea756fcc`; 165 tracked, 337 core y 226 core críticos untracked. G0-L está validado localmente; G0-CI continúa bloqueado.
- Data Brain: 269/269 tests de `src`, 1/1 anti-omisión, setup/readiness 34/34, typecheck PASS, build PASS y `db:verify` STATIC_FIXTURE PASS con cero red. Esto no satisface G2.
- Landing: unit 19/19, typecheck PASS, build PASS y E2E fresco 16/16 con un worker. El servidor preview terminó y el puerto 4173 quedó sin listener.
- Automation: 72/72 PASS, incluido el provisioner cold fail-closed. GitHub Actions pins: 7/7 PASS. Gate pack Supabase: 3/3 PASS. `git diff --check`: exit 0, con avisos LF/CRLF no bloqueantes.
- ADR-0005 preserva `20260819072840_cold_campaign_scheduler.sql` como no-op explícito y auditado, supersedido por `20260819170000_cold_campaign_scheduler.sql`. El runner acepta solo su SHA/ID/sucesora exactos: gate pack 5/5, incluidas pruebas negativas, y Static PASS local. G2 permanece BLOCKED por staging, advisors y rollback real pendientes.
- Tras el último ajuste de oposición/supresión se repitieron Data Brain 269/269 + anti-omisión 1/1, setup/readiness 34/34 y build: todo PASS. El cambio quedó limitado a Data Brain/SQL; se conservaron landing 19/19 + E2E 16/16 y automation 72/72 al no existir drift en sus inputs.
- El reporte agregado controlado valida 939 contactos únicos, lotes 235/235/235/234 y 4695/4695 cuerpos identificados con baja. Los 939 siguen `PENDIENTE`, con rechecks de bajas/oposición/hard bounce/supresión y autorización operativa pendientes; no se importó ni envió nada.
- No hubo migración, staging, NETWORK_G2, Graph/HubSpot/Make live, deploy, activación ni envíos. Todos los switches operacionales deben continuar OFF.

## Continuación técnica — no-op y legal

- La migración `20260819072840_cold_campaign_scheduler.sql` ya no está vacía: es un no-op auditado por ADR-0005, SHA/ID/sucesora exactos y EOL LF. Gate pack 5/5 y runner Static PASS; cero migraciones vacías.
- Docker Desktop está instalado, pero el daemon no arranca porque el servicio `com.docker.service` requiere elevación administrativa. No se ejecutó PostgreSQL local.
- El Aviso Legal quedó reconstruido con razón social, NIF, domicilio, canales y datos registrales contrastados en BORME/web corporativa. Privacidad y Cookies permanecen no definitivas.
- Se detectó y reparó corrupción por bytes nulos en `LegalPage.tsx`, `Footer.tsx` y su test. Escaneo final: cero archivos textuales con NUL; landing unit 19/19, typecheck/build PASS y E2E legal 3/3.
- G3 queda `BLOCKED` por G2 y el E2E Graph real. G4, G5 y G6 quedan `IN_PROGRESS` con evidencia local, nunca `PASS` global.
- Snapshot de release tras no-op y reconstrucción legal: `releaseInputsDigest=728ac650b836eedab5c1d4552bf16edcfc50300f56fb5d3ea97943b839eb81dc` antes de actualizar estos documentos; 165 archivos tracked, 339 core y 228 core no tracked. G0-CI continúa bloqueado.

## Release y staging Supabase — 19 de agosto de 2026

- Rama creada: `codex/fundae-release`. Primer commit selectivo: `a76fd5d2c94b23ce924742baef877a84172af2da`; excluye secretos, datos privados y outputs.
- Se creó el staging independiente gratuito `data-brain-fundae-staging` (`rqjvbpvkjzqqqdxqcqmz`, `eu-west-1`), se ejecutó el pack sin PII y se dejó `PAUSED`.
- Baseline, precheck, migraciones, postcheck, smoke, advisors, EXPLAIN y forward rollback concluyeron correctamente. Marcadores: `fundae_release_precheck_ok`, `fundae_release_postcheck_ok`, `fundae_release_behavior_smoke_ok` y `fundae_release_post_rollback_ok`.
- La ejecución real detectó y permitió corregir: funciones especiales inválidamente prefijadas con `pg_catalog`, un `REVOKE` anterior a la creación de su función y una fixture de provisioning que no llegaba al kill switch. La recuperación fue aditiva por etapas; no hubo retry ciego.
- Advisors finales: 0 WARN/ERROR; 39 INFO de RLS sin policy en tablas service-only/deny-all; 50 INFO de unused index por staging vacío; 0 foreign keys sin índice tras `20260819220000_advisor_index_hardening.sql`.
- QA local posterior: landing 26/26 + E2E fresco 16/16; automation 72/72; Data Brain 272/272 + anti-omisión 1/1, setup/readiness 34/34, typecheck/build y STATIC_FIXTURE PASS.
- G2 pasa de `BLOCKED` a `IN_PROGRESS / STAGING_PASS`; no es `PASS` global hasta backup/aplicación productiva autorizada y `NETWORK_G2` aplicativo. G3 continúa `BLOCKED` hasta OAuth/mailbox y 4/4 Graph fresh con confirmación real de Sent Items.
- No hubo deploy, cambios en producción, Graph/HubSpot/Make live ni envíos. `OUTBOUND_MASTER_ENABLED` y todas las lanes permanecen OFF.

## Cierre Graph, HubSpot, Make y HMAC — 19 de agosto de 2026

- Graph exige identidad completa `from`/`sender`/`replyTo`, separa mailbox ID de address y registra intento/entrega de alertas; las ambigüedades mantienen el halt fail-closed. Make queda scheduler-only, con todos los blueprints OFF, no importables y pendientes de validar contra módulos/conexiones reales.
- HubSpot usa `fundae_lead_id` HMAC estable entre campañas, asociación default fail-closed y una única tarea lógica por reply positivo. El sandbox continúa bloqueado hasta verificar propiedades, scopes, portal y replay real.
- El provisioner cold y Supabase quedaron alineados: `20260819155300_cold_campaign_hmac_identity.sql` se aplicó en staging; el helper privado rechaza SHA simple y la función de provisioning usa el guard HMAC. ACL, SECURITY DEFINER, `search_path` vacío, campaña sin hashes legacy y outbound OFF fueron verificados.
- El primer intento de esta migración falló por `pg_catalog.coalesce`; PostgreSQL revirtió toda la transacción. Se corrigió a la expresión especial `coalesce`, se repitió el gate local 5/5 y el segundo apply terminó correctamente.
- Snapshot local previo a documentación: Data Brain 288/288 + anti-omisión 1/1, setup/readiness 36/36, typecheck/build PASS; automation 74/74; Graph/cold 42/42; Make 6/6; provisioner HMAC 10/10. El staging volvió a quedar `PAUSED` y nunca se habilitó outbound.
- G2 permanece `IN_PROGRESS / STAGING_PASS`; G3, G6 y G7 no están autorizados para live. No hubo producción, deploy, OAuth/Graph real, HubSpot sandbox, importación Make ni envíos.

## Hardening final offline y alertas durables — 19 de agosto de 2026

- `LEAD_HASH_SECRET` exige al menos 32 bytes UTF-8, sin placeholders ni whitespace exterior, con rotación fail-closed y sin dual-read. Captura, `buildLeadId`, provisioner y gates usan la misma política.
- El preflight HubSpot requiere autenticación antes de rate-limit/fetch, es GET-only/no-store y valida portal más un manifiesto redacted de 33 propiedades. No habilita `HUBSPOT_SYNC_ENABLED` ni sustituye el sandbox.
- Las ambigüedades Graph/cold/transactional apagan su lane y encolan una intención de alerta durable con claim, lease, retry exponencial, ocho intentos, dead-letter y replay idempotente. La entrega externa permanece OFF hasta configurar webhook.
- `20260819230000_durable_operational_alert_delivery.sql` se aplicó al staging autorizado. Postcheck devolvió `fundae_release_postcheck_ok`; smoke rollback-only devolvió `fundae_release_behavior_smoke_ok`; outbound, purge y provisioning continuaron OFF. El staging volvió a `PAUSED`.
- QA autoritativa: Data Brain 301/301 + anti-omisión 1/1, setup/readiness 37/37, typecheck/build PASS; automation 78/78; candidate/CI contract 10/10; gate-pack 6/6; Static y pins 7/7 PASS.
- CI ejecuta ahora los gates release ya existentes y el runner Supabase Static selecciona PowerShell de forma portable Windows/Linux. Sigue faltando el run real de GitHub sobre checkout limpio.

## Cierre técnico y staging final — 19 de agosto de 2026

- Se aplicaron en el staging autorizado y sin PII las migraciones de piloto Graph acotado, supresión terminal global, provisioning `cold-provision-v3`, bloqueo de inserción de identidades suprimidas e índice de la FK de autorización. Postcheck y los tres smokes rollback-only terminaron PASS.
- Inventario final: `master_enabled=false`, `transactional_enabled=false`, `cold_enabled=false`, 0 pilotos activos y el índice de autorización presente. El proyecto staging volvió a quedar `PAUSED`.
- Advisors finales: 0 WARN/ERROR; 41 INFO de RLS deny-all/service-only y 49 INFO de índices sin uso por staging vacío; 0 foreign keys sin índice.
- QA local vigente: landing 29/29 + E2E 17/17; automation 85/85; Data Brain 324/324 + anti-omisión 1/1, setup 37/37, typecheck/build PASS; gate pack 10/10.
- G2 continúa `IN_PROGRESS / STAGING_PASS`; no hubo producción, deploy, Graph/HubSpot/Make live ni envíos. Privacidad/Cookies, GitHub CI, NETWORK_G2 y los gates operativos reales siguen pendientes.

## Cierre incremental Graph y campaña condicional — 20 de agosto de 2026

- Se cerró el escape de cohorte del piloto Graph: una reserva no ligada al piloto no puede delegar al autorizador anterior; el sistema apaga master/transaccional/cold y encola alerta durable.
- Los fallos de lectura/reconciliación de Sent Items quedan `ambiguous_halted`, con evidencia y sin reenvío. Los estados inbound `busy` ya no avanzan el cursor y responden 503 para reintento.
- El provisioning liga `parent_contact_id` y `conditional_delivery` al hash de fila. Los 104 contactos condicionados se validan contra un principal de la misma campaña/variante y se bloquean tanto en claim como en autorización JIT si el principal ya respondió, concertó reunión o fue detenido.
- QA local: automation 85/85; Data Brain 327/327 + anti-omisión 1/1; typecheck y build PASS; gate pack Supabase 12/12 y Static PASS.
- Las migraciones `20260819234300_transactional_graph_pilot_alert_hardening.sql` y `20260819234400_campaign_conditional_delivery_hardening.sql` se aplicaron al staging autorizado. Postcheck y smokes Graph/campaña/comportamiento terminaron PASS; advisors 0 WARN/ERROR; todos los controles outbound quedaron false y el proyecto se confirmó `INACTIVE`.
- No hubo producción, deploy, Graph/HubSpot/Make live ni envíos. Permanecen como gates externos: privacidad/cookies, GitHub CI, NETWORK_G2, OAuth/App RBAC/mailbox Graph, 4/4 real, sandbox HubSpot, rechecks privados de exclusiones y autorización operativa.

## Cierre offline HubSpot y exclusiones — 20 de agosto de 2026

- La campaña ya dispone de un productor determinista que transforma cinco exports privados completos en snapshots firmados, hash-only, ligados a campaña/dataset y con frescura obligatoria. No genera `CLEAR` sin las cinco fuentes reales.
- HubSpot queda desacoplado mediante `hubspot_sync_outbox`: versión deseada/confirmada, claim con lease, retry, dead-letter, replay idempotente y prioridad de stops. La tabla es RLS/FORCE, sin acceso directo para `service_role`; solo dos RPC acotadas pueden reclamar/finalizar.
- La migración `20260819224739_hubspot_sync_outbox.sql` se aplicó al staging autorizado. Postcheck y smoke rollback-only devolvieron `fundae_release_postcheck_ok` y `fundae_release_hubspot_sync_smoke_ok`; master, transaccional, cold y HubSpot quedaron OFF, sin claims activos.
- Advisors: 42 INFO de seguridad y 68 INFO de rendimiento, 0 WARN/ERROR. QA local: Data Brain 337/337 + anti-omisión 1/1, setup 37/37, typecheck/build PASS; automation 87/87; gate pack 12/12 y Static PASS.
- No hubo producción, deploy, Graph/HubSpot/Make live ni envíos. G3/G6/G7/G8 siguen sin PASS global hasta aportar OAuth/mailbox y 4/4 real, sandbox HubSpot, cinco exports privados frescos, autorización operativa, receptores de alertas y gates de rollout.

## Cierre legal local — 20 de agosto de 2026

- Aviso Legal, Privacidad y Cookies quedan redactados como versiones vigentes, con identidad y canal corporativos contrastados, bases por finalidad, plazos, categorías de encargados, transferencias, derechos, DPD y decisiones automatizadas.
- La casilla de formulario confirma lectura/solicitud y no simula un consentimiento genérico. La analítica mantiene consentimiento separado, rechazo equivalente, retirada accesible y caducidad de 24 meses.
- Evidencia: legal/privacidad 30/30, gate 7/7, typecheck y build PASS; E2E de consentimiento 2/2 demuestra cero cookies/almacenamiento/analítica antes de aceptar y limpieza tras retirar.
- El marcador de producción permanece `BLOCKED`: este cierre legal local no equivale a merge, deploy, activación de proveedores ni envío.

## Estado operativo confirmado — 21 de agosto de 2026

- Data Brain está desplegado en producción en `https://data-brain-2026.vercel.app/` y el acceso administrativo funciona.
- La base productiva contiene 939 contactos de campaña y 4.695 ejecuciones planificadas: cinco emails por contacto. Distribución por lotes/variantes: 235/235/235/234.
- Los controles `master`, `transactional` y `cold campaign` permanecen en `OFF`. La carga de la campaña no autoriza ni provoca envíos.
- Make llama correctamente a `POST /api/internal/graph/dispatch` con Bearer y recibe `409 master_or_lane_disabled`, la respuesta segura esperada mientras todo está OFF.
- El dashboard actual muestra agregados de leads, journey, campaña, transaccional y salud, pero sigue siendo una página larga y todavía no cumple la experiencia analítica Data Brain 2.0.
- Problemas visibles actuales: atribución `Unknown` en eventos históricos, ausencia de tasas y comparaciones normalizadas, pipeline interno sin gestión completa y escasa jerarquía entre negocio y operación.
- La exclusividad del buzón Graph de Joaquín no está configurada porque la cuenta actual no tiene privilegios Exchange suficientes y el administrador está ausente. No debe activarse Graph hasta cerrar ese acceso y validar un piloto real acotado.

## Data Brain 2.0 — cierre local del 21 de agosto de 2026

Objetivo aprobado:

1. Reorganizar la interfaz en cinco vistas: Resumen, Campaña, Journey, Revenue y Operaciones.
2. Unificar atribución por contacto seudonimizado, email, copy, variante, lote, hora, enlace, sesión, herramienta y conversión.
3. Mostrar tasas reales y embudos, no solo cantidades: entrega, rebote, clic, respuesta, reunión, oportunidad y venta.
4. Añadir tiempo activo, scroll, inicio/pasos/abandono/finalización por herramienta y latencias entre email, interacción, reunión y venta.
5. Crear pipeline interno independiente de HubSpot: Interesado, Cualificado, Reunión, Oportunidad, Ganado y Perdido; con importes, probabilidad, fecha prevista y origen atribuido.
6. Incorporar comparación de cohortes, lift, intervalos de confianza, muestra mínima, anomalías y recomendaciones `mantener/revisar/detener`.
7. Añadir filtros por fecha, email, copy, variante, lote, hora, empresa y herramienta, manteniendo PII fuera de agregados.

Estado de implementación:

- Interfaz reorganizada en cinco vistas: Resumen, Campaña, Journey, Revenue y Operaciones, con filtros persistentes, navegación responsive, accesibilidad y estados vacíos accionables.
- Visualizaciones nativas sin animación ni datos inventados: barras, embudos, donut, radar y línea temporal. Cada gráfica aparece solo cuando la estructura y muestra disponibles son adecuadas; las tablas conservan los valores exactos.
- Migración aditiva `20260821105809_data_brain_intelligence_v2.sql`: agregados por email, variante, hora, lote, empresa, enlace, herramienta y día Madrid; calidad de atribución; pipeline interno privado con etapas, importes, probabilidad, origen y resultado; RLS/FORCE, RPC service-only y RBAC.
- Motor estadístico local: tasas seguras, lift, Wilson 95 %, muestra mínima, anomalías robustas y recomendaciones explicables; no convierte diferencias pequeñas o sin muestra en conclusiones.
- Exportación autenticada y limitada a CSV y Excel real `.xlsx`, con filtros/periodo, hojas de negocio, valores tipados, bloqueo de PII y neutralización de fórmulas. `npm audit` queda en cero vulnerabilidades tras fijar la dependencia transitiva `uuid`.
- Evidencia final local: Data Brain 370/370 + anti-omisión 1/1, TypeScript PASS, build Next.js PASS, auditoría npm con 0 vulnerabilidades; gate-pack Supabase 15/15 y Static PASS.
- Las migraciones de inteligencia v2, campaña y el índice de revenue fueron aplicadas primero en staging. Postcheck y smoke rollback-only devolvieron `fundae_release_postcheck_ok` y `fundae_release_intelligence_v2_smoke_ok`; advisors: 0 WARN/ERROR.
- Inteligencia v2 y el índice fueron aplicados después en producción. Verificación directa: contrato 2.0, PII=false, tabla pipeline con RLS/FORCE, índice FK presente, 939 contactos y 4.695 ejecuciones preservadas. Master, transaccional y campaña fría continúan OFF.
- Commit selectivo `9921240` creado y enviado a `codex/fundae-release`; el PR abierto quedó actualizado. Vercel compiló y desplegó correctamente la interfaz en `https://data-brain-2026.vercel.app/`.

## Pendientes externos antes de cualquier envío

- Microsoft Graph: credenciales finales, permisos mínimos, limitación al buzón correcto y piloto 4/4 con Sent Items confirmado.
- Exclusiones de campaña: snapshots privados frescos y autorización operativa final.
- Alertas: receptor real configurado y prueba de entrega.
- Mantener Make, campaña y Graph OFF hasta que esos gates tengan evidencia real.

## Regla de continuidad

- No afirmar que la campaña está lista para enviar solo porque los 939/4.695 están cargados.
- No activar ni enviar durante el desarrollo del Data Brain 2.0.
- No incluir secretos, datos privados, outputs ni los runbooks legacy en commits selectivos.
- Antes de cerrar Data Brain 2.0: demostrar requisito por requisito con migración/espejo, tests, typecheck, build, gates estáticos y revisión visual.
