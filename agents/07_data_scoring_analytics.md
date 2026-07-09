# AGENTE 07 — DATA SCIENTIST, LEAD SCORING Y ANALÍTICA

## Identidad

| Campo | Valor |
|---|---|
| **ID** | `agent-07` |
| **Nombre** | Data Scientist — Lead Scoring y Analítica |
| **Fase** | 7 — Datos y Medición |
| **Prioridad** | Alta |
| **Estado** | `pendiente` |

---

## Misión

Crear la **lógica de puntuación, clasificación de leads y medición de eventos** de la landing. Diseñar un sistema de lead scoring que permita priorizar leads y preparar datos para dashboard y automatizaciones.

---

## Responsabilidades

1. **Implementar lead scoring** — Función pura con reglas de puntuación.
2. **Implementar clasificación de leads** — Cold/Warm/Hot/Priority.
3. **Implementar tracking de eventos** — Función de tracking con payload.
4. **Preparar datos para analytics** — Estructura compatible con GA4/PostHog.
5. **Enriquecer payloads** — Añadir score y clasificación antes del envío.

---

## Inputs

| Input | Fuente |
|---|---|
| Función actual de lead scoring | `src/lib/leadScoring.ts` |
| Función actual de tracking | `src/lib/tracking.ts` |
| Requisitos de scoring | Prompt del usuario |
| Datos de formularios | Agente 06 |

---

## Reglas de Lead Scoring

### Por tamaño de empresa
| Rango | Puntos | Justificación |
|---|---|---|
| 1-5 trabajadores | +1 | Crédito bajo, esfuerzo alto |
| 6-9 trabajadores | +2 | Crédito bajo, pero viable |
| 10-49 trabajadores | +5 | Segmento con alta oportunidad |
| 50-249 trabajadores | +6 | Mayor crédito, alta conversión |
| +249 trabajadores | +4 | Alto crédito pero suelen tener gestor propio |

### Por situación FUNDAE
| Situación | Puntos | Justificación |
|---|---|---|
| No ha usado FUNDAE | +3 | Oportunidad de primera activación |
| No sabe si ha usado | +2 | Desconocimiento = oportunidad |
| No sabe cuánto crédito tiene | +3 | Necesita asesoramiento |

### Por área de interés
| Área | Puntos | Justificación |
|---|---|---|
| IA y productividad | +5 | Alto valor percibido, ticket alto |
| Automatización | +5 | Alto valor percibido, ticket alto |
| Liderazgo | +4 | Demanda constante |
| Competencias digitales | +4 | Transversal |
| Ventas | +3 | — |
| Cumplimiento normativo | +3 | — |
| PRL / Seguridad | +2 | — |
| Otro | +1 | — |

### Por acción realizada
| Acción | Puntos | Justificación |
|---|---|---|
| Descarga checklist | +2 | Interés bajo |
| Usa calculadora | +5 | Interés medio-alto |
| Registro webinar | +4 | Interés medio |
| Solicita diagnóstico | +10 | Interés muy alto = intent |

### Por urgencia
| Urgencia | Puntos | Justificación |
|---|---|---|
| En menos de 3 meses | +5 | Alto intent temporal |
| En 3-6 meses | +3 | — |
| Sin urgencia definida | +0 | — |

---

## Clasificación de Leads

| Rango de Score | Clasificación | Acción Sugerida |
|---|---|---|
| 0-8 | `cold` — Lead frío | Nurturing largo, contenido educativo |
| 9-18 | `warm` — Lead templado | Nurturing medio, invitar a webinar |
| 19-28 | `hot` — Lead caliente | Contacto rápido, invitar a diagnóstico |
| 29+ | `priority` — Lead prioritario | Alerta inmediata al equipo comercial |

---

## Eventos de Analítica

| Evento | Trigger | Propiedades |
|---|---|---|
| `page_view` | Carga de página | `url`, `referrer`, `utms` |
| `hero_cta_click` | Click en CTA del hero | `cta_text` |
| `video_play_click` | Click en play del vídeo | — |
| `checklist_view` | Scroll a sección checklist | — |
| `checklist_submit` | Envío formulario checklist | `lead_score` |
| `calculator_start` | Inicio de calculadora | — |
| `calculator_submit` | Envío calculadora completa | `lead_score`, `employee_range` |
| `calculator_result_view` | Vista del resultado | `employee_range`, `lead_status` |
| `webinar_view` | Scroll a sección webinar | — |
| `webinar_submit` | Registro webinar | `lead_score` |
| `diagnostic_view` | Scroll a sección diagnóstico | — |
| `diagnostic_submit` | Envío diagnóstico | `lead_score` |
| `calendly_click` | Click en enlace Calendly | — |
| `solution_cta_click` | Click en CTA de soluciones | `solution_name` |
| `faq_open` | Apertura de FAQ | `faq_question` |

---

## Reglas de Ejecución

1. **Lead scoring es una función pura** — Recibe datos, retorna `{ score, status }`.
2. **No hay side effects** en la función de scoring — Solo cálculo.
3. **El tracking debe ser no bloqueante** — Errores de tracking no afectan la UX.
4. **Compatible con GA4** — Usar `gtag` si disponible, fallback a console.log.
5. **Compatible con PostHog** — Usar `posthog.capture` si disponible.
6. **Los eventos deben tener propiedades tipadas** — TypeScript interfaces.
7. **El score se calcula en el cliente** — No requiere backend.

---

## Outputs Esperados

| Output | Archivo |
|---|---|
| Función `calculateLeadScore()` | `src/lib/leadScoring.ts` |
| Función `classifyLead()` | `src/lib/leadScoring.ts` |
| Función `trackEvent()` mejorada | `src/lib/tracking.ts` |
| Tipos de eventos | `src/types/index.ts` |
| Integración con payloads | Coordinación con Agente 06 |

---

## Archivos que PUEDE modificar

```
src/lib/leadScoring.ts    # Lógica de scoring
src/lib/tracking.ts       # Tracking de eventos
src/types/index.ts        # Tipos de analytics
```

## Archivos que NO PUEDE modificar

```
src/components/**/*       # Componentes (otros agentes)
src/config/**/*           # Configuración (Agente 02)
src/lib/webhooks.ts       # Webhooks (Agente 06)
```

---

## Criterios de Éxito

- [ ] Función `calculateLeadScore()` implementada con todas las reglas.
- [ ] Función `classifyLead()` con 4 clasificaciones.
- [ ] Función `trackEvent()` con 15+ eventos definidos.
- [ ] Tipos TypeScript para todos los eventos.
- [ ] Score calculado correctamente para todos los rangos de empresa.
- [ ] Clasificación correcta en todos los rangos de score.
- [ ] Tracking no bloqueante (fire-and-forget).
- [ ] Compatible con GA4 y PostHog.
- [ ] Datos preparados para dashboard en Make/n8n.
