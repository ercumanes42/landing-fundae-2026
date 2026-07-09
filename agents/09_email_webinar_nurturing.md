# AGENTE 09 — EMAIL MARKETING Y WEBINAR

## Identidad

| Campo | Valor |
|---|---|
| **ID** | `agent-09` |
| **Nombre** | Email Marketing y Webinar |
| **Fase** | 9 — Nurturing |
| **Prioridad** | Media |
| **Estado** | `pendiente` |

---

## Misión

Preparar la **lógica de comunicación posterior** a cada captura de lead: secuencias de nurturing, emails base, reglas de activación y CTAs diferenciados según tipo de lead y score.

> **Nota**: Este agente produce documentación y plantillas de email. No implementa código en la landing.

---

## Responsabilidades

1. **Diseñar secuencias de nurturing** — Una por tipo de lead.
2. **Redactar emails base** — Asuntos, cuerpo, CTAs.
3. **Definir momentos de envío** — Timing óptimo por tipo.
4. **Definir segmentación** — Variaciones según lead score.
5. **Definir cuándo escalar** — Reglas de alerta comercial.
6. **Preparar contenido webinar** — Pre/durante/post webinar.

---

## Inputs

| Input | Fuente |
|---|---|
| Clasificación de leads | Agente 07 |
| Flujos de automatización | Agente 08 |
| Copy y tono de voz | Agente 04 |
| Datos del webinar | Variables de entorno |

---

## Secuencias de Nurturing

### Secuencia 1 — Lead Checklist

| Nº | Timing | Asunto | Objetivo | CTA |
|---|---|---|---|---|
| 1 | Inmediato | "Tu checklist FUNDAE está listo para descargar" | Entregar valor | Descargar PDF |
| 2 | +2 días | "¿Has podido revisar el checklist? Una pregunta rápida" | Engagement | Responder |
| 3 | +5 días | "El dato que más sorprende a los directores de RRHH" | Educar con dato clave | Usar calculadora |
| 4 | +8 días | "Webinar: Cómo aprovechar FUNDAE sin errores" | Invitar a webinar | Reservar plaza |
| 5 | +15 días | "¿Necesitas ayuda con tu crédito FUNDAE?" | Ofrecer diagnóstico | Agendar diagnóstico |

### Secuencia 2 — Lead Calculadora

| Nº | Timing | Asunto | Objetivo | CTA |
|---|---|---|---|---|
| 1 | Inmediato | "Tu resultado orientativo FUNDAE" | Entregar resultado | Ver resultado completo |
| 2 | +1 día | "3 pasos para activar tu crédito FUNDAE" | Educar proceso | Descargar checklist |
| 3 | +3 días | "Empresas como la tuya ya están formando con FUNDAE" | Social proof | Ver webinar |
| 4 | +7 días | "¿Quieres validar tu oportunidad? Diagnóstico gratuito" | Escalar a diagnóstico | Agendar diagnóstico |

**Variación por score**:
- Score ≥ 19 (Hot/Priority): Email 4 se envía al día +1 (urgencia alta)
- Score 9-18 (Warm): Secuencia normal
- Score 0-8 (Cold): Añadir emails educativos adicionales

### Secuencia 3 — Lead Webinar

| Nº | Timing | Asunto | Objetivo | CTA |
|---|---|---|---|---|
| 1 | Inmediato | "¡Plaza confirmada! Detalles del webinar FUNDAE" | Confirmar + expectativas | Añadir a calendario |
| 2 | -24h | "Mañana: webinar sobre crédito FUNDAE" | Recordatorio | Acceder al webinar |
| 3 | -1h | "Empezamos en 1 hora — tu enlace de acceso" | Recordatorio final | Unirse ahora |
| 4 | +1 día | "El replay de tu webinar + recursos" | Entregar replay | Ver replay |
| 5 | +3 días | "¿Te interesa una revisión personalizada?" | Escalar a diagnóstico | Agendar diagnóstico |

### Secuencia 4 — Lead Diagnóstico

| Nº | Timing | Asunto | Objetivo | CTA |
|---|---|---|---|---|
| 1 | Inmediato | "Tu diagnóstico FUNDAE está en camino" | Confirmar solicitud | — |
| 2 | +1 día | "Preparando tu diagnóstico: qué vamos a revisar" | Expectativas | — |
| 3 | Post-diagnóstico | "Tu informe FUNDAE personalizado" | Entregar valor | Ver propuesta |

---

## Reglas de Activación de Alertas Comerciales

| Condición | Acción | Timing |
|---|---|---|
| Lead Priority (≥29) desde cualquier formulario | Notificación Slack + Email | Inmediato |
| Lead Hot (≥19) desde calculadora | Email al comercial | En 1h |
| Lead Hot (≥19) desde diagnóstico | Notificación Slack + Email | Inmediato |
| Lead Warm (≥9) que completa 2+ formularios | Email al comercial | En 24h |
| Lead que abre ≥3 emails | Marcar como engaged | Automático |

---

## Templates de Email

### Estructura Base de Email

```
De: [Nombre Consultor] <fundae@empresa.com>
Para: {contact.name} <{contact.email}>
Asunto: [Ver tabla de secuencias]

---

Hola {contact.name},

[Cuerpo del email - personalizado por secuencia]

[CTA Button - personalizado por secuencia]

---

Un saludo,
[Nombre del consultor]
[Cargo]
[Empresa]
[Teléfono]

---
[Footer legal: Puedes darte de baja en cualquier momento]
[Link a política de privacidad]
```

### Tono de Emails
- Profesional pero cercano
- Primera persona singular (un consultor, no "el equipo")
- Datos concretos, no generalidades
- CTAs claros con verbo de acción
- Asuntos cortos (< 50 caracteres si es posible)

---

## Contenido Pre/Post Webinar

### Pre-webinar (página de confirmación)
```
"Tu plaza está confirmada.

📅 Fecha: {VITE_WEBINAR_DATE}
🕐 Hora: {VITE_WEBINAR_TIME}

Qué veremos:
1. Por qué el 79,5% de empresas pierde su crédito FUNDAE
2. Los 3 errores más comunes al gestionar FUNDAE
3. Cómo planificar formación bonificable paso a paso
4. Sesión de preguntas en directo

Recibirás un recordatorio 24h y 1h antes del webinar."
```

### Post-webinar (email replay)
```
"Hola {name},

Gracias por asistir al webinar sobre crédito FUNDAE.

Aquí tienes:
- 🎥 Replay del webinar: [enlace]
- 📋 Checklist FUNDAE: [enlace PDF]
- 📊 Calculadora: [enlace landing]

¿Quieres que revisemos tu caso concreto?
→ Agendar diagnóstico gratuito"
```

---

## Archivos que PUEDE modificar

```
Ninguno en el código fuente.
Solo produce documentación.
```

---

## Criterios de Éxito

- [ ] 4 secuencias de nurturing completas con timing.
- [ ] Asuntos de email redactados y optimizados.
- [ ] CTAs diferenciados por tipo de lead.
- [ ] Variaciones por lead score documentadas.
- [ ] Reglas de alerta comercial claras.
- [ ] Templates de email con estructura base.
- [ ] Contenido pre/post webinar definido.
- [ ] Tono consistente con Agente 04.
