# ADR-0002: Fail-closed phased activation

- Estado: accepted
- Fecha: 2026-08-18

## Decisión

Secuencia obligatoria: captura segura -> transaccionales -> Data Brain/HubSpot -> campaña. Todos los switches empiezan en `false`; `OUTBOUND_MASTER_ENABLED=false` domina. Cada fase requiere gates y rollback antes de la siguiente.

## Consecuencias

Un PASS técnico no activa producción. Canary, microbatch y lotes exigen autorización directa. Cualquier ambigüedad o riesgo crítico vuelve a OFF.
