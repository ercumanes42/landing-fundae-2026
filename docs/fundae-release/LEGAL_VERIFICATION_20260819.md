# Verificación pública del Aviso Legal — 2026-08-19

Estado: identidad, Aviso Legal, Privacidad y Cookies cerrados localmente. La redacción adopta decisiones conservadoras basadas en el runtime y en fuentes oficiales; no sustituye una revisión jurídica de la actividad completa de la sociedad ni acredita la vigencia registral actual.

Deploy gate: `BLOCKED`

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

## Decisiones de Privacidad y Cookies

La persona responsable delegó la redacción y adopción de criterios conservadores el 20/08/2026. La política publicada fija:

1. Solicitudes y reuniones: ejecución de la solicitud y medidas precontractuales.
2. Analítica: consentimiento previo, rechazo equivalente y retirada permanente accesible.
3. Marketing: consentimiento cuando proceda; para clientes previos, solo servicios propios similares, datos obtenidos lícitamente y oposición sencilla conforme al artículo 21.2 LSSI.
4. Retención: 12 meses para solicitudes inactivas; 24 meses para evidencia comercial/CRM; 90 días para eventos raw; 12 meses para logs; 3 años para derechos; plazos mercantiles y tributarios cuando exista relación contractual; supresiones durante el tiempo necesario con revisión quinquenal.
5. Encargados/categorías: Vercel, Supabase, Microsoft 365, HubSpot, Calendly, PostHog, OpenAI y Make solo para funcionalidades efectivamente habilitadas y bajo contrato.
6. Transferencias: solo bajo decisión de adecuación o garantías apropiadas, incluidas cláusulas contractuales tipo.
7. DPD: no se designa para estos tratamientos por no encajar, según el alcance actual, en observación habitual a gran escala ni categorías especiales a gran escala. Debe reevaluarse si cambia ese alcance.
8. Derechos: `administracion@gfs.es`, canal ya publicado por GFS; verificación adicional solo ante duda razonable.

La matriz técnica vigente está en `docs/fundae-release/PRIVACY_RETENTION_MATRIX.md`.

Referencias oficiales de alcance:

- AEPD, derecho de información: https://www.aepd.es/derechos-y-deberes/conoce-tus-derechos/derecho-de-informacion
- AEPD, obligación de DPD: https://www.aepd.es/preguntas-frecuentes/4-dpd/1-delegado-de-proteccion-de-datos/FAQ-0402-cuando-se-debe-nombrar-un-dpd
- AEPD, guía de cookies: https://www.aepd.es/documento/guia-cookies.pdf
- LSSI, excepción de relación contractual previa y oposición sencilla, artículo 21.2: https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758#a21

## Inventario estático de almacenamiento

| Clave | Medio | Estado/duración implementada |
| --- | --- | --- |
| `fundae_analytics_consent_v1` | localStorage | Preferencia hasta 24 meses, cambio de política o borrado |
| `fundae_journey_v2` | localStorage | Identificador seudónimo, 30 días renovables |
| `fundae_first_touch_v2`, `fundae_last_touch_v2` | localStorage | Solo tras aceptar; sin TTL técnico, se eliminan al rechazar |
| `fundae_session_v2` | sessionStorage | Sesión seudónima con inactividad de 30 minutos |
| `fundae_campaign_context_v1` | sessionStorage | Contexto consentido de la sesión |

La clave legacy `fundae_pending_leads` solo se elimina; el código actual no la utiliza como cola. El hook que escribiría `fundae_utm` no está importado por ningún consumidor en el árbol revisado.

## Gate

- Aviso Legal: `PASS-LOCAL` limitado a evidencia pública.
- Privacidad: `PASS-LOCAL` como texto definitivo del producto.
- Cookies: `PASS-LOCAL` como texto definitivo alineado con el inventario estático.
- Producción: `BLOCKED` hasta una autorización de despliegue separada y la comprobación runtime del dominio final.
- Campaña y proveedores: conservan sus gates operativos; cerrar el texto legal no habilita envíos ni integraciones.

## Control técnico de despliegue

El gate offline `npm run release:deploy:gate` exige que Aviso Legal, Privacidad y Cookies estén marcados como `verified` y que este documento contenga un único marcador `Deploy gate: VERIFIED`. Las páginas ya cumplen el primer requisito; el marcador permanece `BLOCKED` para impedir que cerrar la redacción se convierta en autorización de producción. Vercel aplica el mismo gate a `VERCEL_ENV=production`; previews y build local siguen disponibles para QA.
