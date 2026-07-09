# AGENTE 06 — FORMULARIOS Y WEBHOOKS

## Identidad

| Campo | Valor |
|---|---|
| **ID** | `agent-06` |
| **Nombre** | Formularios y Webhooks |
| **Fase** | 6 — Formularios e Integraciones |
| **Prioridad** | Alta |
| **Estado** | `pendiente` |

---

## Misión

Crear o mejorar **todos los formularios de la landing** y sus conexiones a webhooks. Cada formulario debe tener validación completa, estados visuales (loading/success/error), captura de UTMs, consentimiento RGPD y envío de un payload JSON estándar.

---

## Responsabilidades

1. **Formulario de Checklist** — Captura mínima para descarga de PDF.
2. **Formulario de Calculadora** — Integrado en el componente multi-paso (Agente 05).
3. **Formulario de Webinar** — Registro con datos de contacto y empresa.
4. **Formulario de Diagnóstico** — Captura completa para agendar diagnóstico.
5. **Sistema de webhooks** — Función reutilizable para envío de datos.
6. **Captura de UTMs** — Hook/utilidad compartida.
7. **Payload estándar** — Estructura JSON consistente para todos los formularios.

---

## Inputs

| Input | Fuente |
|---|---|
| Componentes de formularios actuales | MVP existente |
| Función de webhooks actual | `src/lib/webhooks.ts` |
| Hook de UTMs | `src/hooks/useUTM.ts` (Agente 02) |
| Función de lead scoring | `src/lib/leadScoring.ts` (Agente 07) |
| Componentes UI | `src/components/ui/*` (Agente 03) |
| Tipos TypeScript | `src/types/index.ts` (Agente 02) |

---

## Formularios Requeridos

### 1. Formulario Checklist
| Campo | Tipo | Obligatorio |
|---|---|---|
| Nombre | Text | ✅ |
| Email | Email | ✅ |
| Empresa | Text | ✅ |
| Nº empleados | Select | ✅ |
| Privacidad | Checkbox | ✅ |
| Comunicaciones | Checkbox | ❌ |

**Acción post-submit**: Descargar PDF + Mensaje de éxito.

### 2. Formulario Calculadora
Definido por Agente 05. Este agente solo gestiona el envío a webhook.

### 3. Formulario Webinar
| Campo | Tipo | Obligatorio |
|---|---|---|
| Nombre | Text | ✅ |
| Email | Email | ✅ |
| Empresa | Text | ✅ |
| Cargo/Rol | Text | ❌ |
| Nº empleados | Select | ✅ |
| Privacidad | Checkbox | ✅ |
| Comunicaciones | Checkbox | ❌ |

**Acción post-submit**: Mensaje de confirmación + Info webinar.

### 4. Formulario Diagnóstico
| Campo | Tipo | Obligatorio |
|---|---|---|
| Nombre | Text | ✅ |
| Email | Email | ✅ |
| Teléfono | Tel | ✅ |
| Empresa | Text | ✅ |
| Cargo/Rol | Text | ❌ |
| Nº empleados | Select | ✅ |
| Sector | Select | ✅ |
| ¿Ha usado FUNDAE? | Select | ✅ |
| Mensaje / Necesidades | Textarea | ❌ |
| Privacidad | Checkbox | ✅ |
| Comunicaciones | Checkbox | ❌ |

**Acción post-submit**: Redirigir a Calendly + Mensaje de confirmación.

---

## Estados de Formulario

Cada formulario DEBE implementar estos estados:

| Estado | Comportamiento Visual |
|---|---|
| `idle` | Formulario visible, botón activo |
| `loading` | Spinner en botón, campos deshabilitados |
| `success` | Mensaje de éxito, formulario oculto o reset |
| `error` | Mensaje de error, formulario sigue activo |
| `validation` | Mensajes inline bajo campos inválidos |

---

## Payload JSON Estándar

```json
{
  "form_type": "checklist|calculator|webinar|diagnostic",
  "created_at": "2026-06-17T08:10:24+02:00",
  "source_url": "https://landing.example.com",
  "utm_source": "",
  "utm_medium": "",
  "utm_campaign": "",
  "utm_content": "",
  "utm_term": "",
  "referrer": "",
  "lead_score": 0,
  "lead_status": "cold|warm|hot|priority",
  "contact": {
    "name": "",
    "email": "",
    "phone": "",
    "company": "",
    "role": ""
  },
  "company": {
    "province": "",
    "sector": "",
    "employee_range": "",
    "used_fundae_before": "",
    "knows_credit": "",
    "current_training_provider": ""
  },
  "interest": {
    "training_area": "",
    "urgency": "",
    "message": ""
  },
  "consent": {
    "privacy_accepted": true,
    "marketing_accepted": false
  }
}
```

> **Nota**: No todos los formularios capturan todos los campos. Los campos no aplicables se envían como `""` o `null`.

---

## Reglas de Ejecución

1. **Cada formulario debe tener validación completa** — Email válido, campos obligatorios, checkbox privacidad.
2. **Los webhooks se envían desde el cliente** — La URL viene de variables de entorno `VITE_*`.
3. **Captura de UTMs automática** — Usando hook/utilidad compartida.
4. **Captura de referrer automática** — `document.referrer`.
5. **Lead score se calcula ANTES de enviar** — Usando función del Agente 07.
6. **Payload consistente** — Misma estructura JSON para todos los formularios.
7. **Mensajes de error amables** — No errores técnicos al usuario.
8. **Timeout de 10 segundos** en peticiones webhook.
9. **Reintentos** — 1 reintento en caso de fallo de red.
10. **Fallback** — Si el webhook falla, guardar datos en localStorage como backup.

---

## Archivos que PUEDE modificar

```
src/lib/webhooks.ts                           # Función de envío
src/hooks/useFormSubmit.ts                     # Hook de formularios (nuevo)
src/components/sections/ChecklistSection.tsx   # Formulario checklist
src/components/sections/WebinarSection.tsx     # Formulario webinar
src/components/sections/DiagnosticSection.tsx  # Formulario diagnóstico
src/components/forms/**/*                      # Componentes de formulario (nuevo)
```

## Archivos que NO PUEDE modificar

```
src/components/sections/CalculatorSection.tsx  # Responsabilidad del Agente 05
src/lib/leadScoring.ts                         # Responsabilidad del Agente 07
src/config/**/*                                # Solo lee
```

---

## Criterios de Éxito

- [ ] 4 formularios funcionales con validación completa.
- [ ] Estados loading/success/error implementados en todos.
- [ ] Checkbox obligatorio de privacidad en todos.
- [ ] Checkbox opcional de comunicaciones en todos.
- [ ] Payload JSON estándar enviado a webhook correcto.
- [ ] UTMs capturados en todos los payloads.
- [ ] Referrer capturado en todos los payloads.
- [ ] Lead score incluido en todos los payloads.
- [ ] Fallback a localStorage si webhook falla.
- [ ] Timeout de 10 segundos implementado.
- [ ] Mensajes de error amables (no técnicos).
- [ ] Acción post-submit correcta por tipo de formulario.
