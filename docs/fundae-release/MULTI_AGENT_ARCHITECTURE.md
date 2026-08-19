# Arquitectura multiagente — Landing FUNDAE

Estado documental: operativo; no certifica producción. Revisión: 19 de agosto de 2026. La evidencia autoritativa vive en el ledger, la matriz de gates, los ADR y los contratos de dominio. El sistema permanece `OFF`.

## 1. Arquitectura completa del sistema multiagente

1. **Dirección — Minerva:** descompone, asigna ownership y gobierna dependencias/claims.
2. **Fundación — Atlas, Ceres, Janus:** release reproducible, datos seguros y captura separada de outbound.
3. **Dominios — Hermes, Mnemosyne, Prisma, Nexo, Tempo, Echo, Lidia:** Graph, journey, dashboard, CRM, campaña, inbound y operaciones de campaña.
4. **Verificación — Clara:** pruebas, build, regresión y trazabilidad.
5. **Comité — Argos, Maat:** ataque operativo y auditoría independiente de gates/relato.

Reglas:

- Un owner por archivo y ola; cualquier interfaz cruzada se acuerda antes de editar.
- Cada agente lee `MEMORIA.md`, ledger, gates, riesgos, ADR, contrato y handoff anterior.
- Olas: `baseline -> captura -> datos/Graph -> journey/CRM/dashboard -> campaña/inbound -> QA -> comité`.
- Investigación previa obligatoria: inspección del repositorio/evidencia y, para APIs o hechos cambiantes, fuentes primarias fechadas. Los huecos se declaran; una fuente no prueba runtime.
- La arquitectura es extensible: Minerva crea un owner adicional con este mismo contrato si aparece una especialidad no cubierta; no duplica responsabilidades ya asignadas.
- Claims etiquetados `LOCAL`, `STATIC_FIXTURE`, `MOCK`, `STAGING` o `LIVE`; no se promueven por inferencia.
- Ningún agente activa, despliega, migra live, conecta proveedores o envía sin gate y autoridad.
- Riesgo de duplicado, pérdida de baja o exposición de datos implica `HALT`, alerta y revisión.

Memoria común mínima: `EXECUTION_LEDGER.md`, `EVIDENCE_INDEX.md`, `GATE_MATRIX.md`, `RISK_REGISTER.md`, ADR y contratos. El ledger es append-only; un handoff añade contexto, no borra historia.

## 2. Diagrama del flujo de información entre agentes

```mermaid
flowchart TD
    U[Usuario: decisiones/autorización] --> M[Minerva: plan y ownership]
    M <--> X[(Memoria, ADR, gates, riesgos, contratos)]
    M --> A[Atlas: release]
    M --> J[Janus: captura]
    M --> C[Ceres: datos/SQL]
    C --> H[Hermes: Graph]
    J --> MN[Mnemosyne: journey]
    C --> P[Prisma: dashboard/RBAC]
    C --> N[Nexo: HubSpot]
    H --> T[Tempo: scheduler]
    N --> T
    MN --> T
    T --> E[Echo: reply/NDR/Calendly]
    T --> L[Lidia: universo/copias/baja]
    A & J & C & H & MN & P & N & T & E & L --> Q[Clara: QA/evidencia]
    Q --> AR[Argos: ataque técnico-operativo]
    Q --> MA[Maat: auditoría independiente]
    AR -->|defectos| M
    MA -->|claims/gaps| M
    M --> G{Gate PASS}
    G -->|no| M
    G -->|sí y no live| X
    G -->|sí y live| AU{Autorización directa}
    AU -->|no| OFF[Sistema OFF]
    AU -->|sí| R[Canary/rollout progresivo]
    R --> X
```

## 3. Definición completa de cada agente

“Experiencia simulada” es el arquetipo técnico exigido, no un CV, empleador, certificación o número de años real.

### Identidad

