# Evidence index

Toda evidencia debe registrar SHA/manifest digest, fecha, comando, exit code y ubicación no secreta. Los artefactos CI no se escriben en rutas tracked.

| ID | Evidencia | Estado | Ubicación/comando |
|---|---|---:|---|
| E00 | Baseline previo a Atlas: 367 entradas, `main@9e90936` | VERIFIED 2026-08-18 | `git status --short --untracked-files=all`; `git rev-parse HEAD` |
| E01 | Toolchain Node 22.18.0/npm 11.11.0 | VERIFIED 2026-08-18 | `node --version`; `npm.cmd --version` |
| E02 | Rama `codex/fundae-release` con commits selectivos; secretos, datos privados y outputs excluidos | VERIFIED_LOCAL 2026-08-19 | `git diff --cached --check`; manifiesto y candidate plan del commit final; falta ejecución GitHub |
| E03 | Landing unit 29/29, typecheck, build y E2E fresco 17/17 con servidor dedicado cerrado | VERIFIED_LOCAL 2026-08-19 | `npm run test:unit`; `npm run lint`; `npm run build`; `CI=1 RELEASE_FRESH_SERVER=1 npm run test:e2e` |
| E04 | Data Brain 337/337 + anti-omisión 1/1; setup/readiness 37/37; typecheck y build | VERIFIED_LOCAL 2026-08-20 | `npm --prefix data-brain run test`; `test:setup`; `lint`; `build`; todos los switches OFF |
| E05 | Automation static/offline, incluido productor firmado de cinco snapshots, HMAC, Make scheduler-only y provisioner cold v3 fail-closed, 87/87 | VERIFIED_LOCAL 2026-08-20 | `npm run test:automation` |
| E06 | Supabase staging independiente `rqjvbpvkjzqqqdxqcqmz`: outbox durable HubSpot aplicado sobre el baseline validado; postcheck y smoke HubSpot rollback-only PASS; proyecto pausado tras la prueba | VERIFIED_STAGING; G2 IN_PROGRESS 2026-08-20 | `fundae_release_postcheck_ok`; `fundae_release_hubspot_sync_smoke_ok`; master/transaccional/cold/HubSpot OFF, 0 claims y acceso directo service-role denegado; advisors 42 INFO seguridad y 68 INFO rendimiento, 0 WARN/ERROR; faltan backup/producción autorizada y NETWORK_G2 aplicativo |
| E10 | Supply chain CI: 7/7 acciones externas en allowlist y SHA completo; runner OS acotado | VERIFIED_LOCAL 2026-08-19 | `npm run release:ci-pins`; falta ejecución GitHub |
| E11 | Integridad y portabilidad del SQL corregido tras ejecución real en staging | VERIFIED_LOCAL/STAGING 2026-08-19 | pruebas de portabilidad/orden/paridad PASS; `git diff --check` exit 0; solo avisos informativos LF/CRLF |
| E12 | Aviso Legal con identidad, canales y datos registrales públicos; Privacidad/Cookies no promovidas | VERIFIED_LOCAL_PARTIAL 2026-08-19 | `LEGAL_VERIFICATION_20260819.md`; unit 19/19; typecheck/build PASS; E2E legal 3/3 |
| E07 | Graph fresh 4/4 with draft/Sent Items evidence | PENDING | redacted correlation ledger |
| E08 | Campaña controlada: 939 contactos únicos, lotes 235/235/235/234 y 4695/4695 cuerpos identificados con baja; productor hash-only para cinco snapshots implementado | VERIFIED_LOCAL; READINESS BLOCKED 2026-08-20 | `automation/campaign-reports/FUNDAE_2026_CONTROLLED_COPY_REPORT.json`; faltan los cinco exports privados reales, 939 `PENDIENTE` y autorización `PENDING`; cero importación/envío |
| E09 | Canary/rollout live | BLOCKED | authorization + runbook receipts |

No almacenar webhook URLs, tokens, email addresses, raw PII, `.env`, private workbook rows ni message bodies en este índice o artefactos públicos.
