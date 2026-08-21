# Operacion de campaña FUNDAE 2026

Estado: copia controlada local materializada y bloqueada. Los envios frios, la campaña de intencion y las migraciones permanecen desactivados hasta completar la checklist de produccion y recibir autorizacion directa.

## Modelo aprobado

- Cuatro funnels comparables: A Checklist, B Calculadora, C Webinar y D Autoevaluacion.
- Cinco emails frios por contacto. Los pasos 6 y 7 no se usan.
- El diagnostico de 15 minutos no es un quinto funnel. Es la conversion comercial comun y, si se activa mas adelante, una campaña de intencion independiente.
- Remitente previsto: `jgpino@gfs.es`.
- El Excel maestro original no se modifica. La copia controlada es la unica base preparada para importacion.

## Politica de campaña versionada

- Version: `FUNDAE_CUSTOMER_SIMILAR_SERVICES_2026_V1`.
- Alcance aprobado: clientes actuales o anteriores y oferta de servicios propios similares.
- No se exige evidencia juridica individual ni un consentimiento nuevo como gate de esta campaña.
- Esta politica implementa una decision interna aprobada; no constituye asesoramiento juridico.
- Cada contacto conserva campos fail-closed para baja, oposicion, hard bounce, supresion, duplicado y autorizacion directa.
- `PENDING_RECHECK`, `PENDING` o `validacion_pre_envio=PENDIENTE` bloquean cualquier envio.

## Secuencia fria

| Paso | Ventana prevista | Objetivo |
|---|---|---|
| 1 | 1-4 septiembre | Entregar el recurso A-D asignado |
| 2 | 15-18 septiembre | Recordar la oportunidad sin repetir promesas |
| 3 | 1-2 octubre | Caso practico verificable |
| 4 | 15-16 octubre | Recordatorio y resolucion de bloqueo |
| 5 | 3-4 noviembre | Ultimo consejo y cierre del seguimiento |

Las fechas finales deben salir de las columnas operativas del Excel y validarse en zona horaria `Europe/Madrid`. Los cuatro lotes conservan reparto equilibrado. No se envia ningun lote completo antes del piloto.

## Separacion de flujos

1. **Frio:** Outlook envia como maximo cinco impactos con lock e idempotencia.
2. **Transaccional:** al completar un recurso, Landing -> Data Brain -> cola -> Make -> Outlook envia solo la entrega/confirmacion correspondiente.
3. **Intencion:** un interes explicito en diagnostico puede crear elegibilidad, pero la secuencia permanece apagada por defecto.
4. **Ventas:** una reunion confirmada u oportunidad pasa a seguimiento humano/HubSpot y suprime marketing automatizado.

## Stop rules obligatorias

Antes de cada envio, Make debe comprobar de forma atomica que no exista:

- recurso completado o registro confirmado;
- respuesta positiva, negativa, informativa o peticion de baja;
- hard bounce;
- diagnostico solicitado;
- reunion reservada o realizada;
- oportunidad creada;
- supresion de marketing o global;
- lock activo, entrega previa del mismo paso o estado desconocido de Outlook.

Cualquier interaccion completada detiene la secuencia fria antes de entregar el siguiente mensaje. Una baja detiene todos los envios no indispensables. Un hard bounce bloquea marketing. Nunca se marca `delivered` si falta el webhook de Make o Outlook no confirma identificador.

## Contratos de datos

- `submission_id`: idempotencia de formulario y entrega transaccional.
- `campaign_id + contact_id + step`: idempotencia de email frio.
- `source_event_id`: idempotencia de eventos Make/Outlook/HubSpot.
- `cold_sequence_status`, `transactional_status`, `intent_sequence_status`: estados separados.
- `marketing_lane`: solo `cold`, `intent` o `none`.
- `suppression_scope`: `none`, `marketing` o `all`.

No se incluyen emails, nombres ni `cid` en URLs de telemetria. La atribucion A-D y el diagnostico se miden por separado.

## Criterios de piloto

- 4 contactos internos, uno por funnel, completan los cinco caminos de prueba.
- Cero duplicados al reenviar el mismo `submission_id` o el mismo paso.
- Cada interaccion detiene el siguiente email frio.
- Los cuatro transaccionales llegan desde el remitente correcto y con enlaces validos.
- Emails 6/7 e intencion permanecen desactivados.
- Dashboard muestra A-D, transaccional, diagnostico e incidencias sin mezclar denominadores.
- Rebote, baja, timeout desconocido y webhook ausente producen estado bloqueado/revision, nunca exito.

## Activacion manual

1. Revalidar bajas, oposiciones, hard bounces, supresiones y duplicados contra las fuentes operativas vigentes.
2. Revisar los cinco copys definitivos, identidad y baja simple.
3. Aplicar y verificar la migracion SQL aditiva en staging.
4. Importar una copia del Excel controlado en staging.
5. Configurar secretos, dominios permitidos, Make, Outlook y HubSpot.
6. Ejecutar el piloto interno y revisar trazas end-to-end.
7. Obtener autorizacion directa para el tramo, enviar un microlote real aprobado y observar 48 horas.
8. Solo despues habilitar lotes graduales; la campaña de intencion requiere una aprobacion independiente.
