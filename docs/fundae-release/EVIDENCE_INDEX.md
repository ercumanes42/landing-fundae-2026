# Evidence index

Toda evidencia debe registrar SHA/manifest digest, fecha, comando, exit code y ubicación no secreta. Los artefactos CI no se escriben en rutas tracked.

| ID | Evidencia | Estado | Ubicación/comando |
|---|---|---:|---|
| E00 | Baseline previo a Atlas: 367 entradas, `main@9e90936` | VERIFIED 2026-08-18 | `git status --short --untracked-files=all`; `git rev-parse HEAD` |
| E01 | Toolchain Node 22.18.0/npm 11.11.0 | VERIFIED 2026-08-18 | `node --version`; `npm.cmd --version` |
| E02 | Rama `codex/fundae-release`; primer commit selectivo `a76fd5d2c94b23ce924742baef877a84172af2da`; manifest schema 2 con 365 tracked y 348 core antes de esta actualización documental | VERIFIED_LOCAL 2026-08-19 | `npm run release:manifest:verify`; `releaseInputsDigest=b393f401b7a4ef1ffa7f08deb23184b6e9ab301f826b9818c6c304f6e1d60e3c`; faltan segundo commit y ejecución GitHub |
| E03 | Landing unit 26/26, typecheck, build y E2E fresco 16/16 con un worker y servidor dedicado cerrado | VERIFIED_LOCAL 2026-08-19 | `npm run test:unit`; `npm run lint`; `npm run build`; `CI=1 RELEASE_FRESH_SERVER=1 npm run test:e2e` |
| E04 | Data Brain 301/301 + anti-omisión 1/1; setup/readiness 37/37; typecheck y build | VERIFIED_LOCAL 2026-08-19 | `npm --prefix data-brain run test`; `test:setup`; `lint`; `build`; todos los switches OFF |
| E05 | Automation static/offline, incluidos HMAC, Make scheduler-only y provisioner cold fail-closed, 78/78 | VERIFIED_LOCAL 2026-08-19 | `npm run test:automation` |
| E06 | Supabase staging independiente `rqjvbpvkjzqqqdxqcqmz`: pack completo, reparación HMAC y alertas durables aplicadas; postcheck/smoke PASS; proyecto PAUSED | VERIFIED_STAGING; G2 IN_PROGRESS 2026-08-19 | `fundae_release_postcheck_ok`; `fundae_release_behavior_smoke_ok`; outbound/purge/provisioning permanecieron OFF; alert receipts vacíos tras rollback; advisors 39 INFO seguridad y 51 INFO rendimiento, sin WARN/ERROR; faltan backup/producción autorizada y NETWORK_G2 aplicativo |
| E10 | Supply chain CI: 7/7 acciones externas en allowlist y SHA completo; runner OS acotado | VERIFIED_LOCAL 2026-08-19 | `npm run release:ci-pins`; falta ejecución GitHub |
| E11 | Integridad y portabilidad del SQL corregido tras ejecución real en staging | VERIFIED_LOCAL/STAGING 2026-08-19 | pruebas de portabilidad/orden/paridad PASS; `git diff --check` exit 0; solo avisos informativos LF/CRLF |
| E12 | Aviso Legal con identidad, canales y datos registrales públicos; Privacidad/Cookies no promovidas | VERIFIED_LOCAL_PARTIAL 2026-08-19 | `LEGAL_VERIFICATION_20260819.md`; unit 19/19; typecheck/build PASS; E2E legal 3/3 |
| E07 | Graph fresh 4/4 with draft/Sent Items evidence | PENDING | redacted correlation ledger |
| E08 | Campaña controlada: 939 contactos únicos, lotes 235/235/235/234 y 4695/4695 cuerpos identificados con baja | VERIFIED_LOCAL; READINESS BLOCKED 2026-08-19 | `automation/campaign-reports/FUNDAE_2026_CONTROLLED_COPY_REPORT.json`; 939 `PENDIENTE`, exclusiones `PENDING_RECHECK` y autorización `PENDING`; cero importación/envío |
| E09 | Canary/rollout live | BLOCKED | authorization + runbook receipts |

No almacenar webhook URLs, tokens, email addresses, raw PII, `.env`, private workbook rows ni message bodies en este índice o artefactos públicos.
