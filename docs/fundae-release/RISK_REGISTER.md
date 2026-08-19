# Risk register

| ID | Riesgo | Severidad | Señal | Mitigación / owner |
|---|---|---:|---|---|
| R01 | Árbol sucio no reproducible o cambios perdidos | crítica | manifest/status drift | preservar; manifest schema 2 tracked+core; Atlas/release |
| R02 | Código local y landing prod divergen | alta | SHA/build distinto | desplegar solo artefacto con manifest y gates; release |
| R03 | Captura sigue acoplada a legacy/outbound | crítica | submit falla con lane OFF | capture-only + switches dominantes; Janus |
| R04 | Doble envío Graph tras timeout | crítica | draft/reserva múltiple | ImmutableId, same-draft retry, Sent Items reconcile, halt; Graph owner |
| R05 | SQL live sin backup/lint Postgres/advisors | crítica | ausencia de evidencia | gate G2 bloqueado; scripts pre/post/rollback y orden obligatorio; Ceres |
| R06 | CI requiere datos privados no versionados | alta | tests leen `data-private` | suite CI explícita offline; datasets solo en gates controlados; release |
| R07 | Blueprints son specs no importables | alta | `production_ready=false` | no afirmar operativo; construir/validar escenarios OFF; automation |
| R08 | Reidentificación o tracking sin consentimiento | alta | PII/client join | seudónimos, minimización, join server-side, privacy tests; journey |
| R09 | Drift Data Brain/HubSpot y duplicados | alta | replay crea registros/tareas | idempotency ledger + replay/reconciliation; CRM |
| R10 | Baja ausente en copias materializadas | crítica | cualquier email sin URL válida | pre-send hard gate 4695/4695; campaign |
| R11 | Docs/evidencia obsoleta crean falso PASS | alta | claim sin SHA/digest | evidence index + exact-tree rerun; committee |
| R12 | Supply-chain drift en GitHub Actions o imagen runner | media | pin/action o imagen cambia | acciones en allowlist fijadas a SHA; runner `ubuntu-24.04`; revisar upgrades manualmente; release |
| R13 | Toolchain exacta no soportada por destino | media | Vercel/runner reject | validar staging; cambiar solo mediante ADR; release |
| R14 | Bundle principal supera 500 kB minificado | media | warning Vite | medir UX real y code splitting sin bloquear la fundación; frontend |
| R15 | Fixture/OpenAPI interpretado como DB lista | crítica | CI verde sin SQL/advisors | etiquetas STATIC_FIXTURE/NETWORK_G2; G2 solo con evidencia SQL completa; release+Ceres |
| R16 | Núcleo nuevo no rastreado no existe en un checkout del commit | alta | `criticalUntrackedCoreFiles` no vacío | hashear/reportar localmente; CI `--require-tracked-core`; aprobación antes de track/release; release |
| R17 | `STATIC_FIXTURE` hereda configuración local o se interpreta como live | crítica | `.env` altera resultado o claim G2 | env aislado en runner release; mensajes STATIC/NETWORK; G2 conserva evidence pack SQL; release+Ceres |
| R18 | Observabilidad verde sin productores/receiver live | crítica | heartbeat ausente o alerta sin receipt externo | OFF por defecto; G8 no pasa con tests locales; staging + fault injection + receipts; Prisma/SRE |

Escalación: cualquier riesgo crítico activado mantiene o devuelve los switches a `false` y bloquea el gate dependiente.
