# Secuencia de Emails Fríos - Optimización de Crédito FUNDAE 2026

Este archivo contiene los textos completos para la secuencia de 7 correos estructurados para los 5 recursos diferentes (A: Checklist, B: Calculadora, C: Webinar, D: Revisión, E: Diagnóstico).

El enfoque de copywriting sigue el estilo directo, persuasivo y sin rodeos de Alex Hormozi (alto valor, fricción cero, y centrado en la pérdida económica de no actuar: perder el dinero que ya se cotiza cada mes).

---

## Variables Dinámicas Disponibles en el Excel Enriquecido
- `{{nombre}}` -> Nombre del contacto (`nombre`)
- `{{organizacion}}` -> Nombre de la empresa (`organización`)
- `{{enlace_recurso_utm}}` -> Enlace al recurso específico con UTMs (`enlace_recurso_utm`)
- `{{enlace_calendly_utm}}` -> Enlace de agendado directo en Calendly con UTMs (`enlace_calendly_utm`)

---

## EMAIL 1: Apertura con Recurso (Entrega y primera toma de contacto)

**Asunto:** Crédito FUNDAE en {{organizacion}}: dinero que ya habéis pagado (y vais a perder)

Hola, {{nombre}}:

Cada mes, {{organizacion}} paga una parte de las cotizaciones de sus empleados destinada a formación. 

La mayoría de las empresas no lo saben, o no lo usan por miedo a la burocracia. Resultado: acaban regalando miles de euros al Estado que ya habían pagado de su propio bolsillo.

Para que no os pase esto en {{organizacion}}, hemos preparado un recurso gratuito:

{{recurso_descripcion}}

Puedes acceder directamente a través de este enlace:
{{recurso_cta}}

Si prefieres ahorrarte la lectura y ver en 10 minutos exactos cuánto crédito tenéis acumulado y cómo aplicarlo sin riesgo de sanción, agenda una sesión directa aquí:
{{enlace_calendly_utm}}

Un saludo,
[Tu Nombre / Firma]

### Variaciones de Recurso (Email 1)
*   **Recurso A (Checklist PDF):**
    *   `{{recurso_descripcion}}`: "Un checklist práctico en PDF con los 10 errores críticos de FUNDAE que causan el 90% de las inspecciones y devoluciones de dinero."
    *   `{{recurso_cta}}`: "[Descargar Checklist de 10 Errores FUNDAE]({{enlace_recurso_utm}})"
*   **Recurso B (Calculadora):**
    *   `{{recurso_descripcion}}`: "Una calculadora online interactiva que estima el crédito FUNDAE disponible de tu empresa en menos de 2 minutos."
    *   `{{recurso_cta}}`: "[Calcular crédito de {{organizacion}} en 2 min]({{enlace_recurso_utm}})"
*   **Recurso C (Webinar):**
    *   `{{recurso_descripcion}}`: "Un webinar de 15 minutos con los casos prácticos de optimización de crédito FUNDAE que usan las empresas líderes para no perder fondos."
    *   `{{recurso_cta}}`: "[Ver Webinar de Optimización]({{enlace_recurso_utm}})"
*   **Recurso D (Revisión):**
    *   `{{recurso_descripcion}}`: "Una revisión rápida de 5 minutos donde analizamos el estado de tu cuenta de FUNDAE y comprobamos si tienes saldo bloqueado."
    *   `{{recurso_cta}}`: "[Solicitar revisión exprés de 5 minutos]({{enlace_recurso_utm}})"
*   **Recurso E (Diagnóstico):**
    *   `{{recurso_descripcion}}`: "Un diagnóstico completo de 15 minutos en el que auditamos tu histórico de bonificaciones y trazamos un plan de uso sin riesgos."
    *   `{{recurso_cta}}`: "[Reservar Diagnóstico de 15 minutos]({{enlace_recurso_utm}})"

---

## EMAIL 2: Dolor / Oportunidad (El impacto financiero de no actuar)

**Asunto:** El impuesto invisible de {{organizacion}} en formación

