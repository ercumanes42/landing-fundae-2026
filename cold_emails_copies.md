# Guía de copy para la secuencia fría FUNDAE 2026

> [!IMPORTANT]
> Este Markdown es una guía de redacción y cumplimiento. La copia controlada del Excel maestro GFS es la fuente operativa autoritativa para asunto, cuerpo, funnel, fechas y enlaces personalizados. No pegues aquí nombres, correos ni las 939 filas del fichero de campaña.

## Modelo aprobado

- Cuatro funnels comparables: **A Checklist**, **B Calculadora**, **C Webinar** y **D Autoevaluación**.
- Cinco emails fríos por contacto. No existen pasos 6 o 7 activos.
- El diagnóstico de 15 minutos es la conversión comercial común del email 5, no un quinto funnel.
- La secuencia fría se detiene en cuanto el contacto completa un recurso o genera otra señal de parada.
- Las fechas definitivas, el recurso asignado y las URL con UTM proceden de la copia controlada del Excel.

## Límites de los claims

- La calculadora ofrece una **estimación del crédito anual**, no el saldo exacto disponible. El dato oficial depende de la plantilla media, la cuota de Formación Profesional validada por TGSS y circunstancias como crédito utilizado o reservado.
- No se promete ausencia de sanciones, riesgo cero, cumplimiento garantizado ni una auditoría completa en una llamada breve.
- No se afirma que todo crédito no usado desaparece el 31 de diciembre. Las empresas de menos de 50 personas pueden reservar crédito no dispuesto para los dos ejercicios siguientes si comunican su voluntad mediante el procedimiento aplicable.
- Un caso práctico solo puede enviarse si sus cifras, permiso de uso y contexto están documentados. Sin esa evidencia se usa la variante sin cifras de esta guía.
- Las fuentes de contraste son [Cómo bonificarte](https://www.fundae.es/empresas/home/como-bonificarte/bonificaci%C3%B3n-acciones-programadas), las [FAQ de FUNDAE](https://www.fundae.es/atencionusuario/faq) y el [simulador oficial](https://simuladorcredito.fundae.es/).

## Variables autorizadas

- `{{nombre}}`: nombre del contacto desde el Excel controlado.
- `{{organizacion}}`: organización desde el Excel controlado.
- `{{recurso_nombre}}`: nombre del recurso A-D asignado.
- `{{recurso_descripcion}}`: descripción correspondiente al funnel.
- `{{recurso_cta}}`: CTA correspondiente al funnel.
- `{{enlace_recurso_utm}}`: URL validada del recurso asignado.
- `{{enlace_calendly_utm}}`: URL validada del diagnóstico común.
- `{{enlace_baja}}`: baja simple y operativa.

No se incluyen nombres, correos ni identificadores de contacto en las URL de telemetría.

## Variaciones por funnel

### A — Checklist

- `{{recurso_nombre}}`: Checklist de controles FUNDAE.
- `{{recurso_descripcion}}`: "Una guía breve para revisar documentación, plazos y controles antes de aplicar una bonificación."
- `{{recurso_cta}}`: "Descargar el checklist".

### B — Calculadora

- `{{recurso_nombre}}`: Calculadora orientativa FUNDAE.
- `{{recurso_descripcion}}`: "Una herramienta para estimar el crédito anual con la plantilla y, cuando se dispone de ella, la cuota de Formación Profesional del ejercicio anterior. No consulta el saldo oficial."
- `{{recurso_cta}}`: "Obtener una estimación orientativa".

### C — Webinar

- `{{recurso_nombre}}`: Webinar práctico FUNDAE.
- `{{recurso_descripcion}}`: "Una sesión para entender cómo se calcula el crédito, qué requisitos conviene revisar y qué datos deben validarse en la aplicación oficial."
- `{{recurso_cta}}`: "Reservar plaza".

### D — Autoevaluación

- `{{recurso_nombre}}`: Autoevaluación FUNDAE.
- `{{recurso_descripcion}}`: "Nueve preguntas para detectar qué puntos conviene revisar antes de bonificar una acción formativa. El resultado es orientativo y no constituye una auditoría."
- `{{recurso_cta}}`: "Empezar la autoevaluación".

## Secuencia de cinco emails

### Email 1 — Entrega del recurso

**Ventana prevista:** 1-4 de septiembre
**Asunto:** `{{recurso_nombre}} para {{organizacion}}`

Hola, {{nombre}}:

Te comparto un recurso práctico para que {{organizacion}} pueda revisar sus opciones de formación bonificada con criterios claros:

{{recurso_descripcion}}

[{{recurso_cta}}]({{enlace_recurso_utm}})

Es una primera orientación. El crédito y el saldo disponibles deben contrastarse con los datos oficiales de la empresa.

Un saludo,
[Firma]

Si no quieres recibir más mensajes sobre este tema, puedes darte de baja aquí: {{enlace_baja}}

---

### Email 2 — Recordatorio de oportunidad

**Ventana prevista:** 15-18 de septiembre
**Asunto:** `¿Pudiste revisar {{recurso_nombre}}?`

Hola, {{nombre}}:

Te escribo por si todavía no has podido revisar el recurso que te envié.

Puede ayudarte a identificar qué datos y requisitos debería comprobar {{organizacion}} antes de planificar formación bonificable:

[{{recurso_cta}}]({{enlace_recurso_utm}})

La estimación o el resultado del recurso no sustituye la información validada en la aplicación oficial de FUNDAE.

Un saludo,
[Firma]

Si no quieres recibir más mensajes sobre este tema, puedes darte de baja aquí: {{enlace_baja}}

---

### Email 3 — Caso práctico sin cifras no verificadas

**Ventana prevista:** 1-2 de octubre
**Asunto:** `Una forma práctica de ordenar la gestión FUNDAE`

Hola, {{nombre}}:

En muchas revisiones, el primer avance no consiste en calcular una cifra aislada, sino en ordenar tres datos: plantilla media, cuota de Formación Profesional del ejercicio anterior y crédito ya utilizado o reservado.

Con esa información se puede contrastar mejor el crédito anual y el saldo disponible, además de planificar la formación y sus evidencias.

Este recurso resume ese primer paso:

[{{recurso_cta}}]({{enlace_recurso_utm}})

Si se sustituye este texto por un caso real, sus cifras y permiso de uso deben estar documentados en el Excel controlado.

Un saludo,
[Firma]

Si no quieres recibir más mensajes sobre este tema, puedes darte de baja aquí: {{enlace_baja}}

---

### Email 4 — Resolución de bloqueo

**Ventana prevista:** 15-16 de octubre
**Asunto:** `Qué conviene validar antes de bonificar formación`

Hola, {{nombre}}:

Si la duda es por dónde empezar, revisaría primero:

1. El crédito y el saldo que figuran en la aplicación oficial.
2. Los costes y límites aplicables a la acción formativa.
3. La documentación, comunicaciones y plazos del expediente.

{{recurso_nombre}} puede servirte como guía inicial:

[{{recurso_cta}}]({{enlace_recurso_utm}})

Un saludo,
[Firma]

Si no quieres recibir más mensajes sobre este tema, puedes darte de baja aquí: {{enlace_baja}}

---

### Email 5 — Último consejo y diagnóstico común

**Ventana prevista:** 3-4 de noviembre
**Asunto:** `Cierro el seguimiento sobre FUNDAE`

Hola, {{nombre}}:

Cierro aquí el seguimiento para no insistir.

Como último consejo: antes de contratar o comunicar una formación, contrasta el crédito y el saldo disponibles, los costes admitidos y los requisitos aplicables al caso de {{organizacion}}.

El recurso seguirá disponible aquí:

[{{recurso_cta}}]({{enlace_recurso_utm}})

Si prefieres revisar qué datos tienes y qué puntos quedan por validar, puedes solicitar un diagnóstico inicial de 15 minutos. Es una revisión orientativa, no una auditoría completa ni una garantía del resultado:

[Reservar diagnóstico de 15 minutos]({{enlace_calendly_utm}})

Un saludo,
[Firma]

Si no quieres recibir más mensajes sobre este tema, puedes darte de baja aquí: {{enlace_baja}}

## Stop rules obligatorias

Antes de cada envío debe comprobarse de forma atómica que no exista:

- recurso completado o registro confirmado;
- respuesta positiva, negativa, informativa o petición de baja;
- hard bounce;
- diagnóstico solicitado;
- reunión reservada o realizada;
- oportunidad creada;
- supresión de marketing o global;
- lock activo, entrega previa del mismo paso o estado desconocido de Outlook.

Cualquier recurso completado o interacción detiene el siguiente email frío. Una baja detiene todos los envíos no indispensables. Un hard bounce bloquea marketing. Los pasos 6 y 7 y la campaña de intención permanecen desactivados.
