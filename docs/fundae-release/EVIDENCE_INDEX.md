# Evidence index

Toda evidencia debe registrar SHA/manifest digest, fecha, comando, exit code y ubicación no secreta. Los artefactos CI no se escriben en rutas tracked.

| ID | Evidencia | Estado | Ubicación/comando |
|---|---|---:|---|
| E00 | Baseline previo a Atlas: 367 entradas, `main@9e90936` | VERIFIED 2026-08-18 | `git status --short --untracked-files=all`; `git rev-parse HEAD` |
| E01 | Toolchain Node 22.18.0/npm 11.11.0 | VERIFIED 2026-08-18 | `node --version`; `npm.cmd --version` |
| E02 | Manifest schema 2: 165 tracked, 339 core y 228 core críticos untracked; sin secretos/privados | VERIFIED_LOCAL 2026-08-19 | `npm run release:manifest:verify`; snapshot previo a esta actualización documental `releaseInputsDigest=728ac650b836eedab5c1d4552bf16edcfc50300f56fb5d3ea97943b839eb81dc`; G0-CI bloqueado |
| E03 | Landing unit 19/19, typecheck, build y E2E fresco 16/16 con un worker y servidor dedicado cerrado | VERIFIED_LOCAL 2026-08-19 | `npm run test:unit`; `npm run lint`; `npm run build`; `CI=1 RELEASE_FRESH_SERVER=1 npm run test:e2e` |
| E04 | Data Brain src 269/269 + anti-omisión 1/1; setup/readiness 34/34; typecheck, build y STATIC_FIXTURE | VERIFIED_LOCAL 2026-08-19 | `npm --prefix data-brain run test`; `test:setup`; `lint`; `build`; `db:verify` con fixture no-live y switches OFF |
| E05 | Automation static/offline, incluido provisioner cold fail-closed, 72/72 | VERIFIED_LOCAL 2026-08-19 | `npm run test:automation` |
| E06 | Supabase: no-op ADR-0005 fijado por SHA/ID/sucesora; gate pack 5/5 con pruebas negativas y 14 inputs inventariados | VERIFIED_LOCAL; G2 BLOCKED 2026-08-19 | `npm run test:supabase-gate-pack`; `npm run release:supabase:gates:static` -> `FUNDAE_SUPABASE_GATE_PACK_STATIC_OK`; faltan staging, advisors, NETWORK_G2 y rollback real |
| E10 | Supply chain CI: 7/7 acciones externas en allowlist y SHA completo; runner OS acotado | VERIFIED_LOCAL 2026-08-19 | `npm run release:ci-pins`; falta ejecución GitHub |
| E11 | Integridad del diff local | VERIFIED_LOCAL 2026-08-19 | `git diff --check` exit 0; solo avisos informativos LF/CRLF |
| E12 | Aviso Legal con identidad, canales y datos registrales públicos; Privacidad/Cookies no promovidas | VERIFIED_LOCAL_PARTIAL 2026-08-19 | `LEGAL_VERIFICATION_20260819.md`; unit 19/19; typecheck/build PASS; E2E legal 3/3 |
| E07 | Graph fresh 4/4 with draft/Sent Items evidence | PENDING | redacted correlation ledger |
| E08 | Campaña controlada: 939 contactos únicos, lotes 235/235/235/234 y 4695/4695 cuerpos identificados con baja | VERIFIED_LOCAL; READINESS BLOCKED 2026-08-19 | `automation/campaign-reports/FUNDAE_2026_CONTROLLED_COPY_REPORT.json`; 939 `PENDIENTE`, exclusiones `PENDING_RECHECK` y autorización `PENDING`; cero importación/envío |
| E09 | Canary/rollout live | BLOCKED | authorization + runbook receipts |

No almacenar webhook URLs, tokens, email addresses, raw PII, `.env`, private workbook rows ni message bodies en este índice o artefactos públicos.