Hola, {{nombre}}:

Hay una diferencia enorme entre pagar impuestos y tirar el dinero.

Cada mes se descuenta un porcentaje de los seguros sociales de {{organizacion}} para financiar formación. Ya lo estás pagando. Es un hecho.

Si no gastas ese crédito antes del 31 de diciembre, desaparece. No se acumula para el año que viene. Simplemente, lo pierdes y se lo queda el Estado.

Para ayudarte a evitar este desperdicio de forma rápida y sencilla, te comparto este recurso:

{{recurso_descripcion}}

Haz clic aquí para usarlo:
{{recurso_cta}}

Si prefieres delegar esto y que nosotros calculemos y gestionemos todo tu crédito sin coste administrativo para ti, agenda una reunión de 10 minutos:
{{enlace_calendly_utm}}

Un saludo,
[Tu Nombre / Firma]

### Variaciones de Recurso (Email 2)
*   **Recurso A (Checklist PDF):**
    *   `{{recurso_descripcion}}`: "El checklist en PDF de los 10 errores de FUNDAE que debes evitar para que la Administración no te reclame el dinero de vuelta."
    *   `{{recurso_cta}}`: "[Descargar Checklist PDF: Evitar Errores]({{enlace_recurso_utm}})"
*   **Recurso B (Calculadora):**
    *   `{{recurso_descripcion}}`: "La calculadora rápida que te dice exactamente cuánto dinero de tu cuota mensual está volviendo o perdiéndose."
    *   `{{recurso_cta}}`: "[Calcular dinero perdido / recuperado]({{enlace_recurso_utm}})"
*   **Recurso C (Webinar):**
    *   `{{recurso_descripcion}}`: "Un webinar corto que te enseña a usar el crédito acumulado para formar a tu equipo en las áreas que realmente impulsan tu negocio."
    *   `{{recurso_cta}}`: "[Acceder al Webinar Gratuito]({{enlace_recurso_utm}})"
*   **Recurso D (Revisión):**
    *   `{{recurso_descripcion}}`: "Nuestra revisión rápida de 5 minutos para saber si estás dejando dinero sobre la mesa este año."
    *   `{{recurso_cta}}`: "[Pedir revisión rápida de 5 min]({{enlace_recurso_utm}})"
*   **Recurso E (Diagnóstico):**
    *   `{{recurso_descripcion}}`: "Un diagnóstico integral de 15 minutos para planificar la recuperación de tu crédito de este año."
    *   `{{recurso_cta}}`: "[Reservar Diagnóstico de 15 min]({{enlace_recurso_utm}})"

---

## EMAIL 3: Caso Práctico (Prueba social con números reales)

**Asunto:** Caso real: Cómo recuperamos 12.400€ en crédito de formación

Hola, {{nombre}}:

Déjame contarte la historia rápida de una empresa muy similar a {{organizacion}}.

Cada año perdían su crédito de FUNDAE porque pensaban que la gestión era demasiado compleja y arriesgada. Pensaban: "Por 10.000€, no nos compensa el riesgo de una inspección".

Hicimos una cosa muy sencilla: analizamos su situación, corregimos sus errores de cotización y automatizamos la gestión de sus cursos.

El resultado: 12.400€ recuperados y aplicados directamente a la formación de su equipo comercial y técnico. Coste real para la empresa: 0 euros extra.

El método que empleamos para lograrlo es el mismo que explicamos aquí:

{{recurso_descripcion}}

Accede de forma gratuita desde aquí:
{{recurso_cta}}

Si quieres que estudiemos si podemos replicar estos mismos números en {{organizacion}}, agenda una llamada corta de 10 minutos:
{{enlace_calendly_utm}}

Un saludo,
[Tu Nombre / Firma]

### Variaciones de Recurso (Email 3)
*   **Recurso A (Checklist PDF):**
    *   `{{recurso_descripcion}}`: "El checklist en PDF que utilizamos con ellos para auditar sus procesos y asegurarnos de que no cometen fallos burocráticos."
    *   `{{recurso_cta}}`: "[Descargar el Checklist de Auditoría]({{enlace_recurso_utm}})"