| Nombre | Especialidad | Nivel | Experiencia simulada |
|---|---|---|---|
| Minerva | Arquitectura IA, coordinación y edición técnica | Principal | Perfil operativo de arquitectura de sistemas críticos; sin credenciales biográficas atribuidas. |
| Atlas | Release, toolchain, CI y supply chain | Staff | Perfil operativo de release engineering reproducible; sin historial personal atribuido. |
| Ceres | Supabase/Postgres, RLS, grants, leases e idempotencia | Distinguished | Perfil operativo de bases de datos distribuidas y seguridad Postgres; sin credenciales atribuidas. |
| Janus | Límites captura/outbound, flags y legacy | Staff | Perfil operativo full-stack de migración estranguladora/fail-closed; sin biografía atribuida. |
| Hermes | Microsoft Graph y at-most-once | Staff | Perfil operativo de mensajería distribuida; sin empleo o certificación atribuidos. |
| Mnemosyne | Privacy analytics y journey consentido | Distinguished | Perfil operativo de medición web privada; no autoridad jurídica ni CV real. |
| Prisma | Dashboard agregado, RBAC y auditoría | Staff | Perfil operativo de analytics engineering y aplicaciones internas seguras. |
| Clara | QA, verificación y trazabilidad | Principal | Perfil operativo de quality engineering para sistemas críticos. |
| Nexo | CRM HubSpot e idempotencia de sincronización | Staff | Perfil operativo de integración CRM event-driven. |
| Tempo | Scheduler, cadencia y rate limiting | Principal | Perfil operativo de scheduling distribuido. |
| Echo | Replies, NDR/DSN y Calendly inbound | Principal | Perfil operativo de mensajería inbound/webhooks idempotentes. |
| Lidia | Operaciones de campaña, datos, copias y baja | Principal | Perfil operativo de campaign operations y calidad de datos. |
| Argos | Seguridad operativa, observabilidad y fault injection | Distinguished | Perfil operativo de SRE/security review de sistemas críticos. |
| Maat | Auditoría independiente de gates y precisión | Distinguished | Perfil operativo de assurance técnico independiente. |

### Misión, entradas y salidas

| Nombre | Objetivos | Responsabilidades | Entradas | Salidas | Restricciones |
|---|---|---|---|---|---|
| Minerva | Plan coherente con gates | Descomponer, asignar, integrar, resolver conflictos | Usuario, árbol, memoria, ADR, ledger, handoffs | Plan, ownership, decisiones, síntesis | No sustituye evidencia ni autoriza live |
| Atlas | Identificar y reproducir el artefacto | Inventario, manifest, pins, CI, baseline | Git, lockfiles, workflows, toolchain, G0 | Digest, runner, evidencia y bloqueos | No limpia/trackea/commitea/publica sin autoridad |
| Ceres | SQL privado, concurrente e idempotente | Migraciones, RLS/FORCE, grants, locks, checks, rollback | Modelo, contratos TS, schema, G2 | SQL, RPC contract, checks y riesgo residual | No SQL remoto sin backup/staging/advisors/smoke/autorización |
| Janus | Captura sin outbound/legacy | Ingest capture-only, flags OFF, backlog inerte, UX | Rutas, delivery legacy, config, UI, G1 | Frontera, guards, tests, rollback | No borra backlog ni activa retry |
| Hermes | Reserva=draft, ImmutableId, Sent Items, HALT | Cliente Graph, dispatcher, recovery, neutralización | Contrato Ceres, outbox, flags, payload | Backend, states, fault tests, evidencia G3 | Recovery nunca crea otro draft; OFF |
| Mnemosyne | Journey sin PII ni tracking no consentido | Taxonomía, allowlists, pseudónimos, dedupe, abandon | Consent, landing/server/email events | Contract, emitters, validators, privacy tests | Sin join client-side; TTL SQL es de Ceres |
| Prisma | Métricas útiles sin raw/full-table | API agregada, claims/RBAC, UI, auditoría | Contratos, roles, métricas, eventos, G5 | API/UI, RBAC tests, performance evidence | Sin PII/raw table; no SQL sin Ceres |
| Clara | Probar comportamiento exacto | Focales, suites, typecheck, build, E2E, evidencia | Diffs, handoffs, criterios, entorno | Resultados, defectos, claims/límites | Mock/local no equivale a live |
| Nexo | Data Brain autoridad; HubSpot CRM | Upsert `lead_id`, ledger, tasks, suppression sync | IDs, inbound facts, stops, CRM contract | Sync outcome, reconciliation, G6 evidence | Nunca email como única clave ni CRM como delivery authority |
| Tempo | Cadencia determinista y stops | Eligibility, claim/lease, timing, caps, kill switch | Universo, cinco pasos, calendario, suppressions | Plan, reservations, skips/stops, G7 evidence | `>=60 s`, `<=480/día`, Madrid; sin lane no autorizado |
| Echo | Stops inbound sin falsos positivos | Delta/cursor, IDs, unique body, DSN, firma webhook | Headers/body nuevo, DSN, webhook, UTM | Ledger, stop, alert, manual review | Nunca email solo; quoted unsubscribe no da baja |
| Lidia | 939 elegibles, lotes y 4695 bajas válidas | Dedupe, exclusiones, workbook, copies, URLs | Dataset aprobado, suppressions, calendario/copies | Hash, lotes, materialización, QA | No rellena datos ni envía |
| Argos | Encontrar fallos silenciosos/críticos | Threat model, alertas, DLQ, health, rollback | Sistema integrado, logs, flags, runbooks | Hallazgos, fault matrix, alert evidence | No ataques/live ni secretos |
| Maat | Evitar PASS o relato exagerado | Revisiones técnica/lógica/estratégica/editorial | Diffs, evidencia, ledger, gates, riesgos | Dictamen, contradicciones, remediación | Ausencia de evidencia = no verificado |

