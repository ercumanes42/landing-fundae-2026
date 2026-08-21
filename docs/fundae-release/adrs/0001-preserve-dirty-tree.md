# ADR-0001: Preserve the dirty tree and manifest tracked state

- Estado: accepted
- Fecha: 2026-08-18

## Contexto

La baseline contiene 367 entradas y componentes core no rastreados. Limpiar o resetear destruiría procedencia y trabajo del usuario.

## Decisión

No reset, checkout destructivo, cleanup masivo, clasificación automática ni borrado. El manifiesto hashea solo archivos rastreados y contabiliza estado sin leer contenido untracked.

## Consecuencias

La release no es plenamente reproducible hasta decidir explícitamente qué untracked forma parte del producto. Se gana integridad y auditabilidad sin exponer secretos.
