# Matriz aprobada de privacidad, cookies y retención — 2026-08-20

Estado: `PASS-LOCAL`. Decisiones aplicables a esta landing y Data Brain. No habilita producción, campaña ni proveedores que continúan `OFF`.

## Responsable

- Responsable: Gestión de Formación y Selección, S.L. — NIF B13306428.
- Canal de privacidad y derechos: `administracion@gfs.es`.
- DPD: no designado para estos tratamientos. Reevaluar si la actividad pasa a observación habitual a gran escala, categorías especiales a gran escala o un supuesto obligatorio.

## Finalidad, base y retención

| Tratamiento | Base adoptada | Retención máxima ordinaria |
| --- | --- | --- |
| Entrega de calculadora, checklist, webinar o diagnóstico solicitado | Solicitud del interesado y medidas precontractuales | 12 meses desde la última interacción si no hay contratación |
| Consultas y reuniones | Solicitud y medidas precontractuales | 12 meses; si nace relación contractual, plazos contractuales y legales |
| Analítica y journey web | Consentimiento previo | Eventos raw: 90 días; identificador de navegador: 30 días renovables |
| Scoring y resumen IA minimizado | Interés legítimo en priorización y atención, con revisión humana | Con el lead, máximo 24 meses desde la última interacción |
| Email transaccional | Ejecución de la solicitud | Evidencia y metadatos: 24 meses |
| Seguimiento comercial | Consentimiento cuando sea exigible; clientes previos y servicios propios similares: interés legítimo + art. 21.2 LSSI | Hasta oposición; registros inactivos, 24 meses desde la última interacción |
| Seguridad, rate limit y observabilidad | Interés legítimo en seguridad y continuidad | 12 meses |
| Solicitudes de derechos y reclamaciones | Obligación legal y defensa de reclamaciones | 3 años desde el cierre, salvo litigio |
| Contratos y facturación | Ejecución contractual y obligación legal | Relación vigente; 6 años mercantil y 4 años tributario, sin perjuicio de otros plazos aplicables |
| Baja, oposición y hard bounce | Obligación de respetar la oposición e interés legítimo en evitar recontacto | Hash mínimo mientras sea necesario; revisión cada 5 años |

Los datos se bloquearán cuando proceda y se eliminarán o anonimizarán al finalizar el plazo. Las copias de seguridad se sobrescribirán conforme a su ciclo ordinario y no se reutilizarán para finalidades activas.

## Almacenamiento del navegador

| Clave | Medio | Categoría | Duración |
| --- | --- | --- | --- |
| `fundae_analytics_consent_v1` | `localStorage` | Preferencia necesaria | 24 meses o cambio de versión |
| `fundae_journey_v2` | `localStorage` | Analítica opcional | 30 días deslizantes |
| `fundae_session_v2` | `sessionStorage` | Analítica opcional | Sesión; rota tras 30 minutos de inactividad |
| `fundae_first_touch_v2`, `fundae_last_touch_v2` | `localStorage` | Analítica opcional | Hasta retirada o cambio de política |
| `fundae_campaign_context_v1` | `sessionStorage` | Analítica opcional | Sesión |

Las claves legacy `fundae_identity_v1`, `fundae_session_v1`, `fundae_first_touch_v1` y `fundae_last_touch_v1` solo figuran para su limpieza. La fuente no escribe `document.cookie`. Aceptar o rechazar se ofrece al mismo nivel; al retirar se purgan los identificadores analíticos.

## Proveedores y transferencias

| Proveedor/categoría | Uso aprobado | Condición |
| --- | --- | --- |
| Vercel | Hosting, edge y logs | Contrato de encargo y configuración de región/logs |
| Supabase | Base de datos y funciones | Región UE, RLS/grants y contrato de encargo |
| Microsoft 365 / Graph | Drafts, envíos, replies y NDR | Buzón único, App RBAC y permisos mínimos |
| HubSpot | CRM, empresas, estados y tareas | Solo tras sandbox, propiedades/scopes y contrato |
| Calendly | Reserva de reuniones | Enlace/webhook firmado; política propia en su dominio |
| PostHog | Analítica consentida | Host UE y solo eventos minimizados |
| OpenAI | Resumen minimizado de leads | Sin nombre, email ni teléfono en la proyección; revisión humana |
| Make | Orquestación técnica | Scheduler-only, sin autoridad de envío y actualmente `OFF` |
| Webhook de notificación | Alertas operativas redacted | Receptor identificado, HTTPS y autenticado antes de habilitar |

