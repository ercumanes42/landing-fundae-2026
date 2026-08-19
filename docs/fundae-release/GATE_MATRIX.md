# Gate matrix

Estados: `PENDING`, `IN_PROGRESS`, `PASS`, `FAIL`, `BLOCKED`. Solo `PASS` autoriza avanzar a la fase siguiente; no autoriza por sí solo una mutación live.

| Gate | Criterio verificable | Estado | Evidencia requerida | Autoridad |
|---|---|---:|---|---|
| G0-L Baseline local | toolchain fijada, manifiesto schema 2 con core crítico, pins CI y suites focales estáticas | PASS | comandos locales + `releaseInputsDigest` de handoff | técnica |
| G0-CI Empaquetado | core 100% tracked, checkout limpio reproducible, `npm ci` y CI raíz/Data Brain/automation | IN_PROGRESS | commit selectivo final + GitHub run verde + manifest artifact del commit | técnica |
| G1 Captura segura | captura persiste sin outbound; legacy inert; UX coherente con switches OFF | IN_PROGRESS | unit/integration/E2E capture-only | técnica |
| G2 Supabase | backup, precheck, migración revisada, staging, postcheck/advisors, rollback smoke | IN_PROGRESS | staging SQL/rollback PASS; faltan backup y apply productivo autorizado, además del subgate aplicativo `NETWORK_G2` | usuario para live |
| G3 Graph transaccional | 1 reserva=1 draft; ImmutableId; mismo draft enviado; Sent Items confirmado; ambigüedad detiene | BLOCKED | contratos/fault tests y esquema staging PASS; faltan OAuth/mailbox y 4/4 fresh E2E con Sent Items | usuario para live |
| G4 Journey consentido | contrato completo, seudónimos, unión server-side tras consentimiento, minimización | IN_PROGRESS | contrato/tests y purge SQL staging PASS; faltan política final, activación controlada y prueba de retención con datos sintéticos | técnica |
| G5 Dashboard/RBAC | agregados server-side, sin full-table load, claims/mailbox/reservas/tx/campaign/health, auditoría | IN_PROGRESS | UI/contratos y RLS/grants staging PASS; faltan principals y rendimiento con volumen sintético | técnica |
| G6 HubSpot | upsert idempotente por `lead_id`; tareas/replies; supresiones sincronizadas | IN_PROGRESS | replay/mapping y preflight autenticado de 33 propiedades PASS local; faltan portal/scopes y sandbox real | usuario para live |
| G7 Campaña | 939 únicos elegibles; lotes 235/235/235/234; 5 emails; baja en 4695; stops; worker/rate/timezone | BLOCKED | artefacto local 939/4695 validado; faltan rechecks de exclusión, readiness y autorización operativa | técnica |
| G8 Observabilidad | alertas OAuth/mailbox/outbox/DLQ/replies/bajas/bounces/HubSpot/Make/freshness y kill switches | IN_PROGRESS | intents durables, retry/dead-letter, halts y smoke staging PASS; faltan webhook/receipts runtime reales | técnica/live acotada |
| G9 Canary | switches false; captura sin outbound; 4 transaccionales; secuencia interna; 10 clientes | BLOCKED | checklist y autorización directa | usuario |
| G10 Rollout | microbatch 25, pausa 2h, evaluación, lotes progresivos, rollback probado | BLOCKED | métricas dentro de umbral | usuario por tramo |

## Gate G2 order (mandatory)

`backup -> GRAPH_OUTBOX_PRECHECK_20260818.sql -> review 20260818083632_graph_outbox_foundation.sql -> staging apply -> GRAPH_OUTBOX_POSTCHECK_20260818.sql + advisors -> GRAPH_OUTBOX_FORWARD_ROLLBACK_20260818.sql smoke -> production authorization/apply`.

La migración canónica se creó con Supabase CLI efímera fijada `2.81.3`; no hay dependencia CLI instalada. El pack se ejecutó el 19 de agosto de 2026 en el staging independiente `rqjvbpvkjzqqqdxqcqmz`, sin PII y con todos los switches OFF. El proyecto quedó `PAUSED`. No ejecutar SQL en producción hasta cerrar los subgates restantes y obtener autorización específica.

