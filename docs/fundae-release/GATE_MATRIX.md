# Gate matrix

Estados: `PENDING`, `IN_PROGRESS`, `PASS`, `FAIL`, `BLOCKED`. Solo `PASS` autoriza avanzar a la fase siguiente; no autoriza por sí solo una mutación live.

| Gate | Criterio verificable | Estado | Evidencia requerida | Autoridad |
|---|---|---:|---|---|
| G0-L Baseline local | toolchain fijada, manifiesto schema 2 con core crítico, pins CI y suites focales estáticas | PASS | comandos locales + `releaseInputsDigest` de handoff | técnica |
| G0-CI Empaquetado | core 100% tracked, checkout limpio reproducible, `npm ci` y CI raíz/Data Brain/automation | BLOCKED | GitHub run verde + manifest artifact del commit | técnica |
| G1 Captura segura | captura persiste sin outbound; legacy inert; UX coherente con switches OFF | IN_PROGRESS | unit/integration/E2E capture-only | técnica |
| G2 Supabase | backup, precheck, migración revisada, staging, postcheck/advisors, rollback smoke | BLOCKED | logs SQL y backup verificable; el fixture estático no cuenta | usuario para live |
| G3 Graph transaccional | 1 reserva=1 draft; ImmutableId; mismo draft enviado; Sent Items confirmado; ambigüedad detiene | BLOCKED | contratos/fault tests locales PASS; faltan G2 y 4/4 fresh E2E con Sent Items | usuario para live |
| G4 Journey consentido | contrato completo, seudónimos, unión server-side tras consentimiento, minimización | IN_PROGRESS | contrato/tests locales PASS; faltan política final y purge SQL en staging | técnica |
| G5 Dashboard/RBAC | agregados server-side, sin full-table load, claims/mailbox/reservas/tx/campaign/health, auditoría | IN_PROGRESS | UI/contratos locales PASS; faltan principals, RLS/grants y carga en staging | técnica |
| G6 HubSpot | upsert idempotente por `lead_id`; tareas/replies; supresiones sincronizadas | IN_PROGRESS | replay/mapping locales PASS; faltan propiedades/scopes y sandbox | usuario para live |
| G7 Campaña | 939 únicos elegibles; lotes 235/235/235/234; 5 emails; baja en 4695; stops; worker/rate/timezone | BLOCKED | artefacto local 939/4695 validado; faltan rechecks de exclusión, readiness y autorización operativa | técnica |
| G8 Observabilidad | alertas OAuth/mailbox/outbox/DLQ/replies/bajas/bounces/HubSpot/Make/freshness y kill switches | IN_PROGRESS | contrato/tests locales PASS; faltan staging, fault injection y receipts reales | técnica/live acotada |
| G9 Canary | switches false; captura sin outbound; 4 transaccionales; secuencia interna; 10 clientes | BLOCKED | checklist y autorización directa | usuario |
| G10 Rollout | microbatch 25, pausa 2h, evaluación, lotes progresivos, rollback probado | BLOCKED | métricas dentro de umbral | usuario por tramo |

## Gate G2 order (mandatory)

`backup -> GRAPH_OUTBOX_PRECHECK_20260818.sql -> review 20260818083632_graph_outbox_foundation.sql -> staging apply -> GRAPH_OUTBOX_POSTCHECK_20260818.sql + advisors -> GRAPH_OUTBOX_FORWARD_ROLLBACK_20260818.sql smoke -> production authorization/apply`.

La migración canónica se creó con Supabase CLI efímera fijada `2.81.3`; no hay dependencia CLI instalada. Docker/Postgres local no está activo, por lo que lint SQL, advisors, staging/live y rollback smoke siguen pendientes. No ejecutar SQL live hasta cerrar G2 y obtener autorización.

El verificador tiene dos niveles deliberadamente distintos:

- `STATIC_FIXTURE`: valida configuración no-send y contratos locales de migración/precheck/postcheck/rollback, sin red. Nunca cambia G2 a `PASS`.
- `NETWORK_G2`: valida mediante Data API que el `service_role` ve tablas/RPC actuales y no ve RPC legacy/internas. Es solo un subgate; no prueba grants de otros roles, RLS efectiva, SQL interno, advisors, backup ni rollback.

La evidencia autoritativa de G2 sigue siendo la ejecución SQL controlada del orden anterior en staging, incluidos grants/RLS/advisors y rollback smoke.

El pack local consolidado valida el no-op auditado de ADR-0005 y todos sus inputs. `npm run test:supabase-gate-pack` pasa 5/5, incluidas pruebas negativas con un temporal vacío y otro con SQL arbitrario, y `npm run release:supabase:gates:static` finaliza con `FUNDAE_SUPABASE_GATE_PACK_STATIC_OK`. El runner acepta exclusivamente el SHA-256 `e5588fcaebd98e3d917cba8cfa2de557b908021b3171c5dea48d5b27f14e0f67`, el ID de decisión y la migración sucesora exactos; cualquier vacío o drift falla cerrado. Es evidencia `VERIFIED_LOCAL`, no una ejecución SQL: G2 continúa `BLOCKED` hasta staging autorizado, advisors y rollback real.

G0-L puede quedar `PASS` con el árbol preservado aunque G0-CI permanezca `BLOCKED`: la primera afirmación valida el contenido local exacto; la segunda exige que ese mismo núcleo esté rastreado y que GitHub Actions lo ejecute. Ninguna de las dos satisface `NETWORK_G2`.

## Snapshot QA local — 2026-08-19

- Manifiesto previo a la última actualización documental: `releaseInputsDigest=728ac650b836eedab5c1d4552bf16edcfc50300f56fb5d3ea97943b839eb81dc`; 165 archivos tracked, 339 core y 228 core no tracked. CI/empaquetado siguen bloqueados.
- Landing: 19/19 unit, typecheck PASS, build PASS y E2E fresco 16/16 con un worker; puerto preview 4173 cerrado al terminar.
- Data Brain: 269/269 tests de `src` + 1/1 test anti-omisión; setup/readiness 34/34; typecheck y build PASS; `db:verify` solo `STATIC_FIXTURE`, cero red.
- Automation: 72/72 PASS. Pins CI: 7/7 PASS. Gate pack tras ADR-0005: 5/5 PASS y runner Static PASS. `git diff --check`: exit 0.
- Claims limitados a `LOCAL/STATIC_FIXTURE`: no se ejecutaron GitHub CI, `npm ci` limpio, staging, NETWORK_G2, Graph/HubSpot/Make live, migraciones, deploy ni envíos.
- Campaña: el reporte agregado sin PII valida 939 únicos, lotes 235/235/235/234 y 4695/4695 cuerpos identificados con `{{unsubscribe_url}}`; mantiene 939 contactos en `PENDIENTE`, rechecks técnicos de exclusión pendientes y autorización de campaña `PENDING`. G7 permanece `BLOCKED`.
- Legal: Aviso Legal `PASS-LOCAL` con identidad y datos registrales contrastados; Privacidad y Cookies siguen `NO-GO` hasta aprobar finalidades/bases, plazos, encargados/transferencias, DPO/canal de derechos e inventario runtime.
