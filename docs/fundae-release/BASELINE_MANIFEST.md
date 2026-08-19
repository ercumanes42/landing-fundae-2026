# Reproducible baseline manifest (schema 2)

`node scripts/release/baseline-manifest.mjs` emite JSON por stdout. No escribe en el repositorio.

Incluye HEAD/rama, toolchain, conteos de códigos Git y dos inventarios SHA-256:

- `trackedFiles`: todo el índice Git; los eliminados se registran como `present=false`.
- `coreFiles`: allowlist ejecutable de release, aplicación, tests, automatización, Data Brain y artefactos Supabase. Incluye el núcleo crítico aunque todavía figure `untracked`.

`trackedFilesDigest`, `coreFilesDigest` y `releaseInputsDigest` son deterministas para el mismo contenido. Cada entrada de `coreFiles` declara `gitState`; `criticalUntrackedCoreFiles` hace visible lo que impediría empaquetar una release desde Git.

Uso local seguro:

```powershell
npm.cmd run release:manifest
npm.cmd run release:manifest:verify
npm.cmd run release:candidate:dry-run
npm.cmd run test:release-candidate
npm.cmd run clean:dry-run
```

`release:candidate:dry-run` transforma el manifest schema 2 y el porcelain Git
en una allowlist determinista con SHA-256. Clasifica cambios modificados,
eliminados y no rastreados, pero no escribe archivos ni ejecuta operaciones que
alteren índice, rama o commit (`GIT_OPTIONAL_LOCKS=0`). Rechaza entradas core
ausentes/ignoradas, enlaces simbólicos, rutas privadas o de output y binarios
fuera de `public/`; dentro de `public/` solo acepta extensiones binarias
allowlisted. No busca secretos por contenido ni emite contenido: registra solo
rutas, metadatos y hashes.

Las eliminaciones ya materializadas de artefactos rastreados bajo rutas
prohibidas se separan como
`trackedGeneratedOrPrivateArtifactsToRemove`: su única intención futura es
`delete-from-repository-only`, nunca restaurarlas ni incluirlas en el paquete.
El dry-run conserva el OID del blob del índice como evidencia.

En CI, `verify-manifest.mjs --require-tracked-core` falla si cualquier entrada core no está rastreada. Después se redirige el JSON a `$RUNNER_TEMP` y se publica como artefacto temporal. Para reproducir: checkout del mismo HEAD, usar Node/npm fijados, ejecutar `npm ci` en raíz y `data-brain`, comparar `releaseInputsDigest` y correr gates.

Exclusiones deliberadas: secretos `.env*` salvo `.env.example`, datos privados, dumps, workbooks, logs, cachés y outputs generados. La allowlist evita recorrer directorios privados. La verificación local puede pasar con `LOCAL_ONLY`; no significa que el commit sea empaquetable. Track/commit sigue siendo una decisión explícita del propietario y no se realiza aquí.