*   **Recurso B (Calculadora):**
    *   `{{recurso_descripcion}}`: "Nuestra calculadora de crédito, la misma herramienta con la que descubrieron que tenían más de 12.000€ listos para usar."
    *   `{{recurso_cta}}`: "[Calcular crédito disponible]({{enlace_recurso_utm}})"
*   **Recurso C (Webinar):**
    *   `{{recurso_descripcion}}`: "El webinar de 15 minutos donde desglosamos paso a paso la estrategia de optimización que implementamos en su negocio."
    *   `{{recurso_cta}}`: "[Ver Webinar de Caso Práctico]({{enlace_recurso_utm}})"
*   **Recurso D (Revisión):**
    *   `{{recurso_descripcion}}`: "La misma revisión rápida de 5 minutos que sirvió para identificar que su crédito estaba siendo desaprovechado."
    *   `{{recurso_cta}}`: "[Reservar Revisión Exprés]({{enlace_recurso_utm}})"
*   **Recurso E (Diagnóstico):**
    *   `{{recurso_descripcion}}`: "El diagnóstico estratégico de 15 minutos que nos permitió trazar la ruta de bonificación libre de riesgos."
    *   `{{recurso_cta}}`: "[Reservar Diagnóstico de 15 min]({{enlace_recurso_utm}})"

---

## EMAIL 4: Recordatorio (Seguimiento sutil de valor)

**Asunto:** Rápido recordatorio sobre tu saldo en FUNDAE

Hola, {{nombre}}:

Imagino que estás con mil prioridades, así que te lo resumo en 30 segundos.

El crédito FUNDAE de {{organizacion}} caduca al finalizar el año. Si no se inicia la formación antes, ese saldo vuelve de forma definitiva al Estado.

Para ayudarte a tomar una decisión informada sin perder tiempo, te comparto de nuevo el recurso:

{{recurso_descripcion}}

Puedes revisarlo aquí:
{{recurso_cta}}

Si prefieres ir directo al grano y saber con exactitud cuánto crédito tenéis y cómo aplicarlo este trimestre, reserva una llamada de 10 minutos conmigo aquí:
{{enlace_calendly_utm}}

Un saludo,
[Tu Nombre / Firma]

### Variaciones de Recurso (Email 4)
*   **Recurso A (Checklist PDF):**
    *   `{{recurso_descripcion}}`: "El PDF con los 10 errores que debes evitar para gestionar tu crédito de formación con total tranquilidad."
    *   `{{recurso_cta}}`: "[Descargar Checklist PDF]({{enlace_recurso_utm}})"
*   **Recurso B (Calculadora):**
    *   `{{recurso_descripcion}}`: "La calculadora ágil para obtener la estimación de tus fondos de formación en solo dos minutos."
    *   `{{recurso_cta}}`: "[Calcular crédito de {{organizacion}}]({{enlace_recurso_utm}})"
*   **Recurso C (Webinar):**
    *   `{{recurso_descripcion}}`: "El webinar de 15 minutos con las estrategias clave de optimización que puedes implementar de inmediato."
    *   `{{recurso_cta}}`: "[Ver Webinar de 15 Minutos]({{enlace_recurso_utm}})"
*   **Recurso D (Revisión):**
    *   `{{recurso_descripcion}}`: "Nuestra sesión de revisión de 5 minutos para auditar tu saldo disponible de este año."
    *   `{{recurso_cta}}`: "[Solicitar revisión de 5 minutos]({{enlace_recurso_utm}})"
*   **Recurso E (Diagnóstico):**
    *   `{{recurso_descripcion}}`: "El diagnóstico guiado de 15 minutos para estructurar tu plan de formación bonificada sin fallos burocráticos."
    *   `{{recurso_cta}}`: "[Agendar Diagnóstico de 15 minutos]({{enlace_recurso_utm}})"

---

## EMAIL 5: Nuevo Consejo (Aporte de valor específico)

