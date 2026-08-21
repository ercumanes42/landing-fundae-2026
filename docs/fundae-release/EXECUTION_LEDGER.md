# Execution ledger

Formato append-only. Nunca reemplazar evidencia histórica; añadir una entrada correctiva.

## 2026-08-18 — Atlas — foundation baseline

- Alcance: release/toolchain/CI/documentación; sin producto, SQL, secretos, deploy, commit o envío.
- Baseline previo a Atlas: `main@9e909363554293db9a1b1eee4a0ff37b82ec8b5d`; 367 entradas (`M=73`, `D=33`, `??=261`).
- Toolchain observada: Node `22.18.0`, npm `11.11.0`.
- Decisión: preservar todas las entradas; el manifiesto solo lee archivos rastreados y cuenta códigos de estado. No inspecciona ni clasifica contenido no rastreado.
- Estado operativo heredado: `TRANSACTIONAL_OUTLOOK_ENABLED=false`, Make principal OFF, V3 deshabilitado/cola 0. Mantener OFF.
- Evidencia histórica declarada, no revalidada aún contra el árbol final: landing unit `13/13`, E2E `16/16`, Data Brain `147/147`, setup `17/17`, automation `65/65`, builds/typechecks PASS, cuatro recursos transaccionales controlados `4/4`.
- Claim Atlas: fundación creada localmente; CI no ejecutada en GitHub y producción no verificada.

## 2026-08-18 — Atlas — focused verification

- `npm.cmd run test:automation`: PASS `63/63` (suite offline; excluye fixture privado de cuatro destinatarios).
- `npm.cmd run test:unit`: PASS `13/13`.
- `npm.cmd run lint`: PASS.
- `npm.cmd run build`: PASS; warning no bloqueante por chunk principal >500 kB.
- E2E repetido con `CI=1`, servidor fresco y reporter JSON temporal: PASS `16/16`, `unexpected=0`, `flaky=0`, `skipped=0`; servidor cerrado y reporte temporal eliminado.
- `npm.cmd --prefix data-brain run test`: PASS `154/154`, incluido aislamiento de captura y guards de retry.
- Data Brain `test:setup`: PASS `17/17`; typecheck y build: PASS.
- Data Brain `db:verify`: FAIL local esperado por configuración no-send incompleta; no hubo red. El fixture CI no-live fue validado directamente: `ready=true`, cero issues.
- Manifiesto: schema 1 válido; `main@9e90936`; digest tracked-files observado `99365b5c...e97fda2` antes de terminar cambios concurrentes. Debe regenerarse en el árbol final.
- Sin envíos, red de proveedores, SQL, migraciones, deploy, commit ni push.

## 2026-08-18 — Atlas — post-handoff manifest

- Tras integración Janus: `main@9e909363554293db9a1b1eee4a0ff37b82ec8b5d`; 391 entradas (`M=74`, `D=33`, `??=284`); 165 archivos rastreados; digest tracked-files `b4b9a5b8c11301dc3d542755655780b86b91f603b8cd1f12d9163a6e6d1a950c`.
- Limitación: archivos release/core aún no rastreados quedan fuera del digest por política de privacidad/preservación. Regenerar tras aprobar su inclusión y ante cualquier cambio concurrente.
- Handoff Ceres: migración Graph outbox canónica creada con CLI efímera `2.81.3`; precheck/postcheck/rollback forward-safe existen. G2 sigue BLOCKED: sin Docker/Postgres lint, staging, advisors, smoke rollback ni aplicación live.
- Handoff Janus final: setup validation exige `OUTBOUND_MASTER_ENABLED`, `LEGACY_MAKE_DELIVERY_ENABLED` y `LEGACY_DELIVERY_RETRY_ENABLED` exactamente `false`; revalidación `test:setup` PASS `17/17`.
- Efecto de QA: E2E regeneró el output no rastreado existente `output/playwright/autoevaluacion-fundae-final.pdf` (365271 bytes). No se borró ni intentó restaurar sin baseline binaria.

## 2026-08-18 — Janus — capture/legacy isolation

- Alcance: ingest capture-only, switches fail-closed, retry legacy, microcopy y tests; sin SQL, Graph, blueprints, env real, deploy o envío.
- Cambios: ingest ya no importa ni llama delivery Make/notificación; landing sin fallback a webhook directo; `captured` separado de handoff/email; master y flags legacy con default `false`; retry con admin + confirmaciones explícitas; UI legacy inerte por defecto.
- Evidencia: tests focalizados `10/10`; Data Brain `154/154`, setup `17/17`, typecheck y build PASS; landing unit `13/13`, typecheck y build PASS; E2E final `16/16`.
- Incidencia corregida: el primer E2E quedó `14/16` porque dos selectores esperaban el copy anterior; se actualizaron al contrato de captura y la pasada final fue `16/16`.
- Claims permitidos: aislamiento y gates verificados localmente con mocks; builds locales completos.
- Claims prohibidos: no se verificó producción, Microsoft Graph real, Supabase remoto, Make, HubSpot, deploy ni envío real.
- Riesgo residual: `email_delivery_status=pending` es compatibilidad con el esquema actual y no prueba entrega; el backlog legacy histórico permanece, pero no puede procesarse con defaults OFF.
- Rollback operativo: mantener `OUTBOUND_MASTER_ENABLED=false`, `LEGACY_MAKE_DELIVERY_ENABLED=false` y `LEGACY_DELIVERY_RETRY_ENABLED=false`.
- Autoridad pendiente: cualquier activación/deploy/env real requiere los gates globales y autorización directa del usuario.

## 2026-08-18 — Atlas — readiness correction

