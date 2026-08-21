# Data Brain - Dashboard Master GFS

Estado: especificacion aprobable. El P0 inicial (refresco, cobertura visible, taxonomia A-D y umbrales de scoring) esta integrado localmente. Las agregaciones completas y drill-down requieren la siguiente fase antes de produccion.

## Principios de diseño

- Referencia visual: claridad y navegacion del dashboard claro aportado por Juan; densidad analitica y comparadores del ejemplo oscuro.
- Identidad: fondo navy oscuro, acentos GFS `#302B7B` y `#FF206E`, blanco, estados semanticos accesibles.
- Jerarquia: resumen ejecutivo arriba, navegacion lateral, filtros globales persistentes y detalle progresivo.
- Cada KPI muestra definicion, fuente, periodo, denominador, cobertura y ultima actualizacion.
- Todo grafico permite drill-down hasta evento/contacto cuando el rol lo autoriza.
- Un dato ausente o truncado se muestra como tal; nunca se convierte en cero ni en una conclusion de IA.

## Navegacion

1. Resumen ejecutivo
2. Comparador funnels A-D
3. Secuencia fria Email 1-5
4. Entregas transaccionales
5. Intencion y diagnostico
6. Atribucion y comportamiento
7. Ventas y HubSpot
8. Calidad, integraciones y alertas
9. Explorador de leads y eventos
10. Analista IA gobernado

## Filtros globales

Fecha/cohorte, campaña, funnel A-D, lote, paso 1-5, fuente/medio/UTM, empresa, plantilla, provincia, score, clasificacion, estado cold/transaccional/intencion, entrega, respuesta, reunion, oportunidad y propietario. Los filtros activos aparecen como chips y se reflejan en la URL.

## Diccionario minimo de metricas

### Campaña fria

Asignados, programados, bloqueados por stop, intentados, aceptados por Outlook, error, timeout desconocido, reintento, hard/soft bounce, baja, clic, respuesta por tipo, tiempo a respuesta y avance por paso 1-5.

### Funnels A-D

Asignados, landing visitada, CTA, recurso iniciado, recurso completado, copia solicitada, PDF descargado, respuesta, diagnostico solicitado, reunion reservada/realizada, oportunidad, ganado, pipeline e ingreso. Comparar cohortes equivalentes y mostrar N/denominador.

### Transaccional

Solicitud recibida, cola, primer intento, reintentos, entregado, dead letter, latencia Landing -> Data Brain -> Make -> Outlook y plantilla utilizada.

### Intencion/diagnostico

Elegible, activado, detenido, reunion, no-show, oportunidad y resultado. Nunca se mezcla con el reparto A-D. Permanece apagado hasta aprobacion independiente.

### Calidad y salud

Duplicados, `submission_id` ausente, contacto/evento huerfano, evento fuera de orden, lag, UTM/cid sin cobertura, consentimiento, HubSpot no vinculado, locks vencidos, cola, dead letters y ultimo exito real de Supabase, Make, Outlook, HubSpot y PostHog.

### Scoring e IA

Distribucion por score, version del scoring, precision comercial por cohorte y cambios de clasificacion. La IA debe citar periodo, muestra y eventos; separar dato, inferencia y recomendacion; nunca activar campañas ni inventar causas.

## Reglas de calculo

- Embudo secuencial: cada tasa usa como denominador la etapa anterior de la misma cohorte.
- La conversion visitante -> lead solo se muestra cuando el denominador tiene cobertura suficiente y consentimiento compatible.
- Aperturas de email son orientativas; clic, respuesta, reunion y oportunidad tienen mayor peso.
- Pipeline solo suma oportunidades; ingreso solo negocios ganados y reconciliados con HubSpot.
- Los totales se calculan server-side sobre el universo completo. Las tablas se paginan; no se derivan KPIs de una pagina de datos.

## P0 para ser fuente fiable

- Agregaciones server-side/RPC sin topes silenciosos.
- Taxonomia unica A-D y tres carriles `cold`, `transactional`, `intent`.
- Refresh automatico, manual, indicador de frescura y estados parciales.
- Scoring versionado unico 0-39/40-59/60-79/80+.
- Embudos por cohorte y denominadores visibles.
- Consultas minimizadas: no enviar payload/PII completo al navegador.
- RBAC, auditoria de accesos y exportaciones protegidas.

## P1 premium

- Drill-down KPI -> campaña -> lote -> email -> contacto -> cronologia.
- Comparador A-D con delta frente a media e intervalo de confianza.
- Centro de alertas accionables con responsable, SLA y enlace al error.
- Estados de carga, vacio, error parcial, responsive 390/768/1440 y teclado.
- Exportacion CSV/PDF con filtros, periodo, definiciones y marca GFS.

## Criterios de aceptacion

- Totales reconciliados con Excel, Supabase, Outlook y HubSpot para una cohorte de prueba.
- Cero KPI sin fuente/periodo/denominador; cero truncamiento silencioso.
- Stop rule visible en la cronologia del contacto antes del siguiente envio.
- A-D comparables y diagnostico separado.
- Frescura menor o igual a 60 s o estado degradado visible.
- Ninguna PII o secreto innecesario en bundle, logs o respuestas masivas.
- Accesibilidad Lighthouse igual o superior a 90 y pruebas visuales en tres anchos.