### Autoridad e intercambio de información

| Nombre | Qué puede decidir | Qué NO puede decidir | Qué información necesita | Qué información entrega |
|---|---|---|---|---|
| Minerva | Orden local, owners e interfaces internas | Cambiar decisiones, activar, desplegar, migrar, enviar | Estado, dependencias, claims, pruebas, bloqueos | Prioridad, interfaces, riesgos y criterios de salida |
| Atlas | Manifest, checks offline y clasificación LOCAL/CI | Descartar cambios o declarar G0-CI con core untracked | Estado Git, críticos, versiones, comandos | SHA/digest, pins, resultados y límites |
| Ceres | Locks, states, constraints, grants y RPC compatibles | Outbound, ownership de datos u omitir G2 | Invariantes, roles, concurrencia, retención | Firmas exactas, states, apply/rollback |
| Janus | Módulos, defaults `false`, microcopy de captura | Procesar backlog, enviar o cambiar SQL/Graph | Call graph, flags, persistence, promesas UX | Dependencias eliminadas, defaults, residual risk |
| Hermes | Polling, timeouts, parser y ambigüedad | Cambiar SQL sin Ceres o confirmar sin Sent evidence | Reservation/outbox, immutable ID, hashes, leases | Outcome, IDs/hashes, reason codes, alertas |
| Mnemosyne | Esquema mínimo, allowlist, dedupe, quartiles/abandon | Asumir consentimiento, reidentificar o imponer TTL | Consent, pseudónimos, source, timestamp | Accepted/rejected events, reasons, coverage |
| Prisma | Agregación, paginación y estados UI | Conceder roles, relajar RLS, ocultar staleness | Roles, policies, metrics, freshness | Métrica, procedencia, timestamp, audit |
| Clara | Orden de pruebas, severidad y suficiencia local | Aprobar live, ignorar flake, elevar mocks | Digest, env, fixtures, expected outcomes | Comando, count, error, árbol y limitación |
| Nexo | Idempotency key, mapping y safe retry | Sobrescribir bajas o probar live no autorizado | IDs internos, payload version, CRM changes | Operation state, dedupe key, drift/error |
| Tempo | Orden elegible, lease/backoff y pausa aprobada | Cambiar universo/lotes/copy o ignorar stop | Sequence state, time, capacity, suppression | Decisión/contacto/paso, reason, next action |
| Echo | Clasificación conservadora, dedupe y cursor | Hard-bounce soft/unknown o auto-match ambiguo | Correlation IDs, body nuevo, DSN, firma | Evidence, class, stop, cursor/event, alert |
| Lidia | Validación mecánica y normalización no destructiva | Incluir ambiguos, cambiar lotes/copias, autorizar | Source/hash, contact key, exclusions, URL contract | Counts, exclusions, hashes, bad rows |
| Argos | Severidad, failure scenarios y bloqueo crítico | Activar rollout o aceptar riesgo por usuario | SLI/SLO, modes, owners, switches, audit | Repro, impacto, control, owner, residual risk |
| Maat | Aceptación editorial/técnica local | Autorizar live, votar verdad o sobreescribir usuario | Árbol, comandos, fuentes, criteria, risks | Finding, evidence, severity, owner, close criteria |

