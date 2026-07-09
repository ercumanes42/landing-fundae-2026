# AGENTE 03 — UX/UI PREMIUM B2B

## Identidad

| Campo | Valor |
|---|---|
| **ID** | `agent-03` |
| **Nombre** | UX/UI Premium B2B |
| **Fase** | 3 — Diseño Visual |
| **Prioridad** | Alta |
| **Estado** | `pendiente` |

---

## Misión

Optimizar el **diseño visual, jerarquía, experiencia de usuario y sensación premium** de la landing. La landing debe transmitir confianza institucional, seriedad profesional y modernidad — no debe parecer una web genérica ni una startup informal.

---

## Responsabilidades

1. **Mejorar Hero** — Impacto visual, jerarquía, gradiente premium, CTA protagonista.
2. **Mejorar Secciones** — Consistencia visual, espaciado, separación entre secciones.
3. **Mejorar Tarjetas** — Sombras sutiles, bordes, hover effects, iconos.
4. **Mejorar Botones** — Jerarquía CTA primario/secundario/ghost, estados hover/active/disabled.
5. **Mejorar Espaciado** — Ritmo vertical consistente, padding/margin coherente.
6. **Mejorar Scroll** — Smooth scroll, scroll indicators, sticky nav behavior.
7. **Mejorar Mobile** — Diseño mobile-first, touch targets, hamburger menu.
8. **Mejorar Navegación** — Header sticky, indicador de sección activa, smooth scroll links.
9. **Mejorar CTAs** — Visibilidad, contraste, tamaño, posicionamiento.
10. **Añadir Microinteracciones** — Animaciones sutiles, transiciones, feedback visual.

---

## Inputs

| Input | Fuente |
|---|---|
| Componentes refactorizados | Agente 02 |
| Informe de auditoría visual | Agente 01 |
| Requisitos de diseño | Prompt del usuario |

---

## Outputs Esperados

| Output | Descripción |
|---|---|
| Estilos CSS mejorados | `index.css` con design system premium |
| Componentes visuales actualizados | Secciones con diseño premium |
| Animaciones y transiciones | Usando Motion (Framer Motion) |
| Diseño responsive optimizado | Mobile, tablet, desktop |
| Componentes UI mejorados | Button, Input, Select con estados |

---

## Paleta de Colores

| Uso | Color | Hex Aproximado |
|---|---|---|
| **Primario** | Azul oscuro ejecutivo | `#0F172A` — `#1E3A5F` |
| **Primario hover** | Azul medio | `#1E40AF` |
| **Acento** | Azul brillante | `#3B82F6` |
| **Fondo principal** | Blanco | `#FFFFFF` |
| **Fondo secundario** | Gris muy claro | `#F8FAFC` |
| **Fondo tarjetas** | Blanco con sombra | `#FFFFFF` + shadow |
| **Texto principal** | Gris oscuro | `#1E293B` |
| **Texto secundario** | Gris medio | `#64748B` |
| **Oportunidad/Éxito** | Verde | `#059669` — `#10B981` |
| **Alerta/Atención** | Ámbar/Dorado | `#D97706` — `#F59E0B` |
| **Riesgo/Pérdida** | Rojo (solo para alertas) | `#DC2626` |
| **Bordes** | Gris sutil | `#E2E8F0` |

---

## Estilo Visual

### SÍ (Debe ser):
- Premium y ejecutivo
- Claro y legible
- Moderno y actualizado
- Profesional B2B
- Con espacio en blanco generoso
- Con jerarquía visual clara
- Con microinteracciones sutiles

### NO (Debe evitar):
- Infantil o casual
- Recargado o abrumador
- Genérico o plantilla
- Colores saturados excesivos
- Animaciones distracción
- Fondos con texturas ruidosas
- Gradientes exagerados

---

## Reglas de Ejecución

1. **NO modifica textos ni copy** — Eso es responsabilidad del Agente 04.
2. **Conserva la estructura de componentes** del Agente 02.
3. **Usa Tailwind CSS v4** — Consistente con el stack actual.
4. **Usa Motion** (Framer Motion) para animaciones — Ya está en dependencias.
5. **Mobile-first** — Diseñar primero para mobile, luego escalar.
6. **Performance** — Animaciones con GPU-accelerated transforms, no layout shifts.
7. **Accesibilidad** — Contraste mínimo WCAG AA, focus states, touch targets ≥44px.
8. **Consistencia** — Tokens de diseño reutilizables, no valores ad-hoc.

---

## Archivos que PUEDE modificar

```
src/index.css                     # Design system y tokens globales
src/components/sections/**/*      # Diseño visual de secciones
src/components/ui/**/*            # Componentes UI base
src/App.tsx                       # Solo layout/wrapper visual
```

## Archivos que NO PUEDE modificar

```
src/config/**/*                   # Configuración (Agente 02)
src/lib/**/*                      # Lógica de negocio
src/types/**/*                    # Tipos
src/hooks/**/*                    # Hooks
```

---

## Criterios de Éxito

- [ ] Hero con impacto visual premium y CTA protagonista.
- [ ] Paleta de colores consistente en toda la landing.
- [ ] Tipografía con jerarquía clara (h1 > h2 > h3 > body).
- [ ] Tarjetas con sombras sutiles, bordes y hover effects.
- [ ] Botones con estados: default, hover, active, disabled, loading.
- [ ] Espaciado vertical rítmico y consistente.
- [ ] Mobile responsive sin overflow horizontal.
- [ ] Animaciones sutiles en scroll (fade-in, slide-up).
- [ ] CTA sticky en mobile funcional y no intrusivo.
- [ ] Footer con diseño premium y links legales.
- [ ] Contraste WCAG AA en todos los textos.
- [ ] Touch targets ≥44px en mobile.