Google Analytics, LinkedIn Insight y Airtable no forman parte de la versión aprobada mientras no exista carga o integración productiva verificable. Si se incorporan, requieren actualizar inventario, contratos y consentimiento.

Cuando exista tratamiento fuera del EEE se exigirá una decisión de adecuación o garantías del artículo 46 RGPD, normalmente cláusulas contractuales tipo y medidas complementarias. No se venderán datos ni se comunicarán para finalidades propias de terceros.

## Derechos y transparencia

La primera capa identifica responsable, finalidad y enlace a la política. La casilla de formulario confirma lectura y solicitud; no fuerza un consentimiento genérico. La analítica tiene consentimiento separado. Se permiten acceso, rectificación, supresión, oposición, limitación, portabilidad y retirada; solo se solicitará identificación adicional ante duda razonable. La persona puede reclamar ante la AEPD.

No se adoptan decisiones exclusivamente automatizadas con efectos jurídicos o similares. El scoring y la IA son apoyo sujeto a revisión humana.

## Controles técnicos

- Consentimiento desconocido o rechazado: cero eventos analíticos.
- Cambio de versión o retirada: limpieza del almacenamiento analítico.
- Eventos raw: política de 90 días; el job de purga permanece `OFF` hasta autorización de producción.
- Los únicos borrados físicos de mantenimiento existentes son `public.events` y `public.rate_limit_buckets`; el resto requiere el procedimiento de supresión/anonimización previo a producción.
- Outbound, Graph, HubSpot, Make, alertas y campaña: switches `OFF` por defecto.
- Supresiones y bajas prevalecen sobre workbook, CRM y scheduler.
- Producción exige contratos/configuración reales de los proveedores habilitados y comprobación runtime del dominio.

## Fuentes oficiales

- RGPD, artículos 6, 13, 21, 22 y 46: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- AEPD, deber de información: https://www.aepd.es/preguntas-frecuentes/2-tus-obligaciones-como-responsable-del-tratamiento/6-el-deber-de-informacion/FAQ-0217-que-informacion-debe-facilitarse-cuando-los-datos-se-obtengan-directamente-del-afectado
- AEPD, Guía de cookies: https://www.aepd.es/guias/guia-cookies.pdf
- AEPD, DPD: https://www.aepd.es/preguntas-frecuentes/4-dpd/1-delegado-de-proteccion-de-datos/FAQ-0402-cuando-se-debe-nombrar-un-dpd
- AEPD, transferencias: https://www.aepd.es/derechos-y-deberes/cumple-tus-deberes/medidas-de-cumplimiento/garantias-transferencias-datos-personales
- LSSI, artículos 21 y 22: https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758
- Código de Comercio, artículo 30: https://www.boe.es/buscar/act.php?id=BOE-A-1885-6627#a30
- Ley General Tributaria, artículo 66: https://www.boe.es/buscar/act.php?id=BOE-A-2003-23186#a66

## Gates

- `PRIVACY-POLICY`: `PASS-LOCAL`.
- `COOKIE-POLICY`: `PASS-LOCAL`; exige comprobación runtime antes de producción.
- `JOURNEY-RETENTION`: política aprobada; ejecución del purge continúa `OFF` hasta cambio productivo autorizado.
- `CAMPAIGN-ACTIVATION`: `BLOCKED`; requiere datos privados frescos y autorización operativa, no una nueva redacción legal.
- `PRODUCTION-DEPLOY`: `BLOCKED` hasta autorización separada y marcador documental.
