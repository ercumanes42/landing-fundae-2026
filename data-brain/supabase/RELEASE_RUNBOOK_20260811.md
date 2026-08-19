# Supabase release runbook - FUNDAE 2026

Estado: **preparado, no aplicado**. Proyecto objetivo: `vftwranrgvbtqfiwtqjz`.

Esta es la unica secuencia autorizada para el cierre de datos. `schema.sql` es un bootstrap y **no debe ejecutarse sobre produccion**.

## 1. Condiciones de entrada

Todas deben cumplirse antes de abrir SQL Editor:

- Los escenarios de envio Make/Outlook estan apagados.
- `FUNDAE_2026_EMAIL_V1` esta inactiva (`is_active = false`).
- No hay importaciones ni escrituras de campana en curso.
- Existe un backup logico nuevo fuera de Supabase, con fecha, tamano y SHA-256 registrados.
- Se conoce como restaurarlo en un proyecto nuevo. Una captura o el Excel maestro no son un backup de base de datos.
- Se guardara la salida completa de release gate, preflight y postcheck.

Supabase recomienda exportaciones logicas regulares para proyectos Free. Referencias oficiales: [backups](https://supabase.com/docs/guides/platform/backups), [`supabase db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump) y [backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

### Backup minimo

Con Supabase CLI enlazado y la contrasena de base de datos disponible:

```powershell
supabase link --project-ref vftwranrgvbtqfiwtqjz
supabase db dump --linked --file fundae_pre_release_schema.sql
supabase db dump --linked --data-only --use-copy --file fundae_pre_release_data.sql
supabase db dump --linked --role-only --file fundae_pre_release_roles.sql
Get-FileHash .\fundae_pre_release_*.sql -Algorithm SHA256
```

No guardar contrasenas, connection strings ni service-role keys en el repositorio. Los backups contienen datos personales: almacenarlos cifrados, con acceso restringido y plazo de borrado.

## 2. Orden exacto

Ejecutar cada archivo completo en una pestana nueva de Supabase SQL Editor. No concatenar, no seleccionar fragmentos y no continuar ante una excepcion.

1. `migrations/20260811_release_gate.sql`
2. `migrations/20260811_preflight.sql`
3. `migrations/20260811_production_hardening.sql`
4. `migrations/20260811_tracking_control.sql`
5. `migrations/20260811_unsubscribe_flow.sql`
6. `migrations/20260812_distributed_rate_limit.sql`
7. `migrations/20260811_postcheck.sql`

Los scripts 1, 2 y 7 son de solo lectura y terminan en `rollback`. Cada migracion intermedia usa transaccion propia, `lock_timeout = 10s` y rollback automatico si falla una sentencia.

No usar `supabase migration up` hasta reconciliar el historial remoto: la carpeta contiene una migracion V5 anterior y este procedimiento esta disenado para aplicacion manual controlada. Tampoco conviene crear un megabundle duplicado: aumentaria el riesgo de divergencia y haria menos claro que etapa fallo.

## 3. Criterios de aceptacion

### Release gate

Debe devolver `release_gate_ok`. Falla de forma cerrada si detecta esquema base incompleto, funcion/roles requeridos ausentes, campana activa, locks vigentes o indicios de aplicacion parcial.

### Preflight

Continuar solo si termina sin `ERROR` y confirma:

- seis tablas base presentes;
- ningun paso fuera de `1..5`;
- ningun `submission_id` no vacio duplicado;
- ninguna baja historica con `email_hash` invalido;
- conteos guardados como linea base.

Si falla, detenerse. Corregir en otra ventana y repetir desde release gate; no eliminar filas para forzar el paso.

### Migraciones

Cada archivo debe terminar con `Success. No rows returned`. Si uno falla:

- no ejecutar el siguiente;
- guardar error completo y hora UTC;
- comprobar que la transaccion fallida hizo rollback;
- mantener Make apagado y la campana inactiva;
- auditar el estado parcial antes de reintentar.

No asumir idempotencia total aunque existan `if not exists`: toda repeticion exige una revision especifica del estado parcial.

### Postcheck

Debe devolver `migration_postcheck_ok` y confirmar:

- tablas `campaign_executions`, `campaign_suppressions` y `campaign_unsubscribe_tokens`;
- constraint de pasos validado y backfill de `submission_id` completo;
- bajas historicas registradas y propagadas a identidades hermanas;
- cero ejecuciones planificadas para identidades con baja global;
- RLS activo y sin lectura para `anon`/`authenticated`;
- `service_role` puede ejecutar autorizacion JIT.

Despues, con Make aun apagado:

```powershell
Set-Location .\data-brain
npm.cmd run test
npm.cmd run lint
npm.cmd run build
```

Referencia local del 12/08/2026: 58/58 pruebas correctas. No sustituye el postcheck remoto ni un E2E de piloto.

### Rate limiting distribuido

- En produccion, configurar `RATE_LIMIT_TRUSTED_IP_HEADER` con una cabecera que el proxy perimetral **sobrescriba** (por ejemplo, `x-vercel-forwarded-for` en Vercel). No usar una cabecera que el cliente pueda conservar o inyectar.
- Sin esa configuracion, produccion agrupa solicitudes como `unattributed`: HMAC, HubSpot y captacion fallan cerrados; telemetria y baja fallan abiertas para no perder eventos ni impedir el derecho de baja.
- Ejecutar diariamente hasta devolver `0`: `select public.cleanup_expired_rate_limits(now() - interval '1 day', 5000);`. Automatizarlo solo tras verificar el scheduler disponible.
- El fallback en memoria existe unicamente fuera de `NODE_ENV=production` y no valida despliegues multiinstancia.
## 4. Puerta de activacion

Una base migrada no autoriza enviar correos. Antes del piloto deben existir conjuntamente:

- Data Brain desplegado con los mismos secretos fuertes que Make;
- URL publica HTTPS de baja probada con un contacto sintetico;
- escenario Make real, no solo JSON de especificacion;
- `delivery_scheduled` y autorizacion JIT positiva antes de Outlook;
- `delivery_sent` o `delivery_failed` confirmado despues de Outlook;
- prueba de baja que detiene contactos hermanos y ejecuciones planificadas;
- evidencia juridica por destinatario, excluyendo a quien no la tenga;
- piloto interno controlado aprobado antes de habilitar lotes.

## 5. Contencion y rollback

### Contencion inmediata

Ante cualquier anomalia:

1. Apagar todos los escenarios de envio Make.
2. Desactivar la campana:

```sql
begin;
update public.campaigns
set is_active = false, status = 'paused'
where external_id = 'FUNDAE_2026_EMAIL_V1';
commit;
```

3. Rotar el secreto compartido si se sospecha exposicion.
4. No borrar eventos, bajas, tokens usados ni ejecuciones: son trazabilidad.

### Rollback de base de datos

No existe un `down.sql` seguro y universal. El hardening elimina un trigger/funcion de estimacion previa y cambia permisos; reconstruirlos a mano podria reintroducir calculos enganosos o accesos inseguros.

Si el postcheck falla y no es corregible con una migracion aditiva:

1. mantener la campana detenida;
2. restaurar el backup en un proyecto Supabase nuevo;
3. validar conteos, RLS, funciones, API y Data Brain alli;
4. cambiar variables de entorno solo en ventana controlada;
5. conservar el proyecto afectado no operativo para investigacion.

No restaurar encima de produccion sin ventana de mantenimiento: la restauracion causa indisponibilidad y puede perder escrituras posteriores al punto restaurado.

## 6. Registro obligatorio

Guardar fuera del repositorio:

- operador, aprobador y horas UTC;
- SHA-256 de los siete SQL y tres backups;
- salidas de release gate, preflight y postcheck;
- resultados de tests/lint/build;
- incidencias y decision continuar/abortar;
- IDs sinteticos del piloto, nunca datos personales en logs tecnicos.
