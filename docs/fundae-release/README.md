# FUNDAE release control plane

Este directorio es el contexto compartido y append-only de la release. No contiene secretos, PII ni evidencia live.

- `EXECUTION_LEDGER.md`: acciones, resultados y claims.
- `GATE_MATRIX.md`: estado de gates y autoridad requerida.
- `INTERFACE_CATALOG.md`: contratos entre dominios.
- `RISK_REGISTER.md`: riesgos, mitigaciones y triggers.
- `EVIDENCE_INDEX.md`: índice de evidencia reproducible.
- `BASELINE_MANIFEST.md`: alcance y uso del manifiesto.
- `HANDOFF_TEMPLATE.md`: entrega obligatoria entre especialistas.
- `DASHBOARD_RBAC_CONTRACT.md`: agregados, muestras acotadas, roles y auditoría.
- `adrs/`: decisiones de arquitectura.

Reglas: el sistema permanece OFF; `PASS` exige evidencia del árbol exacto; una prueba local no demuestra producción; deploys, migraciones y envíos reales requieren gates y autorización directa. El manifiesto schema 2 hashea el núcleo crítico incluso cuando está untracked, pero CI rechaza ese estado hasta que el propietario lo incluya explícitamente en Git.

## Gate legal de despliegue

`npm run release:deploy:gate` es un gate exclusivo de producción y fail-closed. Aviso Legal, Privacidad y Cookies ya están verificados localmente, pero el gate continúa devolviendo `FUNDAE_LEGAL_DEPLOY_GATE_BLOCKED pending=documentary-closure`: la aprobación del texto no autoriza producción. `verify:release` con `FUNDAE_RELEASE_TARGET=production`, los pushes a `main` y el `buildCommand` de Vercel para `VERCEL_ENV=production` ejecutan el bloqueo real; los previews siguen disponibles para QA.