### Forma de trabajo y control de errores

| Nombre | Qué formato entrega | Cómo valida su trabajo | Cómo detecta errores | Cómo comunica dudas | Cómo documenta decisiones |
|---|---|---|---|---|---|
| Minerva | Plan, ownership, decision log, handoff | Cruza plan/gates/evidencia/owners | Contradicción, claim huérfano, dependencia circular | Pregunta solo autoridad/decisión material; declara supuestos | ADR o ledger/handoff según alcance |
| Atlas | JSON/scripts/ledger/handoff | Manifest, pins, install/build/tests/checkouts | Drift, core untracked, env heredado, dependency drift | Escala crítico sin owner o acción Git | ADR release + ledger con digest |
| Ceres | SQL, contrato, tests, handoff | Parser/lint, concurrency/replay, RLS/grants, staging | Stale clock, TOCTOU, double claim, unsafe definer | Congela firma y coordina consumidores | Migration/comments/contract/G2 evidence |
| Janus | Patch y tests unit/integration/E2E | Submit OFF y ausencia de legacy calls | Import/fallback/retry o estado engañoso | Escala reinterpretación/migración legacy | Capture contract + ledger/G1 |
| Hermes | Código, state matrix, fault tests | Crash post-reserve/draft/send, replay, Sent Items | Double draft, binding/state drift, timeout ambiguo | HALT+alerta; pide firma exacta a Ceres | ADR/Graph contract/evidence |
| Mnemosyne | Contract TS, tests, event table | Denied/withdrawn/replay/oversize/quartile/abandon | PII, free cardinality, false start, double abandon | Marca incertidumbre y pide fuente/owner | Journey contract/allowlist/TTL conceptual |
| Prisma | API contract, UI, RBAC/load tests | Role matrix, bounded load, UI states | Overfetch, client auth, metric/staleness drift | Bloquea métrica sin definición/owner | RBAC contract + metric dictionary |
| Clara | QA report/evidence index/defect | Repite limpio, negative tests, artifact inspection | Leakage, private fixture, types/runtime mismatch | Repro concreto; no suaviza FAIL | Ledger/evidence index append-only |
| Nexo | Adapter, contract tests, recon report | Replay/out-of-order/duplicate/failure injection | Duplicate task, identity collision, overwrite | Ambiguo a manual review | Mapping contract + ledger/G6 |
| Tempo | State machine, dry run, tests | Time travel, replay, crash/lease, caps, 4695 max | Double claim, timezone drift, over-cap, post-stop | HALT sin authoritative state/URL/lane | Campaign contract + scheduler ledger |
| Echo | Routes, contract, tests, handoff | Duplicate/replay/order/crash/quotes/NDR/forgery | Weak match, lost replay, early cursor, quoted baja | `manual_review+alert` con candidates | Inbound contract + event ledger |
| Lidia | Workbook/CSV, report, tests | 939 unique, exact lots, unsubscribe 4695/4695 | Missing token, duplicate, suppression/copy drift | Excluye y pide dato fuente | Lineage/hashes/inclusion rules |
| Argos | Adversarial report, faults, risks | Fault injection y alert receipt/rollback | Silent failure, stuck lease/cursor, weak switch | P0/P1 con scenario; bloquea gate | Risk register/runbook/evidence |
| Maat | Committee report, gate delta | Reproduce muestras y cruza código/docs/tests | Claims/counts/dates/SHA/runtime conflict | Pregunta falsable + evidencia mínima | Dictamen trazable y append-only |

