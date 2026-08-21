# ADR-0003: Graph draft identity and Sent Items confirmation

- Estado: accepted; implementación pendiente G3
- Fecha: 2026-08-18

## Decisión

Crear draft con `Prefer: IdType="ImmutableId"`, persistir su ID, enviar exactamente ese draft y confirmar en Sent Items antes de `confirmed_sent`. Una reserva corresponde a un draft; resultados ambiguos detienen y alertan.

## Alternativas rechazadas

`sendMail` sin identidad durable y conciliación manual como operación final: no permiten idempotencia fuerte ante timeout.