**Asunto:** El truco de la cofinanciación en FUNDAE (ahorra costes en {{organizacion}})

Hola, {{nombre}}:

Hoy quiero darte un consejo práctico que te ahorrará dinero real.

Muchas empresas creen que para cumplir con la "cofinanciación privada" obligatoria de FUNDAE tienen que pagar facturas adicionales de su bolsillo.

Pero no es así.

Las horas de trabajo que tus empleados pasan formándose durante su jornada laboral se computan legalmente como cofinanciación privada. Su coste por hora cubre ese requisito de forma automática. No necesitas gastar un euro extra.

Pequeños trucos legales como este son los que te permiten maximizar el presupuesto. Hemos recopilado más consejos y metodologías útiles en este recurso:

{{recurso_descripcion}}

Míralo aquí:
{{recurso_cta}}

Si quieres comprobar si estáis optimizando correctamente la cofinanciación y otras variables en {{organizacion}}, agenda una llamada de 10 minutos:
{{enlace_calendly_utm}}

Un saludo,
[Tu Nombre / Firma]

### Variaciones de Recurso (Email 5)
*   **Recurso A (Checklist PDF):**
    *   `{{recurso_descripcion}}`: "El checklist en PDF que incluye este y otros 9 errores muy comunes que cometen las empresas españolas."
    *   `{{recurso_cta}}`: "[Descargar Checklist 10 Errores]({{enlace_recurso_utm}})"
*   **Recurso B (Calculadora):**
    *   `{{recurso_descripcion}}`: "Nuestra calculadora, adaptada para estimar tu cofinanciación en base al coste medio por hora de tu equipo."
    *   `{{recurso_cta}}`: "[Calcular crédito y cofinanciación]({{enlace_recurso_utm}})"
*   **Recurso C (Webinar):**
    *   `{{recurso_descripcion}}`: "El webinar de 15 minutos donde explicamos de forma visual cómo estructurar la cofinanciación privada mediante horas de jornada laboral."
    *   `{{recurso_cta}}`: "[Ver Webinar sobre Cofinanciación]({{enlace_recurso_utm}})"
*   **Recurso D (Revisión):**
    *   `{{recurso_descripcion}}`: "Nuestra revisión rápida de 5 minutos para asegurar que estás computando correctamente las horas laborables en tus bonificaciones."
    *   `{{recurso_cta}}`: "[Solicitar revisión rápida]({{enlace_recurso_utm}})"
*   **Recurso E (Diagnóstico):**
    *   `{{recurso_descripcion}}`: "Un diagnóstico de 15 minutos para estructurar la cofinanciación de tus planes de formación de forma 100% legal y segura."
    *   `{{recurso_cta}}`: "[Solicitar diagnóstico de 15 minutos]({{enlace_recurso_utm}})"

---

## EMAIL 6: Última Oportunidad (Penúltimo aviso)

**Asunto:** Penúltimo aviso: el crédito de {{organizacion}} caduca pronto

Hola, {{nombre}}:

El año está avanzando y el plazo límite para aprovechar el crédito FUNDAE de este ejercicio se acorta de forma irreversible.

A diferencia de otras bonificaciones, FUNDAE no tiene periodos de gracia. Lo que no se notifique y comience antes de fin de año, se pierde para siempre.

Para ayudarte a tomar el control de tu saldo antes de que sea tarde, te dejo de nuevo el acceso:

{{recurso_descripcion}}

Consúltalo aquí de forma inmediata:
{{recurso_cta}}

O bien, si prefieres ahorrarte las lecturas de última hora y resolver esto de forma definitiva hoy mismo, agenda una llamada de 10 minutos:
{{enlace_calendly_utm}}

Un saludo,
[Tu Nombre / Firma]

### Variaciones de Recurso (Email 6)
*   **Recurso A (Checklist PDF):**
    *   `{{recurso_descripcion}}`: "El checklist en PDF para revisar a contrarreloj que tu empresa no esté cometiendo fallos que invaliden el crédito."
    *   `{{recurso_cta}}`: "[Descargar Checklist PDF de Urgencia]({{enlace_recurso_utm}})"
