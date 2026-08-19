# Verificación pública del Aviso Legal — 2026-08-19

Estado: cierre limitado al Aviso Legal. No es asesoramiento legal ni acredita la vigencia registral actual de la sociedad. Privacidad y Cookies permanecen `NO-GO`.

## Alcance verificado

| Dato publicado | Evidencia pública | Resultado |
| --- | --- | --- |
| Razón social | BORME de 17/05/2019 y 04/09/2019 | `GESTION DE FORMACION Y SELECCION, SOCIEDAD LIMITADA` y hoja M-551314 |
| Domicilio y datos registrales | BORME de 19/02/2013 | Paseo de la Castellana 141; tomo 30635, folio 159, sección 8, hoja M-551314 |
| NIF, domicilio y canales | Aviso legal y contacto corporativos de `gfs.es` | B13306428; Paseo de la Castellana 141, 28046 Madrid; +34 902 120 567; administracion@gfs.es |
| Nombre comercial público | Sitio corporativo `gfs.es` | GFS Consulting Group; no se afirma aquí la titularidad registral de una marca |

Fuentes primarias consultadas el 19/08/2026:

- BOE/BORME, 19/02/2013: https://www.boe.es/borme/dias/2013/02/19/pdfs/BORME-A-2013-34-28.pdf
- BOE/BORME, 17/05/2019: https://www.boe.es/borme/dias/2019/05/17/pdfs/BORME-A-2019-92-28.pdf
- BOE/BORME, 04/09/2019: https://www.boe.es/borme/dias/2019/09/04/pdfs/BORME-A-2019-169-28.pdf
- Sitio corporativo, aviso legal: https://gfs.es/aviso-legal
- Sitio corporativo, contacto: https://gfs.es/contacto
- LSSI, texto consolidado, artículo 10: https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758#a10

El BORME acredita los actos publicados en sus fechas. No se obtuvo una nota informativa ni certificación registral actual. El directorio abierto enlazado por el Registro Mercantil Central rechazó el acceso durante esta revisión; esa ausencia de consulta no demuestra que no existan actos posteriores.

## Cambios autorizados

- El Aviso Legal muestra la razón social normalizada, NIF, domicilio, teléfono y correo contrastados.
- Incorpora los datos registrales publicados por el BORME.
- Elimina el checklist interno y la etiqueta de versión no definitiva solo del Aviso Legal.
- Advierte que la comprobación pública no equivale a una certificación registral vigente.
- El pie de página usa la misma razón social para evitar una identidad pública inconsistente.

## Privacidad y Cookies: gaps bloqueantes

La matriz técnica completa, con finalidades, datasets, almacenamiento, proveedores, retención actual y decisiones pendientes, está en `docs/fundae-release/PRIVACY_RETENTION_MATRIX.md`. Sus estados `PENDIENTE` no constituyen decisiones jurídicas.

No deben presentarse como definitivas hasta que la persona responsable confirme documentalmente:

1. Base jurídica por finalidad: entrega de recursos, consultas/reuniones, webinar, scoring y enriquecimiento IA, seguimiento comercial, clientes actuales/anteriores, seguridad, auditoría y supresiones.
2. Plazo o criterio de conservación para leads, CRM, correos/outbox, replies, NDR, reuniones, campaña, auditoría, logs y listas de supresión. Solo existe un contrato local propuesto para eventos raw de journey a 90 días; su purga sigue `OFF`.
3. Encargados efectivos, finalidad, región de tratamiento, transferencias y garantías. El código admite Vercel, Supabase, Microsoft 365/Graph, HubSpot, Calendly, PostHog y OpenAI; Make queda diseñado como scheduler y permanece `OFF`. La presencia en código o variables de ejemplo no prueba activación en producción.
4. Si existe Delegado de Protección de Datos y, si existe, su canal. No se infiere su designación.
5. Confirmación documental de `administracion@gfs.es` como canal de derechos y procedimiento de identificación proporcionado.
6. Procedencia y categorías de los datos de clientes actuales/anteriores, junto con la información facilitada en la primera comunicación cuando proceda.
7. Inventario runtime de cookies y almacenamiento del dominio publicado. La fuente local no carga scripts GA/LinkedIn ni escribe `document.cookie`; sí implementa almacenamiento de consentimiento, journey y atribución, que debe revisarse en el entorno desplegado.

Referencias oficiales de alcance:

- AEPD, derecho de información: https://www.aepd.es/derechos-y-deberes/conoce-tus-derechos/derecho-de-informacion
- AEPD, obligación de DPD: https://www.aepd.es/preguntas-frecuentes/4-dpd/1-delegado-de-proteccion-de-datos/FAQ-0402-cuando-se-debe-nombrar-un-dpd
- AEPD, guía de cookies: https://www.aepd.es/documento/guia-cookies.pdf
- LSSI, excepción de relación contractual previa y oposición sencilla, artículo 21.2: https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758#a21

## Inventario estático de almacenamiento

| Clave | Medio | Estado/duración implementada |
| --- | --- | --- |
| `fundae_analytics_consent_v1` | localStorage | Preferencia hasta cambio o borrado; no tiene caducidad técnica |
| `fundae_journey_v2` | localStorage | Identificador seudónimo, 30 días renovables |
| `fundae_first_touch_v2`, `fundae_last_touch_v2` | localStorage | Solo tras aceptar; sin TTL técnico, se eliminan al rechazar |
| `fundae_session_v2` | sessionStorage | Sesión seudónima con inactividad de 30 minutos |
| `fundae_campaign_context_v1` | sessionStorage | Contexto consentido de la sesión |

La clave legacy `fundae_pending_leads` solo se elimina; el código actual no la utiliza como cola. El hook que escribiría `fundae_utm` no está importado por ningún consumidor en el árbol revisado.

## Gate

- Aviso Legal: `PASS-LOCAL` limitado a evidencia pública.
- Privacidad: `NO-GO`.
- Cookies: `NO-GO` hasta inventario del despliegue.
- Publicación global: `NO-GO` mientras los dos gates anteriores permanezcan abiertos.
- Matriz técnica: `PASS-LOCAL` como inventario estático; no cambia ningún gate jurídico ni acredita runtime.