- Alcance: verificador de readiness, tests, CI y documentación de release; sin SQL live, deploy, commit, push ni envíos.
- Cambios: contratos Graph/dispatch/control obligatorios; RPC legacy/internas prohibidas para `service_role`; artefactos Graph estáticos fail-closed; precedencia explícita de variables de proceso; modos `STATIC_FIXTURE` y `NETWORK_G2` separados.
- Supply chain: Actions fijadas a SHA verificadas para checkout `v6.0.2`, setup-node `v7.0.0` y upload-artifact `v7.0.1`.
- Evidencia: Data Brain `172/172`; setup/readiness `24/24`; typecheck PASS; build PASS; fixture estático PASS y declara cero red/no G2.
- Claim permitido: contratos locales y runner focal verificados; la CI no puede afirmar DB ready a partir del fixture.
- Claim prohibido: G2, grants/RLS remotos, migración aplicada, advisors, rollback smoke o producción verificados.
- Riesgo residual: el núcleo Graph/release sigue no rastreado y queda fuera del digest tracked-only; se conserva íntegro.
- Rollback operativo: mantener todos los switches outbound/legacy/transactional en `false`; revertir solo los archivos de release/readiness mediante revisión explícita si fuera necesario.
- Autoridad pendiente: track/commit/deploy, cualquier operación Supabase de red y activación requieren autorización/gates.

## 2026-08-19 — Atlas — G0 local closure

- Alcance: manifiesto/CI/readiness/docs; sin Git index, commit, SQL, Graph runtime, red de proveedores, deploy ni envío.
- Cambios: manifest schema 2 hashea todo tracked y el core allowlisted, incluidos críticos untracked; verificador CI rechaza core no rastreado; Actions en allowlist por SHA completo; runner acotado a `ubuntu-24.04`; fixture readiness aislado de `.env`.
- Readiness Graph estática: exige recuperación de reserva expirada, binding al dispatch, señal `resume_existing_reservation`, mapping de `suppressed_before_send` y evidencia de neutralización. No ejecuta SQL ni prueba semántica live.
- Evidencia focal: `release:ci-pins` PASS (7/7 referencias); `release:manifest:verify` PASS/`LOCAL_ONLY`; Data Brain `test:setup` PASS 25/25; Data Brain typecheck PASS; `db:verify` STATIC_FIXTURE PASS con cero red.
- Evidencia complementaria del runner local sobre este árbol: landing unit 13/13, automation 63/63, landing build/E2E fresco 16/16 y Data Brain tests 179/179. La repetición global se interrumpió al comenzar Data Brain por instrucción del coordinador; root ejecuta la suite final agregada.
- Claim permitido: G0-L `PASS` para reproducibilidad/contratos estáticos del contenido local inventariado.
- Claims prohibidos: G0-CI/packaging, GitHub run, `npm ci` desde checkout limpio, `NETWORK_G2`, migración/grants/RLS/advisors/rollback, producción o envío.
- Bloqueo: `criticalUntrackedCoreFiles` no vacío; por diseño `--require-tracked-core` falla hasta que el propietario apruebe track/commit.
- Rollback operativo: mantener todos los switches outbound/legacy/transactional en `false`.

## 2026-08-19 — Prisma — observability and rollout local contract

- Alcance: observabilidad agregada, alert lifecycle, endpoint service-only, rollout/runbook y gate de suites; sin SQL aplicado, canal de alerta, deploy, credenciales, canario ni envío.
- Cambios: migración separada con RLS forzado y grants RPC; heartbeat sin PII; dedupe/receipts/reopen/ack/resolve auditados; umbrales deterministas; rollout captura -> 4 transaccionales -> interna -> 10 autorizados -> microbatch 25/2h -> lotes.
- Evidencia focal: observabilidad `8/8`, gate anti-omisión `1/1`, Data Brain typecheck PASS. La suite agregada se ejecuta antes del handoff final.
- Claims permitidos: contrato local OFF y evaluación/fault tests con mocks; el runner `test` descubre todo `src/**/*.test.ts` sin exclusiones ni lista manual.
- Claims prohibidos: G8 PASS, SQL/RLS/advisors live, alert receiver, heartbeat real, canario, rollout o producción verificados.
- Rollback: stop worker/cron, master y lanes false, snapshot agregado; antes de autorización neutralizar draft; después de send POST solo reconciliar el mismo ID.
- Autoridad pendiente: staging y cualquier activación/tramo real requieren gates y autorización directa.

## 2026-08-19 — Prisma — final verification correction

- Observability focal final: `13/13` PASS (threshold/freshness/replay/OFF/no-PII, SQL, actor spoof, bounded chunked/declared body, human transition denial and exact proxy boundary).
- Gate anti-omission: PASS; recursive inventory contains 37 `src/**/*.test.ts` files and explicitly includes `src/app/api/webhooks/hubspot/route.test.ts`.
- Data Brain typecheck passed immediately after Prisma implementation; a later exact-tree run is BLOCKED by concurrent `cold-campaign-dispatch.ts(154)` state-union drift, outside observability.
- Global exact-tree run before the final gate expansion: 248 PASS / 3 FAIL. Two were legacy retry expectations receiving proxy Basic `401`; one was the concurrent scheduler marker `claim_attempts_exhausted`. Setup/readiness: 30 PASS / 1 concurrent scheduler FAIL.
- Build reached Next compilation and failed on the concurrent dashboard CSS module global selector `*`; no observability compilation error was reported.
- These failures keep the aggregate release gate non-PASS; focal Prisma evidence does not override them.

## Entry template

- Fecha/agente:
- Alcance y SHA/manifest digest:
- Cambios:
- Comandos exactos:
- Resultado/evidencia:
- Claims permitidos:
- Claims prohibidos:
- Riesgos/bloqueos:
- Rollback:
- Autoridad pendiente:
