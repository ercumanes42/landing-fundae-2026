# AGENTE 05 — ESPECIALISTA EN CALCULADORA FUNDAE

## Identidad

| Campo | Valor |
|---|---|
| **ID** | `agent-05` |
| **Nombre** | Especialista en Calculadora FUNDAE |
| **Fase** | 5 — Calculadora |
| **Prioridad** | Alta |
| **Estado** | `pendiente` |

---

## Misión

Crear o mejorar la **calculadora orientativa FUNDAE**: un formulario multi-paso que capture datos de la empresa, calcule un lead score, muestre un resultado orientativo personalizado y envíe los datos a un webhook. **La calculadora NO debe prometer importes exactos de crédito**.

---

## Responsabilidades

1. **Diseñar flujo multi-paso** — Steps claros con progreso visual.
2. **Implementar captura de datos** — Todos los campos requeridos.
3. **Implementar resultado orientativo** — Basado en tamaño de empresa.
4. **Integrar lead scoring** — Calcular score con la función del Agente 07.
5. **Integrar envío a webhook** — Payload estándar del Agente 06.
6. **Mostrar CTA post-resultado** — "Agendar diagnóstico gratuito".

---

## Inputs

| Input | Fuente |
|---|---|
| Componente actual `CalculatorSection.tsx` | MVP existente |
| Función de lead scoring | `src/lib/leadScoring.ts` |
| Función de webhook | `src/lib/webhooks.ts` |
| Copy optimizado | Agente 04 / `src/config/copy.ts` |
| Tipos TypeScript | `src/types/index.ts` |

---

## Campos a Capturar

### Paso 1 — Datos de empresa
| Campo | Tipo | Obligatorio | Opciones |
|---|---|---|---|
| Número de trabajadores | Select | ✅ | 1-5, 6-9, 10-49, 50-249, +249 |
| Provincia | Select | ✅ | Provincias de España |
| Sector | Select | ✅ | Lista de sectores |

### Paso 2 — Situación FUNDAE
| Campo | Tipo | Obligatorio | Opciones |
|---|---|---|---|
| ¿Ha usado FUNDAE antes? | Select | ✅ | Sí, No, No sé |
| ¿Conoce su crédito disponible? | Select | ✅ | Sí, No, Aproximadamente |
| Área de formación de interés | Select | ✅ | Ver lista abajo |

### Paso 3 — Datos de contacto
| Campo | Tipo | Obligatorio |
|---|---|---|
| Nombre | Text | ✅ |
| Empresa | Text | ✅ |
| Email | Email | ✅ |
| Teléfono | Tel | ❌ |
| Consentimiento privacidad | Checkbox | ✅ |
| Consentimiento comunicaciones | Checkbox | ❌ |

---

## Áreas de Formación

```
- IA y productividad
- Automatización de procesos
- Liderazgo y gestión de equipos
- Ventas y negociación
- Competencias digitales
- Cumplimiento normativo
- PRL / Seguridad laboral
- Otro
```

---

## Resultados Orientativos (por rango de empleados)

### 1-5 trabajadores
> "Tu empresa puede tener crédito disponible, pero conviene revisar si el esfuerzo de gestión compensa y qué formación tendría más impacto. Te recomendamos una consulta gratuita para evaluar opciones."

### 6-9 trabajadores
> "Tu empresa tiene crédito FUNDAE asignado. Muchas empresas de tu tamaño no lo usan por desconocimiento. Merece la pena revisar qué opciones de formación encajan con tu equipo."

### 10-49 trabajadores
> "Tu empresa tiene una oportunidad clara de revisión FUNDAE. Por tamaño y perfil, puede tener margen para planificar formación bonificable este año. Te recomendamos agendar un diagnóstico gratuito para validar crédito, requisitos y opciones."

### 50-249 trabajadores
> "Tu empresa probablemente tiene potencial para estructurar un plan anual de formación bonificable. Recomendamos revisar áreas prioritarias, calendario y posibles acciones de alto impacto."

### +249 trabajadores
> "Las empresas de tu tamaño suelen tener un crédito FUNDAE significativo. La clave está en optimizar la ejecución: áreas prioritarias, calendario de acciones y seguimiento del crédito consumido vs disponible."

---

## CTA Post-Resultado

```
Texto: "Agendar diagnóstico gratuito"
Acción: Scroll a sección diagnóstico O abrir Calendly
Texto secundario: "Te ayudamos a validar crédito, requisitos y opciones — sin compromiso"
```

---

## Reglas de Ejecución

1. **NUNCA mostrar importes exactos** de crédito FUNDAE.
2. Los resultados son ORIENTATIVOS y deben indicarlo claramente.
3. El formulario debe tener validación en cada paso.
4. Cada paso debe tener botón "Anterior" y "Siguiente".
5. Debe incluir barra de progreso visual.
6. Debe usar los componentes UI del Agente 02/03.
7. Debe integrar lead scoring del Agente 07.
8. Debe enviar payload al webhook del Agente 06.
9. Debe capturar UTMs via hook del Agente 02.
10. El resultado debe ser visualmente impactante (datos + CTA).

---

## Archivos que PUEDE modificar

```
src/components/sections/CalculatorSection.tsx
src/components/forms/CalculatorForm.tsx    (nuevo si se separa)
```

## Archivos que NO PUEDE modificar

```
src/lib/leadScoring.ts      # Solo usa, no modifica (Agente 07)
src/lib/webhooks.ts          # Solo usa, no modifica (Agente 06)
src/config/**/*              # Solo lee
```

---

## Criterios de Éxito

- [ ] Calculadora multi-paso funcional con 3 pasos.
- [ ] Todos los campos capturados según especificación.
- [ ] Validación por paso con mensajes claros.
- [ ] Resultado orientativo correcto por rango de empleados.
- [ ] Lead score calculado y enviado en el payload.
- [ ] Payload JSON enviado al webhook correctamente.
- [ ] UTMs capturados en el payload.
- [ ] CTA post-resultado visible y funcional.
- [ ] Diseño responsive y premium.
- [ ] Disclaimer de "resultado orientativo" visible.
- [ ] No se muestran importes exactos en ningún caso.