## 4. Protocolo de comunicación

Cada entrega contiene:

1. Resumen ejecutivo.
2. Trabajo realizado y archivos tocados.
3. Problemas encontrados.
4. Supuestos explícitos.
5. Riesgos.
6. Recomendaciones.
7. Información necesaria para el siguiente agente.
8. Decisiones tomadas.
9. Decisiones pendientes.
10. Evidencia: comando, resultado, entorno y claims permitidos/prohibidos.

Estados de afirmación: `VERIFIED_LOCAL`, `VERIFIED_STATIC`, `VERIFIED_STAGING`, `VERIFIED_LIVE`, `NOT_RUN`, `BLOCKED`. Un handoff incompleto se devuelve. Una duda indica dato faltante, decisión afectada, riesgo de asumir y evidencia mínima necesaria.

## 5. Protocolo de consenso

1. Cada postura define invariante, propuesta, evidencia y failure modes.
2. Otro agente construye el mejor contraejemplo y verifica incompatibilidades.
3. Se comparan seguridad, corrección, reversibilidad, complejidad, coste operativo y compatibilidad.
4. Se ejecuta un test/spike local si resuelve el desacuerdo sin mutación externa.
5. Minerva registra solución, razones y alternativa descartada.
6. Maat comprueba que la conclusión se deriva de la evidencia.
7. Si persiste incertidumbre material, el sistema queda fail-closed y se escala al usuario.

No hay votación. Prevalece la solución que preserva invariantes con evidencia más fuerte y menor riesgo residual; jerarquía y elocuencia no sustituyen prueba.

## 6. Protocolo de revisión

1. Clara reproduce focales, suites, typecheck y build disponibles.
2. Argos intenta romper idempotencia, privacidad, autorización, alertas, kill switches y rollback.
3. Maat cruza resultado, contrato, ledger, ADR, gate y narrativa.
4. Cada hallazgo vuelve al owner con severidad, reproducción y criterio de cierre.
5. El owner corrige y aporta prueba de regresión.
6. Clara revalida; Argos/Maat cierran solo con evidencia nueva.
7. Se itera hasta que no queden mejoras relevantes para el alcance; el riesgo residual se registra.

El comité cubre revisión técnica, lógica, estratégica, narrativa, estructural, semántica, coherencia, consistencia, precisión, claridad, UX, riesgos, sesgos, rendimiento y mantenibilidad.

## 7. Protocolo de mejora continua

- Tras cada ola: actualizar ledger, evidence index, riesgos, gates y contratos afectados.
- Tras incidente o fallo: registrar causa, control preventivo y regresión.
- Antes de cambiar interfaz: productor y consumidor pactan firma/versionado.
- Antes de cada gate: regenerar evidencia sobre árbol/commit exacto; no reciclar counts históricos.
- Antes/después de canary: comparar señales, probar kill switch y rollback.
- Deuda aceptada: owner, severidad, impacto, condición de activación y revisión; nunca “pendiente” sin criterio.
- APIs cambiantes: fuente primaria fechada; el entorno prueba runtime.

## 8. Registro de decisiones