El verificador tiene dos niveles deliberadamente distintos:

- `STATIC_FIXTURE`: valida configuración no-send y contratos locales de migración/precheck/postcheck/rollback, sin red. Nunca cambia G2 a `PASS`.
- `NETWORK_G2`: valida mediante Data API que el `service_role` ve tablas/RPC actuales y no ve RPC legacy/internas. Es solo un subgate; no prueba grants de otros roles, RLS efectiva, SQL interno, advisors, backup ni rollback.

La evidencia autoritativa de staging ya existe: baseline reconstruida, precheck, migraciones, postcheck, smoke, advisors, EXPLAIN y rollback forward-safe. La migración adaptativa HMAC posterior también quedó aplicada y verificada: helper privado, predicado SHA legacy eliminado, SHA simple rechazado, ACL mínimas y outbound OFF. Durante la ejecución se detectaron y corrigieron fallos reales antes de producción, incluido un `pg_catalog.coalesce` inválido que revirtió su transacción completa. La recuperación fue aditiva por etapas; no hubo retry ciego ni mutación productiva.

El pack local consolidado valida el no-op auditado de ADR-0005 y todos sus inputs. `npm run test:supabase-gate-pack` pasa 5/5 y `npm run release:supabase:gates:static` finaliza con `FUNDAE_SUPABASE_GATE_PACK_STATIC_OK`. En staging, precheck/postcheck/smoke/post-rollback terminaron con sus marcadores `*_ok`; los advisors quedaron sin WARN/ERROR, con 39 INFO de RLS sin policy deliberadamente deny-all/service-only, 50 INFO de índices aún no usados por estar el staging vacío y 0 foreign keys sin índice tras la migración de hardening. G2 se mantiene `IN_PROGRESS`, no `PASS`, hasta backup/aplicación productiva autorizada y validación aplicativa de red.

G0-L queda `PASS`. Existen tres commits selectivos en `codex/fundae-release`; G0-CI sigue `IN_PROGRESS` hasta consolidar el último hardening y ejecutar GitHub Actions sobre un checkout limpio. El workflow y el verificador local ya incluyen candidate planner, gate-pack y Supabase Static; ninguna evidencia local sustituye la ejecución GitHub.

## Snapshot QA local — 2026-08-19

- Manifiesto previo a esta actualización documental: `releaseInputsDigest=b393f401b7a4ef1ffa7f08deb23184b6e9ab301f826b9818c6c304f6e1d60e3c`; 365 archivos tracked y 348 core. La rama es `codex/fundae-release` y su primer commit selectivo es `a76fd5d2c94b23ce924742baef877a84172af2da`.
- Landing: 26/26 unit, typecheck PASS, build PASS y E2E fresco 16/16 con un worker.
- Data Brain: 301/301 tests + 1/1 test anti-omisión; setup/readiness 37/37; typecheck y build PASS.
- Automation: 78/78 PASS. Candidate/CI contract: 10/10. Pins CI: 7/7. Gate pack: 6/6 y runner Static PASS. `git diff --check`: exit 0.
- Staging Supabase: pack base, HMAC y alertas durables aplicados; postcheck/smoke PASS, outbound OFF y proyecto independiente pausado. Advisors finales: solo INFO. No se ejecutaron GitHub CI, `npm ci` limpio, NETWORK_G2 aplicativo, Graph/HubSpot/Make live, deploy ni envíos.
- Campaña: el reporte agregado sin PII valida 939 únicos, lotes 235/235/235/234 y 4695/4695 cuerpos identificados con `{{unsubscribe_url}}`; mantiene 939 contactos en `PENDIENTE`, rechecks técnicos de exclusión pendientes y autorización de campaña `PENDING`. G7 permanece `BLOCKED`.
- Legal: Aviso Legal `PASS-LOCAL` con identidad y datos registrales contrastados; Privacidad y Cookies siguen `NO-GO` hasta aprobar finalidades/bases, plazos, encargados/transferencias, DPO/canal de derechos e inventario runtime.