*   **Recurso B (Calculadora):**
    *   `{{recurso_descripcion}}`: "Nuestra calculadora rápida de crédito para saber exactamente el saldo exacto que estás a punto de perder."
    *   `{{recurso_cta}}`: "[Calcular crédito en riesgo]({{enlace_recurso_utm}})"
*   **Recurso C (Webinar):**
    *   `{{recurso_descripcion}}`: "El webinar de 15 minutos que te muestra el plan de acción exprés para bonificar formación en tiempo récord."
    *   `{{recurso_cta}}`: "[Acceder al Webinar de Urgencia]({{enlace_recurso_utm}})"
*   **Recurso D (Revisión):**
    *   `{{recurso_descripcion}}`: "Nuestra revisión exprés de 5 minutos para cuantificar tu saldo actual y planificar su aplicación antes del cierre."
    *   `{{recurso_cta}}`: "[Reservar Revisión Exprés de 5 min]({{enlace_recurso_utm}})"
*   **Recurso E (Diagnóstico):**
    *   `{{recurso_descripcion}}`: "El diagnóstico acelerado de 15 minutos para estructurar la bonificación de tus cursos pendientes antes de que expire el plazo."
    *   `{{recurso_cta}}`: "[Reservar Diagnóstico Acelerado]({{enlace_recurso_utm}})"

---

## EMAIL 7: Cierre de Campaña (Cierre respetuoso pero firme)

**Asunto:** Cierro este hilo, {{nombre}}

Hola, {{nombre}}:

Te he escrito varias veces para ayudarte a recuperar el crédito de formación de {{organizacion}} que ya habéis pagado y que corre el riesgo de perderse este año.

Dado que estarás enfocado en otras prioridades del negocio, este será mi último correo sobre este tema.

Te dejo aquí por última vez el acceso al recurso por si decides revisarlo en otro momento:

{{recurso_descripcion}}

Enlace al recurso:
{{recurso_cta}}

Si en algún momento decides que quieres recuperar ese saldo y planificar la formación de tu equipo de forma 100% segura, puedes agendar una llamada rápida de 10 minutos aquí (dejaré el enlace activo unos días más):
{{enlace_calendly_utm}}

Gracias por tu tiempo y atención.

Un saludo,
[Tu Nombre / Firma]

### Variaciones de Recurso (Email 7)
*   **Recurso A (Checklist PDF):**
    *   `{{recurso_descripcion}}`: "El checklist en PDF de los 10 errores de gestión que te servirá de guía de consulta permanente."
    *   `{{recurso_cta}}`: "[Acceso final al Checklist PDF]({{enlace_recurso_utm}})"
*   **Recurso B (Calculadora):**
    *   `{{recurso_descripcion}}`: "Nuestra calculadora de crédito online para evaluar tus fondos disponibles cuando consideres oportuno."
    *   `{{recurso_cta}}`: "[Acceso final a la Calculadora]({{enlace_recurso_utm}})"
*   **Recurso C (Webinar):**
    *   `{{recurso_descripcion}}`: "El webinar bajo demanda de 15 minutos para conocer los casos de éxito y la metodología de bonificación."
    *   `{{recurso_cta}}`: "[Acceso final al Webinar Gratuito]({{enlace_recurso_utm}})"
*   **Recurso D (Revisión):**
    *   `{{recurso_descripcion}}`: "Nuestra propuesta de revisión rápida de 5 minutos para analizar tu saldo disponible sin compromiso."
    *   `{{recurso_cta}}`: "[Acceso final a la Revisión de 5 min]({{enlace_recurso_utm}})"
*   **Recurso E (Diagnóstico):**
    *   `{{recurso_descripcion}}`: "El diagnóstico estratégico de 15 minutos para auditar tu histórico de cotizaciones de formación."
    *   `{{recurso_cta}}`: "[Acceso final al Diagnóstico de 15 min]({{enlace_recurso_utm}})"