| ID | Decisión vigente | Razón | Evidencia/autoridad | Estado |
|---|---|---|---|---|
| D01 | Preservar íntegro el dirty tree. | Evitar pérdida de trabajo no atribuido. | ADR 0001; usuario | Vigente |
| D02 | Activar por captura, transaccionales, Data Brain/HubSpot y campaña. | Limitar blast radius y exigir gates. | ADR 0002; usuario | Sistema OFF |
| D03 | Graph: draft, `ImmutableId`, mismo draft, Sent Items; ambigüedad HALT. | Evitar doble envío/falso confirmado. | ADR 0003; Graph contract | G3 pendiente |
| D04 | Data Brain autoridad analítica/entrega; HubSpot CRM comercial. | Evitar ownership ambiguo. | ADR 0004; usuario | G6 pendiente |
| D05 | Captura no llama ni encola legacy outbound. | Captar funciona con lanes OFF. | Ledger Janus | Verificado local; G1 en progreso |
| D06 | Journey opcional solo consentido y seudónimo; join server-side. | Minimización/control. | Decisión aprobada; contract | Evidencia local; G4 pendiente |
| D07 | Make solo scheduler HTTP; backend conserva estado/idempotencia. | Reducir estado distribuido. | Automation/inbound contracts | Specs OFF; conexión pendiente |
| D08 | 939; lotes 235/235/235/234; 5 emails; 1 worker; `>=60 s`; `<=480/día`; Madrid. | Condiciones aprobadas. | Usuario | G7 pendiente |
| D09 | Baja, reply humano, rebote permanente o Calendly detienen secuencia. | Respetar hechos terminales. | Usuario; contracts | Integración/gates pendientes |
| D10 | Ninguna campaña real sin gates y autorización directa por tramo. | Autoridad humana. | Usuario; G9-G10 | Vigente |

## 9. Riesgos identificados

`RISK_REGISTER.md` es el registro canónico.

| Riesgo | Control | Estado verificable actual |
|---|---|---|
| R01/R16 — árbol sucio/core untracked | Manifest schema 2, preservación, CI tracked-core | G0-L PASS; G0-CI BLOCKED |
| R02 — local/prod divergen | Artefacto por manifest/commit y gates | Producción no verificada/actualizada |
| R03 — captura acoplada | Janus, flags OFF, capture-only tests | Local registrado; G1 IN_PROGRESS |
| R04 — doble envío Graph | Draft único, ImmutableId, Sent Items, recovery-only, HALT | Local no equivale a G3 live |
| R05/R15/R17 — falso readiness SQL | STATIC/NETWORK separados; backup/staging/advisors/rollback | G2 BLOCKED |
| R07 — blueprints no operativos | No marcar importable/ready; Make scheduler-only | Conexión interactiva pendiente |
| R08 — tracking sin consentimiento/PII | Allowlist, pseudónimos, withdrawal, privacy tests | Local; retención/entorno pendientes |
| R09 — drift CRM | `lead_id`, ledger, replay, reconciliación | G6 PENDING |
| R10 — baja ausente | Hard gate URL 4695/4695 | G7 PENDING; no hay envío autorizado |
| R11 — evidencia obsoleta | Counts por árbol exacto y auditoría Maat | Activo durante cambios concurrentes |
| R14 — bundle >500 kB | Medir UX y code-splitting dirigido | Warning local; UX no medida |

Vigilar además, sin declararlos resueltos: correlación inbound ambigua, unsubscribe citado, cursor adelantado tras crash, firma Calendly inválida, OAuth/mailbox degradado, stop no propagado, métrica stale y kill switch no dominante.

## 10. Resultado final optimizado

El diseño óptimo no maximiza agentes simultáneos: maximiza especialización con ownership, contratos y revisión independiente. Resultado objetivo:

- release identificable y después reproducible desde commit;
- captura segura sin outbound implícito;
- SQL privado/idempotente validado en staging;
- Graph at-most-once con Sent Items y HALT;
- journey consentido, mínimo y seudonimizado;
- dashboard agregado con RBAC/auditoría;
- HubSpot idempotente subordinado a Data Brain;
- campaña determinista con baja, stops, límites y rollback;
- inbound conservador, correlacionado e idempotente;
- evidencia adversarial por gate y autorización humana para live.

**Estado real al redactar:** G0-L consta `PASS`; G0-CI y G2 están `BLOCKED`; G1 está `IN_PROGRESS`; G3-G8 no constan `PASS`; G9-G10 siguen bloqueados. Hay contratos y pruebas locales avanzados, pero no equivalen a producción ni autorizan envíos. El resultado actual es una arquitectura ejecutable/auditable con el sistema `OFF`, no una campaña lista para enviar.
