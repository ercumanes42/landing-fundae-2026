# ADR-0004: Data Brain analytics, HubSpot commerce

- Estado: accepted; implementación pendiente G4-G6
- Fecha: 2026-08-18

## Decisión

Data Brain es la fuente analítica/entrega; HubSpot es el CRM comercial. El journey es consentido, seudonimizado y se une con `lead_id` solo server-side. La sincronización HubSpot es idempotente por `lead_id`.

## Consecuencias

Supresiones, replies y reuniones deben converger en ambos sistemas, pero los dashboards y eventos operativos permanecen agregados en Data Brain.
